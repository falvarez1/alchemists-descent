import type { Ctx } from '@/core/types';
import { getBindings, keyLabel } from '@/input/bindings';

/** The scene keeps moving. Only the player's controls are yielded to the camera. */
export class TeaMachineOverlay {
  private readonly root = document.createElement('section');
  private readonly disposeView: () => void;
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && this.ctx.contraption?.watching) {
      event.preventDefault(); event.stopImmediatePropagation(); this.ctx.contraption.skip();
    }
  };

  constructor(private readonly ctx: Ctx) {
    this.root.id = 'tea-view'; this.root.hidden = true;
    this.root.innerHTML = '<div class="tea-caption"><strong></strong><p></p></div><button type="button">Return to player <kbd>Esc</kbd></button>';
    this.root.querySelector('strong')!.setAttribute('aria-live', 'polite');
    const button = this.root.querySelector('button')!;
    button.addEventListener('click', () => ctx.contraption?.skip());
    document.getElementById('canvas-holder')!.append(this.root);
    this.disposeView = ctx.events.on('contraptionView', view => {
      this.root.hidden = !view.visible;
      this.root.classList.toggle('watching', view.watching);
      this.root.querySelector('strong')!.textContent = view.title;
      const use = `Press ${keyLabel(getBindings().interact)}`;
      this.root.querySelector('p')!.textContent = view.watching ? view.detail : view.stalled
        ? `${use} at the crank to recharge the engine.` : view.stage === 0
          ? `${use} at the crank. The engine makes the bell that opens the descent.` : view.detail;
      button.hidden = !view.watching;
      document.getElementById('canvas-holder')!.classList.toggle('tea-camera', view.watching);
    });
    window.addEventListener('keydown', this.onKey, true);
  }

  dispose(): void {
    this.disposeView(); window.removeEventListener('keydown', this.onKey, true); this.root.remove();
    document.getElementById('canvas-holder')?.classList.remove('tea-camera');
  }
}
