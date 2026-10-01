/**
 * THE KEY'S FAR-FIELD LURE (levels review #14). The golden key used to be found
 * only by reaching it: the key hint fires inside 32 cells, and the key lay in a
 * far corner with nothing to find it by. A lure, not a quest marker: now and then
 * the key glints (a cross flare the eye catches across a cavern) and rings one
 * small glass note from where it lies. Both ride ONE slow clock, per key, so what
 * you see and what you hear are the same event, and two floors' keys never chime
 * in step. Pure: the render and the pickup tick both read it.
 */

/** Cells within which the glint is worth drawing and the note worth playing. */
export const LURE_RANGE = 460;
/** Ticks the glint lasts, and the ticks it takes to swell. */
export const GLINT_TICKS = 34;
const SWELL_TICKS = 7;

/** Ticks between this key's glints: 6.5 to 9 s, fixed per key so it never drifts. */
export function lurePeriod(x: number, y: number): number {
  return 390 + (((Math.floor(x) * 31 + Math.floor(y) * 17) >>> 0) % 150);
}

/** Ticks since the key's current glint began. */
export function lurePhase(frame: number, x: number, y: number): number {
  const period = lurePeriod(x, y);
  // Offset by position so keys (and a retried floor) do not chime on frame 0 together.
  return (frame + Math.floor(x) * 7) % period;
}

/** True on the one tick a glint begins (when the note rings). */
export function lureRings(frame: number, x: number, y: number): boolean {
  return lurePhase(frame, x, y) === 0;
}

/** 0..1 flare envelope: a quick swell, a long settle. */
export function lureGlint(frame: number, x: number, y: number): number {
  const p = lurePhase(frame, x, y);
  if (p >= GLINT_TICKS) return 0;
  const e = p < SWELL_TICKS ? p / SWELL_TICKS : 1 - (p - SWELL_TICKS) / (GLINT_TICKS - SWELL_TICKS);
  return e * e;
}
