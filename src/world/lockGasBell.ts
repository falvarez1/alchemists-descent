import type { Rng } from '@/core/rng';
import type { Ctx, Mechanism } from '@/core/types';
import { makeSensor } from '@/core/mechanismFactories';
import { Cell } from '@/sim/CellType';
import { glassColor, marshGasColor, packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { RoomSpec, Site } from '@/world/lightPuzzles';
import {
  brass, buildVault, LOCK_AIR, LOCK_METAL, lockCell, lockLight, paintVaultDoor, putCell, stampVaultBox, vaultLayout, type LockOutput, type LockRoom,
} from '@/world/locks';

/* ============================================================
 * D2 — THE GAS BELL (the Rot Gardens' lock).
 *
 * A great brass bell hangs from the hall's roof on an iron chain, high enough to
 * walk under, hung full of marsh gas: a closed metal vessel, a clapper (a heat
 * sensor) at its crown, a glass porthole in its belly on the side that faces the
 * entrance. Light the gas — one Spark Bolt up through the porthole, from the brass
 * inlay thirty-odd cells off — and the whole bell burns in a breath: the fire rings
 * the clapper, the clapper latches, the relay counts a moment and the vault door
 * lets go.
 *
 * It is retry-able: a vent feeds marsh gas back in at a slow drip until the clapper
 * has rung (and a one-cell pipe through the bell's base plate makes the bell's
 * inside part of the hall's air to the findability audit; gas never runs downhill,
 * so it does not leak). A lit bell is a racing front: standing under it when it
 * goes is the mistake the Docent has warned about.
 * ============================================================ */

export const GASBELL_ROOMS: readonly RoomSpec[] = [
  { id: 'lock-gas-bell', w: 176, h: 84, minSpawnDist: 200 },
  { id: 'lock-gas-bell', w: 164, h: 82, minSpawnDist: 150 },
];

/** The bell: half-ellipse over a flat base plate; 3 cells of wall; the vent drips a cell every `ventRate` frames; `gap` clear rows under it. */
export const BELL = { rx: 21, ry: 27, wall: 3, ventRate: 3, gap: 22 } as const;

export interface BellLayout {
  x1: number; floorY: number; bx: number;
  /** The base plate's bottom row, and the bell's lowest interior row. */
  bottomY: number; by: number;
  portHoleX: number; portY0: number; portY1: number;
  markX: number; sensorX: number; sensorY: number; zone: { x0: number; y0: number; x1: number; y1: number };
  pipeX: number;
}

/** The bell's geometry from its room, for its builder, the repair and the probes. */
export function bellLayout(at: Site, spec: RoomSpec): BellLayout {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - 12;
  // the hall's east end is the vault box (vaultLayout: its door starts at x1 - 50); the bell stands 15 cells off it
  const bx = x1 - 86;
  const bottomY = floorY - 1 - BELL.gap;
  const by = bottomY - 3;
  return {
    x1, floorY, bx, bottomY, by,
    portHoleX: bx - BELL.rx,
    // the porthole: the bell's belly on its west face, seven rows tall (a bolt is aimed UP to it from the inlay)
    portY0: by - 9, portY1: by - 3,
    markX: at.x0 + 42,
    sensorX: bx, sensorY: by - (BELL.ry - BELL.wall) + 3,
    zone: { x0: bx - (BELL.rx - BELL.wall), y0: by - (BELL.ry - BELL.wall) - 1, x1: bx + (BELL.rx - BELL.wall), y1: by - 1 },
    pipeX: bx + 8,
  };
}

/** The bell's interior cells (open), lowest row first. */
export function bellInterior(L: Pick<BellLayout, 'by' | 'bx'>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const ri = BELL.rx - BELL.wall, hi = BELL.ry - BELL.wall;
  for (let dy = 0; dy <= hi; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if ((dx * dx) / (ri * ri) + (dy * dy) / (hi * hi) <= 1) out.push([L.bx + dx, L.by - dy]);
    }
  }
  return out;
}

function inShell(dx: number, dy: number): boolean {
  const { rx, ry, wall } = BELL;
  const outer = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  const inner = (dx * dx) / ((rx - wall) * (rx - wall)) + (dy * dy) / ((ry - wall) * (ry - wall)) <= 1;
  return outer && !inner;
}

const key = (x: number, y: number): number => x * 4096 + y;

/** Stamp (or re-stamp) the bell's shell, base plate, chain and pipe; `fill` also writes the glass porthole and opens the pipe. */
function stampBell(world: World, L: BellLayout, ceilingY: number, fill: boolean): void {
  const { bx, by, bottomY } = L;
  for (let dy = 0; dy <= BELL.ry; dy++) {
    for (let dx = -BELL.rx; dx <= BELL.rx; dx++) {
      if (!inShell(dx, dy)) continue;
      const x = bx + dx, y = by - dy;
      if (dx < 0 && y >= L.portY0 && y <= L.portY1) {
        // the porthole: the shell's whole thickness is glass here (a repair never restores a shattered one)
        if (fill) putCell(world, x, y, Cell.Glass, glassColor());
        continue;
      }
      if (lockCell(world, x, y) !== Cell.Metal) {
        putCell(world, x, y, Cell.Metal, dy % 8 === 0 ? brass(x, y) : packRGB(150 + (dy % 5) * 3, 116 + (dx & 3) * 2, 56));
      }
    }
  }
  // the base plate: three rows of brass under the whole bell
  for (let y = by + 1; y <= bottomY; y++) {
    for (let dx = -BELL.rx; dx <= BELL.rx; dx++) {
      if (lockCell(world, bx + dx, y) !== Cell.Metal) putCell(world, bx + dx, y, Cell.Metal, y === bottomY || Math.abs(dx) === BELL.rx ? brass(bx + dx, y) : packRGB(122, 96, 48));
    }
  }
  // the chain from the crown to the roof: two cells wide, links alternating brass and iron
  for (let y = ceilingY; y < by - BELL.ry; y++) {
    for (const dx of [0, 1]) {
      if (lockCell(world, bx + dx, y) !== Cell.Metal) putCell(world, bx + dx, y, Cell.Metal, (y >> 1) % 2 === 0 ? brass(bx + dx, y) : LOCK_METAL);
    }
  }
  // The pipe: a one-cell hole down through the plate beside the bell's middle, sleeved in metal, its mouth open
  // to the hall under the bell — the way the audit sees the clapper. Gas never runs downhill, so it keeps its gas.
  const px = L.pipeX;
  for (let y = by + 1; y <= bottomY + 2; y++) if (fill || lockCell(world, px, y) !== Cell.Empty) putCell(world, px, y, Cell.Empty, LOCK_AIR);
  for (let y = bottomY + 1; y <= bottomY + 2; y++) {
    for (const dx of [-1, 1]) if (lockCell(world, px + dx, y) !== Cell.Metal) putCell(world, px + dx, y, Cell.Metal, LOCK_METAL);
  }
}

export function gasBellRoom(ctx: Ctx, rng: Rng, out: LockOutput): LockRoom {
  const world = ctx.world;
  let plug: Mechanism | null = null;
  return {
    sizes: GASBELL_ROOMS,
    floorOff: 12,
    fuelFree: true,
    approach: (at, _spec, floorY) => ({ x0: at.x0 + 8, y0: at.y0 + 10, x1: at.x0 + 40, y1: floorY - 1 }),
    build: (at, spec, floorY) => {
      const L = bellLayout(at, spec);
      const { bx, x1 } = L;
      const ceilingY = at.y0 + 10;
      // ---- the vault (box, door, relay, key) at the east end ----
      const vault = buildVault(world, rng, out, x1, floorY, 'gasbell');
      plug = vault.plug;
      // ---- the bell ----
      stampBell(world, L, ceilingY, true);
      const inside = bellInterior(L);
      // The clapper: a weight on a three-cell chain from the crown (the heat sensor), then the gas.
      const sensor: Mechanism = makeSensor(world, out.mechanisms, L.sensorX, L.sensorY, {
        sensorType: 'heat', threshold: 12, zone: L.zone, latch: 'permanent',
      }, vault.relay);
      sensor.cue = 'lock.bell'; // the clapper rings when the fire reaches it
      putCell(world, L.sensorX, L.sensorY, Cell.Metal, brass(L.sensorX, L.sensorY));
      const solid = new Set<number>([key(L.sensorX, L.sensorY)]);
      for (let k = 1; k <= 3; k++) {
        putCell(world, L.sensorX, L.sensorY - k, Cell.Metal, brass(L.sensorX, L.sensorY - k));
        solid.add(key(L.sensorX, L.sensorY - k));
      }
      // Hung full: the vent only has to REFILL after a burn. (Cells are placed one by one, never settled.)
      for (const [x, y] of inside) if (!solid.has(key(x, y))) putCell(world, x, y, Cell.MarshGas, marshGasColor());
      // The vent: a drip into the bell's bottom row until the clapper has rung. Capped by the whole hall's
      // gas (a burst porthole leaks) and halted for good by the sensor's latch.
      out.emitters.push({
        x: bx - 6, y: L.by + 1, cell: Cell.MarshGas, rate: BELL.ventRate, dir: 180, burst: 1, phase: 0,
        cap: { x0: at.x0 + 8, y0: at.y0 + 10, x1: x1 - 8, y1: floorY - 1, max: inside.length + 60 },
        haltOn: sensor.id,
      });
      // ---- the brass inlay to stand on, and the lamps ----
      for (let dx = -3; dx <= 3; dx++) if (lockCell(world, L.markX + dx, floorY) === Cell.Stone) putCell(world, L.markX + dx, floorY, Cell.Gold, dx === 0 ? packRGB(250, 214, 120) : brass(L.markX + dx, floorY));
      out.lights.push(lockLight(bx, L.by - 10, [0.5, 1, 0.45], 62, 1.0, 0.2));
    },
    repair: (at, spec, floorY) => () => {
      const L = bellLayout(at, spec);
      stampBell(world, L, at.y0 + 10, false);
      stampVaultBox(world, vaultLayout(L.x1, floorY));
      // the door is the lock: a rescue tunnel spares Metal, but a stray cell is put back
      for (const [x, y] of plug?.body ?? []) if (lockCell(world, x, y) !== Cell.Metal) putCell(world, x, y, Cell.Metal, LOCK_METAL);
      paintVaultDoor(world, vaultLayout(L.x1, floorY));
    },
  };
}
