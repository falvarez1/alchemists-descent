import type { Ctx, TrickshotSettings } from '@/core/types';
import { sanitizeTrickshot } from '@/config/trickshot';
import { DEFAULT_BINDINGS, getBindings, keyLabel, resetBindings, setBinding, type BindingAction } from '@/input/bindings';

export interface PlayerPreferences { textScale: number; reducedFlashes: boolean; cameraShake: boolean; highReadability: boolean; creatureCaptions: boolean; trickshot: TrickshotSettings }
const KEY = 'ad-player-preferences-v1';
export function readPlayerPreferences(): PlayerPreferences {
  const defaults = { textScale: 1, reducedFlashes: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, cameraShake: true };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PlayerPreferences>;
    return { textScale: [1, 1.15, 1.3].includes(saved.textScale ?? 0) ? saved.textScale! : 1,
      reducedFlashes: typeof saved.reducedFlashes === 'boolean' ? saved.reducedFlashes : defaults.reducedFlashes,
      cameraShake: saved.cameraShake !== false, highReadability: saved.highReadability === true, creatureCaptions: saved.creatureCaptions === true, trickshot: sanitizeTrickshot(saved.trickshot) };
  } catch { return { ...defaults, highReadability: false, creatureCaptions: false, trickshot: sanitizeTrickshot(null) }; }
}

export class PlayerSettings {
  private readonly dialog = document.createElement('dialog');
  private previousPause = false;
  private returnFocus: HTMLElement | null = null;
  private preferences = readPlayerPreferences();

  constructor(private readonly ctx: Ctx) {
    this.dialog.id = 'player-settings';
    this.dialog.setAttribute('aria-labelledby', 'player-settings-title');
    this.dialog.innerHTML = `<form method="dialog"><div class="settings-heading"><h2 id="player-settings-title">Make yourself at home</h2><button value="close" aria-label="Close settings">Close</button></div>
      <div class="settings-options"><label>Text size<select name="textScale"><option value="1">Standard</option><option value="1.15">Large</option><option value="1.3">Larger</option></select></label>
      <label><input type="checkbox" name="reducedFlashes"> Reduce flashes and pulses</label>
      <label><input type="checkbox" name="cameraShake"> Camera shake</label>
      <label><input type="checkbox" name="highReadability"> High-readability lighting</label>
      <label><input type="checkbox" name="creatureCaptions"> Creature sound captions</label></div>
      <fieldset class="trickshot-settings"><legend>Combat experiment</legend>
      <label><input type="checkbox" name="trickshotEnabled"> Trickshot combat</label>
      <p>Chain different enemies for a brief window of borrowed time. Take a Weaver's leg, then finish its weakened owner with it.</p>
      <div id="trickshot-tuning">
      <label>Slow-motion speed <output id="trickshot-timeScale"></output><input type="range" name="timeScale" min="0.2" max="0.8" step="0.05"></label>
      <label>Slow-motion duration <output id="trickshot-durationMs"></output><input type="range" name="durationMs" min="300" max="1200" step="100"></label>
      <label>Chain window <output id="trickshot-chainWindowMs"></output><input type="range" name="chainWindowMs" min="1200" max="4500" step="100"></label>
      <label>Aim assistance <output id="trickshot-assistDegrees"></output><input type="range" name="assistDegrees" min="0" max="8" step="1"></label>
      <p>An assisted lock steadies single shots. The guide marks first contact; a wider ring shows spread, a broken ring marks uncertain follow-through. Seeking spells and streams keep free aim.</p></div></fieldset>
      <h3>Keyboard</h3><p>Choose an action, then press its new key. Mouse aims; left click casts; right click throws a flask.</p>
      <div class="binding-list"></div><p id="binding-feedback" role="status"></p>
      <button type="button" id="reset-controls">Restore controls</button>
      <p class="controller-help">Controller: left stick moves, right stick aims; A jumps, RT casts, LT pours, RB throws a flask, LB throws a glowseed, X interacts, Y switches wands, B crouches. Start pauses.</p></form>`;
    document.getElementById('canvas-holder')!.appendChild(this.dialog);
    this.dialog.addEventListener('close', () => {
      // Native close events are queued. Escape/Resume may already have released
      // the owning overlay by the time this callback runs.
      ctx.state.paused = this.previousPause && Boolean(document.querySelector('#pause-overlay.visible, #expedition-entry:not([hidden])'));
      if (this.returnFocus?.checkVisibility()) this.returnFocus.focus();
    });
    this.dialog.querySelector('[name="textScale"]')!.addEventListener('change', e => {
      this.preferences.textScale = Number((e.target as HTMLSelectElement).value); this.apply(true);
    });
    for (const name of ['reducedFlashes', 'cameraShake', 'highReadability', 'creatureCaptions'] as const) {
      this.dialog.querySelector(`[name="${name}"]`)!.addEventListener('change', e => {
        this.preferences[name] = (e.target as HTMLInputElement).checked; this.apply(true);
      });
    }
    this.dialog.querySelector('#reset-controls')!.addEventListener('click', () => { resetBindings(); this.renderBindings(); });
    this.dialog.querySelector('[name="trickshotEnabled"]')!.addEventListener('change', e => {
      this.preferences.trickshot.enabled = (e.target as HTMLInputElement).checked; this.apply(true);
    });
    for (const name of ['timeScale', 'durationMs', 'chainWindowMs', 'assistDegrees'] as const) {
      this.dialog.querySelector(`[name="${name}"]`)!.addEventListener('input', e => {
        this.preferences.trickshot[name] = Number((e.target as HTMLInputElement).value); this.apply(true);
      });
    }
    this.renderBindings(); this.apply();
    const pause = document.createElement('button');
    pause.id = 'pause-settings'; pause.textContent = 'Controls & comfort'; pause.type = 'button';
    pause.addEventListener('click', () => this.open());
    document.querySelector('.pause-actions')?.appendChild(pause);
  }

  private renderBindings(): void {
    const root = this.dialog.querySelector('.binding-list')!;
    root.replaceChildren();
    const bindings = getBindings();
    for (const action of Object.keys(DEFAULT_BINDINGS) as BindingAction[]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<span>${action === 'lure' ? 'Glowseed' : action}</span><kbd>${keyLabel(bindings[action])}</kbd>`;
      button.setAttribute('aria-label', `Change ${action}: ${keyLabel(bindings[action])}`);
      button.addEventListener('click', () => {
        button.classList.add('listening');
        button.querySelector('kbd')!.textContent = 'Press a key';
        button.onkeydown = event => {
          event.preventDefault(); event.stopPropagation();
          if (event.code === 'Escape') { this.renderBindings(); return; }
          const message = setBinding(action, event.code);
          this.dialog.querySelector('#binding-feedback')!.textContent = message ?? `${action} is now ${keyLabel(event.code)}.`;
          if (!message) this.renderBindings();
        };
      });
      root.appendChild(button);
    }
  }

  private apply(persist = false): void {
    document.documentElement.style.setProperty('--text-scale', String(this.preferences.textScale));
    document.body.classList.toggle('reduce-flashes', this.preferences.reducedFlashes);
    const fx = this.ctx.state.postFx;
    fx.hurtPulse = this.preferences.reducedFlashes ? 0.08 : 0.4;
    fx.bloomKickScale = this.preferences.reducedFlashes ? 0 : 0.35;
    this.ctx.state.reduceCameraShake = !this.preferences.cameraShake;
    this.ctx.state.reduceFlashes = this.preferences.reducedFlashes;
    this.ctx.state.highReadability = this.preferences.highReadability;
    this.ctx.state.creatureCaptions = this.preferences.creatureCaptions;
    this.ctx.state.trickshot = { ...this.preferences.trickshot };
    if (!this.preferences.trickshot.enabled) this.ctx.fx.trickshot = undefined;
    (this.dialog.querySelector('[name="trickshotEnabled"]') as HTMLInputElement).checked = this.preferences.trickshot.enabled;
    (this.dialog.querySelector('#trickshot-tuning') as HTMLElement).hidden = !this.preferences.trickshot.enabled;
    for (const name of ['timeScale', 'durationMs', 'chainWindowMs', 'assistDegrees'] as const) {
      const value = this.preferences.trickshot[name];
      (this.dialog.querySelector(`[name="${name}"]`) as HTMLInputElement).value = String(value);
      this.dialog.querySelector(`#trickshot-${name}`)!.textContent = name === 'timeScale' ? `${Math.round(value * 100)}%` : name === 'assistDegrees' ? `${value}°` : `${(value / 1000).toFixed(1)}s`;
    }
    (this.dialog.querySelector('[name="textScale"]') as HTMLSelectElement).value = String(this.preferences.textScale);
    for (const name of ['reducedFlashes', 'cameraShake', 'highReadability', 'creatureCaptions'] as const) {
      (this.dialog.querySelector(`[name="${name}"]`) as HTMLInputElement).checked = this.preferences[name];
    }
    if (persist) try { localStorage.setItem(KEY, JSON.stringify(this.preferences)); } catch {
      this.dialog.querySelector('#binding-feedback')!.textContent = 'Preferences apply for this session. Local storage is unavailable.';
    }
  }

  open(): void {
    if (this.dialog.open) return;
    this.previousPause = this.ctx.state.paused;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.ctx.state.paused = true;
    this.dialog.showModal();
  }

  dispose(): void { this.dialog.remove(); document.getElementById('pause-settings')?.remove(); }
}
