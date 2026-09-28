import type { Ctx } from '@/core/types';
import type { StoryCinemaView } from '@/core/story';
import { SPEAKER_NAMES } from '@/content/story/types';
import { paintPlate, type PlateArtId } from './plates';

const STYLE = `
#story-cinema {
  position: absolute; inset: 0; z-index: 400; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: #030506; opacity: 0; pointer-events: none; transition: opacity 0.5s ease;
}
#story-cinema.show { opacity: 1; pointer-events: auto; cursor: pointer; }
/* Double id: must out-rank the game canvas's \`#canvas-holder canvas { width: 100% !important }\`. */
#canvas-holder #story-cinema canvas {
  position: static !important; width: auto !important; height: min(calc(100% - 210px), calc(92vw * 9 / 16)) !important;
  aspect-ratio: 16 / 9; display: block; flex: none; image-rendering: auto;
  box-shadow: 0 0 80px #000; transition: opacity 0.7s ease;
}
#story-cinema .sc-title {
  margin-top: 18px; font: 650 calc(10.5px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif);
  letter-spacing: 0.26em; text-transform: uppercase; color: var(--house-brass, #d5b982); opacity: 0.85; min-height: 1em;
}
#story-cinema .sc-line {
  margin: 10px 0 0; max-width: min(760px, 86vw); min-height: 3em; text-align: center;
  font: italic 500 calc(21px * var(--text-scale, 1))/1.45 var(--house-serif, Georgia, serif); color: var(--house-paper, #e6dfca);
  text-shadow: 0 1px 3px #000; opacity: 0; transform: translateY(4px); transition: opacity 0.5s ease, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
#story-cinema .sc-line.show { opacity: 1; transform: none; }
#story-cinema .sc-line small { display: block; margin-bottom: 4px; font: 650 calc(10px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif); font-style: normal; letter-spacing: 0.2em; text-transform: uppercase; color: #d5b982b0; }
#story-cinema .sc-pips { display: flex; gap: 8px; margin-top: 16px; }
#story-cinema .sc-pips i { width: 18px; height: 2px; background: #d5b98233; transition: background 0.4s ease; }
#story-cinema .sc-pips i.on { background: #d5b982; }
#story-cinema .sc-skip {
  position: absolute; right: 22px; bottom: 18px; font: 600 calc(10px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif);
  letter-spacing: 0.14em; color: #9fb0a680; text-transform: uppercase;
}
body.reduce-flashes #story-cinema, body.reduce-flashes #story-cinema canvas { transition: opacity 0.2s linear; }
`;

/**
 * The opening and the ending, on screen (wave 3 WS-S): the director's plates
 * (`storyCinema`) painted procedurally (ui/story/plates) under the spoken
 * line and its speaker, with progress pips. Any key or click skips the whole
 * cinematic (ctx.story.skipCinematic) — never a trap between the player and
 * the first fire, or the Ledger.
 */
export class StoryCinemaOverlay {
  private readonly style = document.createElement('style');
  private readonly root = document.createElement('section');
  private readonly canvas = document.createElement('canvas');
  private readonly title = document.createElement('p');
  private readonly line = document.createElement('p');
  private readonly pips = document.createElement('div');
  private readonly off: Array<() => void> = [];
  private art: PlateArtId | null = null;
  private plateAt = 0;
  private prev: HTMLCanvasElement | null = null;
  private prevAt = 0;
  private speakingUntil = 0;
  private raf: number | null = null;
  private openedAt = 0;

  constructor(private readonly ctx: Ctx) {
    this.style.textContent = STYLE;
    document.head.appendChild(this.style);
    this.root.id = 'story-cinema';
    this.root.setAttribute('aria-live', 'polite');
    this.canvas.width = 960;
    this.canvas.height = 540;
    this.title.className = 'sc-title';
    this.line.className = 'sc-line';
    this.pips.className = 'sc-pips';
    const skip = document.createElement('span');
    skip.className = 'sc-skip';
    skip.textContent = 'Any key to skip';
    this.root.append(this.canvas, this.title, this.line, this.pips, skip);
    (document.getElementById('canvas-holder') ?? document.body).appendChild(this.root);
    this.root.addEventListener('click', () => this.skip());
    this.off.push(ctx.events.on('storyCinema', (v) => this.onView(v)));
    this.off.push(ctx.events.on('narration', ({ seconds, speaker }) => {
      if (this.art && speaker === 'docent') this.speakingUntil = performance.now() + seconds * 1000;
    }));
    window.addEventListener('keydown', this.onKey, true);
    this.off.push(() => window.removeEventListener('keydown', this.onKey, true));
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.root.classList.contains('show')) return;
    // Everything waits while a plate is up; any key skips (after a moment, so a held key does not).
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) this.skip();
  };

  private skip(): void {
    if (performance.now() - this.openedAt < 350) return;
    this.ctx.story?.skipCinematic();
  }

  private onView(v: StoryCinemaView): void {
    if (v.phase === 'begin') {
      this.openedAt = performance.now();
      this.art = null;
      this.prev = null;
      this.title.textContent = '';
      this.line.textContent = '';
      this.line.classList.remove('show');
      this.pips.replaceChildren(...Array.from({ length: v.count ?? 0 }, () => document.createElement('i')));
      this.root.classList.add('show');
      document.body.classList.add('story-cinema-active');
      const g = this.canvas.getContext('2d');
      if (g) { g.fillStyle = '#030506'; g.fillRect(0, 0, this.canvas.width, this.canvas.height); }
      if (this.raf === null) this.raf = requestAnimationFrame(this.frame);
      return;
    }
    if (v.phase === 'end') {
      this.root.classList.remove('show');
      document.body.classList.remove('story-cinema-active');
      window.setTimeout(() => { if (!this.root.classList.contains('show') && this.raf !== null) { cancelAnimationFrame(this.raf); this.raf = null; } }, 600);
      return;
    }
    // A new plate: keep the last one for a crossfade.
    if (this.art) {
      const snap = document.createElement('canvas');
      snap.width = this.canvas.width; snap.height = this.canvas.height;
      snap.getContext('2d')?.drawImage(this.canvas, 0, 0);
      this.prev = snap;
      this.prevAt = performance.now();
    }
    this.art = (v.art ?? 'works') as PlateArtId;
    this.plateAt = performance.now();
    this.title.textContent = v.title ?? '';
    this.line.classList.remove('show');
    const text = v.line?.text ?? '';
    const who = v.line ? SPEAKER_NAMES[v.line.speaker] : '';
    window.setTimeout(() => {
      const small = document.createElement('small');
      small.textContent = who;
      this.line.replaceChildren(...(text ? [small, document.createTextNode(text)] : []));
      if (text) this.line.classList.add('show');
    }, 180);
    Array.from(this.pips.children).forEach((pip, i) => pip.classList.toggle('on', i <= (v.index ?? 0)));
  }

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    const g = this.canvas.getContext('2d');
    if (!g || !this.art) return;
    const now = performance.now();
    const t = (now - this.plateAt) / 1000;
    const speaking = now < this.speakingUntil ? 1 : Math.max(0, 1 - (now - this.speakingUntil) / 600);
    const reduce = document.body.classList.contains('reduce-flashes');
    paintPlate(g, this.art, this.canvas.width, this.canvas.height, reduce ? Math.min(t, 0.5) + t * 0.3 : t, speaking);
    // The previous plate dissolves over the new one.
    if (this.prev) {
      const k = 1 - (now - this.prevAt) / 700;
      if (k <= 0) this.prev = null;
      else { g.globalAlpha = k; g.drawImage(this.prev, 0, 0); g.globalAlpha = 1; }
    } else if (t < 0.6) {
      // Out of black.
      g.fillStyle = `rgba(3,5,6,${1 - t / 0.6})`;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  };

  dispose(): void {
    for (const d of this.off.splice(0)) d();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.root.remove();
    this.style.remove();
  }
}
