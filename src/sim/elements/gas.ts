import type { Ctx } from '@/core/types';
import { Cell, isSolid } from '@/sim/CellType';
import { EMPTY_COLOR, fireColor, marshGasColor, packRGB, waterColor } from '@/sim/colors';
import { fxRandom, simRandom } from '@/core/simRandom';

/**
 * Shared rising-gas behavior for STEAM and SMOKE.
 * (The original's unused `colFunc` parameter is dropped — approved deviation 6.)
 */
export function handleGas(
  ctx: Ctx,
  x: number,
  y: number,
  elementId: Cell,
  flowSpeed: number,
  dispRate: number,
): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  w.life[ci]--;
  if (elementId === Cell.Steam) {
    if (w.inBounds(x, y - 1) && isSolid(w.types[w.idx(x, y - 1)])) {
      if (simRandom() < ctx.params.materials[Cell.Water].poolingFactor!) {
        // replaceCellAt clears life/charge/override in lockstep, matching the
        // life<=0 conversions below so all three Steam->Water/Empty exits agree.
        w.replaceCellAt(ci, Cell.Water, waterColor());
        return;
      }
    }
  }
  if (w.life[ci] <= 0) {
    if (elementId === Cell.Steam && simRandom() < 0.15) {
      w.replaceCellAt(ci, Cell.Water, waterColor());
    } else {
      w.replaceCellAt(ci, Cell.Empty, EMPTY_COLOR);
    }
    return;
  }
  if (simRandom() < flowSpeed) {
    if (w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Empty) {
      w.swap(x, y, x, y - 1);
      return;
    }
    const dir = simRandom() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y - 1) && w.types[w.idx(x + dir, y - 1)] === Cell.Empty) {
      w.swap(x, y, x + dir, y - 1);
      return;
    }
    if (w.inBounds(x - dir, y - 1) && w.types[w.idx(x - dir, y - 1)] === Cell.Empty) {
      w.swap(x, y, x - dir, y - 1);
      return;
    }
    if (simRandom() < dispRate) {
      if (w.inBounds(x + dir, y) && w.types[w.idx(x + dir, y)] === Cell.Empty) {
        w.swap(x, y, x + dir, y);
        return;
      }
      if (w.inBounds(x - dir, y) && w.types[w.idx(x - dir, y)] === Cell.Empty) {
        w.swap(x, y, x - dir, y);
        return;
      }
    }
  }
}

const MARSH_CARDINALS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const;

/**
 * MARSH GAS: flammable bog vapor. Two differences from steam/smoke: it has NO
 * lifetime (the pocket persists until something lights it - the hazard the
 * player can see is the hazard that fires), and heat contact converts the cell
 * to flame INSTANTLY, so an ignited pocket burns as a racing front (one cell
 * per substep ~= the whoosh) instead of a polite smoulder.
 */
export function handleMarshGas(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // ignition first: adjacent heat lights THIS cell; the front finds the
  // neighbours on their own substeps
  for (let k = 0; k < MARSH_CARDINALS.length; k++) {
    const tx = x + MARSH_CARDINALS[k][0];
    const ty = y + MARSH_CARDINALS[k][1];
    if (!w.inBounds(tx, ty)) continue;
    const n = w.types[w.idx(tx, ty)];
    if (n === Cell.Fire || n === Cell.Lava || n === Cell.Ember) {
      const ci = w.idx(x, y);
      w.replaceCellAt(ci, Cell.Fire, fireColor());
      w.life[ci] = 22 + Math.floor(simRandom() * 14);
      if (fxRandom() < 0.06) {
        ctx.particles.spawn(
          x,
          y - 1,
          (fxRandom() - 0.5) * 0.5,
          -0.6 - fxRandom() * 0.5,
          null,
          packRGB(255, 190, 60),
          14,
          { grav: -0.02, glow: 2.2 },
        );
      }
      return;
    }
  }
  // faint shimmer: the pocket visibly ROILS, so the hazard reads in the dark
  // ("light is information" - a fuse the player can see is a fair fuse)
  if (simRandom() < 0.04) w.colors[w.idx(x, y)] = marshGasColor();
  const P = ctx.params.materials[Cell.MarshGas];
  if (simRandom() < P.floatSpeed!) {
    if (w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Empty) {
      w.swap(x, y, x, y - 1);
      return;
    }
    const dir = simRandom() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y - 1) && w.types[w.idx(x + dir, y - 1)] === Cell.Empty) {
      w.swap(x, y, x + dir, y - 1);
      return;
    }
    if (w.inBounds(x - dir, y - 1) && w.types[w.idx(x - dir, y - 1)] === Cell.Empty) {
      w.swap(x, y, x - dir, y - 1);
      return;
    }
    // blocked above: pool sideways under the ceiling
    if (simRandom() < P.dispersion!) {
      if (w.inBounds(x + dir, y) && w.types[w.idx(x + dir, y)] === Cell.Empty) {
        w.swap(x, y, x + dir, y);
        return;
      }
      if (w.inBounds(x - dir, y) && w.types[w.idx(x - dir, y)] === Cell.Empty) {
        w.swap(x, y, x - dir, y);
        return;
      }
    }
  }
}
