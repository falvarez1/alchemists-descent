import '@/styles/clips.css';
import type { Ctx } from '@/core/types';
import { formatBytes } from '@/app/clipCore';
import { getBindings, keyLabel } from '@/input/bindings';

export interface ClipReady {
  url: string;
  filename: string;
  blob: Blob;
  poster: Blob | null;
  bytes: number;
  frames: number;
  durationMs: number;
}

type CardState = 'developing' | 'ready' | 'failed';

const RING_C = 2 * Math.PI * 20;

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(s) ? s : s + '.';
}

type ClipboardItemStatic = typeof ClipboardItem & { supports?: (type: string) => boolean };

/**
 * The clip's result card and the camera cues around it. House style: slate
 * plate, brass for what matters, Cormorant for the headline. It is not a menu:
 * it never pauses play, never takes focus mid-play, and sits in the quiet
 * bottom-right corner above the pause button until dismissed.
 *
 * Micro-interactions: the shutter (a soft flash plus viewfinder corners that
 * snap in; corners only under Reduce flashes), a brass progress ring while
 * the plate "develops" — the still clears from sepia as progress climbs — and
 * a reveal that fixes the moving picture in place with one brass glint.
 */
export class ClipCard {
  private readonly root: HTMLElement;
  private readonly shutterEl: HTMLElement;
  private readonly stillCanvas: HTMLCanvasElement;
  private readonly gif: HTMLImageElement;
  private readonly arc: SVGCircleElement;
  private readonly pct: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly download: HTMLAnchorElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly feedback: HTMLElement;
  private readonly deathBtn: HTMLButtonElement;
  private state: CardState = 'developing';
  private pass = 0;
  private current: ClipReady | null = null;
  private reason: string = 'hotkey';
  private hideTimer: number | null = null;
  private deathAvailable = true;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    const holder = document.getElementById('canvas-holder') ?? document.body;

    this.shutterEl = document.createElement('div');
    this.shutterEl.className = 'clip-shutter';
    this.shutterEl.setAttribute('aria-hidden', 'true');
    this.shutterEl.innerHTML = '<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i>';
    holder.appendChild(this.shutterEl);

    this.root = document.createElement('section');
    this.root.id = 'clip-card';
    this.root.className = 'clip-card';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'clip-card-title');
    this.root.innerHTML = `
      <div class="clip-plate">
        <canvas class="clip-still" width="480" height="270" aria-hidden="true"></canvas>
        <img class="clip-gif" alt="" decoding="async">
        <svg class="clip-ring" viewBox="0 0 48 48" aria-hidden="true">
          <circle class="clip-ring-track" cx="24" cy="24" r="20"></circle>
          <circle class="clip-ring-arc" cx="24" cy="24" r="20"></circle>
        </svg>
        <span class="clip-pct" aria-hidden="true"></span>
      </div>
      <div class="clip-body">
        <div class="clip-head">
          <div>
            <p class="clip-kicker"></p>
            <h3 class="clip-title" id="clip-card-title" aria-live="polite"></h3>
          </div>
          <button type="button" class="clip-dismiss" aria-label="Dismiss clip"><span aria-hidden="true">×</span></button>
        </div>
        <p class="clip-meta"></p>
        <div class="clip-actions">
          <a class="menu-btn primary clip-download" role="button" aria-disabled="true">Download</a>
          <button type="button" class="menu-btn clip-copy" disabled>Copy</button>
        </div>
        <p class="clip-feedback" role="status" aria-live="polite"></p>
      </div>`;
    holder.appendChild(this.root);

    const q = <T extends Element>(sel: string): T => this.root.querySelector<T>(sel)!;
    this.stillCanvas = q<HTMLCanvasElement>('.clip-still');
    this.gif = q<HTMLImageElement>('.clip-gif');
    this.arc = q<SVGCircleElement>('.clip-ring-arc');
    this.pct = q<HTMLElement>('.clip-pct');
    this.kicker = q<HTMLElement>('.clip-kicker');
    this.title = q<HTMLElement>('.clip-title');
    this.meta = q<HTMLElement>('.clip-meta');
    this.download = q<HTMLAnchorElement>('.clip-download');
    this.copyBtn = q<HTMLButtonElement>('.clip-copy');
    this.feedback = q<HTMLElement>('.clip-feedback');
    this.arc.style.strokeDasharray = `${RING_C}`;
    this.arc.style.strokeDashoffset = `${RING_C}`;

    q<HTMLButtonElement>('.clip-dismiss').addEventListener('click', this.onDismiss);
    this.download.addEventListener('click', this.onDownload);
    this.copyBtn.addEventListener('click', this.onCopy);

    // The death screen's quiet second option. It sits under the way back and
    // never competes with it: text, not a slab.
    this.deathBtn = document.createElement('button');
    this.deathBtn.type = 'button';
    this.deathBtn.id = 'go-clip-btn';
    this.deathBtn.className = 'go-clip';
    this.deathBtn.addEventListener('click', this.onDeathClip);
    this.resetDeathButton();
    const respawn = document.getElementById('respawn-btn');
    if (respawn?.parentElement) respawn.insertAdjacentElement('afterend', this.deathBtn);

    this.offs.push(
      ctx.events.on('playerDied', () => this.resetDeathButton()),
      ctx.events.on('playerRespawned', () => this.resetDeathButton()),
      ctx.events.on('playerDeathCleared', () => this.resetDeathButton()),
    );
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.root.remove();
    this.shutterEl.remove();
    this.deathBtn.remove();
  }

  /** Death-screen button availability (recording off or unsupported hides it). */
  setDeathButtonAvailable(on: boolean): void {
    if (this.deathAvailable === on) return;
    this.deathAvailable = on;
    this.deathBtn.hidden = !on;
  }

  /** The camera cue on request. Corners always; the soft flash only when flashes are welcome. */
  shutter(reducedFlashes: boolean): void {
    const el = this.shutterEl;
    el.classList.remove('fire', 'gentle');
    void el.offsetWidth; // restart the one-shot animation
    el.classList.add('fire');
    if (reducedFlashes) el.classList.add('gentle');
  }

  developing(info: { place: string; seconds: number; reason: string }): void {
    this.reason = info.reason;
    this.current = null;
    this.pass = 0;
    this.setState('developing');
    this.kicker.textContent = info.place;
    this.title.textContent = 'Developing the plate…';
    this.meta.textContent = `The last ${info.seconds} seconds, fixing to glass.`;
    this.feedback.textContent = '';
    this.gif.removeAttribute('src');
    this.gif.classList.remove('revealed');
    const g = this.stillCanvas.getContext('2d');
    g?.clearRect(0, 0, this.stillCanvas.width, this.stillCanvas.height);
    this.stillCanvas.classList.remove('has-still');
    this.progress(0);
    this.download.removeAttribute('href');
    this.download.removeAttribute('download');
    this.download.setAttribute('aria-disabled', 'true');
    this.copyBtn.disabled = true;
    if (this.onDeathScreen()) this.setDeathButton('Developing…', true);
    this.show();
  }

  /** The clip's final frame, shown (in sepia, clearing) while it develops. */
  showStill(bitmap: ImageBitmap): void {
    try {
      if (this.state !== 'developing') return;
      this.stillCanvas.width = bitmap.width;
      this.stillCanvas.height = bitmap.height;
      this.stillCanvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      this.stillCanvas.classList.add('has-still');
    } finally {
      bitmap.close();
    }
  }

  progress(p: number, pass = 0): void {
    const v = Math.max(0, Math.min(1, p));
    if (pass > 0 && this.state === 'developing' && this.pass !== pass) {
      this.meta.textContent = 'Too heavy to post; pressing a thinner plate.';
    }
    this.pass = pass;
    this.arc.style.strokeDashoffset = `${RING_C * (1 - v)}`;
    this.root.style.setProperty('--clip-dev', String(1 - v));
    this.pct.textContent = `${Math.round(v * 100)}%`;
  }

  ready(clip: ClipReady): void {
    this.current = clip;
    this.progress(1);
    this.title.textContent = 'The plate is fixed.';
    this.meta.textContent = `${(clip.durationMs / 1000).toFixed(1)} s · ${formatBytes(clip.bytes)} · ${clip.frames} frames`;
    this.gif.alt = `The last ${Math.round(clip.durationMs / 1000)} seconds of play, as a looping GIF`;
    this.gif.onload = () => {
      this.gif.classList.add('revealed');
      this.setState('ready');
    };
    this.gif.src = clip.url;
    this.download.href = clip.url;
    this.download.download = clip.filename;
    this.download.title = clip.filename;
    this.download.removeAttribute('aria-disabled');
    this.copyBtn.disabled = false;
    if (this.onDeathScreen()) this.setDeathButton('Kept. See the plate.', true);
    this.show();
    // Over the death screen the player is already in a menu; hand the keyboard
    // to the clip. Mid-play the card never takes focus (Space would press it).
    if (this.reason === 'death' && this.onDeathScreen()) {
      this.download.focus({ preventScroll: true });
    }
  }

  failed(reason: string): void {
    this.setState('failed');
    this.title.textContent = 'The plate spoiled.';
    this.meta.textContent = sentence(reason);
    this.copyBtn.disabled = true;
    if (this.onDeathScreen()) this.setDeathButton('Try the plate again', false);
    this.show();
  }

  /** Put the card away (its moment has passed). Harmless when it is already down. */
  dismiss(): void {
    if (this.root.hidden) return;
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.hide();
  }

  /** A second request while one develops: the card answers instead of queueing. */
  nudge(): void {
    this.show();
    this.root.classList.remove('nudge');
    void this.root.offsetWidth;
    this.root.classList.add('nudge');
  }

  private setState(state: CardState): void {
    this.state = state;
    this.root.dataset.state = state;
  }

  private show(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (!this.root.hidden && this.root.classList.contains('shown')) return;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('shown');
  }

  private hide(): void {
    this.root.classList.remove('shown');
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      this.root.hidden = true;
    }, 240);
  }

  private onDeathScreen(): boolean {
    return document.getElementById('gameover-overlay')?.classList.contains('visible') === true;
  }

  private inPlay(): boolean {
    return this.ctx.state.mode === 'play' && !this.ctx.state.paused && !this.ctx.player.dead;
  }

  private releaseFocus(el: HTMLElement): void {
    // Mid-play a focused button would catch the next Space press.
    if (this.inPlay()) el.blur();
  }

  private readonly onDismiss = (e: MouseEvent): void => {
    this.releaseFocus(e.currentTarget as HTMLElement);
    this.hide();
  };

  private readonly onDownload = (e: MouseEvent): void => {
    if (!this.current) {
      e.preventDefault();
      return;
    }
    this.feedback.textContent = 'Sent to your downloads.';
    this.releaseFocus(e.currentTarget as HTMLElement);
  };

  private readonly onCopy = async (e: MouseEvent): Promise<void> => {
    const button = e.currentTarget as HTMLElement;
    this.releaseFocus(button);
    const clip = this.current;
    if (!clip) return;
    const outcome = await this.copy(clip);
    this.feedback.textContent =
      outcome === 'gif'
        ? 'Copied. Paste it anywhere that takes a picture.'
        : outcome === 'still'
          ? 'Copied the busiest frame as a still. The clipboard will not carry moving pictures here; Download keeps the motion.'
          : 'The clipboard declined. Download keeps the whole clip.';
  };

  private async copy(clip: ClipReady): Promise<'gif' | 'still' | 'failed'> {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    const Item = typeof ClipboardItem !== 'undefined' ? (ClipboardItem as ClipboardItemStatic) : undefined;
    if (!clipboard?.write || !Item) return 'failed';
    if (Item.supports?.('image/gif')) {
      try {
        await clipboard.write([new Item({ 'image/gif': clip.blob })]);
        return 'gif';
      } catch {
        /* fall through to the still */
      }
    }
    if (clip.poster) {
      try {
        await clipboard.write([new Item({ 'image/png': clip.poster })]);
        return 'still';
      } catch {
        return 'failed';
      }
    }
    return 'failed';
  }

  private readonly onDeathClip = (): void => {
    this.ctx.events.emit('clipRequested', { reason: 'death' });
  };

  private setDeathButton(label: string, disabled: boolean): void {
    this.deathBtn.disabled = disabled;
    const labelEl = this.deathBtn.querySelector('.go-clip-label');
    if (labelEl) labelEl.textContent = label;
  }

  private resetDeathButton(): void {
    const key = keyLabel(getBindings().clip);
    this.deathBtn.innerHTML = `<span class="go-clip-glyph" aria-hidden="true"></span><span class="go-clip-label">Save the last seconds</span><kbd class="key">${key}</kbd>`;
    this.deathBtn.disabled = false;
    this.deathBtn.hidden = !this.deathAvailable;
    this.deathBtn.title = 'Keep the last few seconds before the fall as a GIF';
  }
}
