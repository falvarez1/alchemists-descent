import type { Ctx } from '@/core/types';
import { GAME_SLUG, GAME_TITLE } from '@/config/brand';
import { isClipRecordingEnabled, onClipRecordingChanged } from '@/config/clipSettings';
import { DEFAULT_BINDINGS, gameplayCode } from '@/input/bindings';
import {
  CLIP_CAPACITY,
  CLIP_FPS,
  CLIP_INTERVAL_MS,
  CLIP_MAX_BYTES,
  CaptureCadence,
  DEATH_TAIL_MS,
  clipFilename,
  clipSize,
  placeLabel,
  summarizeMs,
} from '@/app/clipCore';
import type { ClipEncodeStats, ClipWorkerRequest, ClipWorkerResponse } from '@/app/clipProtocol';
import { renderDeathCard, renderWatermark } from '@/app/clipWatermark';
import { ClipCard } from '@/ui/ClipCard';
import { deathCauseLine, deathTitle } from '@/ui/deathCauses';

type ClipReason = 'hotkey' | 'death' | 'summary' | 'button';

/** Bitmaps allowed in flight to the worker before capture skips a frame. */
const MAX_IN_FLIGHT = 3;
/** A clip that has not come back by now is abandoned (worker crashed or hung). */
const ENCODE_TIMEOUT_MS = 45_000;
const STAT_SAMPLES = 1800;
/**
 * The shortest request→reveal. Encoding is fast (~0.5 s), and the reveal is
 * choreographed (shutter, ring, develop, glint); below this it would snap.
 */
const MIN_DEVELOP_MS = 720;
/** A death clip's closing title card: the last 1.3 s, settling in over ~0.5 s. */
const DEATH_CARD_FRAMES = Math.round(CLIP_FPS * 1.3);
const DEATH_CARD_FADE_FRAMES = Math.round(CLIP_FPS * 0.5);

export interface ClipCaptureStats {
  /** afterRender() cost over every rendered frame (the number the budget is about). */
  perFrame: { n: number; avg: number; p95: number; max: number };
  /** Cost of the frames that actually captured. */
  perCapture: { n: number; avg: number; p95: number; max: number };
  heldFrames: number;
  capacity: number;
  width: number;
  height: number;
  /** Pixel memory the worker ring holds when full (RGB565). */
  ringBytes: number;
  /** What the same ring would cost as GPU ImageBitmaps (RGBA8). */
  bitmapRingBytes: number;
  lastEncode: ClipEncodeStats | null;
  lastBytes: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]')));
}

/**
 * Clips: keep the last ~10 seconds of play and hand them over as a GIF.
 *
 * Capture runs right after the renderer draws (Game.renderFrame calls
 * `afterRender`), because the WebGL canvas has no preserveDrawingBuffer and
 * is only readable inside the frame that drew it. The main thread does ONE
 * thing per captured frame: `createImageBitmap(canvas, resize, pixelated)` — a
 * GPU-side nearest-neighbour downscale. The bitmap is transferred to
 * `clips.worker.ts`, which reads it back, packs it to RGB565 and keeps the
 * ring; the GIF is encoded there too, so saving a clip never hitches play.
 *
 * Capture holds still while the game is paused (menus, overlays), on the
 * title screen, in the Builder, in a hidden tab, and a few seconds after a
 * death — so the death screen's "Save the last seconds" still has the fall.
 */
export class Clips {
  private readonly card: ClipCard;
  private worker: Worker | null = null;
  private readonly supported: boolean;
  private enabled = isClipRecordingEnabled();
  private readonly cadence = new CaptureCadence(CLIP_INTERVAL_MS);
  private inFlight = 0;
  private held = 0;
  private width = 0;
  private height = 0;
  private encoding = false;
  private requestId = 0;
  private requestedAt = new Date();
  private encodeTimer: number | null = null;
  private deathAt: number | null = null;
  private deathCause: string | null = null;
  private deathFrame = 0;
  /** Capture waits until play has actually begun (never the boot frames or the title screen). */
  private armed = false;
  private sawTitle = false;
  private developStartedAt = 0;
  private revealTimer: number | null = null;
  private workerRestarts = 0;
  private lastUrl: string | null = null;
  private lastEncode: ClipEncodeStats | null = null;
  private lastBytes = 0;
  private readonly frameCosts = new Float64Array(STAT_SAMPLES).fill(Number.NaN);
  private readonly captureCosts = new Float64Array(STAT_SAMPLES).fill(Number.NaN);
  private frameCursor = 0;
  private captureCursor = 0;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly canvasSource: () => HTMLCanvasElement,
  ) {
    this.supported =
      typeof window !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      typeof createImageBitmap === 'function' &&
      typeof OffscreenCanvas !== 'undefined';
    this.card = new ClipCard(ctx);
    if (this.supported) this.startWorker();

    this.offs.push(
      ctx.events.on('clipRequested', ({ reason }) => this.request(reason)),
      ctx.events.on('playerDied', ({ cause }) => {
        this.deathAt = performance.now();
        // Same inputs the HUD uses for its obituary, so the GIF's card matches.
        this.deathCause = cause;
        this.deathFrame = ctx.state.frameCount;
      }),
      ctx.events.on('playerRespawned', () => { this.afterDeath(); this.card.dismiss(); }),
      ctx.events.on('playerDeathCleared', () => this.afterDeath()),
      ctx.events.on('modeChanged', () => { this.cadence.reset(); this.card.dismiss(); }),
      // A clip card belongs to its moment: the run ending, its ledger opening
      // and a fresh run starting all close it (a plate still developing will
      // still arrive; the player asked for that one).
      ctx.events.on('runEnded', () => this.card.dismiss()),
      ctx.events.on('runLedger', ({ open }) => { if (open) this.card.dismiss(); }),
      ctx.events.on('phialsChanged', ({ reason }) => { if (reason === 'start') this.card.dismiss(); }),
      onClipRecordingChanged((on) => this.setEnabled(on)),
    );
    window.addEventListener('keydown', this.onKeyDown);
    this.card.setDeathButtonAvailable(this.supported && this.enabled);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    for (const off of this.offs.splice(0)) off();
    this.clearEncodeTimer();
    if (this.revealTimer !== null) window.clearTimeout(this.revealTimer);
    this.worker?.terminate();
    this.worker = null;
    this.card.dispose();
    if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
    this.lastUrl = null;
  }

  /**
   * Called by Game right after `renderer.render` — the only moment the
   * drawing buffer is guaranteed to hold this frame. Must stay cheap: the
   * budget is ≤ 0.3 ms per rendered frame on average.
   */
  afterRender(): void {
    const start = performance.now();
    let captured = false;
    if (this.shouldCapture(start)) {
      const now = this.frameTime(start);
      if (this.cadence.due(now)) {
        captured = this.capture(now);
      }
    }
    const cost = performance.now() - start;
    this.frameCosts[this.frameCursor] = cost;
    this.frameCursor = (this.frameCursor + 1) % STAT_SAMPLES;
    if (captured) {
      this.captureCosts[this.captureCursor] = cost;
      this.captureCursor = (this.captureCursor + 1) % STAT_SAMPLES;
    }
  }

  /** Probe/dev readout: capture cost, ring memory, last encode. */
  stats(): ClipCaptureStats {
    const w = this.width || clipSize(1280, 720).w;
    const h = this.height || clipSize(1280, 720).h;
    return {
      perFrame: summarizeMs(this.frameCosts),
      perCapture: summarizeMs(this.captureCosts),
      heldFrames: this.held,
      capacity: CLIP_CAPACITY,
      width: w,
      height: h,
      ringBytes: CLIP_CAPACITY * w * h * 2,
      bitmapRingBytes: CLIP_CAPACITY * w * h * 4,
      lastEncode: this.lastEncode,
      lastBytes: this.lastBytes,
    };
  }

  /** Probe helper: forget the collected timing samples. */
  resetStats(): void {
    this.frameCosts.fill(Number.NaN);
    this.captureCosts.fill(Number.NaN);
    this.frameCursor = 0;
    this.captureCursor = 0;
  }

  private startWorker(): void {
    try {
      this.worker = new Worker(new URL('./clips.worker.ts', import.meta.url), { type: 'module', name: 'clips' });
      this.worker.onmessage = (event: MessageEvent<ClipWorkerResponse>) => this.receive(event.data);
      this.worker.onerror = (event) => {
        console.warn('Clip worker failed', event.message);
        this.failEncode('the darkroom door jammed');
        this.worker?.terminate();
        this.worker = null;
        this.held = 0;
        this.inFlight = 0;
        // The ring is gone with it; start a fresh darkroom (a couple of times, not forever).
        if (this.workerRestarts++ < 2) this.startWorker();
      };
      this.send({ type: 'configure', capacity: CLIP_CAPACITY });
    } catch (error) {
      console.warn('Clip worker could not start', error);
      this.worker = null;
    }
  }

  private send(message: ClipWorkerRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  /** rAF timestamp of the current frame when available (steadier than performance.now()). */
  private frameTime(fallback: number): number {
    const t = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
    return typeof t === 'number' ? t : fallback;
  }

  private shouldCapture(now: number): boolean {
    if (!this.worker || !this.enabled || this.encoding) return false;
    const ctx = this.ctx;
    if (ctx.state.paused || ctx.time.manual) return false;
    if (ctx.state.mode !== 'play' && ctx.state.mode !== 'build') return false;
    if (document.hidden) return false;
    const body = document.body.classList;
    // The title screen and the Builder are not play; nothing to keep there.
    if (body.contains('entry-active')) {
      this.sawTitle = true;
      return false;
    }
    if (body.contains('builder-open')) return false;
    if (!this.armed) {
      // Boot renders a few frames of the workshop before the title screen
      // mounts; arm only once the title has come and gone (or play began).
      if (!this.sawTitle && ctx.state.mode !== 'play') return false;
      this.armed = true;
    }
    if (ctx.player.dead && this.deathAt !== null && now - this.deathAt > DEATH_TAIL_MS) return false;
    return this.inFlight < MAX_IN_FLIGHT;
  }

  private capture(t: number): boolean {
    const canvas = this.canvasSource();
    if (!canvas || canvas.width < 2 || canvas.height < 2) return false;
    const { w, h } = clipSize(canvas.width, canvas.height);
    this.width = w;
    this.height = h;
    let pending: Promise<ImageBitmap>;
    try {
      // Nearest-neighbour on the GPU: the pixel grid stays a pixel grid.
      pending = createImageBitmap(canvas, { resizeWidth: w, resizeHeight: h, resizeQuality: 'pixelated' });
    } catch {
      return false;
    }
    this.inFlight++;
    pending
      .then((bitmap) => {
        this.inFlight--;
        if (!this.worker || !this.enabled) {
          bitmap.close();
          return;
        }
        this.send({ type: 'frame', bitmap, t }, [bitmap]);
        this.held = Math.min(CLIP_CAPACITY, this.held + 1);
        this.card.setDeathButtonAvailable(true);
      })
      .catch(() => {
        this.inFlight--;
      });
    return true;
  }

  private afterDeath(): void {
    this.deathAt = null;
    this.deathCause = null;
    this.cadence.reset();
  }

  private setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.cadence.reset();
    if (!on) {
      this.held = 0;
      this.send({ type: 'clear' });
    }
    this.card.setDeathButtonAvailable(this.supported && on);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (gameplayCode(e.code) !== DEFAULT_BINDINGS.clip) return;
    if (isEditableTarget(e.target)) return;
    // The controls dialog listens for a key to rebind; consoles take text.
    if (document.querySelector('#player-settings[open], #dev-console.open, #runtime-inspector.open')) return;
    const body = document.body.classList;
    if (body.contains('entry-active') || body.contains('builder-open')) return;
    e.preventDefault();
    this.ctx.events.emit('clipRequested', { reason: 'hotkey' });
  };

  private currentPlace(): string {
    const level = this.ctx.levels?.current;
    if (this.ctx.state.mode !== 'play') return 'The Workshop';
    return placeLabel(level?.def.name ?? null, level?.def.depth ?? null, GAME_TITLE);
  }

  /** A request that cannot be met: said in the HUD, and to whoever asked (the ledger). */
  private refuse(message: string): void {
    this.ctx.events.emit('toast', { text: message });
    this.ctx.events.emit('clipFailed', { message });
  }

  private request(reason: ClipReason): void {
    if (!this.supported || !this.worker) {
      this.refuse('This browser cannot keep clips. Try a current Chrome, Edge, Firefox or Safari.');
      return;
    }
    if (!this.enabled) {
      this.refuse('Clip recording is off. Switch it on in Controls & comfort.');
      return;
    }
    if (this.encoding) {
      this.card.nudge();
      return;
    }
    if (this.held < Math.min(8, CLIP_CAPACITY)) {
      this.refuse('Nothing on the plate yet. Give it a few seconds.');
      return;
    }
    // Freeze first: from this line no new frame enters the ring until the
    // clip is out, so the moment that was asked for is the moment encoded.
    this.encoding = true;
    const id = ++this.requestId;
    this.requestedAt = new Date();
    const place = this.currentPlace();
    const seconds = Math.max(1, Math.round(this.held / CLIP_FPS));
    this.developStartedAt = performance.now();
    this.card.shutter(this.ctx.state.reduceFlashes === true);
    this.card.developing({ place, seconds, reason });
    this.clearEncodeTimer();
    this.encodeTimer = window.setTimeout(() => this.failEncode('the plate took too long to develop'), ENCODE_TIMEOUT_MS);
    const w = this.width || clipSize(1280, 720).w;
    const h = this.height || clipSize(1280, 720).h;
    // A clip that holds a finished death (the ring froze on the fall) ends on
    // its title card, exactly as the death does on screen.
    const endsOnDeath =
      this.ctx.player.dead && this.deathAt !== null && performance.now() - this.deathAt >= DEATH_TAIL_MS && this.held > DEATH_CARD_FRAMES * 2;
    const cards = endsOnDeath
      ? renderDeathCard(deathTitle(this.deathCause), deathCauseLine(this.deathCause, this.deathFrame), w, h, DEATH_CARD_FRAMES, DEATH_CARD_FADE_FRAMES)
      : Promise.resolve(null);
    void Promise.all([renderWatermark(GAME_TITLE, place, w, h), cards]).then(([mark, card]) => {
      if (id !== this.requestId || !this.encoding) return;
      const overlays = [card, mark].filter((o): o is NonNullable<typeof o> => o !== null);
      this.send(
        { type: 'encode', id, overlays, nominalMs: CLIP_INTERVAL_MS, maxBytes: CLIP_MAX_BYTES },
        overlays.map((o) => o.rgba),
      );
    });
  }

  private receive(message: ClipWorkerResponse): void {
    if (message.type === 'held') {
      if (!this.enabled) return; // a straggler from before recording was switched off
      this.held = message.frames;
      this.width = message.width;
      this.height = message.height;
      return;
    }
    if (message.id !== this.requestId || !this.encoding) {
      if (message.type === 'still') message.bitmap.close();
      return;
    }
    if (message.type === 'progress') {
      this.card.progress(message.progress, message.pass);
    } else if (message.type === 'still') {
      this.card.showStill(message.bitmap);
    } else if (message.type === 'error') {
      this.failEncode(message.message);
    } else if (message.type === 'done') {
      this.finishEncode(message.gif, message.poster, message.stats);
    }
  }

  private finishEncode(gif: ArrayBuffer, poster: Blob | null, stats: ClipEncodeStats): void {
    this.clearEncodeTimer();
    // Hold the reveal for the choreography's minimum beat. The ring stays
    // frozen until then, so a second press in the gap only nudges the card.
    const wait = Math.max(0, this.developStartedAt + MIN_DEVELOP_MS - performance.now());
    if (this.revealTimer !== null) window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => {
      this.revealTimer = null;
      this.reveal(gif, poster, stats);
    }, wait);
  }

  private reveal(gif: ArrayBuffer, poster: Blob | null, stats: ClipEncodeStats): void {
    this.encoding = false;
    this.cadence.reset();
    const blob = new Blob([gif], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    // One clip at a time stays alive: the newest supersedes the last.
    if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
    this.lastUrl = url;
    this.lastEncode = stats;
    this.lastBytes = blob.size;
    const filename = clipFilename(this.requestedAt, GAME_SLUG);
    this.card.ready({ url, filename, blob, poster, bytes: blob.size, frames: stats.frames, durationMs: stats.durationMs });
    this.ctx.events.emit('clipSaved', { url, filename, bytes: blob.size, frames: stats.frames, durationMs: stats.durationMs });
  }

  private failEncode(reason: string): void {
    if (!this.encoding) return;
    this.clearEncodeTimer();
    this.encoding = false;
    this.cadence.reset();
    this.card.failed(reason);
    this.ctx.events.emit('clipFailed', { message: 'The plate spoiled. Try again in a moment.' });
  }

  private clearEncodeTimer(): void {
    if (this.encodeTimer !== null) window.clearTimeout(this.encodeTimer);
    this.encodeTimer = null;
  }
}
