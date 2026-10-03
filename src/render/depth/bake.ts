import type { DepthKit, DepthPlaneSpec } from '@/config/depthKits';
import { buildForegroundArt } from '@/render/depth/foregroundArt';
import { buildPlaneArt } from '@/render/depth/kitArt';
import { type Bitmap, applyHaze } from '@/render/depth/raster';
import { finalizePlaneMotion } from '@/render/depth/MachineryMotion';

/**
 * Baking a depth kit: procedural planes are painted from the kit palette,
 * authored images are copied, and each gets its atmospheric perspective
 * (haze mix + kept contrast) burned in. Pure and synchronous — the async
 * image fetch lives in DepthScene; this module never touches the DOM.
 */

/** Stable per-plane seed: the kit's seed forked by slot. */
export function planeSeed(kit: DepthKit, slot: number): number {
  return (kit.seed * 2654435761 + slot * 40503) >>> 0;
}

/** Bake one plane. `image` is the decoded authored PNG for an image source (null until it loads). */
export function bakePlane(kit: DepthKit, slot: number, image: Bitmap | null): Bitmap | null {
  const spec: DepthPlaneSpec | undefined = kit.planes[slot];
  if (!spec) return null;
  let bmp: Bitmap;
  if (spec.source.kind === 'art') {
    bmp = buildPlaneArt(spec.source.art, kit.palette, spec.source.width, spec.source.height, planeSeed(kit, slot));
  } else {
    if (!image) return null;
    bmp = { width: image.width, height: image.height, pixels: new Uint8ClampedArray(image.pixels) };
  }
  const haze = spec.haze;
  if (haze.mix > 0 || haze.contrast !== 1 || (haze.saturation ?? 1) !== 1 || (haze.mist ?? 0) !== 0) {
    applyHaze(bmp, { color: kit.palette.haze, mix: haze.mix, contrast: haze.contrast, saturation: haze.saturation, mist: haze.mist });
  }
  finalizePlaneMotion(bmp, { color: kit.palette.haze, mix: haze.mix, contrast: haze.contrast, saturation: haze.saturation, mist: haze.mist });
  return bmp;
}

/** Bake the kit's foreground occluder plane (null for kits without one). */
export function bakeForeground(kit: DepthKit, levelId: string | null, planeW: number, planeH: number): Bitmap | null {
  const fg = kit.foreground;
  if (!fg) return null;
  return buildForegroundArt(fg.art, kit.palette, planeW, planeH, fg.scale, kit.seed ^ 0xf00d, levelId);
}
