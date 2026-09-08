import type { Ctx } from '@/core/types';
import { PlayerSettings } from '@/ui/PlayerSettings';
import { appDialog } from '@/ui/AppDialog';

/** The player entrance. The advanced run launcher remains a workshop tool. */
export class ExpeditionEntry {
  private readonly root = document.createElement('section');
  private readonly settings: PlayerSettings;
  private readonly disposers: Array<() => void> = [];
  private launching = false;

  constructor(private readonly ctx: Ctx) {
    this.settings = new PlayerSettings(ctx);
    this.root.id = 'expedition-entry';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'expedition-title');
    this.root.innerHTML = `<div class="entry-scene" aria-hidden="true"></div><div class="entry-content">
      <h1 id="expedition-title">Alchemist’s<br><em>Descent</em></h1>
      <p>Something is alive in the old refinery.<br>Listen. Experiment. Find your way down.</p>
      <nav aria-label="Expedition"><button type="button" data-entry="continue" hidden>Continue your descent</button>
      <button type="button" data-entry="begin">Begin the descent</button>
      <button type="button" data-entry="settings">Controls & comfort</button></nav>
      <p class="entry-status" role="status"></p>
      <details class="entry-workshops"><summary>Workshops</summary><div><button type="button" data-entry="sandbox">Material sandbox</button><button type="button" data-entry="builder">Level builder</button><button type="button" data-entry="advanced">Advanced run setup</button></div></details>
      </div><div class="entry-footer"><span class="entry-release">The Breathing Works <b aria-label="Game version ${__APP_VERSION__}">v${__APP_VERSION__}</b></span><span>Keyboard + mouse / controller</span></div>`;
    document.getElementById('canvas-holder')!.appendChild(this.root);
    this.root.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-entry]');
      if (!button) return;
      const action = button.dataset.entry;
      if (action === 'settings') this.settings.open();
      else if (action === 'begin' || action === 'continue') void this.launch(action === 'continue');
      else if (action === 'sandbox' || action === 'builder') {
        this.hide(); ctx.state.paused = false;
        document.getElementById(action === 'builder' ? 'mode-builder-btn' : 'mode-build-btn')?.click();
      } else if (action === 'advanced') {
        this.hide(); ctx.state.paused = false;
        window.dispatchEvent(new CustomEvent('run-launcher-request', { detail: { source: 'play-button' } }));
      }
    });
    this.disposers.push(ctx.events.on('modeChanged', ({ mode }) => { if (mode === 'play') this.hide(); }));
    if (!__AUTHORING__) this.root.querySelector('.entry-workshops')?.remove();
  }

  show(): void {
    if (document.body.classList.contains('builder-open') || this.ctx.state.mode === 'play') return;
    this.ctx.state.paused = true;
    this.root.hidden = false;
    document.body.classList.add('entry-active');
    const saved = this.ctx.levels.hasSavedExpedition();
    this.root.querySelector<HTMLButtonElement>('[data-entry="continue"]')!.hidden = !saved;
    this.root.querySelector<HTMLButtonElement>('[data-entry="begin"]')!.textContent = saved ? 'Start a new expedition' : 'Begin the descent';
    this.root.querySelector<HTMLButtonElement>(saved ? '[data-entry="continue"]' : '[data-entry="begin"]')?.focus();
  }

  private hide(): void { this.root.hidden = true; document.body.classList.remove('entry-active'); }

  private async launch(continuing: boolean): Promise<void> {
    if (this.launching) return;
    if (!continuing && this.ctx.levels.hasSavedExpedition()) {
      const agreed = await appDialog.confirm('Start a new expedition? Your current descent will be replaced.', {
        title: 'A new descent', confirmText: 'Begin anew', tone: 'danger',
      });
      if (!agreed) return;
    }
    this.launching = true;
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) button.disabled = true;
    this.root.querySelector('.entry-status')!.textContent = continuing ? 'Returning to the Works…' : 'Opening the intake…';
    this.ctx.audio.ensure();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      const started = this.ctx.levels.startRun(this.ctx, { mode: 'normal', worldSource: 'campaign', continueSave: continuing, loadout: 'fresh' });
      if (started.ok) { this.hide(); this.ctx.state.paused = false; }
      else this.root.querySelector('.entry-status')!.textContent = started.message;
    } catch (error) {
      this.root.querySelector('.entry-status')!.textContent = `The descent could not open. ${error instanceof Error ? error.message : 'Try again.'}`;
    } finally {
      this.launching = false;
      for (const button of buttons) button.disabled = false;
    }
  }

  dispose(): void { for (const dispose of this.disposers) dispose(); this.settings.dispose(); this.root.remove(); }
}
