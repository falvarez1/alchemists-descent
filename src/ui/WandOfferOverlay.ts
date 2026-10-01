import '@/styles/builds.css';
import type { EventMap } from '@/core/events';
import type { Ctx, WandFrame } from '@/core/types';
import { WAND_FRAMES } from '@/combat/wands/wandCatalog';
import { displacedNames, previewRefit, type CycleView } from '@/combat/wands/wandFinds';
import { createModalFocusTrap, type ModalFocusTrap } from '@/ui/modalFocusTrap';

type WandOfferRequest = EventMap['wandOfferRequested'];

const NUMERAL = ['I', 'II'] as const;

const pct = (ratio: number): string => (Number.isFinite(ratio) ? Math.round(ratio * 100) + '%' : '—');

/** "Your cards: 2 casts a cycle, 0.65s → 0.37s. The tank runs dry in a long fight: it refills 61% of what a cycle spends." */
function cycleSentence(before: CycleView, after: CycleView): { text: string; thirsty: boolean } {
  if (before.groups === 0 && after.groups === 0) return { text: 'No cards seated here yet.', thirsty: false };
  const casts = (n: number): string => n + (n === 1 ? ' cast' : ' casts');
  let text = `Your cards: ${casts(after.groups)} a cycle, ${before.seconds.toFixed(2)}s → ${after.seconds.toFixed(2)}s.`;
  const thirsty = after.mana > 0 && after.sustain < 1;
  if (thirsty) {
    text += ` The tank runs dry in a long fight: it refills ${pct(after.sustain)} of what a cycle spends`;
    text += before.sustain >= 1 ? ' (it kept up before).' : ` (was ${pct(before.sustain)}).`;
  } else if (after.mana > 0) {
    text += before.sustain < 1 ? ' The tank keeps up now (it ran dry before).' : ' The tank keeps up.';
  }
  return { text, thirsty };
}

/**
 * A found wand frame, and the choice it asks (the one-in-three altar, a boss's wreckage, the Wandwright's
 * rack): refit wand I or wand II with it, or leave it. Each target shows the stat diff AND what the swap
 * would push out when the new frame has fewer slots — those cards go back to the satchel, named here
 * first, never silently trimmed. Same modal pattern as CardOfferOverlay: paused while it is up, the
 * prior pause state restored on close, offers queue.
 */
export class WandOfferOverlay {
  private readonly root: HTMLElement;
  private active: WandOfferRequest | null = null;
  private readonly queue: WandOfferRequest[] = [];
  private readonly focusTrap: ModalFocusTrap;
  private readonly offRequested: () => void;
  private wasPaused = false;

  constructor(private readonly ctx: Ctx) {
    this.root = document.createElement('div');
    this.root.id = 'wand-offer-overlay';
    this.root.className = 'wand-offer-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    document.body.appendChild(this.root);
    this.focusTrap = createModalFocusTrap(this.root, {
      onEscape: () => this.decline(),
      initialFocus: () => this.root.querySelector<HTMLButtonElement>('.wand-offer-target'),
    });
    this.offRequested = ctx.events.on('wandOfferRequested', (request) => this.open(request));
  }

  /** With one frame on offer, 1 / 2 refit wand I / II. */
  private readonly onKey = (event: KeyboardEvent): void => {
    const request = this.active;
    if (!request || event.repeat || request.frames.length !== 1) return;
    const wand = event.code === 'Digit1' ? 0 : event.code === 'Digit2' ? 1 : -1;
    if (wand < 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.choose(request.frames[0], wand as 0 | 1);
  };

  private open(request: WandOfferRequest): void {
    request.handled = true;
    if (this.active) {
      this.queue.push(request);
      return;
    }
    this.active = request;
    this.wasPaused = this.ctx.state.paused;
    this.ctx.state.paused = true;
    this.focusTrap.activate();
    window.addEventListener('keydown', this.onKey, true);
    this.render(request);
  }

  private render(request: WandOfferRequest): void {
    this.root.innerHTML = '';
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');

    const panel = document.createElement('div');
    panel.className = 'wand-offer-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', request.title);

    const title = document.createElement('h2');
    title.className = 'menu-title';
    title.textContent = request.title;
    panel.appendChild(title);
    const prompt = document.createElement('p');
    prompt.className = 'menu-sub';
    prompt.textContent = request.prompt ?? 'Refit wand I or II with it, or leave it where it lies.';
    panel.appendChild(prompt);

    const row = document.createElement('div');
    row.className = 'wand-offer-row';
    for (const id of request.frames) {
      const frame = WAND_FRAMES[id];
      if (frame) row.appendChild(this.makeFrame(frame));
    }
    panel.appendChild(row);

    const foot = document.createElement('div');
    foot.className = 'wand-offer-foot';
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'menu-btn wand-offer-leave';
    leave.textContent = 'Leave it';
    leave.addEventListener('click', () => this.decline());
    foot.appendChild(leave);
    const hint = document.createElement('span');
    hint.className = 'menu-sub';
    hint.innerHTML = request.frames.length === 1
      ? '<kbd class="key">1</kbd> wand I · <kbd class="key">2</kbd> wand II · <kbd class="key">Esc</kbd> leave it'
      : 'Choose a frame and a wand · <kbd class="key">Esc</kbd> leave them';
    foot.appendChild(hint);
    panel.appendChild(foot);

    this.root.appendChild(panel);
    window.setTimeout(() => {
      this.focusTrap.focusInitial(this.root.querySelector<HTMLButtonElement>('.wand-offer-target'));
    }, 0);
  }

  private makeFrame(frame: WandFrame): HTMLElement {
    const box = document.createElement('section');
    box.className = 'wand-offer-frame';
    box.dataset.wandOfferFrame = frame.id;

    const kind = document.createElement('div');
    kind.className = 'wand-offer-kind';
    // The blurb leads with the archetype ("Rapid. ...").
    const lead = /^([A-Z][a-z]+)\./.exec(frame.blurb ?? '');
    kind.textContent = lead ? lead[1] : frame.capacity + ' slots';
    const name = document.createElement('div');
    name.className = 'wand-offer-name';
    name.textContent = frame.name;
    const blurb = document.createElement('p');
    blurb.className = 'wand-offer-blurb';
    blurb.textContent = (frame.blurb ?? '').replace(/^[A-Z][a-z]+\.\s*/, '');
    box.append(kind, name, blurb);

    const targets = document.createElement('div');
    targets.className = 'wand-offer-targets';
    this.ctx.wands.wands.forEach((wand, i) => {
      const w = i as 0 | 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wand-offer-target';
      button.dataset.offerWand = String(w);
      button.dataset.offerFrame = frame.id;
      const same = wand.frame.id === frame.id;
      button.disabled = same;
      if (same) button.title = 'Already fitted to this wand';

      const preview = previewRefit(wand.cards, wand.frame, frame);
      const head = document.createElement('div');
      head.className = 'wand-offer-target-head';
      const numeral = document.createElement('span');
      numeral.className = 'wb-numeral';
      numeral.textContent = NUMERAL[i];
      const label = document.createElement('span');
      label.textContent = same ? `Wand ${NUMERAL[i]} already carries it` : `Refit wand ${NUMERAL[i]} (${wand.frame.name})`;
      head.append(numeral, label);
      button.appendChild(head);

      if (!same) {
        const stats = document.createElement('dl');
        stats.className = 'wand-offer-stats';
        for (const rowStat of preview.rows) {
          const dt = document.createElement('dt');
          dt.textContent = rowStat.label;
          const dd = document.createElement('dd');
          dd.className = rowStat.trend === 'same' ? '' : rowStat.trend;
          dd.textContent = rowStat.trend === 'same' ? rowStat.to : `${rowStat.from} → ${rowStat.to}`;
          stats.append(dt, dd);
        }
        button.appendChild(stats);

        const cycle = cycleSentence(preview.before, preview.after);
        const cycleLine = document.createElement('p');
        cycleLine.className = 'wand-offer-cycle' + (cycle.thirsty ? ' thirsty' : '');
        cycleLine.textContent = cycle.text;
        button.appendChild(cycleLine);

        const fit = document.createElement('p');
        fit.className = 'wand-offer-displaced' + (preview.displaced.length > 0 ? ' cost' : '');
        fit.textContent = preview.displaced.length > 0
          ? `Does not fit: ${displacedNames(preview.displaced)}. ${preview.displaced.length === 1 ? 'It goes' : 'They go'} back to your satchel.`
          : preview.shifted
            ? 'Your cards close up to fit. Nothing is lost.'
            : 'Every card fits where it is.';
        button.appendChild(fit);
        button.addEventListener('click', () => this.choose(frame.id, w));
      }
      targets.appendChild(button);
    });
    box.appendChild(targets);
    return box;
  }

  private choose(frameId: string, wand: 0 | 1): void {
    const request = this.active;
    if (!request) return;
    this.close();
    request.onChoose(frameId, wand);
    this.next();
  }

  private decline(): void {
    const request = this.active;
    if (!request) return;
    this.close();
    request.onDecline?.();
    this.next();
  }

  private close(): void {
    this.root.classList.remove('visible');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = '';
  }

  /** The next queued offer, or hand the pause back. */
  private next(): void {
    const queued = this.queue.shift();
    if (queued) {
      this.active = queued;
      this.ctx.state.paused = true;
      this.render(queued);
      return;
    }
    this.active = null;
    window.removeEventListener('keydown', this.onKey, true);
    this.focusTrap.deactivate();
    this.ctx.state.paused = this.wasPaused;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.offRequested();
    this.queue.length = 0;
    this.active = null;
    this.focusTrap.deactivate({ restoreFocus: false });
    this.root.remove();
  }
}
