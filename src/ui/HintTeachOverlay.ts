import type { Ctx } from '@/core/types';
import { touchHint } from '@/ui/touchLabels';

const DISMISS_MS = 9000;
/** How often the calm gate looks at the centre of the screen. */
const CALM_POLL_MS = 200;
/** A card interrupted this early by a centre beat comes back once it is calm. */
const RESHOW_IF_SHOWN_UNDER_MS = 4000;

/**
 * The centre beats a teach card must never talk over (QA: "The Flask" landed on
 * the Tea Engine's caption card and its Q prompt, "The Map" 0.4 s into the
 * floor-2 title card, the floor-3 "Golden Key" card rode through the Sanctum
 * into floor 4's title). Presentation-level facts, so they are read from the
 * DOM: whichever of these is actually on screen holds every teach card back.
 */
const CENTRE_BEATS = [
  '#tea-view', // the Bell & Tea Engine's caption card
  '#wave-banner', // level title card + centre notices ("A new spell card", "Tea is served"…)
  '#level-curtain',
  '#sanctum-overlay',
  '#pause-overlay',
  '#gameover-overlay',
  '#card-offer-overlay',
  '#wand-offer-overlay',
  '#grimoire-overlay',
  '#run-summary',
  '#wand-bench',
  '#expedition-entry',
  // The story's beats (ctx.story.beatActive covers the ones with no DOM of their own:
  // an echo playing, the escape, Matron Ash speaking).
  '#story-dialogue.open', // Pell talking
  '#story-cinema.show', // the opening and the ending plates
  '#narration-caption.show', // the Docent / Pell / Ash speaking (QA: five text layers at the first cast)
  '.story-letterbox.on', // a boss prologue
  '#callout-layer .callout-finisher', // a boss's name card rising over it
] as const;

function onScreen(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || el.hidden) return false;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) <= 0.05) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * The teach-once popover (hint tier 3): the first time the player nears a given
 * interactable, a small non-modal card explains it. Does NOT pause the game —
 * it's a corner note, dismissable by click and auto-fading after a few seconds.
 * The "show only once" gating lives in the HintSystem (seenHints persistence);
 * this overlay renders what it's told — and YIELDS: while a centre beat is on
 * screen it tells the HintSystem to hold its lessons (unspent), a card already
 * up steps aside (and returns when calm if it was barely read), and a level
 * change dismisses whatever belonged to the floor behind.
 */
export class HintTeachOverlay {
  private readonly root: HTMLElement;
  private readonly offHintTeach: () => void;
  private readonly offLevel: () => void;
  private hideTimer = 0;
  private readonly pollTimer: number;
  private visibleCard: { title: string; body: string; level: string | null; shownAt: number } | null = null;
  /** A card a centre beat pushed aside before it could be read. */
  private interrupted: { title: string; body: string; level: string | null } | null = null;
  private held = false;

  constructor(private readonly ctx: Ctx) {
    this.root = document.createElement('div');
    this.root.id = 'hint-teach-overlay';
    this.root.className = 'hint-teach-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.addEventListener('click', () => this.hide());
    document.body.appendChild(this.root);

    this.offHintTeach = ctx.events.on('hintTeach', ({ title, body }) => this.offer(title, body));
    // Stale on arrival: a lesson about the floor behind never follows you down.
    this.offLevel = ctx.events.on('levelChanged', () => {
      this.interrupted = null;
      this.hide();
    });
    this.pollTimer = window.setInterval(() => this.poll(), CALM_POLL_MS);
  }

  /** Is a centre beat (or the descent's curtain / a pause) on screen right now? */
  private centreBusy(): boolean {
    const ctx = this.ctx;
    if (ctx.state.paused || ctx.levels?.transitioning || ctx.story?.beatActive) return true;
    for (const sel of CENTRE_BEATS) if (onScreen(document.querySelector(sel))) return true;
    return false;
  }

  private poll(): void {
    const busy = this.centreBusy();
    if (busy !== this.held) {
      this.held = busy;
      this.ctx.hints?.setTeachHeld?.(busy);
    }
    if (busy && this.visibleCard) {
      // Step aside; a card that was barely up comes back when it is calm.
      const card = this.visibleCard;
      if (performance.now() - card.shownAt < RESHOW_IF_SHOWN_UNDER_MS) {
        this.interrupted = { title: card.title, body: card.body, level: card.level };
      }
      this.hide();
    } else if (!busy && !this.visibleCard && this.interrupted) {
      const card = this.interrupted;
      this.interrupted = null;
      if (card.level === this.levelId()) this.show(card.title, card.body);
    }
  }

  /** A lesson arrives: shown now if the centre is calm, else it waits its turn
   *  (the HintSystem's hold is only as fresh as the last poll). */
  private offer(title: string, body: string): void {
    if (this.ctx.state.hintMode === 'off') return; // the player's Teaching cards option (covers every emitter)
    if (this.centreBusy()) {
      this.interrupted ??= { title, body, level: this.levelId() };
      return;
    }
    this.show(title, body);
  }

  private levelId(): string | null {
    return this.ctx.levels?.current?.def.id ?? null;
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
    text.textContent = touchHint(body);
    card.appendChild(text);

    const dismiss = document.createElement('div');
    dismiss.className = 'hint-teach-dismiss';
    dismiss.textContent = document.body.classList.contains('touch-enabled') ? 'tap to dismiss' : 'click to dismiss';
    card.appendChild(dismiss);

    this.root.appendChild(card);
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');
    this.visibleCard = { title, body, level: this.levelId(), shownAt: performance.now() };

    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), DISMISS_MS);
  }

  private hide(): void {
    window.clearTimeout(this.hideTimer);
    this.visibleCard = null;
    this.root.classList.remove('visible');
    this.root.setAttribute('aria-hidden', 'true');
  }

  dispose(): void {
    this.offHintTeach();
    this.offLevel();
    window.clearTimeout(this.hideTimer);
    window.clearInterval(this.pollTimer);
    this.root.remove();
  }
}
