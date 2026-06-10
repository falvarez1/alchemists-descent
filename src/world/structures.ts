import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type { Ctx, ExitPortal, LevelDef, Pickup, RegionGraph, Waystone } from '@/core/types';
import { makePickup, POTION_KINDS } from '@/game/Pickups';
import { Cell } from '@/sim/CellType';
import { goldColor, stoneColor } from '@/sim/colors';
import type { CardId } from '@/core/types';

/**
 * Landmark structures placed after generation (upgrade-port meta layer):
 * the exit portal beside the well mouth, a key vault on a far region, one
 * heart pocket, tome pedestals, chests, and loose gold along the arteries.
 * The golden key opens the portal; the well plug remains as the diggers'
 * secret bypass.
 */

const TOME_POOL: CardId[] = [
  'spark', 'bomb', 'lightning', 'flame', 'dig', 'warp', 'blackhole',
  'vitriol', 'frostshard', 'icelance', 'wisp', 'meteor', 'conjure', 'emberstorm',
  'double', 'triple', 'speed', 'heavy', 'spread', 'infuser', 'trigger', 'bounce',
];

export function placeStructures(
  ctx: Ctx,
  rng: Rng,
  graph: RegionGraph,
  def: LevelDef,
  exit: { x: number; sealY: number },
  waystones: Waystone[],
  spawn: { x: number; y: number },
): { pickups: Pickup[]; portal: ExitPortal | null } {
  const w = ctx.world;
  const pickups: Pickup[] = [];

  const carvePocket = (cx: number, cy: number, rx: number, ry: number): void => {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
        const X = cx + dx,
          Y = cy + dy;
        if (X < 2 || X >= WIDTH - 2 || Y < 2 || Y >= HEIGHT - 8) continue;
        const i = w.idx(X, Y);
        if (w.types[i] !== Cell.Metal) {
          w.types[i] = Cell.Empty;
          w.colors[i] = 0x08080c;
        }
      }
    }
  };

  /** Drop to the first standable floor below (cap 60 cells). */
  const settleY = (x: number, y: number): number => {
    for (let yy = y; yy < Math.min(HEIGHT - 8, y + 60); yy++) {
      const below = w.types[w.idx(x, yy + 1)];
      if (below !== Cell.Empty) return yy;
    }
    return y;
  };

  // ---- Exit portal: a carved shrine right above the well's seal plug ----
  const portalX = exit.x;
  const portalY = exit.sealY - 10;
  carvePocket(portalX, portalY, 11, 8);
  // stone frame pillars
  for (let dy = 0; dy < 9; dy++) {
    for (const side of [-7, 7]) {
      const i = w.idx(portalX + side, portalY + 4 - dy);
      w.types[i] = Cell.Stone;
      w.colors[i] = stoneColor();
    }
  }
  const portal: ExitPortal | null = def.nextLevelId ? { x: portalX, y: portalY, open: false } : null;

  // ---- Golden key vault: the main-path region farthest from the spawn ----
  if (portal) {
    let best = null as { cx: number; cy: number } | null;
    let bestD = -1;
    for (const reg of graph.regions) {
      if (!reg.onMainPath && reg.area < 250) continue;
      const d = Math.abs(reg.cx - spawn.x) + Math.abs(reg.cy - spawn.y) * 0.6;
      if (d > bestD) {
        bestD = d;
        best = { cx: reg.cx, cy: reg.cy };
      }
    }
    const kx = Math.floor(best ? best.cx : WIDTH - spawn.x);
    const kyBase = Math.floor(best ? best.cy : HEIGHT * 0.5);
    carvePocket(kx, kyBase, 9, 7);
    const ky = settleY(kx, kyBase);
    // gilded tell: a ring of gold flecks around the vault mouth
    for (let i = 0; i < 14; i++) {
      const a = rng.next() * Math.PI * 2;
      const rx2 = Math.floor(kx + Math.cos(a) * (10 + rng.next() * 3));
      const ry2 = Math.floor(kyBase + Math.sin(a) * (8 + rng.next() * 3));
      if (!w.inBounds(rx2, ry2)) continue;
      const ii = w.idx(rx2, ry2);
      if (w.types[ii] === Cell.Wall) {
        w.types[ii] = Cell.Gold;
        w.colors[ii] = goldColor();
      }
    }
    pickups.push(makePickup('key', kx, ky - 2));
  }

  // ---- One heart container in a quiet pocket ----
  const pocketRegions = graph.regions.filter((r2) => r2.isPocket && r2.area > 40);
  const heartReg =
    pocketRegions.length > 0
      ? pocketRegions[Math.floor(rng.next() * pocketRegions.length)]
      : graph.regions[Math.floor(rng.next() * Math.max(1, graph.regions.length))];
  if (heartReg) {
    const hx = Math.floor(heartReg.cx);
    const hy = settleY(hx, Math.floor(heartReg.cy));
    pickups.push(makePickup('heart', hx, hy - 2));
  }

  // ---- Tome pedestals: 1-2 spell tomes on stone plinths off the main path ----
  const tomes = 1 + (rng.next() < 0.5 ? 1 : 0);
  const sideRegions = graph.regions.filter((r2) => !r2.onMainPath && r2.area > 80);
  for (let t = 0; t < tomes && sideRegions.length > 0; t++) {
    const reg = sideRegions[Math.floor(rng.next() * sideRegions.length)];
    const tx = Math.floor(reg.cx);
    const ty = settleY(tx, Math.floor(reg.cy));
    // plinth
    for (let dy = 0; dy < 2; dy++) {
      const i = w.idx(tx, ty + 1 + dy);
      if (w.inBounds(tx, ty + 1 + dy)) {
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
      }
    }
    pickups.push(
      makePickup('tome', tx, ty - 1, { card: TOME_POOL[Math.floor(rng.next() * TOME_POOL.length)] }),
    );
  }

  // ---- Chests + loose gold piles along region centroids ----
  const chests = 2 + Math.floor(rng.next() * 2);
  for (let c = 0; c < chests && graph.regions.length > 0; c++) {
    const reg = graph.regions[Math.floor(rng.next() * graph.regions.length)];
    const cx = Math.floor(reg.cx + (rng.next() - 0.5) * 30);
    if (cx < 10 || cx > WIDTH - 10) continue;
    const cy = settleY(cx, Math.floor(reg.cy));
    pickups.push(makePickup('chest', cx, cy - 1));
  }
  const piles = 6 + Math.floor(rng.next() * 5);
  for (let g2 = 0; g2 < piles && graph.regions.length > 0; g2++) {
    const reg = graph.regions[Math.floor(rng.next() * graph.regions.length)];
    const gx = Math.floor(reg.cx + (rng.next() - 0.5) * 60);
    if (gx < 10 || gx > WIDTH - 10) continue;
    const gy = settleY(gx, Math.floor(reg.cy));
    pickups.push(
      makePickup('goldpile', gx, gy - 1, { amount: 15 + Math.floor(rng.next() * 30) }),
    );
  }
  // A scattered potion or two
  if (rng.next() < 0.8 && graph.regions.length > 0) {
    const reg = graph.regions[Math.floor(rng.next() * graph.regions.length)];
    const px = Math.floor(reg.cx);
    const py = settleY(px, Math.floor(reg.cy));
    pickups.push(
      makePickup('potion', px, py - 1, {
        potion: POTION_KINDS[Math.floor(rng.next() * POTION_KINDS.length)],
      }),
    );
  }

  // Waystone-adjacent welcome: a small gold pile near waystone[1] as a lure.
  if (waystones[1]) {
    pickups.push(
      makePickup('goldpile', waystones[1].x + 6, waystones[1].y - 2, { amount: 20 }),
    );
  }

  return { pickups, portal };
}
