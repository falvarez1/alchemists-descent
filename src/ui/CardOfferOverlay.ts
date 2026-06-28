import { CARD_DEFS } from '@/combat/wands/cards';
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

    const title = document.createElement('div');
    title.className = 'card-offer-title';
    title.textContent = request.title;
    panel.appendChild(title);

    if (request.prompt) {
      const prompt = document.createElement('div');
      prompt.className = 'card-offer-prompt';
      prompt.textContent = request.prompt;
      panel.appendChild(prompt);
    }

    const row = document.createElement('div');
    row.className = 'card-offer-row';
    for (const card of request.cards) row.appendChild(this.makeCardButton(card));
    panel.appendChild(row);
    this.root.appendChild(panel);

    window.setTimeout(() => {
      this.focusTrap.focusInitial(this.root.querySelector<HTMLButtonElement>('.card-offer-card'));
    }, 0);
  }

  private makeCardButton(id: CardId): HTMLElement {
    const def = CARD_DEFS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-offer-card';
    button.dataset.cardOfferId = id;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'card-offer-icon';
    const icon = makeIconCanvas(cardIconName(id), 4);
    if (icon) iconWrap.appendChild(icon);
    button.appendChild(iconWrap);

    const name = document.createElement('div');
    name.className = 'card-offer-name';
    name.textContent = def.name;
    button.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'card-offer-meta';
    meta.textContent = def.kind.toUpperCase() + ' - ' + def.manaCost + ' MANA';
    button.appendChild(meta);

    const tags = document.createElement('div');
    tags.className = 'card-offer-tags';
    tags.textContent = def.tags.join(' / ');
    button.appendChild(tags);

    const blurb = document.createElement('div');
    blurb.className = 'card-offer-blurb';
    blurb.textContent = def.blurb;
    button.appendChild(blurb);

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
    this.focusTrap.deactivate();
    this.ctx.state.paused = this.wasPaused;
  }

  dispose(): void {
    this.offCardOfferRequested();
    this.queue.length = 0;
    this.active = null;
    this.focusTrap.deactivate({ restoreFocus: false });
    this.root.remove();
  }
}
