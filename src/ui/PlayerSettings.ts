import type { Ctx, TrickshotSettings, VolumeChannel } from '@/core/types';
import { sanitizeTrickshot } from '@/config/trickshot';
import { VOLUME_CHANNELS, sanitizeVolumes, type VolumeSettings } from '@/audio/mix';
import { DEFAULT_BINDINGS, getBindings, keyLabel, resetBindings, setBinding, type BindingAction } from '@/input/bindings';
import { isClipRecordingEnabled, setClipRecordingEnabled } from '@/config/clipSettings';
import { SoundQuickControl } from '@/ui/SoundQuickControl';
import { readTouchControlsPreference, setTouchControlsPreference } from '@/input/touchSupport';
import { VitalNumbers } from '@/ui/VitalNumbers';
import { resetSeenHints } from '@/game/hints/seenHints';
import '@/styles/options.css';
import { PadRumble } from '@/input/padRumble';
import { LatchIndicator } from '@/ui/LatchIndicator';
import { sanitizeToggleModes, type HoldAction } from '@/input/toggleLatches';
import { EnemyReadouts } from '@/ui/EnemyReadouts';
import { ASSIST_PALETTES, lighten } from '@/config/colorAssist';
import { AIM_ASSISTS, COLOR_ASSISTS, HINT_MODES, HUD_OPACITY, HUD_SCALE, PAD_DEADZONE, PRESENTATION, SHAKE_SCALE, bandReadout, sanitizeBand, sanitizeChoice, sanitizeExtras, sanitizeOptionalBand, sanitizeShake, type Band, type ExtraPreferences, type PresentationKey, type ShakeLevel } from '@/config/playerPrefs';
import { createDefaultPostFxSettings } from '@/config/params';

/** Everything the dialog persists under one key. The newer options live in config/playerPrefs (ExtraPreferences). */
export interface PlayerPreferences extends ExtraPreferences {
  textScale: number; reducedFlashes: boolean;
  /** Off / Half / Full. Older saves held a boolean (false = Off, true = Full); sanitizeShake reads both. */
  cameraShake: ShakeLevel;
  highReadability: boolean; creatureCaptions: boolean; trickshot: TrickshotSettings; volume: VolumeSettings; narration: boolean; muted: boolean;
  /** Hold or toggle: true = latched by a press instead of held (crouch, levitate, pour, siphon). */
  toggles: Record<HoldAction, boolean>;
}
const KEY = 'ad-player-preferences-v1';

/** What each rebindable action is called on the keyboard list (sentence case). */
export const BINDING_LABELS: Readonly<Record<BindingAction, string>> = {
  left: 'Move left', right: 'Move right', up: 'Up (climb)', down: 'Down (crouch, climb)',
  jump: 'Jump / levitate', climb: 'Grab a wall', interact: 'Interact / lift / siphon', pour: 'Pour',
  drink: 'Drink', kick: 'Kick / hurl', carry: 'Swing on vines / carry', lure: 'Throw a glowseed', clip: 'Save a clip', mute: 'Mute all sound',
  lantern: 'Hood the lantern',
};

/**
 * The dialog's sections, in tab order. Each is one panel of the tab row: what
 * the player hears, what they see and how it is set for comfort, how a fight
 * plays, and then every way of steering (keyboard, controller, touch).
 */
export const SETTINGS_TABS = [
  { id: 'sound', label: 'Sound' },
  { id: 'display', label: 'Display & comfort' },
  { id: 'presentation', label: 'Presentation' },
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'controls', label: 'Controls' },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/**
 * Only the Trickshot switches are player-facing. Its timing numbers (slow-motion
 * speed, windows, aim assist, impact pause) always come from the tuned defaults
 * in config/trickshot.ts, so an old saved slider value cannot outlive the sliders.
 */
function playerTrickshot(saved: unknown): TrickshotSettings {
  const chosen = sanitizeTrickshot(saved as Partial<TrickshotSettings> | null);
  return { ...sanitizeTrickshot(null), enabled: chosen.enabled, finisher: chosen.finisher, cameraMotion: chosen.cameraMotion };
}

/** Whatever was saved (nothing, an older build's object, corrupt or hostile values) -> a complete, valid set. Never throws. */
export function sanitizePreferences(raw: unknown, reducedMotion: boolean): PlayerPreferences {
  const saved = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const textScale = typeof saved.textScale === 'number' && [1, 1.15, 1.3].includes(saved.textScale) ? saved.textScale : 1;
  return {
    ...sanitizeExtras(saved),
    textScale,
    reducedFlashes: typeof saved.reducedFlashes === 'boolean' ? saved.reducedFlashes : reducedMotion,
    cameraShake: sanitizeShake(saved.cameraShake),
    highReadability: saved.highReadability === true,
    creatureCaptions: saved.creatureCaptions === true,
    trickshot: playerTrickshot(saved.trickshot),
    volume: sanitizeVolumes(saved.volume),
    narration: saved.narration !== false,
    muted: saved.muted === true,
    toggles: sanitizeToggleModes(saved.toggles),
  };
}

export function readPlayerPreferences(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): PlayerPreferences {
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { return sanitizePreferences(JSON.parse(storage?.getItem(KEY) ?? '{}'), reducedMotion); } catch { return sanitizePreferences({}, reducedMotion); }
}

type BoolKey = { [K in keyof PlayerPreferences]: PlayerPreferences[K] extends boolean ? K : never }[keyof PlayerPreferences];
/** One simple control: a checkbox, a select or a slider whose `name` is how probes and tests find it. */
interface SimpleControl {
  name: string;
  read(p: PlayerPreferences): string | boolean | number;
  write(p: PlayerPreferences, raw: string | boolean): void;
  /** Sliders only: the readout beside it. */
  format?(p: PlayerPreferences): string;
}
/** A presentation slider: null (never touched) reads as the shipped value; writing snaps into the narrow band. */
const picture = (key: PresentationKey, field: 'brightness' | 'vignette' | 'bloom' | 'grain', zeroLabel?: string): SimpleControl => ({
  name: field,
  read: p => p[field] ?? PRESENTATION[key].fallback,
  write: (p, raw) => { p[field] = sanitizeOptionalBand(Number(raw), PRESENTATION[key]); },
  format: p => bandReadout(p[field] ?? PRESENTATION[key].fallback, PRESENTATION[key], zeroLabel),
});
/** A required slider shown as a percentage (HUD size and opacity). */
const percent = (field: 'hudScale' | 'hudOpacity' | 'padDeadzone', band: Band): SimpleControl => ({
  name: field,
  read: p => p[field],
  write: (p, raw) => { p[field] = sanitizeBand(Number(raw), band); },
  format: p => `${Math.round(p[field] * 100)}%`,
});
/** A Hold / Toggle select for one latchable action. */
const holdMode = (action: HoldAction, name: string): SimpleControl => ({
  name,
  read: p => (p.toggles[action] ? 'toggle' : 'hold'),
  write: (p, raw) => { p.toggles[action] = raw === 'toggle'; },
});
const flag = (key: BoolKey): SimpleControl => ({ name: key, read: p => p[key], write: (p, raw) => { (p as Record<BoolKey, boolean>)[key] = raw === true; } });

const SIMPLE_CONTROLS: readonly SimpleControl[] = [
  { name: 'textScale', read: p => String(p.textScale), write: (p, raw) => { const n = Number(raw); p.textScale = [1, 1.15, 1.3].includes(n) ? n : 1; } },
  flag('reducedFlashes'), flag('highReadability'), flag('creatureCaptions'), flag('narration'), flag('muted'),
  { name: 'cameraShake', read: p => p.cameraShake, write: (p, raw) => { p.cameraShake = sanitizeShake(raw); } },
  flag('pauseOnBlur'), flag('captionBacking'), flag('numericVitals'),
  holdMode('down', 'toggleDown'), holdMode('jump', 'toggleJump'), holdMode('pour', 'togglePour'), holdMode('interact', 'toggleInteract'),
  flag('showEnemyHp'), percent('hudScale', HUD_SCALE), percent('hudOpacity', HUD_OPACITY), percent('padDeadzone', PAD_DEADZONE), flag('padRumble'),
  picture('brightness', 'brightness'), picture('vignette', 'vignette'), picture('bloom', 'bloom'), picture('grain', 'grain', 'Off'),
  { name: 'colorAssist', read: p => p.colorAssist, write: (p, raw) => { p.colorAssist = sanitizeChoice(raw, COLOR_ASSISTS, 'off'); } },
  { name: 'aimAssist', read: p => p.aimAssist, write: (p, raw) => { p.aimAssist = sanitizeChoice(raw, AIM_ASSISTS, 'off'); } },
  { name: 'hintMode', read: p => p.hintMode, write: (p, raw) => { p.hintMode = sanitizeChoice(raw, HINT_MODES, 'first'); } },
];

/** One checkbox row: the label, and an optional one-line note the control is described by. */
function checkRow(name: string, label: string, note?: string): string {
  return `<div class="settings-option"><label><input type="checkbox" name="${name}"${note ? ` aria-describedby="note-${name}"` : ''}> ${label}</label>${note ? `<p class="settings-note" id="note-${name}">${note}</p>` : ''}</div>`;
}

/** One slider row: name, the track, the readout, and an optional one-line note beneath. */
function sliderRow(name: string, label: string, band: Band, note?: string): string {
  return `<div class="settings-option settings-slider"><label for="set-${name}">${label}</label><input type="range" id="set-${name}" name="${name}" min="${band.min}" max="${band.max}" step="${band.step}"${note ? ` aria-describedby="note-${name}"` : ''}><output id="out-${name}" for="set-${name}"></output>${note ? `<p class="settings-note" id="note-${name}">${note}</p>` : ''}</div>`;
}

/** One select row: the label at the left, the choice at the right, the note beneath. */
function selectRow(name: string, label: string, choices: ReadonlyArray<readonly [string, string]>, note?: string): string {
  const options = choices.map(([value, text]) => `<option value="${value}">${text}</option>`).join('');
  return `<div class="settings-option settings-field"><label for="set-${name}">${label}</label><select id="set-${name}" name="${name}"${note ? ` aria-describedby="note-${name}"` : ''}>${options}</select>${note ? `<p class="settings-note" id="note-${name}">${note}</p>` : ''}</div>`;
}

export class PlayerSettings {
  private readonly dialog = document.createElement('dialog');
  private previousPause = false;
  private returnFocus: HTMLElement | null = null;
  private preferences = readPlayerPreferences();
  private readonly quick: SoundQuickControl;
  private readonly vitals: VitalNumbers;
  private readonly rumble: PadRumble;
  private readonly readouts: EnemyReadouts;
  private readonly latchChip: LatchIndicator;
  /** Presentation fields the player has moved, so "Reset picture" restores exactly those and nothing else. */
  private readonly touchedPicture = new Set<PresentationKey>();
  private tab: SettingsTab = 'sound';
  private readonly onTabStep = (event: Event): void => {
    const step = event instanceof CustomEvent && event.detail === -1 ? -1 : 1;
    if (this.dialog.open) this.stepTab(step, true);
  };

  constructor(private readonly ctx: Ctx) {
    this.dialog.id = 'player-settings';
    this.dialog.setAttribute('aria-labelledby', 'player-settings-title');
    const clipKey = keyLabel(getBindings().clip);
    // Grouped the way a player looks for them, one panel per tab: what they hear,
    // what they see, how fights feel, then the keys. Every combat option is
    // reachable on its own: the finisher does not live inside the Trickshot experiment.
    const tabs = SETTINGS_TABS.map(({ id, label }, index) =>
      `<button type="button" role="tab" class="menu-tab" id="settings-tab-${id}" data-tab="${id}" aria-controls="settings-panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`).join('');
    this.dialog.innerHTML = `<form method="dialog"><div class="settings-heading"><h2 id="player-settings-title">Make yourself at home</h2><button value="close" class="menu-close" aria-label="Close settings"><kbd class="key">Esc</kbd>Close</button></div>
      <div class="settings-tabs menu-tabs" role="tablist" aria-label="Settings sections">${tabs}</div>
      <div class="settings-panels">
      <div role="tabpanel" class="settings-panel" id="settings-panel-sound" aria-labelledby="settings-tab-sound">
      <section class="settings-group" aria-labelledby="settings-sound"><h3 id="settings-sound">Volume</h3>
      <div class="settings-options"><label><input type="checkbox" name="muted"> Mute all sound <kbd class="key" data-mute-key>${keyLabel(getBindings().mute)}</kbd></label></div><div class="settings-options settings-volume">
      <label>Master<input type="range" name="volume-master" min="0" max="100" step="1"><output id="volume-master-value"></output></label>
      <label>Effects<input type="range" name="volume-effects" min="0" max="100" step="1"><output id="volume-effects-value"></output></label>
      <label>Ambience<input type="range" name="volume-ambience" min="0" max="100" step="1"><output id="volume-ambience-value"></output></label>
      <label>Music<input type="range" name="volume-music" min="0" max="100" step="1"><output id="volume-music-value"></output></label>
      <label>Voice<input type="range" name="volume-voice" min="0" max="100" step="1"><output id="volume-voice-value"></output></label></div></section>
      <section class="settings-group" aria-labelledby="settings-narrator"><h3 id="settings-narrator">Narrator</h3><div class="settings-options">
      ${checkRow('narration', 'Narration', 'An old docent of the Works reads the moments worth reading aloud. Everything he says is already on screen.')}</div></section></div>
      <div role="tabpanel" class="settings-panel" id="settings-panel-display" aria-labelledby="settings-tab-display" hidden>
      <section class="settings-group" aria-labelledby="settings-reading"><h3 id="settings-reading">Reading</h3><div class="settings-options">
      ${selectRow('textScale', 'Text size', [['1', 'Standard'], ['1.15', 'Large'], ['1.3', 'Larger']])}
      ${checkRow('captionBacking', 'Caption backing', 'A dark plate behind the narrator, creature-sound captions and combat callouts. Captions and callouts grow with Text size.')}
      ${checkRow('numericVitals', 'Numbers on the bars', 'The exact figure beside health, mana and levitation.')}</div></section>
      <section class="settings-group" aria-labelledby="settings-hud"><h3 id="settings-hud">HUD</h3><div class="settings-options">
      ${sliderRow('hudScale', 'HUD size', HUD_SCALE, 'Scales the bars, wands, flasks and objective without touching the words. Text size changes the words.')}
      ${sliderRow('hudOpacity', 'HUD opacity', HUD_OPACITY, 'How solid the HUD is over the world.')}
      <div class="settings-option"><button type="button" id="reset-hud">Reset HUD</button></div></div></section>
      <section class="settings-group" aria-labelledby="settings-comfort"><h3 id="settings-comfort">Comfort</h3><div class="settings-options">
      ${checkRow('reducedFlashes', 'Reduce flashes and pulses')}
      ${selectRow('colorAssist', 'Colour assist', [['off', 'Off'], ['red-green', 'Red-green'], ['blue-yellow', 'Blue-yellow']], 'Recolours the health, mana and levitation bars so they stay apart, gives each bar its own pattern, and crosses out spent phials. The world keeps the colours it was painted in.')}
      ${selectRow('cameraShake', 'Camera shake', [['full', 'Full'], ['half', 'Half'], ['off', 'Off']], 'How hard blasts, falls and heavy footsteps shake the view.')}
      ${checkRow('highReadability', 'High-readability lighting')}
      ${checkRow('creatureCaptions', 'Creature sound captions')}</div></section></div>
      <div role="tabpanel" class="settings-panel" id="settings-panel-presentation" aria-labelledby="settings-tab-presentation" hidden>
      <section class="settings-group" aria-labelledby="settings-picture"><h3 id="settings-picture">Picture</h3><div class="settings-options">
      ${sliderRow('brightness', 'Brightness', PRESENTATION.brightness, 'How brightly the finished picture is lit. The dark places stay dark at either end.')}
      ${sliderRow('vignette', 'Edge shading', PRESENTATION.vignette, 'How much the corners of the view fall away.')}
      ${sliderRow('bloom', 'Glow', PRESENTATION.bloom, 'The soft halo around fire, lamps and lava.')}
      ${sliderRow('grain', 'Film grain', PRESENTATION.grain, 'A faint shimmer over the whole view. Off removes it.')}
      <div class="settings-option"><button type="button" id="reset-picture">Reset picture</button></div></div></section></div>
      <div role="tabpanel" class="settings-panel" id="settings-panel-gameplay" aria-labelledby="settings-tab-gameplay" hidden>
      <section class="settings-group" aria-labelledby="settings-play"><h3 id="settings-play">Play</h3><div class="settings-options">
      ${checkRow('pauseOnBlur', 'Pause when the window loses focus', 'Switch to another window or tab and the descent stops where it is. The title, the Sanctum and cutscenes are already still.')}</div></section>
      <section class="settings-group" aria-labelledby="settings-teaching"><h3 id="settings-teaching">Teaching cards</h3><div class="settings-options">
      ${selectRow('hintMode', 'Show teaching cards', [['first', 'First time only'], ['always', 'Every floor'], ['off', 'Off']], 'The small cards that explain a mechanism the first time you meet it. Every floor brings each one back once on each new floor. The short prompts under the objective stay.')}
      <div class="settings-option"><button type="button" id="reset-tutorials" aria-describedby="note-reset-tutorials">Reset tutorials</button>
      <p class="settings-note flush" id="note-reset-tutorials">Every card teaches again, as on a first descent.</p></div></div></section>
      <section class="settings-group" aria-labelledby="settings-combat"><h3 id="settings-combat">Combat</h3><div class="settings-options">
      ${selectRow('aimAssist', 'Aim assist', [['off', 'Off'], ['light', 'Light'], ['strong', 'Strong']], 'Bends a shot the last few degrees onto an enemy your aim already points at (Light 4, Strong 8). For a stick, a keyboard or a touch pad, which have no cursor to place. Trickshot keeps its own lock.')}
      ${checkRow('showEnemyHp', 'Enemy health and damage', 'A thin health bar over an enemy for two seconds after you hit it, and the damage you dealt. A readout only: nothing in the fight changes.')}
      <div class="settings-option"><label><input type="checkbox" name="finisher"> Weaver-leg finisher</label>
      <p class="settings-note">With a Weaver's own leg in hand and its owner wounded, the swing slows as it closes, and only a real hit ends it. A miss just costs the moment.</p>
      <label class="settings-sub"><input type="checkbox" name="cameraMotion"> Camera leans in during the finisher</label></div>
      <div class="settings-option"><label><input type="checkbox" name="trickshotEnabled"> Trickshot <span class="settings-tag">Experimental</span></label>
      <p class="settings-note">Chain different enemies for a brief window of borrowed time.</p>
      <p class="settings-note" id="trickshot-tuning">An assisted lock steadies single shots. The guide marks first contact; a wider ring shows spread, a broken ring marks uncertain follow-through. Seeking spells and streams keep free aim.</p></div></div></section>
      <section class="settings-group" aria-labelledby="settings-clips"><h3 id="settings-clips">Clips</h3><div class="settings-options">
      <div class="settings-option"><label><input type="checkbox" name="recordClips"> Keep the last ten seconds of play</label>
      <p class="settings-note">Press <kbd class="key" data-clip-key>${clipKey}</kbd> (View on a controller) to save them as a GIF. The death screen and the ledger offer it too.</p></div></div></section></div>
      <div role="tabpanel" class="settings-panel" id="settings-panel-controls" aria-labelledby="settings-tab-controls" hidden>
      <section class="settings-group" aria-labelledby="settings-keys"><h3 id="settings-keys">Keyboard</h3><p>Choose an action, then press its new key. Mouse aims; left click casts; right click throws a flask. With a Weaver leg equipped: left click whips, right click throws the leg, and Carry drops it.</p>
      <div class="binding-list"></div><p id="binding-feedback" role="status"></p>
      <button type="button" id="reset-controls">Restore controls</button></section>
      <section class="settings-group" aria-labelledby="settings-hold"><h3 id="settings-hold">Hold or toggle</h3>
      <p>For when holding a key is the hard part. Toggle: press once to start, press again to stop. Anything latched lets go by itself when you pause, fall or change floor.</p>
      <div class="settings-options">
      ${selectRow('toggleDown', 'Crouch', [['hold', 'Hold'], ['toggle', 'Toggle']])}
      ${selectRow('toggleJump', 'Levitate (Jump)', [['hold', 'Hold'], ['toggle', 'Toggle']])}
      ${selectRow('togglePour', 'Pour', [['hold', 'Hold'], ['toggle', 'Toggle']])}
      ${selectRow('toggleInteract', 'Siphon (Interact)', [['hold', 'Hold'], ['toggle', 'Toggle']])}</div></section>
      <section class="settings-group" aria-labelledby="settings-pad"><h3 id="settings-pad">Controller</h3><p class="controller-help">Left stick moves, right stick aims; A jumps, RT casts, LT pours, RB throws a flask, LB throws a glowseed, X interacts, Y switches wands, B crouches. With a Weaver leg: RT whips, RB throws it, LB drops it. Start pauses; View saves a clip.</p>
      <div class="settings-options">${sliderRow('padDeadzone', 'Stick dead zone', PAD_DEADZONE, 'How far a stick must move before it counts. Raise it if the view drifts or the alchemist creeps on their own.')}
      ${checkRow('padRumble', 'Vibration', 'A short rumble when you are hurt, when a blast goes off close by, and when you fall. Only on controllers that can rumble.')}</div></section>
      <section class="settings-group" aria-labelledby="settings-touch"><h3 id="settings-touch">Touch controls</h3><div class="settings-options">
      ${selectRow('touchControls', 'Show touch controls', [['auto', 'Auto (touch devices)'], ['on', 'Always'], ['off', 'Never']])}</div>
      <p>Left pad moves and climbs. Right pad aims and casts. Hold Jump to fly; Grip holds a wall. Use interacts or fills a flask. Tools has flask actions, carrying, glowseeds, and an Aim only switch. Landscape gives you a larger view. The screen stays awake during play when your browser allows it; Pause releases it.</p></section></div>
      </div>
      <p class="settings-status" id="settings-status" role="status"></p></form>`;
    document.getElementById('canvas-holder')!.appendChild(this.dialog);
    this.wireTabs();
    const touchControls = this.dialog.querySelector<HTMLSelectElement>('[name="touchControls"]')!;
    touchControls.value = readTouchControlsPreference();
    touchControls.addEventListener('change', () => {
      const value = touchControls.value;
      if (value === 'auto' || value === 'on' || value === 'off') setTouchControlsPreference(value);
    });
    this.dialog.addEventListener('close', () => {
      // Native close events are queued. Escape/Resume may already have released
      // the owning overlay by the time this callback runs.
      ctx.state.paused = this.previousPause && Boolean(document.querySelector('#pause-overlay.visible, #expedition-entry:not([hidden])'));
      if (this.returnFocus?.checkVisibility()) this.returnFocus.focus();
    });
    for (const control of SIMPLE_CONTROLS) {
      const el = this.dialog.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${control.name}"]`)!;
      const raw = (): string | boolean => (el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value);
      // A slider applies live while it is dragged and is saved on release.
      if (el instanceof HTMLInputElement && el.type === 'range') el.addEventListener('input', () => { control.write(this.preferences, raw()); this.apply(); });
      el.addEventListener('change', () => { control.write(this.preferences, raw()); this.apply(true); });
    }
    this.dialog.querySelector('#reset-controls')!.addEventListener('click', () => {
      resetBindings(); this.renderBindings();
      this.preferences.toggles = sanitizeToggleModes(null); this.apply(true);
    });
    this.dialog.querySelector('#reset-hud')!.addEventListener('click', () => {
      this.preferences.hudScale = HUD_SCALE.fallback; this.preferences.hudOpacity = HUD_OPACITY.fallback; this.apply(true);
    });
    this.dialog.querySelector('#reset-picture')!.addEventListener('click', () => {
      this.preferences.brightness = this.preferences.vignette = this.preferences.bloom = this.preferences.grain = null;
      this.apply(true);
    });
    this.dialog.querySelector('#reset-tutorials')!.addEventListener('click', () => {
      if (ctx.hints?.resetTaught) ctx.hints.resetTaught(); else resetSeenHints();
      this.dialog.querySelector('#settings-status')!.textContent = 'Tutorials reset. Every teaching card will appear again.';
    });
    // Clips keep their own preference (config/clipSettings) so app/Clips never imports this dialog.
    const recordClips = this.dialog.querySelector<HTMLInputElement>('[name="recordClips"]')!;
    recordClips.checked = isClipRecordingEnabled();
    recordClips.addEventListener('change', () => {
      if (!setClipRecordingEnabled(recordClips.checked)) this.dialog.querySelector('#settings-status')!.textContent = 'Preferences apply for this session. Local storage is unavailable.';
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
    this.vitals = new VitalNumbers(ctx);
    this.rumble = new PadRumble(ctx);
    this.readouts = new EnemyReadouts(ctx);
    this.latchChip = new LatchIndicator(ctx);
    this.renderBindings(); this.apply();
    window.addEventListener('settings-tab-step', this.onTabStep);
    const pause = document.createElement('button');
    pause.id = 'pause-settings'; pause.textContent = 'Controls & comfort'; pause.type = 'button';
    pause.addEventListener('click', () => this.open());
    document.querySelector('.pause-actions')?.appendChild(pause);
  }

  /** The tab row: click or arrow keys to move between panels, Home/End for the ends. */
  private wireTabs(): void {
    const list = this.dialog.querySelector<HTMLElement>('[role="tablist"]')!;
    for (const tab of list.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      tab.addEventListener('click', () => this.selectTab(tab.dataset.tab as SettingsTab, false));
    }
    list.addEventListener('keydown', (event) => {
      const ids = SETTINGS_TABS.map(t => t.id);
      const at = ids.indexOf(this.tab);
      const next = event.key === 'ArrowRight' ? (at + 1) % ids.length
        : event.key === 'ArrowLeft' ? (at + ids.length - 1) % ids.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      this.selectTab(ids[next], true);
    });
  }

  /** Show one panel. Focus follows only when the move came from the keyboard or a controller. */
  private selectTab(tab: SettingsTab, focus: boolean): void {
    this.tab = tab;
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    for (const panel of this.dialog.querySelectorAll<HTMLElement>('[role="tabpanel"]')) panel.hidden = panel.id !== `settings-panel-${tab}`;
    this.dialog.querySelector('.settings-panels')!.scrollTop = 0;
  }

  private stepTab(step: 1 | -1, focus: boolean): void {
    const ids = SETTINGS_TABS.map(t => t.id);
    this.selectTab(ids[(ids.indexOf(this.tab) + step + ids.length) % ids.length], focus);
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
    this.ctx.state.reduceCameraShake = this.preferences.cameraShake === 'off';
    // Presentation: a slider the player never touched leaves the game's own value alone.
    const defaults = createDefaultPostFxSettings();
    const picture = [['brightness', 'gain', 'brightness'], ['vignette', 'vignette', 'vignette'], ['bloom', 'bloomStrength', 'bloom'], ['grain', 'grain', 'grain']] as const;
    for (const [pref, field, key] of picture) {
      const value = this.preferences[pref];
      if (value !== null) { fx[field] = value; this.touchedPicture.add(key); } else if (this.touchedPicture.delete(key)) fx[field] = defaults[field] ?? 1;
    }
    this.ctx.state.cameraShakeScale = SHAKE_SCALE[this.preferences.cameraShake];
    this.ctx.state.pauseOnBlur = this.preferences.pauseOnBlur;
    this.ctx.state.hintMode = this.preferences.hintMode;
    document.body.classList.toggle('caps-backed', this.preferences.captionBacking);
    // Colour assist: the HUD bars' accents (from config/colorAssist) and body.assist-on, which options.css keys the patterns to.
    const assist = this.preferences.colorAssist;
    document.body.classList.toggle('assist-on', assist !== 'off');
    for (const key of ['hp', 'mana', 'levit'] as const) {
      if (assist === 'off') {
        document.body.style.removeProperty(`--assist-${key}`);
        document.body.style.removeProperty(`--assist-${key}-hi`);
      } else {
        document.body.style.setProperty(`--assist-${key}`, ASSIST_PALETTES[assist][key]);
        document.body.style.setProperty(`--assist-${key}-hi`, lighten(ASSIST_PALETTES[assist][key], 0.5));
      }
    }
    // HUD size and opacity: variables on the root, and a class only while they differ from the shipped HUD
    // (so with nothing chosen no rule below applies and no HUD block gains a transform or an opacity).
    const root = document.documentElement.style;
    root.setProperty('--hud-scale', String(this.preferences.hudScale));
    root.setProperty('--hud-opacity', String(this.preferences.hudOpacity));
    document.body.classList.toggle('hud-custom', this.preferences.hudScale !== HUD_SCALE.fallback || this.preferences.hudOpacity !== HUD_OPACITY.fallback);
    this.ctx.state.hudScale = this.preferences.hudScale;
    this.ctx.state.padDeadzone = this.preferences.padDeadzone;
    this.rumble.setEnabled(this.preferences.padRumble);
    this.ctx.state.showEnemyHp = this.preferences.showEnemyHp;
    this.ctx.state.aimAssist = this.preferences.aimAssist;
    this.ctx.state.toggleModes = { ...this.preferences.toggles };
    this.readouts.setEnabled(this.preferences.showEnemyHp);
    this.vitals.setEnabled(this.preferences.numericVitals);
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
    for (const control of SIMPLE_CONTROLS) {
      const el = this.dialog.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${control.name}"]`)!;
      const value = control.read(this.preferences);
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = value === true;
      else el.value = String(value);
      if (el instanceof HTMLInputElement && el.type === 'range') {
        const fill = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
        el.style.setProperty('--fill', `${fill}%`);
        const readout = control.format?.(this.preferences) ?? '';
        const out = this.dialog.querySelector(`#out-${control.name}`);
        if (out) out.textContent = readout;
        el.setAttribute('aria-valuetext', readout);
      }
    }
    this.quick?.refresh();
    this.ctx.narrator?.setEnabled(this.preferences.narration);
    if (persist) try { localStorage.setItem(KEY, JSON.stringify(this.preferences)); } catch {
      this.dialog.querySelector('#settings-status')!.textContent = 'Preferences apply for this session. Local storage is unavailable.';
    }
  }

  open(tab?: SettingsTab): void {
    if (this.dialog.open) return;
    this.previousPause = this.ctx.state.paused;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.ctx.state.paused = true;
    this.selectTab(tab ?? this.tab, false);
    this.dialog.showModal();
    this.dialog.querySelector<HTMLElement>(`#settings-tab-${this.tab}`)?.focus();
  }

  dispose(): void {
    window.removeEventListener('settings-tab-step', this.onTabStep);
    this.quick.dispose(); this.vitals.dispose(); this.rumble.dispose(); this.readouts.dispose(); this.latchChip.dispose(); this.dialog.remove(); document.getElementById('pause-settings')?.remove();
  }
}
