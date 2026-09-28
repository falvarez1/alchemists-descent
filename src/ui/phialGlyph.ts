/**
 * Return-phial glyphs: a small corked vial drawn on a 10x16 pixel grid, so it
 * sits beside the HUD's pixel icons without blurring. One helper serves the
 * HUD row, the death screen and the Sanctum; each owns its own animations
 * through the `data-state` attribute (styles/run.css):
 *
 *   full      — luminous draught, a slow breathing glow
 *   empty     — dark glass
 *   draining  — the draught drops out of the glass, the glass shivers
 *   filling   — the draught rises back with a shimmer
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Glass silhouette: cork socket, neck, shoulders, round-cornered belly. */
const GLASS_PATH = 'M3.5 2.5H6.5V5.5L8.5 7.5V13.5L7.5 14.5H2.5L1.5 13.5V7.5L3.5 5.5Z';
/** The draught inside the glass. */
const LIQUID_PATH = 'M4 4H6V6L8 8V13L7 14H3L2 13V8L4 6Z';

export type PhialState = 'full' | 'empty' | 'draining' | 'filling';

let clipSerial = 0;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function makePhialGlyph(): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'phial';
  span.dataset.state = 'full';
  const root = svg('svg', { viewBox: '0 0 10 16', 'aria-hidden': 'true', focusable: 'false' });
  const clipId = `phial-clip-${++clipSerial}`;
  const defs = svg('defs', {});
  const clip = svg('clipPath', { id: clipId });
  clip.appendChild(svg('path', { d: LIQUID_PATH }));
  defs.appendChild(clip);
  const liquidGroup = svg('g', { 'clip-path': `url(#${clipId})` });
  liquidGroup.appendChild(svg('rect', { class: 'phial-liquid', x: '1', y: '3', width: '8', height: '12' }));
  liquidGroup.appendChild(svg('rect', { class: 'phial-meniscus', x: '1', y: '3', width: '8', height: '1' }));
  root.append(
    defs,
    liquidGroup,
    svg('path', { class: 'phial-glass', d: GLASS_PATH }),
    svg('rect', { class: 'phial-cork', x: '3', y: '0.5', width: '4', height: '2', rx: '0.4' }),
    svg('rect', { class: 'phial-glint', x: '2.6', y: '8', width: '0.8', height: '3' }),
    svg('path', { class: 'phial-crack', d: 'M6.5 8.5L5.4 10.2L6.6 11.4L5.6 13' }),
  );
  span.appendChild(root);
  return span;
}

/** A row of `max` phials with helpers to set and animate them. */
export class PhialRow {
  readonly root: HTMLElement;
  private readonly glyphs: HTMLSpanElement[] = [];
  private readonly timers = new Set<number>();

  constructor(max: number, className = 'phial-row') {
    this.root = document.createElement('div');
    this.root.className = className;
    this.root.setAttribute('role', 'img');
    for (let i = 0; i < max; i++) {
      const glyph = makePhialGlyph();
      this.glyphs.push(glyph);
      this.root.appendChild(glyph);
    }
    this.set(max, max);
  }

  /** Show `phials` of `max` full, without ceremony. */
  set(phials: number, max: number): void {
    this.clearTimers();
    this.glyphs.forEach((glyph, i) => {
      glyph.dataset.state = i < phials ? 'full' : 'empty';
    });
    this.label(phials, max);
  }

  /** The phial at `index` drains (a death spent it). */
  drain(index: number, phials: number, max: number): void {
    this.animate(index, 'draining', 'empty', 900);
    this.label(phials, max);
  }

  /** The phial at `index` fills back up (a refuge or the Sanctum). */
  fill(index: number, phials: number, max: number): void {
    this.animate(index, 'filling', 'full', 1100);
    this.label(phials, max);
  }

  dispose(): void {
    this.clearTimers();
    this.root.remove();
  }

  private animate(index: number, during: PhialState, after: PhialState, ms: number): void {
    const glyph = this.glyphs[index];
    if (!glyph) return;
    glyph.dataset.state = during;
    // Restart the keyframes even if the same state was set a moment ago.
    void glyph.offsetWidth;
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      glyph.dataset.state = after;
    }, ms);
    this.timers.add(id);
  }

  private label(phials: number, max: number): void {
    const text = `Return phials: ${phials} of ${max}. A death spends one.`;
    this.root.setAttribute('aria-label', text);
    this.root.title = text;
  }

  private clearTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
  }
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four'];

/** "Two return phials left." */
export function phialsLeftLine(phials: number): string {
  const word = WORDS[phials] ?? String(phials);
  return `${word} return phial${phials === 1 ? '' : 's'} left.`;
}
