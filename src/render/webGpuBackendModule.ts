import type { WebGpuRenderBackend } from '@/render/WebGpuRenderBackend';
import type { RenderBackendMode } from '@/core/types';

type WebGpuBackendClass = typeof WebGpuRenderBackend;

/**
 * The WebGPU presentation backend, loaded on demand.
 *
 * The game renders with WebGL unless `?renderBackend=webgpu|auto` asks at boot
 * (render.backend is startup-only), so the WebGPU backend, its live compose and
 * `three/webgpu` (≈600 KB minified) stay out of the boot download. main.ts
 * awaits `loadWebGpuBackend()` before constructing the Game when the URL asks;
 * the Renderer reads the class synchronously from here and falls back to WebGL
 * when it is absent (never loaded, or the chunk failed to arrive).
 */
let loaded: WebGpuBackendClass | null = null;
let pending: Promise<WebGpuBackendClass | null> | null = null;

export function loadWebGpuBackend(): Promise<WebGpuBackendClass | null> {
  pending ??= import('@/render/WebGpuRenderBackend').then(
    (mod) => (loaded = mod.WebGpuRenderBackend),
    (error: unknown) => {
      console.warn('[render] the WebGPU backend could not load; presenting with WebGL', error);
      return null;
    },
  );
  return pending;
}

/** The loaded WebGPU backend class, or null (the Renderer then presents with WebGL). */
export function webGpuBackendClass(): WebGpuBackendClass | null {
  return loaded;
}

/** The boot URL's backend request (the same parameter Game reads). */
export function requestedRenderBackend(search: string): RenderBackendMode | null {
  const value = new URLSearchParams(search).get('renderBackend');
  return value === 'webgl' || value === 'webgpu' || value === 'auto' ? value : null;
}
