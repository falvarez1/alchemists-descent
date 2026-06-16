import { NearestFilter, StorageTexture, WebGPURenderer } from 'three/webgpu';
import { Fn, instanceIndex, textureStore, uint, uvec2, vec4 } from 'three/tsl';

import { VIEW_H, VIEW_W } from '@/config/constants';
import type {
  RenderBackendWebGpuComposeRawWgslStatus,
  RenderBackendWebGpuComposeStatus,
} from '@/render/pixels';
import {
  resolveThreeStorageTextureAccess,
  type WebGpuStorageTextureAccess,
  type WebGpuTextureLike,
} from '@/render/WebGpuStorageTextureAccess';

interface RuntimeGpuBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface RuntimeGpuDevice {
  queue: {
    submit(commandBuffers: unknown[]): void;
    onSubmittedWorkDone?(): Promise<void>;
  };
  createShaderModule(descriptor: { label: string; code: string }): unknown;
  createBindGroupLayout(descriptor: {
    label: string;
    entries: unknown[];
  }): unknown;
  createPipelineLayout(descriptor: { bindGroupLayouts: unknown[] }): unknown;
  createComputePipeline(descriptor: {
    label: string;
    layout: unknown;
    compute: { module: unknown; entryPoint: string };
  }): unknown;
  createBindGroup(descriptor: {
    label: string;
    layout: unknown;
    entries: unknown[];
  }): unknown;
  createBuffer(descriptor: { label: string; size: number; usage: number }): RuntimeGpuBuffer;
  createCommandEncoder(descriptor: { label: string }): RuntimeCommandEncoder;
}

interface RuntimeCommandEncoder {
  beginComputePass(descriptor: { label: string }): RuntimeComputePass;
  copyTextureToBuffer(
    source: { texture: RuntimeGpuTexture },
    destination: { buffer: RuntimeGpuBuffer; bytesPerRow: number },
    copySize: { width: number; height: number },
  ): void;
  finish(): unknown;
}

interface RuntimeComputePass {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(workgroupCountX: number, workgroupCountY?: number, workgroupCountZ?: number): void;
  end(): void;
}

type RuntimeGpuTexture = WebGpuTextureLike;

interface RendererDeviceProbe {
  backend?: {
    device?: RuntimeGpuDevice;
  };
}

const GPU_SHADER_STAGE_COMPUTE = 0x4;
const GPU_TEXTURE_USAGE_COPY_SRC = 0x01;
const GPU_BUFFER_USAGE_MAP_READ = 0x1;
const GPU_BUFFER_USAGE_COPY_DST = 0x8;
const GPU_MAP_MODE_READ = 0x1;
const RAW_WGSL_ROW_BYTES = VIEW_W * 4;
const RAW_WGSL_PADDED_ROW_BYTES = align(RAW_WGSL_ROW_BYTES, 256);

const rawWgslUnrequestedStatus: RenderBackendWebGpuComposeRawWgslStatus = {
  status: 'unrequested',
  reason: 'webgpu-compose-raw-wgsl-write-not-requested',
  maxDelta: null,
  mismatchPct: null,
  exactPct: null,
  meanDelta: null,
  gpuSubmitReadbackWallMs: null,
};

function makeStorageInitCompute(storageTexture: StorageTexture) {
  return Fn(() => {
    const x = instanceIndex.mod(uint(VIEW_W));
    const y = instanceIndex.div(uint(VIEW_W));
    textureStore(storageTexture, uvec2(x, y), vec4(0, 0, 0, 1)).toWriteOnly();
  })()
    .compute(VIEW_W * VIEW_H, [64])
    .setName('WebGPU Runtime Compose Storage Init');
}

function cloneStatus(status: RenderBackendWebGpuComposeStatus): RenderBackendWebGpuComposeStatus {
  return {
    ...status,
    outputStorage: status.outputStorage ? { ...status.outputStorage } : null,
    rawWgslWrite: { ...status.rawWgslWrite },
  };
}

function rendererQueueWorkDone(renderer: WebGPURenderer): Promise<void> | undefined {
  return (renderer as RendererDeviceProbe).backend?.device?.queue?.onSubmittedWorkDone?.();
}

function rendererDevice(renderer: WebGPURenderer): RuntimeGpuDevice | null {
  return (renderer as RendererDeviceProbe).backend?.device ?? null;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function unpackPaddedRows(padded: Uint8Array, rowBytes: number, height: number, paddedRowBytes: number): Uint8Array {
  if (rowBytes === paddedRowBytes) return new Uint8Array(padded);
  const out = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    out.set(padded.subarray(row * paddedRowBytes, row * paddedRowBytes + rowBytes), row * rowBytes);
  }
  return out;
}

function rawWgslExpectedByte(x: number, y: number, channel: number): number {
  if (channel === 0) return x & 0xff;
  if (channel === 1) return y & 0xff;
  if (channel === 2) return (x + y) & 0xff;
  return 255;
}

function compareRawWgslReadback(readback: Uint8Array): Omit<
  RenderBackendWebGpuComposeRawWgslStatus,
  'status' | 'reason' | 'gpuSubmitReadbackWallMs'
> {
  let maxDelta = 0;
  let mismatches = 0;
  let exact = 0;
  let sumDelta = 0;
  for (let y = 0; y < VIEW_H; y++) {
    for (let x = 0; x < VIEW_W; x++) {
      const pixel = (y * VIEW_W + x) * 4;
      let pixelExact = true;
      let pixelMismatch = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(readback[pixel + channel] - rawWgslExpectedByte(x, y, channel));
        maxDelta = Math.max(maxDelta, delta);
        sumDelta += delta;
        if (delta !== 0) pixelExact = false;
        if (delta > 1) pixelMismatch = true;
      }
      if (pixelExact) exact++;
      if (pixelMismatch) mismatches++;
    }
  }
  const pixels = VIEW_W * VIEW_H;
  return {
    maxDelta,
    mismatchPct: pixels === 0 ? 0 : (mismatches / pixels) * 100,
    exactPct: pixels === 0 ? 0 : (exact / pixels) * 100,
    meanDelta: readback.length === 0 ? 0 : sumDelta / readback.length,
  };
}

function createRawWgslWriteShader(): string {
  return `
@group(0) @binding(0) var uOutput: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.x >= ${VIEW_W}u || globalId.y >= ${VIEW_H}u) {
    return;
  }
  let r = f32(globalId.x & 255u) / 255.0;
  let g = f32(globalId.y & 255u) / 255.0;
  let b = f32((globalId.x + globalId.y) & 255u) / 255.0;
  textureStore(uOutput, vec2<i32>(i32(globalId.x), i32(globalId.y)), vec4<f32>(r, g, b, 1.0));
}
`;
}

/**
 * Dev/probe-only runtime bridge for the future WebGPU compose path. It proves
 * the live WebGpuRenderBackend can allocate a Three StorageTexture, make Three
 * own it through TSL compute, and resolve the guarded raw GPUTexture access.
 */
export class WebGpuComposeBridge {
  private readonly outputTexture: StorageTexture;
  private storageAccess: WebGpuStorageTextureAccess | null = null;
  private status: RenderBackendWebGpuComposeStatus = {
    productionAvailable: false,
    bridge: 'initializing',
    reason: 'webgpu-compose-runtime-bridge-created',
    outputStorage: null,
    rawWgslWrite: { ...rawWgslUnrequestedStatus },
  };

  constructor(private readonly renderer: WebGPURenderer) {
    this.outputTexture = new StorageTexture(VIEW_W, VIEW_H);
    this.outputTexture.name = 'webgpu_runtime_compose_output';
    this.outputTexture.minFilter = NearestFilter;
    this.outputTexture.magFilter = NearestFilter;
    this.outputTexture.generateMipmaps = false;
    (this.outputTexture as StorageTexture & { mipmapsAutoUpdate?: boolean }).mipmapsAutoUpdate = false;
  }

  async initialize(): Promise<RenderBackendWebGpuComposeStatus> {
    if (this.status.bridge === 'validated' || this.status.bridge === 'failed') {
      return this.getStatus();
    }

    try {
      const computeResult = this.renderer.compute(makeStorageInitCompute(this.outputTexture));
      if (computeResult) await computeResult;
      await rendererQueueWorkDone(this.renderer);
      const access = resolveThreeStorageTextureAccess(this.renderer, this.outputTexture, {
        expectedFormat: 'rgba8unorm',
        expectedWidth: VIEW_W,
        expectedHeight: VIEW_H,
        expectedMipLevelCount: 1,
        label: 'webgpu_runtime_compose_output',
      });
      this.storageAccess = access;

      this.status = {
        productionAvailable: false,
        bridge: 'validated',
        reason: 'webgpu-compose-runtime-bridge-validated-compose-disabled-until-parity-and-timing-gates',
        outputStorage: {
          format: access.format,
          width: access.descriptor.width,
          height: access.descriptor.height,
          mipLevelCount: access.descriptor.mipLevelCount,
          usage: access.descriptor.usage,
          source: access.source,
        },
        rawWgslWrite: { ...rawWgslUnrequestedStatus },
      };
    } catch (error) {
      this.storageAccess = null;
      this.status = {
        productionAvailable: false,
        bridge: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        outputStorage: null,
        rawWgslWrite: { ...rawWgslUnrequestedStatus },
      };
    }

    return this.getStatus();
  }

  async validateRawWgslWrite(): Promise<RenderBackendWebGpuComposeRawWgslStatus> {
    if (this.status.bridge !== 'validated' || !this.storageAccess) {
      this.status.rawWgslWrite = {
        status: 'failed',
        reason: 'webgpu-compose-raw-wgsl-write-requires-validated-storage-bridge',
        maxDelta: null,
        mismatchPct: null,
        exactPct: null,
        meanDelta: null,
        gpuSubmitReadbackWallMs: null,
      };
      return { ...this.status.rawWgslWrite };
    }

    const device = rendererDevice(this.renderer);
    if (!device) {
      this.status.rawWgslWrite = {
        status: 'failed',
        reason: 'webgpu-compose-raw-wgsl-write-requires-gpu-device',
        maxDelta: null,
        mismatchPct: null,
        exactPct: null,
        meanDelta: null,
        gpuSubmitReadbackWallMs: null,
      };
      return { ...this.status.rawWgslWrite };
    }
    const usage = this.storageAccess.descriptor.usage;
    if (usage === null || (usage & GPU_TEXTURE_USAGE_COPY_SRC) === 0) {
      this.status.rawWgslWrite = {
        status: 'failed',
        reason: 'webgpu-compose-raw-wgsl-write-requires-copy-src-storage-texture',
        maxDelta: null,
        mismatchPct: null,
        exactPct: null,
        meanDelta: null,
        gpuSubmitReadbackWallMs: null,
      };
      return { ...this.status.rawWgslWrite };
    }

    const outputReadback = device.createBuffer({
      label: 'webgpu_runtime_compose_raw_wgsl_output_readback',
      size: RAW_WGSL_PADDED_ROW_BYTES * VIEW_H,
      usage: GPU_BUFFER_USAGE_COPY_DST | GPU_BUFFER_USAGE_MAP_READ,
    });

    try {
      const module = device.createShaderModule({
        label: 'webgpu_runtime_compose_raw_wgsl_write',
        code: createRawWgslWriteShader(),
      });
      const bindGroupLayout = device.createBindGroupLayout({
        label: 'webgpu_runtime_compose_raw_wgsl_write_bgl',
        entries: [
          {
            binding: 0,
            visibility: GPU_SHADER_STAGE_COMPUTE,
            storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' },
          },
        ],
      });
      const pipeline = device.createComputePipeline({
        label: 'webgpu_runtime_compose_raw_wgsl_write_pipeline',
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module, entryPoint: 'cs' },
      });
      const bindGroup = device.createBindGroup({
        label: 'webgpu_runtime_compose_raw_wgsl_write_bind_group',
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: this.storageAccess.baseMipView }],
      });

      const gpuStart = performance.now();
      const encoder = device.createCommandEncoder({ label: 'webgpu_runtime_compose_raw_wgsl_write_encoder' });
      const pass = encoder.beginComputePass({ label: 'webgpu_runtime_compose_raw_wgsl_write_pass' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(VIEW_W / 8), Math.ceil(VIEW_H / 8));
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: this.storageAccess.texture },
        { buffer: outputReadback, bytesPerRow: RAW_WGSL_PADDED_ROW_BYTES },
        { width: VIEW_W, height: VIEW_H },
      );
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone?.();
      await outputReadback.mapAsync(GPU_MAP_MODE_READ);
      const paddedReadback = new Uint8Array(outputReadback.getMappedRange()).slice();
      outputReadback.unmap();
      const gpuSubmitReadbackWallMs = performance.now() - gpuStart;
      const readback = unpackPaddedRows(
        paddedReadback,
        RAW_WGSL_ROW_BYTES,
        VIEW_H,
        RAW_WGSL_PADDED_ROW_BYTES,
      );
      const comparison = compareRawWgslReadback(readback);
      const passed = comparison.maxDelta === 0 && comparison.mismatchPct === 0;
      this.status.rawWgslWrite = {
        status: passed ? 'validated' : 'failed',
        reason: passed
          ? 'webgpu-compose-raw-wgsl-write-validated-compose-disabled-until-parity-and-timing-gates'
          : 'webgpu-compose-raw-wgsl-write-readback-mismatched-expected-pattern',
        ...comparison,
        gpuSubmitReadbackWallMs,
      };
    } catch (error) {
      this.status.rawWgslWrite = {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        maxDelta: null,
        mismatchPct: null,
        exactPct: null,
        meanDelta: null,
        gpuSubmitReadbackWallMs: null,
      };
    } finally {
      outputReadback.destroy();
    }

    return { ...this.status.rawWgslWrite };
  }

  getStatus(): RenderBackendWebGpuComposeStatus {
    return cloneStatus(this.status);
  }

  dispose(): void {
    this.outputTexture.dispose();
  }
}

export function webGpuComposeUnrequestedStatus(reason: string): RenderBackendWebGpuComposeStatus {
  return {
    productionAvailable: false,
    bridge: 'unrequested',
    reason,
    outputStorage: null,
    rawWgslWrite: { ...rawWgslUnrequestedStatus },
  };
}
