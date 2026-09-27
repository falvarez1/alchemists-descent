import type { Ctx } from '@/core/types';

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
body.reduce-flashes #narration-caption { transition: opacity 0.2s linear; transform: translate(-50%, 0); }
`;

/**
 * A caption for the few narrated lines that have no text on screen where
 * they are spoken (a boss's name as it wakes, the Workshop's note). Every
 * other line the narrator reads is already on screen, so this stays empty.
 */
export class NarrationCaption {
  private readonly el = document.createElement('p');
  private readonly style = document.createElement('style');
  private readonly off: () => void;
  private timer: number | null = null;

  constructor(ctx: Ctx) {
    this.el.id = 'narration-caption';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.style.textContent = STYLE;
    document.head.appendChild(this.style);
    document.getElementById('canvas-holder')?.appendChild(this.el);
    this.off = ctx.events.on('narration', ({ text, seconds, captioned }) => {
      if (!captioned) return;
      this.el.textContent = text;
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
