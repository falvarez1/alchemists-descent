import { HEIGHT } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type { Ctx, PlacedPrefab, Pickup, RegionGraph } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { randomCard, TOME_REWARD_POOL } from '@/content/cardRewardPools';
import { Cell } from '@/sim/CellType';
import { brineColor, coalColor, crystalColor, goldColor, packRGB, stoneColor, waterColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { PlacementLedger } from '@/world/connect';
import { iceShade, type ColdStoreSite } from '@/world/coldStore';
import { carveRoom, findRoomSite, intrudes, restore, ROOM_MARGIN, roomReachable, snapshot, type RoomSpec, type Site } from '@/world/lightPuzzles';

/* ============================================================
 * THE COLD STORE'S PUZZLES (wave 3). Rooms carved off the caves and joined
 * to the main path (world/lightPuzzles' room helpers: degrading site search,
 * a connector that must reach, a rollback that never half-builds), each a
 * piece of real-cell chemistry with a reward and a fail-open way through.
 *
 *  THE FROZEN FALL — a brine lake too wide to jump or float across, a
 *  store-tank of fresh water sealed over it by a stone plug. Break the plug
 *  and the water falls into the lake and FLOATS on the heavier brine; freeze
 *  that fresh layer (nitrogen, a frost shard, a cryo jet) and it is a bridge
 *  — which the brine beneath then eats, so it will not last. Wading the
 *  brine is the fail-open, and it bites.
 *
 *  THE ICE VAULT — the store-keeper's strongroom, walled in a thick block of
 *  real ice. Heat it (the coal brazier at its foot), blast it, or open the
 *  brine cistern above it (a stone plug) and let the salt eat it through;
 *  the dig ray works too, slowly.
 * ============================================================ */

export interface ColdStorePuzzleOutput {
  pickups: Pickup[];
  placed: PlacedPrefab[];
  /** Re-assert the tanks' seals and liquid after the rescue passes (idempotent). */
  repairs: Array<() => void>;
}

export const FALL_ROOMS: readonly RoomSpec[] = [
  { id: 'cold-frozen-fall', w: 230, h: 116, minSpawnDist: 200 },
  { id: 'cold-frozen-fall', w: 206, h: 108, minSpawnDist: 160 },
];
export const VAULT_ROOMS: readonly RoomSpec[] = [
  { id: 'cold-ice-vault', w: 132, h: 84, minSpawnDist: 180 },
  { id: 'cold-ice-vault', w: 116, h: 78, minSpawnDist: 140 },
];
const CASING = packRGB(88, 98, 112);
const AIR = 0x08080c;

function t(world: World, x: number, y: number): number {
  return world.inBounds(x, y) ? world.types[world.idx(x, y)] : Cell.Wall;
}

function put(world: World, x: number, y: number, type: number, color: number): void {
  if (!world.inBounds(x, y)) return;
  const i = world.idx(x, y);
  world.types[i] = type;
  world.colors[i] = color;
  world.life[i] = 0;
  world.clearChargeAt(i);
}

/** A small crystal lamp: light is information (the reward reads from afar). */
function coldLamp(world: World, x: number, y: number): void {
  for (let dx = -1; dx <= 1; dx++) put(world, x + dx, y, Cell.Crystal, crystalColor());
  put(world, x, y - 1, Cell.Crystal, crystalColor());
}

/** The fall's geometry, for its builder and the probes. */
export function fallLayout(at: Site, spec: RoomSpec): {
  floorY: number; lakeL: number; lakeR: number; surface: number; lakeBottom: number;
  tankX: number; tankHalf: number; mouth: number; tankTop: number; rewardX: number;
} {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - 14;
  const lakeL = at.x0 + 44, lakeR = x1 - 44;
  const mouth = at.y0 + 10;
  return {
    floorY, lakeL, lakeR, surface: floorY + 6, lakeBottom: floorY + 22,
    tankX: Math.floor((lakeL + lakeR) / 2), tankHalf: 22, mouth, tankTop: mouth - 12, rewardX: x1 - 22,
  };
}

function frozenFall(world: World, rng: Rng, at: Site, spec: RoomSpec, out: ColdStorePuzzleOutput): void {
  const x1 = at.x0 + spec.w - 1;
  const L = fallLayout(at, spec);
  // The chasm: carved down from the ledge line, lined with stone, brine up to
  // six rows under the ledges.
  for (let y = L.floorY; y <= L.lakeBottom + 3; y++) {
    for (let x = L.lakeL - 3; x <= L.lakeR + 3; x++) {
      const wall = x < L.lakeL || x > L.lakeR || y > L.lakeBottom;
      if (wall) put(world, x, y, Cell.Stone, stoneColor());
      else if (y >= L.surface) put(world, x, y, Cell.Brine, brineColor());
      else put(world, x, y, Cell.Empty, AIR);
    }
  }
  // Re-assertable after the rescue tunnels (they eat stone and spare only
  // metal): the lining where a tunnel opened it, and the brine it let out.
  out.repairs.push(() => {
    for (let y = L.floorY + 1; y <= L.lakeBottom + 3; y++) {
      for (let x = L.lakeL - 3; x <= L.lakeR + 3; x++) {
        const wall = x < L.lakeL || x > L.lakeR || y > L.lakeBottom;
        const here = t(world, x, y);
        if (wall && here === Cell.Empty) put(world, x, y, Cell.Stone, stoneColor());
        else if (!wall && y >= L.surface && here === Cell.Empty) put(world, x, y, Cell.Brine, brineColor());
      }
    }
  });
  // The store-tank in the ceiling over the lake's middle: a metal casing of
  // fresh water, sealed underneath by two rows of stone with gold dust below
  // it (the diggers' tell). Its body is buried in the rock above the room.
  const cx = L.tankX, half = L.tankHalf, mouth = L.mouth, tankTop = L.tankTop;
  const stampTank = (): void => {
    for (let y = tankTop - 1; y <= mouth + 1; y++) {
      for (let x = cx - half - 1; x <= cx + half + 1; x++) {
        const casing = Math.abs(x - cx) > half - 1 || y < tankTop;
        if (casing) { if (t(world, x, y) !== Cell.Metal) put(world, x, y, Cell.Metal, CASING); continue; }
        if (y >= mouth) { if (t(world, x, y) !== Cell.Stone) put(world, x, y, Cell.Stone, stoneColor()); continue; }
        if (t(world, x, y) !== Cell.Water) put(world, x, y, Cell.Water, waterColor());
      }
    }
  };
  stampTank();
  for (let k = 0; k < 10; k++) {
    const gx = cx - half + 2 + rng.int(half * 2 - 3);
    if (t(world, gx, mouth + 2) === Cell.Empty) put(world, gx, mouth + 2, Cell.Gold, goldColor());
  }
  out.repairs.push(stampTank);
  // The far ledge's niche, lit, with the reward.
  for (let y = L.floorY - 18; y <= L.floorY - 1; y++) for (let x = x1 - 30; x <= x1 - 9; x++) put(world, x, y, Cell.Empty, AIR);
  coldLamp(world, x1 - 12, L.floorY - 1);
  out.pickups.push(makePickup('tome', L.rewardX, L.floorY - 2, { card: randomCard(TOME_REWARD_POOL, () => rng.next()) }));
  out.pickups.push(makePickup('goldpile', x1 - 30, L.floorY - 1, { amount: 50 + rng.int(40) }));
  // A lamp on the near ledge too, so the lake reads from the doorway.
  coldLamp(world, at.x0 + 30, L.floorY - 1);
}

/** The vault's geometry, for its builder and the probes. */
export function vaultLayout(at: Site, spec: RoomSpec): {
  floorY: number; vx0: number; vx1: number; vy0: number; vy1: number; wallX0: number; bx0: number; bx1: number; by0: number; by1: number; fireX: number;
} {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - 12;
  const vx0 = x1 - 44, vx1 = x1 - 12, vy0 = floorY - 26, vy1 = floorY - 1;
  const bx0 = vx0 - 12, bx1 = vx0 + 1, by1 = vy0 - 3;
  return { floorY, vx0, vx1, vy0, vy1, wallX0: vx0 - 10, bx0, bx1, by0: by1 - 9, by1, fireX: vx0 - 15 };
}

function iceVault(world: World, rng: Rng, at: Site, spec: RoomSpec, out: ColdStorePuzzleOutput): void {
  const V = vaultLayout(at, spec);
  // The strongroom against the east wall: a metal box whose west side is a
  // block of real ice (the door you must melt, blast or salt away).
  for (let y = V.vy0 - 2; y <= V.floorY + 2; y++) {
    for (let x = V.vx0 - 12; x <= V.vx1 + 2; x++) {
      const inside = x >= V.vx0 && x <= V.vx1 && y >= V.vy0 && y <= V.vy1;
      const iceWall = x >= V.wallX0 && x < V.vx0 && y >= V.vy0 && y <= V.vy1;
      if (inside) put(world, x, y, Cell.Empty, AIR);
      else if (iceWall) put(world, x, y, Cell.Ice, iceShade(2, x * 3 + y));
      else if (x >= V.vx0 - 2 || y > V.vy1) put(world, x, y, Cell.Metal, CASING);
    }
  }
  // The ice wall's faces: pale rime outside, deep blue within.
  for (let y = V.vy0; y <= V.vy1; y++) {
    put(world, V.wallX0, y, Cell.Ice, iceShade(0, y * 5));
    put(world, V.vx0 - 1, y, Cell.Ice, iceShade(1, y * 7));
  }
  // The wall is the puzzle: a later connector or rescue tunnel that ate into
  // it (they spare only metal) is filled back in. Only the wall's own rect,
  // and only open cells — the strongroom behind it is metal-sealed, so a
  // tunnel through the wall could only ever have led into the vault.
  out.repairs.push(() => {
    for (let y = V.vy0; y <= V.vy1; y++) {
      for (let x = V.wallX0; x < V.vx0; x++) {
        if (t(world, x, y) === Cell.Empty) put(world, x, y, Cell.Ice, iceShade(x === V.wallX0 ? 0 : 2, x * 3 + y));
      }
    }
  });
  // The brine cistern over the ice wall: a metal basin whose floor is a
  // stone plug right over the wall's top (gold dust on its lip: the tell).
  const stampCistern = (): void => {
    for (let y = V.by0 - 1; y <= V.by1 + 1; y++) {
      for (let x = V.bx0 - 1; x <= V.bx1 + 1; x++) {
        const shell = x === V.bx0 - 1 || x === V.bx1 + 1 || y === V.by0 - 1;
        const plug = y >= V.by1;
        if (shell) { if (t(world, x, y) !== Cell.Metal) put(world, x, y, Cell.Metal, CASING); }
        else if (plug) { if (t(world, x, y) !== Cell.Stone) put(world, x, y, Cell.Stone, stoneColor()); }
        else if (t(world, x, y) !== Cell.Brine) put(world, x, y, Cell.Brine, brineColor());
      }
    }
  };
  stampCistern();
  out.repairs.push(stampCistern);
  // The cistern hangs from the roof on two iron rods, and the old brine line
  // (a pipe) feeds it from the rock above: it reads as plant, not a floating box.
  for (const hx of [V.bx0 + 1, V.bx1 - 1, Math.floor((V.bx0 + V.bx1) / 2)]) {
    for (let y = V.by0 - 2; y > V.by0 - 60; y--) {
      if (t(world, hx, y) !== Cell.Empty) break;
      put(world, hx, y, Cell.Metal, hx === Math.floor((V.bx0 + V.bx1) / 2) ? packRGB(70, 80, 92) : packRGB(52, 58, 68));
      if (hx === Math.floor((V.bx0 + V.bx1) / 2)) put(world, hx + 1, y, Cell.Metal, packRGB(96, 110, 124));
    }
  }
  put(world, V.bx0 - 2, V.by1 + 1, Cell.Gold, goldColor());
  put(world, V.bx0 - 3, V.by1 + 1, Cell.Gold, goldColor());
  // The coal brazier banked against the ice wall's foot: a stone bowl of coal
  // whose far side IS the ice — light it and its flames lick the wall.
  const fx = V.fireX;
  for (let x = fx - 4; x < V.wallX0; x++) put(world, x, V.floorY - 1, Cell.Stone, stoneColor());
  for (let k = 2; k <= 3; k++) put(world, fx - 4, V.floorY - k, Cell.Stone, stoneColor());
  for (let x = fx - 3; x < V.wallX0; x++) for (let k = 2; k <= 3; k++) put(world, x, V.floorY - k, Cell.Coal, coalColor());
  // Inside: the store-keeper's reward, and a lamp that shows it through the ice.
  coldLamp(world, V.vx1 - 3, V.vy1);
  out.pickups.push(makePickup('chest', V.vx0 + 10, V.vy1, { amount: 80 + rng.int(40) }));
  out.pickups.push(makePickup('tome', V.vx0 + 20, V.vy1 - 1, { card: randomCard(TOME_REWARD_POOL, () => rng.next()) }));
  coldLamp(world, at.x0 + 30, V.floorY - 1);
}

/** The Cold Store's two puzzle rooms (own forked stream; the shared ledger). */
export function placeColdStorePuzzles(
  ctx: Ctx, rng: Rng, graph: RegionGraph, ledger: PlacementLedger,
  site: ColdStoreSite, fits: Uint8Array | undefined, out: ColdStorePuzzleOutput,
): void {
  const kinds: Array<{ sizes: readonly RoomSpec[]; floorOff: number; build: (at: Site, spec: RoomSpec) => void }> = [
    { sizes: FALL_ROOMS, floorOff: 14, build: (at, spec) => frozenFall(ctx.world, rng, at, spec, out) },
    { sizes: VAULT_ROOMS, floorOff: 12, build: (at, spec) => iceVault(ctx.world, rng, at, spec, out) },
  ];
  const refused: PlacedPrefab[] = [];
  for (const { sizes, floorOff, build } of kinds) {
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      let at: Site | null = null, spec = sizes[0];
      for (const size of sizes) {
        at = findRoomSite(ctx.world, rng, graph, ledger, size, { ...site, maxY: HEIGHT - 70 }, [...out.placed, ...refused]);
        spec = size;
        if (at) break;
      }
      if (!at) break;
      const before = snapshot(ctx.world);
      const pickCount = out.pickups.length, repairCount = out.repairs.length;
      const x1 = at.x0 + spec.w - 1;
      const floorY = at.y0 + spec.h - floorOff;
      const interior = { x0: at.x0 + 8, y0: at.y0 + 10, x1: x1 - 8, y1: floorY - 1 };
      const mouth = { x: at.x0 + 22, y: floorY - 10 };
      const site0 = at;
      const rollback = (why: string): void => {
        restore(ctx.world, before);
        out.pickups.length = pickCount; out.repairs.length = repairCount;
        refused.push({ id: spec.id, x0: site0.x0, y0: site0.y0, x1, y1: site0.y0 + spec.h - 1 });
        console.warn(`[cold-store] ${spec.id}: ${why}; trying elsewhere`);
      };
      if (!carveRoom(ctx, rng, graph, fits, site.spawn, floorY, mouth, interior, ledger)) { rollback('could not be joined to the caves'); continue; }
      build(at, spec);
      if (!roomReachable(ctx.world, site.spawn, interior.x0, interior.y0, at.x0 + 40, floorY - 1)) { rollback('lost its approach'); continue; }
      if (intrudes(ctx.world, before.types, ledger)) { rollback('its carve cut into another placement'); continue; }
      ledger.reserve(at.x0 - ROOM_MARGIN, at.y0 - ROOM_MARGIN, x1 + ROOM_MARGIN, at.y0 + spec.h + ROOM_MARGIN, spec.id);
      out.placed.push({ id: spec.id, x0: at.x0, y0: at.y0, x1, y1: at.y0 + spec.h - 1 });
      done = true;
    }
    if (!done) console.warn(`[cold-store] no site for ${sizes[0].id}`);
  }
}
