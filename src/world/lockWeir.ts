import type { Rng } from '@/core/rng';
import type { Ctx, Mechanism } from '@/core/types';
import { makeChargeLatch, makeLever, makeValve } from '@/core/mechanismFactories';
import { Cell } from '@/sim/CellType';
import { packRGB, stoneColor, waterColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { RoomSpec, Site } from '@/world/lightPuzzles';
import {
  brass, buildVault, LOCK_AIR, LOCK_METAL, lockCell, lockLight, paintVaultDoor, putCell, stampVaultBox, vaultLayout, type LockOutput, type LockRoom,
} from '@/world/locks';

/* ============================================================
 * D3 — THE WEIR (the Drowned Cisterns' lock).
 *
 * The hall's floor dips into a dry brass-lined POOL (a ford: ramps of one row to two columns, nine
 * deep, forty wide: chest-high on the alchemist), and from the pool's bottom a narrow WELL goes down to
 * a charge-latch coil. A great cistern hangs from the roof over it, its outlet shut by a sluice valve;
 * a lever by the dais works it. Water is the wire: a coil in a dry well drinks nothing (a bolt at the
 * lining rings the brass, and the brass has nowhere to put it), but with water in the well the lining
 * hands its current to the water and the coil latches, the relay counts a moment and the vault door
 * lets go.
 *
 *   dry well + a bolt on the lining ... nothing (the brass rings; the coil stays asleep)
 *   lever, then a bolt ................ the cistern empties into the pool, the bolt rings the lining,
 *                                       the lining energises the wet well, the coil latches
 *   your own flask poured in ........... works too (any water in the well will do)
 *
 * Every conductor is METAL (a rescue tunnel eats stone and spares only metal), so nothing can be dug
 * round, and the way to the vault runs through the pool, wet or dry. The cistern's water is placed cell
 * by cell inside a CLOSED casing that it fills to the roof (a mass of water that touches air is loose
 * stock to the generator's sweeps) and is never "settled". The coil's zone is tightened to the well's
 * own water (the brass round it is part of the circuit and would latch it dry otherwise).
 * ============================================================ */

/** The room's floor stands this many rows above its bottom: the pool and the well sink into the room's own rock. */
export const WEIR_FLOOR_OFF = 20;

export const WEIR_ROOMS: readonly RoomSpec[] = [
  { id: 'lock-weir', w: 176, h: 90, minSpawnDist: 200 },
  { id: 'lock-weir', w: 170, h: 88, minSpawnDist: 150 },
];

/**
 * depth: rows the pool sinks; the flat bottom spans px-4..px+3; the well is three wide and `wellRows` deep;
 * the cistern's interior is 2 x tankHalf wide.
 */
export const WEIR = { depth: 9, wellRows: 6, tankHalf: 10, wall: 2, lining: 3 } as const;

/** How much of the pool and well the cistern's water fills: most of it, never to the brim. */
const FILL_FRACTION = 0.86;

export interface WeirLayout {
  x1: number; floorY: number;
  /** The well's centre column. */
  px: number;
  /** First row of the well's interior, and the coil's row (the lining's first row under the well). */
  wellTop: number; pedY: number;
  /** The cistern's outer box. */
  tankX0: number; tankX1: number; tankY0: number; tankY1: number;
  ceilingY: number;
  /** The valve in the cistern's floor, over the well. */
  valve: { x: number; y: number; w: number; h: number };
  dais: { x0: number; x1: number; top: number };
  leverX: number;
}

/** The weir's geometry from its room, for the builder, the repair and the probes. */
export function weirLayout(at: Site, spec: RoomSpec): WeirLayout {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - WEIR_FLOOR_OFF;
  const px = at.x0 + 84;
  const wellTop = floorY + WEIR.depth;
  const ceilingY = at.y0 + 10;
  const tankY0 = ceilingY + 6;
  const tankY1 = tankY0 + WEIR.wall * 2 + tankRows() - 1;
  return {
    x1, floorY, px, wellTop, pedY: wellTop + WEIR.wellRows,
    tankX0: px - WEIR.tankHalf - WEIR.wall, tankX1: px + WEIR.tankHalf - 1 + WEIR.wall, tankY0, tankY1, ceilingY,
    valve: { x: px - 1, y: tankY1 - 1, w: 4, h: 2 },
    dais: { x0: px - 40, x1: px - 32, top: floorY - 3 },
    leverX: px - 47,
  };
}

/** The pool's surface row at column x: the floor row outside the dent, deeper to the flat bottom (px-4..px+3). */
export function bowlSurface(L: Pick<WeirLayout, 'px' | 'floorY'>, x: number): number {
  const t = x < L.px - 4 ? L.px - 4 - x : x > L.px + 3 ? x - (L.px + 3) : 0;
  return L.floorY + Math.max(0, WEIR.depth - Math.ceil(t / 2));
}

/** Columns the dent (and its lining) spans: the last of each side is one row deep. */
const DENT_REACH = 2 * (WEIR.depth - 1);
export const dentX0 = (px: number): number => px - 4 - DENT_REACH;
export const dentX1 = (px: number): number => px + 3 + DENT_REACH;

/** The pool and the well's open cells (what a flood can fill). */
export function bowlInterior(L: Pick<WeirLayout, 'px' | 'floorY' | 'wellTop'>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = dentX0(L.px); x <= dentX1(L.px); x++) {
    const s = bowlSurface(L, x);
    for (let y = L.floorY; y < s; y++) out.push([x, y]);
  }
  for (let y = L.wellTop; y < L.wellTop + WEIR.wellRows; y++) for (let x = L.px - 1; x <= L.px + 1; x++) out.push([x, y]);
  return out;
}

/** The open cells the pool and the well hold (a constant of the geometry). */
export function weirCapacity(): number {
  return bowlInterior({ px: 0, floorY: 0, wellTop: WEIR.depth }).length;
}

/** The cistern's interior rows: it is filled to the roof (see the header), so its size follows the water. */
export function tankRows(): number {
  return Math.ceil(Math.round(weirCapacity() * FILL_FRACTION) / (WEIR.tankHalf * 2));
}

/** Stamp (or re-stamp) every Metal part: the lining, the well, the coil's footing, the cistern, its chains. Idempotent. `fill` also carves the open cells. */
export function stampWeir(world: World, L: WeirLayout, fill: boolean): void {
  const { px, floorY } = L;
  const metal = (x: number, y: number, c: number): void => { if (lockCell(world, x, y) !== Cell.Metal) putCell(world, x, y, Cell.Metal, c); };
  for (let x = dentX0(px); x <= dentX1(px); x++) {
    const s = bowlSurface(L, x);
    if (fill) for (let y = floorY; y < s; y++) if (lockCell(world, x, y) !== Cell.Empty) putCell(world, x, y, Cell.Empty, LOCK_AIR);
    const wellCol = x >= px - 1 && x <= px + 1;
    // under the pool: a lining of three rows; under the well's walls (px-3..px-2, px+2..px+3) down to the coil's footing
    const bottom = x >= px - 3 && x <= px + 3 ? L.pedY + WEIR.lining - 1 : s + WEIR.lining - 1;
    for (let y = s; y <= bottom; y++) {
      if (wellCol && y < L.pedY) continue; // the well's open shaft
      const trim = y === s && (x + 1) % 3 === 0;
      metal(x, y, trim ? brass(x, y) : (x + y) % 5 === 0 ? packRGB(112, 108, 96) : LOCK_METAL);
    }
  }
  if (fill) for (let y = L.wellTop; y < L.pedY; y++) for (let x = px - 1; x <= px + 1; x++) if (lockCell(world, x, y) !== Cell.Empty) putCell(world, x, y, Cell.Empty, LOCK_AIR);
  // ---- the cistern: a closed casing hung from the roof by two chains ----
  for (let y = L.tankY0; y <= L.tankY1; y++) {
    for (let x = L.tankX0; x <= L.tankX1; x++) {
      const inside = x >= L.tankX0 + WEIR.wall && x <= L.tankX1 - WEIR.wall && y >= L.tankY0 + WEIR.wall && y <= L.tankY1 - WEIR.wall;
      if (inside) continue;
      if (y >= L.valve.y && y < L.valve.y + L.valve.h && x >= L.valve.x && x < L.valve.x + L.valve.w) continue; // the sluice's own cells
      metal(x, y, (x + y) % 7 === 0 ? brass(x, y) : packRGB(98 + ((x * 3 + y) % 6), 104 + ((x + y * 5) % 6), 114));
    }
  }
  for (const cx of [px - 8, px + 6]) {
    for (let y = L.ceilingY; y < L.tankY0; y++) for (const dx of [0, 1]) metal(cx + dx, y, (y >> 1) % 2 === 0 ? brass(cx + dx, y) : LOCK_METAL);
  }
}

export function weirRoom(ctx: Ctx, rng: Rng, out: LockOutput): LockRoom {
  const world = ctx.world;
  let plug: Mechanism | null = null;
  return {
    sizes: WEIR_ROOMS,
    floorOff: WEIR_FLOOR_OFF,
    approach: (at, _spec, floorY) => ({ x0: at.x0 + 8, y0: at.y0 + 10, x1: at.x0 + 40, y1: floorY - 1 }),
    build: (at, spec, floorY) => {
      const L = weirLayout(at, spec);
      const { px, x1 } = L;
      // ---- the vault (box, door, relay, key) at the east end ----
      const vault = buildVault(world, rng, out, x1, floorY, 'weir');
      plug = vault.plug;
      // ---- the pool, the well and the cistern ----
      stampWeir(world, L, true);
      // the coil, asleep at the foot of the well: its zone is the well's own water (the brass round it is on the circuit)
      const coil = makeChargeLatch(world, out.mechanisms, px, L.pedY, vault.relay);
      coil.zone = { x0: px - 1, y0: L.pedY - 4, x1: px + 1, y1: L.pedY - 1 };
      // the sluice, over the well; one throw opens it for good (the cistern has only the one emptying)
      const valve = makeValve(ctx, out.mechanisms, L.valve.x, L.valve.y, L.valve.w, L.valve.h, { material: Cell.Metal, oneShot: true });
      // the lever, on the floor by the dais, on iron footing pads
      for (let dx = -1; dx <= 1; dx++) putCell(world, L.leverX + dx, floorY, Cell.Metal, LOCK_METAL);
      makeLever(out.mechanisms, L.leverX, floorY - 1, valve);
      // ---- the cistern's water: cell by cell, the casing FULL (enough to fill the well and most of the pool) ----
      for (let y = L.tankY0 + WEIR.wall; y <= L.tankY1 - WEIR.wall; y++) {
        for (let x = L.tankX0 + WEIR.wall; x <= L.tankX1 - WEIR.wall; x++) putCell(world, x, y, Cell.Water, waterColor());
      }
      // ---- the dais to stand on (a three-step stone mound, brass-inlaid on top: colour only) ----
      for (let k = 0; k < 3; k++) {
        const y = floorY - 1 - k;
        for (let x = L.dais.x0 - 2 + k; x <= L.dais.x1 + 2 - k; x++) {
          putCell(world, x, y, Cell.Stone, y === L.dais.top && x >= L.dais.x0 + 1 && x <= L.dais.x1 - 1 ? brass(x, y) : stoneColor());
        }
      }
      // ---- the lamps: the cistern's water lit through its casing, the pool and the dais, the coil's well ----
      out.lights.push(lockLight(px, L.tankY0 + 8, [0.4, 0.75, 1], 34, 1.1, 0.12, false));
      out.lights.push(lockLight(px, floorY - 14, [0.75, 0.9, 1], 60, 1.0, 0.18));
      out.lights.push(lockLight((L.dais.x0 + L.dais.x1) / 2, floorY - 12, [1, 0.86, 0.55], 30, 0.8, 0.25));
      out.lights.push(lockLight(px, L.wellTop + 2, [0.5, 0.82, 1], 20, 0.8, 0.3));
    },
    repair: (at, spec, floorY) => () => {
      const L = weirLayout(at, spec);
      stampWeir(world, L, false);
      stampVaultBox(world, vaultLayout(L.x1, floorY));
      for (const [x, y] of plug?.body ?? []) if (lockCell(world, x, y) !== Cell.Metal) putCell(world, x, y, Cell.Metal, LOCK_METAL);
      paintVaultDoor(world, vaultLayout(L.x1, floorY));
      for (let dx = -1; dx <= 1; dx++) if (lockCell(world, L.leverX + dx, floorY) !== Cell.Metal) putCell(world, L.leverX + dx, floorY, Cell.Metal, LOCK_METAL);
    },
  };
}
