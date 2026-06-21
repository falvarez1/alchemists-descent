import { CARD_DEFS } from '@/combat/wands/cards';
import type { EventMap } from '@/core/events';
import type { Ctx } from '@/core/types';
import { createModalFocusTrap, type ModalFocusTrap } from '@/ui/modalFocusTrap';

type WaystonePromptRequest = EventMap['waystonePrompt'];

/**
 * A small modal raised when the player walks up to an unlit waystone. If they
 * own a fire spell that isn't on the active wand it offers to seat it (so they
 * can light the bowl); otherwise it explains how to carry fire there by hand.
 * Mirrors CardOfferOverlay: pauses the game, restores on close, owns its DOM.
 */
export class WaystonePromptOverlay {
  private readonly root: HTMLElement;
  private active: WaystonePromptRequest | null = null;
  private readonly focusTrap: ModalFocusTrap;
  private wasPaused = false;

  constructor(private readonly ctx: Ctx) {
    this.root = document.createElement('div');
    this.root.id = 'waystone-prompt-overlay';
    this.root.className = 'waystone-prompt-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    document.body.appendChild(this.root);
    this.focusTrap = createModalFocusTrap(this.root, {
      initialFocus: () => this.root.querySelector<HTMLButtonElement>('.waystone-prompt-btn'),
      onEscape: () => this.close('dismiss'),
    });

    ctx.events.on('waystonePrompt', (request) => this.open(request));
  }

  private open(request: WaystonePromptRequest): void {
    if (this.active) return;
    this.active = request;
    this.wasPaused = this.ctx.state.paused;
    this.ctx.state.paused = true;
    this.focusTrap.activate();
    this.render(request);
  }

  private render(request: WaystonePromptRequest): void {
    this.root.innerHTML = '';
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');

    const panel = document.createElement('div');
    panel.className = 'waystone-prompt-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Waystone');

    const title = document.createElement('div');
    title.className = 'waystone-prompt-title';
    title.textContent = 'WAYSTONE';
    panel.appendChild(title);

    const body = document.createElement('div');
    body.className = 'waystone-prompt-body';

    const row = document.createElement('div');
    row.className = 'waystone-prompt-actions';

    if (request.card) {
      const name = CARD_DEFS[request.card].name;
      body.textContent =
        'This checkpoint lights when you fill the stone bowl at its base with fire. You carry the ' +
        name +
        ' card — seat it on your wand, then hold its flame on the bowl until the brazier catches? This replaces the wand’s current spells.';
      row.appendChild(this.button('EQUIP ' + name.toUpperCase(), true, () => this.close('equip')));
      row.appendChild(this.button('NOT NOW', false, () => this.close('dismiss')));
    } else {
      body.textContent =
        'This checkpoint lights when you fill the stone bowl at its base with fire, but your wand can’t make fire yet. Bring fire to it: siphon lava with the flask (E) and pour it into the bowl (Q), push something burning onto it, or find a fire spell card.';
      row.appendChild(this.button('GOT IT', true, () => this.close('dismiss')));
    }

    panel.appendChild(body);
    panel.appendChild(row);
    this.root.appendChild(panel);

    window.setTimeout(() => {
      this.focusTrap.focusInitial(this.root.querySelector<HTMLButtonElement>('.waystone-prompt-btn'));
    }, 0);
  }

  private button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'waystone-prompt-btn' + (primary ? ' primary' : '');
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private close(action: 'equip' | 'dismiss'): void {
    const request = this.active;
    if (!request) return;
    this.active = null;
    this.root.classList.remove('visible');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = '';
    this.focusTrap.deactivate();
    this.ctx.state.paused = this.wasPaused;
    if (action === 'equip') request.onEquip();
    else request.onDismiss();
  }

  dispose(): void {
    this.active = null;
    this.focusTrap.deactivate({ restoreFocus: false });
    this.root.remove();
  }
}
