import type { Ctx } from '@/core/types';
import { SPEAKER_NAMES } from '@/content/story/types';

/** Styles live with the one element they dress (the shared stylesheets stay untouched). */
const STYLE = `
#narration-caption {
  position: absolute; left: 50%; bottom: 17%; transform: translate(-50%, 6px); max-width: min(640px, 84%);
  margin: 0; padding: 0; text-align: center; pointer-events: none; opacity: 0; z-index: 40;
  font: italic 500 calc(17px * var(--text-scale, 1))/1.4 var(--house-serif, Georgia, serif);
  letter-spacing: 0.01em; color: var(--house-paper, #e6dfca); text-shadow: 0 1px 3px #050b0d, 0 0 14px #050b0dcc;
  transition: opacity 0.45s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
#narration-caption.show { opacity: 1; transform: translate(-50%, 0); }
#narration-caption .nc-name {
  display: block; margin-bottom: 3px; font: 650 calc(10px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif);
  font-style: normal; letter-spacing: 0.16em; text-transform: uppercase; color: var(--house-brass, #d5b982);
}
#narration-caption .nc-name:empty { display: none; }
body.reduce-flashes #narration-caption { transition: opacity 0.2s linear; transform: translate(-50%, 0); }
`;

/**
 * A caption for the narrated lines that have no text on screen where they are
 * spoken (a boss's name as it wakes, the Workshop's note) and for the story's
 * voices — the Docent in his speaking-pipes, an echo's narration, a prologue —
 * which wear their speaker's name plate. Every other line the narrator reads
 * is already on screen, so this stays empty.
 */
export class NarrationCaption {
  private readonly el = document.createElement('p');
  private readonly name = document.createElement('span');
  private readonly words = document.createElement('span');
  private readonly style = document.createElement('style');
  private readonly off: () => void;
  private timer: number | null = null;

  constructor(ctx: Ctx) {
    this.el.id = 'narration-caption';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.name.className = 'nc-name';
    this.el.append(this.name, this.words);
    this.style.textContent = STYLE;
    document.head.appendChild(this.style);
    document.getElementById('canvas-holder')?.appendChild(this.el);
    this.off = ctx.events.on('narration', ({ text, seconds, captioned, speaker }) => {
      if (!captioned) return;
      this.name.textContent = speaker ? SPEAKER_NAMES[speaker] : '';
      this.words.textContent = text;
      this.el.classList.add('show');
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => { this.el.classList.remove('show'); this.timer = null; }, seconds * 1000 + 700);
    });
  }

  dispose(): void {
    this.off();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.el.remove();
    this.style.remove();
  }
}
