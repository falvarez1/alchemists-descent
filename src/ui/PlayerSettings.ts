import type { Ctx, TrickshotSettings, VolumeChannel } from '@/core/types';
import { sanitizeTrickshot } from '@/config/trickshot';
import { sanitizeVolumes, type VolumeSettings } from '@/audio/mix';
import { DEFAULT_BINDINGS, getBindings, keyLabel, resetBindings, setBinding, type BindingAction } from '@/input/bindings';
import { isClipRecordingEnabled, setClipRecordingEnabled } from '@/config/clipSettings';

export interface PlayerPreferences { textScale: number; reducedFlashes: boolean; cameraShake: boolean; highReadability: boolean; creatureCaptions: boolean; trickshot: TrickshotSettings; volume: VolumeSettings }
const KEY = 'ad-player-preferences-v1';
const VOLUME_CHANNELS: readonly VolumeChannel[] = ['master', 'effects', 'ambience'];

/**
 * Only the Trickshot switches are player-facing. Its timing numbers (slow-motion
 * speed, windows, aim assist, impact pause) always come from the tuned defaults
 * in config/trickshot.ts, so an old saved slider value cannot outlive the sliders.
 */
function playerTrickshot(saved: unknown): TrickshotSettings {
  const chosen = sanitizeTrickshot(saved as Partial<TrickshotSettings> | null);
  return { ...sanitizeTrickshot(null), enabled: chosen.enabled, finisher: chosen.finisher, cameraMotion: chosen.cameraMotion };
}

export function readPlayerPreferences(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): PlayerPreferences {
  const defaults = { textScale: 1, reducedFlashes: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, cameraShake: true };
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? '{}') as Partial<PlayerPreferences>;
    return { textScale: [1, 1.15, 1.3].includes(saved.textScale ?? 0) ? saved.textScale! : 1,
      reducedFlashes: typeof saved.reducedFlashes === 'boolean' ? saved.reducedFlashes : defaults.reducedFlashes,
      cameraShake: saved.cameraShake !== false, highReadability: saved.highReadability === true, creatureCaptions: saved.creatureCaptions === true,
      trickshot: playerTrickshot(saved.trickshot), volume: sanitizeVolumes(saved.volume) };
  } catch { return { ...defaults, highReadability: false, creatureCaptions: false, trickshot: playerTrickshot(null), volume: sanitizeVolumes(null) }; }
}

export class PlayerSettings {
  private readonly dialog = document.createElement('dialog');
  private previousPause = false;
  private returnFocus: HTMLElement | null = null;
  private preferences = readPlayerPreferences();

  constructor(private readonly ctx: Ctx) {
    this.dialog.id = 'player-settings';
    this.dialog.setAttribute('aria-labelledby', 'player-settings-title');
    this.dialog.innerHTML = `<form method="dialog"><div class="settings-heading"><h2 id="player-settings-title">Make yourself at home</h2><button value="close" class="menu-close" aria-label="Close settings"><kbd class="key">Esc</kbd>Close</button></div>
      <h3>Sound</h3><div class="settings-options settings-volume">
      <label>Master<input type="range" name="volume-master" min="0" max="100" step="1"><output id="volume-master-value"></output></label>
      <label>Effects<input type="range" name="volume-effects" min="0" max="100" step="1"><output id="volume-effects-value"></output></label>
      <label>Ambience<input type="range" name="volume-ambience" min="0" max="100" step="1"><output id="volume-ambience-value"></output></label></div>
      <h3>Comfort</h3><div class="settings-options"><label>Text size<select name="textScale"><option value="1">Standard</option><option value="1.15">Large</option><option value="1.3">Larger</option></select></label>
      <label><input type="checkbox" name="reducedFlashes"> Reduce flashes and pulses</label>
      <label><input type="checkbox" name="cameraShake"> Camera shake</label>
      <label><input type="checkbox" name="highReadability"> High-readability lighting</label>
      <label><input type="checkbox" name="creatureCaptions"> Creature sound captions</label>
      <label><input type="checkbox" name="recordClips"> Record clips (keeps the last ten seconds, ready to save as a GIF)</label></div>
      <fieldset class="trickshot-settings"><legend>Combat experiment</legend>
      <label><input type="checkbox" name="trickshotEnabled"> Trickshot combat</label>
      <p>Chain different enemies for a brief window of borrowed time. Take a Weaver's leg, then finish its weakened owner with it.</p>
      <div id="trickshot-tuning">
      <p>An assisted lock steadies single shots. The guide marks first contact; a wider ring shows spread, a broken ring marks uncertain follow-through. Seeking spells and streams keep free aim.</p>
      <label><input type="checkbox" name="finisher"> Humiliation finisher</label>
      <p>With a Weaver's own leg in hand and its owner wounded, the swing slows as it closes, and only a real hit ends it. A miss just costs the moment.</p>
      <label><input type="checkbox" name="cameraMotion"> Camera leans in during the finisher</label></div></fieldset>
      <h3>Keyboard</h3><p>Choose an action, then press its new key. Mouse aims; left click casts; right click throws a flask. With a Weaver leg equipped: left click whips, right click throws the leg, and Carry drops it.</p>
      <div class="binding-list"></div><p id="binding-feedback" role="status"></p>
      <button type="button" id="reset-controls">Restore controls</button>
      <h3>Controller</h3><p class="controller-help">Controller: left stick moves, right stick aims; A jumps, RT casts, LT pours, RB throws a flask, LB throws a glowseed, X interacts, Y switches wands, B crouches. With a Weaver leg: RT whips, RB throws it, LB drops it. Start pauses; View saves a clip.</p></form>`;
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
    // Clips keep their own preference (config/clipSettings) so app/Clips never imports this dialog.
    const recordClips = this.dialog.querySelector<HTMLInputElement>('[name="recordClips"]')!;
    recordClips.checked = isClipRecordingEnabled();
    recordClips.addEventListener('change', () => {
      if (!setClipRecordingEnabled(recordClips.checked)) this.dialog.querySelector('#binding-feedback')!.textContent = 'Preferences apply for this session. Local storage is unavailable.';
    });
    this.dialog.querySelector('[name="trickshotEnabled"]')!.addEventListener('change', e => {
      this.preferences.trickshot.enabled = (e.target as HTMLInputElement).checked; this.apply(true);
    });
    // Volume: applied live while dragging, saved on release. Each slider plays
    // a small cue through the bus it controls, so you hear the level you chose.
    const preview: Record<VolumeChannel, () => void> = {
      master: () => ctx.audio.pickup(),
      effects: () => ctx.audio.cardSlot(),
      ambience: () => ctx.audio.drip(),
    };
    for (const channel of VOLUME_CHANNELS) {
      const input = this.dialog.querySelector<HTMLInputElement>(`[name="volume-${channel}"]`)!;
      input.addEventListener('input', () => {
        this.preferences.volume[channel] = Number(input.value) / 100; this.apply();
        ctx.audio.ensure(); preview[channel]();
      });
      input.addEventListener('change', () => this.apply(true));
    }
    for (const name of ['finisher', 'cameraMotion'] as const) {
      this.dialog.querySelector(`[name="${name}"]`)!.addEventListener('change', e => {
        this.preferences.trickshot[name] = (e.target as HTMLInputElement).checked; this.apply(true);
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
      button.innerHTML = `<span>${action === 'lure' ? 'Glowseed' : action === 'clip' ? 'Save clip' : action}</span><kbd>${keyLabel(bindings[action])}</kbd>`;
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
    for (const channel of VOLUME_CHANNELS) {
      const percent = Math.round(this.preferences.volume[channel] * 100);
      this.ctx.audio.setVolume(channel, this.preferences.volume[channel]);
      const slider = this.dialog.querySelector(`[name="volume-${channel}"]`) as HTMLInputElement;
      slider.value = String(percent);
      slider.style.setProperty('--fill', `${percent}%`);
      this.dialog.querySelector(`#volume-${channel}-value`)!.textContent = percent === 0 ? 'Off' : `${percent}%`;
    }
    for (const name of ['finisher', 'cameraMotion'] as const) {
      (this.dialog.querySelector(`[name="${name}"]`) as HTMLInputElement).checked = this.preferences.trickshot[name];
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
