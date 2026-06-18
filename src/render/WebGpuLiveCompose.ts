import { DataUtils } from 'three';
import { HalfFloatType, NearestFilter, RGBAFormat, StorageTexture, WebGPURenderer } from 'three/webgpu';
import { Fn, instanceIndex, textureStore, uint, uvec2, vec4 } from 'three/tsl';

import { resolveBackdropProfileForRuntime } from '@/config/backdrop';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import type { Ctx, MaterialParams } from '@/core/types';
import type {
  CompositorLens,
  LightField,
  OverlaySurface,
  ParallaxBitmapLayer,
  ParallaxLayers,
  RenderBackendWebGpuComposeLiveMetrics,
  RenderBackendWebGpuComposeStatus,
} from '@/render/pixels';
import {
  resolveThreeStorageTextureAccess,
  type WebGpuStorageTextureAccess,
  type WebGpuTextureLike,
} from '@/render/WebGpuStorageTextureAccess';
import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

const COMPOSE_PAD = 64;
const WIN_W = VIEW_W + COMPOSE_PAD * 2;
const WIN_H = VIEW_H + COMPOSE_PAD * 2;
const MAX_WAVES = 8;
const MAX_LENSES = 4;
const MAX_BACKDROP_LAYERS = 5;
const TWO_PI = Math.PI * 2;
const LIGHT_W = (VIEW_W >> 1) + 1;
const LIGHT_H = (VIEW_H >> 1) + 1;

const GPU_TEXTURE_USAGE_COPY_DST = 0x02;
const GPU_TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const GPU_BUFFER_USAGE_COPY_DST = 0x08;
const GPU_BUFFER_USAGE_STORAGE = 0x80;
const GPU_SHADER_STAGE_COMPUTE = 0x04;

const PARAM_COUNT = 160;
const BACKDROP_BASE = 32;
const BACKDROP_STRIDE = 8;
const WAVE_BASE = BACKDROP_BASE + MAX_BACKDROP_LAYERS * BACKDROP_STRIDE;
const WAVE_STRIDE = 8;
const LENS_BASE = WAVE_BASE + MAX_WAVES * WAVE_STRIDE;
const LENS_STRIDE = 4;

interface RuntimeGpuQueue {
  submit(commandBuffers: unknown[]): void;
  writeTexture(
    destination: { texture: RuntimeGpuTexture; origin?: { x: number; y: number } },
    data: GpuUploadData,
    dataLayout: { bytesPerRow: number },
    size: { width: number; height: number },
  ): void;
  writeBuffer(buffer: RuntimeGpuBuffer, offset: number, data: GpuUploadData): void;
  onSubmittedWorkDone?(): Promise<void>;
}

interface RuntimeGpuDevice {
  queue: RuntimeGpuQueue;
  addEventListener?(
    type: 'uncapturederror',
    listener: (event: RuntimeGpuUncapturedErrorEvent) => void,
  ): void;
  removeEventListener?(
    type: 'uncapturederror',
    listener: (event: RuntimeGpuUncapturedErrorEvent) => void,
  ): void;
  createTexture(descriptor: {
    label: string;
    size: { width: number; height: number };
    format: string;
    usage: number;
  }): RuntimeGpuTexture;
  createShaderModule(descriptor: { label: string; code: string }): unknown;
  createBindGroupLayout(descriptor: { label: string; entries: unknown[] }): unknown;
  createPipelineLayout(descriptor: { bindGroupLayouts: unknown[] }): unknown;
  createComputePipeline(descriptor: {
    label: string;
    layout: unknown;
    compute: { module: unknown; entryPoint: string };
  }): unknown;
  createBindGroup(descriptor: { label: string; layout: unknown; entries: unknown[] }): unknown;
  createBuffer(descriptor: { label: string; size: number; usage: number }): RuntimeGpuBuffer;
  createCommandEncoder(descriptor: { label: string }): RuntimeCommandEncoder;
}

interface RuntimeGpuBuffer {
  destroy(): void;
}

interface RuntimeGpuTexture extends WebGpuTextureLike {
  destroy(): void;
}

interface RuntimeGpuUncapturedErrorEvent {
  error?: { message?: string };
  message?: string;
}

interface RuntimeCommandEncoder {
  beginComputePass(descriptor: { label: string }): RuntimeComputePass;
  finish(): unknown;
}

interface RuntimeComputePass {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(workgroupCountX: number, workgroupCountY?: number, workgroupCountZ?: number): void;
  end(): void;
}

interface RendererDeviceProbe {
  backend?: {
    device?: RuntimeGpuDevice;
  };
}

interface BackdropGpuTexture {
  texture: RuntimeGpuTexture;
  width: number;
  height: number;
  version: number;
}

type GpuUploadData = ArrayBuffer | ArrayBufferView<ArrayBufferLike>;

interface UploadStats {
  logicalBytes: number;
  submittedBytes: number;
}

interface TimedUploadStats extends UploadStats {
  cpuMs: number;
}

function rendererDevice(renderer: WebGPURenderer): RuntimeGpuDevice | null {
  return (renderer as RendererDeviceProbe).backend?.device ?? null;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function byteView(data: GpuUploadData): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}

// WebGPU writeTexture requires bytesPerRow aligned to 256, so non-aligned rows
// need a staging copy. `scratch` lets hot-path callers pass a persistent buffer
// (sized paddedRowBytes*height) so the compose path allocates nothing per frame.
function padRows(
  data: GpuUploadData,
  rowBytes: number,
  height: number,
  paddedRowBytes = align(rowBytes, 256),
  scratch?: Uint8Array,
): Uint8Array {
  const bytes = byteView(data);
  if (rowBytes === paddedRowBytes) return bytes;
  const padded = scratch ?? new Uint8Array(paddedRowBytes * height);
  for (let row = 0; row < height; row++) {
    padded.set(bytes.subarray(row * rowBytes, row * rowBytes + rowBytes), row * paddedRowBytes);
  }
  return padded;
}

function packCellValue(types: Uint8Array, colors: Uint32Array, charge: Uint16Array, ci: number): number {
  const c = colors[ci];
  return (
    (((c >>> 16) & 0xff) |
      (c & 0xff00) |
      ((c & 0xff) << 16) |
      ((types[ci] | (charge[ci] !== 0 ? 0x80 : 0)) << 24)) >>>
    0
  );
}

function createLiveMetrics(frameId: number): RenderBackendWebGpuComposeLiveMetrics {
  return {
    frameId,
    outputPixels: VIEW_W * VIEW_H,
    dispatchWorkgroupsX: Math.ceil(VIEW_W / 8),
    dispatchWorkgroupsY: Math.ceil(VIEW_H / 8),
    beginFrameCpuMs: 0,
    commitCpuMs: 0,
    packWindowCpuMs: 0,
    packWindowBytes: WIN_W * WIN_H * 4,
    worldWindowLogicalUploadBytes: 0,
    worldWindowSubmittedUploadBytes: 0,
    worldWindowUploadCpuMs: 0,
    lightUploadedThisFrame: false,
    lightPackCpuMs: 0,
    lightLogicalUploadBytes: 0,
    lightSubmittedUploadBytes: 0,
    lightUploadCpuMs: 0,
    lutPackCpuMs: 0,
    lutLogicalUploadBytes: 0,
    lutSubmittedUploadBytes: 0,
    lutUploadCpuMs: 0,
    paramsUploadBytes: 0,
    paramsUploadCpuMs: 0,
    backdropTextureUploads: 0,
    backdropLogicalUploadBytes: 0,
    backdropSubmittedUploadBytes: 0,
    backdropUploadCpuMs: 0,
    overlayTouchedPixels: 0,
    overlayPackCpuMs: 0,
    overlayLogicalUploadBytes: 0,
    overlaySubmittedUploadBytes: 0,
    overlayUploadCpuMs: 0,
    commandEncodeSubmitCpuMs: 0,
    totalLogicalUploadBytes: 0,
    totalSubmittedUploadBytes: 0,
  };
}

class WebGpuOverlay implements OverlaySurface {
  readonly data = new Float32Array(VIEW_W * VIEW_H * 4);
  readonly half = new Uint16Array(VIEW_W * VIEW_H * 4);
  private readonly touched = new Uint8Array(VIEW_W * VIEW_H);
  private written = new Uint32Array(8192);
  private count = 0;

  get touchedCount(): number {
    return this.count;
  }

  mark(pixelIdx: number): void {
    if (this.touched[pixelIdx] !== 0) return;
    this.touched[pixelIdx] = 1;
    if (this.count === this.written.length) {
      const grown = new Uint32Array(this.written.length * 2);
      grown.set(this.written);
      this.written = grown;
    }
    this.written[this.count++] = pixelIdx;
  }

  clear(): void {
    const { data, half, touched, written } = this;
    for (let k = 0; k < this.count; k++) {
      const pixel = written[k];
      const offset = pixel * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      half[offset] = 0;
      half[offset + 1] = 0;
      half[offset + 2] = 0;
      half[offset + 3] = 0;
      touched[pixel] = 0;
    }
    this.count = 0;
  }

  commit(): void {
    const { data, half, written } = this;
    for (let k = 0; k < this.count; k++) {
      const offset = written[k] * 4;
      half[offset] = DataUtils.toHalfFloat(data[offset]);
      half[offset + 1] = DataUtils.toHalfFloat(data[offset + 1]);
      half[offset + 2] = DataUtils.toHalfFloat(data[offset + 2]);
      half[offset + 3] = DataUtils.toHalfFloat(data[offset + 3]);
    }
  }
}

function createComputeShader(): string {
  return `
@group(0) @binding(0) var uWin: texture_2d<u32>;
@group(0) @binding(1) var uLight: texture_2d<f32>;
@group(0) @binding(2) var uLut: texture_2d<f32>;
@group(0) @binding(3) var uOverlay: texture_2d<f32>;
@group(0) @binding(4) var uBackdrop0: texture_2d<f32>;
@group(0) @binding(5) var uBackdrop1: texture_2d<f32>;
@group(0) @binding(6) var uBackdrop2: texture_2d<f32>;
@group(0) @binding(7) var uBackdrop3: texture_2d<f32>;
@group(0) @binding(8) var uBackdrop4: texture_2d<f32>;
@group(0) @binding(9) var<storage, read> uParams: array<f32>;
@group(0) @binding(10) var uOutput: texture_storage_2d<rgba16float, write>;

const C_PI = 3.141592653589793;

fn p(i: u32) -> f32 {
  return uParams[i];
}

fn wrapI(value: i32, size: i32) -> i32 {
  var r = value % size;
  if (r < 0) {
    r = r + size;
  }
  return r;
}

fn hash12(v: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(v.x, v.y, v.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + vec3<f32>(33.33));
  return fract((p3.x + p3.y) * p3.z);
}

fn flickerRand(v: vec2<f32>, salt: f32) -> f32 {
  if (p(10u) > 0.5) {
    return 0.5;
  }
  return hash12(v + p(9u) * salt);
}

fn softLit(lf: f32) -> f32 {
  var lit = lf * lf;
  if (lit > 1.25) {
    lit = min(2.0, 1.25 + (lit - 1.25) * 0.3);
  }
  return lit;
}

fn gradeBackdrop(cIn: vec3<f32>) -> vec3<f32> {
  var c = (cIn * exp2(p(14u)) + p(15u) - 0.5) * p(16u) + 0.5;
  let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  c = mix(vec3<f32>(luma), c, p(18u));
  return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(p(17u)));
}

fn backdropCoord(base: u32, vx: i32, vy: i32, camX: i32, camY: i32) -> vec2<i32> {
  let speed = p(base);
  let scale = max(0.25, p(base + 3u));
  let width = max(1, i32(round(1.0 / max(0.000001, p(base + 4u)))));
  let height = max(1, i32(round(1.0 / max(0.000001, p(base + 5u)))));
  let sx = i32(floor((floor(f32(camX) * speed) + f32(vx)) / scale + p(base + 6u)));
  let sy = i32(floor((floor(f32(camY) * speed) + f32(vy)) / scale + p(base + 7u)));
  return vec2<i32>(wrapI(sx, width), wrapI(sy, height));
}

fn applyBackdropSample(c: vec3<f32>, sample: vec4<f32>, opacity: f32) -> vec3<f32> {
  let a = clamp(sample.a * opacity, 0.0, 1.0);
  return mix(c, sample.rgb, a);
}

@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let col = i32(globalId.x);
  let rowB = i32(globalId.y);
  if (col >= ${VIEW_W} || rowB >= ${VIEW_H}) {
    return;
  }

  let vx = col;
  let vy = ${VIEW_H - 1} - rowB;
  let camX = i32(p(0u));
  let camY = i32(p(1u));
  let winOriginX = i32(p(2u));
  let winOriginY = i32(p(3u));
  let ambient = p(4u);
  let boost = p(5u);
  let ov = textureLoad(uOverlay, vec2<i32>(col, rowB), 0);
  var c = vec3<f32>(0.0);

  if (ov.a <= 0.5) {
    let wx = camX + vx;
    let wy = camY + vy;
    var lookupX = wx;
    var lookupY = wy;
    var ringGlow = 0.0;
    let waveCount = min(i32(p(12u)), ${MAX_WAVES});
    for (var i = 0; i < ${MAX_WAVES}; i = i + 1) {
      if (i >= waveCount) {
        break;
      }
      let base = ${WAVE_BASE}u + u32(i) * ${WAVE_STRIDE}u;
      let dx = f32(wx) - p(base);
      let dy = f32(wy) - p(base + 1u);
      let dist = sqrt(dx * dx + dy * dy);
      let front = p(base + 2u);
      if (dist > front - 9.0 && dist < front + 9.0) {
        let edgeFactor = 1.0 - abs(dist - front) / 9.0;
        let decayFactor = 1.0 - front / max(0.0001, p(base + 3u));
        let offset = sin(edgeFactor * C_PI) * p(base + 4u) * decayFactor;
        ringGlow = ringGlow + sin(edgeFactor * C_PI) * decayFactor;
        if (dist > 0.0) {
          lookupX = lookupX - i32(floor(dx / dist * offset));
          lookupY = lookupY - i32(floor(dy / dist * offset));
        }
      }
    }
    lookupX = clamp(lookupX, 0, ${WIDTH - 1});
    lookupY = clamp(lookupY, 0, ${HEIGHT - 1});

    let lensCount = min(i32(p(13u)), ${MAX_LENSES});
    for (var i = 0; i < ${MAX_LENSES}; i = i + 1) {
      if (i >= lensCount) {
        break;
      }
      let base = ${LENS_BASE}u + u32(i) * ${LENS_STRIDE}u;
      let ldx = f32(wx) - p(base);
      let ldy = f32(wy) - p(base + 1u);
      let ld2 = ldx * ldx + ldy * ldy;
      let radius = p(base + 2u);
      if (ld2 <= radius * radius && ld2 >= 1.0) {
        let ld = sqrt(ld2);
        let pull = 1.0 - ld / radius;
        let k = pull * pull * p(base + 3u);
        lookupX = lookupX + i32(floor(ldx / ld * k - ldy / ld * k * 0.7));
        lookupY = lookupY + i32(floor(ldy / ld * k + ldx / ld * k * 0.7));
      }
    }
    lookupX = clamp(lookupX, 0, ${WIDTH - 1});
    lookupY = clamp(lookupY, 0, ${HEIGHT - 1});

    let lx = clamp(lookupX - winOriginX, 0, ${WIN_W - 1});
    let ly = clamp(lookupY - winOriginY, 0, ${WIN_H - 1});
    let cell = textureLoad(uWin, vec2<i32>(lx, ly), 0);
    let typeId = i32(cell.a & 0x7fu);
    let charged = (cell.a & 0x80u) != 0u;
    let light = textureLoad(uLight, vec2<i32>(vx / 2, vy / 2), 0).rgb;
    let dxv = f32(vx) - ${(VIEW_W / 2).toFixed(1)};
    let dyv = f32(vy) - ${(VIEW_H / 2).toFixed(1)};
    let vg = 1.0 - p(19u) * ((dxv * dxv + dyv * dyv) / ${((VIEW_W / 2) * (VIEW_W / 2) + (VIEW_H / 2) * (VIEW_H / 2)).toFixed(1)});

    if (typeId == ${Cell.Empty}) {
      var bg = vec3<f32>(0.004, 0.005, 0.009);
      if (p(${BACKDROP_BASE}u + 2u) > 0.5 && p(${BACKDROP_BASE}u + 1u) > 0.0) {
        bg = applyBackdropSample(bg, textureLoad(uBackdrop0, backdropCoord(${BACKDROP_BASE}u, vx, vy, camX, camY), 0), p(${BACKDROP_BASE}u + 1u));
      }
      if (p(${BACKDROP_BASE + BACKDROP_STRIDE}u + 2u) > 0.5 && p(${BACKDROP_BASE + BACKDROP_STRIDE}u + 1u) > 0.0) {
        bg = applyBackdropSample(bg, textureLoad(uBackdrop1, backdropCoord(${BACKDROP_BASE + BACKDROP_STRIDE}u, vx, vy, camX, camY), 0), p(${BACKDROP_BASE + BACKDROP_STRIDE}u + 1u));
      }
      if (p(${BACKDROP_BASE + BACKDROP_STRIDE * 2}u + 2u) > 0.5 && p(${BACKDROP_BASE + BACKDROP_STRIDE * 2}u + 1u) > 0.0) {
        bg = applyBackdropSample(bg, textureLoad(uBackdrop2, backdropCoord(${BACKDROP_BASE + BACKDROP_STRIDE * 2}u, vx, vy, camX, camY), 0), p(${BACKDROP_BASE + BACKDROP_STRIDE * 2}u + 1u));
      }
      if (p(${BACKDROP_BASE + BACKDROP_STRIDE * 3}u + 2u) > 0.5 && p(${BACKDROP_BASE + BACKDROP_STRIDE * 3}u + 1u) > 0.0) {
        bg = applyBackdropSample(bg, textureLoad(uBackdrop3, backdropCoord(${BACKDROP_BASE + BACKDROP_STRIDE * 3}u, vx, vy, camX, camY), 0), p(${BACKDROP_BASE + BACKDROP_STRIDE * 3}u + 1u));
      }
      if (p(${BACKDROP_BASE + BACKDROP_STRIDE * 4}u + 2u) > 0.5 && p(${BACKDROP_BASE + BACKDROP_STRIDE * 4}u + 1u) > 0.0) {
        bg = applyBackdropSample(bg, textureLoad(uBackdrop4, backdropCoord(${BACKDROP_BASE + BACKDROP_STRIDE * 4}u, vx, vy, camX, camY), 0), p(${BACKDROP_BASE + BACKDROP_STRIDE * 4}u + 1u));
      }
      bg = gradeBackdrop(bg);
      let depthShade = 0.78 + 0.22 * (1.0 - f32(wy) / ${HEIGHT.toFixed(1)});
      var r = bg.r * depthShade;
      var g = bg.g * depthShade;
      var b = bg.b * depthShade;
      var lf0 = min(2.2, light.r) * vg;
      r = (r * 0.62 + ambient * 0.022) * vg + r * lf0 * lf0 * 0.72;
      lf0 = min(2.2, light.g) * vg;
      g = (g * 0.62 + ambient * 0.022) * vg + g * lf0 * lf0 * 0.72;
      lf0 = min(2.2, light.b) * vg;
      b = (b * 0.62 + ambient * 0.032) * vg + b * lf0 * lf0 * 0.72;
      r = r + max(0.0, light.r - 0.25) * 0.045 * vg;
      g = g + max(0.0, light.g - 0.25) * 0.04 * vg;
      b = b + max(0.0, light.b - 0.25) * 0.035 * vg;
      c = vec3<f32>(r, g, b) + ringGlow * vec3<f32>(0.55, 0.42, 0.26);
    } else {
      var base = vec3<f32>(f32(cell.r), f32(cell.g), f32(cell.b)) / 255.0;
      if (typeId == ${Cell.Fire}) {
        let fl = 0.75 + flickerRand(vec2<f32>(f32(wx), f32(wy)), 1.0) * 0.5;
        base = base * fl;
      } else if (typeId == ${Cell.Lava}) {
        base.r = base.r * (0.96 + flickerRand(vec2<f32>(f32(wx), f32(wy)), 1.0) * 0.08);
        base.g = base.g * (0.8 + flickerRand(vec2<f32>(f32(wy), f32(wx)), 1.618034) * 0.35);
      } else if (typeId == ${Cell.Ember}) {
        let fl = 0.7 + flickerRand(vec2<f32>(f32(wx), f32(wy)), 1.0) * 0.55;
        base.r = base.r * fl;
        base.g = base.g * fl * 0.95;
      } else if ((typeId == ${Cell.Water} || typeId == ${Cell.Healium} || typeId == ${Cell.Teleportium}) && wy > 0 && ly > 0 && i32(textureLoad(uWin, vec2<i32>(lx, ly - 1), 0).a & 0x7fu) == ${Cell.Empty}) {
        let wave = 0.88 + sin(p(6u) + f32(wx) * 0.42) * 0.12;
        base.r = base.r * wave;
        base.g = base.g * (0.94 + (wave - 0.88) * 0.45);
        base.b = base.b * (1.08 + (wave - 0.88) * 0.55);
      } else if (typeId == ${Cell.Crystal}) {
        if ((wx * 17 + wy * 31 + i32(p(7u))) % 97 == 0) {
          base = base * vec3<f32>(1.65, 1.45, 1.95);
        }
      } else if (typeId == ${Cell.Glowshroom}) {
        let breath = 0.9 + sin(p(8u) + f32(wx) * 0.21 + f32(wy) * 0.17) * 0.16;
        base.r = base.r * breath;
        base.g = base.g * (1.02 + (breath - 0.9) * 0.9);
        base.b = base.b * breath;
      } else if (typeId == ${Cell.Vines} || typeId == ${Cell.Moss} || typeId == ${Cell.Fungus}) {
        base.g = base.g * (0.94 + sin(p(11u) + f32(wx) * 0.13 + f32(wy) * 0.29) * 0.08);
      }

      let scalar = textureLoad(uLut, vec2<i32>(typeId, 0), 0).r;
      var intensity = 1.0 + (boost - 1.0) * scalar;
      if (charged) {
        base = vec3<f32>(0.2, 0.75, 1.0);
        intensity = boost * 1.2;
      }
      let floorL = 0.06 * vg;
      let selfGlow = select(0.0, 0.45 + scalar * 1.55, scalar > 0.0);
      c = vec3<f32>(
        base.r * max(softLit((ambient + min(2.2, light.r)) * vg), selfGlow) + base.r * floorL,
        base.g * max(softLit((ambient + min(2.2, light.g)) * vg), selfGlow) + base.g * floorL,
        base.b * max(softLit((ambient + min(2.2, light.b)) * vg), selfGlow) + base.b * floorL
      ) * intensity + ringGlow * vec3<f32>(0.55, 0.42, 0.26);
    }
  }

  textureStore(
    uOutput,
    vec2<i32>(col, rowB),
    // Overlay combine matches the CPU/WebGL reference exactly: no >=0 clamp here
    // (addPx can ride negative; the float16 store keeps parity with ComposeShader).
    vec4<f32>(c + ov.rgb, 1.0)
  );
}
`;
}

export class WebGpuLiveCompose {
  readonly outputTexture: StorageTexture;

  private readonly winBytes = new Uint8Array(WIN_W * WIN_H * 4);
  private readonly win32 = new Uint32Array(this.winBytes.buffer);
  private readonly lightData = new Float32Array(LIGHT_W * LIGHT_H * 4);
  private readonly lutData = new Float32Array(256);
  // One-float scratch for hashing each LUT weight's raw bits into lutSignature
  // (updateLut), so the rarely-changing bloom table isn't re-uploaded every frame.
  // lutSigBytes aliases the same buffer; both are reused so updateLut allocates nothing.
  private readonly lutSigScratch = new Float32Array(1);
  private readonly lutSigBytes = new Uint8Array(this.lutSigScratch.buffer);
  private lutSignature = -1;
  private readonly overlay = new WebGpuOverlay();
  // Persistent row-padding scratch for the two per-frame uploads whose rowBytes
  // are not 256-aligned (world window WIN_W*4, overlay VIEW_W*8) — avoids a fresh
  // multi-MB allocation + memcpy every composed frame (see padRows).
  private readonly winPadScratch = new Uint8Array(align(WIN_W * 4, 256) * WIN_H);
  private readonly winVisiblePaddedRowBytes = align(VIEW_W * 4, 256);
  private readonly winVisibleUploadRows = VIEW_H + 1;
  private readonly winVisiblePadScratch = new Uint8Array(
    this.winVisiblePaddedRowBytes * this.winVisibleUploadRows,
  );
  private readonly winVisible32 = new Uint32Array(this.winVisiblePadScratch.buffer);
  private readonly overlayPadScratch = new Uint8Array(align(VIEW_W * 8, 256) * VIEW_H);
  private readonly params = new Float32Array(PARAM_COUNT);
  private device: RuntimeGpuDevice | null = null;
  private storageAccess: WebGpuStorageTextureAccess | null = null;
  private winTexture: RuntimeGpuTexture | null = null;
  private lightTexture: RuntimeGpuTexture | null = null;
  private lutTexture: RuntimeGpuTexture | null = null;
  private overlayTexture: RuntimeGpuTexture | null = null;
  private paramBuffer: RuntimeGpuBuffer | null = null;
  private pipeline: unknown = null;
  private bindGroupLayout: unknown = null;
  private bindGroup: unknown = null;
  private backdropTextures: BackdropGpuTexture[] = [];
  private initialized = false;
  private lightUploaded = false;
  // Whether the overlay texture currently resident on the GPU holds any non-zero
  // pixels. When this frame touches nothing AND the GPU already holds an all-zero
  // overlay, commit() can skip the full-texture pad+upload (~1.5MB) entirely.
  private overlayGpuDirty = false;
  private currentMetrics: RenderBackendWebGpuComposeLiveMetrics | null = null;
  private lastMetrics: RenderBackendWebGpuComposeLiveMetrics | null = null;
  private uncapturedErrorHandler: ((event: RuntimeGpuUncapturedErrorEvent) => void) | null = null;
  private disposed = false;
  private initGeneration = 0;
  private status: RenderBackendWebGpuComposeStatus = {
    productionAvailable: false,
    bridge: 'initializing',
    reason: 'webgpu-live-compose-created',
    outputStorage: null,
    rawWgslWrite: {
      status: 'unrequested',
      reason: 'webgpu-live-compose-raw-wgsl-readback-not-requested',
      maxDelta: null,
      mismatchPct: null,
      exactPct: null,
      meanDelta: null,
      gpuSubmitReadbackWallMs: null,
    },
    liveMetrics: null,
  };

  constructor(private readonly renderer: WebGPURenderer) {
    for (let i = 3; i < this.lightData.length; i += 4) this.lightData[i] = 1;
    this.outputTexture = new StorageTexture(VIEW_W, VIEW_H);
    this.outputTexture.name = 'webgpu_live_compose_output';
    this.outputTexture.format = RGBAFormat;
    this.outputTexture.type = HalfFloatType;
    this.outputTexture.minFilter = NearestFilter;
    this.outputTexture.magFilter = NearestFilter;
    this.outputTexture.generateMipmaps = false;
    (this.outputTexture as StorageTexture & { mipmapsAutoUpdate?: boolean }).mipmapsAutoUpdate = false;
  }

  get available(): boolean {
    return !this.disposed && this.initialized && this.status.bridge === 'validated';
  }

  async initialize(): Promise<RenderBackendWebGpuComposeStatus> {
    if (this.disposed) return this.getStatus();
    if (this.initialized || this.status.bridge === 'failed') return this.getStatus();
    const generation = ++this.initGeneration;
    try {
      const device = rendererDevice(this.renderer);
      if (!device) throw new Error('WebGPU live compose requires a GPUDevice');
      this.device = device;
      this.registerUncapturedErrorHandler(device);

      const compute = this.makeStorageInitCompute();
      const result = this.renderer.compute(compute);
      if (result) await result;
      await device.queue.onSubmittedWorkDone?.();
      if (this.disposed || generation !== this.initGeneration) return this.getStatus();

      this.storageAccess = resolveThreeStorageTextureAccess(this.renderer, this.outputTexture, {
        expectedFormat: 'rgba16float',
        expectedWidth: VIEW_W,
        expectedHeight: VIEW_H,
        expectedMipLevelCount: 1,
        label: 'webgpu_live_compose_output',
      });

      this.winTexture = this.createTexture('webgpu_live_win_rgba8uint', 'rgba8uint', WIN_W, WIN_H, WIN_W * 4, this.winBytes);
      this.lightTexture = this.createTexture('webgpu_live_light_rgba32float', 'rgba32float', LIGHT_W, LIGHT_H, LIGHT_W * 16, this.lightData);
      this.lutTexture = this.createTexture('webgpu_live_lut_r32float', 'r32float', 256, 1, 256 * 4, this.lutData);
      this.overlayTexture = this.createTexture('webgpu_live_overlay_rgba16float', 'rgba16float', VIEW_W, VIEW_H, VIEW_W * 8, this.overlay.half);
      this.paramBuffer = device.createBuffer({
        label: 'webgpu_live_compose_params',
        size: this.params.byteLength,
        usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_DST,
      });
      this.backdropTextures = Array.from({ length: MAX_BACKDROP_LAYERS }, (_, index) =>
        this.createBackdropTexture(undefined, index),
      );
      this.createPipeline();
      this.rebuildBindGroup();

      if (this.disposed || generation !== this.initGeneration) return this.getStatus();
      this.initialized = true;
      this.status = {
        productionAvailable: false,
        bridge: 'validated',
        reason: 'webgpu-live-compose-diagnostic-enabled-production-still-gated',
        outputStorage: {
          format: this.storageAccess.format,
          width: this.storageAccess.descriptor.width,
          height: this.storageAccess.descriptor.height,
          mipLevelCount: this.storageAccess.descriptor.mipLevelCount,
          usage: this.storageAccess.descriptor.usage,
          source: this.storageAccess.source,
        },
        rawWgslWrite: { ...this.status.rawWgslWrite },
        liveMetrics: this.lastMetrics ? { ...this.lastMetrics } : null,
      };
    } catch (error) {
      if (this.disposed || generation !== this.initGeneration) return this.getStatus();
      // A failed init still registered the uncaptured-error listener above; detach
      // it so the dead instance doesn't keep firing failRuntime on later GPU errors.
      if (this.device && this.uncapturedErrorHandler) {
        this.device.removeEventListener?.('uncapturederror', this.uncapturedErrorHandler);
        this.uncapturedErrorHandler = null;
      }
      this.status = {
        productionAvailable: false,
        bridge: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        outputStorage: null,
        rawWgslWrite: { ...this.status.rawWgslWrite },
        liveMetrics: this.lastMetrics ? { ...this.lastMetrics } : null,
      };
    }
    return this.getStatus();
  }

  beginFrame(
    ctx: Ctx,
    light: LightField,
    layers: ParallaxLayers,
    lenses: readonly CompositorLens[],
    lightRebuilt: boolean,
  ): OverlaySurface {
    if (!this.available || !this.device) throw new Error('WebGPU live compose is not initialized');
    const frameStart = performance.now();
    const metrics = createLiveMetrics(ctx.state.frameCount);
    this.currentMetrics = metrics;
    const camX = ctx.camera.renderX;
    const camY = ctx.camera.renderY;
    const fullWindow = ctx.shockwaves.length > 0 || lenses.length > 0;
    const packStart = performance.now();
    const packedRows = fullWindow
      ? this.packWindowFull(ctx.world, camX, camY)
      : this.packWindowVisibleRows(ctx.world, camX, camY);
    metrics.packWindowCpuMs = performance.now() - packStart;
    metrics.packWindowBytes = fullWindow
      ? WIN_W * WIN_H * 4
      : VIEW_W * packedRows * 4;
    const winUpload = fullWindow
      ? this.timedUploadTexture(this.winTexture, this.winBytes, WIN_W, WIN_H, WIN_W * 4, this.winPadScratch)
      : this.timedUploadTextureRegion(
        this.winTexture,
        this.winVisiblePadScratch,
        VIEW_W,
        packedRows,
        this.winVisiblePaddedRowBytes,
        COMPOSE_PAD,
        COMPOSE_PAD - 1,
        VIEW_W * 4,
      );
    metrics.worldWindowLogicalUploadBytes = winUpload.logicalBytes;
    metrics.worldWindowSubmittedUploadBytes = winUpload.submittedBytes;
    metrics.worldWindowUploadCpuMs = winUpload.cpuMs;
    if (lightRebuilt || !this.lightUploaded) {
      const lightPackStart = performance.now();
      this.uploadLight(light);
      metrics.lightPackCpuMs = performance.now() - lightPackStart;
      const lightUpload = this.timedUploadTexture(this.lightTexture, this.lightData, LIGHT_W, LIGHT_H, LIGHT_W * 16);
      metrics.lightUploadedThisFrame = true;
      metrics.lightLogicalUploadBytes = lightUpload.logicalBytes;
      metrics.lightSubmittedUploadBytes = lightUpload.submittedBytes;
      metrics.lightUploadCpuMs = lightUpload.cpuMs;
      this.lightUploaded = true;
    }
    const lutPackStart = performance.now();
    const lutChanged = this.updateLut(ctx.params.materials);
    metrics.lutPackCpuMs = performance.now() - lutPackStart;
    if (lutChanged) {
      const lutUpload = this.timedUploadTexture(this.lutTexture, this.lutData, 256, 1, 256 * 4);
      metrics.lutLogicalUploadBytes = lutUpload.logicalBytes;
      metrics.lutSubmittedUploadBytes = lutUpload.submittedBytes;
      metrics.lutUploadCpuMs = lutUpload.cpuMs;
    }
    const backdropsChanged = this.syncBackdropTextures(layers);
    if (backdropsChanged) this.rebuildBindGroup();
    this.updateParams(ctx, layers, lenses, camX, camY);
    const paramUploadStart = performance.now();
    this.device.queue.writeBuffer(this.paramBuffer!, 0, this.params);
    metrics.paramsUploadBytes = this.params.byteLength;
    metrics.paramsUploadCpuMs = performance.now() - paramUploadStart;
    this.overlay.clear();
    metrics.beginFrameCpuMs = performance.now() - frameStart;
    this.refreshTotalUploadBytes(metrics);
    return this.overlay;
  }

  commit(): void {
    if (!this.available || !this.device || !this.pipeline || !this.bindGroup) {
      throw new Error('WebGPU live compose commit requires initialized GPU resources');
    }
    const commitStart = performance.now();
    const metrics = this.currentMetrics;
    const touchedCount = this.overlay.touchedCount;
    if (metrics) metrics.overlayTouchedPixels = touchedCount;
    // Skip the full overlay pad+upload when nothing was drawn this frame AND the
    // GPU already holds an all-zero overlay — the shader still samples it, so the
    // resident texture must be zero before we stop re-uploading.
    if (touchedCount > 0 || this.overlayGpuDirty) {
      const overlayPackStart = performance.now();
      this.overlay.commit();
      if (metrics) metrics.overlayPackCpuMs = performance.now() - overlayPackStart;
      const overlayUpload = this.timedUploadTexture(this.overlayTexture, this.overlay.half, VIEW_W, VIEW_H, VIEW_W * 8, this.overlayPadScratch);
      if (metrics) {
        metrics.overlayLogicalUploadBytes = overlayUpload.logicalBytes;
        metrics.overlaySubmittedUploadBytes = overlayUpload.submittedBytes;
        metrics.overlayUploadCpuMs = overlayUpload.cpuMs;
      }
      this.overlayGpuDirty = touchedCount > 0;
    }

    const commandStart = performance.now();
    const encoder = this.device.createCommandEncoder({ label: 'webgpu_live_compose_encoder' });
    const pass = encoder.beginComputePass({ label: 'webgpu_live_compose_pass' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(VIEW_W / 8), Math.ceil(VIEW_H / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    if (metrics) {
      metrics.commandEncodeSubmitCpuMs = performance.now() - commandStart;
      metrics.commitCpuMs = performance.now() - commitStart;
      this.refreshTotalUploadBytes(metrics);
      this.lastMetrics = { ...metrics };
      this.status.liveMetrics = { ...metrics };
    }
  }

  getStatus(): RenderBackendWebGpuComposeStatus {
    return {
      ...this.status,
      outputStorage: this.status.outputStorage ? { ...this.status.outputStorage } : null,
      rawWgslWrite: { ...this.status.rawWgslWrite },
      liveMetrics: this.status.liveMetrics ? { ...this.status.liveMetrics } : null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.initGeneration++;
    this.initialized = false;
    if (this.device && this.uncapturedErrorHandler) {
      this.device.removeEventListener?.('uncapturederror', this.uncapturedErrorHandler);
      this.uncapturedErrorHandler = null;
    }
    this.outputTexture.dispose();
    for (const texture of [
      this.winTexture,
      this.lightTexture,
      this.lutTexture,
      this.overlayTexture,
      ...this.backdropTextures.map((entry) => entry.texture),
    ]) {
      texture?.destroy();
    }
    this.paramBuffer?.destroy();
    this.status = {
      ...this.status,
      productionAvailable: false,
      bridge: 'failed',
      reason: 'webgpu-live-compose-disposed',
      outputStorage: null,
      rawWgslWrite: { ...this.status.rawWgslWrite },
      liveMetrics: this.status.liveMetrics ? { ...this.status.liveMetrics } : null,
    };
  }

  private makeStorageInitCompute() {
    return Fn(() => {
      const x = instanceIndex.mod(uint(VIEW_W));
      const y = instanceIndex.div(uint(VIEW_W));
      textureStore(this.outputTexture, uvec2(x, y), vec4(0, 0, 0, 1)).toWriteOnly();
    })()
      .compute(VIEW_W * VIEW_H, [64])
      .setName('WebGPU Live Compose Storage Init');
  }

  private failRuntime(reason: string): void {
    this.status = {
      ...this.status,
      productionAvailable: false,
      bridge: 'failed',
      reason,
      outputStorage: this.status.outputStorage ? { ...this.status.outputStorage } : null,
      rawWgslWrite: { ...this.status.rawWgslWrite },
      liveMetrics: this.status.liveMetrics ? { ...this.status.liveMetrics } : null,
    };
  }

  private registerUncapturedErrorHandler(device: RuntimeGpuDevice): void {
    if (!device.addEventListener || this.uncapturedErrorHandler) return;
    this.uncapturedErrorHandler = (event) => {
      const message = event.error?.message ?? event.message ?? 'uncaptured WebGPU error';
      this.failRuntime(`webgpu-live-compose-uncaptured-error: ${message}`);
    };
    device.addEventListener('uncapturederror', this.uncapturedErrorHandler);
  }

  private createTexture(
    label: string,
    format: string,
    width: number,
    height: number,
    rowBytes: number,
    data: GpuUploadData,
  ): RuntimeGpuTexture {
    if (!this.device) throw new Error('WebGPU live compose texture creation requires a GPUDevice');
    const texture = this.device.createTexture({
      label,
      size: { width, height },
      format,
      usage: GPU_TEXTURE_USAGE_TEXTURE_BINDING | GPU_TEXTURE_USAGE_COPY_DST,
    });
    this.uploadTexture(texture, data, width, height, rowBytes);
    return texture;
  }

  private createBackdropTexture(layer: ParallaxBitmapLayer | undefined, index: number): BackdropGpuTexture {
    const width = Math.max(1, layer?.width ?? 1);
    const height = Math.max(1, layer?.height ?? 1);
    const data = layer ? new Uint8Array(layer.pixels) : new Uint8Array([0, 0, 0, 0]);
    return {
      texture: this.createTexture(`webgpu_live_backdrop_${index}`, 'rgba8unorm', width, height, width * 4, data),
      width,
      height,
      version: layer?.version ?? -1,
    };
  }

  private uploadTexture(
    texture: RuntimeGpuTexture | null,
    data: GpuUploadData,
    width: number,
    height: number,
    rowBytes: number,
    padScratch?: Uint8Array,
  ): UploadStats {
    const paddedRowBytes = align(rowBytes, 256);
    const stats = {
      logicalBytes: rowBytes * height,
      submittedBytes: paddedRowBytes * height,
    };
    if (!this.device || !texture) return stats;
    this.device.queue.writeTexture(
      { texture },
      padRows(data, rowBytes, height, paddedRowBytes, padScratch),
      { bytesPerRow: paddedRowBytes },
      { width, height },
    );
    return stats;
  }

  private timedUploadTexture(
    texture: RuntimeGpuTexture | null,
    data: GpuUploadData,
    width: number,
    height: number,
    rowBytes: number,
    padScratch?: Uint8Array,
  ): TimedUploadStats {
    const start = performance.now();
    const stats = this.uploadTexture(texture, data, width, height, rowBytes, padScratch);
    return {
      ...stats,
      cpuMs: performance.now() - start,
    };
  }

  private uploadTextureRegion(
    texture: RuntimeGpuTexture | null,
    data: GpuUploadData,
    width: number,
    height: number,
    bytesPerRow: number,
    originX: number,
    originY: number,
    logicalRowBytes: number,
  ): UploadStats {
    const stats = {
      logicalBytes: logicalRowBytes * height,
      submittedBytes: bytesPerRow * height,
    };
    if (!this.device || !texture) return stats;
    this.device.queue.writeTexture(
      { texture, origin: { x: originX, y: originY } },
      data,
      { bytesPerRow },
      { width, height },
    );
    return stats;
  }

  private timedUploadTextureRegion(
    texture: RuntimeGpuTexture | null,
    data: GpuUploadData,
    width: number,
    height: number,
    bytesPerRow: number,
    originX: number,
    originY: number,
    logicalRowBytes: number,
  ): TimedUploadStats {
    const start = performance.now();
    const stats = this.uploadTextureRegion(texture, data, width, height, bytesPerRow, originX, originY, logicalRowBytes);
    return {
      ...stats,
      cpuMs: performance.now() - start,
    };
  }

  private refreshTotalUploadBytes(metrics: RenderBackendWebGpuComposeLiveMetrics): void {
    metrics.totalLogicalUploadBytes =
      metrics.worldWindowLogicalUploadBytes +
      metrics.lightLogicalUploadBytes +
      metrics.lutLogicalUploadBytes +
      metrics.paramsUploadBytes +
      metrics.backdropLogicalUploadBytes +
      metrics.overlayLogicalUploadBytes;
    metrics.totalSubmittedUploadBytes =
      metrics.worldWindowSubmittedUploadBytes +
      metrics.lightSubmittedUploadBytes +
      metrics.lutSubmittedUploadBytes +
      metrics.paramsUploadBytes +
      metrics.backdropSubmittedUploadBytes +
      metrics.overlaySubmittedUploadBytes;
  }

  private createPipeline(): void {
    if (!this.device) throw new Error('WebGPU live compose pipeline creation requires a GPUDevice');
    const module = this.device.createShaderModule({
      label: 'webgpu_live_compose_wgsl',
      code: createComputeShader(),
    });
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'webgpu_live_compose_bgl',
      entries: [
        { binding: 0, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'uint' } },
        { binding: 1, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 3, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 4, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'float' } },
        { binding: 5, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'float' } },
        { binding: 6, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'float' } },
        { binding: 7, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'float' } },
        { binding: 8, visibility: GPU_SHADER_STAGE_COMPUTE, texture: { sampleType: 'float' } },
        { binding: 9, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: 'read-only-storage' } },
        {
          binding: 10,
          visibility: GPU_SHADER_STAGE_COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' },
        },
      ],
    });
    this.pipeline = this.device.createComputePipeline({
      label: 'webgpu_live_compose_pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: { module, entryPoint: 'cs' },
    });
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.winTexture ||
      !this.lightTexture ||
      !this.lutTexture ||
      !this.overlayTexture ||
      !this.paramBuffer ||
      !this.storageAccess
    ) {
      throw new Error('WebGPU live compose bind group requires initialized resources');
    }
    this.bindGroup = this.device.createBindGroup({
      label: 'webgpu_live_compose_bind_group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.winTexture.createView() },
        { binding: 1, resource: this.lightTexture.createView() },
        { binding: 2, resource: this.lutTexture.createView() },
        { binding: 3, resource: this.overlayTexture.createView() },
        { binding: 4, resource: this.backdropTextures[0].texture.createView() },
        { binding: 5, resource: this.backdropTextures[1].texture.createView() },
        { binding: 6, resource: this.backdropTextures[2].texture.createView() },
        { binding: 7, resource: this.backdropTextures[3].texture.createView() },
        { binding: 8, resource: this.backdropTextures[4].texture.createView() },
        { binding: 9, resource: { buffer: this.paramBuffer } },
        { binding: 10, resource: this.storageAccess.baseMipView },
      ],
    });
  }

  private syncBackdropTextures(layers: ParallaxLayers): boolean {
    let changed = false;
    for (let i = 0; i < MAX_BACKDROP_LAYERS; i++) {
      const layer = layers.backdropLayers[i];
      const version = layer?.version ?? -1;
      if (this.backdropTextures[i]?.version === version) continue;
      this.backdropTextures[i]?.texture.destroy();
      const width = Math.max(1, layer?.width ?? 1);
      const height = Math.max(1, layer?.height ?? 1);
      const metrics = this.currentMetrics;
      const start = performance.now();
      this.backdropTextures[i] = this.createBackdropTexture(layer, i);
      if (metrics) {
        metrics.backdropTextureUploads++;
        metrics.backdropLogicalUploadBytes += width * height * 4;
        metrics.backdropSubmittedUploadBytes += align(width * 4, 256) * height;
        metrics.backdropUploadCpuMs += performance.now() - start;
      }
      changed = true;
    }
    return changed;
  }

  private updateParams(
    ctx: Ctx,
    layers: ParallaxLayers,
    lenses: readonly CompositorLens[],
    camX: number,
    camY: number,
  ): void {
    const params = this.params;
    params.fill(0);
    params[0] = camX;
    params[1] = camY;
    params[2] = camX - COMPOSE_PAD;
    params[3] = camY - COMPOSE_PAD;
    params[4] = ctx.params.global.ambient;
    params[5] = ctx.params.global.maxBrightness;
    params[6] = (ctx.state.frameCount * 0.16) % TWO_PI;
    params[7] = ctx.state.frameCount % 97;
    params[8] = (ctx.state.frameCount * 0.045) % TWO_PI;
    const dbg = window as unknown as { __composeFlickerMid?: boolean };
    params[9] = Math.random() * 4096;
    params[10] = dbg.__composeFlickerMid === true ? 1 : 0;
    params[11] = (ctx.state.frameCount * 0.035) % TWO_PI;
    params[12] = Math.min(ctx.shockwaves.length, MAX_WAVES);
    params[13] = Math.min(lenses.length, MAX_LENSES);

    const backdropProfile = resolveBackdropProfileForRuntime(ctx.params.backdrop, ctx.levels.current);
    params[14] = backdropProfile.grade.exposure;
    params[15] = backdropProfile.grade.brightness;
    params[16] = backdropProfile.grade.contrast;
    params[17] = 1 / backdropProfile.grade.gamma;
    params[18] = backdropProfile.grade.saturation;
    // Screen vignette strength, tracked live like the CPU FrameComposer / WebGL
    // ComposeShader uVignette (0.52 shipped) instead of a WGSL literal.
    params[19] = ctx.state.postFx.vignette;

    const settings = backdropProfile.layers;
    for (let i = 0; i < MAX_BACKDROP_LAYERS; i++) {
      const layer = layers.backdropLayers[i];
      const base = BACKDROP_BASE + i * BACKDROP_STRIDE;
      if (!layer) {
        params[base + 4] = 1;
        params[base + 5] = 1;
        continue;
      }
      const setting = settings[layer.id];
      params[base] = setting.speed;
      params[base + 1] = setting.opacity;
      params[base + 2] = setting.visible ? 1 : 0;
      params[base + 3] = Math.max(0.25, setting.scale);
      params[base + 4] = 1 / Math.max(1, this.backdropTextures[i].width);
      params[base + 5] = 1 / Math.max(1, this.backdropTextures[i].height);
      params[base + 6] = setting.offsetX;
      params[base + 7] = setting.offsetY;
    }

    const waveCount = Math.min(ctx.shockwaves.length, MAX_WAVES);
    for (let i = 0; i < waveCount; i++) {
      const wave = ctx.shockwaves[i];
      const base = WAVE_BASE + i * WAVE_STRIDE;
      params[base] = wave.cx;
      params[base + 1] = wave.cy;
      params[base + 2] = wave.currentRadius;
      params[base + 3] = wave.maxRadius;
      params[base + 4] = wave.strength;
    }

    const lensCount = Math.min(lenses.length, MAX_LENSES);
    for (let i = 0; i < lensCount; i++) {
      const lens = lenses[i];
      const base = LENS_BASE + i * LENS_STRIDE;
      params[base] = lens.cx;
      params[base + 1] = lens.cy;
      params[base + 2] = lens.R;
      params[base + 3] = lens.K;
    }
  }

  private uploadLight(light: LightField): void {
    // The light texture/buffer are sized from the module constants LIGHT_W/LIGHT_H;
    // assert the incoming field matches so a future LW/LH change can't silently
    // over/under-read here (the CPU ComposeShader drives off light.LW/light.LH).
    if (light.LW !== LIGHT_W || light.LH !== LIGHT_H) {
      throw new Error(
        `WebGPU live compose light-field size mismatch: expected ${LIGHT_W}x${LIGHT_H}, got ${light.LW}x${light.LH}`,
      );
    }
    const { lightR, lightG, lightB } = light;
    for (let i = 0, offset = 0; i < LIGHT_W * LIGHT_H; i++, offset += 4) {
      this.lightData[offset] = lightR[i];
      this.lightData[offset + 1] = lightG[i];
      this.lightData[offset + 2] = lightB[i];
      this.lightData[offset + 3] = 1;
    }
  }

  // Repack the bloom-weight LUT and report whether it actually changed since the
  // last call (FNV-1a over the raw weight bits), so the per-frame re-upload of a
  // table that almost never moves can be skipped (see beginFrame).
  private updateLut(materials: Record<number, MaterialParams>): boolean {
    const lut = this.lutData;
    const sigBytes = this.lutSigBytes;
    let sig = 0x811c9dc5;
    for (let type = 0; type < 256; type++) {
      const w = materials[type]?.bloomWeight ?? 0;
      lut[type] = w;
      this.lutSigScratch[0] = w;
      for (let b = 0; b < 4; b++) {
        sig = (sig ^ sigBytes[b]) >>> 0;
        sig = Math.imul(sig, 0x01000193) >>> 0;
      }
    }
    if (sig === this.lutSignature) return false;
    this.lutSignature = sig;
    return true;
  }

  private packWindowFull(world: World, camX: number, camY: number): number {
    const types = world.types;
    const colors = world.colors;
    const charge = world.charge;
    const out = this.win32;
    const x0 = camX - COMPOSE_PAD;
    const y0 = camY - COMPOSE_PAD;
    let offset = 0;
    for (let row = 0; row < WIN_H; row++) {
      let wy = y0 + row;
      if (wy < 0) wy = 0;
      else if (wy >= HEIGHT) wy = HEIGHT - 1;
      const rowBase = wy * WIDTH;
      for (let col = 0; col < WIN_W; col++) {
        let wx = x0 + col;
        if (wx < 0) wx = 0;
        else if (wx >= WIDTH) wx = WIDTH - 1;
        out[offset++] = packCellValue(types, colors, charge, rowBase + wx);
      }
    }
    return WIN_H;
  }

  private packWindowVisibleRows(world: World, camX: number, camY: number): number {
    const types = world.types;
    const colors = world.colors;
    const charge = world.charge;
    const out = this.winVisible32;
    const rowStride = this.winVisiblePaddedRowBytes >> 2;
    const startRow = COMPOSE_PAD - 1;
    const rowCount = this.winVisibleUploadRows;
    const x0 = camX;
    for (let row = 0; row < rowCount; row++) {
      let wy = camY + startRow + row - COMPOSE_PAD;
      if (wy < 0) wy = 0;
      else if (wy >= HEIGHT) wy = HEIGHT - 1;
      const rowBase = wy * WIDTH;
      let ci = rowBase + x0;
      let o = row * rowStride;
      for (let col = 0; col < VIEW_W; col++, ci++, o++) {
        let sample = ci;
        if (sample < rowBase) sample = rowBase;
        else if (sample >= rowBase + WIDTH) sample = rowBase + WIDTH - 1;
        out[o] = packCellValue(types, colors, charge, sample);
      }
    }
    return rowCount;
  }
}
