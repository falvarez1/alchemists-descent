import type { Ctx } from '@/core/types';
import type { World } from '@/sim/World';
import type { LightField, PixelSurface } from '@/render/pixels';
import { Cell, blocksEntity, isLiquid } from '@/sim/CellType';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { COMPOSE_PAD } from '@/render/lightingModel';
import { blitCellArt, viewIntersects } from '@/render/sprites/FineArt';
import {
  FLOOR_LOOKS, crownReach, dripReach, floorLookFor, lipSpeck, masonryPanel, type FloorLook, type NaturalLook,
} from '@/config/floorLooks';
import { FLOOR_SHEET, FLOOR_TILE, floorTilePixels } from '@/render/floorTiles';
import {
  ART_AIR_MASK, ART_BUILT_BIT, ART_DEPTH_MASK, ART_LOOSE_BIT, ART_POCKET_BIT, ART_SOLID_BIT, existingTerrainArtPlane, terrainArtPlane, type ArtZone, type TerrainArtPlane,
} from '@/render/terrainArtPlane';

let terrain: Uint8ClampedArray | null = null;
let props: Uint8ClampedArray | null = null;
let loading = false;
interface TerrainCache {
  colors: Uint32Array; versions: Uint32Array; dynamic: Uint32Array;
  epoch: number; tick: number; revision: number; x: number; y: number; look: FloorLook | null;
  plane: TerrainArtPlane | null; planeRevision: number;
}
const caches = new WeakMap<World, TerrainCache>();

/** The GPU samples the same decoded pixels as the CPU fallback. */
export function terrainArtPixels(): Uint8ClampedArray | null { return terrain; }

export const terrainBlocksGlsl = Array.from({ length: 128 }, (_, type) => type)
  .filter(type => blocksEntity(type)).map(type => `t == ${type}`).join(' || ');

/**
 * Cells a natural-look face is OPEN to (air, gas, fire, soft growth): lips,
 * crowns and underside streaks form against these. Liquids and powders sit ON
 * a face and cover it, so water-filled pores never outline themselves.
 */
const OPEN = new Uint8Array(256);
for (let t = 0; t < 256; t++) OPEN[t] = !blocksEntity(t) && !isLiquid(t) ? 1 : 0;
/** What lies beyond a water-facing cell for the face to count as wet (a body, not a pore). */
const WET_BODY = new Uint8Array(256);
for (let t = 0; t < 256; t++) WET_BODY[t] = OPEN[t] || t === Cell.Water ? 1 : 0;
/** The OPEN table as two 32-bit masks (ids 0–63) for the shader port. */
export const terrainOpenMask: readonly [number, number] = [openWord(0), openWord(1)];
function openWord(word: number): number {
  let mask = 0;
  for (let bit = 0; bit < 32; bit++) if (OPEN[word * 32 + bit]) mask |= 1 << bit;
  return mask >>> 0;
}

/**
 * The art plane the compositors dress this frame's terrain with, synced
 * around the padded view — or null for classic looks (the hand-built Works,
 * off-spine floors, the sandbox and Builder playtests).
 */
export function activeArtPlane(ctx: Ctx): TerrainArtPlane | null {
  if (!terrain || !usesTerrainArt(ctx) || !naturalEnabled) return null;
  const natural = floorLookFor(ctx).natural;
  if (!natural) return null;
  const plane = terrainArtPlane(ctx.world, { builtRun: natural.builtRun, lining: natural.lining, zones: artZones(ctx) });
  const camera = ctx.camera;
  plane.sync(camera.renderX - COMPOSE_PAD, camera.renderY - COMPOSE_PAD,
    camera.renderX + VIEW_W + COMPOSE_PAD, camera.renderY + VIEW_H + COMPOSE_PAD);
  return plane;
}

/** Dev-only A/B switch for probes (the shape-aware dressing vs the classic sampler). */
let naturalEnabled = true;

const NO_ZONES: readonly ArtZone[] = [];
const zoneCache = new WeakMap<object, readonly ArtZone[]>();

/**
 * Authored footprints whose faces are built: placed prefabs (machine rooms,
 * vaults, shrines, galleries — not the organic encounter lairs) and the boss
 * arena around its seat (world/structures.ts: the Kiln and the Sump).
 */
function artZones(ctx: Ctx): readonly ArtZone[] {
  const runtime = ctx.levels.current;
  if (!runtime) return NO_ZONES;
  const cached = zoneCache.get(runtime);
  if (cached) return cached;
  const zones: ArtZone[] = [];
  for (const prefab of runtime.placedPrefabs ?? []) {
    if (prefab.id.startsWith('encounter-lair')) continue;
    zones.push({ x0: prefab.x0, y0: prefab.y0, x1: prefab.x1, y1: prefab.y1 });
  }
  const boss = runtime.boss;
  if (boss) {
    zones.push(boss.kind === 'leviathan'
      ? { x0: boss.x - 46, y0: boss.y - 54, x1: boss.x + 46, y1: boss.y + 12 }
      : { x0: boss.x - 44, y0: boss.y - 48, x1: boss.x + 44, y1: boss.y + 12 });
  }
  zoneCache.set(runtime, zones);
  return zones;
}

/** Rebuild changed visible chunks once, then preserve the renderer's tight
 * packed-color loops. Raster detail never adds a function call per GPU pixel. */
export function prepareTerrainColors(ctx: Ctx): Uint32Array {
  const world = ctx.world;
  if (!terrain || !usesTerrainArt(ctx)) return world.colors;
  const activity = world.activity, camera = ctx.camera;
  let cache = caches.get(world);
  if (!cache) {
    cache = { colors: new Uint32Array(world.colors.length), versions: new Uint32Array(activity.versions.length).fill(0xffffffff),
      dynamic: new Uint32Array(activity.rowMasks.length), epoch: -1, tick: -1, revision: -1, x: NaN, y: NaN, look: null,
      plane: null, planeRevision: -1 };
    caches.set(world, cache);
  }
  const look = floorLookFor(ctx);
  // The plane syncs BEFORE the damage loop so re-shaded cells read fresh depth.
  const plane = activeArtPlane(ctx);
  if (cache.tick === ctx.state.frameCount && cache.revision === world.mutationVersion && cache.x === camera.renderX
    && cache.y === camera.renderY && cache.look === look && cache.plane === plane
    && (!plane || cache.planeRevision === plane.revision)) return cache.colors;
  if (cache.epoch !== activity.epoch || cache.look !== look || cache.plane !== plane) {
    cache.versions.fill(0xffffffff); cache.epoch = activity.epoch; cache.look = look;
    cache.plane = plane; cache.planeRevision = plane ? plane.revision : -1;
    plane?.takeDirty();
  }
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
          cache.colors[index] = terrainAlbedo(world, index, x, y, true, look, plane);
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
  // A re-derived art rect re-shades every cached chunk it touches (depth and
  // air distance reach past the two-cell render damage halo).
  if (plane && cache.planeRevision !== plane.revision) {
    cache.planeRevision = plane.revision;
    for (const rect of plane.takeDirty()) {
      for (let cy = rect.y0 >> 6; cy <= (rect.y1 - 1) >> 6; cy++) for (let cx = rect.x0 >> 6; cx <= (rect.x1 - 1) >> 6; cx++) {
        if (cache.versions[cx + cy * activity.columns] === 0xffffffff) continue;
        const left = Math.max(rect.x0, cx * 64), right = Math.min(rect.x1, cx * 64 + 64);
        const top = Math.max(rect.y0, cy * 64), bottom = Math.min(rect.y1, cy * 64 + 64);
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const index = x + y * world.width;
          cache.colors[index] = terrainAlbedo(world, index, x, y, true, look, plane);
        }
      }
    }
  }
  for (const index of world.colorOverrides) cache.colors[index] = world.colors[index];
  cache.tick = ctx.state.frameCount; cache.revision = world.mutationVersion;
  cache.x = camera.renderX; cache.y = camera.renderY;
  return cache.colors;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // In-page probe handle (never in production builds): the art plane of a world.
  (window as unknown as { __terrainArt?: unknown }).__terrainArt = {
    planeFor: (world: World): Uint8Array | null => caches.get(world)?.plane?.data ?? existingPlane(world),
    setNatural: (on: boolean): void => { naturalEnabled = on; },
    stats: (world: World): { scans: number; regions: number; cells: number; syncMs: number } | null =>
      existingTerrainArtPlane(world)?.stats ?? null,
    rebuildMs: (world: World): number => {
      const plane = existingTerrainArtPlane(world);
      if (!plane) return -1;
      const start = performance.now();
      plane.buildAll();
      return performance.now() - start;
    },
  };
}
function existingPlane(world: World): Uint8Array | null { return existingTerrainArtPlane(world)?.data ?? null; }

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

/** The floor look the compositors grade with: identity outside expedition play. */
export function activeFloorLook(ctx: Ctx): FloorLook {
  return usesTerrainArt(ctx) ? floorLookFor(ctx) : FLOOR_LOOKS.earthen;
}

/**
 * Shared albedo sampler for CPU and WebGPU (the WebGL2 compose shader ports it
 * formula-for-formula). One atlas pixel per cell. The floor look grades the
 * shared material kit per floor; the earthen look is the shipped identity.
 */
export function terrainAlbedo(world: World, index: number, x: number, y: number, enabled: boolean,
  look: FloorLook = FLOOR_LOOKS.earthen, plane: TerrainArtPlane | null = null): number {
  const original = world.colors[index];
  if (!enabled || !terrain) return original;
  const type = world.types[index];
  if (world.colorOverrides.has(index)) return original;
  if (look.natural && plane) return naturalAlbedo(world, plane, index, x, y, look, look.natural, terrain);
  if (type === Cell.Water) {
    const below = world.types[index + world.width];
    const exposed = y > 0 && world.types[index - world.width] === Cell.Empty
      && (below === Cell.Water || blocksEntity(below));
    // Only the immediate surface changes value. Looking three cells upward
    // exceeded the two-cell mutation halo and left stale bands as pools drained.
    const water = exposed ? look.waterSurface : look.waterBody;
    return (water[0] << 16) | (water[1] << 8) | water[2];
  }
  if (type !== Cell.Wall && type !== Cell.Stone && type !== Cell.Wood && type !== Cell.Metal) return original;
  const panels = look.masonryPanels;
  const rock = type === Cell.Stone ? y > look.rockRow
    : type === Cell.Wall && panels < 16 && !masonryPanel(x >> 6, y >> 6, panels);
  const tileX = type === Cell.Metal || rock ? 128 : 0;
  const tileY = type === Cell.Wood || rock ? 128 : 0;
  const offset = ((tileY + (y & 127)) * 256 + tileX + (x & 127)) * 4;
  const gain = look.gain, lift = look.lift;
  let r = terrain[offset] * gain[0] + lift[0], g = terrain[offset + 1] * gain[1] + lift[1], b = terrain[offset + 2] * gain[2] + lift[2];
  // A masonry panel set into rock is framed by a dark mortar course.
  if (type === Cell.Wall && !rock && panels < 16 && panelSeam(x, y, panels)) { r *= 0.55; g *= 0.55; b *= 0.58; }
  const width = world.width, types = world.types;
  // Crown: the floor's growth/stain creeps a jagged few cells down from each
  // exposed top (three cells at most: the renderer's dirty halo is two).
  if (look.crownStrength > 0 && (type === Cell.Wall || type === Cell.Stone)) {
    const reach = crownReach(x, look.crownDepth);
    for (let k = 1; k <= reach && y - k >= 0; k++) {
      if (blocksEntity(types[index - k * width])) continue;
      const w = look.crownStrength * (1 - (k - 1) / reach);
      r *= 1 + w * (look.crown[0] / 128 - 1); g *= 1 + w * (look.crown[1] / 128 - 1); b *= 1 + w * (look.crown[2] / 128 - 1);
      break;
    }
  }
  // Chipped lips follow the actual terrain boundary, including freshly dug cuts.
  const top = y > 0 && !blocksEntity(types[index - width]);
  const left = x > 0 && !blocksEntity(types[index - 1]);
  const bottom = y + 1 < world.height && !blocksEntity(types[index + width]);
  if (top || left) {
    const chip = ((x * 17 + y * 29) & 7) < 2 ? 0.76 : 1;
    const lip = look.lip;
    r = r * 0.55 + lip[0] * chip; g = g * 0.55 + lip[1] * chip; b = b * 0.55 + lip[2] * chip;
  } else if (bottom) { r *= look.under[0]; g *= look.under[1]; b *= look.under[2]; }
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}

/**
 * Backdrop contact shade next to terrain (0–1): darkest against a face,
 * easing to none at contactReach cells. ComposeShader ports this exactly.
 */
export function contactShade(air: number, natural: NaturalLook): number {
  const s = Math.min(1, Math.max(0, (air - 1) / Math.max(1, natural.contactReach - 1)));
  return natural.contact + (1 - natural.contact) * s * s * (3 - 2 * s);
}

function smooth(edge0: number, edge1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The shape-aware sampler (floor looks with `natural`): built faces wear the
 * atlas masonry, the rest this floor's natural rock tile; cores sink by
 * depth; tops carry a lip, a crown and sparse lit flecks; undersides streak;
 * the shadow side falls off. Empty cells return the backdrop contact shade in
 * the red byte (the CPU and WebGPU backdrops read it; nothing else reads an
 * Empty cell's cached colour). ComposeShader ports this at half-cell grain.
 */
function naturalAlbedo(world: World, plane: TerrainArtPlane, index: number, x: number, y: number,
  look: FloorLook, natural: NaturalLook, atlas: Uint8ClampedArray): number {
  const types = world.types, width = world.width, type = types[index];
  const art = plane.data[index];
  if (type === Cell.Empty) {
    // A byte still classed solid/loose (a class change awaiting re-derivation) sits against a face.
    const air = art & (ART_SOLID_BIT | ART_LOOSE_BIT) ? 1 : art & ART_AIR_MASK;
    return Math.round(contactShade(air, natural) * 255) << 16;
  }
  if (type === Cell.Water) {
    const below = types[index + width];
    const exposed = y > 0 && types[index - width] === Cell.Empty && (below === Cell.Water || blocksEntity(below));
    // A sealed pocket (a pore in a flooded wall) stays part of the rock mass.
    const pocket = (art & (ART_SOLID_BIT | ART_LOOSE_BIT | ART_POCKET_BIT)) === (ART_LOOSE_BIT | ART_POCKET_BIT);
    const water = exposed ? look.waterSurface : pocket ? natural.waterPocket ?? look.waterBody : look.waterBody;
    return (water[0] << 16) | (water[1] << 8) | water[2];
  }
  if (type !== Cell.Wall && type !== Cell.Stone && type !== Cell.Wood && type !== Cell.Metal) return world.colors[index];
  const solid = (art & ART_SOLID_BIT) !== 0;
  const depth = solid ? art & ART_DEPTH_MASK : 1;
  const built = solid && (art & ART_BUILT_BIT) !== 0;
  let r: number, g: number, b: number, grain: number;
  if (type === Cell.Wood || type === Cell.Metal || built) {
    const tileX = type === Cell.Metal ? 128 : 0, tileY = type === Cell.Wood ? 128 : 0;
    const offset = ((tileY + (y & 127)) * 256 + tileX + (x & 127)) * 4;
    grain = (atlas[offset] + atlas[offset + 1] + atlas[offset + 2]) / 765;
    r = atlas[offset] * look.gain[0] + look.lift[0];
    g = atlas[offset + 1] * look.gain[1] + look.lift[1];
    b = atlas[offset + 2] * look.gain[2] + look.lift[2];
  } else {
    // The fine WebGL path shows all four texels of a cell; one colour per cell
    // averages them (and keeps the strongest feature texel).
    const tiles = floorTilePixels();
    const ox = (natural.tile & 1) * FLOOR_TILE, oy = (natural.tile >> 1) * FLOOR_TILE;
    const tx = (x * 2) & (FLOOR_TILE - 1), ty = (y * 2) & (FLOOR_TILE - 1);
    const o0 = ((oy + ty) * FLOOR_SHEET + ox + tx) * 4, o1 = o0 + FLOOR_SHEET * 4;
    r = (tiles[o0] + tiles[o0 + 4] + tiles[o1] + tiles[o1 + 4]) * 0.25;
    g = (tiles[o0 + 1] + tiles[o0 + 5] + tiles[o1 + 1] + tiles[o1 + 5]) * 0.25;
    b = (tiles[o0 + 2] + tiles[o0 + 6] + tiles[o1 + 2] + tiles[o1 + 6]) * 0.25;
    const mask = Math.max(tiles[o0 + 3], tiles[o0 + 7], tiles[o1 + 3], tiles[o1 + 7]) / 255;
    grain = (r + g + b) / 765;
    r = r * natural.rockGain[0] + natural.rockLift[0];
    g = g * natural.rockGain[1] + natural.rockLift[1];
    b = b * natural.rockGain[2] + natural.rockLift[2];
    if (mask > 0) {
      const window = Math.min(1, Math.max(0, (depth - natural.featureNear + 1) / 2))
        * Math.min(1, Math.max(0, (natural.featureFar - depth) / 4));
      const heat = natural.featureTop + (1 - natural.featureTop) * (y / world.height);
      const w = mask * natural.featureStrength * window * heat;
      r += (natural.feature[0] - r) * w; g += (natural.feature[1] - g) * w; b += (natural.feature[2] - b) * w;
    }
  }
  // Inset: cores sink toward the floor's core tone, in pixel-art steps whose
  // edges wander with the texture (lighter texels hold the light a little longer).
  let sink = smooth(natural.aoNear, natural.aoFar, depth - (grain - 0.16) * natural.aoGrain);
  if (natural.aoSteps > 0) sink = Math.round(sink * natural.aoSteps) / natural.aoSteps;
  r *= 1 + (natural.aoCore[0] - 1) * sink; g *= 1 + (natural.aoCore[1] - 1) * sink; b *= 1 + (natural.aoCore[2] - 1) * sink;
  // Crown: growth, silt or ash creeping down from an open top (three cells at most).
  if (look.crownStrength > 0) {
    const reach = crownReach(x, look.crownDepth);
    for (let k = 1; k <= reach && y - k >= 0; k++) {
      if (!OPEN[types[index - k * width]]) continue;
      const w = look.crownStrength * (1 - (k - 1) / reach);
      r *= 1 + w * (look.crown[0] / 128 - 1); g *= 1 + w * (look.crown[1] / 128 - 1); b *= 1 + w * (look.crown[2] / 128 - 1);
      break;
    }
  }
  // Underside: a streaked band hanging from any face open below.
  const drip = dripReach(x);
  for (let k = 1; k <= drip && y + k < world.height; k++) {
    if (!OPEN[types[index + k * width]]) continue;
    const w = 1 - (k - 1) / 3;
    r *= 1 + (natural.drip[0] - 1) * w; g *= 1 + (natural.drip[1] - 1) * w; b *= 1 + (natural.drip[2] - 1) * w;
    break;
  }
  const top = y > 0 && OPEN[types[index - width]] === 1;
  const left = x > 0 && OPEN[types[index - 1]] === 1;
  if (top) {
    const lit = lipSpeck(x, y, natural.speckRate) ? natural.speck : natural.lip;
    const chip = ((x * 17 + y * 29) & 7) < 2 ? 0.76 : 1;
    const m = natural.lipMix;
    r += (lit[0] * chip - r) * m; g += (lit[1] * chip - g) * m; b += (lit[2] * chip - b) * m;
  } else if (left) {
    const m = natural.sideMix;
    r += (natural.lip[0] - r) * m; g += (natural.lip[1] - g) * m; b += (natural.lip[2] - b) * m;
  } else if (x + 1 < width && OPEN[types[index + 1]] === 1) {
    r *= natural.rightShade; g *= natural.rightShade; b *= natural.rightShade;
  } else if (natural.wetLipMix && natural.wetLip) {
    // WET FACES: a face against a body of water (the next cell out is water or
    // open too — a one-cell pore stays part of the rock) wears a wet rim, so
    // drowned rock reads against the water. ComposeShader mirrors this.
    const wet = natural.wetLip, data = plane.data;
    const POCKET = ART_SOLID_BIT | ART_LOOSE_BIT | ART_POCKET_BIT;
    const reach = (j: number, k: number): boolean =>
      types[j] === Cell.Water && (data[j] & POCKET) !== (ART_LOOSE_BIT | ART_POCKET_BIT) && WET_BODY[types[k]] === 1;
    let m = 0;
    if (y > 1 && reach(index - width, index - 2 * width)) m = natural.wetLipMix;
    else if ((x > 1 && reach(index - 1, index - 2)) || (x + 2 < width && reach(index + 1, index + 2))) m = natural.wetLipMix * 0.5;
    if (m > 0) { r += (wet[0] - r) * m; g += (wet[1] - g) * m; b += (wet[2] - b) * m; }
  }
  // Glaze: rock that touches lava is fired to a crazed amber glass.
  if (natural.glazeMix > 0 && ((y > 0 && types[index - width] === Cell.Lava) || (x > 0 && types[index - 1] === Cell.Lava)
    || (x + 1 < width && types[index + 1] === Cell.Lava) || (y + 1 < world.height && types[index + width] === Cell.Lava))) {
    const k = ((x * 7 + y * 11 + (x >> 1) * 3) & 3) === 0 ? 0.45 : 1, m = natural.glazeMix;
    r += (natural.glaze[0] * k - r) * m; g += (natural.glaze[1] * k - g) * m; b += (natural.glaze[2] * k - b) * m;
  }
  return (Math.min(255, Math.max(0, r)) << 16) | (Math.min(255, Math.max(0, g)) << 8) | Math.min(255, Math.max(0, b));
}

/** Masonry cells on a panel edge that borders a rock panel. */
function panelSeam(x: number, y: number, panels: number): boolean {
  const px = x >> 6, py = y >> 6, lx = x & 63, ly = y & 63;
  return (lx === 0 && !masonryPanel(px - 1, py, panels)) || (lx === 63 && !masonryPanel(px + 1, py, panels))
    || (ly === 0 && !masonryPanel(px, py - 1, panels)) || (ly === 63 && !masonryPanel(px, py + 1, panels));
}

function prop(s: PixelSurface, light: LightField, crop: readonly [number, number, number, number], x: number, y: number): void {
  const atlas = props;
  if (!atlas) return;
  const [sx, sy, width, height] = crop;
  const sample = light.sample(x + width / 2, y + height / 2);
  // Designed darkness (light wave) lowers the props' readability floor with the place.
  const dk = sample.open ?? 1;
  const r = Math.max(0.64 * dk, sample.r), g = Math.max(0.6 * dk, sample.g), b = Math.max(0.55 * dk, sample.b);
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
