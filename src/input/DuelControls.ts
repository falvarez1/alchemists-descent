import type { Ctx } from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { getBindings } from '@/input/bindings';
import { DuelButtons as B, type DuelInput } from '@/net/duel/input';

/** Owns this computer's controls, independently of either simulated fighter.
 * Raw input cannot write into the replica's player or into the other seat. */
export class DuelControls {
  private held = 0;
  private taps = 0;
  private pointer: { x: number; y: number } | null = null;
  private padPause = false;
  private padConnected = false;
  constructor(
    private readonly ctx: Ctx,
    private readonly canvas: () => HTMLCanvasElement,
  ) {
    window.addEventListener('keydown', this.key, true);
    window.addEventListener('keyup', this.key, true);
    window.addEventListener('pointerdown', this.mouse, true);
    window.addEventListener('pointerup', this.mouse, true);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('blur', this.clear);
  }
  private readonly key = (event: KeyboardEvent): void => {
    const duel = this.ctx.duel;
    if (!duel?.active || !duel.room || duel.room.phase === 'lobby' || duel.room.phase === 'loading') return;
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keydown' && !event.repeat) {
        if (duel.room.phase === 'paused') duel.resume();
        else duel.pause();
      }
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[contenteditable]')) return;
    const keys = getBindings();
    const map: Record<string, number> = {
      [keys.left]: B.left,
      [keys.right]: B.right,
      [keys.up]: B.up,
      [keys.down]: B.down,
      [keys.jump]: B.jump,
      [keys.kick]: B.attack,
      [keys.carry]: B.grab,
      [keys.dodge]: B.shield,
      [keys.tactical]: B.tactical,
      [keys.ultimate]: B.ultimate,
    };
    const bit = map[event.code];
    if (!bit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const previous = this.held;
    if (event.type === 'keydown') {
      if (!(this.held & bit)) this.taps |= bit;
      this.held |= bit;
    } else this.held &= ~bit;
    if (this.held !== previous) duel.flushInput();
  };
  private readonly move = (event: PointerEvent): void => {
    if (event.target === this.canvas()) this.pointer = { x: event.clientX, y: event.clientY };
  };
  private readonly mouse = (event: PointerEvent): void => {
    if (!this.ctx.duel?.playing || event.button !== 0) return;
    const previous = this.held;
    if (event.type === 'pointerup') this.held &= ~B.special;
    else if (event.target === this.canvas()) {
      this.held |= B.special;
      this.taps |= B.special;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (this.held !== previous) this.ctx.duel.flushInput();
  };
  readonly clear = (): void => {
    this.held = this.taps = 0;
  };
  private gamepad(): Gamepad | null {
    return typeof navigator.getGamepads === 'function'
      ? (Array.from(navigator.getGamepads()).find((p) => p?.connected && p.mapping === 'standard') ?? null)
      : null;
  }
  /** Menu edges must still be polled while simulation input is paused. */
  pollMenu(): void {
    const pad = this.gamepad(),
      start = pad?.buttons[9]?.pressed === true,
      duel = this.ctx.duel;
    if (duel?.connected && (duel.room?.phase === 'playing' || duel.room?.phase === 'paused')) {
      if (this.padConnected && !pad && duel.playing) duel.pause();
      if (start && !this.padPause) {
        if (duel.playing) duel.pause();
        else duel.resume();
      }
    }
    this.padPause = start;
    this.padConnected = pad !== null;
  }
  sample(): Omit<DuelInput, 'seq'> {
    let buttons = this.held | this.taps;
    this.taps = 0;
    const c = this.ctx,
      slot = c.duel?.slot ?? 0,
      player = c.arena?.bundle(slot)?.player ?? c.player;
    let aim = buttons & B.left ? Math.PI : buttons & B.right ? 0 : player.facing < 0 ? Math.PI : 0;
    if (this.pointer) {
      const rect = this.canvas().getBoundingClientRect(),
        scale = c.camera.viewScale ?? 1;
      const x = c.camera.renderX + ((this.pointer.x - rect.left) / Math.max(1, rect.width)) * VIEW_W * scale;
      const y = c.camera.renderY + ((this.pointer.y - rect.top) / Math.max(1, rect.height)) * VIEW_H * scale;
      aim = Math.atan2(y - (player.y - 10), x - player.x);
    }
    const pad = this.gamepad();
    if (pad) {
      const held = (i: number): boolean => pad.buttons[i]?.pressed === true || (pad.buttons[i]?.value ?? 0) > 0.45;
      const x = pad.axes[0] ?? 0,
        y = pad.axes[1] ?? 0,
        sx = pad.axes[2] ?? 0,
        sy = pad.axes[3] ?? 0;
      if (x < -0.2 || held(14)) buttons |= B.left;
      if (x > 0.2 || held(15)) buttons |= B.right;
      if (y < -0.4 || held(12)) buttons |= B.up;
      if (y > 0.4 || held(13)) buttons |= B.down;
      if (held(2) || held(3)) buttons |= B.jump;
      if (held(0)) buttons |= B.attack;
      if (held(1)) buttons |= B.special;
      if (held(4) || held(5)) buttons |= B.grab;
      if (held(6) || held(7)) buttons |= B.shield;
      if (Math.hypot(sx, sy) > 0.6)
        buttons |=
          Math.abs(sx) > Math.abs(sy) ? (sx < 0 ? B.smashLeft : B.smashRight) : sy < 0 ? B.smashUp : B.smashDown;
      aim = buttons & B.left ? Math.PI : buttons & B.right ? 0 : player.facing < 0 ? Math.PI : 0;
    }
    return { buttons, aim };
  }
  dispose(): void {
    window.removeEventListener('keydown', this.key, true);
    window.removeEventListener('keyup', this.key, true);
    window.removeEventListener('pointerdown', this.mouse, true);
    window.removeEventListener('pointerup', this.mouse, true);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('blur', this.clear);
  }
}
