import { VIEW_H, VIEW_W } from '@/config/constants';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import type { Ctx, Enemy } from '@/core/types';

/** How long a health bar hangs over an enemy after it was last hit, the last part of which it fades. */
export const BAR_MS = 2000;
const BAR_FADE_MS = 500;
/** How long a damage number rises before it is gone. */
const NUMBER_MS = 850;
/** A fast stream of small hits (fire, acid, a beam) reads as one number every so often, not a flicker. */
const NUMBER_EVERY_MS = 260;
const MAX_NUMBERS = 14;

/** The damage to print for what has piled up, or null while it is still under a whole point. */
export function damageText(pending: number): string | null {
  const whole = Math.round(pending);
  return pending >= 0.5 && whole >= 1 ? `−${whole}` : null;
}

/** 1 full, fading to 0 over the last half second of the bar's life; 0 once it has run out. */
export function barOpacity(ageMs: number): number {
  if (ageMs < 0 || ageMs >= BAR_MS) return 0;
  return ageMs > BAR_MS - BAR_FADE_MS ? (BAR_MS - ageMs) / BAR_FADE_MS : 1;
}

interface Tracked {
  hp: number;
  hitAt: number;
  pending: number;
  numberAt: number;
  bar: HTMLElement | null;
  fill: HTMLElement | null;
}

interface LiveNumber { el: HTMLElement; x: number; y: number; born: number }

/**
 * Enemy health bars and damage numbers (a player option, off by default): a thin bar over an enemy
 * for two seconds after it is hit, and the damage dealt rising off it. A readout ONLY: it reads
 * `hp` each frame and writes DOM, nothing else; it cannot change a fight. The game has no
 * "enemy hit" event, so the hit is the drop in hp, exactly what the existing flash reads.
 * While off there is no layer, no element and no frame callback.
 */
export class EnemyReadouts {
  private readonly tracked = new Map<Enemy, Tracked>();
  private readonly numbers: LiveNumber[] = [];
  private layer: HTMLElement | null = null;
  private resize: ResizeObserver | null = null;
  private raf: number | null = null;
  private enabled = false;

  constructor(private readonly ctx: Ctx) {}

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) { this.teardown(); return; }
    const holder = document.getElementById('canvas-holder');
    if (!holder) { this.enabled = false; return; }
    const layer = document.createElement('div');
    layer.id = 'enemy-readout-layer';
    layer.setAttribute('aria-hidden', 'true');
    holder.appendChild(layer);
    this.layer = layer;
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.syncScale(holder));
      this.resize.observe(holder);
    }
    this.syncScale(holder);
    this.raf = requestAnimationFrame(this.frame);
  }

  private syncScale(holder: HTMLElement): void {
    this.layer?.style.setProperty('--readout-scale', String(Math.max(0.6, Math.min(1.6, (holder.clientWidth || 1280) / 1280))));
  }

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    this.update(performance.now());
  };

  /** One frame. Public so a test can drive it with a clock of its own. */
  update(now: number): void {
    const { ctx } = this;
    const live = new Set<Enemy>();
    if (ctx.state.mode === 'play') {
      for (const e of ctx.enemies) {
        live.add(e);
        this.watch(e, now);
      }
    }
    // Enemies that left the world (removed, or a new floor): their elements go with them.
    for (const [e, t] of this.tracked) {
      if (!live.has(e)) { t.bar?.remove(); this.tracked.delete(e); }
    }
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      const age = now - n.born;
      if (age >= NUMBER_MS) { n.el.remove(); this.numbers.splice(i, 1); continue; }
      this.place(n.el, n.x, n.y, -18 * (age / NUMBER_MS));
      n.el.style.opacity = age > NUMBER_MS * 0.6 ? String(1 - (age - NUMBER_MS * 0.6) / (NUMBER_MS * 0.4)) : '1';
    }
  }

  private watch(e: Enemy, now: number): void {
    let t = this.tracked.get(e);
    if (!t) { t = { hp: e.hp, hitAt: -Infinity, pending: 0, numberAt: -Infinity, bar: null, fill: null }; this.tracked.set(e, t); }
    if (e.hp < t.hp - 0.01) { t.pending += t.hp - e.hp; t.hitAt = now; }
    t.hp = e.hp;
    // A number every so often for what has piled up; the last of it is always said.
    if (t.pending > 0 && (now - t.numberAt >= NUMBER_EVERY_MS || e.hp <= 0)) {
      const text = damageText(t.pending);
      if (text) { this.spawnNumber(e, text, now); t.numberAt = now; t.pending = 0; }
      else if (e.hp <= 0) t.pending = 0;
    }
    const age = now - t.hitAt;
    const opacity = barOpacity(age);
    if (opacity <= 0) { if (t.bar) { t.bar.remove(); t.bar = null; t.fill = null; } return; }
    if (!t.bar && this.layer) {
      t.bar = document.createElement('div');
      t.bar.className = 'enemy-hp-bar';
      t.fill = document.createElement('div');
      t.bar.appendChild(t.fill);
      this.layer.appendChild(t.bar);
    }
    if (!t.bar || !t.fill) return;
    const def = ENEMY_DEFS[e.kind];
    // Wider for a bigger body, never a hair: the bar is a readout, not a sprite.
    const width = Math.max(18, Math.min(60, (def?.halfW ?? 5) * 2 * 2.4));
    t.bar.style.width = `calc(${width}px * var(--readout-scale, 1))`;
    t.fill.style.width = `${Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp))) * 100}%`;
    t.bar.style.opacity = String(opacity);
    this.place(t.bar, e.x, e.y - (def?.h ?? 10) - 5, 0);
  }

  private spawnNumber(e: Enemy, text: string, now: number): void {
    if (!this.layer) return;
    if (this.numbers.length >= MAX_NUMBERS) { this.numbers.shift()?.el.remove(); }
    const el = document.createElement('div');
    el.className = 'enemy-hp-num';
    el.textContent = text;
    this.layer.appendChild(el);
    const def = ENEMY_DEFS[e.kind];
    // A little sideways scatter so a run of hits does not print over itself.
    this.numbers.push({ el, x: e.x + (Math.random() - 0.5) * 8, y: e.y - (def?.h ?? 10) - 9, born: now });
  }

  /** Follow the camera: the view shows [presentationX, +VIEW_W) scaled about its centre by zoom (as Callouts does). */
  private place(el: HTMLElement, x: number, y: number, lift: number): void {
    const cam = this.ctx.camera;
    const left = cam.presentationX ?? cam.x;
    const top = cam.presentationY ?? cam.y;
    const zoom = cam.zoom || 1;
    const u = 0.5 + ((x - left) / VIEW_W - 0.5) * zoom;
    const v = 0.5 + ((y - top) / VIEW_H - 0.5) * zoom;
    el.style.left = `${(u * 100).toFixed(3)}%`;
    el.style.top = `calc(${(v * 100).toFixed(3)}% + ${lift.toFixed(1)}px)`;
    el.style.visibility = u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1 ? 'hidden' : '';
  }

  private teardown(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.resize?.disconnect();
    this.resize = null;
    this.tracked.clear();
    this.numbers.length = 0;
    this.layer?.remove();
    this.layer = null;
  }

  dispose(): void { this.setEnabled(false); }
}
