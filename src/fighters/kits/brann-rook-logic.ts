/**
 * Brann Rook's rules as pure maths (docs/fighters/brann-rook.md): the Pressure vessel's state machine,
 * the plate's geometry (where it faces, whether a shot's path crosses it) and which side a blow came
 * from. No engine imports, so tests/fighters-brann.test.ts can hold every number without a browser; the
 * kit (brann-rook.ts) wires them to the world.
 *
 * All times are fixed ticks (60 Hz); angles are radians in the world's y-down frame.
 */

/** Every number the kit uses (docs/FIGHTERS.md "Brann Rook"); first-pass tuning, the probe decides the final values. */
export const TUNING = {
  pressure: {
    max: 100,
    /** A single blow of at least this much lost health fills the vessel. */
    minBlow: 6,
    perPoint: 2.5,
    perBlowCap: 40,
    /** Bleed, per tick (2 per second). */
    bleed: 2 / 60,
    /** Stagger resistance after a vent: 4 s. */
    resistTicks: 240,
    /** The vent: compact clouds of Steam scattered within this many cells of the chest. */
    ventRadius: 9,
    ventPuffs: 5,
    puffRadius: 4,
    puffKeep: 0.65,
    ventLife: 30,
  },
  guard: {
    cooldown: 600,
    duration: 210,
    /** Walking speed while the plate is up. */
    moveScale: 0.75,
    /** The plate stands this far out from the chest. */
    reach: 14,
    /** Half the arc it covers: +-65 degrees. */
    halfArc: (65 * Math.PI) / 180,
    /** It follows the aim up and down this far (the arc still covers the level). */
    tilt: (30 * Math.PI) / 180,
    /** Melee and blasts from the front are taken at this fraction. */
    frontalTaken: 0.5,
    /** A foe this close (cells from the chest) is taken to be the one that struck. */
    meleeReach: 24,
    /** The plate swings up over this many ticks. */
    raiseTicks: 8,
    /** It flashes a warning for this long before it drops. */
    warnTicks: 40,
  },
  redline: {
    duration: 480,
    damageTaken: 0.5,
    ventEvery: 6,
    ventRadius: 9,
    puffRadius: 3.5,
    puffKeep: 0.6,
    ventLife: 30,
    scaldEvery: 15,
    scaldRadius: 16,
    scaldDamage: 3,
  },
} as const;

// ------------------------------------------------------------------------------------ Pressure

/** What the Pressure meter and a save hold. */
export interface PressureSave {
  pressure: number;
  resist: number;
}

/**
 * The vessel: health lost to a blow fills it, it bleeds, and at full it vents (the kit writes the Steam
 * and the modifier) and resets to empty with a stretch of stagger resistance during which it does not
 * fill again, so a heavy hitter cannot chain vents into permanent immunity.
 */
export class PressureVessel {
  value = 0;
  /** Ticks of stagger resistance left after a vent. */
  resist = 0;

  /** Health lost in one go. Returns true when this blow filled the vessel (it has already reset). */
  add(lost: number): boolean {
    const t = TUNING.pressure;
    if (this.resist > 0 || !(lost >= t.minBlow)) return false;
    this.value = Math.min(t.max, this.value + Math.min(t.perBlowCap, lost * t.perPoint));
    if (this.value < t.max) return false;
    this.value = 0;
    this.resist = t.resistTicks;
    return true;
  }

  /** One tick: the bleed, and the resistance running out. */
  tick(): void {
    if (this.resist > 0) this.resist--;
    if (this.value > 0) this.value = Math.max(0, this.value - TUNING.pressure.bleed);
  }

  reset(): void {
    this.value = 0;
    this.resist = 0;
  }

  save(): PressureSave {
    return { pressure: this.value, resist: this.resist };
  }

  load(bag: Partial<PressureSave>): void {
    const finite = (n: unknown, lo: number, hi: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0);
    this.value = finite(bag.pressure, 0, TUNING.pressure.max - 0.001);
    this.resist = Math.round(finite(bag.resist, 0, TUNING.pressure.resistTicks));
  }
}

// ------------------------------------------------------------------------------------ the plate

export interface Dir {
  x: number;
  y: number;
}

/**
 * The way the plate faces: the aim's side (right when straight up or down), tilted toward the aim by at
 * most `tilt`, so it always covers the level ahead and leans with the wand. Unit vector (written into `out` when given, so the hot path allocates nothing).
 */
export function plateDir(aimAngle: number, tilt: number = TUNING.guard.tilt, out: Dir = { x: 1, y: 0 }): Dir {
  const ax = Math.cos(aimAngle), ay = Math.sin(aimAngle);
  const side = ax < 0 ? -1 : 1;
  const elevation = Math.max(-tilt, Math.min(tilt, Math.atan2(ay, Math.abs(ax))));
  out.x = side * Math.cos(elevation);
  out.y = Math.sin(elevation);
  return out;
}

/**
 * Clip the parameter interval [lo, hi] of P(t) = A + t*D to the half-plane g0 + g1*t >= 0.
 * Returns the new [lo, hi], or null when nothing is left.
 */
function clipHalfPlane(lo: number, hi: number, g0: number, g1: number): [number, number] | null {
  if (Math.abs(g1) < 1e-12) return g0 < 0 ? null : [lo, hi];
  const t = -g0 / g1;
  if (g1 > 0) lo = Math.max(lo, t);
  else hi = Math.min(hi, t);
  return lo > hi ? null : [lo, hi];
}

/**
 * Where, along the segment A -> B, it first enters the plate's front sector: the disc of radius `reach`
 * about C, cut to +-`halfArc` of `dir`. Returns t in [0, 1] (0 = already inside at A), or null when the
 * segment never touches it. Exact (a disc clipped by two half-planes, since the arc is under 90 degrees),
 * so a shot that moves 40 cells in a tick cannot step over a plate that is 14 deep.
 */
export function segmentSectorEntry(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dir: Dir, reach: number, halfArc: number,
): number | null {
  const dx = bx - ax, dy = by - ay;
  const fx = ax - cx, fy = ay - cy;
  let lo = 0, hi = 1;
  // 1. inside the disc
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - reach * reach;
  if (a < 1e-12) {
    if (c > 0) return null;
  } else {
    const b = 2 * (fx * dx + fy * dy);
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    lo = Math.max(lo, (-b - s) / (2 * a));
    hi = Math.min(hi, (-b + s) / (2 * a));
    if (lo > hi) return null;
  }
  // 2. inside the wedge: left of the ray at -halfArc and right of the ray at +halfArc (cross products).
  const cs = Math.cos(halfArc), sn = Math.sin(halfArc);
  const r1x = dir.x * cs + dir.y * sn, r1y = -dir.x * sn + dir.y * cs; // dir turned by -halfArc
  const r2x = dir.x * cs - dir.y * sn, r2y = dir.x * sn + dir.y * cs; // dir turned by +halfArc
  const first = clipHalfPlane(lo, hi, r1x * fy - r1y * fx, r1x * dy - r1y * dx);
  if (!first) return null;
  const second = clipHalfPlane(first[0], first[1], fx * r2y - fy * r2x, dx * r2y - dy * r2x);
  return second ? second[0] : null;
}

/** A foe near the chest, as an offset from it (cells). */
export interface NearFoe {
  dx: number;
  dy: number;
}

/**
 * Where a blow came from, as a unit vector from the chest toward its source, or null when it cannot be
 * told. Where a foe stands within melee reach it is taken to be the one that struck (the engine's melee
 * knock signs are not consistent: a slime's bite pushes the player TOWARD it, a rillback's away); with
 * none near, the knock vector says (a blast or a shot pushes the body away from where it came from, so
 * the knock's sign points to the source's opposite side). A blow with no knock at all (a hazard tick)
 * has no origin.
 */
export function blowOrigin(foe: NearFoe | null, kx: number, ky: number): Dir | null {
  if (kx === 0 && ky === 0) return null;
  const d = foe ? Math.hypot(foe.dx, foe.dy) : 0;
  if (foe && d >= 1) return { x: foe.dx / d, y: foe.dy / d };
  if (Math.abs(kx) >= 0.05) return { x: kx > 0 ? -1 : 1, y: 0 };
  return null;
}

/** Did this blow come from the plate's front arc? */
export function blowFromFront(plate: Dir, halfArc: number, foe: NearFoe | null, kx: number, ky: number): boolean {
  const o = blowOrigin(foe, kx, ky);
  return o !== null && o.x * plate.x + o.y * plate.y >= Math.cos(halfArc);
}
