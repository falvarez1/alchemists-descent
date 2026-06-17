import type { Ctx } from '@/core/types';

const DISMISS_MS = 9000;

/**
 * The teach-once popover (hint tier 3): the first time the player nears a given
 * interactable, a small non-modal card explains it. Does NOT pause the game —
 * it's a corner note, dismissable by click and auto-fading after a few seconds.
 * The "show only once" gating lives in the HintSystem (seenHints persistence);
 * this overlay just renders what it's told.
 */
export class HintTeachOverlay {
  private readonly root: HTMLElement;
  private hideTimer = 0;

  constructor(ctx: Ctx) {
    this.root = document.createElement('div');
    this.root.id = 'hint-teach-overlay';
    this.root.className = 'hint-teach-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.addEventListener('click', () => this.hide());
    document.body.appendChild(this.root);

    ctx.events.on('hintTeach', ({ title, body }) => this.show(title, body));
  }

  private show(title: string, body: string): void {
    this.root.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'hint-teach-card';

    const heading = document.createElement('div');
    heading.className = 'hint-teach-title';
    heading.textContent = title;
    card.appendChild(heading);

    const text = document.createElement('div');
    text.className = 'hint-teach-body';
    text.textContent = body;
    card.appendChild(text);

    const dismiss = document.createElement('div');
    dismiss.className = 'hint-teach-dismiss';
    dismiss.textContent = 'click to dismiss';
    card.appendChild(dismiss);

    this.root.appendChild(card);
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');

    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), DISMISS_MS);
  }

  private hide(): void {
    window.clearTimeout(this.hideTimer);
    this.root.classList.remove('visible');
    this.root.setAttribute('aria-hidden', 'true');
  }
}
