import { VIEW_H, VIEW_W } from '@/config/constants';
import type { CameraApi } from '@/core/types';

/** Presentation pixels are independent of material cells. Fine mode exposes
 * sub-cell creature poses and source-art detail without changing world units.
 * The startup override makes identical-scene A/B measurements repeatable. */
export const PIXEL_SCALE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pixelScale') !== '1' ? 2 : 1;
export const PIXEL_W = VIEW_W * PIXEL_SCALE;
export const PIXEL_H = VIEW_H * PIXEL_SCALE;

/** The texture's origin and the quad's residual must come from the same frame.
 * Mixing an interpolated origin with the latest tick caused pixel shimmer. */
export function cameraPresentationOffset(camera: Pick<CameraApi, 'x' | 'y' | 'renderX' | 'renderY' | 'presentationX' | 'presentationY'>): { x: number; y: number } {
  return {
    x: camera.presentationX === undefined ? camera.x - Math.floor(camera.x) : camera.presentationX - camera.renderX,
    y: camera.presentationY === undefined ? camera.y - Math.floor(camera.y) : camera.presentationY - camera.renderY,
  };
}
