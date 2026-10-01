import '@/styles/callouts.css';
import { VIEW_H, VIEW_W } from '@/config/constants';
import type { AlchemyCause, AlchemyKillInfo } from '@/core/run';
import type { Ctx } from '@/core/types';

/**
 * World-anchored combat callouts: a word pops over the spot where the world
 * did the killing, rises and fades. Brass for a single; a chain escalates the
 * badge (×2, ×3 …) in size and heat, and a dry line underneath keeps count in
 * the house voice. The Trickshot finisher speaks through the same layer.
 *
 * Presentation only: listens to `alchemyKill` / `combatCallout`, never touches
 * gameplay. Follows the camera every animation frame while anything is alive,
 * and sleeps otherwise. Reduced flashes drops the glow; reduced motion drops
 * the pop and the rise.
 */

/** The word each cause earns. One word per cause, so the callout teaches the mechanic. */
export const CALLOUT_WORDS: Readonly<Record<AlchemyCause, string>> = {
  burned: 'FLAMBÉED',
  rendered: 'RENDERED',
  steeped: 'STEEPED',
  shorted: 'SHORTED',
  drowned: 'DROWNED',
  dissolved: 'DISSOLVED',
  shattered: 'SHATTERED',
  flattened: 'FLATTENED',
  detonated: 'DETONATED',
  poisoned: 'POISONED',
  impaled: 'IMPALED',
  bowled: 'BOWLED',
};

/** The dry line under a chain, in the Works' voice. Empty for a lone kill. */
export function chainLine(chain: number): string {
  if (chain <= 1) return '';
  if (chain === 2) return 'and another';
  if (chain === 3) return 'a chain reaction';
  if (chain === 4) return 'most irregular';
  if (chain === 5) return 'the Works approve';
  if (chain === 6) return 'please mind the duck';
  // Past six is rare, and each step is told once: the duck, then the Guild, then the Guild giving up.
  if (chain === 7) return 'the duck has been informed';
  if (chain === 8) return 'the Guild requests that you stop';
  if (chain === 9) return 'the Guild has stopped requesting';
  if (chain === 10) return 'this is no longer chemistry, it is a hobby';
  return 'the Clerk of Works has sat down';
}

/** Heat tier for the chain badge (drives its size and colour). */
export function chainTier(chain: number): 0 | 1 | 2 | 3 {
  return chain <= 1 ? 0 : chain === 2 ? 1 : chain <= 4 ? 2 : 3;
}

interface LiveCallout {
  wrap: HTMLElement;
  x: number;
  y: number;
  born: number;
  life: number;
  /** Bowing out early to a chain link that took its spot. */
  leaving?: boolean;
}

const MAX_LIVE = 6;
const BASE_LIFE_MS = 1150;

export class Callouts {
  private readonly layer = document.createElement('div');
  private readonly live: LiveCallout[] = [];
  private readonly disposers: Array<() => void> = [];
  private raf: number | null = null;
  private resize: ResizeObserver | null = null;

  constructor(private readonly ctx: Ctx) {
    this.layer.id = 'callout-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    const holder = document.getElementById('canvas-holder');
    holder?.appendChild(this.layer);
    if (holder && typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.syncScale(holder));
      this.resize.observe(holder);
    }
    if (holder) this.syncScale(holder);
    this.disposers.push(ctx.events.on('alchemyKill', (info) => this.alchemy(info)));
    this.disposers.push(ctx.events.on('combatCallout', ({ x, y, text, tone }) => this.spawn(x, y, text, '', '', tone ?? 'brass', 0)));
    this.disposers.push(ctx.events.on('levelChanged', () => this.clear()));
    this.disposers.push(ctx.events.on('playerDied', () => this.clear()));
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.resize?.disconnect();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.layer.remove();
  }

  private syncScale(holder: HTMLElement): void {
    const w = holder.clientWidth || 1280;
    this.layer.style.setProperty('--callout-scale', String(Math.max(0.6, Math.min(1.6, w / 1280))));
  }

  private alchemy(info: AlchemyKillInfo): void {
    const word = CALLOUT_WORDS[info.cause] ?? info.cause.toUpperCase();
    const badge = info.chain > 1 ? `×${info.chain}` : '';
    const gold = info.bonusGold > 0 ? `+${info.bonusGold} oz` : '';
    const line = chainLine(info.chain);
    this.spawn(info.x, info.y, word, badge, line ? `${line} · ${gold}` : gold, 'brass', info.chain);
  }

  private spawn(x: number, y: number, word: string, badge: string, sub: string, tone: 'brass' | 'finisher', chain: number): void {
    if (typeof document === 'undefined') return;
    // Keep neighbours legible. A chain link lands on its predecessor's spot and
    // TAKES it (the old word bows out fast, the badge escalates in place); an
    // unrelated word nearby stacks above instead of printing over it.
    let wy = y;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      if (Math.abs(c.x - x) > 80 || Math.abs(c.y - wy) > 40) continue;
      if (chain > 1 && !c.leaving) this.yieldCallout(i);
      else if (!c.leaving && Math.abs(c.y - wy) < 22) wy = c.y - 22;
    }
    while (this.live.length >= MAX_LIVE) this.retire(0);

    const wrap = document.createElement('div');
    wrap.className = 'callout-anchor';
    const card = document.createElement('div');
    const tier = chainTier(chain);
    card.className = `callout callout-${tone} callout-tier-${tier}`;
    if (this.ctx.state.reduceFlashes) card.classList.add('callout-calm');
    const main = document.createElement('span');
    main.className = 'callout-word';
    main.textContent = word;
    card.appendChild(main);
    if (badge) {
      const b = document.createElement('span');
      b.className = 'callout-badge';
      b.textContent = badge;
      card.appendChild(b);
    }
    if (sub) {
      const s = document.createElement('span');
      s.className = 'callout-sub';
      s.textContent = sub;
      card.appendChild(s);
    }
    wrap.appendChild(card);
    this.layer.appendChild(wrap);

    const life = tone === 'finisher' ? 2100 : BASE_LIFE_MS + tier * 180;
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pop = 1 + tier * 0.06;
    const frames: Keyframe[] = reducedMotion
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: 'translateY(6px) scale(0.55)' },
          { opacity: 1, transform: `translateY(-4px) scale(${(1.16 * pop).toFixed(3)})`, offset: 0.1, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
          { opacity: 1, transform: `translateY(-10px) scale(${pop.toFixed(3)})`, offset: 0.2 },
          { opacity: 1, transform: `translateY(-26px) scale(${pop.toFixed(3)})`, offset: 0.68 },
          { opacity: 0, transform: `translateY(-40px) scale(${(0.96 * pop).toFixed(3)})` },
        ];
    card.animate?.(frames, { duration: life, easing: 'linear', fill: 'forwards' });

    this.live.push({ wrap, x, y: wy, born: performance.now(), life });
    this.place(this.live[this.live.length - 1]);
    if (this.raf === null) this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.raf = null;
    const now = performance.now();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      if (now - c.born >= c.life) this.retire(i);
      else this.place(c);
    }
    if (this.live.length > 0) this.raf = requestAnimationFrame(this.tick);
  };

  /** Follow the camera: the view shows [presentationX, +VIEW_W) scaled about its centre by zoom. */
  private place(c: LiveCallout): void {
    const cam = this.ctx.camera;
    const left = cam.presentationX ?? cam.x;
    const top = cam.presentationY ?? cam.y;
    const zoom = cam.zoom || 1;
    const u = 0.5 + ((c.x - left) / VIEW_W - 0.5) * zoom;
    const v = 0.5 + ((c.y - top) / VIEW_H - 0.5) * zoom;
    c.wrap.style.left = `${(u * 100).toFixed(3)}%`;
    c.wrap.style.top = `${(v * 100).toFixed(3)}%`;
    c.wrap.style.visibility = u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1 ? 'hidden' : '';
  }

  /** A quick shrink-and-fade (140 ms) for a word a newer chain link replaces. */
  private yieldCallout(i: number): void {
    const c = this.live[i];
    c.leaving = true;
    const now = performance.now();
    c.life = Math.min(c.life, now - c.born + 140);
    const card = c.wrap.firstElementChild as HTMLElement | null;
    card?.getAnimations?.().forEach((a) => a.cancel());
    card?.animate?.(
      [{ opacity: 1, transform: 'translateY(-10px) scale(1)' }, { opacity: 0, transform: 'translateY(-16px) scale(0.8)' }],
      { duration: 140, easing: 'ease-in', fill: 'forwards' },
    );
  }

  private retire(i: number): void {
    const [c] = this.live.splice(i, 1);
    c?.wrap.remove();
  }

  private clear(): void {
    while (this.live.length > 0) this.retire(0);
  }
}
