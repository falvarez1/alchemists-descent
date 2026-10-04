import type { BiomeId } from '@/core/types';
import type { EditorWorldLayer } from '@/authoring/document';
import {
  base64ToBytes,
  bytesToBase64,
  packColorDiffs,
  packIndexRuns,
  packValueRuns,
  rleDecodeExact,
  rleEncode,
  unpackColorDiffs,
  unpackIndexRuns,
  unpackValueRuns,
} from '@/core/rle';
import { Cell } from '@/sim/CellType';
import type { ColorOverrides } from '@/sim/ColorOverrides';
import { World } from '@/sim/World';
import {
  PLAIN_PAINT,
  paintCells,
  sanitizeWorldPaint,
  type AnyWorldPaint,
  type LegacyPaintV1,
  type PaintGrid,
} from '@/sim/worldPaint';
import { isLegacyBiome, legacyFallbackSeed, paintLegacyV1 } from '@/authoring/legacyPaintV1';

/**
 * The world-layer codec: live cell grid <-> `EditorWorldLayer`.
 *
 * Two consumers: the Builder's documents (src/builder/document.ts) and
 * AuthorLink, which sends a whole world to another window when the two are on
 * different levels (src/app/AuthorLink.ts; `src/net`/`src/app` may not import
 * `src/builder`, so the codec lives here).
 *
 * A WORLD TRAVELS AS ITS CELLS. A cell's generated colour is a pure function of
 * the final grid and a small paint descriptor (sim/worldPaint), and every
 * generator ends by painting its finished grid with that function, so the
 * colours it leaves are the function's output by construction. The layer
 * therefore carries the cell types (rle), the descriptor (`paint`), and only
 * the cells whose colour differs from what the paint gives: authored colours, a
 * stamp's own palette, scars, cells the sim has moved since (`tints`, packed
 * runs), plus which cells are flagged as scars for the renderer (`scars`), and
 * the life and charge planes as packed runs too (`lifeRuns`, `chargeRuns`). The
 * receiver paints the same grid with the same function and lays the
 * differences on top. A fresh 1600x1064 world costs its rle and a few KB.
 *
 * Measured 2026-10-04, before: the receiver re-derived the generator's tint
 * with its own copy of it, which had fallen behind (rock shaded by the pre-fill
 * distance to air, the dressed walk surface, ground cover), so ~1.19M of 1.34M
 * rock cells differed, the diff overflowed and the whole colour plane shipped:
 * ~9.2 MB per layer. There is no second copy now, so there is nothing to drift.
 *
 * OLD LAYERS (no `paint`): paint version 1. Their `colorOverrides` pairs were
 * computed against the version-1 repaint, which is kept frozen in
 * authoring/legacyPaintV1 and used for them, and their full `colors` plane,
 * when they carry one, still decodes exactly. A world restored from one keeps
 * that paint, so saving it again stays as small as it was.
 *
 * The functions take a narrow surface rather than `Ctx` so the neutral layer
 * stays free of runtime services (boundary-enforced).
 */

/** Everything the codec needs to read a world out (its paint descriptor rides on the World). */
export interface WorldLayerSource {
  world: World;
  biome: BiomeId;
  seed: number;
}

/** Everything the codec needs to write a world back; fallbacks for old layers. */
export interface WorldLayerTarget {
  world: World;
  biome: BiomeId;
  seed: number;
}

/** Snapshot the LIVE world cells into a terrain layer. */
export function captureWorldLayer(src: WorldLayerSource): EditorWorldLayer {
  const w = src.world;
  const paint = w.paint ?? PLAIN_PAINT;
  const layer: EditorWorldLayer = {
    rle: rleEncode(w.types),
    biome: src.biome,
    seed: src.seed >>> 0,
    paint: structuredClone(paint),
  };
  // Transient gas life is noise; keep authored/fire life so generated braziers survive restore.
  const life = packValueRuns(w.life, (i) => w.types[i] !== Cell.Smoke && w.types[i] !== Cell.Steam);
  if (life) layer.lifeRuns = life;
  const charge = packValueRuns(w.charge);
  if (charge) layer.chargeRuns = charge;
  const base = new Uint32Array(w.colors.length);
  paintBase(w, paint, base, null);
  const tints = packColorDiffs(w.colors, base);
  if (tints) layer.tints = tints;
  const scars = packIndexRuns(w.colorOverrides.mask);
  if (scars) layer.scars = scars;
  return layer;
}

/** Decode a terrain layer into the LIVE world (colors regenerate). */
export function applyWorldLayer(target: WorldLayerTarget, layer: EditorWorldLayer): void {
  const w = target.world;
  w.clear();
  // A malformed rle must fail safe (leave the cleared world) rather than throw
  // into callers — the importer's sanitizeWorldLayer guards the same way.
  try {
    if (!rleDecodeExact(layer.rle, w.types)) return;
  } catch {
    return;
  }
  if (layer.paint !== undefined) applyPaintedLayer(w, layer);
  else applyLegacyLayer(target, layer);
  const n = w.types.length;
  for (const [i, v] of layer.life ?? []) w.life[i] = v;
  for (const [i, v] of layer.charge ?? []) w.setChargeAt(i, v);
  if (typeof layer.lifeRuns === 'string') unpackValueRuns(layer.lifeRuns, n, (i, v) => { w.life[i] = v; });
  if (typeof layer.chargeRuns === 'string') unpackValueRuns(layer.chargeRuns, n, (i, v) => w.setChargeAt(i, v));
}

/** A version-2 layer: paint the grid, lay the differences on, flag the scars. */
function applyPaintedLayer(w: World, layer: EditorWorldLayer): void {
  const paint = sanitizeLayerPaint(layer.paint) ?? PLAIN_PAINT;
  paintBase(w, paint, w.colors, null);
  if (typeof layer.tints === 'string') unpackColorDiffs(layer.tints, w.colors);
  if (typeof layer.scars === 'string') {
    const n = w.colors.length;
    unpackIndexRuns(layer.scars, n, (i) => w.colorOverrides.add(i));
  }
  w.paint = paint;
}

/** A layer from before the shared paint: the frozen version-1 repaint, then its plane or its pairs. */
function applyLegacyLayer(target: WorldLayerTarget, layer: EditorWorldLayer): void {
  const w = target.world;
  const paint = legacyPaintOf(layer, target);
  // Version 1 flagged the dressed walk surface as scars on a decode; so does its frozen repaint.
  paintLegacyV1(w, paint, w.colors, w.colorOverrides);
  if (layer.colors) decodeColorPlaneInto(layer.colors, w.colors);
  for (const [i, c] of layer.colorOverrides ?? []) {
    w.colors[i] = c;
    // Register the scar so World.swap carries the authored tint instead of
    // regenerating the factory color on the cell's first move.
    w.colorOverrides.add(i);
  }
  w.paint = paint;
}

function legacyPaintOf(layer: EditorWorldLayer, target: WorldLayerTarget): LegacyPaintV1 {
  const biome = isLegacyBiome(layer.biome) ? layer.biome : target.biome;
  const seed = Number.isFinite(layer.paintSeed)
    ? Math.floor(layer.paintSeed as number)
    : legacyFallbackSeed(layer.seed ?? target.seed, biome);
  return { v: 1, seed, biome };
}

function paintBase(grid: PaintGrid, paint: AnyWorldPaint, out: Uint32Array, scars: ColorOverrides | null): void {
  if (paint.v === 1) paintLegacyV1(grid, paint, out, scars);
  else paintCells(grid, paint, out);
}

/** A layer's paint descriptor, rebuilt field by field; null when it is not one this codec paints. */
export function sanitizeLayerPaint(value: unknown): AnyWorldPaint | null {
  const v2 = sanitizeWorldPaint(value);
  if (v2) return v2;
  if (typeof value !== 'object' || value === null) return null;
  const legacy = value as Partial<LegacyPaintV1>;
  if (legacy.v !== 1 || !isLegacyBiome(legacy.biome)) return null;
  const seed = legacy.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  return { v: 1, seed, biome: legacy.biome };
}

/** Exported for the document sanitizer, which round-trips an untrusted plane. */
export function encodeColorPlane(colors: Uint32Array): string {
  return bytesToBase64(new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength));
}

/** Exported for the document sanitizer; false when the payload is the wrong length. */
export function decodeColorPlaneInto(encoded: string, colors: Uint32Array): boolean {
  try {
    const bytes = new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength);
    base64ToBytes(encoded, bytes);
    for (let i = 0; i < colors.length; i++) colors[i] &= 0xffffff;
    return true;
  } catch {
    return false;
  }
}

