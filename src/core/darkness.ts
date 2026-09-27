import { HEIGHT, WIDTH } from '@/config/constants';
import { DARKNESS, DEFAULT_DARKNESS, FLOOR_DARKNESS, type DarknessProfile } from '@/config/darkness';
import type { DarkZone } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';

/**
 * The designed-darkness map: a level-sized plane (one texel per
 * DARKNESS.mapCell cells — the light field's own grain) holding how dark each
 * place is BY DESIGN, 0..255. It is static presentation/gameplay data baked
 * from the level's zones (regenerated with the pristine world on restore);
 * the light that actually reaches a spot is always the real light field.
 */

export const DARK_CELL = DARKNESS.mapCell;
export const DARK_W = Math.ceil(WIDTH / DARK_CELL);
export const DARK_H = Math.ceil(HEIGHT / DARK_CELL);

export function darknessProfile(levelId: string | null | undefined): DarknessProfile {
  return (levelId && FLOOR_DARKNESS[levelId]) || DEFAULT_DARKNESS;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * A slow, deterministic wobble (−1…1) that breaks a zone's rim so the dark
 * reads as a cave the light never reached, not a box drawn on the map.
 */
function rimWobble(x: number, y: number): number {
  return Math.sin(x * 0.061 + Math.sin(y * 0.047) * 1.3) * 0.55 + Math.sin(y * 0.053 - x * 0.021 + 1.7) * 0.45;
}

/** How far inside a zone a cell sits, 0 (outside/rim) … 1 (past the feather). */
export function zoneInside(zone: DarkZone, x: number, y: number, feather: number = DARKNESS.feather): number {
  let depth: number;
  if (zone.shape === 'rect') {
    // Rounded-box depth: straight walls, softened corners.
    const rc = Math.min(zone.rx, zone.ry) * 0.45;
    const qx = Math.abs(x - zone.x) - (zone.rx - rc), qy = Math.abs(y - zone.y) - (zone.ry - rc);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
    depth = -outside;
  } else {
    const dx = (x - zone.x) / zone.rx, dy = (y - zone.y) / zone.ry;
    const r = Math.sqrt(dx * dx + dy * dy);
    depth = (1 - r) * Math.min(zone.rx, zone.ry);
  }
  depth += rimWobble(x, y) * DARKNESS.rimNoise;
  return depth <= 0 ? 0 : smoothstep(0, feather, depth);
}

/** The grid the bake reads to follow the rock (a World satisfies it). */
export interface DarkGrid {
  width: number;
  height: number;
  types: Uint8Array;
}

/**
 * A finer, second wobble layered on rimWobble: the fade line through open air
 * never runs straight for more than a dozen cells.
 */
function fineWobble(x: number, y: number): number {
  return Math.sin(x * 0.23 + y * 0.17) * Math.sin(y * 0.19 - x * 0.11 + 0.8);
}

// Dial's-algorithm scratch (bucketed shortest paths, integer costs).
let geoDist = new Uint16Array(0);
let geoOpen = new Uint8Array(0);
let geoDepth = new Float32Array(0);
let geoK = new Float32Array(0);
let geoT = new Float32Array(0);
const GEO_UNSET = 0xffff;

/**
 * One zone, FOLLOWING THE ROCK: the zone's open air is dark (to its feathered
 * geometric depth), and the dark travels from there only through what connects
 * it — along open air it holds for `airHold` cells and then fades over
 * `airFade` more, and into rock it soaks `rockSoak` times slower, so a room's
 * walls go dark a few cells deep while the rock beyond keeps its light. A
 * separate cave that a zone's rectangle happens to overlap stays lit, and the
 * fade across a doorway or an open cave wanders with noise, so no straight,
 * axis-aligned dark edge is ever drawn across a lit room.
 */
function bakeZoneFollowingRock(z: DarkZone, peak: number, base: number, grid: DarkGrid, out: Uint8Array): void {
  const hold = DARKNESS.airHold, fade = DARKNESS.airFade;
  const reach = hold + fade + DARKNESS.rimNoise + 4; // cells beyond the zone the dark can travel
  const tx0 = Math.max(0, Math.floor((z.x - z.rx - reach) / DARK_CELL));
  const tx1 = Math.min(DARK_W - 1, Math.ceil((z.x + z.rx + reach) / DARK_CELL));
  const ty0 = Math.max(0, Math.floor((z.y - z.ry - reach) / DARK_CELL));
  const ty1 = Math.min(DARK_H - 1, Math.ceil((z.y + z.ry + reach) / DARK_CELL));
  const rw = tx1 - tx0 + 1, rh = ty1 - ty0 + 1, n = rw * rh;
  if (geoDist.length < n) { geoDist = new Uint16Array(n); geoOpen = new Uint8Array(n); geoDepth = new Float32Array(n); }
  const dist = geoDist, open = geoOpen, depth = geoDepth;
  let deepest = 0;
  // Costs in half-cells: a texel is two cells. Air: 4 straight / 6 diagonal;
  // rock: rockSoak times that.
  const soak = DARKNESS.rockSoak;
  const AIR = 4, AIR_D = 6, ROCK = Math.round(4 * soak), ROCK_D = Math.round(5.66 * soak);
  const maxCost = Math.ceil(reach * 2);
  const buckets: number[][] = [];
  for (let k = 0; k <= maxCost; k++) buckets.push([]);
  const W = grid.width, H = grid.height, types = grid.types;
  for (let ry = 0; ry < rh; ry++) {
    const cy = (ty0 + ry) * DARK_CELL;
    for (let rx = 0; rx < rw; rx++) {
      const i = ry * rw + rx;
      const cx = (tx0 + rx) * DARK_CELL;
      // The texel is air if either of its sampled diagonal cells is: a
      // one-cell crack still carries the dark, as it carries light.
      const a = cx < W && cy < H ? !blocksEntity(types[cx + cy * W]) : false;
      const b = cx + 1 < W && cy + 1 < H ? !blocksEntity(types[cx + 1 + (cy + 1) * W]) : false;
      open[i] = a || b ? 1 : 0;
      dist[i] = GEO_UNSET;
      const t = open[i] ? zoneInside(z, cx + DARK_CELL * 0.5, cy + DARK_CELL * 0.5) : 0;
      depth[i] = t;
      if (t > deepest) deepest = t;
    }
  }
  // The dark starts in the zone's CORE air only — the air past its feather
  // (or, for a zone with no air that deep, its deepest air). Everything else,
  // the rim band included, is reached by walking from there: a separate cave
  // that the zone's box merely overlaps is not connected, and stays lit.
  const coreT = Math.min(0.999, deepest * 0.999);
  if (deepest <= 0) return;
  for (let i = 0; i < n; i++) {
    const t = depth[i];
    if (t < coreT || t <= 0) continue;
    const d0 = Math.round((1 - t) * DARKNESS.feather * 2);
    dist[i] = d0;
    buckets[d0].push(i);
  }
  for (let d = 0; d <= maxCost; d++) {
    const bucket = buckets[d];
    for (let q = 0; q < bucket.length; q++) {
      const i = bucket[q];
      if (dist[i] !== d) continue; // superseded
      const rx = i % rw, ry = (i - rx) / rw;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = ry + oy;
        if (ny < 0 || ny >= rh) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = rx + ox;
          if (nx < 0 || nx >= rw) continue;
          const j = ny * rw + nx;
          const diag = ox !== 0 && oy !== 0;
          // Stepping OUT of rock back into air still costs rock: the dark does
          // not tunnel through a wall and come out lit on the other side.
          const cost = open[j] && open[i] ? (diag ? AIR_D : AIR) : diag ? ROCK_D : ROCK;
          const nd = d + cost;
          if (nd > maxCost || nd >= dist[j]) continue;
          dist[j] = nd;
          buckets[nd].push(j);
        }
      }
    }
  }
  // Shade each texel, then soften the texel steps with a 1-2-1 blur each way
  // (in rock the dark falls `soak` times faster per cell, and unblurred those
  // 2-cell texels read as a staircase along the edge).
  if (geoK.length < n) { geoK = new Float32Array(n); geoT = new Float32Array(n); }
  const kk = geoK, tmp = geoT;
  for (let ry = 0; ry < rh; ry++) {
    const cy = (ty0 + ry) * DARK_CELL + DARK_CELL * 0.5;
    for (let rx = 0; rx < rw; rx++) {
      const i = ry * rw + rx;
      const d = dist[i];
      if (d === GEO_UNSET) { kk[i] = 0; continue; }
      const cx = (tx0 + rx) * DARK_CELL + DARK_CELL * 0.5;
      // The rim wanders further in rock: a cell of rock is `soak` cells of
      // travel, so without a larger wobble the edge of a straight-walled
      // room's dark would run parallel to the wall (x1.8, not the full soak:
      // more reads as a toothed fringe).
      const wander = DARKNESS.rimNoise * (open[i] ? 1 : 1.8);
      const e = d * 0.5 + rimWobble(cx, cy) * wander * 0.7 + fineWobble(cx, cy) * wander * 0.3;
      kk[i] = 1 - smoothstep(hold, hold + fade, e);
    }
  }
  for (let ry = 0; ry < rh; ry++) {
    for (let rx = 0; rx < rw; rx++) {
      const i = ry * rw + rx;
      const l = rx > 0 ? kk[i - 1] : kk[i], r = rx < rw - 1 ? kk[i + 1] : kk[i];
      tmp[i] = (l + 2 * kk[i] + r) * 0.25;
    }
  }
  const span = peak - base / 255;
  for (let ry = 0; ry < rh; ry++) {
    const row = (ty0 + ry) * DARK_W;
    for (let rx = 0; rx < rw; rx++) {
      const i = ry * rw + rx;
      const u = ry > 0 ? tmp[i - rw] : tmp[i], dn = ry < rh - 1 ? tmp[i + rw] : tmp[i];
      const k = (u + 2 * tmp[i] + dn) * 0.25;
      if (k <= 0.002) continue;
      const v = Math.round((base / 255 + span * k) * 255);
      const o = row + tx0 + rx;
      if (v > out[o]) out[o] = v;
    }
  }
}

/**
 * Bake a level's darkness: `base` everywhere, each zone raising its interior
 * toward `strength × profile.deep` through a feathered rim. Zones combine by
 * max, never by sum, so overlaps read as one cave. Given the level's grid, a
 * zone FOLLOWS THE ROCK (bakeZoneFollowingRock); without one (tests, tools) it
 * is the plain geometric shape.
 */
export function bakeDarkMap(
  zones: readonly DarkZone[], profile: DarknessProfile, out = new Uint8Array(DARK_W * DARK_H), grid: DarkGrid | null = null,
): Uint8Array {
  const base = Math.round(Math.min(1, Math.max(0, profile.base)) * 255);
  out.fill(base);
  const feather = DARKNESS.feather;
  for (const z of zones) {
    const peak = Math.min(1, Math.max(0, (z.strength ?? 1) * profile.deep));
    if (peak * 255 <= base) continue;
    if (grid) {
      bakeZoneFollowingRock(z, peak, base, grid, out);
      continue;
    }
    const tx0 = Math.max(0, Math.floor((z.x - z.rx) / DARK_CELL)), tx1 = Math.min(DARK_W - 1, Math.ceil((z.x + z.rx) / DARK_CELL));
    const ty0 = Math.max(0, Math.floor((z.y - z.ry) / DARK_CELL)), ty1 = Math.min(DARK_H - 1, Math.ceil((z.y + z.ry) / DARK_CELL));
    for (let ty = ty0; ty <= ty1; ty++) {
      const cy = ty * DARK_CELL + DARK_CELL * 0.5, row = ty * DARK_W;
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = zoneInside(z, tx * DARK_CELL + DARK_CELL * 0.5, cy, feather);
        if (t <= 0) continue;
        const v = Math.round((base / 255 + (peak - base / 255) * t) * 255);
        if (v > out[row + tx]) out[row + tx] = v;
      }
    }
  }
  return out;
}

/** Gameplay darkness at a world point (0..1), nearest texel. */
export function sampleDarkMap(map: Uint8Array | null, x: number, y: number): number {
  if (!map) return 0;
  const tx = Math.floor(x / DARK_CELL), ty = Math.floor(y / DARK_CELL);
  if (tx < 0 || ty < 0 || tx >= DARK_W || ty >= DARK_H) return 0;
  return map[ty * DARK_W + tx] / 255;
}

/**
 * Gameplay darkness → the RENDER "open" factor the compose paths multiply
 * ambient and the readability floor by (1 = the shipped look, → 0 = black).
 * A 256-entry table per comfort setting, built once.
 */
const OPEN_LUTS: Array<Float32Array | undefined> = [undefined, undefined];
export function renderOpenLut(highReadability: boolean): Float32Array {
  const k = highReadability ? 1 : 0;
  const cached = OPEN_LUTS[k];
  if (cached) return cached;
  const lut = new Float32Array(256);
  const scale = highReadability ? DARKNESS.readabilityScale : 1;
  for (let i = 0; i < 256; i++) {
    const d = i / 255;
    lut[i] = 1 - Math.pow(d, DARKNESS.renderGamma) * DARKNESS.renderStrength * scale;
  }
  OPEN_LUTS[k] = lut;
  return lut;
}

/** Render darkness (0 normal … ~1 black) for a gameplay darkness value. */
export function renderDarkness(d: number, highReadability: boolean): number {
  return 1 - renderOpenLut(highReadability)[Math.max(0, Math.min(255, Math.round(d * 255)))];
}

interface DarkSource {
  def: { id: string };
  darkZones?: readonly DarkZone[];
  /** The level's grid: zones follow its rock (baked once, from the world as it stands at first light). */
  world?: DarkGrid;
}

const MAPS = new WeakMap<object, { zones: readonly DarkZone[] | undefined; map: Uint8Array | null }>();

/**
 * The baked map for a level runtime (lazily, once per runtime; a runtime
 * whose zones array is replaced rebakes). Null when the level is fully
 * readable — callers skip all darkness work.
 */
export function darkMapFor(runtime: DarkSource | null | undefined): Uint8Array | null {
  if (!runtime) return null;
  const cached = MAPS.get(runtime);
  if (cached && cached.zones === runtime.darkZones) return cached.map;
  const profile = darknessProfile(runtime.def.id);
  const zones = runtime.darkZones ?? [];
  const map = profile.base <= 0 && (zones.length === 0 || profile.deep <= 0) ? null : bakeDarkMap(zones, profile, undefined, runtime.world ?? null);
  MAPS.set(runtime, { zones: runtime.darkZones, map });
  return map;
}
