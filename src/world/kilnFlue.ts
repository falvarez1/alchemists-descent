import { HEIGHT, WIDTH } from '@/config/constants';
import type { CellRect, KilnFlueSite } from '@/core/story';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { PlacementLedger } from '@/world/connect';

/**
 * THE KILN FLUE (floor 4, wave 3 WS-S): the Works' old chimney, rising beside
 * the Kiln. The escape climbs it when the Colossus falls (game/story/
 * KilnEscape): the Heart's last heave blows the metal DAMPER between the Kiln
 * and the shaft, lava and steam rise through the Kiln and up the shaft, loose
 * masonry comes down, and the brass hatch at the top is the way out.
 *
 * Everything is real cells and deterministic from the Kiln's own geometry (no
 * RNG draw, so the generator's main stream is untouched):
 *
 *   - the SHAFT: 41 wide, 222 tall, its floor level with the Kiln's; stone
 *     LEDGES every 18 rows, alternating sides, 13 wide — the starting jump
 *     climbs it, and a 15-wide clear column up the middle keeps the gauge
 *     (9x17) all the way up for the findability audit;
 *   - the DAMPER: a metal door (11 x 22) in the rock between the Kiln's end
 *     and the shaft, sealed until the heave (so the fight cannot be sniped
 *     from the ledges), with stone above it;
 *   - SLABS: three cracked stone blocks in the shaft wall that crumble to
 *     sand as the lava climbs past below them;
 *   - the HATCH: a brass plate in the stone cap over the top ledge.
 *
 * The Kiln's own numbers (world/structures): pocket RX 62 / RY 40 around
 * (cx, cy), a flat floor 116 wide whose feet row is cy + 29 (the Colossus's
 * spawn row), lava moats at |dx| 47..56 in the floor band.
 */

export const FLUE = {
  /** Shaft interior width, and its near wall's distance from the Kiln's centre. */
  width: 41,
  near: 70,
  /** Rows between ledges, ledge count, ledge width. Two 13-wide ledges leave a
   *  15-wide column clear up the middle: the 9x17 body never has to squeeze
   *  between a ledge below and the next one above (18 rows apart, 15 clear). */
  ledgeStep: 18,
  ledges: 11,
  ledgeW: 13,
  /** Headroom over the top ledge (the hatch landing). */
  crown: 24,
  /** The damper doorway (the Kiln's end wall to the shaft): 8 wide, 22 tall. */
  damperFrom: 59,
  damperW: 8,
  damperH: 22,
} as const;

/** Where the shaft may stand off the Kiln (its near wall's distance from the Kiln's centre), nearest first. */
const NEAR_OFFSETS = [70, 86, 102, 118] as const;
/** Ledge counts tried, tallest first (a shorter climb only when the rock is spoken for). */
const LEDGE_COUNTS = [11, 10, 9, 8, 7] as const;

const inWorld = (x: number, y: number): boolean => x >= 2 && x < WIDTH - 2 && y >= 2 && y < HEIGHT - 6;

/** The shaft's full height from its floor to its cap. */
export function flueHeight(ledges: number = FLUE.ledges): number {
  return FLUE.ledgeStep * ledges + FLUE.crown;
}

/**
 * Lay the flue out for a Kiln at (cx, cy) on the side and height that keep
 * clear of reserved ground (the exit well's column, prefabs, secrets). Pure
 * geometry: nothing is carved.
 */
export function planKilnFlue(cx: number, cy: number, ledger: PlacementLedger | null): KilnFlueSite {
  const floor = cy + 29;
  for (const ledges of LEDGE_COUNTS) {
    for (const near of NEAR_OFFSETS) {
      for (const side of [1, -1] as const) {
        const g = geometry(cx, cy, floor, side, ledges, near);
        if (g.shaft.x0 < 12 || g.shaft.x1 > WIDTH - 12 || g.shaft.y0 < 40) continue;
        if (!ledger || (!ledger.intersects(g.shaft.x0 - 8, g.shaft.y0 - 8, g.shaft.x1 + 8, g.shaft.y1 + 4) && !passageBlocked(ledger, g))) return g;
      }
    }
  }
  // Nothing clear: the flue must exist — the shorter climb on the side with room in the world.
  return geometry(cx, cy, floor, cx < WIDTH / 2 ? 1 : -1, 7, FLUE.near);
}

/** The passage runs from the Kiln's own end wall: only reserved ground OTHER than the Kiln blocks it. */
function passageBlocked(ledger: PlacementLedger, g: KilnFlueSite): boolean {
  const p = g.passage;
  return ledger.rects().some(r => r.label !== 'kiln-arena' && p.x0 <= r.x1 && p.x1 >= r.x0 && p.y0 - 4 <= r.y1 && p.y1 >= r.y0);
}

function geometry(cx: number, cy: number, floor: number, side: 1 | -1, ledgeCount: number, near: number): KilnFlueSite {
  const nearX = cx + side * near, farX = cx + side * (near + FLUE.width - 1);
  const x0 = Math.min(nearX, farX), x1 = Math.max(nearX, farX);
  const top = floor - flueHeight(ledgeCount);
  const shaft: CellRect = { x0, y0: top, x1, y1: floor };
  const dA = cx + side * FLUE.damperFrom, dB = cx + side * (FLUE.damperFrom + FLUE.damperW - 1);
  const damper: CellRect = { x0: Math.min(dA, dB), y0: floor - FLUE.damperH + 1, x1: Math.max(dA, dB), y1: floor };
  const pA = dB + side, pB = nearX - side;
  const passage: CellRect = { x0: Math.min(pA, pB), y0: damper.y0, x1: Math.max(pA, pB), y1: floor };
  const ledges: CellRect[] = [];
  for (let k = 1; k <= ledgeCount; k++) {
    const y = floor - FLUE.ledgeStep * k + 1; // top surface row; feet stand on y - 1
    // The first ledge is across the shaft from the damper; then they alternate.
    const far = k % 2 === 1;
    const onRight = far === (side > 0);
    const w = FLUE.ledgeW;
    ledges.push(onRight ? { x0: x1 - w + 1, y0: y, x1, y1: y + 2 } : { x0, y0: y, x1: x0 + w - 1, y1: y + 2 });
  }
  // Loose masonry: cracked blocks in the wall across from every third ledge, above it.
  const slabs: Array<CellRect & { at: number }> = [];
  for (const k of [3, 6, 9]) {
    if (k > ledgeCount) continue;
    const ledge = ledges[k - 1];
    const ledgeOnRight = ledge.x1 === x1;
    const y1 = ledge.y0 - 6, y0 = y1 - 10;
    const rect = ledgeOnRight ? { x0: x0 - 8, x1: x0 - 1 } : { x0: x1 + 1, x1: x1 + 8 };
    slabs.push({ ...rect, y0, y1, at: y1 + 58 });
  }
  const top1 = ledges[ledges.length - 1];
  return {
    shaft,
    damper,
    passage,
    ledges,
    slabs,
    arena: { x0: cx - 62, y0: cy - 40, x1: cx + 62, y1: floor },
    lavaFrom: floor,
    start: { x: Math.round((x0 + x1) / 2), y: floor },
    exit: { x: Math.round((top1.x0 + top1.x1) / 2), y: top1.y0 - 1 },
    side,
  };
}

const LEDGE_COLOR = (x: number, y: number): number => packRGB(78 + ((x * 5 + y * 3) % 7), 64 + ((x + y) % 4), 54);
const WALL_COLOR = (x: number, y: number): number => packRGB(58 + ((x * 3 + y * 7) % 6), 50, 46);
const SLAB_COLOR = (x: number, y: number): number => ((x * 7 + y * 13) % 11 === 0 ? packRGB(40, 32, 28) : packRGB(118 + ((x + y) % 5) * 3, 96, 80));
const DAMPER_COLOR = (x: number, y: number): number => ((x + y * 3) % 9 === 0 ? packRGB(142, 116, 70) : packRGB(82, 76, 72));
const HATCH_COLOR = (x: number): number => (x % 3 === 0 ? packRGB(196, 158, 84) : packRGB(150, 116, 58));

function put(world: World, x: number, y: number, t: number, color: number, onlyIfOpen = false): void {
  if (!inWorld(x, y)) return;
  const i = world.idx(x, y);
  const cur = world.types[i];
  if (cur === Cell.Metal && t !== Cell.Metal) return;
  if (onlyIfOpen && cur !== Cell.Empty) return;
  if (cur === t && world.colors[i] === color) return;
  world.replaceCellAt(i, t, color);
}

/** Stamp the whole flue: shaft, floor, ledges, damper, the stone over it, slabs, the cap and hatch. */
export function carveKilnFlue(world: World, f: KilnFlueSite): void {
  const { shaft, damper } = f;
  for (let y = shaft.y0; y <= shaft.y1; y++) for (let x = shaft.x0; x <= shaft.x1; x++) {
    if (!inWorld(x, y)) continue;
    const i = world.idx(x, y);
    if (world.types[i] === Cell.Metal || world.types[i] === Cell.Empty) continue;
    world.clearCellAt(i);
  }
  for (let y = f.passage.y0; y <= f.passage.y1; y++) for (let x = f.passage.x0; x <= f.passage.x1; x++) {
    if (!inWorld(x, y)) continue;
    const i = world.idx(x, y);
    if (world.types[i] !== Cell.Metal && world.types[i] !== Cell.Empty) world.clearCellAt(i);
  }
  // Brick lining behind the air: a two-cell skin where the shaft meets open cave or liquid keeps
  // seepage out of the climb (crossing tunnels still meet it at their own floor — only liquids are walled).
  lineShaft(world, f);
  // The floor: level with the Kiln's, on a deep footing.
  const fx0 = Math.min(shaft.x0, f.passage.x0, damper.x0) - 3, fx1 = Math.max(shaft.x1, f.passage.x1, damper.x1) + 3;
  for (let x = fx0; x <= fx1; x++) for (let y = shaft.y1 + 1; y <= shaft.y1 + 5; y++) put(world, x, y, Cell.Stone, WALL_COLOR(x, y));
  // Stone between the Kiln and the shaft above the damper (no way round it before the heave).
  for (let x = damper.x0; x <= damper.x1; x++) for (let y = damper.y0 - 36; y < damper.y0; y++) put(world, x, y, Cell.Stone, WALL_COLOR(x, y));
  restampFlueFixtures(world, f, true);
  // The cap and its brass hatch.
  for (let x = shaft.x0 - 2; x <= shaft.x1 + 2; x++) for (let y = shaft.y0 - 4; y < shaft.y0; y++) put(world, x, y, Cell.Stone, WALL_COLOR(x, y));
  const hx = f.exit.x;
  for (let x = hx - 6; x <= hx + 6; x++) put(world, x, shaft.y0 - 1, Cell.Metal, HATCH_COLOR(x));
}

function lineShaft(world: World, f: KilnFlueSite): void {
  const { shaft } = f;
  const liquid = (t: number): boolean => t === Cell.Water || t === Cell.Lava || t === Cell.Oil || t === Cell.Acid || t === Cell.Toxic
    || t === Cell.Sand || t === Cell.Nitrogen || t === Cell.Blood || t === Cell.Slime;
  for (let y = shaft.y0; y <= shaft.y1; y++) {
    for (const [x, dir] of [[shaft.x0 - 1, -1], [shaft.x1 + 1, 1]] as const) {
      let near = false;
      for (let d = 0; d < 4 && !near; d++) {
        const xx = x + dir * d;
        if (inWorld(xx, y) && liquid(world.types[world.idx(xx, y)])) near = true;
      }
      if (near) for (let d = 0; d < 2; d++) put(world, x + dir * d, y, Cell.Stone, WALL_COLOR(x + dir * d, y));
    }
  }
}

/**
 * The flue's fixtures: ledges, slabs and the damper. `damperClosed` false
 * leaves the doorway open (after the heave). Writes only where a fixture is
 * missing, so it doubles as the repair after worldgen's rescue passes and
 * the restamp when an escape restarts.
 */
export function restampFlueFixtures(world: World, f: KilnFlueSite, damperClosed: boolean): void {
  for (const l of f.ledges) for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) put(world, x, y, Cell.Stone, LEDGE_COLOR(x, y));
  for (const s of f.slabs) for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) put(world, x, y, Cell.Stone, SLAB_COLOR(x, y));
  const d = f.damper;
  for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) {
    if (damperClosed) put(world, x, y, Cell.Metal, DAMPER_COLOR(x, y));
    else if (inWorld(x, y)) {
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Empty) { world.clearCellAt(i); }
    }
  }
}

/** The worldgen repair (after rescue passes carve): fixtures back, damper shut. Idempotent. */
export function repairKilnFlue(world: World, f: KilnFlueSite): void {
  restampFlueFixtures(world, f, true);
}

/** The heave: the damper is blown out of its frame. Returns the cells cleared. */
export function openKilnFlue(world: World, f: KilnFlueSite): number {
  let n = 0;
  const d = f.damper;
  for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) {
    if (!inWorld(x, y)) continue;
    const i = world.idx(x, y);
    if (world.types[i] !== Cell.Empty) { world.clearCellAt(i); n++; }
  }
  return n;
}

/**
 * An escape restart (a death in the climb): the shaft and the doorway are
 * cleared of whatever the climb left (lava, the stone it cooled to, sand from
 * the slabs), the ledges and slabs are restamped, and the Kiln's lava goes.
 * Fail-open: whatever the physics did, the route is exactly as generated.
 */
export function resetKilnFlue(world: World, f: KilnFlueSite): void {
  const clear = (r: CellRect, only?: (t: number) => boolean): void => {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (!inWorld(x, y)) continue;
      const i = world.idx(x, y);
      const t = world.types[i];
      if (t === Cell.Empty || t === Cell.Metal) continue;
      if (only && !only(t)) continue;
      world.clearCellAt(i);
    }
  };
  clear(f.shaft);
  clear(f.passage);
  clear(f.damper);
  clear(f.arena, t => t === Cell.Lava || t === Cell.Fire || t === Cell.Ember);
  restampFlueFixtures(world, f, false);
}

/** Is (x, y) inside the flue's air (the shaft or the open doorway)? */
export function inFlue(f: KilnFlueSite, x: number, y: number): boolean {
  const inside = (r: CellRect): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  return inside(f.shaft) || inside(f.passage) || inside(f.damper);
}
