import type { Ctx } from '@/core/types';
import type { World } from '@/sim/World';
import type { LightField, PixelSurface } from '@/render/pixels';
import { Cell, blocksEntity } from '@/sim/CellType';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { COMPOSE_PAD } from '@/render/lightingModel';
import { blitCellArt, viewIntersects } from '@/render/sprites/FineArt';

let terrain: Uint8ClampedArray | null = null;
let props: Uint8ClampedArray | null = null;
let loading = false;
interface TerrainCache {
  colors: Uint32Array; versions: Uint32Array; dynamic: Uint32Array;
  epoch: number; tick: number; revision: number; x: number; y: number;
}
const caches = new WeakMap<World, TerrainCache>();

/** The GPU samples the same decoded pixels as the CPU fallback. */
export function terrainArtPixels(): Uint8ClampedArray | null { return terrain; }

export const terrainBlocksGlsl = Array.from({ length: 128 }, (_, type) => type)
  .filter(type => blocksEntity(type)).map(type => `t == ${type}`).join(' || ');

/** Rebuild changed visible chunks once, then preserve the renderer's tight
 * packed-color loops. Raster detail never adds a function call per GPU pixel. */
export function prepareTerrainColors(ctx: Ctx): Uint32Array {
  const world = ctx.world;
  if (!terrain || !usesTerrainArt(ctx)) return world.colors;
  const activity = world.activity, camera = ctx.camera;
  let cache = caches.get(world);
  if (!cache) {
    cache = { colors: new Uint32Array(world.colors.length), versions: new Uint32Array(activity.versions.length).fill(0xffffffff),
      dynamic: new Uint32Array(activity.rowMasks.length), epoch: -1, tick: -1, revision: -1, x: NaN, y: NaN };
    caches.set(world, cache);
  }
  if (cache.tick === ctx.state.frameCount && cache.revision === world.mutationVersion && cache.x === camera.renderX && cache.y === camera.renderY) return cache.colors;
  if (cache.epoch !== activity.epoch) { cache.versions.fill(0xffffffff); cache.epoch = activity.epoch; }
  // A freshly replaced/paused world may be edited before its first sim step.
  // Those writes advance the revision without initialized per-cell damage rows.
  if (!activity.ready && cache.revision !== world.mutationVersion) cache.versions.fill(0xffffffff);
  const x0 = Math.max(0, camera.renderX - COMPOSE_PAD) >> 6;
  const y0 = Math.max(0, camera.renderY - COMPOSE_PAD) >> 6;
  const x1 = Math.min(world.width - 1, camera.renderX + VIEW_W + COMPOSE_PAD) >> 6;
  const y1 = Math.min(world.height - 1, camera.renderY + VIEW_H + COMPOSE_PAD) >> 6;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const key = cx + cy * activity.columns;
    if (cache.versions[key] !== activity.versions[key]) {
      const fresh = cache.versions[key] === 0xffffffff;
      const left = fresh ? cx * 64 : activity.renderMinX[key], top = fresh ? cy * 64 : activity.renderMinY[key];
      const right = fresh ? Math.min(world.width, cx * 64 + 64) : activity.renderMaxX[key];
      const bottom = fresh ? Math.min(world.height, cy * 64 + 64) : activity.renderMaxY[key];
      for (let y = top; y < bottom; y++) for (let word = left >> 5; word <= (right - 1) >> 5; word++) {
        const rowIndex = y * activity.wordsPerRow + word;
        let changed = fresh ? 0xffffffff : activity.renderDirtyRows[rowIndex];
        activity.renderDirtyRows[rowIndex] = 0;
        while (changed !== 0) {
          const bitIndex = 31 - Math.clz32(changed & -changed), x = word * 32 + bitIndex;
          changed &= changed - 1;
          if (x >= world.width) continue;
          const index = x + y * world.width;
          cache.colors[index] = terrainAlbedo(world, index, x, y, true);
          const type = world.types[index];
          const bit = 1 << bitIndex;
          if (type !== Cell.Empty && type !== Cell.Wall && type !== Cell.Stone && type !== Cell.Wood && type !== Cell.Metal && type !== Cell.Water) cache.dynamic[rowIndex] |= bit;
          else cache.dynamic[rowIndex] &= ~bit;
        }
      }
      cache.versions[key] = activity.versions[key];
      activity.renderMinX[key] = 32767; activity.renderMinY[key] = 32767;
      activity.renderMaxX[key] = 0; activity.renderMaxY[key] = 0;
    }
    const endY = Math.min(world.height, cy * 64 + 64);
    for (let y = cy * 64; y < endY; y++) for (let word = cx * 2; word < Math.min(activity.wordsPerRow, cx * 2 + 2); word++) {
      let mask = cache.dynamic[y * activity.wordsPerRow + word];
      while (mask !== 0) {
        const bit = 31 - Math.clz32(mask & -mask), index = word * 32 + bit + y * world.width;
        cache.colors[index] = world.colors[index]; mask &= mask - 1;
      }
    }
  }
  for (const index of world.colorOverrides) cache.colors[index] = world.colors[index];
  cache.tick = ctx.state.frameCount; cache.revision = world.mutationVersion;
  cache.x = camera.renderX; cache.y = camera.renderY;
  return cache.colors;
}

/** Presentation assets never enter material IDs, collision, or saved cell colors. */
export function loadTerrainArt(): void {
  if (loading || typeof document === 'undefined') return;
  loading = true;
  const load = async (name: string, width: number, height: number): Promise<Uint8ClampedArray> => {
    const response = await fetch(`/assets/living-descent/${name}.png`);
    if (!response.ok) throw new Error(`Unable to load ${name}`);
    const bitmap = await createImageBitmap(await response.blob());
    if (bitmap.width !== width || bitmap.height !== height) { bitmap.close(); throw new Error(`Invalid ${name} dimensions`); }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { bitmap.close(); throw new Error('Raster surface unavailable'); }
    context.drawImage(bitmap, 0, 0); bitmap.close();
    return context.getImageData(0, 0, width, height).data;
  };
  void load('terrain-atlas', 256, 256).then(pixels => { terrain = pixels; }).catch(error => console.warn('[terrain art]', error));
  void load('props-atlas', 192, 96).then(pixels => { props = pixels; }).catch(error => console.warn('[prop art]', error));
}

export function usesTerrainArt(ctx: Ctx): boolean {
  return ctx.state.mode === 'play' && ctx.state.playtestSource !== 'builder';
}

/** Shared albedo sampler for CPU, WebGL and WebGPU. One atlas pixel per cell. */
export function terrainAlbedo(world: World, index: number, x: number, y: number, enabled: boolean): number {
  const original = world.colors[index];
  if (!enabled || !terrain) return original;
  const type = world.types[index];
  if (world.colorOverrides.has(index)) return original;
  if (type === Cell.Water) {
    const below = world.types[index + world.width];
    const exposed = y > 0 && world.types[index - world.width] === Cell.Empty
      && (below === Cell.Water || blocksEntity(below));
    // Only the immediate surface changes value. Looking three cells upward
    // exceeded the two-cell mutation halo and left stale bands as pools drained.
    return exposed ? 0x658e94 : 0x315b67;
  }
  if (type !== Cell.Wall && type !== Cell.Stone && type !== Cell.Wood && type !== Cell.Metal) return original;
  const tileX = type === Cell.Metal || (type === Cell.Stone && y > 810) ? 128 : 0;
  const tileY = type === Cell.Wood || (type === Cell.Stone && y > 810) ? 128 : 0;
  const offset = ((tileY + (y & 127)) * 256 + tileX + (x & 127)) * 4;
  let r = terrain[offset] * 1.28 + 15, g = terrain[offset + 1] * 1.28 + 20, b = terrain[offset + 2] * 1.28 + 21;
  // Chipped lips follow the actual terrain boundary, including freshly dug cuts.
  const top = y > 0 && !blocksEntity(world.types[index - world.width]);
  const left = x > 0 && !blocksEntity(world.types[index - 1]);
  const bottom = y + 1 < world.height && !blocksEntity(world.types[index + world.width]);
  if (top || left) {
    const chip = ((x * 17 + y * 29) & 7) < 2 ? 0.76 : 1;
    r = r * 0.55 + 115 * chip; g = g * 0.55 + 111 * chip; b = b * 0.55 + 94 * chip;
  } else if (bottom) { r *= 0.62; g *= 0.62; b *= 0.67; }
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}

function prop(s: PixelSurface, light: LightField, crop: readonly [number, number, number, number], x: number, y: number): void {
  const atlas = props;
  if (!atlas) return;
  const [sx, sy, width, height] = crop;
  const sample = light.sample(x + width / 2, y + height / 2);
  const r = Math.max(0.64, sample.r), g = Math.max(0.6, sample.g), b = Math.max(0.55, sample.b);
  // Bitmap props share the presentation grain through the same EPX upsample
  // as every other cell-authored sprite.
  blitCellArt(s, width, height, (px, py) => {
    const i = ((sy + py) * 192 + sx + px) * 4;
    return atlas[i + 3] < 128 ? -1 : (atlas[i] << 16) | (atlas[i + 1] << 8) | atlas[i + 2];
  }, x, y, r, g, b);
}

/** Dress real room anchors behind bodies; these pixels never imply a new collider. */
export function drawWorksLandmarks(s: PixelSurface, light: LightField, ctx: Ctx): void {
  if (!ctx.levels.current?.living) return;
  // Cull against the composed view's real rectangle. The old test measured
  // from the camera's top-left corner, so a prop in the right quarter or the
  // bottom of the view popped out of existence as the player approached it.
  const camera = ctx.camera;
  const visible = (x0: number, y0: number, x1: number, y1: number): boolean => viewIntersects(camera, x0, y0, x1, y1);
  // The sluice handwheel is the dressed lever itself (MechanismSprites).
  if (visible(809, 688, 905, 744)) prop(s, light, [48, 24, 96, 56], 809, 688);
  for (const x of [1180, 1315, 1450]) if (visible(x - 12, 560, x + 20, 584)) prop(s, light, [152, 56, 32, 24], x - 12, 560);
}
