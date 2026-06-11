import type { Ctx } from '@/core/types';
import { Cell, isSolid } from '@/sim/CellType';
import { EMPTY_COLOR, vineColor } from '@/sim/colors';

export function handleVines(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  // Energy-budget growth: vines flourish briefly, slow down, then go dormant.
  // lifeGrid: 0 = freshly planted (charge it), >0 = growing energy, -1 = dormant.
  let energy = w.life[ci];
  if (energy === 0) {
    energy = 70 + Math.floor(Math.random() * 55);
    w.life[ci] = energy;
  }
  if (energy < 0) return;

  // Drink adjacent water: consumed water fuels fresh growth
  const sips = [
    [x, y - 1],
    [x, y + 1],
    [x - 1, y],
    [x + 1, y],
  ];
  for (const [wx, wy] of sips) {
    if (!w.inBounds(wx, wy) || w.types[w.idx(wx, wy)] !== Cell.Water) continue;
    if (Math.random() < 0.30) {
      const si = w.idx(wx, wy);
      if (Math.random() < 0.5) {
        w.types[si] = Cell.Vines;
        w.colors[si] = vineColor();
        w.life[si] = Math.min(130, energy + 45);
        w.moved[si] = w.movedTick;
      } else {
        w.types[si] = Cell.Empty;
        w.colors[si] = EMPTY_COLOR;
      }
      energy = Math.min(140, energy + 22);
      w.life[ci] = energy;
    }
    break;
  }

  // Growth chance tapers off as energy drains — fast at first, then a crawl, then stop
  const vigor = Math.min(1, energy / 55);
  if (Math.random() > 0.22 * vigor) return;

  const solidAt = (sx: number, sy: number) =>
    w.inBounds(sx, sy) && isSolid(w.types[w.idx(sx, sy)]) && w.types[w.idx(sx, sy)] !== Cell.Vines;
  const vineAt = (sx: number, sy: number) =>
    w.inBounds(sx, sy) && w.types[w.idx(sx, sy)] === Cell.Vines;
  const emptyAt = (sx: number, sy: number) =>
    w.inBounds(sx, sy) && w.types[w.idx(sx, sy)] === Cell.Empty;
  const sprout = (sx: number, sy: number) => {
    const si = w.idx(sx, sy);
    w.types[si] = Cell.Vines;
    w.colors[si] = vineColor();
    const child = energy - (11 + Math.floor(Math.random() * 12));
    w.life[si] = child > 6 ? child : -1;
    w.moved[si] = w.movedTick;
    energy -= 4;
    w.life[ci] = energy > 6 ? energy : -1;
  };

  const roll = Math.random();
  if (roll < 0.42) {
    // Hang downward — only while anchored above, and tendrils thin out fast
    if ((solidAt(x, y - 1) || vineAt(x, y - 1)) && emptyAt(x, y + 1)) sprout(x, y + 1);
  } else if (roll < 0.74) {
    // Creep sideways along surfaces (needs ground below or a wall to cling to)
    const dir = Math.random() < 0.5 ? 1 : -1;
    const tx = x + dir;
    if (
      emptyAt(tx, y) &&
      (solidAt(tx, y + 1) || solidAt(tx, y - 1) || solidAt(x, y + 1) || solidAt(x, y - 1))
    ) {
      sprout(tx, y);
    }
  } else {
    // Climb upward against walls
    const wall = solidAt(x - 1, y) || solidAt(x + 1, y);
    if (wall && emptyAt(x, y - 1)) sprout(x, y - 1);
  }

  // Old vines occasionally settle into dormancy on their own
  if (Math.random() < 0.003) w.life[ci] = -1;
}
