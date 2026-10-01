import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

/**
 * LOOSE STOCK: the oil, gunpowder, water and sand that sit unsupported in open cave (the
 * skeleton's seed pockets, stray dunes) and FALL OR FLOW the moment the sim wakes them.
 *
 * A fixture the player stands at (a lever, a brazier, a waystone bowl, a glyph, the key, the
 * exit portal, Pell's camp, the valve's stage) must not have a pocket of it in its room: the
 * audit found levers 45% in oil, a waystone in five liquid cells, an echo stage 31% sand and a
 * portal ring half gunpowder at arrival. Removing stock only opens cells, so it can never cost
 * a route. A mass is cleared only when it touches open air (a seam laced through ore is bound
 * by its rock), is no larger than `maxCells` (a sea is a level's design, not a pocket) and holds
 * no cell another room owns (`held`).
 */

export const LOOSE = new Uint8Array(256);
for (const t of [Cell.Oil, Cell.Gunpowder, Cell.Water, Cell.Sand, Cell.Snow, Cell.Acid, Cell.Toxic, Cell.Blood, Cell.Slime, Cell.Nitrogen, Cell.Brine]) LOOSE[t] = 1;

export interface StockSite {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const N4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Clear every loose mass that touches open air inside the sites; returns the cells cleared. */
export function clearLooseStock(
  world: World,
  sites: readonly StockSite[],
  held: (x: number, y: number) => boolean,
  maxCells = 600,
): number {
  const W = world.width, H = world.height, types = world.types;
  const seen = new Uint8Array(W * H);
  const comp: number[] = [];
  let cleared = 0;
  for (const s of sites) {
    const x0 = Math.max(2, Math.floor(s.x0)), x1 = Math.min(W - 3, Math.ceil(s.x1));
    const y0 = Math.max(2, Math.floor(s.y0)), y1 = Math.min(H - 9, Math.ceil(s.y1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const start = x + y * W;
        if (seen[start] || !LOOSE[types[start]]) continue;
        comp.length = 0;
        comp.push(start);
        seen[start] = 1;
        let open = false, owned = false;
        // (the whole mass is walked even past `maxCells`, so an oversize one is marked seen whole:
        // stopping early left its far end to be taken for a small pocket of its own)
        for (let head = 0; head < comp.length; head++) {
          const i = comp[head];
          const cx = i % W, cy = (i / W) | 0;
          if (held(cx, cy)) owned = true;
          for (const [dx, dy] of N4) {
            const X = cx + dx, Y = cy + dy;
            if (X < 1 || X >= W - 1 || Y < 1 || Y >= H - 1) continue;
            const j = X + Y * W;
            if (types[j] === Cell.Empty) open = true;
            else if (LOOSE[types[j]] && !seen[j]) {
              seen[j] = 1;
              comp.push(j);
            }
          }
        }
        if (!open || owned || comp.length > maxCells) continue;
        for (const i of comp) {
          types[i] = Cell.Empty;
          world.colors[i] = 0x08080c;
          world.life[i] = 0;
          world.charge[i] = 0;
          world.activity.touchIndex(i);
        }
        cleared += comp.length;
      }
    }
  }
  return cleared;
}
