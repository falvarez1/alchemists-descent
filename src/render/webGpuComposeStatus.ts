import type {
  RenderBackendWebGpuComposeRawWgslStatus,
  RenderBackendWebGpuComposeStatus,
} from '@/render/pixels';

/**
 * The "nothing requested" compose statuses, kept apart from the bridge itself:
 * the WebGL backend reports them on every status read, and importing them from
 * WebGpuComposeBridge would drag `three/webgpu` (≈600 KB) into the boot chunk
 * of a game that renders with WebGL unless `?renderBackend=webgpu` asks.
 */
export const rawWgslUnrequestedStatus: RenderBackendWebGpuComposeRawWgslStatus = {
  status: 'unrequested',
  reason: 'webgpu-compose-raw-wgsl-write-not-requested',
  maxDelta: null,
  mismatchPct: null,
  exactPct: null,
  meanDelta: null,
  gpuSubmitReadbackWallMs: null,
};

export function webGpuComposeUnrequestedStatus(reason: string): RenderBackendWebGpuComposeStatus {
  return {
    productionAvailable: false,
    bridge: 'unrequested',
    reason,
    outputStorage: null,
    rawWgslWrite: { ...rawWgslUnrequestedStatus },
  };
}
