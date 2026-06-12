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
import {
  makeBrazier,
  makeBuoy,
  makeChargeLatch,
  makeDoor,
  makeLever,
  makePlate,
  makeScale,
} from '@/game/Mechanisms';
import { makePickup, POTION_KINDS } from '@/game/Pickups';
import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR, goldColor, packRGB, sandColor, stoneColor } from '@/sim/colors';
import type { CardId } from '@/core/types';
import {
  carvePocket as carvePocketCells,
  connectToCaves as connectToCavesFrom,
} from '@/world/connect';
import type { PlacementLedger } from '@/world/connect';

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
  cauldron: { x: number; y: number } | null,
  ledger: PlacementLedger,
  fits?: Uint8Array,
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

  const carvePocket = (cx: number, cy: number, rx: number, ry: number): void =>
    carvePocketCells(w, cx, cy, rx, ry);

  /** Drop to the first standable floor below (cap 60 cells). */
  const settleY = (x: number, y: number): number => {
    for (let yy = y; yy < Math.min(HEIGHT - 8, y + 60); yy++) {
      const below = w.types[w.idx(x, yy + 1)];
      if (below !== Cell.Empty) return yy;
    }
    return y;
  };

  /**
   * REACHABILITY GUARANTEE (shared primitive, see world/connect.ts): every
   * carved structure must join the cave network.
   */
  const connectToCaves = (fromX: number, fromY: number): void => {
    connectToCavesFrom(w, rng, graph, fromX, fromY, 12, fits);
  };

  // ---- Exit portal: a carved shrine right above the well's seal plug ----
  const portalX = exit.x;
  const portalY = exit.sealY - 10;
  carvePocket(portalX, portalY, 26, 12); // wide: spans the well casing columns
  // walk-in ramps: open channels from the floor strip up into the shrine on
  // both flanks, OUTSIDE the casing (carvePocket never breaches its Metal)
  carvePocket(portalX - 22, portalY + 6, 8, 15);
  carvePocket(portalX + 22, portalY + 6, 8, 15);
  // ...and the shrine earns its own tunnel to the network — the floor strip
  // is not guaranteed to be wizard-connected to spawn on every seed
  connectToCaves(portalX - 22, portalY - 2);
  connectToCaves(portalX + 22, portalY - 2);
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
      // Never seat the key on reserved ground: door-gated prefab interiors
      // are reserved rects, and the findability BFS does not open doors.
      if (ledger.intersects(reg.cx, reg.cy, reg.cx, reg.cy)) continue;
      const d = Math.abs(reg.cx - spawn.x) + Math.abs(reg.cy - spawn.y) * 0.6;
      if (d > bestD) {
        bestD = d;
        best = { cx: reg.cx, cy: reg.cy };
      }
    }
    const kx = Math.floor(best ? best.cx : WIDTH - spawn.x);
    const kyBase = Math.floor(best ? best.cy : HEIGHT * 0.5);
    carvePocket(kx, kyBase, 11, 12); // walk-in promise (ellipse law 0.67)
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
    // The key gates progression: its vault is always walkable, never a dig
    connectToCaves(kx - 8, kyBase);
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

  // Checkpoints are promises: every waystone (and the cauldron beside the
  // first one) must be walkable, not an archaeology project.
  for (const ws of waystones) connectToCaves(ws.x, ws.y - 4);
  if (cauldron) connectToCaves(cauldron.x, cauldron.y - 4);

  // ---- Mechanism-gated treasure vault: a sealed room whose metal door obeys
  //      a pressure plate, a lever, or a fire brazier placed just outside ----
  const FLOOR_BAND = HEIGHT - 52;
  for (let vaultIdx = 0; vaultIdx < 1 + (rng.next() < 0.5 ? 1 : 0); vaultIdx++) {
    let vx = 130 + Math.floor(rng.next() * (WIDTH - 260));
    for (let a = 0; a < 12; a++) {
      if (Math.abs(vx - spawn.x) > 220 && Math.abs(vx - portalX) > 160) break;
      vx = 130 + Math.floor(rng.next() * (WIDTH - 260));
    }
    let vy = Math.floor(HEIGHT * (0.3 + rng.next() * 0.42));
    // Reserved-ground dodge (inert while the ledger is empty): re-roll the
    // vault site while its widest possible extent overlaps a reserved rect.
    // Bounded, then place anyway — a vault is never silently skipped.
    for (let a = 0; a < 24 && ledger.intersects(vx - 44, vy - 8, vx + 44, vy + 12); a++) {
      vx = 130 + Math.floor(rng.next() * (WIDTH - 260));
      vy = Math.floor(HEIGHT * (0.3 + rng.next() * 0.42));
    }
    // chamber: carved room with a stone floor
    carvePocket(vx, vy, 14, 12); // floor at the pocket BOTTOM: >= 22 above it
    for (let dx = -13; dx <= 13; dx++) {
      const Y = vy + 11;
      if (w.inBounds(vx + dx, Y) && w.types[w.idx(vx + dx, Y)] === Cell.Empty) {
        const i = w.idx(vx + dx, Y);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
      }
    }
    // loot
    pickups.push(makePickup('chest', vx, vy + 10));
    if (rng.next() < 0.5) pickups.push(makePickup('heart', vx + 6, vy + 10));

    // entry corridor on a random side, sealed with a metal door
    const side = rng.next() < 0.5 ? -1 : 1;
    const doorX = vx + side * 13;
    for (let s = 0; s < 16; s++) {
      carvePocket(doorX + side * s, vy + 2 + Math.floor(Math.sin(s * 0.4) * 2), 10, 12);
    }
    const door = makeDoor(ctx, mechanisms, Math.min(doorX, doorX + side * 2) - 1, vy - 8, 4, 22);
    // mechanism alternates: plate puzzles and lever/brazier puzzles.
    // The trigger gets its own carved antechamber with a stone shelf —
    // contiguous with the corridor, so it is always standing in walkable
    // space instead of wherever settleY happened to drop it.
    const mechRoll = (vaultIdx + (rng.next() < 0.5 ? 0 : 1)) % 3;
    const mx = Math.floor(clamp(doorX + side * 22, 10, WIDTH - 11));
    carvePocket(mx, vy, 11, 12); // shelf at the pocket BOTTOM (no mid-bar)
    for (let dx = -10; dx <= 10; dx++) {
      const Y = vy + 11;
      if (w.inBounds(mx + dx, Y) && w.types[w.idx(mx + dx, Y)] === Cell.Empty) {
        const i = w.idx(mx + dx, Y);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
      }
    }
    const my = vy + 10;
    if (mechRoll === 0) makePlate(w, mechanisms, Math.floor(clamp(mx - 3, 4, WIDTH - 12)), my + 1, 7, door);
    else if (mechRoll === 1) makeLever(mechanisms, mx, my, door);
    else makeBrazier(w, mechanisms, mx, my, door);
    // the antechamber joins the cave network
    connectToCaves(mx + side * 6, vy + 2);
  }

  // ---- Sealed rune vaults: metal strongrooms opened by a distant rune glyph ----
  let vPlaced = 0,
    vTries = 0;
  const vaultGoal = 1 + (rng.next() < 0.6 ? 1 : 0);
  while (vPlaced < vaultGoal && vTries < 12000) {
    vTries++;
    const vx = 40 + Math.floor(rng.next() * (WIDTH - 80));
    const vy = 90 + Math.floor(rng.next() * (FLOOR_BAND - 150));
    // reserved ground (prefab footprints etc.) is off limits
    if (ledger.intersects(vx - 14, vy - 13, vx + 14, vy + 13)) continue;
    // need a MOSTLY solid region for the shell (>=90% rock, never overlap metal)
    let rock = 0,
      cells = 0,
      collide = false;
    for (let dy = -13; dy <= 13 && !collide; dy++) {
      for (let dx = -14; dx <= 14; dx++) {
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
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -13; dx <= 13; dx++) {
        const ax2 = vx + dx,
          ay2 = vy + dy;
        const i = w.idx(ax2, ay2);
        const edge = Math.abs(dx) > 11 || Math.abs(dy) > 10;
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
    for (let dy = -6; dy <= 10; dy++) {
      for (let dx = -13; dx <= -12; dx++) {
        const ax2 = vx + dx,
          ay2 = vy + dy;
        const i = w.idx(ax2, ay2);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
        doorCells.push([ax2, ay2]);
      }
    }
    // loot inside
    pickups.push(makePickup('chest', vx + 3, vy + 9));
    pickups.push(
      makePickup('potion', vx - 3, vy + 9, {
        potion: POTION_KINDS[Math.floor(rng.next() * POTION_KINDS.length)],
      }),
    );
    if (rng.next() < 0.5) pickups.push(makePickup('heart', vx, vy + 9));
    for (let g3 = 0; g3 < 14; g3++) {
      const gx2 = vx - 6 + Math.floor(rng.next() * 13),
        gy2 = vy + 9 + Math.floor(rng.next() * 2);
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
    // pedestal — tunneled to the network so the glyph can actually be found
    for (let dx = -2; dx <= 2; dx++) {
      const i = w.idx(rx + dx, ry);
      w.types[i] = Cell.Metal;
      w.colors[i] = packRGB(88, 94, 104);
    }
    connectToCaves(rx, ry - 3);
    runeVaults.push({ rx, ry: ry - 2, door: doorCells, active: false });
    // approach antechamber outside the stone door, tunneled to the caves —
    // once the rune is struck and the door dissolves, you walk straight in
    carvePocket(vx - 20, vy + 2, 9, 12);
    connectToCaves(vx - 21, vy + 2);
    vPlaced++;
  }

  // ---- Wave E puzzle chamber (depth 2+): a lock made of physics ----
  // One archetype per level, rotating with depth: Sand Scale (pour weight
  // onto the pan), Burning Seals (light ALL three braziers), Sluice (pool
  // liquid past the buoy line), Charge Latch (bring it a spark). The loot
  // pocket behind the gate carries a chest, gold, and a tome.
  if (def.depth >= 2) {
    // Progressive relaxation: prefer deep solid rock far from the landmarks,
    // but NEVER skip — a level without its lock is a broken promise.
    let px2 = -1,
      py2 = -1,
      pTries = 0;
    while (pTries < 9000) {
      pTries++;
      const rockMin = pTries < 4000 ? 0.82 : pTries < 7000 ? 0.5 : 0;
      const clearMin = pTries < 4000 ? 160 : pTries < 7000 ? 100 : 60;
      const cand = 130 + Math.floor(rng.next() * (WIDTH - 260));
      const candY = 100 + Math.floor(rng.next() * (HEIGHT - 280));
      if (Math.abs(cand - spawn.x) < clearMin || Math.abs(cand - portalX) < clearMin * 0.75)
        continue;
      // reserved ground (prefab footprints etc.) is off limits at every tier
      if (ledger.intersects(cand - 20, candY - 12, cand + 20, candY + 12)) continue;
      // no metal collisions; rock fraction per current relaxation tier
      let rock = 0,
        cells = 0,
        collide = false;
      for (let dy = -12; dy <= 12 && !collide; dy++) {
        for (let dx = -20; dx <= 20; dx++) {
          if (!w.inBounds(cand + dx, candY + dy)) {
            collide = true;
            break;
          }
          const t = w.types[w.idx(cand + dx, candY + dy)];
          if (t === Cell.Metal) {
            collide = true;
            break;
          }
          cells++;
          if (t === Cell.Wall) rock++;
        }
      }
      if (collide || rock / cells < rockMin) continue;
      px2 = cand;
      py2 = candY;
      break;
    }
    if (px2 >= 0) {
      const archetype = (def.depth + Math.floor(rng.next() * 2)) % 4;
      // main chamber + sealed loot pocket on the right
      carvePocket(px2, py2, 16, 12); // floor at the pocket BOTTOM
      for (let dx = -16; dx <= 16; dx++) {
        const Y = py2 + 11;
        if (w.inBounds(px2 + dx, Y) && w.types[w.idx(px2 + dx, Y)] === Cell.Empty) {
          const i = w.idx(px2 + dx, Y);
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      }
      carvePocket(px2 + 26, py2 + 1, 10, 12);
      const door = makeDoor(ctx, mechanisms, px2 + 15, py2 - 9, 3, 20);
      pickups.push(makePickup('chest', px2 + 26, py2 + 9));
      pickups.push(
        makePickup('goldpile', px2 + 29, py2 + 9, { amount: 30 + Math.floor(rng.next() * 30) }),
      );
      pickups.push(
        makePickup('tome', px2 + 23, py2 + 9, {
          card: TOME_POOL[Math.floor(rng.next() * TOME_POOL.length)],
        }),
      );

      const floorY = py2 + 10;
      if (archetype === 0) {
        // SAND SCALE + a diggable sand hopper in the ceiling above the pan
        makeScale(w, mechanisms, px2 - 10, floorY, 7, 24, door);
        for (let dx = -4; dx <= 4; dx++) {
          for (let dy = -3; dy <= 1; dy++) {
            const X = px2 - 7 + dx,
              Y = py2 - 12 + dy;
            if (!w.inBounds(X, Y)) continue;
            const i = w.idx(X, Y);
            const shell = Math.abs(dx) === 4 || dy === -3;
            if (shell) {
              w.types[i] = Cell.Stone;
              w.colors[i] = stoneColor();
            } else {
              w.types[i] = Cell.Sand;
              w.colors[i] = sandColor();
            }
          }
        }
        // a one-cell stone lip holds the hopper shut — dig it
        for (let dx = -3; dx <= 3; dx++) {
          const i = w.idx(px2 - 7 + dx, py2 - 10);
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      } else if (archetype === 1) {
        // BURNING SEALS: all three braziers must roar at once
        makeBrazier(w, mechanisms, px2 - 11, floorY - 1, door);
        makeBrazier(w, mechanisms, px2 - 4, floorY - 1, door);
        makeBrazier(w, mechanisms, px2 + 3, floorY - 1, door);
      } else if (archetype === 2) {
        // SLUICE: a stone basin + buoy; the water is in a ceiling pocket
        const basin: Array<[number, number]> = [];
        for (let dx = -7; dx <= 7; dx++) {
          for (const dy of [0, 1]) {
            const X = px2 - 4 + dx,
              Y = floorY - dy;
            if (Math.abs(dx) === 7 || dy === 0) {
              const i = w.idx(X, Y);
              w.types[i] = Cell.Stone;
              w.colors[i] = stoneColor();
              basin.push([X, Y]);
            }
          }
        }
        makeBuoy(
          mechanisms,
          px2 - 4,
          floorY - 1,
          { x0: px2 - 10, y0: floorY - 4, x1: px2 + 2, y1: floorY - 1 },
          26,
          door,
          basin,
        );
        // ceiling water pocket sealed by a stone plug
        for (let dx = -4; dx <= 4; dx++) {
          for (let dy = -3; dy <= 0; dy++) {
            const X = px2 - 4 + dx,
              Y = py2 - 11 + dy;
            const i = w.idx(X, Y);
            const shell = Math.abs(dx) === 4 || dy === -3;
            if (shell) {
              w.types[i] = Cell.Metal;
              w.colors[i] = packRGB(96, 102, 112);
            } else {
              w.types[i] = Cell.Water;
              w.colors[i] = packRGB(28, 140, 224);
            }
          }
        }
        for (let dx = -3; dx <= 3; dx++) {
          const i = w.idx(px2 - 4 + dx, py2 - 10);
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      } else {
        // CHARGE LATCH: bring the coil a spark — lightning, charged water,
        // anything the conductors will carry
        makeChargeLatch(w, mechanisms, px2 - 8, floorY, door);
      }

      // The chamber joins the cave network through its left mouth.
      connectToCaves(px2 - 17, py2 + 3);
    }
  }

  // ---- The Kiln (bottom level only): the colossus arena ----
  // A vast scorched chamber with lava moats, and the strategy hanging from
  // the ceiling: a metal-cased water tank sealed by a breakable stone plug.
  // Flood the kiln, thermal-shock the colossus.
  let boss: { x: number; y: number } | null = null;
  if (!def.nextLevelId) {
    let cx = Math.floor(WIDTH * (0.42 + rng.next() * 0.16));
    const cy = HEIGHT - 116;
    // Reserved-ground dodge (inert while the ledger is empty); bounded, then
    // the arena is carved regardless — the kiln must exist.
    for (let a = 0; a < 12 && ledger.intersects(cx - 40, cy - 26, cx + 40, cy + 24); a++) {
      cx = Math.floor(WIDTH * (0.42 + rng.next() * 0.16));
    }
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
    // both arena flanks join the cave network — the kiln must be findable
    connectToCaves(cx - 39, cy + 6);
    connectToCaves(cx + 39, cy + 6);
  }

  return { pickups, portal, mechanisms, runeVaults, boss };
}
