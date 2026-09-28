import type { Ctx, TrickshotSettings, VolumeChannel } from '@/core/types';
import { sanitizeTrickshot } from '@/config/trickshot';
import { VOLUME_CHANNELS, sanitizeVolumes, type VolumeSettings } from '@/audio/mix';
import { DEFAULT_BINDINGS, getBindings, keyLabel, resetBindings, setBinding, type BindingAction } from '@/input/bindings';
import { isClipRecordingEnabled, setClipRecordingEnabled } from '@/config/clipSettings';
import { SoundQuickControl } from '@/ui/SoundQuickControl';

export interface PlayerPreferences { textScale: number; reducedFlashes: boolean; cameraShake: boolean; highReadability: boolean; creatureCaptions: boolean; trickshot: TrickshotSettings; volume: VolumeSettings; narration: boolean; muted: boolean }
const KEY = 'ad-player-preferences-v1';

/** What each rebindable action is called on the keyboard list (sentence case). */
export const BINDING_LABELS: Readonly<Record<BindingAction, string>> = {
  left: 'Move left', right: 'Move right', up: 'Up (climb)', down: 'Down (crouch, climb)',
  jump: 'Jump / levitate', climb: 'Grab a wall', interact: 'Interact / lift / siphon', pour: 'Pour',
  drink: 'Drink', kick: 'Kick / hurl', carry: 'Swing on vines / carry', lure: 'Throw a glowseed', clip: 'Save a clip', mute: 'Mute all sound',
  lantern: 'Hood the lantern',
};

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
      trickshot: playerTrickshot(saved.trickshot), volume: sanitizeVolumes(saved.volume), narration: saved.narration !== false,
      muted: saved.muted === true };
  } catch { return { ...defaults, highReadability: false, creatureCaptions: false, trickshot: playerTrickshot(null), volume: sanitizeVolumes(null), narration: true, muted: false }; }
}

export class PlayerSettings {
  private readonly dialog = document.createElement('dialog');
  private previousPause = false;
  private returnFocus: HTMLElement | null = null;
  private preferences = readPlayerPreferences();
  private readonly quick: SoundQuickControl;

  constructor(private readonly ctx: Ctx) {
    this.dialog.id = 'player-settings';
    this.dialog.setAttribute('aria-labelledby', 'player-settings-title');
    const clipKey = keyLabel(getBindings().clip);
    // Grouped the way a player looks for them: what they hear, what they see,
    // how fights feel, clips, then the keys. Every combat option is reachable
    // on its own: the finisher does not live inside the Trickshot experiment.
    this.dialog.innerHTML = `<form method="dialog"><div class="settings-heading"><h2 id="player-settings-title">Make yourself at home</h2><button value="close" class="menu-close" aria-label="Close settings"><kbd class="key">Esc</kbd>Close</button></div>
      <section class="settings-group" aria-labelledby="settings-sound"><h3 id="settings-sound">Sound</h3>
      <div class="settings-options"><label><input type="checkbox" name="muted"> Mute all sound <kbd class="key" data-mute-key>${keyLabel(getBindings().mute)}</kbd></label></div><div class="settings-options settings-volume">
      <label>Master<input type="range" name="volume-master" min="0" max="100" step="1"><output id="volume-master-value"></output></label>
      <label>Effects<input type="range" name="volume-effects" min="0" max="100" step="1"><output id="volume-effects-value"></output></label>
      <label>Ambience<input type="range" name="volume-ambience" min="0" max="100" step="1"><output id="volume-ambience-value"></output></label>
      <label>Music<input type="range" name="volume-music" min="0" max="100" step="1"><output id="volume-music-value"></output></label>
      <label>Voice<input type="range" name="volume-voice" min="0" max="100" step="1"><output id="volume-voice-value"></output></label></div>
      <div class="settings-options"><div class="settings-option"><label><input type="checkbox" name="narration"> Narration</label>
      <p class="settings-note">An old docent of the Works reads the moments worth reading aloud. Everything he says is already on screen.</p></div></div></section>
      <section class="settings-group" aria-labelledby="settings-comfort"><h3 id="settings-comfort">Display & comfort</h3><div class="settings-options">
      <label>Text size<select name="textScale"><option value="1">Standard</option><option value="1.15">Large</option><option value="1.3">Larger</option></select></label>
      <label><input type="checkbox" name="reducedFlashes"> Reduce flashes and pulses</label>
      <label><input type="checkbox" name="cameraShake"> Camera shake</label>
      <label><input type="checkbox" name="highReadability"> High-readability lighting</label>
      <label><input type="checkbox" name="creatureCaptions"> Creature sound captions</label></div></section>
      <section class="settings-group" aria-labelledby="settings-combat"><h3 id="settings-combat">Combat</h3><div class="settings-options">
      <div class="settings-option"><label><input type="checkbox" name="finisher"> Weaver-leg finisher</label>
      <p class="settings-note">With a Weaver's own leg in hand and its owner wounded, the swing slows as it closes, and only a real hit ends it. A miss just costs the moment.</p>
      <label class="settings-sub"><input type="checkbox" name="cameraMotion"> Camera leans in during the finisher</label></div>
      <div class="settings-option"><label><input type="checkbox" name="trickshotEnabled"> Trickshot <span class="settings-tag">Experimental</span></label>
      <p class="settings-note">Chain different enemies for a brief window of borrowed time.</p>
      <p class="settings-note" id="trickshot-tuning">An assisted lock steadies single shots. The guide marks first contact; a wider ring shows spread, a broken ring marks uncertain follow-through. Seeking spells and streams keep free aim.</p></div></div></section>
      <section class="settings-group" aria-labelledby="settings-clips"><h3 id="settings-clips">Clips</h3><div class="settings-options">
      <div class="settings-option"><label><input type="checkbox" name="recordClips"> Keep the last ten seconds of play</label>
      <p class="settings-note">Press <kbd class="key" data-clip-key>${clipKey}</kbd> (View on a controller) to save them as a GIF. The death screen and the ledger offer it too.</p></div></div></section>
      <section class="settings-group" aria-labelledby="settings-keys"><h3 id="settings-keys">Keyboard</h3><p>Choose an action, then press its new key. Mouse aims; left click casts; right click throws a flask. With a Weaver leg equipped: left click whips, right click throws the leg, and Carry drops it.</p>
      <div class="binding-list"></div><p id="binding-feedback" role="status"></p>
      <button type="button" id="reset-controls">Restore controls</button></section>
      <section class="settings-group" aria-labelledby="settings-pad"><h3 id="settings-pad">Controller</h3><p class="controller-help">Left stick moves, right stick aims; A jumps, RT casts, LT pours, RB throws a flask, LB throws a glowseed, X interacts, Y switches wands, B crouches. With a Weaver leg: RT whips, RB throws it, LB drops it. Start pauses; View saves a clip.</p></section></form>`;
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
    for (const name of ['reducedFlashes', 'cameraShake', 'highReadability', 'creatureCaptions', 'narration', 'muted'] as const) {
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
    for (const channel of VOLUME_CHANNELS) {
      const input = this.dialog.querySelector<HTMLInputElement>(`[name="volume-${channel}"]`)!;
      input.addEventListener('input', () => {
        this.preferences.volume[channel] = Number(input.value) / 100; this.apply();
        this.preview(channel);
      });
      input.addEventListener('change', () => this.apply(true));
    }
    for (const name of ['finisher', 'cameraMotion'] as const) {
      this.dialog.querySelector(`[name="${name}"]`)!.addEventListener('change', e => {
        this.preferences.trickshot[name] = (e.target as HTMLInputElement).checked; this.apply(true);
      });
    }
    // The speaker in the corner reads and writes these same preferences.
    this.quick = new SoundQuickControl({
      volume: (channel) => this.preferences.volume[channel],
      setVolume: (channel, value, persist) => { this.preferences.volume[channel] = value; this.apply(persist); },
      muted: () => this.preferences.muted,
      setMuted: (muted) => { this.preferences.muted = muted; this.apply(true); },
      preview: (channel) => this.preview(channel),
    });
    this.renderBindings(); this.apply();
    const pause = document.createElement('button');
    pause.id = 'pause-settings'; pause.textContent = 'Controls & comfort'; pause.type = 'button';
    pause.addEventListener('click', () => this.open());
    document.querySelector('.pause-actions')?.appendChild(pause);
  }

  /** A small cue through the bus a slider controls, so you hear the level you chose. */
  private preview(channel: VolumeChannel): void {
    const ctx = this.ctx;
    ctx.audio.ensure();
    if (channel === 'master') ctx.audio.pickup();
    else if (channel === 'effects') ctx.audio.cardSlot();
    else if (channel === 'ambience') ctx.audio.drip();
    // The score and the narrator preview themselves: a moment of music, a short line.
    else if (channel === 'music') ctx.music?.preview();
    else ctx.narrator?.preview();
  }

  private renderBindings(): void {
    const root = this.dialog.querySelector('.binding-list')!;
    root.replaceChildren();
    const bindings = getBindings();
    const clipKey = this.dialog.querySelector('[data-clip-key]');
    if (clipKey) clipKey.textContent = keyLabel(bindings.clip);
    const muteKey = this.dialog.querySelector('[data-mute-key]');
    if (muteKey) muteKey.textContent = keyLabel(bindings.mute);
    this.quick?.refresh();
    for (const action of Object.keys(DEFAULT_BINDINGS) as BindingAction[]) {
      const label = BINDING_LABELS[action];
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<span>${label}</span><kbd>${keyLabel(bindings[action])}</kbd>`;
      button.setAttribute('aria-label', `Change ${label.toLowerCase()}: ${keyLabel(bindings[action])}`);
      button.addEventListener('click', () => {
        button.classList.add('listening');
        button.querySelector('kbd')!.textContent = 'Press a key';
        button.onkeydown = event => {
          event.preventDefault(); event.stopPropagation();
          if (event.code === 'Escape') { this.renderBindings(); return; }
          const message = setBinding(action, event.code);
          this.dialog.querySelector('#binding-feedback')!.textContent = message ?? `${label} is now ${keyLabel(event.code)}.`;
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
      // Muting holds the master at silence without forgetting where it was.
      this.ctx.audio.setVolume(channel, channel === 'master' && this.preferences.muted ? 0 : this.preferences.volume[channel]);
      const slider = this.dialog.querySelector(`[name="volume-${channel}"]`) as HTMLInputElement;
      slider.value = String(percent);
      slider.style.setProperty('--fill', `${percent}%`);
      this.dialog.querySelector(`#volume-${channel}-value`)!.textContent =
        channel === 'master' && this.preferences.muted ? 'Muted' : percent === 0 ? 'Off' : `${percent}%`;
    }
    for (const name of ['finisher', 'cameraMotion'] as const) {
      (this.dialog.querySelector(`[name="${name}"]`) as HTMLInputElement).checked = this.preferences.trickshot[name];
    }
    // The lean-in belongs to the finisher: greyed out (not hidden) while it is off.
    const lean = this.dialog.querySelector('[name="cameraMotion"]') as HTMLInputElement;
    lean.disabled = !this.preferences.trickshot.finisher;
    lean.closest('label')?.classList.toggle('disabled', lean.disabled);
    (this.dialog.querySelector('[name="textScale"]') as HTMLSelectElement).value = String(this.preferences.textScale);
    for (const name of ['reducedFlashes', 'cameraShake', 'highReadability', 'creatureCaptions', 'narration', 'muted'] as const) {
      (this.dialog.querySelector(`[name="${name}"]`) as HTMLInputElement).checked = this.preferences[name];
    }
    this.quick?.refresh();
    this.ctx.narrator?.setEnabled(this.preferences.narration);
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

  dispose(): void { this.quick.dispose(); this.dialog.remove(); document.getElementById('pause-settings')?.remove(); }
}
