/**
 * Hold or toggle (a player option): for a player who cannot keep a key down, crouch, levitate, pour and
 * siphon can be LATCHED instead: press once to start, press again to stop. This file is the pure
 * bookkeeping; InputManager owns the keys and the actions.
 *
 * What makes latching dangerous is a key that never lets go, so the rules are strict:
 *  - a latch is only ever created by a real, fresh key press, never by a repeat;
 *  - the key's release is swallowed (it would otherwise undo the latch at once), but only for an
 *    action that is in toggle mode right now, so switching the option back never strands one;
 *  - every latch can be dropped wholesale (`clear`): InputManager does that on blur, a hidden tab,
 *    a pause or menu, death, a respawn, a new floor and a mode change, and forgets any the game
 *    itself let go of (`drop`).
 */
export type HoldAction = 'down' | 'jump' | 'pour' | 'interact';

export const HOLD_ACTIONS: readonly HoldAction[] = ['down', 'jump', 'pour', 'interact'];

/** Which gameplay key codes belong to which action (canonical codes: rebinding is translated first). */
const CODES: Readonly<Record<string, HoldAction>> = {
  KeyS: 'down', ArrowDown: 'down', Space: 'jump', KeyQ: 'pour', KeyE: 'interact',
};

export function holdActionFor(code: string): HoldAction | null {
  return CODES[code] ?? null;
}

export type ToggleModes = Partial<Record<HoldAction, boolean>>;

/** Whatever was saved, as a clean map: only the four known actions, only real booleans, everything else Hold. */
export function sanitizeToggleModes(raw: unknown): Record<HoldAction, boolean> {
  const saved = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return { down: saved.down === true, jump: saved.jump === true, pour: saved.pour === true, interact: saved.interact === true };
}

export class ToggleLatches {
  /** action -> the key code that latched it. */
  private readonly on = new Map<HoldAction, string>();

  constructor(private readonly modes: () => ToggleModes | undefined) {}

  isToggle(action: HoldAction): boolean {
    return this.modes()?.[action] === true;
  }

  /**
   * A key was pressed fresh (the caller filters repeats). Null: this key is held as ever (its action is
   * in Hold mode, or it is not one of the four). Otherwise the press flips the latch.
   */
  press(code: string): { action: HoldAction; edge: 'on' | 'off'; code: string } | null {
    const action = holdActionFor(code);
    if (!action || !this.isToggle(action)) return null;
    const latched = this.on.get(action);
    if (latched !== undefined) { this.on.delete(action); return { action, edge: 'off', code: latched }; }
    this.on.set(action, code);
    return { action, edge: 'on', code };
  }

  /** A key was released: true when it must NOT release anything (its action is in toggle mode). */
  swallowsRelease(code: string): boolean {
    const action = holdActionFor(code);
    return action !== null && this.isToggle(action);
  }

  isOn(action: HoldAction): boolean {
    return this.on.has(action);
  }

  codeOf(action: HoldAction): string | undefined {
    return this.on.get(action);
  }

  /** Forget one latch without a press: the game let go of it (a climb stopped the pour, say). */
  drop(action: HoldAction): boolean {
    return this.on.delete(action);
  }

  /** Drop everything; the caller releases what each one held. */
  clear(): Array<{ action: HoldAction; code: string }> {
    const dropped = [...this.on].map(([action, code]) => ({ action, code }));
    this.on.clear();
    return dropped;
  }

  get size(): number {
    return this.on.size;
  }

  active(): HoldAction[] {
    return HOLD_ACTIONS.filter((action) => this.on.has(action));
  }
}
