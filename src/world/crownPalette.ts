import { hash2 } from '@/core/math';
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import type { BiomeCrown } from '@/core/types';

/**
 * Biome crown tinting palette — a faithful TRANSCRIPTION of the crown stage
 * of CaveGenerator.generateCaves (src/world/CaveGenerator.ts, step 4: the
 * loop tagged "Moss + grass crowns on top surfaces, wildflowers, mossy
 * ceiling fringe", currently lines ~170-257). The Builder's `crownTint`
 * procedural pass uses these so authored levels can wear the exact same
 * skin as generated ones.
 *
 * DO NOT refactor CaveGenerator to call this module: the generator's output
 * is locked bit-for-bit by tests/gen-golden.test.ts, and even an innocent
 * call indirection invites drift during later edits. Keep BOTH sides in
 * sync by hand — every function below cites the branch it transcribes, and
 * the generator carries a back-reference comment at the crown stage.
 */

/**
 * Crown color for a top-surface rock cell (the `topish && nbTop` branch).
 * Rolls `t = hash2(x, y, seed + 21)` exactly like the generator:
 *  - frost: flower (165,215,255) under flowerChance, else pale frosted rock
 *  - ember: rare hot fleck under 0.06, else charred grey-brown
 *  - moss:  pink wildflower under flowerChance, straw tuft in the next 0.05
 *           band, else mossy green
 */
export function crownTopColor(
  x: number,
  y: number,
  seed: number,
  crown: BiomeCrown,
  flowerChance: number,
): number {
  const t = hash2(x, y, seed + 21);
  if (crown === 'frost') {
    if (t < flowerChance) return packRGB(165, 215, 255);
    return packRGB(
      192 + Math.floor(hash2(x, 0, seed) * 40),
      206 + Math.floor(hash2(x, 1, seed) * 34),
      228 + Math.floor(hash2(x, 2, seed) * 27),
    );
  }
  if (crown === 'ember') {
    if (t < 0.06) return packRGB(255, 110 + Math.floor(hash2(x, 1, seed) * 70), 22);
    return packRGB(
      68 + Math.floor(hash2(x, 0, seed) * 22),
      60 + Math.floor(hash2(x, 1, seed) * 16),
      54 + Math.floor(hash2(x, 2, seed) * 12),
    );
  }
  // moss (the generator's `else` arm)
  if (t < flowerChance) return packRGB(212, 118, 166);
  if (t < flowerChance + 0.05) return packRGB(194, 176, 86);
  return packRGB(
    54 + Math.floor(hash2(x, 0, seed) * 26),
    126 + Math.floor(hash2(x, 1, seed) * 48),
    42 + Math.floor(hash2(x, 2, seed) * 22),
  );
}

/**
 * Moss depth-1 underlayer: the fresh deep-green written UNCONDITIONALLY to
 * the rock cell directly below a moss crown (the `y + 1` write in the moss
 * arm). Frost has no unconditional underlayer; ember has none at all.
 */
export function mossUnderColor(x: number, seed: number): number {
  return packRGB(
    44 + Math.floor(hash2(x, 3, seed) * 22),
    104 + Math.floor(hash2(x, 4, seed) * 40),
    36 + Math.floor(hash2(x, 5, seed) * 18),
  );
}

/**
 * Conditional deeper tint of an EXISTING packed color under a crown; null
 * means the roll said leave it alone. Transcribes:
 *  - frost: the `y + 1` tint, gated on hash2(x, y, seed + 23) < 0.5
 *  - moss:  the `y + 2` tint, gated on hash2(x, y, seed + 23) < 0.6
 *  - ember: no deep tint
 */
export function crownDeepTint(
  c: number,
  x: number,
  y: number,
  seed: number,
  crown: BiomeCrown,
): number | null {
  if (crown === 'frost') {
    if (hash2(x, y, seed + 23) >= 0.5) return null;
    return packRGB(
      Math.floor(unpackR(c) * 0.85 + 18),
      Math.floor(unpackG(c) * 0.88 + 22),
      Math.min(255, Math.floor(unpackB(c) * 0.9 + 32)),
    );
  }
  if (crown === 'moss') {
    if (hash2(x, y, seed + 23) >= 0.6) return null;
    return packRGB(
      Math.floor(unpackR(c) * 0.7),
      Math.min(255, Math.floor(unpackG(c) * 0.85 + 26)),
      Math.floor(unpackB(c) * 0.7),
    );
  }
  return null;
}

/**
 * Ledge/fringe tint for non-ember biomes: exposed rock above a 2-cell open
 * drop greens (moss) or frosts over, gated on hash2(x, y, seed + 29) < 0.22
 * (the generator's `else if` arm). Null = roll said no, or ember.
 */
export function crownFringeTint(
  c: number,
  x: number,
  y: number,
  seed: number,
  crown: BiomeCrown,
): number | null {
  if (crown === 'ember') return null;
  if (hash2(x, y, seed + 29) >= 0.22) return null;
  if (crown === 'frost') {
    return packRGB(
      Math.floor(unpackR(c) * 0.9 + 14),
      Math.floor(unpackG(c) * 0.92 + 18),
      Math.min(255, Math.floor(unpackB(c) * 0.95 + 28)),
    );
  }
  return packRGB(
    Math.floor(unpackR(c) * 0.75),
    Math.min(255, Math.floor(unpackG(c) * 0.9 + 18)),
    Math.floor(unpackB(c) * 0.75),
  );
}
