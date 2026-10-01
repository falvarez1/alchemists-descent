import '@/styles/builds.css';
import { CARD_DEFS } from '@/combat/wands/cards';
import { makeFitter, type CardFit } from '@/combat/wands/cardFit';
import type { EventMap } from '@/core/events';
import type { CardId, Ctx } from '@/core/types';
import { cardIconName, makeIconCanvas } from '@/ui/icons';
import { createModalFocusTrap, type ModalFocusTrap } from '@/ui/modalFocusTrap';

type CardOfferRequest = EventMap['cardOfferRequested'];

export class CardOfferOverlay {
  private readonly root: HTMLElement;
  private active: CardOfferRequest | null = null;
  private readonly queue: CardOfferRequest[] = [];
  private readonly focusTrap: ModalFocusTrap;
  private readonly offCardOfferRequested: () => void;
  private wasPaused = false;

  constructor(private readonly ctx: Ctx) {
    this.root = document.createElement('div');
    this.root.id = 'card-offer-overlay';
    this.root.className = 'card-offer-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    document.body.appendChild(this.root);
    this.focusTrap = createModalFocusTrap(this.root, {
      initialFocus: () => this.root.querySelector<HTMLButtonElement>('.card-offer-card'),
    });

    this.offCardOfferRequested = ctx.events.on('cardOfferRequested', (request) => this.open(request));
  }

  /** 1 / 2 / 3 pick the matching card while an offer is up. */
  private readonly onKey = (event: KeyboardEvent): void => {
    const request = this.active;
    if (!request || event.repeat) return;
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (!digit) return;
    const card = request.cards[Number(digit[1]) - 1];
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    this.choose(card);
  };

  private open(request: CardOfferRequest): void {
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

  private render(request: CardOfferRequest): void {
    this.root.innerHTML = '';
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');

    const panel = document.createElement('div');
    panel.className = 'card-offer-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', request.title);

    const title = document.createElement('h2');
    title.className = 'card-offer-title menu-title';
    title.textContent = request.title;
    panel.appendChild(title);

    const prompt = document.createElement('p');
    prompt.className = 'card-offer-prompt menu-sub';
    prompt.textContent = request.prompt ?? 'Choose one spell card to keep.';
    panel.appendChild(prompt);

    const row = document.createElement('div');
    row.className = 'card-offer-row';
    // The fit tell on every tile: what this card would do in the wands you carry right now.
    const fitter = makeFitter(this.ctx.wands);
    request.cards.forEach((card, index) => row.appendChild(this.makeCardButton(card, index, fitter.fit(card), request.labels?.[index])));
    panel.appendChild(row);

    const note = document.createElement('p');
    note.className = 'card-offer-note';
    note.innerHTML = request.source === 'tome'
      ? 'The card joins your collection. Seat it in a wand at the bench <kbd class="key">B</kbd>'
      : 'The card joins your collection; seat it at the bench <kbd class="key">B</kbd>';
    panel.appendChild(note);
    this.root.appendChild(panel);

    window.setTimeout(() => {
      this.focusTrap.focusInitial(this.root.querySelector<HTMLButtonElement>('.card-offer-card'));
    }, 0);
  }

  private makeCardButton(id: CardId, index: number, fit: CardFit, label?: string): HTMLElement {
    const def = CARD_DEFS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-offer-card' + (def.bargain ? ' bargain' : '') + ' fit-' + fit.verdict;
    button.dataset.cardOfferId = id;
    button.dataset.cardFit = fit.verdict;
    if (label) button.dataset.cardOfferRole = label;

    const key = document.createElement('kbd');
    key.className = 'key card-offer-key';
    key.textContent = String(index + 1);
    key.setAttribute('aria-hidden', 'true');
    button.appendChild(key);

    const iconWrap = document.createElement('div');
    iconWrap.className = 'card-offer-icon';
    const icon = makeIconCanvas(cardIconName(id), 4);
    if (icon) iconWrap.appendChild(icon);
    button.appendChild(iconWrap);

    // An altar's three differ on purpose: the kicker says how.
    if (label) {
      const kicker = document.createElement('div');
      kicker.className = 'card-offer-kicker';
      kicker.textContent = label;
      button.appendChild(kicker);
    }

    const name = document.createElement('div');
    name.className = 'card-offer-name';
    name.textContent = def.name;
    button.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'card-offer-meta';
    meta.textContent = def.kind.toUpperCase() + ' - ' + def.manaCost + ' MANA';
    button.appendChild(meta);

    const blurb = document.createElement('div');
    blurb.className = 'card-offer-blurb';
    blurb.textContent = def.blurb;
    button.appendChild(blurb);

    // A devil's bargain wears its price on its face.
    if (def.cost) {
      const cost = document.createElement('div');
      cost.className = 'card-offer-cost';
      const label = document.createElement('b');
      label.textContent = 'Price';
      cost.append(label, ' ' + def.cost);
      button.appendChild(cost);
    }

    if (fit.line || fit.note) {
      const fitBox = document.createElement('div');
      fitBox.className = 'card-offer-fit';
      if (fit.line) {
        const line = document.createElement('div');
        line.className = 'card-offer-fit-line';
        line.textContent = fit.line;
        fitBox.appendChild(line);
      }
      if (fit.note) {
        const note = document.createElement('div');
        note.className = 'card-offer-fit-note';
        note.textContent = fit.note;
        fitBox.appendChild(note);
      }
      button.appendChild(fitBox);
    }

    const tags = document.createElement('div');
    tags.className = 'card-offer-tags';
    for (const tag of def.tags) {
      const chip = document.createElement('span');
      chip.textContent = tag;
      if (tag === 'Bargain') chip.className = 'tag-bargain';
      tags.appendChild(chip);
    }
    button.appendChild(tags);

    button.addEventListener('click', () => this.choose(id));
    return button;
  }

  private choose(id: CardId): void {
    const request = this.active;
    if (!request) return;
    this.root.classList.remove('visible');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = '';
    request.onChoose(id);
    const next = this.queue.shift();
    if (next) {
      this.active = next;
      this.ctx.state.paused = true;
      this.render(next);
      return;
    }
    this.active = null;
    window.removeEventListener('keydown', this.onKey, true);
    this.focusTrap.deactivate();
    this.ctx.state.paused = this.wasPaused;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.offCardOfferRequested();
    this.queue.length = 0;
    this.active = null;
    this.focusTrap.deactivate({ restoreFocus: false });
    this.root.remove();
  }
}
