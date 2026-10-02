/**
 * Rusk Emberjaw, the Furnace Hound: her numbers, and the parts of her kit that are plain maths (so they can
 * be tested without a browser). The kit itself is `rusk-emberjaw.ts`; this file is named so the glob in
 * `kits/index.ts` (which loads only files named exactly `<id>.ts`) does not take it for a kit.
 *
 * Times are fixed ticks (60 Hz); lengths are cells.
 */

import { Cell } from '@/sim/CellType';

/** Live-tunable like `config/params` (docs/FIGHTERS.md): a plain object, read each time it is used. */
export const TUNING = {
  /** Scrap Recovery: the armor pool she carries, and what a melee elimination restores. */
  armorMax: 40,
  scrapRestore: 14,

  /** Shoulder Ram (Z). */
  ram: {
    cooldown: 540,
    /** A charge is `ticks` of `speed` cells: 44 cells at most. */
    ticks: 8,
    speed: 5.5,
    /** Invulnerability kept topped up while she charges (it lingers this many ticks after the last one). */
    invuln: 6,
    damage: 16,
    /** gustShove strength (mass-scaled by the engine: a slime is flung, a golem rocks). */
    shove: 4.5,
    /** Added to the shove's direction (+ = downward) to flatten the flinch's hop: foes skid and fly, they are not popped into the air. */
    shoveDown: 0.3,
    /** Stunned this long... */
    stunTicks: 20,
    /** ...once the shove has carried (a stun pins the foe's velocity to zero): no sooner than this many ticks... */
    stunDelay: 3,
    /** ...and no later than this many (a foe flung a long way is stunned where it is). */
    stunWait: 24,
    /** The shoulder reaches this many cells ahead of the body. */
    reach: 4,
    /** Speed handed back when the charge runs its course. */
    exitSpeed: 2.2,
    /**
     * Rows broken above her head. A step up (she climbs up to 5 cells in a charge: a sill, a ledge) lifts her body
     * into rows the scan cleared for the lower stance, and one stray plank in them would end the charge: so the
     * doorway is her height + 6.
     */
    headroom: 6,
    /** Share of broken Wood cells that become Ember when nothing near can catch from it (the rest are cleared: a doorway of embers would be a wall of fire). */
    emberShare: 0.4,
    /** Radius of the concussion handed to Mechanisms.strike (levers within radius + 6, rune glyphs within radius). */
    strikeRadius: 5,
    /** A foe the ram flung that dies of the wall it hits ('impaled') within this many ticks is still her kill: scrap. */
    slamWindow: 45,
    /** Afterimages live this many ticks. */
    trailLife: 14,
  },

  /** Kiln Heart (T). */
  kiln: {
    duration: 600,
    armorMax: 80,
    damageTaken: 0.8,
    /** A foe this close (cells) when she is hurt provokes the furnace. */
    burstRange: 20,
    /** Foes this close to her when it vents are scorched. */
    burstRadius: 16,
    burstDamage: 6,
    burstEmbers: 6,
    /** One burst per this many ticks, however the blows land. */
    burstGuard: 20,
    /** A foe that catches fire burns this long (the engine's creature burn). */
    burnTicks: 300,
    burnOiledTicks: 420,
  },
};

export type Tuning = typeof TUNING;

// ---------------------------------------------------------------------------------- the passive

/** Scrap Recovery: the pool after a melee elimination (clamped to the ceiling) and what was actually gained. */
export function recoverArmor(armor: number, max: number, amount: number): { armor: number; gained: number } {
  if (!(max > 0) || !(amount > 0)) return { armor, gained: 0 };
  const next = Math.min(max, armor + amount);
  return { armor: next, gained: Math.max(0, next - armor) };
}

// ---------------------------------------------------------------------------------- Kiln Heart

/**
 * Damage sources that are statuses and hazards rather than a foe's hand: the furnace answers a blow, not
 * the world's slow harm (standing in fire next to a slime must not vent a burst every few ticks).
 */
export const NOT_A_FOE: ReadonlySet<string> = new Set([
  'unknown', 'status', 'burning', 'oiled-fire', 'frostbite', 'electrocution', 'wet-electrocution',
  'fire', 'lava', 'acid', 'toxic', 'steam-pressure', 'drowning', 'falling-tree', 'leech',
]);

/** Could this damage source be a foe at close range? (Anything that is not a known status or hazard.) */
export function isFoeBlow(source: string | undefined): boolean {
  return source !== undefined && source.length > 0 && !NOT_A_FOE.has(source);
}

/** True when the armor pool fell by more than rounding between two reads (a blow landed on it). */
export function armorStruck(before: number, now: number): boolean {
  return before - now > 0.05;
}

/** Is a burst allowed now? One per `guard` ticks. */
export function burstReady(now: number, lastAt: number, guard: number): boolean {
  return now - lastAt >= guard;
}

/**
 * Up to `n` distinct open spots within `r` of (cx, cy), drawn from a seeded stream. `open` says whether a
 * cell may take an ember. Gives up after a bounded number of tries rather than looping on a crowded room.
 */
export function emberSpots(
  cx: number,
  cy: number,
  r: number,
  n: number,
  rand: () => number,
  open: (x: number, y: number) => boolean,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const seen = new Set<number>();
  for (let tries = 0; tries < n * 8 && out.length < n; tries++) {
    const a = rand() * Math.PI * 2;
    const d = 2 + Math.sqrt(rand()) * Math.max(0, r - 2);
    const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d * 0.8);
    const key = x * 100003 + y;
    if (seen.has(key)) continue;
    seen.add(key);
    if (open(x, y)) out.push([x, y]);
  }
  return out;
}

// ---------------------------------------------------------------------------------- the ram

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/**
 * The shoulder: the body's own box with `reach` more cells ahead of it in the direction of travel.
 * (x, y) is the fighter's feet; the body fills y-h+1 .. y.
 */
export function shoulderBox(x: number, y: number, dir: number, halfW: number, h: number, reach: number): Box {
  return dir >= 0
    ? { x0: x - halfW, x1: x + halfW + reach, y0: y - (h - 1), y1: y }
    : { x0: x - halfW - reach, x1: x + halfW, y0: y - (h - 1), y1: y };
}

/** A foe's body: (x, y) is its feet, `h` tall. */
export function foeBox(x: number, y: number, halfW: number, h: number): Box {
  return { x0: Math.round(x) - halfW, x1: Math.round(x) + halfW, y0: Math.round(y) - h, y1: Math.round(y) };
}

/**
 * The columns the next tick's charge will occupy: from the first cell ahead of the body out to `dist`
 * cells (plus one for the fractional carry), in the order they are met. Wood is broken in these before
 * the body steps into them.
 */
export function ramColumns(x: number, dir: number, halfW: number, dist: number): number[] {
  const first = Math.round(x) + (dir >= 0 ? 1 : -1) * (halfW + 1);
  const n = Math.ceil(dist) + 1;
  const out: number[] = [];
  for (let c = 0; c < n; c++) out.push(first + (dir >= 0 ? c : -c));
  return out;
}

// ---------------------------------------------------------------------------------- fire safety

/**
 * Anything an Ember can light or a fire can run along: oil, powder, bog gas, the dry growth that carries a
 * flame (moss, grass, leaf, vine, seed), coal, and flame itself. The ram writes no Ember into a wall that
 * has any of it close by: the Intake's barricade is caulked with moss and has oil sealed in its core, and a
 * ram that lit it would leave her standing in the blaze she made.
 */
export const TINDER: ReadonlySet<number> = new Set([
  Cell.Oil, Cell.Gunpowder, Cell.MarshGas, Cell.Moss, Cell.Grass, Cell.Leaf, Cell.Vines, Cell.Seed, Cell.Coal, Cell.Fire, Cell.Lava,
]);

/** The materials that turn one spark into a pool fire: Kiln Heart banks its embers when any is near her. */
export const FUEL: ReadonlySet<number> = new Set([Cell.Oil, Cell.Gunpowder, Cell.MarshGas]);

/** How many cells of `set` lie in the inclusive box (`typeAt` reads the grid; out of bounds reads 0). */
export function countIn(set: ReadonlySet<number>, typeAt: (x: number, y: number) => number, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (set.has(typeAt(x, y))) n++;
  return n;
}

/**
 * Is this elimination a melee one? A blow landed this tick or the last (a kick, a limb swing, her ram), or
 * the wall that finished a foe her ram had flung: the 'impaled' slam, within `window` ticks of the blow.
 * A spell or a fire that finishes the same foe is not.
 */
export function isMeleeElimination(recentMelee: boolean, source: string, rammedAgo: number | undefined, window: number): boolean {
  if (recentMelee) return true;
  return source === 'impaled' && rammedAgo !== undefined && rammedAgo >= 0 && rammedAgo <= window;
}
