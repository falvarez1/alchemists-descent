import { hash2 } from '@/core/math';
import { Cell, isSoftGrowth, isSolid } from '@/sim/CellType';
import type { World } from '@/sim/World';
import { fungusColor, glowshroomColor, grassColor as grassBladeColor } from '@/sim/colors';

/**
 * The walk surface. Every walkable ledge reads as ground (dirt, with grass or
 * moss and the odd flower on top) so the saw-tooth rock the player walks looks
 * natural; that is PAINT, not geometry, and it is sim/worldPaint's: it dresses
 * the FINISHED grid, the same function the world-layer codec repaints with.
 * What stands on the ground is real cells, planted here.
 */
export interface SurfaceDressOptions {
  seed: number;
  minY: number;
  floorBand: number;
  /** Biome crown family: only 'moss' gets ground cover. */
  crown: 'moss' | 'frost' | 'ember';
  flowerChance: number;
}

/** Floor a grass blade / mushroom can root on: solid ground, but not another
 *  soft-growth cell (so cover never stacks on itself). */
function isGroundCoverFloor(tp: number): boolean {
  return isSolid(tp) && !isSoftGrowth(tp);
}

/**
 * Plant living, WALK-THROUGH ground cover on the walkable ledges the paint
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
