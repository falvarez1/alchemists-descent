/**
 * The maths of Sable Fen's kit (docs/fighters/sable-fen.md), kept free of the world, the renderer and the
 * Ctx so it can be tested on its own (tests/fighters-sable.test.ts) and so the kit file is only rules.
 * Nothing here draws a random number.
 *
 * Four groups:
 *  - the spoor: a ring buffer of a marked foe's recent positions (Wounded Spoor), and how a mote fades;
 *  - the hook's cast: the first foe a tether meets while it marches along the aim, stepped at <= 1 cell;
 *  - the haul and the yank: how far she is dragged toward terrain per tick (sliding along rock instead of
 *    stopping dead), and the launch velocity that carries a foe toward her through the engine's knock state;
 *  - the heartbeat: where the ring is, and when it passes a foe (Bloodsense).
 */

export const TUNING = {
  spoor: {
    /** A marked foe is on the scent for this long (6 s). */
    markTicks: 360,
    /** A sample of its position every this many ticks ... */
    sampleEvery: 4,
    /** ... this many deep (the buffer), so the trail is about 56 ticks of its path. */
    depth: 14,
    /** A foe that has not moved this far since the last sample leaves no new mote: it refreshes the old one. */
    minMove: 1.5,
    /** A mote burns for this many ticks after it was left, fading all the way. */
    life: 64,
    /** Marked foes out of her sight pulse through the reveal's faint ring, this colour (the system draws it). */
    pulseRgb: [0.34, 0.9, 0.46] as readonly [number, number, number],
    /** Where the foe must be darker than this (perceived light) to count as out of sight even in a clear line. */
    darkLevel: 0.1,
    /** The HUD meter reads the marked count out of this many. */
    meterMax: 6,
  },
  bogline: {
    cooldown: 480,
    /** How far the tether flies. */
    range: 150,
    /** Hauled toward terrain: cells per tick, ticks at most, and she stops this far short of the hook. */
    haulSpeed: 6,
    haulTicks: 28,
    stopShort: 8,
    /** A terrain hook closer than this does nothing for her: refused. */
    minHook: 10,
    /** How generously the line finds a body (cells of padding on pointHitsCreature). */
    bodyPad: 2,
    /** A foe is yanked toward her: cells per tick, ticks at most, and it stops this far from her chest. */
    yankSpeed: 4,
    yankTicks: 10,
    yankStop: 12,
    /** Then it is stunned (or, for a foe too heavy to move, on her arrival). */
    stunTicks: 20,
    /** A foe of at least this footprint (halfW x h) is too heavy to drag: she is hauled to it instead. */
    heavyMass: 100,
    /** The line takes this many ticks to reach out and, when it is spent, to coil back. */
    flightTicks: 3,
    retractTicks: 7,
    /** The exit speed cap she keeps when the haul ends (cells per tick). */
    exitSpeed: 3,
    exitRise: 2.4,
  },
  bloodsense: {
    duration: 600,
    /** Every wounded foe within this many cells is shown. */
    range: 320,
    moveScale: 1.1,
    /** The reveal is renewed each tick for this long, so a foe that stops being wounded (or dies) drops out at once. */
    revealTicks: 4,
    /** The first sweep: a ring out to the range over this many ticks. */
    sweepTicks: 26,
    /** Then a slow double heartbeat: a lub, a dub `dubGap` later, every `beatEvery` ticks. */
    beatEvery: 84,
    dubGap: 15,
    ringTicks: 52,
    ringRadius: 170,
    dubRadius: 120,
    /** A foe the ring passes flares for this long. */
    pingTicks: 22,
    /** The reveal's colour fades over the last this-many ticks, so the end is a dimming and not a click. */
    fadeTicks: 50,
  },
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ======================================================================== Wounded Spoor

export interface SpoorTrail {
  xs: Float32Array;
  ys: Float32Array;
  ts: Int32Array;
  /** Index of the newest sample. */
  head: number;
  /** How many samples are held (0 .. capacity). */
  n: number;
}

export function newTrail(depth: number = TUNING.spoor.depth): SpoorTrail {
  return { xs: new Float32Array(depth), ys: new Float32Array(depth), ts: new Int32Array(depth), head: 0, n: 0 };
}

/**
 * Leave a mote at (x, y) at `tick`. A foe that has barely moved since the newest mote refreshes it instead of
 * stacking a second one on top (a foe standing still leaves one steady mote, not a clump). Returns true when
 * a new mote was written.
 */
export function pushSpoor(tr: SpoorTrail, x: number, y: number, tick: number, minMove: number = TUNING.spoor.minMove): boolean {
  if (tr.n > 0) {
    const dx = x - tr.xs[tr.head], dy = y - tr.ys[tr.head];
    if (dx * dx + dy * dy < minMove * minMove) {
      tr.ts[tr.head] = tick;
      return false;
    }
  }
  const cap = tr.xs.length;
  tr.head = tr.n === 0 ? 0 : (tr.head + 1) % cap;
  tr.xs[tr.head] = x;
  tr.ys[tr.head] = y;
  tr.ts[tr.head] = tick;
  if (tr.n < cap) tr.n++;
  return true;
}

/** The buffer index of the i-th newest sample (0 = newest). */
export function spoorIndex(tr: SpoorTrail, i: number): number {
  const cap = tr.xs.length;
  return (tr.head - i + cap * 2) % cap;
}

/** 0..1 brightness of a mote `age` ticks old: full when fresh, easing out to nothing at `life`. */
export function moteFade(age: number, life: number = TUNING.spoor.life): number {
  if (age <= 0) return 1;
  if (age >= life) return 0;
  return Math.pow(1 - age / life, 1.35);
}

/** True when every sample in the trail has burnt out (the trail can be dropped). */
export function trailSpent(tr: SpoorTrail, now: number, life: number = TUNING.spoor.life): boolean {
  return tr.n === 0 || now - tr.ts[tr.head] >= life;
}

/** Is it this tick's turn to sample? `phase` staggers foes so they do not all sample on the same tick. */
export function sampleDue(tick: number, phase: number, every: number = TUNING.spoor.sampleEvery): boolean {
  return (tick + phase) % every === 0;
}

/** True when any solid cell lies strictly between (x0, y0) and (x1, y1), stepping at most `step` cells. */
export function lineBlocked(solidAt: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number, step = 1): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const n = Math.ceil(len / step);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (solidAt(Math.round(x0 + dx * t), Math.round(y0 + dy * t))) return true;
  }
  return false;
}

// ======================================================================== Bogline: the cast

export interface BodyHit {
  index: number;
  /** Distance along the line, cells. */
  d: number;
  x: number;
  y: number;
}

/**
 * The first body the line meets while marching from (ox, oy) along the unit vector (dx, dy), one cell at a
 * time up to `maxDist` (so a thin foe cannot be stepped over). `bodyAt` returns the index of a body at the
 * point or -1. The march starts at 1 cell out: a body she is overlapping is hit at once.
 */
export function firstBodyAlong(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  bodyAt: (x: number, y: number) => number,
  step = 1,
): BodyHit | null {
  for (let d = step; d <= maxDist; d += step) {
    const x = ox + dx * d, y = oy + dy * d;
    const i = bodyAt(x, y);
    if (i >= 0) return { index: i, d, x, y };
  }
  return null;
}

/** Straight-line distance, written once because the kit needs it a lot. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** True for a foe too heavy to drag across a room (a golem, a weaver, a boss): she goes to it instead. */
export function tooHeavy(halfW: number, h: number, boss: boolean, heavyMass: number = TUNING.bogline.heavyMass): boolean {
  return boss || halfW * h >= heavyMass;
}

// ======================================================================== Bogline: the haul

export type FreeAt = (x: number, y: number) => boolean;

/**
 * The next cell sideways the way `tryMoveEntity` takes it: straight, else up onto a lip of at most `stepUp`
 * cells. Returns the body's new y, or null when something solid is in the way.
 */
export function stepAcross(free: FreeAt, x: number, y: number, sx: number, stepUp: number): number | null {
  if (free(x + sx, y)) return y;
  for (let s = 1; s <= stepUp; s++) if (free(x + sx, y - s)) return y - s;
  return null;
}

/** Which axes of the next single-cell move are blocked (a floor lip within `stepUp` does not block). */
export function blockedAxes(free: FreeAt, x: number, y: number, dx: number, dy: number, stepUp: number): { bx: boolean; by: boolean } {
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const bx = sx !== 0 && stepAcross(free, x, y, sx, stepUp) === null;
  const by = sy !== 0 && !free(x, y + sy);
  return { bx, by };
}

/**
 * The per-tick pull toward a hook at (tx, ty) for a shoulder at (sx, sy): `speed` cells along the line,
 * less on the last approach so she stops `stop` cells short. Null when she is already there.
 */
export function haulVector(sx: number, sy: number, tx: number, ty: number, speed: number, stop: number): { dx: number; dy: number } | null {
  const d = Math.hypot(tx - sx, ty - sy);
  if (d <= stop || d < 1e-6) return null;
  const s = Math.min(speed, d - stop);
  return { dx: ((tx - sx) / d) * s, dy: ((ty - sy) / d) * s };
}

/**
 * Where a pull aimed into rock goes: when one axis is blocked and the line still has a real component along
 * the other, spend the whole pull there, so a hook on a wall face above her drags her UP the face instead of
 * pinning her to its foot. Blocked on both axes (or with no component left) returns null: the haul is over.
 */
export function slideHaul(
  free: FreeAt,
  x: number,
  y: number,
  v: { dx: number; dy: number },
  stepUp: number,
  minComponent = 0.15,
): { dx: number; dy: number } | null {
  const { bx, by } = blockedAxes(free, x, y, v.dx, v.dy, stepUp);
  if (!bx && !by) return v;
  const s = Math.hypot(v.dx, v.dy);
  if (by && !bx && Math.abs(v.dx) >= s * minComponent) return { dx: Math.sign(v.dx) * s, dy: 0 };
  if (bx && !by && Math.abs(v.dy) >= s * minComponent) return { dx: 0, dy: Math.sign(v.dy) * s };
  return null;
}

/** The velocity (cells/tick) she keeps when the haul ends: the pull's direction at `speed`, the rise capped so a ledge is topped out and not overshot. */
export function exitVelocity(dx: number, dy: number, speed: number, rise: number): { vx: number; vy: number } {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { vx: 0, vy: 0 };
  return { vx: (dx / d) * speed, vy: clamp((dy / d) * speed, -rise, rise) };
}

// ======================================================================== Bogline: the yank

/** The engine's ballistic launch (Enemies.tickKnock): drag per tick and gravity added each tick. Mirrored here, not imported (they are private to that file). */
export const KNOCK_DRAG = 0.97;
export const KNOCK_GRAV = 0.12;

/**
 * The knock velocity that carries a foe at (fx, fy) toward her chest at (hx, hy) at `speed` cells per tick,
 * given the engine applies drag and gravity to it. Null once it is within `stop` cells. Writing this into
 * `knockVx/knockVy` every tick makes the foe travel in a straight line toward her.
 */
export function yankVelocity(
  fx: number,
  fy: number,
  hx: number,
  hy: number,
  speed: number,
  stop: number,
): { vx: number; vy: number; speed: number } | null {
  const d = Math.hypot(hx - fx, hy - fy);
  if (d <= stop || d < 1e-6) return null;
  const s = Math.min(speed, d - stop);
  return {
    vx: (((hx - fx) / d) * s) / KNOCK_DRAG,
    vy: (((hy - fy) / d) * s) / KNOCK_DRAG - KNOCK_GRAV,
    speed: s,
  };
}

// ======================================================================== the tether, drawn

/** 0..1 how much of the line is paid out: it flies out in `flight` ticks, holds, then coils back in `retract` ticks after `endAge`. */
export function tetherReach(age: number, flight: number, endAge: number | null, retract: number): number {
  if (endAge !== null && age >= endAge) return clamp(1 - (age - endAge) / Math.max(1, retract), 0, 1);
  const t = clamp(age / Math.max(1, flight), 0, 1);
  return 1 - (1 - t) * (1 - t);
}

/** 0 (slack) .. 1 (taut): the rope sags while it flies and when it coils back, and is taut in between. */
export function tetherTension(age: number, flight: number, endAge: number | null, retract: number): number {
  if (endAge !== null && age >= endAge) return clamp(1 - (age - endAge) / Math.max(1, retract * 0.5), 0, 1);
  return clamp((age - flight * 0.4) / Math.max(1, flight), 0, 1);
}

// ======================================================================== Bloodsense

/** Radius of a ring born `age` ticks ago that grows from `r0` to `r1` over `ticks` (an ease-out: it leaps and slows). */
export function ringRadius(age: number, ticks: number, r0: number, r1: number): number {
  const t = clamp(age / Math.max(1, ticks), 0, 1);
  return r0 + (r1 - r0) * (1 - (1 - t) * (1 - t));
}

/** Brightness of a ring `age` ticks old of `ticks`: a sharp start, a long fade. */
export function ringAlpha(age: number, ticks: number): number {
  const t = clamp(age / Math.max(1, ticks), 0, 1);
  return Math.pow(1 - t, 1.6);
}

/** True when a ring of radius `r` (it grew `grew` cells this tick) has just swept past a body `d` cells from its centre. */
export function ringPassed(d: number, r: number, grew: number): boolean {
  return d <= r && d > r - Math.max(1, grew);
}

/** Which beat of the slow heartbeat is due at `elapsed` ticks into the ultimate: 'sweep' (the first), 'lub', 'dub' or null. */
export function beatAt(elapsed: number, every: number, dubGap: number): 'sweep' | 'lub' | 'dub' | null {
  if (elapsed === 0) return 'sweep';
  const m = elapsed % every;
  if (m === 0) return 'lub';
  if (m === dubGap) return 'dub';
  return null;
}

/** The reveal's strength over the ultimate: 1 until the last `fade` ticks, then down to 0. */
export function revealStrength(remaining: number, fade: number = TUNING.bloodsense.fadeTicks): number {
  return clamp(remaining / Math.max(1, fade), 0, 1);
}

/** Is a foe wounded (alive and below full health)? */
export function isWounded(hp: number, maxHp: number): boolean {
  return hp > 0 && hp < maxHp;
}
