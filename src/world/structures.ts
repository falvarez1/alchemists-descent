import { HEIGHT, WIDTH } from '@/config/constants';
import { randomCard, TOME_REWARD_POOL } from '@/content/cardRewardPools';
import { clamp, hash2 } from '@/core/math';
import type { Rng } from '@/core/rng';
import type {
  AuthoredLight,
  Ctx,
  EnemyKind,
  ExitPortal,
  HazardEmitter,
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
  makeSensor,
  makeValve,
  setValveCells,
} from '@/core/mechanismFactories';
import { makePickup, POTION_KINDS } from '@/core/pickupDefs';
import { Cell } from '@/sim/CellType';
import {
  EMPTY_COLOR,
  goldColor,
  packRGB,
  sandColor,
  stoneColor,
} from '@/sim/colors';
import {
  carvePocket as carvePocketCells,
  carveRect as carveRectCells,
  connectToCaves as connectToCavesFrom,
  inFootprint,
  sealedFootprints,
  tunnelTo,
} from '@/world/connect';
import type { PlacementLedger } from '@/world/connect';
import { reserveFooting, runeFooting, triggerFooting } from '@/world/fixtureFooting';
import { wizardMask } from '@/world/validate';
import { buildIceHouse, buildLensRoom } from '@/world/wardenArenas';
import type { KilnFlueSite } from '@/core/story';
import { carveKilnFlue, planKilnFlue, repairKilnFlue } from '@/world/kilnFlue';

/**
 * Landmark structures placed after generation (upgrade-port meta layer):
 * the exit portal, a key vault on a far region, the D1 Refuge/bench, one heart
 * pocket, tome pedestals, chests, and loose gold along the arteries. The
 * golden key opens the portal; D1 also requires the bench lesson before descent.
 */

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
  boss: { x: number; y: number; kind?: EnemyKind } | null;
  emitters: HazardEmitter[];
  authoredLights: AuthoredLight[];
  refuge: { x: number; y: number } | null;
  spellLab: { x: number; y: number; rewardX: number; rewardY: number } | null;
  /** Re-asserts the Sump's casing, plugs, and pool AFTER the gauge-rescue
   *  pass — rescue tunnels eat all stone and spare only metal, and one
   *  wandering carve through the arena pre-opened all three drains
   *  (observed). The casing is metal and survives; this puts back what
   *  can't be armored. */
  /** Re-asserts the Sump's organs; `rim: false` skips the rock rim (after the
   *  final gauge rescue, whose tunnels may need their way through it). */
  sumpRepair: ((rim?: boolean) => void) | null;
  /** Re-asserts the Kiln's ceiling tank (casing, stone seal, water) after the
   *  gauge-rescue passes. Stone-eating carves (the arena's own flank connector,
   *  then rescue tunnels) opened its seal at generation on most seeds (QA seed
   *  4), flooding the Colossus before the player ever arrived. The seal is the
   *  player's to dig. */
  kilnRepair: (() => void) | null;
  /** Re-asserts a second-door guardian's hall (world/wardenArenas); `floor: false` after the final rescue. */
  wardenRepair: ((floor?: boolean) => void) | null;
  /** STORY (wave 3): the old flue beside the Kiln that the escape climbs (floor 4 only). */
  kilnFlue: KilnFlueSite | null;
} {
  const w = ctx.world;
  const pickups: Pickup[] = [];
  const mechanisms: Mechanism[] = [];
  const runeVaults: RuneVault[] = [];
  const emitters: HazardEmitter[] = [];
  const authoredLights: AuthoredLight[] = [];
  const refuge: { x: number; y: number } | null = null;
  const spellLab: { x: number; y: number; rewardX: number; rewardY: number } | null = null;
  let sumpRepair: ((rim?: boolean) => void) | null = null;
  let kilnRepair: (() => void) | null = null;
  let wardenRepair: ((floor?: boolean) => void) | null = null;
  let kilnFlue: KilnFlueSite | null = null;

  const carvePocket = (cx: number, cy: number, rx: number, ry: number): void =>
    carvePocketCells(w, cx, cy, rx, ry);

  /** Carve a pocket room and lay a flat stone shelf one row below its bottom —
   *  the standard puzzle-chamber floor. Only fills Empty cells (so it never
   *  vandalizes a Metal pedestal), matching every hand-inlined copy this
   *  replaces. `floorHalfW` spans the walkable sill (independent of the room
   *  radius). */
  const carveRoomWithFloor = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    floorHalfW: number,
  ): void => {
    carvePocket(cx, cy, rx, ry);
    const Y = cy + 11;
    for (let dx = -floorHalfW; dx <= floorHalfW; dx++) {
      if (w.inBounds(cx + dx, Y) && w.types[w.idx(cx + dx, Y)] === Cell.Empty) {
        const i = w.idx(cx + dx, Y);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
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

  /**
   * REACHABILITY GUARANTEE (shared primitive, see world/connect.ts): every
   * carved structure must join the cave network.
   */
  // Like every carve after a sealed feature exists (world/connect
  // sealedFootprints), these walk around the ones already reserved — the Sump,
  // a warden's hall. A connector leaving from inside one is its own and is
  // not kept out; with none reserved yet, the walk is exactly the old one.
  const connectToCaves = (fromX: number, fromY: number): void => {
    connectToCavesFrom(w, rng, graph, fromX, fromY, 12, fits, undefined, sealedFootprints(ledger));
  };
  const connectVaultTriggerAntechamber = (fromX: number, fromY: number, side: number): void => {
    const sweep = { halfW: 7, up: 21, down: 9 };
    const sealed = sealedFootprints(ledger);
    let best: { cx: number; cy: number } | null = null;
    let bestD = Infinity;
    for (const onlyMain of [true, false]) {
      for (const reg of graph.regions) {
        if (side * (reg.cx - fromX) < 24) continue;
        if (inFootprint(sealed, reg.cx, reg.cy)) continue;
        if (onlyMain && !reg.onMainPath) continue;
        if (!onlyMain && reg.area < 60) continue;
        const d = (reg.cx - fromX) * (reg.cx - fromX) + (reg.cy - fromY) * (reg.cy - fromY);
        if (d < bestD) {
          bestD = d;
          best = { cx: reg.cx, cy: reg.cy };
        }
      }
      if (best) break;
    }
    if (best) {
      tunnelTo(w, rng, fromX, fromY, Math.floor(best.cx), Math.floor(best.cy), 12, sweep, 26, sealed);
    } else {
      connectToCavesFrom(w, rng, graph, fromX, fromY, 12, fits, sweep, sealed);
    }
  };
  const vaultTriggerSide = (vx: number, vy: number, randomSide: number): number => {
    const reachable = wizardMask({ world: w, spawn });
    const score = (side: number): number => {
      const cx = Math.floor(vx + side * 35);
      const cy = Math.floor(vy + 10);
      let count = 0;
      for (let dy = -28; dy <= 28; dy++) {
        for (let dx = -28; dx <= 28; dx++) {
          const X = cx + dx;
          const Y = cy + dy;
          if (X <= 0 || Y <= 0 || X >= WIDTH || Y >= HEIGHT) continue;
          if (reachable[X + Y * WIDTH]) count++;
        }
      }
      return count;
    };
    const randomScore = score(randomSide);
    const oppositeScore = score(-randomSide);
    return oppositeScore > randomScore ? -randomSide : randomSide;
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

  // D1 (the only depth-1 level) is generated by world/breathingWorks.ts and
  // never reaches this pass: its refuge is authored there, and the procedural
  // D1 refuge / Spell Lab that lived here were removed as unreachable.

  // ---- Golden key vault: the main-path region farthest from the spawn ----
  if (portal) {
    let best = null as { cx: number; cy: number } | null;
    let bestD = -1;
    for (const reg of graph.regions) {
      if (!reg.onMainPath && reg.area < 250) continue;
      // Never seat the key on reserved ground: door-gated prefab interiors
      // are reserved rects, and the findability BFS does not open doors.
      if (ledger.intersects(reg.cx - 15, reg.cy - 15, reg.cx + 15, reg.cy + 15)) continue;
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
    // The key gates progression: its vault is always walkable, never a dig —
    // and it gets the SWEPT gauge gallery, because a disc-chain connector
    // only promises 9x17 clearance on its centerline
    connectToCavesFrom(w, rng, graph, kx - 8, kyBase, 12, fits, { halfW: 7, up: 21, down: 9 }, sealedFootprints(ledger));
  }

  // ---- One heart container in a quiet pocket ----
  const pocketRegions = graph.regions.filter(
    (r2) => r2.isPocket && r2.area > 40 && !ledger.intersects(r2.cx - 4, r2.cy - 4, r2.cx + 4, r2.cy + 8),
  );
  const heartReg =
    pocketRegions.length > 0
      ? pocketRegions[Math.floor(rng.next() * pocketRegions.length)]
      : graph.regions[Math.floor(rng.next() * Math.max(1, graph.regions.length))];
  if (heartReg) {
    const hx = Math.floor(heartReg.cx);
    const hy = settleY(hx, Math.floor(heartReg.cy));
    pickups.push(makePickup('heart', hx, hy - 2));
    // Pocket regions are by definition off the main path, so tunnel the heart
    // to the cave network like every other landmark — otherwise the findability
    // audit can grade it unreachable.
    connectToCaves(hx, hy - 4);
  }

  // ---- Tome pedestals: 1-2 spell tomes on stone plinths off the main path ----
  const tomes = 1 + (rng.next() < 0.5 ? 1 : 0);
  const sideRegions = graph.regions.filter(
    (r2) => !r2.onMainPath && r2.area > 80 && !ledger.intersects(r2.cx - 4, r2.cy - 4, r2.cx + 4, r2.cy + 8),
  );
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
      makePickup('tome', tx, ty - 1, { card: randomCard(TOME_REWARD_POOL, () => rng.next()) }),
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
      makePickup('goldpile', gx, gy - 1, { amount: 5 + Math.floor(rng.next() * 10) }),
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
      makePickup('goldpile', waystones[1].x + 6, waystones[1].y - 2, { amount: 8 }),
    );
  }

  // Checkpoints are promises: every waystone (and the cauldron beside the
  // first one) must be walkable, not an archaeology project. The connector
  // leaves from ABOVE the bowl — its first disc stops two rows over the
  // pillars — and walks around the reserved footing (world/fixtureFooting).
  // It used to start AT the bowl (y - 4) and take the bowl and eight rows of
  // floor with it: 30/30 waystones and 15/15 cauldrons floated (QA 2026-09-28).
  for (const ws of waystones) connectToCaves(ws.x, ws.y - 14);
  if (cauldron) connectToCaves(cauldron.x, cauldron.y - 14);

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
    // vault site while its widest possible extent overlaps a reserved rect —
    // keeping the spawn/portal clearance above, or a re-rolled vault's door
    // slab could seal the arrival's own cave from the level (d2 expedition 24,
    // GEN 61: a door 70 cells from the spawn cut its reach from 16068 to 4515
    // cells, and the lair and both light puzzles found no way in).
    // Bounded, then place anyway — a vault is never silently skipped.
    const vaultClear = (): boolean => Math.abs(vx - spawn.x) > 220 && Math.abs(vx - portalX) > 160;
    for (let a = 0; a < 24 && (ledger.intersects(vx - 44, vy - 8, vx + 44, vy + 12) || !vaultClear()); a++) {
      vx = 130 + Math.floor(rng.next() * (WIDTH - 260));
      vy = Math.floor(HEIGHT * (0.3 + rng.next() * 0.42));
    }
    // chamber: carved room with a stone floor (>= 22 clear above the shelf)
    carveRoomWithFloor(vx, vy, 14, 12, 13);
    // loot
    pickups.push(makePickup('chest', vx, vy + 10));
    if (rng.next() < 0.5) pickups.push(makePickup('heart', vx + 6, vy + 10));

    // entry corridor on a random side, sealed with a metal door
    const side = vaultTriggerSide(vx, vy, rng.next() < 0.5 ? -1 : 1);
    const doorX = vx + side * 13;
    for (let s = 0; s < 16; s++) {
      carvePocket(doorX + side * s, vy + 2 + Math.floor(Math.sin(s * 0.4) * 2), 10, 12);
    }
    const door = makeDoor(ctx, mechanisms, Math.min(doorX, doorX + side * 2) - 1, vy - 8, 4, 22);
    // mechanism archetype: plate / lever / brazier puzzles, rolled uniformly.
    // (The old `(vaultIdx + bit) % 3` made the brazier reachable ONLY on a 2nd
    // vault's 1-bit — so it almost never appeared. Same single rng draw, so the
    // stream position is unchanged; only the chosen mechanism differs.)
    // The trigger gets its own carved antechamber with a stone shelf —
    // contiguous with the corridor, so it is always standing in walkable
    // space instead of wherever settleY happened to drop it.
    const mechRoll = Math.floor(rng.next() * 3);
    const mx = Math.floor(clamp(doorX + side * 22, 10, WIDTH - 11));
    carveRoomWithFloor(mx, vy, 11, 12, 10); // shelf at the pocket BOTTOM (no mid-bar)
    const my = vy + 10;
    const trigger =
      mechRoll === 0 ? makePlate(w, mechanisms, Math.floor(clamp(mx - 3, 4, WIDTH - 12)), my + 1, 7, door)
      : mechRoll === 1 ? makeLever(mechanisms, mx, my, door)
      : makeBrazier(w, mechanisms, mx, my, door);
    reserveFooting(ledger, triggerFooting(trigger), trigger.kind);
    // The trigger is hands-on: connect the antechamber on the trigger's side of
    // the door with the swept wizard gauge, so the nearest-main-path tunnel
    // cannot route through the door slab and leave the plate body-unreachable.
    // It leaves from high in the antechamber (disc and gallery stop above the
    // shelf at vy + 11) and walks around the trigger's footing: from vy + 2 it
    // cut the shelf from under the lever — 18 triggers drawn in mid-air.
    connectVaultTriggerAntechamber(mx + side * 6, vy - 2, side);
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

    // the rune switch: a marked pedestal 70-240 cells away in open cave.
    // Find it BEFORE stamping the vault so a failed switch roll leaves no
    // orphan strongroom or inaccessible loot behind.
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
    // pedestal — tunneled to the network so the glyph can actually be found
    for (let dx = -2; dx <= 2; dx++) {
      const i = w.idx(rx + dx, ry);
      w.types[i] = Cell.Metal;
      w.colors[i] = packRGB(88, 94, 104);
    }
    // The glyph hangs in open air over its pedestal, and the connector leaves
    // from above it: from ry - 3 its first disc bored nine rows under the
    // pedestal and left the metal bar in mid-air.
    carveRectCells(w, rx - 2, ry - 5, rx + 2, ry - 1);
    reserveFooting(ledger, runeFooting({ rx, ry: ry - 2 }), 'rune');
    connectToCaves(rx, ry - 15);
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
    if (px2 < 0) {
      let best: { cx: number; cy: number; d: number } | null = null;
      for (const reg of graph.regions) {
        if (reg.area < 180) continue;
        const rx0 = Math.floor(clamp(reg.cx, 70, WIDTH - 70));
        const ry0 = Math.floor(clamp(reg.cy, 120, HEIGHT - 90));
        if (ledger.intersects(rx0 - 20, ry0 - 12, rx0 + 20, ry0 + 12)) continue;
        const d = Math.abs(rx0 - spawn.x) + Math.abs(ry0 - spawn.y) * 0.6;
        if (!best || d > best.d) best = { cx: rx0, cy: ry0, d };
      }
      px2 = best ? best.cx : Math.floor(clamp(WIDTH - spawn.x, 70, WIDTH - 70));
      py2 = best ? best.cy : Math.floor(clamp(HEIGHT * 0.48, 120, HEIGHT - 90));
    }
    if (px2 >= 0) {
      // Six archetypes now; the cold biome leans toward the Freeze Bridge
      // and the conductive ones toward the Live Circuit. The bias roll is
      // consumed unconditionally so the rng stream stays aligned across
      // biomes at the same depth.
      const bias = rng.next();
      let archetype = (def.depth + Math.floor(rng.next() * 2)) % 6;
      if (def.biome === 'frozen' && bias < 0.5) archetype = 4;
      else if ((def.biome === 'crystal' || def.biome === 'scorched') && bias < 0.5) archetype = 5;
      // A flooded level drowns both new locks (nitrogen freezes the flood's
      // surface far above the trench; floodwater pre-bridges the circuit's
      // gaps) — fall back to the sluice, which water can only help.
      if (def.biome === 'flooded' && archetype >= 4) archetype = 2;
      // main chamber + sealed loot pocket on the right
      carveRoomWithFloor(px2, py2, 16, 12, 16); // main chamber + stone shelf
      carvePocket(px2 + 26, py2 + 1, 10, 12);
      // Door-front apron: the bowl's ellipse pinches at the door column, so
      // a 9x17 wizard never fits there organically — which made the
      // gauge-rescue pass fire for EVERY chamber, and its stone-eating
      // carves vandalized freshly stamped puzzle interiors. A standing
      // shelf guaranteed by construction retires that whole failure family.
      carveRectCells(w, px2 + 5, py2 - 11, px2 + 14, py2 + 10);
      for (let X = px2 + 5; X <= px2 + 14; X++) {
        const i = w.idx(X, py2 + 11);
        if (w.types[i] !== Cell.Metal) {
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      }
      const door = makeDoor(ctx, mechanisms, px2 + 15, py2 - 9, 3, 20);
      pickups.push(makePickup('chest', px2 + 26, py2 + 9));
      pickups.push(
        makePickup('goldpile', px2 + 29, py2 + 9, { amount: 10 + Math.floor(rng.next() * 10) }),
      );
      pickups.push(
        makePickup('tome', px2 + 23, py2 + 9, {
          card: randomCard(TOME_REWARD_POOL, () => rng.next()),
        }),
      );

      // The chamber joins the cave network through its left mouth BEFORE the
      // archetype interiors are stamped, and with the SWEPT gauge gallery
      // (the rescue pass's own proven rect): a plain disc chain only
      // promises 9x17 clearance on its centerline, so every chamber door
      // was failing the wizard audit and the gauge rescue "fixed" it by
      // tunneling through the chamber floor — vandalizing stamped stone.
      // A walk-in mouth plus the door-front apron retires that entirely.
      connectToCavesFrom(w, rng, graph, px2 - 17, py2 + 3, 12, fits, {
        halfW: 7,
        up: 21,
        down: 9,
      }, sealedFootprints(ledger));

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
      } else if (archetype === 3) {
        // CHARGE LATCH: bring the coil a spark — lightning, charged water,
        // anything the conductors will carry
        makeChargeLatch(w, mechanisms, px2 - 8, floorY, door);
      } else if (archetype === 4) {
        // FREEZE BRIDGE: a metal-lined trench of open water sunk into the
        // bowl floor, and a brass eye above it that counts ICE. An icicle
        // drips liquid nitrogen forever — but a stone catch-tray collects
        // every drop, where it pools and flash-evaporates (bulk nitrogen
        // cannot exist in this sim; the tray weaponizes that). Break the
        // tray and the drops reach the water: each one random-walks the
        // crust and freezes the first open surface it finds, so the channel
        // genuinely freezes over — the crust is the key AND the crossing.
        // (Frostshard/icelance tomes and flask-carried biome nitrogen are
        // alternate sources; the latch is permanent, so a melt can never
        // re-seal the loot.)
        const tx0 = px2 - 8,
          tx1 = px2 + 4;
        for (let X = tx0; X <= tx1; X++) {
          for (let Y = py2 + 10; Y <= py2 + 15; Y++) {
            if (!w.inBounds(X, Y)) continue;
            const i = w.idx(X, Y);
            if (w.types[i] === Cell.Metal) continue; // never breach a casing
            const liner = X === tx0 || X === tx1 || Y === py2 + 15;
            if (liner) {
              w.types[i] = Cell.Metal;
              w.colors[i] = packRGB(96, 102, 112);
            } else {
              w.types[i] = Cell.Water;
              w.colors[i] = packRGB(28, 140, 224);
            }
          }
        }
        // the icicle: a frozen fang on the ceiling, dripping from its tip
        for (let dy = -12; dy <= -10; dy++) {
          const i = w.idx(px2 - 2, py2 + dy);
          if (w.types[i] !== Cell.Metal) {
            w.types[i] = Cell.Ice;
            w.colors[i] = packRGB(168, 216, 248);
          }
        }
        emitters.push({ x: px2 - 2, y: py2 - 9, cell: Cell.Nitrogen, rate: 9, dir: 0, burst: 1, phase: 0 });
        // the catch-tray: a stone cup under the drip; drops pool inside and
        // evaporate before they matter. Dig or blast it away to let the
        // cold reach the channel. The walls rise to the drop cell's row so
        // the brim IS the fill line: a full cup occupies the drop cell and
        // the emitter self-chokes (the refuge cistern trick) — with 1-high
        // walls a drop landing on a saturated cup drifted one cell over the
        // brim and free-fell into the trench, freezing the channel in
        // seconds with the tray intact.
        for (let dx = -2; dx <= 2; dx++) {
          const i = w.idx(px2 - 2 + dx, py2 - 6);
          if (w.types[i] !== Cell.Metal) {
            w.types[i] = Cell.Stone;
            w.colors[i] = stoneColor();
          }
        }
        for (const dx of [-2, 2]) {
          for (const dy of [-7, -8]) {
            const i = w.idx(px2 - 2 + dx, py2 + dy);
            if (w.types[i] !== Cell.Metal) {
              w.types[i] = Cell.Stone;
              w.colors[i] = stoneColor();
            }
          }
        }
        makeSensor(
          w,
          mechanisms,
          px2 - 2,
          py2 + 9,
          {
            sensorType: 'material',
            materialFilter: [Cell.Ice],
            threshold: 8,
            zone: { x0: tx0 + 1, y0: py2 + 9, x1: tx1 - 1, y1: py2 + 14 },
            latch: 'permanent',
          },
          door,
        );
      } else {
        // LIVE CIRCUIT: the coil sleeps in an iron vault under the door
        // apron — no spark can reach it directly. A copper rail runs from
        // an exposed strike-knob on the left slope, broken by two air gaps
        // where KNIFE-SWITCH valves stand open. Throw both levers and the
        // gates slam INTO the rail; then put any spark on the knob — bolt,
        // bomb splash, electrified water — and the pulse runs home. Every
        // working part is metal or runtime-stamped valve cells, so no
        // later carve (gauge rescue, secrets, chaos) can sever the
        // circuit. The one-cell port shaft through the apron floor keeps
        // the vault on the seen-path and remains the universal pour-and-
        // zap fallback (a wrecked lever fail-opens its valve, which jams
        // the gap OPEN — the port is the fail-open for that). Charge
        // spreads down and sideways but never up-right
        // (sim/electrical.ts), so the whole run descends toward the coil.
        const COPPER = packRGB(186, 124, 58);
        const COPPER_D = packRGB(150, 96, 44);
        const IRON = packRGB(96, 88, 74);
        const railY = py2 + 11;
        const put = (X: number, Y: number, t: number, c: number): void => {
          if (!w.inBounds(X, Y)) return;
          const i = w.idx(X, Y);
          if (w.types[i] === Cell.Metal && t !== Cell.Metal) return; // keep casings
          w.types[i] = t;
          w.colors[i] = c;
        };
        // the buried vault: iron shell, hollow heart, port hole in the roof
        for (let X = px2 + 3; X <= px2 + 11; X++) {
          for (let Y = py2 + 12; Y <= py2 + 21; Y++) {
            if (X === px2 + 9 && Y === py2 + 12) continue; // port hole
            const edge = X === px2 + 3 || X === px2 + 11 || Y === py2 + 12 || Y === py2 + 21;
            if (edge) put(X, Y, Cell.Metal, IRON);
            else put(X, Y, Cell.Empty, EMPTY_COLOR);
          }
        }
        // interior drop-feed: an iron fang from the roof down into the
        // coil's sensing zone — the shell IS the circuit's final node
        for (let Y = py2 + 13; Y <= py2 + 15; Y++) put(px2 + 6, Y, Cell.Metal, IRON);
        // strike-knob half-embedded in the left slope + its feed wire
        for (const [X, Y] of [
          [px2 - 13, py2 + 6],
          [px2 - 12, py2 + 6],
          [px2 - 13, py2 + 7],
          [px2 - 12, py2 + 7],
        ]) {
          put(X, Y, Cell.Metal, COPPER);
        }
        for (let Y = py2 + 8; Y <= railY; Y++) put(px2 - 12, Y, Cell.Metal, COPPER_D);
        for (let X = px2 - 11; X <= px2 - 7; X++) put(X, railY, Cell.Metal, COPPER_D);
        // copper floor strip, broken by the two switch gaps
        for (let X = px2 - 6; X <= px2 - 4; X++) put(X, railY, Cell.Metal, COPPER); // segment A
        put(px2 - 3, railY, Cell.Empty, EMPTY_COLOR); // switch gap 1
        for (let X = px2 - 2; X <= px2 + 1; X++) put(X, railY, Cell.Metal, COPPER); // segment B
        put(px2 + 2, railY, Cell.Empty, EMPTY_COLOR); // switch gap 2
        // cosmetic walk surface between gap 2 and the apron floor
        for (const X of [px2 + 3, px2 + 4]) put(X, railY, Cell.Stone, stoneColor());
        // port shaft: one open cell, down through the apron floor
        for (let Y = py2 + 10; Y <= py2 + 11; Y++) put(px2 + 9, Y, Cell.Empty, EMPTY_COLOR);
        // knife-switch valves standing OPEN in the gaps; their levers on
        // the apron are created PRE-THROWN, so pulling one CLOSES its gate
        // into the rail. V2's closed body reaches the vault roof corner.
        const v1 = makeValve(ctx, mechanisms, px2 - 3, railY - 1, 1, 3);
        const v2 = makeValve(ctx, mechanisms, px2 + 2, railY - 1, 1, 3);
        setValveCells(ctx, v1, true);
        setValveCells(ctx, v2, true);
        // iron footing pads: the lever body-watch reads these three cells,
        // and a gauge-rescue tunnel through the apron must not count as
        // "wrecked" (a broken lever fail-opens its valve, which for THIS
        // inverted switch means jamming the gap open)
        for (const lx of [px2 + 7, px2 + 12]) {
          for (let dx = -1; dx <= 1; dx++) {
            put(lx + dx, py2 + 11, Cell.Metal, IRON);
          }
        }
        const l1 = makeLever(mechanisms, px2 + 7, py2 + 10, v1);
        const l2 = makeLever(mechanisms, px2 + 12, py2 + 10, v2);
        l1.state = 1;
        l2.state = 1;
        // the coil itself, asleep on its pedestal at the vault floor
        makeChargeLatch(w, mechanisms, px2 + 7, py2 + 20, door);
      }
    }
  }

  // ---- The Kiln (bottom level only): the colossus arena ----
  // A vast scorched hall for a boss a head and a half taller than the
  // alchemist: an elliptical vault (62 x 40) over a FLAT floor 116 cells wide,
  // lava moats sunk flush into the floor at both ends (a stomp's shockwave dies
  // at a gap — and jumping it is the counter), and the strategy hanging from
  // the ceiling: THREE metal-cased water tanks sealed by breakable stone plugs
  // (gold-flecked), one over the centre and one to each side — one for every
  // phase. Flood the kiln, thermal-shock the colossus. Nothing hangs lower
  // than the Colossus is tall: it can walk the whole floor.
  // (GEN_VERSION 50: the arena grew with the Colossus.)
  let boss: { x: number; y: number; kind?: EnemyKind } | null = null;
  if (def.boss === 'colossus') {
    const RX = 62, RY = 40, FLOOR = 30, HALF = 58;
    let cx = Math.floor(WIDTH * (0.42 + rng.next() * 0.16));
    const cy = HEIGHT - 126;
    // Reserved-ground dodge (inert while the ledger is empty); bounded, then
    // the arena is carved regardless — the kiln must exist.
    for (let a = 0; a < 12 && ledger.intersects(cx - RX - 2, cy - RY - 12, cx + RX + 2, cy + FLOOR + 5); a++) {
      cx = Math.floor(WIDTH * (0.42 + rng.next() * 0.16));
    }
    carvePocket(cx, cy, RX, RY);
    carveRectCells(w, cx - HALF, cy, cx + HALF, cy + FLOOR - 1);
    const stone = (X: number, Y: number): void => {
      if (!w.inBounds(X, Y)) return;
      const i = w.idx(X, Y);
      w.types[i] = Cell.Stone;
      w.colors[i] = stoneColor();
    };
    // stone floor band
    for (let dx = -HALF - 2; dx <= HALF + 2; dx++) for (let dy = FLOOR; dy <= FLOOR + 3; dy++) stone(cx + dx, cy + dy);
    // ...on a deep footing: a slam's crater must not punch the alchemist
    // through into a void under the kiln (only empty cells are filled).
    for (let dx = -HALF - 2; dx <= HALF + 2; dx++) {
      for (let dy = FLOOR + 4; dy <= FLOOR + 16; dy++) {
        const X = cx + dx, Y = cy + dy;
        if (w.inBounds(X, Y) && Y < HEIGHT - 8 && w.types[w.idx(X, Y)] === Cell.Empty) stone(X, Y);
      }
    }
    // lava moats sunk flush into the floor band, a stone keel under each
    for (const side of [-1, 1]) {
      for (let dx = 47; dx <= 56; dx++) {
        for (let dy = FLOOR; dy <= FLOOR + 4; dy++) {
          const X = cx + side * dx, Y = cy + dy;
          if (!w.inBounds(X, Y)) continue;
          if (dy <= FLOOR + 2) {
            const i = w.idx(X, Y);
            w.types[i] = Cell.Lava;
            w.colors[i] = packRGB(252, 60 + Math.floor(rng.next() * 60), 8);
          } else stone(X, Y);
        }
      }
    }
    // ceiling tanks: metal casing, water, a breakable two-row stone seal at the mouth
    const tank = (tx: number, halfW: number, mouth: number, depth: number): void => {
      for (let dx = -halfW; dx <= halfW; dx++) {
        for (let dy = -depth - 1; dy <= 1; dy++) {
          const X = tx + dx, Y = mouth + dy;
          if (!w.inBounds(X, Y)) continue;
          const i = w.idx(X, Y);
          const casing = Math.abs(dx) >= halfW - 1 || dy <= -depth;
          if (casing) {
            w.types[i] = Cell.Metal;
            w.colors[i] = packRGB(96, 102, 112);
          } else if (dy < 0) {
            w.types[i] = Cell.Water;
            w.colors[i] = packRGB(28, 120 + Math.floor(rng.next() * 60), 220);
          } else stone(X, Y);
        }
      }
      // gold-flecked tell under the seal
      for (let g4 = 0; g4 < Math.max(4, halfW - 2); g4++) {
        const gx = tx - halfW + 2 + Math.floor(rng.next() * (halfW * 2 - 3));
        const i = w.idx(gx, mouth + 2);
        if (w.types[i] === Cell.Empty) {
          w.types[i] = Cell.Gold;
          w.colors[i] = goldColor();
        }
      }
    };
    const tanks: Array<[number, number, number, number]> = [[cx, 13, cy - RY + 1, 8], [cx - 34, 7, cy - 33, 7], [cx + 34, 7, cy - 33, 7]];
    for (const [tx, hw, mouth, depth] of tanks) tank(tx, hw, mouth, depth);
    boss = { x: cx, y: cy + FLOOR - 1, kind: 'colossus' };
    ledger.reserve(cx - RX - 2, cy - RY - 12, cx + RX + 2, cy + FLOOR + 5, 'kiln-arena');
    // STORY (GEN 55): the old flue the escape climbs, beside the Kiln behind a
    // metal damper the Heart's last heave blows out (world/kilnFlue). No rng:
    // its geometry follows the Kiln's, so the main stream is untouched.
    const flue = planKilnFlue(cx, cy, ledger);
    carveKilnFlue(w, flue);
    ledger.reserve(flue.shaft.x0 - 6, flue.shaft.y0 - 8, flue.shaft.x1 + 6, flue.shaft.y1 + 5, 'kiln-flue');
    kilnFlue = flue;
    // The flank away from the flue joins the cave network — the kiln must be
    // findable. The flue's flank is the damper: a connector there would open
    // the shaft to the fight (a ledge to snipe from) before the heave.
    connectToCaves(cx - flue.side * (HALF + 3), cy + FLOOR - 12);
    // The tanks' organs, re-assertable (integration fix, GEN 50: a flank
    // connector's tunnel or a rescue carve used to eat a seal and drown the
    // Colossus unprovoked). Idempotent: the metal casings, the two stone seal
    // rows, and a refill of any water a carve deleted. A carve INTO a tank
    // never carries a route (metal casing, no wizard space inside), so
    // re-sealing cannot cut connectivity. Fixed tint: no generation rng.
    kilnRepair = (): void => {
      for (const [tx, hw, mouth, depth] of tanks) {
        for (let dx = -hw; dx <= hw; dx++) {
          for (let dy = -depth - 1; dy <= 1; dy++) {
            const X = tx + dx, Y = mouth + dy;
            if (!w.inBounds(X, Y)) continue;
            const i = w.idx(X, Y);
            if (Math.abs(dx) >= hw - 1 || dy <= -depth) {
              if (w.types[i] !== Cell.Metal) { w.types[i] = Cell.Metal; w.colors[i] = packRGB(96, 102, 112); }
            } else if (dy < 0) {
              if (w.types[i] !== Cell.Water) { w.types[i] = Cell.Water; w.colors[i] = packRGB(28, 140, 224); }
            } else if (w.types[i] !== Cell.Stone) stone(X, Y);
          }
        }
      }
      repairKilnFlue(w, flue);
    };
    kilnRepair(); // the flank connectors just now
  }

  // ---- The Sump (the Drowned Cisterns): the leviathan's cistern ----
  // The mid-descent boss, built as the Kiln's mirror: where the colossus
  // hides its weakness in a ceiling tank you must OPEN, the leviathan hides
  // in a basin you must EMPTY. A metal-cased pool with three stone drain
  // plugs in its floor (gold dust marks them): dig the plugs and the water
  // falls away into the caves below — a beached leviathan is just meat.
  // The pool is also one big conductor, and so is the blood it sheds into
  // it. The cistern PERCHES above the flood line on purpose: every drop
  // drained runs downhill to the ocean and can never climb back.
  if (def.boss === 'leviathan') {
    let cx = Math.floor(WIDTH * (0.3 + rng.next() * 0.4));
    const cy = Math.floor(HEIGHT * 0.52);
    // Nothing built before the arena may stand inside it (GEN 54): the pocket
    // carve spares Metal, so a treasure alcove placed earlier on this pass (not
    // in the ledger) survived as a floating metal frame over the pool, its loot
    // on a bar in the water (d3 seed 7). The last pick still stands if all 24
    // are refused, as before.
    const builtOver = (x: number): boolean => {
      for (const p of pickups) if (Math.abs(p.x - x) <= 44 && p.y >= cy - 26 && p.y <= cy + 36) return true;
      for (let Y = cy - 26; Y <= cy + 36; Y++) {
        for (let X = x - 44; X <= x + 44; X++) {
          if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === Cell.Metal) return true;
        }
      }
      return false;
    };
    for (let a = 0; a < 24; a++) {
      const clear =
        Math.abs(cx - spawn.x) > 200 &&
        Math.abs(cx - portalX) > 160 &&
        !ledger.intersects(cx - 44, cy - 26, cx + 44, cy + 36) &&
        !builtOver(cx);
      if (clear) break;
      cx = Math.floor(WIDTH * (0.3 + rng.next() * 0.4));
    }
    carvePocket(cx, cy, 42, 26);
    // dry shores either side of the basin mouth
    for (let dx = -42; dx <= 42; dx++) {
      for (let dy = 17; dy <= 20; dy++) {
        const X = cx + dx,
          Y = cy + dy;
        if (!w.inBounds(X, Y)) continue;
        const i = w.idx(X, Y);
        if (w.types[i] !== Cell.Metal) {
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      }
    }
    // the basin: hollow the tub, then the metal casing (chaos-proof except
    // where the plugs are authored)
    carveRectCells(w, cx - 26, cy + 15, cx + 26, cy + 32);
    // The basin's hard shell — metal casing sides + floor, the three diggable
    // stone drain plugs, and the gold-dust tells. Stamped once here, and again
    // (verbatim) by the sumpRepair pass after the gauge-rescue carve; sharing
    // one stamper keeps the two paths from drifting. The shaft-digging and the
    // water-fill are the deliberate divergences and stay OUT of the shell — the
    // repair must NOT re-dig drains the player has opened, only reseal the casing.
    // (Writes here and the construction-only shaft below touch disjoint cells, so
    // calling the shell first leaves the carve output byte-identical.)
    const stampSumpShell = (): void => {
      for (let Y = cy + 16; Y <= cy + 33; Y++) {
        for (const X of [cx - 27, cx + 27]) {
          const i = w.idx(X, Y);
          w.types[i] = Cell.Metal;
          w.colors[i] = packRGB(96, 102, 112);
        }
      }
      for (let X = cx - 27; X <= cx + 27; X++) {
        const i = w.idx(X, cy + 33);
        w.types[i] = Cell.Metal;
        w.colors[i] = packRGB(96, 102, 112);
      }
      for (const px of [cx - 16, cx, cx + 16]) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const Y of [cy + 33, cy + 34]) {
            const i = w.idx(px + dx, Y);
            w.types[i] = Cell.Stone;
            w.colors[i] = stoneColor();
          }
        }
        // gold dust settled beside the plug: the diggers' tell, underwater
        for (const gx of [px - 2, px + 2]) {
          const i = w.idx(gx, cy + 32);
          w.types[i] = Cell.Gold;
          w.colors[i] = goldColor();
        }
      }
    };
    stampSumpShell();
    // three drain plugs through the casing floor, shafts dug until they
    // breach cave air OR flood water below (either way the basin sits
    // uphill — the refuge's bottomless-drain rule, aimed at an ocean)
    for (const px of [cx - 16, cx, cx + 16]) {
      let bottom = Math.min(HEIGHT - 8, cy + 35 + 120);
      for (let Y = cy + 38; Y <= cy + 35 + 120 && Y < HEIGHT - 8; Y++) {
        let open = 0;
        while (
          open < 3 &&
          Y + open < HEIGHT - 4 &&
          (w.types[w.idx(px, Y + open)] === Cell.Empty || w.types[w.idx(px, Y + open)] === Cell.Water)
        )
          open++;
        if (open >= 3) {
          bottom = Y;
          break;
        }
      }
      for (let dx = -1; dx <= 1; dx++) {
        for (let Y = cy + 35; Y <= bottom; Y++) {
          const i = w.idx(px + dx, Y);
          if (w.types[i] === Cell.Metal) break; // never breach a casing
          w.types[i] = Cell.Empty;
          w.colors[i] = EMPTY_COLOR;
        }
      }
    }
    // fill the tub — surface one row below the shore lip, so nothing spills
    for (let X = cx - 26; X <= cx + 26; X++) {
      for (let Y = cy + 18; Y <= cy + 32; Y++) {
        const i = w.idx(X, Y);
        if (w.types[i] === Cell.Empty) {
          w.types[i] = Cell.Water;
          w.colors[i] = packRGB(24, 110 + Math.floor(rng.next() * 50), 200);
        }
      }
    }
    // a cold gleam over the water: the arena reads from the approach
    authoredLights.push({
      x: cx,
      y: cy + 10,
      r: 0.35,
      g: 0.7,
      b: 1.0,
      intensity: 0.9,
      radius: 48,
      bloom: 0.35,
      flicker: 0.2,
      flickerPhase: 0.6,
      falloff: 'soft',
      occluded: true,
    });
    boss = { x: cx, y: cy + 26, kind: 'leviathan' };
    ledger.reserve(cx - 44, cy - 26, cx + 44, cy + 36, 'sump-arena');
    // THE RIM (GEN 54): the bowl the basin sits in — the pocket's lower wall,
    // the dry shores beside the casing, and a plinth under the casing floor.
    // Every seed used to lose it: the flank connectors (radius 12 from the
    // shore row), then rescue and puzzle tunnels ate the shores and the rock
    // under the tub, leaving a one-cell metal bathtub floating in a void —
    // nowhere to stand, and every drop the Leviathan threw at the shore fell
    // away forever. The rim is the designed ROCK: only Empty cells are filled
    // (never a Metal casing, a plant, or water), the basin, its casing/plugs and
    // the three drain shafts are left to their own stampers, and nothing above
    // cy+12 is touched, so the connectors' mouths (below) stay open. Water that
    // splashes onto a shore runs down the rim into the casing gutter and spills
    // back into the pool — a bowl, not a cliff.
    const stampSumpRim = (): void => {
      for (let Y = cy + 12; Y <= cy + 36; Y++) {
        for (let X = cx - 44; X <= cx + 44; X++) {
          if (!w.inBounds(X, Y)) continue;
          const dx = X - cx, dy = Y - cy;
          const inPocket = (dx * dx) / (42 * 42) + (dy * dy) / (26 * 26) <= 1;
          const shore = dy >= 17 && dy <= 20 && Math.abs(dx) >= 28;
          if (inPocket && !shore) continue;
          // A bowl, not a crate: the plinth's flanks curve in toward the casing
          // (44 wide at cy+12, 30 at cy+36, just past the ±27 casing) with a
          // fixed wobble (no rng: this also runs after the stream closes).
          const t = (dy - 12) / 24;
          if (Math.abs(dx) > 44 - t * t * 14 + Math.sin(Y * 0.9 + X * 0.13) * 1.2) continue;
          if (Math.abs(dx) <= 27 && dy >= 15 && dy <= 34) continue; // the basin: shell + water
          if (Y >= cy + 35 && (Math.abs(dx + 16) <= 1 || Math.abs(dx) <= 1 || Math.abs(dx - 16) <= 1)) continue; // drain shafts
          const i = w.idx(X, Y);
          if (w.types[i] !== Cell.Empty) continue;
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      }
    };
    // Connectors leave from the pocket's upper flanks (their first disc stops
    // at cy+8, above the rim) instead of the shore row, which they used to
    // excavate on their very first step.
    connectToCaves(cx - 36, cy - 4);
    connectToCaves(cx + 36, cy - 4);
    stampSumpRim();
    // The arena's fragile organs, re-assertable after the gauge-rescue pass
    // (whose stone-eating tunnels pre-opened all three drains on seed 1).
    // Idempotent: casing, plugs, gold tells, the rim (shores + plinth), and a
    // refill of whatever water a wandering carve deleted. (The rim used to be
    // left as the rescue had it — and no seed kept a shore.)
    sumpRepair = (rim = true): void => {
      // Reseal the casing, plug slots, and gold tells (the shell stamper);
      // the rescue's stone-eating tunnels never re-dig the drains, so the
      // construction-only shaft loop is deliberately NOT replayed here.
      stampSumpShell();
      // The rim a rescue or puzzle tunnel took (see stampSumpRim): later
      // tunnels that still need a way through re-carve it (the final gauge
      // rescue runs after this; the runtime repair routes around the arena).
      if (rim) stampSumpRim();
      // ...then refill whatever water a wandering carve deleted. Fixed tint
      // (no rng jitter) — the repair runs after generation's rng stream closes.
      for (let X = cx - 26; X <= cx + 26; X++) {
        for (let Y = cy + 18; Y <= cy + 32; Y++) {
          const i = w.idx(X, Y);
          if (w.types[i] === Cell.Empty) {
            w.types[i] = Cell.Water;
            w.colors[i] = packRGB(24, 130, 200);
          }
        }
      }
    };
  }

  // ---- The second doors' guardians (wave 3): their halls live in world/wardenArenas ----
  if (def.boss === 'rimewarden') {
    const arena = buildIceHouse({ w, rng, ledger, spawn, portalX, pickups, lights: authoredLights, connect: connectToCaves });
    boss = arena.boss;
    wardenRepair = arena.repair;
  }
  if (def.boss === 'lenswright') {
    const arena = buildLensRoom({ w, rng, ledger, spawn, portalX, pickups, lights: authoredLights, connect: connectToCaves });
    boss = arena.boss;
    wardenRepair = arena.repair;
  }

  return {
    pickups,
    portal,
    mechanisms,
    runeVaults,
    boss,
    emitters,
    authoredLights,
    refuge,
    spellLab,
    sumpRepair,
    kilnRepair,
    wardenRepair,
    kilnFlue,
  };
}
