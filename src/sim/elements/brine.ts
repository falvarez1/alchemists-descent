import type { Ctx } from '@/core/types';
import { Cell, isGas } from '@/sim/CellType';
import { obsidianColor, packRGB, smokeColor, steamColor, waterColor } from '@/sim/colors';
import { CARDINAL_OFFSETS } from '@/sim/neighborOffsets';
import { fxRandom, simRandom } from '@/core/simRandom';

/**
 * BRINE (cell 42, the Cold Store): salt water kept below freezing. Its whole
 * character is what it REFUSES and what it UNDOES:
 *
 * - It never freezes. Liquid nitrogen that touches it boils off to vapour with
 *   a hiss (handleNitrogen only ever freezes fresh water), and a frost shard's
 *   splash passes it by — the gutters stay open when the pools beside them
 *   have turned to ice. (That is the Cold Store's first lesson: you cannot
 *   skate across brine.)
 * - It eats ice: every contact check, an ice cell it touches melts back to
 *   fresh water at `meltRange` odds (salt lowers the melting point), with a
 *   faint white fizz. A flask of brine poured on an ice wall opens it; brine
 *   run under an ice bridge undermines it.
 * - It is heavier than fresh water and sinks through it, so a brine sump
 *   under a pool stays brine at the bottom.
 * - It conducts (isConductor) and quenches lava to stone, and heat boils it.
 *
 * Movement is a plain cell liquid (swap-based, like blood and slime) — brine
 * is not part of the fresh-water flow field, so it pools on its own terms.
 */

function brineCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Oil || t === Cell.Steam || t === Cell.Smoke || t === Cell.MarshGas;
}

/** Salt melts ice (and snow faster): the contact checks run every substep the cell is awake. */
function eatIce(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const melt = ctx.params.materials[Cell.Brine].meltRange ?? 0.035;
  for (let k = 0; k < CARDINAL_OFFSETS.length; k++) {
    const o = CARDINAL_OFFSETS[k];
    const nx = x + o[0], ny = y + o[1];
    if (!w.inBounds(nx, ny)) continue;
    const ni = w.idx(nx, ny);
    const n = w.types[ni];
    if (n === Cell.Ice && simRandom() < melt) {
      w.replaceCellAt(ni, Cell.Water, waterColor());
      if (fxRandom() < 0.35) {
        ctx.particles.spawn(nx + 0.5, ny, (fxRandom() - 0.5) * 0.3, -0.25 - fxRandom() * 0.3, null,
          packRGB(226, 242, 246), 14 + Math.floor(fxRandom() * 10), { grav: -0.01, glow: 0.4 });
      }
    } else if (n === Cell.Snow && simRandom() < melt * 2.5) {
      w.replaceCellAt(ni, Cell.Water, waterColor());
    } else if (n === Cell.Nitrogen) {
      // A hard frost never takes brine: the nitrogen boils off it instead.
      w.replaceCellAt(ni, Cell.Smoke, smokeColor());
      w.life[ni] = 18;
    } else if (n === Cell.Lava) {
      // Like the sea on a lava flow: the lava skins to stone, the brine flashes.
      w.replaceCellAt(ni, Cell.Stone, obsidianColor());
      const ci = w.idx(x, y);
      w.replaceCellAt(ci, Cell.Steam, steamColor());
      w.life[ci] = 90;
      return;
    }
  }
}

export function handleBrine(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  eatIce(ctx, x, y);
  if (w.types[w.idx(x, y)] !== Cell.Brine) return;
  // Heavier than fresh water: brine sinks through it.
  if (w.inBounds(x, y + 1) && w.types[w.idx(x, y + 1)] === Cell.Water && simRandom() < 0.5) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (w.inBounds(x, y + 1) && brineCanPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = simRandom() < 0.5 ? 1 : -1;
  if (w.inBounds(x + dir, y + 1) && brineCanPass(w.types[w.idx(x + dir, y + 1)])) {
    w.swap(x, y, x + dir, y + 1);
    return;
  }
  if (w.inBounds(x - dir, y + 1) && brineCanPass(w.types[w.idx(x - dir, y + 1)])) {
    w.swap(x, y, x - dir, y + 1);
    return;
  }
  if (simRandom() < ctx.params.materials[Cell.Brine].flowRate!) {
    if (w.inBounds(x + dir, y) && brineCanPass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && brineCanPass(w.types[w.idx(x - dir, y)])) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
  // Resting brine glints: a salt fleck now and then on an open surface.
  if (fxRandom() < 0.004 && w.inBounds(x, y - 1) && (w.types[w.idx(x, y - 1)] === Cell.Empty || isGas(w.types[w.idx(x, y - 1)]))) {
    const i = w.idx(x, y);
    w.colors[i] = fxRandom() < 0.5 ? packRGB(222, 240, 242) : packRGB(92 + Math.floor(fxRandom() * 20), 164 + Math.floor(fxRandom() * 20), 176 + Math.floor(fxRandom() * 18));
  }
}
