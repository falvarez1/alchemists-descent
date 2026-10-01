import type { InputState } from '@/core/types';

/**
 * THE KEYBOARD DETACH SWITCH. While something else writes an `InputState` (a computer fighter, src/arena/ai), the person's
 * keyboard, mouse, pad and touch controls must STOP writing it, or the two would fight over the same keys. The switch is a
 * set keyed by the input object, so it is per fighter slot (a second slot's `InputState` is never touched by the
 * `InputManager` at all) and needs no field on the `Ctx` contract.
 *
 * `InputManager` reads `isExternallyDriven(ctx.input)`: when it is true the key, mouse, wheel, pad and touch handlers do
 * nothing to the game's input (Escape / pause, the panel's `[` and `]`, menus and the console are other modules' keys and
 * go on working), and on the frame the switch flips it clears every held key so that neither side leaves one stuck.
 */

const driven = new WeakSet<InputState>();

export function setExternalControl(input: InputState, on: boolean): void {
  if (on) driven.add(input);
  else driven.delete(input);
}

export function isExternallyDriven(input: InputState): boolean {
  return driven.has(input);
}
