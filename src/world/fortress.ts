import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, fireColor, metalColor, packRGB, stoneColor, wallColor, woodColor } from '@/sim/colors';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Stamp a complete sandbox fortress centered in the current view. It is not a
 * level-compiler object: it writes real cells directly so every room, cache,
 * bridge, window, and hazard immediately participates in the simulation.
 */
export function spawnFortress(ctx: Ctx): void {
  const world = ctx.world;
  const cx = Math.floor(clamp(ctx.camera.renderX + VIEW_W / 2, 160, WIDTH - 160));
  const baseY = Math.floor(clamp(ctx.camera.renderY + VIEW_H - 34, 158, HEIGHT - 12));
  const x0 = cx - 136;
  const x1 = cx + 136;
  const topY = baseY - 142;

  const setCell = (x: number, y: number, type: Cell, color?: number): void => {
    if (!world.inBounds(x, y)) return;
    const i = world.idx(x, y);
    world.types[i] = type;
    world.colors[i] = color ?? (COLOR_FN[type]?.() ?? EMPTY_COLOR);
    world.life[i] = type === Cell.Fire ? 260 + Math.floor(Math.random() * 160) : 0;
    world.charge[i] = 0;
  };
  const fill = (xa: number, ya: number, xb: number, yb: number, type: Cell, color?: () => number): void => {
    const lx = Math.floor(Math.min(xa, xb));
    const rx = Math.floor(Math.max(xa, xb));
    const ty = Math.floor(Math.min(ya, yb));
    const by = Math.floor(Math.max(ya, yb));
    for (let y = ty; y <= by; y++) {
      for (let x = lx; x <= rx; x++) setCell(x, y, type, color?.());
    }
  };
  const clear = (xa: number, ya: number, xb: number, yb: number): void => fill(xa, ya, xb, yb, Cell.Empty, () => EMPTY_COLOR);
  const crenels = (xa: number, xb: number, y: number, type: Cell): void => {
    for (let x = xa; x <= xb; x += 10) fill(x, y - 6, x + 5, y - 1, type);
  };
  const slitWindow = (x: number, y: number): void => {
    fill(x - 1, y - 5, x + 1, y + 2, Cell.Glass);
    fill(x, y - 3, x, y, Cell.Empty, () => EMPTY_COLOR);
  };
  const torch = (x: number, y: number): void => {
    fill(x - 2, y + 2, x + 2, y + 2, Cell.Wood, woodColor);
    setCell(x - 1, y + 1, Cell.Fire, fireColor());
    setCell(x, y, Cell.Fire, fireColor());
    setCell(x + 1, y + 1, Cell.Fire, fireColor());
  };

  // Make room for the prefab and a little settling space below it.
  clear(x0 - 36, topY - 18, x1 + 36, baseY + 10);

  // Foundation, moat pockets, and a bridge.
  fill(x0 - 20, baseY + 1, x1 + 20, baseY + 6, Cell.Stone, stoneColor);
  fill(x0 - 36, baseY - 5, x0 - 8, baseY, Cell.Water);
  fill(x1 + 8, baseY - 5, x1 + 36, baseY, Cell.Water);
  fill(cx - 24, baseY - 4, cx + 24, baseY - 1, Cell.Wood, woodColor);

  // Main curtain wall: thick stone shell with a playable open interior.
  fill(x0, baseY - 76, x1, baseY, Cell.Stone, stoneColor);
  clear(x0 + 9, baseY - 70, x1 - 9, baseY - 7);
  fill(x0, baseY - 76, x1, baseY - 71, Cell.Wall, wallColor);
  fill(x0, baseY - 7, x1, baseY, Cell.Stone, stoneColor);
  fill(x0, baseY - 76, x0 + 8, baseY, Cell.Stone, stoneColor);
  fill(x1 - 8, baseY - 76, x1, baseY, Cell.Stone, stoneColor);
  crenels(x0 + 8, x1 - 8, baseY - 76, Cell.Stone);

  // Side towers.
  const towerW = 48;
  const leftA = x0 - 8;
  const leftB = x0 - 8 + towerW;
  const rightA = x1 + 8 - towerW;
  const rightB = x1 + 8;
  for (const [a, b] of [[leftA, leftB], [rightA, rightB]] as Array<[number, number]>) {
    fill(a, baseY - 118, b, baseY, Cell.Stone, stoneColor);
    clear(a + 8, baseY - 110, b - 8, baseY - 8);
    fill(a, baseY - 118, b, baseY - 112, Cell.Wall, wallColor);
    fill(a, baseY - 59, b, baseY - 55, Cell.Wood, woodColor);
    fill(a, baseY - 30, b, baseY - 26, Cell.Wood, woodColor);
    fill(a, baseY - 7, b, baseY, Cell.Stone, stoneColor);
    fill(a, baseY - 118, a + 7, baseY, Cell.Stone, stoneColor);
    fill(b - 7, baseY - 118, b, baseY, Cell.Stone, stoneColor);
    crenels(a, b, baseY - 118, Cell.Stone);
    slitWindow(Math.floor((a + b) / 2), baseY - 94);
    slitWindow(Math.floor((a + b) / 2), baseY - 43);
  }

  // Central keep with an alchemy room and a lookout.
  const keepA = cx - 46;
  const keepB = cx + 46;
  fill(keepA, topY + 6, keepB, baseY, Cell.Stone, stoneColor);
  clear(keepA + 9, topY + 15, keepB - 9, baseY - 8);
  fill(keepA, topY + 6, keepB, topY + 12, Cell.Wall, wallColor);
  fill(keepA, topY + 6, keepA + 8, baseY, Cell.Stone, stoneColor);
  fill(keepB - 8, topY + 6, keepB, baseY, Cell.Stone, stoneColor);
  fill(keepA, baseY - 94, keepB, baseY - 90, Cell.Wood, woodColor);
  fill(keepA, baseY - 52, keepB, baseY - 48, Cell.Wood, woodColor);
  fill(keepA, baseY - 7, keepB, baseY, Cell.Stone, stoneColor);
  crenels(keepA, keepB, topY + 6, Cell.Stone);
  slitWindow(cx - 22, topY + 36);
  slitWindow(cx + 22, topY + 36);
  slitWindow(cx - 24, baseY - 71);
  slitWindow(cx + 24, baseY - 71);

  // Gatehouse: an arched opening with a metal portcullis that can be blasted.
  clear(cx - 18, baseY - 35, cx + 18, baseY - 1);
  fill(cx - 22, baseY - 42, cx + 22, baseY - 36, Cell.Stone, stoneColor);
  for (let gx = cx - 14; gx <= cx + 14; gx += 5) fill(gx, baseY - 35, gx + 1, baseY - 2, Cell.Metal, metalColor);
  fill(cx - 18, baseY - 3, cx + 18, baseY, Cell.Empty, () => EMPTY_COLOR);

  // Ladders and interior travel.
  fill(leftA + 21, baseY - 109, leftA + 23, baseY - 8, Cell.Vines);
  fill(rightB - 23, baseY - 109, rightB - 21, baseY - 8, Cell.Vines);
  fill(cx - 2, topY + 16, cx + 2, baseY - 9, Cell.Vines);
  fill(x0 + 40, baseY - 59, keepA, baseY - 55, Cell.Wood, woodColor);
  fill(keepB, baseY - 59, x1 - 40, baseY - 55, Cell.Wood, woodColor);

  // Material story rooms: a volatile magazine, an alchemy shelf, and a small vault.
  fill(leftA + 12, baseY - 24, leftA + 26, baseY - 9, Cell.Gunpowder);
  fill(leftA + 29, baseY - 14, leftA + 36, baseY - 9, Cell.Oil);
  fill(leftA + 13, baseY - 73, leftA + 20, baseY - 68, Cell.Snow);
  fill(leftA + 24, baseY - 73, leftA + 33, baseY - 68, Cell.Coal);

  fill(cx - 33, baseY - 43, cx - 29, baseY - 39, Cell.ElixirLife);
  fill(cx - 23, baseY - 43, cx - 19, baseY - 39, Cell.ElixirLevity);
  fill(cx - 13, baseY - 43, cx - 9, baseY - 39, Cell.ElixirStone);
  fill(cx + 11, baseY - 43, cx + 16, baseY - 39, Cell.Toxic);
  fill(cx + 20, baseY - 43, cx + 25, baseY - 39, Cell.Teleportium);
  fill(cx - 35, baseY - 38, cx + 28, baseY - 37, Cell.Wood, woodColor);

  fill(rightA + 14, baseY - 22, rightB - 14, baseY - 9, Cell.Gold);
  fill(rightA + 10, baseY - 26, rightB - 10, baseY - 23, Cell.Metal, metalColor);
  fill(rightA + 15, baseY - 72, rightB - 15, baseY - 68, Cell.Glass);
  fill(rightA + 20, baseY - 67, rightB - 20, baseY - 64, Cell.Crystal);

  // Defensive details and light sources.
  torch(x0 + 28, baseY - 83);
  torch(x1 - 28, baseY - 83);
  torch(cx - 34, baseY - 101);
  torch(cx + 34, baseY - 101);
  fill(x0 - 20, baseY - 8, x0 - 9, baseY - 6, Cell.Sand);
  fill(x1 + 9, baseY - 8, x1 + 20, baseY - 6, Cell.Ash);

  // Flag, in pixels, on the keep.
  fill(cx, topY - 16, cx + 1, topY + 6, Cell.Metal, metalColor);
  fill(cx + 2, topY - 15, cx + 17, topY - 9, Cell.Wall, () => packRGB(168, 85, 247));
}
