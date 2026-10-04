/** Wire-level controls describe intent, never positions, damage, or outcomes. */
export const DuelButtons = {
  left: 1,
  right: 2,
  up: 4,
  down: 8,
  jump: 16,
  shield: 32,
  attack: 64,
  grab: 128,
  special: 256,
  tactical: 512,
  ultimate: 1024,
  smashLeft: 2048,
  smashRight: 4096,
  smashUp: 8192,
  smashDown: 16384,
} as const;
export interface DuelInput {
  seq: number;
  buttons: number;
  aim: number;
}
export interface DuelTickInput extends DuelInput {
  pressed: number;
}
export const INPUT_TIMEOUT_MS = 500;

/** Ordered input with press latching. A press/release between ticks must not vanish. */
export class DuelInputBuffer {
  private seq = -1;
  private buttons = 0;
  private pressed = 0;
  private chord = 0;
  private chordAim = 0;
  private aim = 0;
  private receivedAt = -Infinity;
  accept(input: DuelInput, now: number): boolean {
    if (input.seq <= this.seq) return false;
    const pressed = input.buttons & ~this.buttons;
    this.pressed |= pressed;
    if (pressed) {
      this.chord = input.buttons;
      this.chordAim = input.aim;
    }
    this.seq = input.seq;
    this.buttons = input.buttons;
    this.aim = input.aim;
    this.receivedAt = now;
    return true;
  }
  take(now: number): DuelTickInput {
    if (now - this.receivedAt > INPUT_TIMEOUT_MS) this.clear();
    const result = {
      seq: this.seq,
      buttons: this.buttons | this.chord,
      pressed: this.pressed,
      aim: this.pressed ? this.chordAim : this.aim,
    };
    this.pressed = this.chord = 0;
    return result;
  }
  clear(): void {
    this.buttons = this.pressed = this.chord = 0;
    this.receivedAt = -Infinity;
  }
  /** A new room has new senders; their sequence numbers start over. */
  reset(): void {
    this.clear();
    this.seq = -1;
  }
}
