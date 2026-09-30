/**
 * What the title says while a descent opens. The first line is the plain one, so a new player is never
 * joked at before they have played; later descents walk the rest in order, so no line is told twice in a row.
 */
export const LAUNCH_LINES: readonly string[] = [
  'Opening the intake…',
  'Warming the lift…',
  'Asking the Works nicely…',
  'Airing the floor below…',
  'Counting phials: one, two, three…',
];

/** The line for the nth descent (0 = the first ever). */
export function launchLine(descents: number): string {
  const n = Number.isFinite(descents) ? Math.max(0, Math.floor(descents)) : 0;
  return LAUNCH_LINES[n % LAUNCH_LINES.length];
}
