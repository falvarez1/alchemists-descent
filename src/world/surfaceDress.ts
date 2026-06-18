import { hash2 } from '@/core/math';
import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';
import { packRGB } from '@/sim/colors';

/**
 * Walk-surface dressing — runs after terrainPolish so it sees the filled surface.
 * Two jobs the player feels directly on the ground they walk:
 *  1) cap the remaining shallow (1–2 cell) snags in the topmost walk surface, so the
 *     ledge reads level instead of saw-toothed (bounded to 2 cells → connectivity-safe);
 *  2) paint every walkable ledge as DIRT with grass/moss + occasional flowers on top
 *     (green-crown biomes) — the bare rock surface becomes natural ground.
 *
 * Geometry change is intentionally tiny; the bulk is recolour. Cosmetic colours are
 * Math-free (hash2) so the gen stays deterministic and golden-lockable.
 */
export interface SurfaceDressOptions {
  seed: number;
  minY: number;
  floorBand: number;
  /** Biome crown family: only 'moss' gets the grass/dirt/flower treatment; 'frost'
   *  gets a snow cap; 'ember' keeps its existing scorched crown. */
  crown: 'moss' | 'frost' | 'ember';
  flowerChance: number;
}

function grassColor(x: number, seed: number): number {
  return packRGB(
    48 + Math.floor(hash2(x, 7, seed) * 30),
    120 + Math.floor(hash2(x, 8, seed) * 56),
    40 + Math.floor(hash2(x, 9, seed) * 26),
  );
}
function dirtColor(x: number, y: number, seed: number): number {
  const v = hash2(x, y, seed + 211);
  const d = Math.min(3, Math.max(0, y % 4)) * 6; // slight darken with depth
  return packRGB(96 + Math.floor(v * 24) - d, 64 + Math.floor(v * 16) - d, 40 + Math.floor(v * 12) - d);
}

export function dressWalkSurface(world: World, opts: SurfaceDressOptions): void {
  const W = world.width;
  const H = world.height;
  const t = world.types;
  const col = world.colors;
  const { seed, minY, floorBand, crown, flowerChance } = opts;
  const maxY = Math.min(floorBand, H - 1);
  const top = Math.max(minY + 1, 3);

  // 1) Snag-cap: raise 1–2 cell dips in the TOPMOST walk surface to its neighbours.
  const surf = new Int32Array(W).fill(-1);
  for (let x = 1; x < W - 1; x++) {
    for (let y = top; y < maxY; y++) {
      if (t[x + y * W] === Cell.Wall && t[x + (y - 1) * W] === Cell.Empty && t[x + (y - 2) * W] === Cell.Empty) {
        surf[x] = y;
        break;
      }
    }
  }
  for (let x = 2; x < W - 2; x++) {
    const s = surf[x], l = surf[x - 1], r = surf[x + 1];
    if (s < 0 || l < 0 || r < 0) continue;
    if (s <= l || s <= r) continue; // not a dip (must be lower than BOTH neighbours)
    const target = Math.max(s - 2, Math.min(l, r)); // raise at most 2 cells, up to the higher neighbour
    if (s - target < 1) continue;
    let capped = false;
    for (let y = target; y < s; y++) {
      const i = x + y * W;
      if (t[i] !== Cell.Empty) break; // never overwrite real cells / corridors
      t[i] = Cell.Wall;
      col[i] = dirtColor(x, y, seed);
      capped = true;
    }
    if (capped) surf[x] = target;
  }

  // 2) Dress every walkable ledge (Wall with 2 empty above): grass/flowers on top,
  //    dirt gradient below.
  if (crown === 'ember') return; // scorched crown already handled by generateCaves
  for (let x = 0; x < W; x++) {
    for (let y = top; y < maxY; y++) {
      const i = x + y * W;
      if (t[i] !== Cell.Wall) continue;
      if (t[x + (y - 1) * W] !== Cell.Empty || t[x + (y - 2) * W] !== Cell.Empty) continue;
      if (crown === 'frost') {
        col[i] = packRGB(206, 220, 238); // snow cap
        continue;
      }
      const hr = hash2(x, y, seed + 131);
      if (hr < flowerChance) col[i] = packRGB(214, 96, 150); // pink flower
      else if (hr < flowerChance + 0.06) col[i] = packRGB(206, 186, 84); // yellow flower
      else col[i] = grassColor(x, seed); // grass / moss
      for (let d = 1; d <= 3; d++) {
        const ii = x + (y + d) * W;
        if (t[ii] !== Cell.Wall) break;
        col[ii] = dirtColor(x, y + d, seed);
      }
    }
  }
}
