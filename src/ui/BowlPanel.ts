import '@/styles/alchemy.css';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { MATERIAL_PARAMS } from '@/config/params';
import { MATERIAL_SWATCHES } from '@/content/materialPalette';
import type { CauldronView, MixFeel, MixVerdict } from '@/core/alchemy';
import type { Ctx } from '@/core/types';

const SWATCH = new Map(MATERIAL_SWATCHES.map((s) => [s.id, s]));

/** An empty bowl only shows its panel to someone standing at it (cells). */
const EMPTY_SHOW_RADIUS = 46;
/** The panel hangs this far above the basin's floor (cells). */
const LIFT_CELLS = 36;

const FEEL_WORD: Record<MixFeel, string> = { hot: 'hot', warm: 'warm', cold: 'cold' };

/** The line under the swatches: what the bowl is doing, in plain words and never the recipe's name. */
export function bowlNote(view: CauldronView): string {
  if (view.elixir && view.reagents.length === 0) return 'Brewed. Siphon it (E) into an empty flask.';
  if (view.reagents.length === 0) return 'Empty. Pour reagents in (Q).';
  if (!view.heated) return view.mass < 6 ? 'Add more, and a fire beside the bowl.' : 'Needs a fire beside or under the bowl.';
  if (view.matched) return 'Simmering…';
  const v: MixVerdict | null = view.verdict;
  if (v === 'close') return view.missing > 0 ? 'The brew shimmers: close, but something is missing.' : 'The brew shimmers: you are close to something.';
  if (v === 'muddy') return 'The brew clouds: something does not belong.';
  if (v === 'inert') return 'Nothing stirs.';
  return 'Heating…';
}

/**
 * THE BOWL PANEL: a small card over the cauldron that shows what is really in the
 * bowl (a swatch and a count per reagent, how full it is), whether a fire is on it,
 * the brew's progress, and, once a heated mix has been judged, how each reagent sits
 * against the nearest undiscovered recipe (cold / warm / hot) WITHOUT naming it.
 * A readout only: it listens to `cauldronView` (game/Brewing) and writes DOM.
 */
export class BowlPanel {
  private el: HTMLElement | null = null;
  private view: CauldronView | null = null;
  private raf: number | null = null;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    this.offs.push(
      ctx.events.on('cauldronView', (v) => this.show(v)),
      ctx.events.on('levelChanged', () => this.show(null)),
    );
  }

  private show(v: CauldronView | null): void {
    if (!v || !v.visible) {
      this.view = null;
      this.paint();
      return;
    }
    this.view = v;
    this.paint();
  }

  private element(): HTMLElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.id = 'bowl-panel';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    const holder = document.getElementById('canvas-holder') ?? document.body;
    const hud = document.getElementById('game-hud');
    if (hud && hud.parentElement === holder) holder.insertBefore(el, hud);
    else holder.appendChild(el);
    this.el = el;
    return el;
  }

  private shouldShow(v: CauldronView): boolean {
    if (v.reagents.length > 0 || v.elixir) return true;
    return Math.hypot(this.ctx.player.x - v.x, this.ctx.player.y - v.y) <= EMPTY_SHOW_RADIUS;
  }

  private paint(): void {
    const v = this.view;
    if (!v) {
      if (this.el) this.el.hidden = true;
      this.stopFollow();
      return;
    }
    const el = this.element();
    const rows: string[] = [];
    for (const r of v.reagents) {
      const sw = SWATCH.get(r.cell);
      const name = MATERIAL_PARAMS[r.cell]?.name ?? sw?.label ?? `#${r.cell}`;
      rows.push(
        `<li class="bp-row"><i class="bp-swatch" style="background:${sw?.color ?? '#888'}"></i>` +
        `<span class="bp-name">${esc(name)}</span><b class="bp-n">${r.n}</b>` +
        (r.feel ? `<span class="bp-feel ${r.feel}">${FEEL_WORD[r.feel]}</span>` : '') + `</li>`,
      );
    }
    if (v.elixir) {
      const sw = SWATCH.get(v.elixir.cell);
      const name = MATERIAL_PARAMS[v.elixir.cell]?.name ?? sw?.label ?? 'Elixir';
      rows.push(
        `<li class="bp-row bp-product"><i class="bp-swatch" style="background:${sw?.color ?? '#fff'}"></i>` +
        `<span class="bp-name">${esc(name)}</span><b class="bp-n">${v.elixir.n}</b></li>`,
      );
    }
    const pct = Math.round(v.progress * 100);
    el.className = v.verdict ? `verdict-${v.verdict}` : v.matched ? 'simmering' : '';
    el.innerHTML =
      `<div class="bp-head"><span class="bp-title">The Bowl</span><span class="bp-mass">${v.mass}/14</span>` +
      `<span class="bp-fire ${v.heated ? 'lit' : ''}">${v.heated ? 'fire' : 'no fire'}</span></div>` +
      (rows.length ? `<ul class="bp-list">${rows.join('')}</ul>` : '') +
      (v.matched ? `<div class="bp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="bp-fill" style="width:${pct}%"></div></div>` : '') +
      `<div class="bp-note">${esc(bowlNote(v))}</div>`;
    this.follow();
  }

  /** Hang over the basin: the view shows [presentationX, +VIEW_W) scaled about its centre by zoom. */
  private readonly place = (): void => {
    this.raf = requestAnimationFrame(this.place);
    const v = this.view;
    const el = this.el;
    if (!v || !el) return;
    // An empty bowl shows only to someone standing at it (the player walks; the event does not fire for that),
    // and nothing hangs over a paused game or an open book.
    const show = this.shouldShow(v) && !this.ctx.state.paused;
    if (el.hidden === show) el.hidden = !show;
    if (!show) return;
    const cam = this.ctx.camera;
    const left = cam.presentationX ?? cam.x;
    const top = cam.presentationY ?? cam.y;
    const zoom = cam.zoom || 1;
    const u = 0.5 + ((v.x - left) / VIEW_W - 0.5) * zoom;
    const w = 0.5 + ((v.y - LIFT_CELLS - top) / VIEW_H - 0.5) * zoom;
    el.style.left = `${(u * 100).toFixed(3)}%`;
    el.style.top = `${(w * 100).toFixed(3)}%`;
    el.style.visibility = u < -0.15 || u > 1.15 || w < -0.15 || w > 1.15 ? 'hidden' : '';
  };

  private follow(): void {
    if (this.raf === null) this.raf = requestAnimationFrame(this.place);
  }

  private stopFollow(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.stopFollow();
    this.el?.remove();
    this.el = null;
  }
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
