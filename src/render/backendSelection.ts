import type { RenderBackendMode } from '@/core/types';
import type { ActualRenderBackend } from '@/render/pixels';

export interface BackendSelectionInput {
  requested: RenderBackendMode;
  webglAvailable: boolean;
  webgl2Available: boolean;
  navigatorGpu: boolean;
  secureContext: boolean;
  adapterAvailable: boolean;
  deviceAvailable: boolean;
  webgpuBackendAvailable: boolean;
  forceWebGL?: boolean;
  webgpuDisabled?: boolean;
  webgpuLost?: boolean;
  webgpuRecovered?: boolean;
}

export interface BackendSelectionDecision {
  actual: ActualRenderBackend;
  reason: string;
  fallback: boolean;
}

function webglActual(input: BackendSelectionInput): ActualRenderBackend {
  if (!input.webglAvailable) return 'none';
  return input.webgl2Available ? 'webgl2' : 'webgl';
}

function webglFallback(input: BackendSelectionInput, reason: string): BackendSelectionDecision {
  const actual = webglActual(input);
  return {
    actual,
    reason: actual === 'none' ? 'webgl-unavailable' : reason,
    fallback: actual !== 'none',
  };
}

export function chooseRenderBackend(input: BackendSelectionInput): BackendSelectionDecision {
  if (input.forceWebGL || input.requested === 'webgl') {
    return {
      actual: webglActual(input),
      reason: input.forceWebGL ? 'force-webgl' : 'requested-webgl',
      fallback: false,
    };
  }

  if (input.webgpuDisabled) return webglFallback(input, 'webgpu-disabled-by-user');
  if (!input.secureContext) return webglFallback(input, 'webgpu-insecure-context');
  if (!input.navigatorGpu) return webglFallback(input, 'navigator-gpu-absent');
  if (!input.adapterAvailable) return webglFallback(input, 'webgpu-adapter-unavailable');
  if (!input.deviceAvailable) return webglFallback(input, 'webgpu-device-init-failed');
  if (input.webgpuLost && !input.webgpuRecovered) return webglFallback(input, 'webgpu-device-lost');
  if (!input.webgpuBackendAvailable) return webglFallback(input, 'webgpu-backend-not-implemented');

  return {
    actual: 'webgpu',
    reason: input.webgpuRecovered ? 'webgpu-recovered' : 'webgpu-available',
    fallback: false,
  };
}

