import type { Ctx } from '@/core/types';

/** One dual-rumble pulse: how long, and how hard the heavy and light motors turn (0..1). */
export interface RumbleEffect { duration: number; strong: number; weak: number }

/** Below this share of max health a scratch is not worth a buzz. */
const HURT_FLOOR = 0.02;
/** Shake below this is footsteps and small landings; above, a blast or a heavy impact. */
const BLAST_FLOOR = 0.03;
/** A rise in screen shake this big in one frame is a new blast, not the tail of an old one. */
const BLAST_RISE = 0.012;
/** The quietest gap between two pulses. A harder pulse may cut a softer one short. */
const MIN_GAP_MS = 110;

export const DEATH_RUMBLE: RumbleEffect = { duration: 420, strong: 1, weak: 0.7 };

/** Health lost (a fraction of the maximum) -> a pulse, or null for a scratch. Harder hits buzz longer and deeper. */
export function hurtRumble(lostFraction: number): RumbleEffect | null {
  if (!(lostFraction > HURT_FLOOR)) return null;
  const f = Math.min(1, lostFraction);
  return { duration: Math.round(90 + 240 * f), strong: Math.min(1, 0.25 + 1.4 * f), weak: Math.min(1, 0.15 + 0.7 * f) };
}

/** The screen shake rose by `rise` to `level` in one frame -> a blast pulse, or null. */
export function blastRumble(level: number, rise: number): RumbleEffect | null {
  if (level < BLAST_FLOOR || rise < BLAST_RISE) return null;
  const f = Math.min(1, level / 0.09);
  return { duration: Math.round(120 + 160 * f), strong: Math.min(1, 0.2 + 0.7 * f), weak: Math.min(1, 0.3 + 0.5 * f) };
}

/**
 * Controller vibration (a player option, off by default): a short rumble when the alchemist is hurt, when
 * something near enough to shake the screen goes off, and when they fall. The game has no "hurt" or
 * "explosion" event, so this reads the same two facts the HUD and the camera already show (health and
 * screen shake); it never changes either. Feature-detected: a controller (or browser) with no
 * vibrationActuator simply does nothing, and a refused effect is swallowed.
 */
export class PadRumble {
  private enabled = false;
  private raf: number | null = null;
  private lastHp = -1;
  private lastShake = 0;
  private lastAt = 0;
  private lastStrength = 0;
  private readonly offDied: () => void;

  constructor(private readonly ctx: Ctx) {
    this.offDied = ctx.events.on('playerDied', () => this.play(DEATH_RUMBLE));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
      return;
    }
    this.rebase();
    if (this.raf === null) this.raf = requestAnimationFrame(this.frame);
  }

  private rebase(): void {
    this.lastHp = this.ctx.player.hp;
    this.lastShake = this.ctx.fx.screenShake;
  }

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    this.update();
  };

  /** One frame's look at health and shake. Public so a test can drive it without a frame loop. */
  update(): void {
    const { state, player, fx } = this.ctx;
    // Menus, the title, the Sandbox and a dead body are still: nothing to feel, and no stale baseline to trip on later.
    if (state.mode !== 'play' || state.paused || player.dead) { this.rebase(); return; }
    const lost = this.lastHp > player.hp ? (this.lastHp - player.hp) / Math.max(1, player.maxHp) : 0;
    const rise = fx.screenShake - this.lastShake;
    this.lastHp = player.hp;
    this.lastShake = fx.screenShake;
    const hurt = hurtRumble(lost);
    const blast = blastRumble(fx.screenShake, rise);
    const pick = hurt && blast ? (hurt.strong >= blast.strong ? hurt : blast) : hurt ?? blast;
    if (pick) this.play(pick);
  }

  private play(effect: RumbleEffect): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastAt < MIN_GAP_MS && effect.strong <= this.lastStrength) return;
    const pad = typeof navigator === 'undefined' || !navigator.getGamepads
      ? undefined
      : Array.from(navigator.getGamepads()).find((p) => p?.connected && p.mapping === 'standard');
    const actuator = pad?.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') return;
    this.lastAt = now;
    this.lastStrength = effect.strong;
    try {
      void actuator.playEffect('dual-rumble', { startDelay: 0, duration: effect.duration, strongMagnitude: effect.strong, weakMagnitude: effect.weak }).catch(() => undefined);
    } catch { /* a controller that cannot rumble right now is not an error */ }
  }

  dispose(): void {
    this.setEnabled(false);
    this.offDied();
  }
}
