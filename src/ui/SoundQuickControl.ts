import type { VolumeChannel } from '@/core/types';
import { DEFAULT_BINDINGS, gameplayCode, getBindings, keyLabel } from '@/input/bindings';

/**
 * The speaker in the corner: one click mutes everything, the little brass
 * caret (or hovering) opens the volume sliders. Lives on the title screen and
 * in play, so nobody has to find "Controls & comfort" to turn the music down.
 *
 * It owns no state: PlayerSettings is the single source of truth for volumes
 * and the mute switch, and this control reads and writes through the host.
 */
export interface SoundControlHost {
  volume(channel: VolumeChannel): number;
  setVolume(channel: VolumeChannel, value: number, persist: boolean): void;
  muted(): boolean;
  setMuted(muted: boolean): void;
  preview(channel: VolumeChannel): void;
}

const CHANNELS: ReadonlyArray<readonly [VolumeChannel, string]> = [
  ['master', 'All sound'], ['music', 'Music'], ['effects', 'Effects'], ['voice', 'Narrator'], ['ambience', 'Ambience'],
];

const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path class="wave" d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path class="wave" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>';

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

export class SoundQuickControl {
  readonly root = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private readonly caret = document.createElement('button');
  private readonly panel = document.createElement('div');
  private hoverTimer = 0;

  constructor(private readonly host: SoundControlHost) {
    this.root.id = 'sound-quick';
    this.toggle.type = 'button';
    this.toggle.className = 'sound-toggle';
    this.caret.type = 'button';
    this.caret.className = 'sound-caret';
    this.caret.setAttribute('aria-label', 'Volume');
    this.caret.setAttribute('aria-expanded', 'false');
    this.caret.setAttribute('aria-controls', 'sound-panel');
    this.caret.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5 6 4.5l3 3"/></svg>';
    this.panel.id = 'sound-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'group');
    this.panel.setAttribute('aria-label', 'Volume');
    this.panel.innerHTML = `<p class="sound-panel-title">Sound</p>` + CHANNELS.map(([channel, label]) =>
      `<label><span>${label}</span><input type="range" min="0" max="100" step="1" data-channel="${channel}"><output data-out="${channel}"></output></label>`).join('');
    this.root.append(this.panel, this.toggle, this.caret);
    document.getElementById('canvas-holder')?.appendChild(this.root);

    this.toggle.addEventListener('click', () => this.setMuted(!this.host.muted()));
    this.caret.addEventListener('click', () => this.open(this.panel.hidden !== false));
    for (const input of this.panel.querySelectorAll<HTMLInputElement>('input[data-channel]')) {
      const channel = input.dataset.channel as VolumeChannel;
      input.addEventListener('input', () => {
        // Turning something up is a clear wish to hear it: it unmutes.
        if (this.host.muted() && Number(input.value) > 0) this.host.setMuted(false);
        this.host.setVolume(channel, Number(input.value) / 100, false);
        this.host.preview(channel);
        this.refresh();
      });
      input.addEventListener('change', () => this.host.setVolume(channel, Number(input.value) / 100, true));
    }
    // Hover opens the sliders on a desktop; leaving closes them after a beat.
    this.root.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => this.open(true), 260);
    });
    this.root.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      window.clearTimeout(this.hoverTimer);
      if (!this.root.contains(document.activeElement)) this.hoverTimer = window.setTimeout(() => this.open(false), 420);
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) { e.stopPropagation(); this.open(false); this.caret.focus(); }
    });
    document.addEventListener('pointerdown', this.onOutside, true);
    window.addEventListener('keydown', this.onKeyDown);
    this.refresh();
  }

  /** Re-read the host (volumes changed in the settings dialog, a key rebind…). */
  refresh(): void {
    const muted = this.host.muted();
    // Sit just left of the Pause button, whatever its label's width (text size setting).
    const pause = document.getElementById('expedition-pause');
    if (pause?.offsetWidth) this.root.style.setProperty('--pause-w', `${pause.offsetWidth}px`);
    const key = keyLabel(getBindings().mute);
    this.root.classList.toggle('muted', muted);
    this.toggle.innerHTML = muted ? ICON_OFF : ICON_ON;
    this.toggle.setAttribute('aria-pressed', String(muted));
    this.toggle.setAttribute('aria-label', muted ? `Unmute sound (${key})` : `Mute sound (${key})`);
    this.toggle.title = muted ? `Sound off · ${key}` : `Sound on · ${key} mutes`;
    for (const [channel] of CHANNELS) {
      const percent = Math.round(this.host.volume(channel) * 100);
      const input = this.panel.querySelector<HTMLInputElement>(`input[data-channel="${channel}"]`)!;
      if (document.activeElement !== input) input.value = String(percent);
      input.style.setProperty('--fill', `${percent}%`);
      this.panel.querySelector(`[data-out="${channel}"]`)!.textContent =
        channel === 'master' && muted ? 'Muted' : percent === 0 ? 'Off' : `${percent}%`;
    }
  }

  private setMuted(muted: boolean): void {
    this.host.setMuted(muted);
    this.refresh();
    // A soft tick confirms unmuting (you can't hear the mute itself).
    if (!muted) this.host.preview('master');
  }

  private open(on: boolean): void {
    this.panel.hidden = !on;
    this.caret.setAttribute('aria-expanded', String(on));
    this.root.classList.toggle('open', on);
    if (on) this.refresh();
  }

  private readonly onOutside = (e: PointerEvent): void => {
    if (!this.panel.hidden && !this.root.contains(e.target as Node)) this.open(false);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (gameplayCode(e.code) !== DEFAULT_BINDINGS.mute || isEditableTarget(e.target)) return;
    // The controls dialog listens for a key to rebind; consoles take text.
    if (document.querySelector('#player-settings[open] .listening, #dev-console.open, #runtime-inspector.open')) return;
    e.preventDefault();
    this.setMuted(!this.host.muted());
  };

  dispose(): void {
    window.clearTimeout(this.hoverTimer);
    document.removeEventListener('pointerdown', this.onOutside, true);
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }
}
