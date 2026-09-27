/**
 * Gain automation that cannot throw.
 *
 * The score's crossfades and the loops' pass envelopes used
 * `AudioParam.setValueCurveAtTime`. A value curve may not overlap any other
 * automation event, and Chromium clamps a curve's start to the LIVE audio
 * clock. Times computed from a clock reading that has gone stale — the main
 * thread blocked while the audio thread kept running (a probe stepping
 * hundreds of ticks in one task, a throttled hidden tab, a long frame) — put
 * two curves meant for different instants on the same one, and the second
 * throws NotSupportedError ("overlaps"), inside whatever asked for the fade.
 *
 * Here every shape is a chain of short linear segments instead. A linear
 * ramp's event is a single point in time: it cannot overlap anything, and two
 * that land on the same instant simply replace each other. Eight segments of
 * the equal-power law are within 0.5 % of the true sin/cos curve — inaudible.
 */

/** The slice of AudioParam these ramps use (tests drive a strict fake). */
export interface RampParam {
  readonly value: number;
  cancelScheduledValues(cancelTime: number): unknown;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}

/** Segments per equal-power ramp. */
export const RAMP_SEGMENTS = 8;

const finite = (...xs: number[]): boolean => xs.every(Number.isFinite);

/** The equal-power law: rising sin(u·π/2), falling 1 − cos(u·π/2), scaled between the endpoints. */
export function equalPowerAt(from: number, to: number, u: number): number {
  const w = to >= from ? Math.sin(u * Math.PI / 2) : 1 - Math.cos(u * Math.PI / 2);
  return from + (to - from) * w;
}

/**
 * Replace whatever `param` was doing from `t` on with an equal-power glide
 * from `from` to `to` over `seconds`. Safe to call again at the same `t` (a
 * frozen clock) or at a `t` the audio thread has already passed.
 */
export function equalPowerRamp(param: RampParam, from: number, to: number, t: number, seconds: number, segments = RAMP_SEGMENTS): void {
  if (!finite(from, to, t, seconds) || t < 0) return;
  param.cancelScheduledValues(t);
  if (seconds <= 0.01) { param.setValueAtTime(to, t); return; }
  param.setValueAtTime(from, t);
  const n = Math.max(1, Math.floor(segments));
  for (let i = 1; i <= n; i++) param.linearRampToValueAtTime(equalPowerAt(from, to, i / n), t + (seconds * i) / n);
}

/**
 * One pass of a crossfaded loop, on a fresh gain: silent until `start`, up to
 * unity over `fadeIn` (sin law), held, then down to silence over `fadeOut`
 * (cos law) ending at `end`. The fade-in is shortened if the pass is too
 * short to hold both fades apart.
 */
export function passEnvelope(param: RampParam, start: number, fadeIn: number, end: number, fadeOut: number, segments = RAMP_SEGMENTS): void {
  if (!finite(start, fadeIn, end, fadeOut) || start < 0 || end <= start) return;
  const out = Math.max(0.005, Math.min(fadeOut, (end - start) / 2));
  const outStart = end - out;
  const inDur = Math.max(0.005, Math.min(fadeIn, outStart - start));
  const n = Math.max(1, Math.floor(segments));
  param.setValueAtTime(0, start);
  for (let i = 1; i <= n; i++) param.linearRampToValueAtTime(equalPowerAt(0, 1, i / n), start + (inDur * i) / n);
  if (outStart > start + inDur) param.linearRampToValueAtTime(1, outStart);
  for (let i = 1; i <= n; i++) param.linearRampToValueAtTime(equalPowerAt(1, 0, i / n), outStart + (out * i) / n);
}
