/**
 * The maths of Kest Rel's kit (docs/fighters/kest-rel.md), kept free of the world and the Ctx so it can be
 * tested on its own (tests/fighters-kest.test.ts) and so the kit file is only rules. Nothing here draws a
 * random number; the kit does (entityRandom) and passes the roll in.
 *
 * Three groups:
 *  - the climb accumulator of Rooftop Runner (a re-statement of Player's `climbMoveT` rule, so the test can
 *    say what x1.5 buys in ticks);
 *  - Smoke Step's dash: the per-tick vector, how it skims along rock instead of stopping dead, and a dry run
 *    the kit uses to refuse a dash with no room (the same cell-by-cell order FighterSystem.stepMove uses);
 *  - Updraft's column: where a body stands in it, and the lift a rider, a foe and a crate each get.
 */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ======================================================================== Rooftop Runner

/** Ticks of holding a climb key to gain `cells` cells, by Player's accumulator (rate x scale per tick, a cell at 1). */
export function climbTicksForCells(cells: number, scale: number, rate = 0.45): number {
  let acc = 0;
  let got = 0;
  let ticks = 0;
  while (got < cells && ticks < 100000) {
    ticks++;
    acc += rate * scale;
    if (acc >= 1) { acc -= 1; got++; }
  }
  return ticks;
}

// ======================================================================== Smoke Step

export type FreeAt = (x: number, y: number) => boolean;

export interface DashSpec {
  /** Cells per tick along the aim. */
  speed: number;
  ticks: number;
  /** How many cells a floor lip may be climbed while running into it (Player's PLAYER_STEP_UP). */
  stepUp: number;
}

/** The dash's per-tick displacement along `angle` (radians, 0 = right, +y = down). */
export function dashVector(angle: number, speed: number): { dx: number; dy: number } {
  return { dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed };
}

/**
 * One cell sideways the way `tryMoveEntity` takes it: straight, else up onto a lip of at most `stepUp`
 * cells. Returns the body's new y, or null when something solid is in the way.
 */
export function stepAcross(free: FreeAt, x: number, y: number, sx: number, stepUp: number): number | null {
  if (free(x + sx, y)) return y;
  for (let s = 1; s <= stepUp; s++) if (free(x + sx, y - s)) return y - s;
  return null;
}

/**
 * A dash aimed into the floor (or a ceiling, or a wall beside it) should skim along the surface at full
 * speed instead of stopping dead: when one axis is blocked and the aim still has a real component along
 * the other, spend the whole speed there. An aim straight into the surface stays blocked (no room).
 */
export function slideAlong(
  dx: number,
  dy: number,
  blockedX: boolean,
  blockedY: boolean,
  speed: number,
  minComponent = 0.15,
): { dx: number; dy: number } {
  if (blockedY && !blockedX && Math.abs(dx) >= speed * minComponent) return { dx: Math.sign(dx) * speed, dy: 0 };
  if (blockedX && !blockedY && Math.abs(dy) >= speed * minComponent) return { dx: 0, dy: Math.sign(dy) * speed };
  return { dx, dy };
}

/** Which axes of the next single-cell move are blocked (a floor lip within `stepUp` does not block). */
export function blockedAxes(free: FreeAt, x: number, y: number, dx: number, dy: number, stepUp: number): { bx: boolean; by: boolean } {
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const bx = sx !== 0 && stepAcross(free, x, y, sx, stepUp) === null;
  const by = sy !== 0 && !free(x, y + sy);
  return { bx, by };
}

export interface DashRun {
  x: number;
  y: number;
  /** Straight-line distance from the start to the end, cells. */
  cells: number;
  /** Ended against something before the ticks ran out. */
  blocked: boolean;
}

/**
 * Dry-run the dash from (x, y) without touching anything: the same x-then-y, one whole cell at a time
 * accumulator as FighterSystem.stepMove, the same sliding rule as the kit's live plan. The kit refuses the
 * press when this finds less than its minimum room, so a dash into a wall costs nothing.
 */
export function simulateDash(free: FreeAt, x: number, y: number, angle: number, spec: DashSpec): DashRun {
  const sx0 = x, sy0 = y;
  const v = dashVector(angle, spec.speed);
  let ax = 0, ay = 0;
  let blocked = false;
  for (let t = 0; t < spec.ticks && !blocked; t++) {
    const { bx, by } = blockedAxes(free, x, y, v.dx, v.dy, spec.stepUp);
    const s = slideAlong(v.dx, v.dy, bx, by, spec.speed);
    ax += s.dx;
    ay += s.dy;
    while (!blocked && Math.abs(ax) >= 1) {
      const sx = ax > 0 ? 1 : -1;
      const ny = stepAcross(free, x, y, sx, spec.stepUp);
      if (ny === null) { blocked = true; break; }
      x += sx;
      y = ny;
      ax -= sx;
    }
    while (!blocked && Math.abs(ay) >= 1) {
      const sy = ay > 0 ? 1 : -1;
      if (!free(x, y + sy)) { blocked = true; break; }
      y += sy;
      ay -= sy;
    }
  }
  return { x, y, cells: Math.hypot(x - sx0, y - sy0), blocked };
}

/** A smoke cell's life: `roll` in [0,1) spread over [min, max]. */
export function smokeLife(roll: number, min: number, max: number): number {
  return min + Math.floor(clamp(roll, 0, 0.999999) * (max - min + 1));
}

// ======================================================================== Updraft

/** How far up the column a point is: 0 at the furnace mouth, 1 at the top. */
export function columnFrac(mouthY: number, topY: number, y: number): number {
  const h = mouthY - topY;
  return h <= 0 ? 1 : clamp((mouthY - y) / h, 0, 1);
}

/**
 * Is a body reference point (x, y) inside the draft: [cx +- halfW] wide, from the floor the furnace stands on
 * (`bottomY`: a crate or a foe resting on it is in the draft too) up to the column's top?
 */
export function inColumn(cx: number, topY: number, bottomY: number, halfW: number, x: number, y: number, margin = 0): boolean {
  return Math.abs(x - cx) <= halfW + margin && y <= bottomY && y >= topY - 2;
}

/** The rider's model: a buoyant draft that is strongest at the mouth and balances her weight near the top. */
export interface RiderModel {
  /** Player's per-tick gravity (Player.update's `grav`), which the lift must beat. */
  gravity: number;
  /** Lift added per unit of column left to climb below the balance point. */
  k: number;
  /** Column fraction (0..1) where the lift exactly balances her weight: she hangs about here. */
  fEq: number;
  liftMax: number;
  /** Air drag on her vertical speed while she is in the column (no bobbing). */
  drag: number;
  /** Fastest she is pushed upward, cells/tick (Player's own up-cap is -4.6). */
  riseCap: number;
  /** The share of the lift left when the furnace is out (a soft glide down at the very end). */
  fadeFloor: number;
}

/** The lift (cells/tick^2) at column fraction `f`, `fade` 1 = full flame .. 0 = out. */
export function riderLift(f: number, fade: number, m: RiderModel): number {
  const lift = clamp(m.gravity + m.k * (m.fEq - f), 0, m.liftMax);
  return lift * (m.fadeFloor + (1 - m.fadeFloor) * clamp(fade, 0, 1));
}

/** The rider's vertical speed after the kit's push (run AFTER the player's own tick added gravity). */
export function riderVy(vy: number, f: number, fade: number, m: RiderModel): number {
  const v = (vy - riderLift(f, fade, m)) * m.drag;
  return v < -m.riseCap ? -m.riseCap : v;
}

/** The foe's model: a body hoisted by knock state (Enemies.tickKnock owns its flight and adds its own gravity). */
export interface FoeModel {
  /** Upward push per tick at the mouth for a body of reference mass. */
  lift: number;
  /** How much the push thins toward the top (0 = none, 0.9 = nearly nothing at the top). */
  taper: number;
  /** Footprint (halfW x h) of the reference body, and the clamp on how a heavier / lighter body scales. */
  massRef: number;
  kMin: number;
  kMax: number;
  /** Fastest it is pushed upward, cells/tick. Kept under the engine's wall-smash speed (3.5). */
  riseCap: number;
}

export function foeScale(mass: number, m: FoeModel): number {
  return clamp(m.massRef / Math.max(1, mass), m.kMin, m.kMax);
}

/** The foe's knockVy after the kit's push, before tickKnock adds gravity and drag. */
export function foeKnockVy(knockVy: number, f: number, mass: number, fade: number, m: FoeModel): number {
  const push = m.lift * foeScale(mass, m) * (1 - m.taper * f) * (0.25 + 0.75 * clamp(fade, 0, 1));
  const v = knockVy - push;
  return v < -m.riseCap ? -m.riseCap : v;
}

/** Enemies.tickKnock's own integration of one tick (gravity 0.12 then drag 0.97): the test replays it. */
export function knockStep(vy: number, gravity = 0.12, drag = 0.97): number {
  return (vy + gravity) * drag;
}

/** Run a rider through the column for `ticks` from rest at the mouth: [y above the mouth per tick]. */
export function simulateRider(m: RiderModel, height: number, ticks: number, fadeAt: (t: number) => number = () => 1): number[] {
  const out: number[] = [];
  let y = 0; // cells above the mouth
  let vy = 0; // negative = up
  for (let t = 0; t < ticks; t++) {
    vy += m.gravity; // the player's own tick
    vy = clamp(vy, -4.6, 5);
    y -= vy;
    if (y < 0) { y = 0; vy = 0; }
    vy = riderVy(vy, clamp(y / height, 0, 1), fadeAt(t), m);
    out.push(y);
  }
  return out;
}

/** Run a foe in the column for `ticks` from rest at the mouth: [y above the mouth per tick] (no ceiling, no release). */
export function simulateFoe(m: FoeModel, mass: number, height: number, ticks: number): number[] {
  const out: number[] = [];
  let y = 0;
  let kv = 0;
  for (let t = 0; t < ticks; t++) {
    kv = foeKnockVy(kv, clamp(y / height, 0, 1), mass, 1, m);
    kv = knockStep(kv);
    y -= kv;
    if (y < 0) { y = 0; kv = 0; }
    out.push(y);
  }
  return out;
}
