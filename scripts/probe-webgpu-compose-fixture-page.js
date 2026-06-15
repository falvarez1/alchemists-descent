import { DataUtils } from 'three';
import { LinearSRGBColorSpace, NoToneMapping, WebGPURenderer } from 'three/webgpu';

const WORLD_W = 1600;
const WORLD_H = 1064;
const VIEW_W = 525;
const VIEW_H = 357;
const COMPOSE_PAD = 64;
const WIN_W = VIEW_W + COMPOSE_PAD * 2;
const WIN_H = VIEW_H + COMPOSE_PAD * 2;
const LIGHT_W = (VIEW_W >> 1) + 1;
const LIGHT_H = (VIEW_H >> 1) + 1;
const VIG_CX = VIEW_W / 2;
const VIG_CY = VIEW_H / 2;
const VIG_MAXR2 = VIG_CX * VIG_CX + VIG_CY * VIG_CY;

const Cell = {
  Empty: 0,
  Water: 2,
  Lava: 11,
  Stone: 12,
  Metal: 13,
  Crystal: 29,
  Glowshroom: 33,
};

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function padRows(data, rowBytes, height, paddedRowBytes = align(rowBytes, 256)) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (rowBytes === paddedRowBytes) return bytes;
  const padded = new Uint8Array(paddedRowBytes * height);
  for (let row = 0; row < height; row++) {
    padded.set(bytes.subarray(row * rowBytes, (row + 1) * rowBytes), row * paddedRowBytes);
  }
  return padded;
}

function unpackPaddedRows(padded, rowBytes, height, paddedRowBytes = align(rowBytes, 256)) {
  if (rowBytes === paddedRowBytes) return new Uint8Array(padded);
  const out = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    out.set(padded.subarray(row * paddedRowBytes, row * paddedRowBytes + rowBytes), row * rowBytes);
  }
  return out;
}

function setHalf(data, pixelOffset, r, g, b, a) {
  const o = pixelOffset * 4;
  data[o] = DataUtils.toHalfFloat(r);
  data[o + 1] = DataUtils.toHalfFloat(g);
  data[o + 2] = DataUtils.toHalfFloat(b);
  data[o + 3] = DataUtils.toHalfFloat(a);
}

function putCell(win, x, y, type, color, charged = false) {
  const o = (y * WIN_W + x) * 4;
  win[o] = (color >> 16) & 0xff;
  win[o + 1] = (color >> 8) & 0xff;
  win[o + 2] = color & 0xff;
  win[o + 3] = type | (charged ? 0x80 : 0);
}

function fixtureCell(vx, vy) {
  if (vx < 0 || vx >= VIEW_W || vy < 0 || vy >= VIEW_H) {
    return { type: Cell.Empty, color: 0x05070c, charged: false };
  }
  if (vy > 238) return { type: Cell.Stone, color: 0x646b72, charged: false };
  if (vx >= 54 && vx <= 126 && vy >= 132 && vy <= 220) {
    return { type: Cell.Metal, color: 0x607080, charged: vx >= 82 && vx <= 112 && vy >= 164 && vy <= 190 };
  }
  if (vx >= 142 && vx <= 198 && vy >= 172 && vy <= 236) {
    return { type: Cell.Lava, color: 0xfc3c08, charged: false };
  }
  if (vx >= 226 && vx <= 268 && vy >= 118 && vy <= 202) {
    return { type: Cell.Water, color: 0x1e8ce6, charged: false };
  }
  if (((vx - 320) * (vx - 320)) / 1600 + ((vy - 178) * (vy - 178)) / 900 < 1) {
    return { type: Cell.Crystal, color: 0x7fd4e8, charged: false };
  }
  if (vx >= 388 && vx <= 430 && vy >= 184 && vy <= 236) {
    return { type: Cell.Glowshroom, color: 0x59d98f, charged: false };
  }
  return { type: Cell.Empty, color: 0x05070c, charged: false };
}

function makeWorldWindow() {
  const win = new Uint8Array(WIN_W * WIN_H * 4);
  for (let y = 0; y < WIN_H; y++) {
    for (let x = 0; x < WIN_W; x++) {
      const vx = x - COMPOSE_PAD;
      const vy = y - COMPOSE_PAD;
      const cell = fixtureCell(vx, vy);
      putCell(win, x, y, cell.type, cell.color, cell.charged);
    }
  }
  return win;
}

function makeLightField() {
  const data = new Float32Array(LIGHT_W * LIGHT_H * 4);
  for (let y = 0; y < LIGHT_H; y++) {
    for (let x = 0; x < LIGHT_W; x++) {
      const dx = x - 90;
      const dy = y - 80;
      const hot = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 80);
      const o = (y * LIGHT_W + x) * 4;
      data[o] = 0.28 + hot * 1.45 + x / LIGHT_W * 0.18;
      data[o + 1] = 0.24 + hot * 0.72 + y / LIGHT_H * 0.12;
      data[o + 2] = 0.31 + hot * 0.28;
      data[o + 3] = 1;
    }
  }
  return data;
}

function makeLut() {
  const data = new Float32Array(256);
  data[Cell.Lava] = 1.25;
  data[Cell.Crystal] = 0.8;
  data[Cell.Glowshroom] = 0.9;
  return data;
}

function makeOverlay() {
  const data = new Uint16Array(VIEW_W * VIEW_H * 4);
  for (let y = 70; y < 104; y++) {
    for (let x = 40; x < 116; x++) setHalf(data, y * VIEW_W + x, 1.0, 0.16, 0.04, 1.0);
  }
  for (let y = 120; y < 154; y++) {
    for (let x = 182; x < 310; x++) setHalf(data, y * VIEW_W + x, 0.02, 0.12, 0.42, 0.0);
  }
  return data;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function toByte(value) {
  return Math.round(clamp01(value) * 255);
}

function composePixelCpu(win, light, lut, overlay, col, rowB) {
  const vx = col;
  const vy = VIEW_H - 1 - rowB;
  const overlayOffset = (rowB * VIEW_W + col) * 4;
  const ovR = DataUtils.fromHalfFloat(overlay[overlayOffset]);
  const ovG = DataUtils.fromHalfFloat(overlay[overlayOffset + 1]);
  const ovB = DataUtils.fromHalfFloat(overlay[overlayOffset + 2]);
  const ovA = DataUtils.fromHalfFloat(overlay[overlayOffset + 3]);
  let r = 0;
  let g = 0;
  let b = 0;

  if (ovA <= 0.5) {
    const winOffset = ((vy + COMPOSE_PAD) * WIN_W + (vx + COMPOSE_PAD)) * 4;
    const typeByte = win[winOffset + 3];
    const type = typeByte & 0x7f;
    const charged = (typeByte & 0x80) !== 0;
    const li = ((vy >> 1) * LIGHT_W + (vx >> 1)) * 4;
    const lr = light[li];
    const lg = light[li + 1];
    const lb = light[li + 2];
    const dx = vx - VIG_CX;
    const dy = vy - VIG_CY;
    const vg = 1 - 0.52 * ((dx * dx + dy * dy) / VIG_MAXR2);

    if (type === Cell.Empty) {
      r = 0.004;
      g = 0.005;
      b = 0.009;
      const depthShade = 0.78 + 0.22 * (1 - (480 + vy) / WORLD_H);
      r *= depthShade;
      g *= depthShade;
      b *= depthShade;
      let lf0 = Math.min(2.2, lr) * vg;
      r = (r * 0.62 + 0.16 * 0.022) * vg + r * lf0 * lf0 * 0.72;
      lf0 = Math.min(2.2, lg) * vg;
      g = (g * 0.62 + 0.16 * 0.022) * vg + g * lf0 * lf0 * 0.72;
      lf0 = Math.min(2.2, lb) * vg;
      b = (b * 0.62 + 0.16 * 0.032) * vg + b * lf0 * lf0 * 0.72;
      r += Math.max(0, lr - 0.25) * 0.045 * vg;
      g += Math.max(0, lg - 0.25) * 0.04 * vg;
      b += Math.max(0, lb - 0.25) * 0.035 * vg;
    } else {
      r = win[winOffset] / 255;
      g = win[winOffset + 1] / 255;
      b = win[winOffset + 2] / 255;
      const scalar = lut[type] ?? 0;
      let intensity = 1 + (1.65 - 1) * scalar;
      if (charged) {
        r = 0.2;
        g = 0.75;
        b = 1.0;
        intensity = 1.65 * 1.2;
      }
      const floor = 0.06 * vg;
      const selfGlow = scalar > 0 ? 0.45 + scalar * 1.55 : 0;
      let lf = (0.16 + Math.min(2.2, lr)) * vg;
      let lit = lf * lf;
      if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
      r = r * Math.max(lit, selfGlow) + r * floor;
      lf = (0.16 + Math.min(2.2, lg)) * vg;
      lit = lf * lf;
      if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
      g = g * Math.max(lit, selfGlow) + g * floor;
      lf = (0.16 + Math.min(2.2, lb)) * vg;
      lit = lf * lf;
      if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
      b = b * Math.max(lit, selfGlow) + b * floor;
      r *= intensity;
      g *= intensity;
      b *= intensity;
    }
  }

  return [toByte(r + ovR), toByte(g + ovG), toByte(b + ovB), 255];
}

function composeReference(win, light, lut, overlay) {
  const out = new Uint8Array(VIEW_W * VIEW_H * 4);
  const start = performance.now();
  for (let rowB = 0; rowB < VIEW_H; rowB++) {
    for (let col = 0; col < VIEW_W; col++) {
      const pixel = composePixelCpu(win, light, lut, overlay, col, rowB);
      out.set(pixel, (rowB * VIEW_W + col) * 4);
    }
  }
  return { data: out, ms: performance.now() - start };
}

function compareReadback(expected, actual) {
  let exact = 0;
  let big = 0;
  let sumDelta = 0;
  let maxDelta = 0;
  const samples = [];
  for (let i = 0; i < expected.length; i += 4) {
    const d0 = Math.abs(expected[i] - actual[i]);
    const d1 = Math.abs(expected[i + 1] - actual[i + 1]);
    const d2 = Math.abs(expected[i + 2] - actual[i + 2]);
    const d3 = Math.abs(expected[i + 3] - actual[i + 3]);
    const m = Math.max(d0, d1, d2, d3);
    if (m === 0) exact++;
    if (m > 2) {
      big++;
      if (samples.length < 12) {
        const p = i / 4;
        samples.push({
          x: p % VIEW_W,
          y: Math.floor(p / VIEW_W),
          expected: Array.from(expected.slice(i, i + 4)),
          actual: Array.from(actual.slice(i, i + 4)),
        });
      }
    }
    maxDelta = Math.max(maxDelta, m);
    sumDelta += d0 + d1 + d2 + d3;
  }
  const pixels = expected.length / 4;
  return {
    exactPct: (exact / pixels) * 100,
    bigPct: (big / pixels) * 100,
    meanDelta: sumDelta / expected.length,
    maxDelta,
    samples,
  };
}

function makeOutputCanvas(readback) {
  const canvas = document.createElement('canvas');
  canvas.id = 'webgpu-compose-fixture-output';
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create 2D context for fixture output');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(readback), VIEW_W, VIEW_H), 0, 0);
  document.body.appendChild(canvas);
}

function createTexture(device, label, format, width, height, data, rowBytes) {
  const texture = device.createTexture({
    label,
    size: { width, height },
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const bytesPerRow = align(rowBytes, 256);
  device.queue.writeTexture(
    { texture },
    padRows(data, rowBytes, height, bytesPerRow),
    { bytesPerRow },
    { width, height },
  );
  return texture;
}

function createFixtureShader() {
  return `
struct Params {
  ambient: f32,
  boost: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var uWin: texture_2d<u32>;
@group(0) @binding(1) var uLight: texture_2d<f32>;
@group(0) @binding(2) var uLut: texture_2d<f32>;
@group(0) @binding(3) var uOverlay: texture_2d<f32>;
@group(0) @binding(4) var<uniform> params: Params;

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}

fn softLit(lf: f32) -> f32 {
  var lit = lf * lf;
  if (lit > 1.25) {
    lit = min(2.0, 1.25 + (lit - 1.25) * 0.3);
  }
  return lit;
}

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let col = clamp(i32(floor(fragCoord.x)), 0, ${VIEW_W - 1});
  let rowB = clamp(i32(floor(fragCoord.y)), 0, ${VIEW_H - 1});
  let vx = col;
  let vy = ${VIEW_H - 1} - rowB;
  let ov = textureLoad(uOverlay, vec2<i32>(col, rowB), 0);
  var c = vec3<f32>(0.0);

  if (ov.a <= 0.5) {
    let cell = textureLoad(uWin, vec2<i32>(vx + ${COMPOSE_PAD}, vy + ${COMPOSE_PAD}), 0);
    let typeId = i32(cell.a & 0x7fu);
    let charged = (cell.a & 0x80u) != 0u;
    let light = textureLoad(uLight, vec2<i32>(vx / 2, vy / 2), 0).rgb;
    let dx = f32(vx) - ${VIG_CX.toFixed(1)};
    let dy = f32(vy) - ${VIG_CY.toFixed(1)};
    let vg = 1.0 - 0.52 * ((dx * dx + dy * dy) / ${VIG_MAXR2.toFixed(1)});

    if (typeId == ${Cell.Empty}) {
      var r = 0.004;
      var g = 0.005;
      var b = 0.009;
      let depthShade = 0.78 + 0.22 * (1.0 - f32(480 + vy) / ${WORLD_H.toFixed(1)});
      r *= depthShade;
      g *= depthShade;
      b *= depthShade;
      var lf0 = min(2.2, light.r) * vg;
      r = (r * 0.62 + params.ambient * 0.022) * vg + r * lf0 * lf0 * 0.72;
      lf0 = min(2.2, light.g) * vg;
      g = (g * 0.62 + params.ambient * 0.022) * vg + g * lf0 * lf0 * 0.72;
      lf0 = min(2.2, light.b) * vg;
      b = (b * 0.62 + params.ambient * 0.032) * vg + b * lf0 * lf0 * 0.72;
      r += max(0.0, light.r - 0.25) * 0.045 * vg;
      g += max(0.0, light.g - 0.25) * 0.04 * vg;
      b += max(0.0, light.b - 0.25) * 0.035 * vg;
      c = vec3<f32>(r, g, b);
    } else {
      var base = vec3<f32>(f32(cell.r), f32(cell.g), f32(cell.b)) / 255.0;
      let scalar = textureLoad(uLut, vec2<i32>(typeId, 0), 0).r;
      var intensity = 1.0 + (params.boost - 1.0) * scalar;
      if (charged) {
        base = vec3<f32>(0.2, 0.75, 1.0);
        intensity = params.boost * 1.2;
      }
      let floorL = 0.06 * vg;
      let selfGlow = select(0.0, 0.45 + scalar * 1.55, scalar > 0.0);
      let lr = softLit((params.ambient + min(2.2, light.r)) * vg);
      let lg = softLit((params.ambient + min(2.2, light.g)) * vg);
      let lb = softLit((params.ambient + min(2.2, light.b)) * vg);
      c = vec3<f32>(
        base.r * max(lr, selfGlow) + base.r * floorL,
        base.g * max(lg, selfGlow) + base.g * floorL,
        base.b * max(lb, selfGlow) + base.b * floorL
      ) * intensity;
    }
  }

  return vec4<f32>(clamp(c + ov.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
}

async function runRawWgslComposeFixture(renderer) {
  const backend = renderer.backend;
  const device = backend?.device;
  if (!device) throw new Error('Three WebGPU backend did not expose a GPUDevice');

  const win = makeWorldWindow();
  const light = makeLightField();
  const lut = makeLut();
  const overlay = makeOverlay();
  const reference = composeReference(win, light, lut, overlay);

  const winTexture = createTexture(device, 'phase4_3_win_rgba8uint', 'rgba8uint', WIN_W, WIN_H, win, WIN_W * 4);
  const lightTexture = createTexture(device, 'phase4_3_light_rgba32float', 'rgba32float', LIGHT_W, LIGHT_H, light, LIGHT_W * 16);
  const lutTexture = createTexture(device, 'phase4_3_lut_r32float', 'r32float', 256, 1, lut, 256 * 4);
  const overlayTexture = createTexture(device, 'phase4_3_overlay_rgba16float', 'rgba16float', VIEW_W, VIEW_H, overlay, VIEW_W * 8);
  const outputTexture = device.createTexture({
    label: 'phase4_3_output_rgba8unorm',
    size: { width: VIEW_W, height: VIEW_H },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const outputRowBytes = VIEW_W * 4;
  const outputPaddedRowBytes = align(outputRowBytes, 256);
  const outputReadback = device.createBuffer({
    label: 'phase4_3_output_readback',
    size: outputPaddedRowBytes * VIEW_H,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const uniformBuffer = device.createBuffer({
    label: 'phase4_3_params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([0.16, 1.65, 0, 0]));

  const module = device.createShaderModule({
    label: 'phase4_3_compose_fixture_wgsl',
    code: createFixtureShader(),
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'phase4_3_compose_fixture_bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'phase4_3_compose_fixture_pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const bindGroup = device.createBindGroup({
    label: 'phase4_3_compose_fixture_bind_group',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: winTexture.createView() },
      { binding: 1, resource: lightTexture.createView() },
      { binding: 2, resource: lutTexture.createView() },
      { binding: 3, resource: overlayTexture.createView() },
      { binding: 4, resource: { buffer: uniformBuffer } },
    ],
  });

  const gpuStart = performance.now();
  const encoder = device.createCommandEncoder({ label: 'phase4_3_compose_fixture_encoder' });
  const pass = encoder.beginRenderPass({
    label: 'phase4_3_compose_fixture_pass',
    colorAttachments: [
      {
        view: outputTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: outputTexture },
    { buffer: outputReadback, bytesPerRow: outputPaddedRowBytes },
    { width: VIEW_W, height: VIEW_H },
  );
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone?.();
  await outputReadback.mapAsync(GPUMapMode.READ);
  const paddedReadback = new Uint8Array(outputReadback.getMappedRange()).slice();
  outputReadback.unmap();
  const gpuWallMs = performance.now() - gpuStart;
  const readback = unpackPaddedRows(paddedReadback, outputRowBytes, VIEW_H, outputPaddedRowBytes);
  const comparison = compareReadback(reference.data, readback);
  makeOutputCanvas(readback);

  winTexture.destroy();
  lightTexture.destroy();
  lutTexture.destroy();
  overlayTexture.destroy();
  outputTexture.destroy();
  outputReadback.destroy();
  uniformBuffer.destroy();

  return {
    status: comparison.maxDelta <= 2 && comparison.bigPct <= 0.01 ? 'passed' : 'failed',
    dimensions: {
      view: [VIEW_W, VIEW_H],
      window: [WIN_W, WIN_H],
      light: [LIGHT_W, LIGHT_H],
      outputBytesPerRow: outputRowBytes,
      outputPaddedBytesPerRow: outputPaddedRowBytes,
    },
    resourceFormats: {
      worldWindow: 'rgba8uint',
      lightField: 'rgba32float',
      bloomLut: 'r32float',
      overlay: 'rgba16float',
      output: 'rgba8unorm',
    },
    comparison,
    timings: {
      cpuReferenceMs: reference.ms,
      gpuSubmitReadbackWallMs: gpuWallMs,
    },
  };
}

async function main() {
  const canvas = document.createElement('canvas');
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  canvas.style.display = 'none';
  document.body.appendChild(canvas);

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    forceWebGL: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(VIEW_W, VIEW_H, false);
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  await renderer.init();

  const backend = renderer.backend;
  const device = backend?.device;
  const deviceFeatures = Array.from(device?.features ?? []).sort();
  const deviceLimits = {};
  for (const key of [
    'maxTextureDimension2D',
    'maxBindGroups',
    'maxSampledTexturesPerShaderStage',
    'maxSamplersPerShaderStage',
    'maxStorageTexturesPerShaderStage',
    'maxStorageBuffersPerShaderStage',
    'maxUniformBufferBindingSize',
    'maxStorageBufferBindingSize',
    'maxBufferSize',
  ]) {
    const value = device?.limits?.[key];
    if (typeof value === 'number') deviceLimits[key] = value;
  }

  const rawWgslComposeFixture = await runRawWgslComposeFixture(renderer);
  const failures = [];
  if (backend?.isWebGPUBackend !== true) failures.push('renderer did not initialize with WebGPU backend');
  if (rawWgslComposeFixture.status !== 'passed') failures.push('raw WGSL compose fixture failed parity gate');

  window.__webgpuComposeFixtureResult = {
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    backend: {
      isWebGPUBackend: backend?.isWebGPUBackend === true,
      isWebGLBackend: backend?.isWebGLBackend === true,
      deviceFeatures,
      deviceLimits,
    },
    rawWgslComposeFixture,
  };

  window.__webgpuComposeFixtureRenderer = renderer;
}

main().catch((error) => {
  window.__webgpuComposeFixtureResult = {
    status: 'failed',
    failures: [error?.message ?? String(error)],
    error: {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  };
});
