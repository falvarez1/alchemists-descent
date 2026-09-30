/**
 * Aim assist by bearing (the player's Off / Light / Strong option): when the aim direction points
 * close enough to a creature, the shot is bent the rest of the way. Pure geometry, so the tolerance
 * and the choice can be tested on their own; combat/AimGuide turns it into a launch angle, taking
 * the spell's gravity into account, and only keeps the lock if the traced shot really reaches it.
 *
 * It exists for aim that has no cursor to place: a controller's right stick (which only sets a
 * direction), a keyboard-only player, a thumb on a touch pad. Trickshot's own assist locks onto the
 * creature nearest the CURSOR and is left as it was.
 */

export interface AssistTarget<T> { x: number; y: number; ref: T }

/** What each level of the option allows, in degrees either side of where the player is aiming. */
export const AIM_ASSIST_DEGREES = { off: 0, light: 4, strong: 8 } as const;

/** The smallest signed turn from `from` to `to`, in radians, -PI..PI. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * The creature whose bearing from (ox, oy) lies within `tolerance` radians of `raw`, nearest in angle
 * first (ties go to the nearer one), and the angle to launch at it: `compensate` turns the target's
 * position into a launch angle (gravity, a spell's upward bias). Null when nothing is in the cone,
 * the tolerance is zero, or the aim is not a number.
 */
export function pickBearingAssist<T>(
  ox: number, oy: number, raw: number, tolerance: number,
  targets: ReadonlyArray<AssistTarget<T>>, maxDistance: number,
  compensate: (x: number, y: number) => number,
): { angle: number; ref: T } | null {
  if (!(tolerance > 0) || !Number.isFinite(raw)) return null;
  let best: AssistTarget<T> | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const distance = Math.hypot(t.x - ox, t.y - oy);
    if (distance > maxDistance || distance < 3) continue;
    const off = Math.abs(angleDelta(raw, Math.atan2(t.y - oy, t.x - ox)));
    if (off > tolerance) continue;
    const score = off + distance * 1e-6;
    if (score < bestScore) { best = t; bestScore = score; }
  }
  return best ? { angle: compensate(best.x, best.y), ref: best.ref } : null;
}
