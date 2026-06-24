import { HEIGHT, WIDTH } from '@/config/constants';
import { randomCard, TOME_REWARD_POOL } from '@/combat/wands/rewardPools';
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
  VaultArch,
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
} from '@/game/Mechanisms';
import { makePickup, POTION_KINDS } from '@/core/pickupDefs';
import { Cell } from '@/sim/CellType';
import {
  catalystColor,
  crystalColor,
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
  tunnelTo,
} from '@/world/connect';
import type { PlacementLedger } from '@/world/connect';

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
  opts?: { hostArch?: boolean },
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
  vaultArch: VaultArch | null;
  vaultHoard: { x: number; y: number } | null;
  /** Re-asserts the Sump's casing, plugs, and pool AFTER the gauge-rescue
   *  pass — rescue tunnels eat all stone and spare only metal, and one
   *  wandering carve through the arena pre-opened all three drains
   *  (observed). The casing is metal and survives; this puts back what
   *  can't be armored. */
  sumpRepair: (() => void) | null;
} {
  const w = ctx.world;
  const pickups: Pickup[] = [];
  const mechanisms: Mechanism[] = [];
  const runeVaults: RuneVault[] = [];
  const emitters: HazardEmitter[] = [];
  const authoredLights: AuthoredLight[] = [];
  let refuge: { x: number; y: number } | null = null;
  let spellLab: { x: number; y: number; rewardX: number; rewardY: number } | null = null;
  let vaultArch: VaultArch | null = null;
  let vaultHoard: { x: number; y: number } | null = null;
  let sumpRepair: (() => void) | null = null;

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

  // ---- D1 Refuge: a hewn rest alcove near the starting spawn ----
  // The bench is an onboarding/progression fixture, not a recurring lower-depth
  // shop. Keep it close enough to the initial cave that the Heavy-slot lesson is
  // part of the first route instead of a late backtrack. Fixtures are real cells:
  //  - a healing spring whose spout is an eternal Healium drip emitter set
  //    AT the pool's full line — emitters only stamp into Empty, so a full
  //    pool stops the drip and a drink re-starts it ("springs re-drip" is
  //    the physics-mulligan BY CONSTRUCTION, and the spring can be flask-
  //    siphoned dry by greedy alchemists exactly as the design intends);
  //  - a gold-flecked offering shrine: E in reach opens the Sanctum's shop
  //    (boons stay at the portal); the gold is real, diggable, and stealing
  //    it is between you and the old ones;
  //  - a wood-and-anvil work bench (the B-key bench's physical home);
  //  - one warm authored light, because a refuge must read as shelter.
  if (def.depth === 1 && !def.branch) {
    const refugeSide = Math.sign(portalX - spawn.x) || (spawn.x < WIDTH / 2 ? 1 : -1);
    const refugeY = Math.floor(clamp(spawn.y + 2, 34, HEIGHT - 96));
    const baseCandidates: Array<[number, number]> = [
      [Math.floor(spawn.x + refugeSide * 64), refugeY],
      [Math.floor(spawn.x - refugeSide * 64), refugeY],
      [Math.floor(spawn.x + refugeSide * 86), refugeY],
      [Math.floor(spawn.x - refugeSide * 86), refugeY],
    ];
    const candidates: Array<[number, number, number]> = [
      ...baseCandidates.map(([rx, ry]) => [rx, ry, 25] as [number, number, number]),
      ...baseCandidates.map(([rx, ry]) => [rx, ry, Number.POSITIVE_INFINITY] as [number, number, number]),
    ];
    const intersectsBlockingRefugeReservation = (x0: number, y0: number, x1: number, y1: number): boolean => {
      const a0 = Math.min(x0, x1),
        a1 = Math.max(x0, x1),
        b0 = Math.min(y0, y1),
        b1 = Math.max(y0, y1);
      return ledger.rects().some((r) => {
        if (r.label === 'spawn' || r.label === 'onboarding') return false;
        return a0 <= r.x1 && a1 >= r.x0 && b0 <= r.y1 && b1 >= r.y0;
      });
    };
    for (const [rx, ry, looseLimit] of candidates) {
      if (rx - 13 < 4 || rx + 13 > WIDTH - 4 || ry - 12 < 4 || ry + 12 > HEIGHT - 16) continue;
      if (intersectsBlockingRefugeReservation(rx - 12, ry - 12, rx + 12, ry + 12)) continue;
      let metal = 0,
        loose = 0;
      for (let Y = ry - 14; Y <= ry + 14; Y++) {
        for (let X = rx - 14; X <= rx + 14; X++) {
          if (!w.inBounds(X, Y)) continue;
          const t = w.types[w.idx(X, Y)];
          if (t === Cell.Metal) metal++;
          else if (
            t === Cell.Water ||
            t === Cell.Oil ||
            t === Cell.Gunpowder ||
            t === Cell.Sand ||
            t === Cell.Coal ||
            t === Cell.Ash ||
            t === Cell.Snow ||
            t === Cell.Lava
          ) {
            loose++;
          }
        }
      }
      if (metal > 0) continue;
      if (loose > looseLimit) continue;
      const s = Math.sign(rx - spawn.x) || refugeSide;
      carveRectCells(w, rx - 10, ry - 10, rx + 10, ry + 10);
      // SOLID SHELL, unconditional (except casings): the spawn-side gallery is
      // deliberately carved, so a candidate site can stand in OPEN AIR — and an
      // oil/gunpowder reservoir anywhere above rains straight in and
      // buries the spring for minutes (observed). A hewn refuge gets a
      // real roof, real walls, and a sealed underfloor; the gallery's
      // start disc blows the doorway through the near wall afterwards.
      const hew = (X: number, Y: number): void => {
        if (!w.inBounds(X, Y)) return;
        const i = w.idx(X, Y);
        if (w.types[i] !== Cell.Metal) {
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      };
      for (let X = rx - 12; X <= rx + 12; X++) {
        hew(X, ry - 11);
        hew(X, ry - 10);
        hew(X, ry + 11);
        hew(X, ry + 12);
      }
      for (let Y = ry - 11; Y <= ry + 12; Y++) {
        for (const X of [rx - 12, rx - 11, rx + 11, rx + 12]) hew(X, Y);
      }
      // re-open the interior (the shell loop just sealed its rim rows)
      carveRectCells(w, rx - 10, ry - 9, rx + 10, ry + 9);
      // gauge-guaranteed gallery back to the spawn chamber. It STARTS 22
      // cells out so the swept rect (up 21!) can never notch the roof; the
      // start disc alone opens a walk-height doorway through the wall.
      const galleryTargetX = Math.floor(clamp(spawn.x + s * 20, 18, WIDTH - 19));
      const galleryTargetY = Math.floor(clamp(spawn.y + 4, 24, HEIGHT - 24));
      const gallery = tunnelTo(
        w,
        rng,
        rx - s * 22,
        ry + 4,
        galleryTargetX,
        galleryTargetY,
        12,
        { halfW: 7, up: 21, down: 9 },
      );
      // seal every seed seam the sweep grazed — at generation time nothing
      // has flowed yet, so a stone skin one cell beyond the swept perimeter
      // closes each pocket before it can spill (openings stay open: the
      // skin skips Empty)
      const skin = (X: number, Y: number): void => {
        if (!w.inBounds(X, Y)) return;
        const i = w.idx(X, Y);
        const t = w.types[i];
        if (t !== Cell.Metal && t !== Cell.Empty) {
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      };
      for (const [gx, gy] of gallery) {
        for (let X = gx - 8; X <= gx + 8; X++) {
          skin(X, gy - 22);
          skin(X, gy + 10);
        }
        for (let Y = gy - 22; Y <= gy + 10; Y++) {
          skin(gx - 8, Y);
          skin(gx + 8, Y);
        }
      }
      // floor, AFTER the tunnel (its start disc eats the near half)
      for (let X = rx - 10; X <= rx + 10; X++) {
        const i = w.idx(X, ry + 10);
        if (w.types[i] !== Cell.Metal) {
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      }
      // Layout is MIRRORED away from the mouth: the gallery's tall aperture
      // channels whatever its sweep grazed (gunpowder seams, water) into
      // the alcove, so the pool lives on the FAR side and a drain between
      // mouth and fixtures swallows the inflow. The drain MUST be
      // bottomless in practice: a fixed-depth shaft silts full in seconds
      // of sustained inflow, the alcove floods over the pool rim, and
      // standing water then chokes the healium seep forever (emitters only
      // stamp into Empty). So each shaft digs until it breaches existing
      // cave air below — true drainage into the dark, which the grid
      // explains better than any plumbing.
      for (const dxD of [7, 8, 9]) {
        const X = rx - s * dxD;
        let opened = false;
        let bottom = ry + 60;
        for (let Y = ry + 14; Y <= ry + 80 && Y < HEIGHT - 8; Y++) {
          if (w.types[w.idx(X, Y)] === Cell.Empty) {
            let run = 0;
            while (run < 3 && Y + run < HEIGHT - 4 && w.types[w.idx(X, Y + run)] === Cell.Empty) run++;
            if (run >= 3) {
              bottom = Y;
              opened = true;
              break;
            }
          }
        }
        if (!opened) bottom = Math.min(ry + 80, HEIGHT - 8);
        for (let Y = ry + 11; Y <= bottom; Y++) {
          const i = w.idx(X, Y);
          if (w.types[i] === Cell.Metal) break; // never breach a casing
          w.types[i] = Cell.Empty;
          w.colors[i] = EMPTY_COLOR;
        }
      }
      // spring: a RAISED stone cistern on the far side (9 wide inside —
      // the wizard is 9 — and two deep, under the swim threshold so he
      // stands with his boots in the cure). Raised is the load-bearing
      // word: a floor-level pit eventually takes whatever the caves send
      // (water dilutes and CHOKES the seep — emitters only stamp into
      // Empty — and oil caps it; both observed), but with the basin lip
      // five cells above the floor and the drain keeping floods shallow,
      // no spill can ever climb in. The seep drips from one cell above
      // the fill line, so a full basin stops the drip and a drink
      // restarts it. Rate 3 outpaces healium's self-evaporation and the
      // wading wizard's consumption (healing drinks the pool at 12% per
      // touch).
      {
        const pLo = Math.min(rx + s * 2, rx + s * 11),
          pHi = Math.max(rx + s * 2, rx + s * 11);
        for (let X = pLo - 1; X <= pHi + 1; X++) {
          for (let Y = ry + 9; Y <= ry + 10; Y++) {
            const i = w.idx(X, Y); // plinth
            if (w.types[i] !== Cell.Metal) {
              w.types[i] = Cell.Stone;
              w.colors[i] = stoneColor();
            }
          }
        }
        for (let Y = ry + 5; Y <= ry + 8; Y++) {
          for (let X = pLo - 1; X <= pHi + 1; X++) {
            if (!w.inBounds(X, Y)) continue;
            const i = w.idx(X, Y);
            if (w.types[i] === Cell.Metal) continue;
            if (X === pLo - 1 || X === pHi + 1) {
              w.types[i] = Cell.Stone;
              w.colors[i] = stoneColor();
            } else {
              w.types[i] = Cell.Empty;
              w.colors[i] = EMPTY_COLOR;
            }
          }
        }
        emitters.push({
          x: rx + s * 6,
          y: ry + 6,
          cell: Cell.Healium,
          rate: 3,
          dir: 0,
          burst: 1,
          phase: 1,
        });
      }
      // offering shrine at the heart: stone altar, gold-flecked crown
      for (let X = rx - 2; X <= rx + 2; X++) {
        const i = w.idx(X, ry + 9);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
      }
      for (let X = rx - 1; X <= rx + 1; X++) {
        const i = w.idx(X, ry + 8);
        w.types[i] = Cell.Gold;
        w.colors[i] = goldColor();
      }
      // work bench between drain and shrine: wood slab + anvil block
      for (let X = rx - s * 5 - 1; X <= rx - s * 5 + 1; X++) {
        const i = w.idx(X, ry + 9);
        w.types[i] = Cell.Wood;
        w.colors[i] = packRGB(124, 92, 56);
      }
      {
        const i = w.idx(rx - s * 5, ry + 8);
        w.types[i] = Cell.Metal;
        w.colors[i] = packRGB(96, 102, 112);
      }
      authoredLights.push({
        x: rx,
        y: ry + 1,
        r: 1.0,
        g: 0.7,
        b: 0.35,
        intensity: 1.1,
        radius: 44,
        bloom: 0.35,
        flicker: 0.3,
        flickerPhase: 2.4,
        falloff: 'soft',
        occluded: true,
      });
      ledger.reserve(rx - 12, ry - 12, rx + 12, ry + 12, 'refuge');
      refuge = { x: rx, y: ry + 7 };
      break;
    }
  }

  // ---- D1 Spell Lab: a real-cell teaching annex beside the first Refuge ----
  // Mutually exclusive with the `if (def.branch)` hoard block below: both anchor
  // off the spawn/refuge chamber and would overlap if a level were ever both
  // depth-1 AND a branch. config/worldgraph.ts guarantees that never happens
  // (the only depth-1 level is non-branch; the only branch is depth 4). If a
  // depth-1 branch is ever added, gate one of these blocks explicitly.
  if (def.depth === 1) {
    const s = refuge ? Math.sign(refuge.x - spawn.x) || 1 : Math.sign(portalX - spawn.x) || 1;
    const rCx = refuge ? Math.floor(refuge.x) : Math.floor(clamp(spawn.x + s * 82, 34, WIDTH - 35));
    const rCy = refuge ? Math.floor(refuge.y - 7) : Math.floor(clamp(spawn.y, 36, HEIGHT - 72));
    let labX = Math.floor(clamp(rCx + s * 42, 34, WIDTH - 35));
    let labY = rCy;
    if (ledger.intersects(labX - 28, labY - 16, labX + 28, labY + 16)) {
      labX = rCx;
      labY = Math.floor(clamp(rCy - 30, 36, HEIGHT - 72));
    }

    const set = (X: number, Y: number, t: Cell, color: number): void => {
      if (!w.inBounds(X, Y)) return;
      const i = w.idx(X, Y);
      if (w.types[i] === Cell.Metal && t !== Cell.Empty && t !== Cell.Metal) return;
      w.types[i] = t;
      w.colors[i] = color;
      w.life[i] = 0;
      w.charge[i] = 0;
    };
    const hew = (X: number, Y: number): void => set(X, Y, Cell.Stone, stoneColor());

    for (let X = labX - 27; X <= labX + 27; X++) {
      hew(X, labY - 14);
      hew(X, labY - 13);
      hew(X, labY + 13);
      hew(X, labY + 14);
    }
    for (let Y = labY - 14; Y <= labY + 14; Y++) {
      for (const X of [labX - 27, labX - 26, labX + 26, labX + 27]) hew(X, Y);
    }
    carveRectCells(w, labX - 25, labY - 12, labX + 25, labY + 12);
    for (let X = labX - 25; X <= labX + 25; X++) hew(X, labY + 12);
    tunnelTo(w, rng, rCx + s * 12, rCy + 4, labX - s * 27, labY + 5, 12, {
      halfW: 7,
      up: 21,
      down: 9,
    });
    connectToCavesFrom(w, rng, graph, labX - s * 27, labY + 5, 12, fits, {
      halfW: 7,
      up: 21,
      down: 9,
    });

    // Dig station: starter Excavate Ray opens the sand plug.
    const digX = labX - s * 18;
    for (let X = digX - 4; X <= digX + 4; X++) hew(X, labY + 10);
    for (let Y = labY + 8; Y <= labY + 10; Y++) {
      for (let X = digX - 2; X <= digX + 2; X++) set(X, Y, Cell.Sand, sandColor());
    }
    for (let Y = labY + 8; Y <= labY + 10; Y++) set(digX + s * 4, Y, Cell.Gold, goldColor());

    // Burn station: environmental fire teaches wood, no Flame card required.
    const fireX = labX - s * 7;
    for (let X = fireX - 4; X <= fireX + 4; X++) hew(X, labY + 10);
    for (let X = fireX - 3; X <= fireX + 3; X++) set(X, labY + 8, Cell.Wood, packRGB(124, 82, 48));
    for (let X = fireX - 2; X <= fireX + 2; X++) {
      set(X, labY + 6, Cell.Fire, packRGB(255, 118, 24));
      w.life[w.idx(X, labY + 6)] = 360 + Math.floor(rng.next() * 90);
    }

    // Water-prep station: a contained basin beside heat and a lava cup, not a flood trap.
    const waterX = labX + s * 4;
    for (let X = waterX - 5; X <= waterX + 5; X++) hew(X, labY + 10);
    for (const X of [waterX - 5, waterX + 5]) {
      for (let Y = labY + 6; Y <= labY + 10; Y++) hew(X, Y);
    }
    for (let X = waterX - 3; X <= waterX + 3; X++) {
      set(X, labY + 8, Cell.Water, packRGB(54, 126, 208));
      set(X, labY + 9, Cell.Water, packRGB(44, 112, 190));
    }
    set(waterX + s * 7, labY + 9, Cell.Fire, packRGB(255, 104, 28));
    w.life[w.idx(waterX + s * 7, labY + 9)] = 260;
    const lavaWallA = waterX - s * 8;
    const lavaWallB = waterX - s * 5;
    const lavaX0 = Math.min(lavaWallA, lavaWallB);
    const lavaX1 = Math.max(lavaWallA, lavaWallB);
    for (let X = lavaX0; X <= lavaX1; X++) hew(X, labY + 10);
    for (const X of [lavaWallA, lavaWallB]) {
      for (let Y = labY + 7; Y <= labY + 10; Y++) hew(X, Y);
    }
    for (let X = lavaX0 + 1; X <= lavaX1 - 1; X++) set(X, labY + 9, Cell.Lava, packRGB(255, 95, 24));

    // Spark station: a real charge latch opens an optional sample shutter.
    const doorX = labX + s * 18;
    const door = makeDoor(ctx, mechanisms, doorX - (s < 0 ? 3 : 0), labY + 4, 4, 6);
    makeChargeLatch(w, mechanisms, labX + s * 12, labY + 10, door);
    for (let Y = labY + 6; Y <= labY + 10; Y++) set(doorX + s * 5, Y, Cell.Gold, goldColor());

    const rewardX = labX;
    const rewardY = labY + 5;
    for (let X = rewardX - 2; X <= rewardX + 2; X++) hew(X, rewardY + 1);
    pickups.push(makePickup('tome', rewardX, rewardY, { card: 'heavy' }));
    authoredLights.push({
      x: labX,
      y: labY,
      r: 0.55,
      g: 0.82,
      b: 1.0,
      intensity: 1.05,
      radius: 52,
      bloom: 0.4,
      flicker: 0.18,
      flickerPhase: 4.2,
      falloff: 'soft',
      occluded: true,
    });
    ledger.reserve(labX - 28, labY - 16, labX + 28, labY + 16, 'spell-lab');
    spellLab = { x: labX, y: labY + 10, rewardX, rewardY };
  }

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
    connectToCavesFrom(w, rng, graph, kx - 8, kyBase, 12, fits, { halfW: 7, up: 21, down: 9 });
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
    // chamber: carved room with a stone floor (>= 22 clear above the shelf)
    carveRoomWithFloor(vx, vy, 14, 12, 13);
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
        makePickup('goldpile', px2 + 29, py2 + 9, { amount: 30 + Math.floor(rng.next() * 30) }),
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
      });

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
  // A vast scorched chamber with lava moats, and the strategy hanging from
  // the ceiling: a metal-cased water tank sealed by a breakable stone plug.
  // Flood the kiln, thermal-shock the colossus.
  let boss: { x: number; y: number; kind?: EnemyKind } | null = null;
  if (!def.nextLevelId && !def.branch) {
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

  // ---- The Sump (depth 4 only): the leviathan's cistern ----
  // The mid-descent boss, built as the Kiln's mirror: where the colossus
  // hides its weakness in a ceiling tank you must OPEN, the leviathan hides
  // in a basin you must EMPTY. A metal-cased pool with three stone drain
  // plugs in its floor (gold dust marks them): dig the plugs and the water
  // falls away into the caves below — a beached leviathan is just meat.
  // The pool is also one big conductor, and so is the blood it sheds into
  // it. The cistern PERCHES above d4's flood line on purpose: every drop
  // drained runs downhill to the ocean and can never climb back.
  if (def.depth === 4 && !def.branch) {
    let cx = Math.floor(WIDTH * (0.3 + rng.next() * 0.4));
    const cy = Math.floor(HEIGHT * 0.52);
    for (let a = 0; a < 24; a++) {
      const clear =
        Math.abs(cx - spawn.x) > 200 &&
        Math.abs(cx - portalX) > 160 &&
        !ledger.intersects(cx - 44, cy - 26, cx + 44, cy + 36);
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
    connectToCaves(cx - 38, cy + 12);
    connectToCaves(cx + 38, cy + 12);
    // The arena's fragile organs, re-assertable after the gauge-rescue pass
    // (whose stone-eating tunnels pre-opened all three drains on seed 1).
    // Idempotent: casing, plugs, gold tells, and a refill of whatever water
    // a wandering carve deleted. Shores stay as the rescue left them — a
    // tunnel through a shore is connectivity, not vandalism.
    sumpRepair = (): void => {
      // Reseal the casing, plug slots, and gold tells (the shell stamper);
      // the rescue's stone-eating tunnels never re-dig the drains, so the
      // construction-only shaft loop is deliberately NOT replayed here.
      stampSumpShell();
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

  // ---- The Gilded Vault's arches (the first BRANCH off the spine) ----
  // One stamp serves both ends: two gold pillars under a brass lintel with
  // a crystal keystone. The transition trigger (Levels.update) is the space
  // BETWEEN the pillars; the marker itself is runtime data like the portal,
  // so chaos can redecorate the arch but never delete the way home.
  const stampArch = (cx2: number, feetY: number): void => {
    for (const px of [cx2 - 6, cx2 + 6]) {
      for (let Y = feetY - 6; Y <= feetY; Y++) {
        if (!w.inBounds(px, Y)) continue;
        const i = w.idx(px, Y);
        w.types[i] = Cell.Gold;
        w.colors[i] = goldColor();
      }
    }
    for (let X = cx2 - 6; X <= cx2 + 6; X++) {
      if (!w.inBounds(X, feetY - 7)) continue;
      const i = w.idx(X, feetY - 7);
      w.types[i] = Cell.Metal;
      w.colors[i] = packRGB(148, 128, 84); // brass lintel
    }
    for (let X = cx2 - 1; X <= cx2 + 1; X++) {
      const i = w.idx(X, feetY - 6);
      w.types[i] = Cell.Crystal;
      w.colors[i] = crystalColor();
    }
    authoredLights.push({
      x: cx2,
      y: feetY - 4,
      r: 1.0,
      g: 0.82,
      b: 0.45,
      intensity: 1.2,
      radius: 36,
      bloom: 0.45,
      flicker: 0.18,
      flickerPhase: 0.9,
      falloff: 'soft',
      occluded: true,
    });
  };

  // Mutually exclusive with the depth-1 Spell Lab above (see note there): a
  // depth-1 branch would overlap this hoard. worldgraph guarantees no such level.
  if (def.branch) {
    // BRANCH SIDE: the way home stands on a gold dais in the spawn chamber,
    // far enough from the arrival spot that a fresh traveler never bounces
    // straight back through it.
    const ax = Math.floor(spawn.x) - 16;
    const fy = settleY(ax, Math.floor(spawn.y));
    // the dais runs east past the back-spot — arrivals must LAND on stone,
    // not step off the platform's edge into whatever the chamber rolled
    for (let X = ax - 8; X <= ax + 18; X++) {
      for (let Y = fy + 1; Y <= fy + 2; Y++) {
        if (!w.inBounds(X, Y)) continue;
        const i = w.idx(X, Y);
        if (w.types[i] !== Cell.Metal) {
          w.types[i] = Cell.Stone;
          w.colors[i] = stoneColor();
        }
      }
    }
    carveRectCells(w, ax - 7, fy - 20, ax + 17, fy); // headroom over the dais
    stampArch(ax, fy);
    vaultArch = { x: ax, y: fy, backX: ax + 14, backY: fy };

    // ...and the HOARD: the farthest main-path region carries the prize —
    // the vault's unique card, twin piles of Aurum Catalyst, and raw gold,
    // watched by the elite golems Levels posts at the chamber flanks.
    let best: { cx: number; cy: number } | null = null;
    let bestD = -1;
    for (const reg of graph.regions) {
      if (!reg.onMainPath && reg.area < 250) continue;
      if (ledger.intersects(reg.cx, reg.cy, reg.cx, reg.cy)) continue;
      const d = Math.abs(reg.cx - spawn.x) + Math.abs(reg.cy - spawn.y) * 0.6;
      if (d > bestD) {
        bestD = d;
        best = { cx: reg.cx, cy: reg.cy };
      }
    }
    const hx = Math.floor(best ? best.cx : WIDTH - spawn.x);
    const hyBase = Math.floor(best ? best.cy : HEIGHT * 0.5);
    carvePocket(hx, hyBase, 14, 12);
    for (let dx = -13; dx <= 13; dx++) {
      const Y = hyBase + 11;
      if (!w.inBounds(hx + dx, Y)) continue;
      const i = w.idx(hx + dx, Y);
      if (w.types[i] !== Cell.Metal) {
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
      }
    }
    const hy = hyBase + 10;
    // gilded ring in the chamber's rock skin
    for (let f = 0; f < 30; f++) {
      const a = rng.next() * Math.PI * 2;
      const gx = Math.floor(hx + Math.cos(a) * (13 + rng.next() * 4));
      const gy = Math.floor(hyBase + Math.sin(a) * (10 + rng.next() * 4));
      if (!w.inBounds(gx, gy)) continue;
      const ii = w.idx(gx, gy);
      if (w.types[ii] === Cell.Wall) {
        w.types[ii] = Cell.Gold;
        w.colors[ii] = goldColor();
      }
    }
    // the catalyst strike: twin resting piles of the philosopher's dust
    for (const side of [-8, 8]) {
      for (let dx = -2; dx <= 2; dx++) {
        const i = w.idx(hx + side + dx, hy);
        w.types[i] = Cell.Catalyst;
        w.colors[i] = catalystColor();
      }
      for (let dx = -1; dx <= 1; dx++) {
        const i = w.idx(hx + side + dx, hy - 1);
        w.types[i] = Cell.Catalyst;
        w.colors[i] = catalystColor();
      }
    }
    pickups.push(makePickup('tome', hx, hy - 1, { card: 'vitrify' }));
    pickups.push(makePickup('chest', hx - 4, hy - 1));
    pickups.push(makePickup('heart', hx + 12, hy - 1));
    pickups.push(makePickup('goldpile', hx + 4, hy - 1, { amount: 60 + Math.floor(rng.next() * 60) }));
    pickups.push(makePickup('goldpile', hx - 12, hy - 1, { amount: 60 + Math.floor(rng.next() * 60) }));
    connectToCavesFrom(w, rng, graph, hx - 15, hyBase + 3, 12, fits, { halfW: 7, up: 21, down: 9 });
    authoredLights.push({
      x: hx,
      y: hyBase + 2,
      r: 1.0,
      g: 0.8,
      b: 0.4,
      intensity: 1.1,
      radius: 40,
      bloom: 0.4,
      flicker: 0.25,
      flickerPhase: 1.3,
      falloff: 'soft',
      occluded: true,
    });
    ledger.reserve(hx - 16, hyBase - 12, hx + 16, hyBase + 12, 'vault-hoard');
    vaultHoard = { x: hx, y: hy - 2 };
  } else if (opts?.hostArch) {
    // HOST SIDE: the hidden arch alcove. Deep rock off the beaten path, a
    // walk-in gallery to the cave network — then five columns of fresh
    // masonry sealed across the throat, flecked with gold on the gallery
    // face. The glitter is the tell, the dig is the discovery (the
    // secret-room grammar): stone like any other stone, no special flags.
    let ax = -1,
      ay = -1,
      tries = 0;
    while (tries < 9000) {
      tries++;
      const rockMin = tries < 4000 ? 0.8 : tries < 7000 ? 0.5 : 0;
      const clearMin = tries < 4000 ? 170 : tries < 7000 ? 110 : 70;
      const cand = 150 + Math.floor(rng.next() * (WIDTH - 300));
      const candY = 110 + Math.floor(rng.next() * (HEIGHT - 290));
      if (Math.abs(cand - spawn.x) < clearMin || Math.abs(cand - portalX) < clearMin * 0.75)
        continue;
      if (ledger.intersects(cand - 19, candY - 14, cand + 19, candY + 14)) continue;
      let rock = 0,
        cells = 0,
        collide = false;
      for (let dy = -13; dy <= 13 && !collide; dy++) {
        for (let dx = -18; dx <= 18; dx++) {
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
      ax = cand;
      ay = candY;
      break;
    }
    if (ax < 0) {
      let best: { cx: number; cy: number; d: number } | null = null;
      for (const reg of graph.regions) {
        if (reg.area < 180) continue;
        const cx = Math.floor(clamp(reg.cx, 80, WIDTH - 80));
        const cy = Math.floor(clamp(reg.cy, 120, HEIGHT - 100));
        if (ledger.intersects(cx - 19, cy - 14, cx + 19, cy + 14)) continue;
        const d = Math.abs(cx - spawn.x) + Math.abs(cy - spawn.y) * 0.6;
        if (!best || d > best.d) best = { cx, cy, d };
      }
      ax = best ? best.cx : Math.floor(clamp(WIDTH - spawn.x, 80, WIDTH - 80));
      ay = best ? best.cy : Math.floor(clamp(HEIGHT * 0.46, 120, HEIGHT - 100));
    }
    if (ax >= 0) {
      carveRectCells(w, ax - 16, ay - 12, ax + 16, ay + 12);
      for (let X = ax - 16; X <= ax + 16; X++) {
        for (const Y of [ay + 11, ay + 12]) {
          if (!w.inBounds(X, Y)) continue;
          const i = w.idx(X, Y);
          if (w.types[i] !== Cell.Metal) {
            w.types[i] = Cell.Stone;
            w.colors[i] = stoneColor();
          }
        }
      }
      const fy = ay + 10;
      stampArch(ax + 8, fy);
      // walk-in gallery: starts 24 out so its swept rect can never notch
      // the alcove roof; the start disc blows the doorway through the wall
      connectToCavesFrom(w, rng, graph, ax - 24, ay + 2, 12, fits, { halfW: 7, up: 21, down: 9 });
      // the seal spans every column the start disc can reach (it carves to
      // ax-12), so the throat closes fully — five diggable columns of stone
      for (let X = ax - 16; X <= ax - 12; X++) {
        for (let Y = ay - 12; Y <= ay + 12; Y++) {
          if (!w.inBounds(X, Y)) continue;
          const i = w.idx(X, Y);
          if (w.types[i] !== Cell.Metal) {
            w.types[i] = Cell.Stone;
            w.colors[i] = stoneColor();
          }
        }
      }
      for (let f = 0; f < 12; f++) {
        const Y = ay - 9 + Math.floor(rng.next() * 19);
        const i = w.idx(ax - 16, Y);
        if (w.types[i] === Cell.Stone) {
          w.types[i] = Cell.Gold;
          w.colors[i] = goldColor();
        }
      }
      // a faint warm glint outside the seal draws the eye down the gallery
      authoredLights.push({
        x: ax - 19,
        y: ay + 2,
        r: 1.0,
        g: 0.75,
        b: 0.4,
        intensity: 0.7,
        radius: 26,
        bloom: 0.3,
        flicker: 0.35,
        flickerPhase: 1.7,
        falloff: 'soft',
        occluded: true,
      });
      ledger.reserve(ax - 17, ay - 13, ax + 17, ay + 13, 'vault-arch');
      vaultArch = { x: ax + 8, y: fy, backX: ax - 5, backY: fy, discoverX: ax - 19, discoverY: ay + 2 };
    }
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
    vaultArch,
    vaultHoard,
    sumpRepair,
  };
}
