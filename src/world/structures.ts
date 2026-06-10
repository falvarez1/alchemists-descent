import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp, hash2 } from '@/core/math';
import type { Rng } from '@/core/rng';
import type {
  Ctx,
  ExitPortal,
  LevelDef,
  Mechanism,
  Pickup,
  RegionGraph,
  RuneVault,
  Waystone,
} from '@/core/types';
import { makeBrazier, makeDoor, makeLever, makePlate } from '@/game/Mechanisms';
import { makePickup, POTION_KINDS } from '@/game/Pickups';
import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR, goldColor, packRGB, stoneColor } from '@/sim/colors';
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
): {
  pickups: Pickup[];
  portal: ExitPortal | null;
  mechanisms: Mechanism[];
  runeVaults: RuneVault[];
  boss: { x: number; y: number } | null;
} {
  const w = ctx.world;
  const pickups: Pickup[] = [];
  const mechanisms: Mechanism[] = [];
  const runeVaults: RuneVault[] = [];

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

  // ---- Mechanism-gated treasure vault: a sealed room whose metal door obeys
  //      a pressure plate, a lever, or a fire brazier placed just outside ----
  const FLOOR_BAND = HEIGHT - 52;
  for (let vaultIdx = 0; vaultIdx < 1 + (rng.next() < 0.5 ? 1 : 0); vaultIdx++) {
    let vx = 80 + Math.floor(rng.next() * (WIDTH - 160));
    for (let a = 0; a < 12; a++) {
      if (Math.abs(vx - spawn.x) > 220 && Math.abs(vx - portalX) > 160) break;
      vx = 80 + Math.floor(rng.next() * (WIDTH - 160));
    }
    const vy = Math.floor(HEIGHT * (0.3 + rng.next() * 0.42));
    // chamber: carved room with a stone floor
    carvePocket(vx, vy + 2, 13, 9);
    for (let dx = -13; dx <= 13; dx++) {
      const Y = vy + 9;
      if (w.inBounds(vx + dx, Y) && w.types[w.idx(vx + dx, Y)] === Cell.Empty) {
        const i = w.idx(vx + dx, Y);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
      }
    }
    // loot
    pickups.push(makePickup('chest', vx, vy + 8));
    if (rng.next() < 0.5) pickups.push(makePickup('heart', vx + 6, vy + 8));

    // entry corridor on a random side, sealed with a metal door
    const side = rng.next() < 0.5 ? -1 : 1;
    const doorX = vx + side * 13;
    for (let s = 0; s < 16; s++) {
      carvePocket(doorX + side * s, vy + 4 + Math.floor(Math.sin(s * 0.4) * 2), 5, 5);
    }
    const door = makeDoor(ctx, mechanisms, Math.min(doorX, doorX + side * 2) - 1, vy - 2, 4, 12);
    // mechanism alternates: plate puzzles and lever/brazier puzzles
    const mechRoll = (vaultIdx + (rng.next() < 0.5 ? 0 : 1)) % 3;
    const mx = Math.floor(clamp(doorX + side * 22, 8, WIDTH - 9));
    const my = settleY(mx, vy - 6);
    if (mechRoll === 0) makePlate(w, mechanisms, Math.floor(clamp(mx - 3, 4, WIDTH - 12)), my + 1, 7, door);
    else if (mechRoll === 1) makeLever(mechanisms, mx, my, door);
    else makeBrazier(w, mechanisms, mx, my, door);
  }

  // ---- Sealed rune vaults: metal strongrooms opened by a distant rune glyph ----
  let vPlaced = 0,
    vTries = 0;
  const vaultGoal = 1 + (rng.next() < 0.6 ? 1 : 0);
  while (vPlaced < vaultGoal && vTries < 12000) {
    vTries++;
    const vx = 40 + Math.floor(rng.next() * (WIDTH - 80));
    const vy = 90 + Math.floor(rng.next() * (FLOOR_BAND - 150));
    // need a MOSTLY solid region for the shell (>=90% rock, never overlap metal)
    let rock = 0,
      cells = 0,
      collide = false;
    for (let dy = -9; dy <= 9 && !collide; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        if (!w.inBounds(vx + dx, vy + dy)) {
          collide = true;
          break;
        }
        const t = w.types[w.idx(vx + dx, vy + dy)];
        if (t === Cell.Metal) {
          collide = true;
          break;
        }
        cells++;
        if (t === Cell.Wall) rock++;
      }
    }
    if (collide || rock / cells < 0.9) continue;
    // shell: metal box, interior hollow, stone door on the left wall
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -11; dx <= 11; dx++) {
        const ax2 = vx + dx,
          ay2 = vy + dy;
        const i = w.idx(ax2, ay2);
        const edge = Math.abs(dx) > 9 || Math.abs(dy) > 6;
        if (edge) {
          w.types[i] = Cell.Metal;
          const m2 = 0.8 + hash2(ax2, ay2, 99) * 0.3;
          w.colors[i] = packRGB(Math.floor(96 * m2), Math.floor(102 * m2), Math.floor(112 * m2));
        } else {
          w.types[i] = Cell.Empty;
          w.colors[i] = EMPTY_COLOR;
        }
      }
    }
    const doorCells: Array<[number, number]> = [];
    for (let dy = -4; dy <= 6; dy++) {
      for (let dx = -11; dx <= -10; dx++) {
        const ax2 = vx + dx,
          ay2 = vy + dy;
        const i = w.idx(ax2, ay2);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
        doorCells.push([ax2, ay2]);
      }
    }
    // loot inside
    pickups.push(makePickup('chest', vx + 3, vy + 5));
    pickups.push(
      makePickup('potion', vx - 3, vy + 5, {
        potion: POTION_KINDS[Math.floor(rng.next() * POTION_KINDS.length)],
      }),
    );
    if (rng.next() < 0.5) pickups.push(makePickup('heart', vx, vy + 5));
    for (let g3 = 0; g3 < 14; g3++) {
      const gx2 = vx - 6 + Math.floor(rng.next() * 13),
        gy2 = vy + 5 + Math.floor(rng.next() * 2);
      if (w.inBounds(gx2, gy2) && w.types[w.idx(gx2, gy2)] === Cell.Empty) {
        const i = w.idx(gx2, gy2);
        w.types[i] = Cell.Gold;
        w.colors[i] = goldColor();
      }
    }
    // the rune switch: a marked pedestal 70-240 cells away in open cave
    let rx = -1,
      ry = -1,
      rTries = 0;
    while (rTries < 3000) {
      rTries++;
      const cand = 14 + Math.floor(rng.next() * (WIDTH - 28));
      const candY = 40 + Math.floor(rng.next() * (FLOOR_BAND - 60));
      const dist = Math.abs(cand - vx) + Math.abs(candY - vy);
      if (dist < 70 || dist > 240) continue;
      if (
        w.types[w.idx(cand, candY)] !== Cell.Empty ||
        w.types[w.idx(cand, candY + 1)] !== Cell.Wall
      )
        continue;
      rx = cand;
      ry = candY;
      break;
    }
    if (rx < 0) continue;
    // pedestal
    for (let dx = -2; dx <= 2; dx++) {
      const i = w.idx(rx + dx, ry);
      w.types[i] = Cell.Metal;
      w.colors[i] = packRGB(88, 94, 104);
    }
    runeVaults.push({ rx, ry: ry - 2, door: doorCells, active: false });
    vPlaced++;
  }

  // ---- The Kiln (bottom level only): the colossus arena ----
  // A vast scorched chamber with lava moats, and the strategy hanging from
  // the ceiling: a metal-cased water tank sealed by a breakable stone plug.
  // Flood the kiln, thermal-shock the colossus.
  let boss: { x: number; y: number } | null = null;
  if (!def.nextLevelId) {
    const cx = Math.floor(WIDTH * (0.42 + rng.next() * 0.16));
    const cy = HEIGHT - 116;
    carvePocket(cx, cy, 38, 24);
    // stone floor band
    for (let dx = -38; dx <= 38; dx++) {
      for (let dy = 18; dy <= 21; dy++) {
        const X = cx + dx,
          Y = cy + dy;
        if (!w.inBounds(X, Y)) continue;
        const i = w.idx(X, Y);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
      }
    }
    // lava moats at the arena edges
    for (const side of [-1, 1]) {
      for (let dx = 26; dx <= 34; dx++) {
        for (let dy = 15; dy <= 17; dy++) {
          const i = w.idx(cx + side * dx, cy + dy);
          w.types[i] = Cell.Lava;
          w.colors[i] = packRGB(252, 60 + Math.floor(rng.next() * 60), 8);
        }
      }
    }
    // ceiling water tank: metal casing, breakable stone seal at its mouth
    const ty = cy - 24;
    for (let dx = -9; dx <= 9; dx++) {
      for (let dy = -8; dy <= 2; dy++) {
        const X = cx + dx,
          Y = ty + dy;
        if (!w.inBounds(X, Y)) continue;
        const i = w.idx(X, Y);
        const casing = Math.abs(dx) > 7 || dy < -6;
        if (casing) {
          w.types[i] = Cell.Metal;
          w.colors[i] = packRGB(96, 102, 112);
        } else if (dy <= 0) {
          w.types[i] = Cell.Water;
          w.colors[i] = packRGB(28, 120 + Math.floor(rng.next() * 60), 220);
        } else {
          // the seal: two rows of breakable stone — dig it, flood the kiln
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      }
    }
    // gold-flecked tell around the seal
    for (let g4 = 0; g4 < 8; g4++) {
      const gx = cx - 8 + Math.floor(rng.next() * 17);
      const i = w.idx(gx, ty + 3);
      if (w.types[i] === Cell.Empty) {
        w.types[i] = Cell.Gold;
        w.colors[i] = goldColor();
      }
    }
    boss = { x: cx, y: cy + 14 };
  }

  return { pickups, portal, mechanisms, runeVaults, boss };
}
