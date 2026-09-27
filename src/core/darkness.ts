import { HEIGHT, WIDTH } from '@/config/constants';
import { DARKNESS, DEFAULT_DARKNESS, FLOOR_DARKNESS, type DarknessProfile } from '@/config/darkness';
import type { DarkZone } from '@/core/types';

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

/** How far inside a zone a cell sits, 0 (outside/rim) … 1 (past the feather). */
export function zoneInside(zone: DarkZone, x: number, y: number, feather: number = DARKNESS.feather): number {
  if (zone.shape === 'rect') {
    const edge = Math.min(x - (zone.x - zone.rx), zone.x + zone.rx - x, y - (zone.y - zone.ry), zone.y + zone.ry - y);
    return edge <= 0 ? 0 : smoothstep(0, feather, edge);
  }
  const dx = (x - zone.x) / zone.rx, dy = (y - zone.y) / zone.ry;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r >= 1) return 0;
  return smoothstep(0, feather, (1 - r) * Math.min(zone.rx, zone.ry));
}

/**
 * Bake a level's darkness: `base` everywhere, each zone raising its interior
 * toward `strength × profile.deep` through a feathered rim. Zones combine by
 * max, never by sum, so overlaps read as one cave.
 */
export function bakeDarkMap(zones: readonly DarkZone[], profile: DarknessProfile, out = new Uint8Array(DARK_W * DARK_H)): Uint8Array {
  const base = Math.round(Math.min(1, Math.max(0, profile.base)) * 255);
  out.fill(base);
  const feather = DARKNESS.feather;
  for (const z of zones) {
    const peak = Math.min(1, Math.max(0, (z.strength ?? 1) * profile.deep));
    if (peak * 255 <= base) continue;
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
  const map = profile.base <= 0 && (zones.length === 0 || profile.deep <= 0) ? null : bakeDarkMap(zones, profile);
  MAPS.set(runtime, { zones: runtime.darkZones, map });
  return map;
}
