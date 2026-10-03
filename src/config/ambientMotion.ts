/** Shared by the physical lamp light and its flame. Bounded, irregular
 * variation avoids periodic blinking or a cosmetic flame out of sync. */
export function lanternFlicker(tick: number, phase: number, amount: number): number {
  const a = Math.max(.08, Math.min(.4, amount));
  const flutter = Math.sin(tick * .11 + phase) * .42 + Math.sin(tick * .043 + phase * 2.7) * .3 + Math.sin(tick * .23 + phase * 1.3) * .15;
  return 1 - a * .2 + a * flutter;
}
