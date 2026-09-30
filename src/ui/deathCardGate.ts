/**
 * The death card's way back, held shut until it can be seen.
 *
 * The card stages itself over ~3.5 s (living-descent.css: the title, the cause,
 * the phials, then the button fades in behind a 2.5 s delay). The button used to
 * be focused the moment the card appeared, so a Space/Enter mashed through the
 * fall activated a button at opacity 0 and spent a phial unseen. Now the buttons
 * are `disabled` until their fade-in ends (an inert control is also skipped by
 * the gamepad's walk over the overlay), and only then enabled and focused.
 *
 * Patience has a limit: from SKIP_AFTER_MS on, any key or click plays the rest
 * of the staged reveal at SKIP_RATE x, smoothly (Web Animations playbackRate,
 * so nothing pops and nothing flashes), and the buttons arrive a breath later.
 * A MIN_DWELL_MS floor keeps reduced-motion (whose animations last 10 ms) from
 * handing over a live button before anyone could have read the card.
 */
export const DEATH_SKIP_AFTER_MS = 1500;
const SKIP_RATE = 8;
const MIN_DWELL_MS = 700;
/** A button is live this long AFTER it is fully visible, so a mashed key still meets a card it could read. */
const SETTLE_MS = 400;
/** The staged reveal ends ~3.5 s in; if animationend never fires (hidden tab), do not stay locked. */
const FALLBACK_MS = 4800;
const STAGED_ANIMATIONS = new Set(['go-fade-in', 'go-title-in']);
const BUTTON_IDS = ['respawn-btn', 'ledger-btn'];

export class DeathCardGate {
  private armedAt = 0;
  private armed = false;
  private sped = false;
  private held: HTMLButtonElement[] = [];
  private timer = 0;
  /** Bumped on every arm/release so a stale dwell timer from an earlier card can do nothing. */
  private generation = 0;

  constructor(private readonly overlay: HTMLElement) {}

  /** The card just appeared: lock whichever way-back button is showing. */
  arm(): void {
    this.release();
    this.generation++;
    this.held = BUTTON_IDS
      .map((id) => document.getElementById(id))
      .filter((b): b is HTMLButtonElement => b instanceof HTMLButtonElement && !b.hidden);
    if (this.held.length === 0) return;
    this.armed = true;
    this.sped = false;
    this.armedAt = performance.now();
    for (const button of this.held) {
      button.disabled = true;
      button.addEventListener('animationend', this.onAnimationEnd);
    }
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointerdown', this.onPointer, true);
    this.timer = window.setTimeout(this.open, FALLBACK_MS);
  }

  /** The card left (respawn, ledger, a cleared death): nothing stays disabled. */
  release(): void {
    this.generation++;
    window.clearTimeout(this.timer);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointerdown', this.onPointer, true);
    for (const button of this.held) {
      button.removeEventListener('animationend', this.onAnimationEnd);
      button.disabled = false;
    }
    this.held = [];
    this.armed = false;
    this.sped = false;
  }

  dispose(): void {
    this.release();
  }

  private readonly onAnimationEnd = (event: AnimationEvent): void => {
    if (event.target !== event.currentTarget || event.animationName !== 'go-fade-in') return;
    this.settle(event.currentTarget as HTMLButtonElement);
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.repeat || event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
    this.fastForward();
  };

  private readonly onPointer = (): void => this.fastForward();

  /** Any input after a beat: play what is left of the reveal quickly. */
  private fastForward(): void {
    if (!this.armed || this.sped || performance.now() - this.armedAt < DEATH_SKIP_AFTER_MS) return;
    this.sped = true;
    for (const animation of this.overlay.getAnimations({ subtree: true })) {
      const name = (animation as CSSAnimation).animationName;
      if (name && STAGED_ANIMATIONS.has(name)) animation.updatePlaybackRate(SKIP_RATE);
    }
    // The finish events do the enabling; this covers a button whose animation had already ended.
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.open, 900);
  }

  /** One button's fade-in is done: enable it after a short settle, and never before the dwell floor. */
  private settle(button: HTMLButtonElement): void {
    const wait = Math.max(SETTLE_MS, MIN_DWELL_MS - (performance.now() - this.armedAt));
    const generation = this.generation;
    window.setTimeout(() => { if (generation === this.generation) this.enable(button); }, wait);
  }

  private readonly open = (): void => {
    for (const button of this.held) this.enable(button);
  };

  private enable(button: HTMLButtonElement): void {
    if (!this.armed || !button.disabled) return;
    button.disabled = false;
    // The first button to arrive takes focus (the way back, else the ledger).
    const active = document.activeElement;
    const holdsFocus = active instanceof HTMLButtonElement && !active.disabled && this.overlay.contains(active);
    if (!holdsFocus) button.focus({ preventScroll: true });
  }
}
