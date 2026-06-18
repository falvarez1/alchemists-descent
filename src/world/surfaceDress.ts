import { hash2 } from '@/core/math';
import { Cell, isSoftGrowth, isSolid } from '@/sim/CellType';
import type { World } from '@/sim/World';
import { fungusColor, glowshroomColor, grassColor as grassBladeColor, packRGB } from '@/sim/colors';

/**
 * Walk-surface dressing — runs after terrainPolish so it sees the polished surface.
 * Paints every walkable ledge (any solid cell with headroom above) as DIRT with
 * grass/moss + occasional flowers on top, so the bare saw-tooth rock the player walks
 * reads as natural ground instead of snaggy stone.
 *
 * PURE RECOLOUR — no geometry. An earlier version also "capped" shallow surface dips,
 * but filling the empty headroom above a dip can seal a corridor (the findability
 * audit caught a counterweight going unreachable), and a jagged cave top has no flat
 * reference to tell a snag from natural slope. Geometry smoothing stays with the
 * bounded terrainPolish pass; this layer makes the surface LOOK like ground. Colours
 * are Math-free (hash2) so the gen stays deterministic and golden-lockable.
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

  // Dress every walkable ledge (Wall with 2 empty above): grass/flowers on top,
  // dirt gradient below.
  if (crown === 'ember') return; // scorched crown already handled by generateCaves
  for (let x = 0; x < W; x++) {
    for (let y = top; y < maxY; y++) {
      const i = x + y * W;
      if (t[i] !== Cell.Wall) continue;
      if (t[x + (y - 1) * W] !== Cell.Empty || t[x + (y - 2) * W] !== Cell.Empty) continue;
      if (crown === 'frost') {
        col[i] = packRGB(206, 220, 238); // snow cap
        world.colorOverrides.add(i);
        continue;
      }
      const hr = hash2(x, y, seed + 131);
      if (hr < flowerChance) col[i] = packRGB(214, 96, 150); // pink flower
      else if (hr < flowerChance + 0.06) col[i] = packRGB(206, 186, 84); // yellow flower
      else col[i] = grassColor(x, seed); // grass / moss
      world.colorOverrides.add(i);
      for (let d = 1; d <= 3; d++) {
        const ii = x + (y + d) * W;
        if (t[ii] !== Cell.Wall) break;
        col[ii] = dirtColor(x, y + d, seed);
        world.colorOverrides.add(ii);
      }
    }
  }
}

/** Floor a grass blade / mushroom can root on: solid ground, but not another
 *  soft-growth cell (so cover never stacks on itself). */
function isGroundCoverFloor(tp: number): boolean {
  return isSolid(tp) && !isSoftGrowth(tp);
}

/**
 * Plant living, WALK-THROUGH ground cover on the surfaces dressWalkSurface just
 * dressed — grass blades with sparse glowing-mushroom and glowcap tufts standing
 * in the air above the dirt. Real cells (isSoftGrowth, so bodies pass through),
 * so they sway-spread, burn, and wither on their own once the sim runs. Placement
 * is hash2-deterministic (golden-lockable); the cell COLOURS use the randomized
 * factories (colours aren't hashed, only types are), and life is the runtime
 * energy seed (most settled, a few active so the lawn gently fills in).
 *
 * Verdant ('moss') biomes only — frost/ember keep their bare crowns.
 */
export function plantGroundCover(world: World, opts: SurfaceDressOptions): void {
  if (opts.crown !== 'moss') return;
  const W = world.width;
  const H = world.height;
  const t = world.types;
  const col = world.colors;
  const { seed, minY, floorBand } = opts;
  const maxY = Math.min(floorBand, H - 1);
  const top = Math.max(minY + 2, 4);

  const plant = (i: number, type: number, color: number, life: number): void => {
    t[i] = type;
    col[i] = color;
    world.life[i] = life;
    world.charge[i] = 0;
  };

  for (let x = 0; x < W; x++) {
    for (let y = top; y < maxY; y++) {
      const fi = x + y * W; // floor cell
      if (!isGroundCoverFloor(t[fi])) continue;
      const ai = x + (y - 1) * W; // the air blade stands in
      if (t[ai] !== Cell.Empty) continue;
      const a2 = x + (y - 2) * W;
      const headroom2 = y - 2 >= 0 && t[a2] === Cell.Empty;

      const r = hash2(x, y, seed + 313);
      if (r < 0.4) {
        // grass: mostly settled carpet (-1), ~1 in 4 active (0) so it creeps a little
        const active = hash2(x, y, seed + 47) < 0.26 ? 0 : -1;
        plant(ai, Cell.Grass, grassBladeColor(), active);
        if (headroom2 && hash2(x, y, seed + 71) < 0.28) {
          plant(a2, Cell.Grass, grassBladeColor(), -1); // taller blade
        }
      } else if (r < 0.46) {
        // glowing cap — sparse (light is information); a 2-cell stalk now and then
        plant(ai, Cell.Glowshroom, glowshroomColor(), -1);
        if (headroom2 && hash2(x, y, seed + 91) < 0.4) {
          plant(a2, Cell.Glowshroom, glowshroomColor(), -1);
        }
      } else if (r < 0.52) {
        plant(ai, Cell.Fungus, fungusColor(), -1);
      }
      // else: bare dirt (most ledges keep open ground to walk)
    }
  }
}
