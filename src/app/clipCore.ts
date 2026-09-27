/**
 * Clips — the pure half. Everything here is DOM-free and worker-safe: ring
 * indexing, capture cadence, GIF timing, pixel packing, the transparency diff
 * and filenames. `app/Clips.ts` (main thread) and `app/clips.worker.ts` (the
 * ring + encoder) both build on it, and tests/clips.test.ts pins it down.
 */

/** Capture rate. 15 fps is every 4th frame at 60 Hz — smooth enough for a blast, cheap enough to keep. */
export const CLIP_FPS = 15;
/** How far back a clip reaches. */
export const CLIP_SECONDS = 10;
/** Captured (and exported) width in pixels; height follows the canvas aspect. */
export const CLIP_WIDTH = 480;
/** Export budget: a clip should post anywhere (Discord's free tier is ~10 MB). */
export const CLIP_MAX_BYTES = 8 * 1024 * 1024;
/** Frames the ring holds: CLIP_FPS × CLIP_SECONDS. */
export const CLIP_CAPACITY = CLIP_FPS * CLIP_SECONDS;
/** Nominal spacing between captured frames. */
export const CLIP_INTERVAL_MS = 1000 / CLIP_FPS;
/**
 * After a death the ring keeps rolling this long (the blow, the ragdoll, the
 * colour draining out) and then holds still until the alchemist returns, so a
 * "Save the last seconds" from the death screen still holds the fatal moment.
 * Matches DeathCinema's title beat (2.6 s) plus a breath.
 */
export const DEATH_TAIL_MS = 2800;

/** Output size for a source canvas: CLIP_WIDTH wide (never upscaled), height by aspect, both even. */
export function clipSize(srcW: number, srcH: number, targetW = CLIP_WIDTH): { w: number; h: number } {
  const w = Math.max(2, Math.min(Math.round(targetW), Math.round(srcW)));
  const h = Math.max(2, Math.round((w * srcH) / Math.max(1, srcW)));
  return { w: w - (w % 2), h: h - (h % 2) };
}

/**
 * Fixed-capacity ring over slot indices. The storage lives with the caller
 * (typed arrays in the worker); this only answers "which slot next" and
 * "which slots, oldest first".
 */
export class RingIndex {
  private head = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`RingIndex capacity must be a positive integer, got ${capacity}`);
  }

  get count(): number {
    return this.filled;
  }

  /** Claim the slot for the next frame (overwrites the oldest once full). */
  push(): number {
    const slot = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
    return slot;
  }

  /** Slots in capture order, oldest first. */
  oldestFirst(): number[] {
    const out: number[] = [];
    const start = this.filled < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.filled; i++) out.push((start + i) % this.capacity);
    return out;
  }

  clear(): void {
    this.head = 0;
    this.filled = 0;
  }
}

/**
 * Decimates presentation frames (60/120/144 Hz rAF) down to CLIP_FPS on
 * wall-clock time. A little slack absorbs rAF jitter so 60 Hz lands on exactly
 * every 4th frame; a stall (pause, hidden tab) resyncs instead of bursting.
 */
export class CaptureCadence {
  private next: number | null = null;

  constructor(readonly intervalMs = CLIP_INTERVAL_MS, readonly slackMs = 4) {}

  due(now: number): boolean {
    if (this.next === null) {
      this.next = now + this.intervalMs;
      return true;
    }
    if (now < this.next - this.slackMs) return false;
    this.next += this.intervalMs;
    if (now - this.next > this.intervalMs) this.next = now + this.intervalMs;
    return true;
  }

  /** Forget the phase (after a pause the next frame captures immediately). */
  reset(): void {
    this.next = null;
  }
}

/**
 * GIF frame delays in centiseconds from capture timestamps. Gaps (a pause, a
 * dropped frame) are clamped so the clip never "hangs"; rounding is done on
 * cumulative time so 66.7 ms frames come out 7,7,6,7,7,6 and the clip keeps
 * real-time pace. Browsers treat delays under 2 cs as 10 cs, so 2 is the floor.
 */
export function gifDelaysCs(times: readonly number[], nominalMs = CLIP_INTERVAL_MS, maxGapFactor = 2): number[] {
  const n = times.length;
  if (n === 0) return [];
  const maxGap = nominalMs * maxGapFactor;
  const cumulative: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const raw = i < n ? times[i] - times[i - 1] : nominalMs;
    const gap = Number.isFinite(raw) ? Math.min(maxGap, Math.max(nominalMs * 0.25, raw)) : nominalMs;
    cumulative.push(cumulative[i - 1] + gap);
  }
  const delays: number[] = [];
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const want = Math.round(cumulative[i + 1] / 10) - Math.round(cumulative[i] / 10) + carry;
    const d = Math.max(2, want);
    carry = want - d; // negative when the floor lengthened a frame; later frames give it back
    delays.push(d);
  }
  return delays;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `${slug}-YYYYMMDD-HHMMSS.gif` in local time. */
export function clipFilename(date: Date, slug: string): string {
  const d = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const t = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${slug}-${d}-${t}.gif`;
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on', 'to']);

/**
 * "THE KILN HEART" → "The Kiln Heart". Level names are authored in capitals for
 * the HUD; the watermark wants them set like a book title.
 */
export function titleCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * The place line under the watermark. A floor whose name IS the game's title
 * ("The Breathing Works" in a game called Breathing Works) reads as a stutter,
 * so it falls back to the floor number.
 */
export function placeLabel(levelName: string | null | undefined, depth: number | null | undefined, gameTitle: string): string {
  const norm = (s: string): string => s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (levelName && levelName.trim()) {
    if (norm(levelName) !== norm(gameTitle)) return titleCase(levelName);
  }
  return depth && depth > 0 ? floorWords(depth) : 'The Workshop';
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

/** "First Floor" — the house serif's old-style "1" reads as an "I", so floors are spelled out. */
export function floorWords(depth: number): string {
  const word = ORDINALS[Math.floor(depth) - 1];
  return word ? `${word} Floor` : `Floor ${Math.floor(depth)}`;
}

// ---------------------------------------------------------------------------
// Pixels. Frames are held as RGB565 (2 bytes/px): the GIF is quantized to 256
// colours anyway, and gifenc's own histogram bins at 5-5-5, so 565 costs no
// visible quality and halves the ring.
// ---------------------------------------------------------------------------

export function rgbTo565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/** Expand one 565 value to 8-bit channels (bit replication, so 0x1f → 255). */
export function rgb565ToRgb(v: number): [number, number, number] {
  const r5 = (v >> 11) & 0x1f;
  const g6 = (v >> 5) & 0x3f;
  const b5 = v & 0x1f;
  return [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)];
}

/** RGBA bytes (ImageData layout) → 565 words. `out` must hold rgba.length / 4 entries. */
export function packRgb565(rgba: Uint8Array | Uint8ClampedArray, out: Uint16Array): void {
  const n = Math.min(out.length, rgba.length >> 2);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = ((rgba[j] & 0xf8) << 8) | ((rgba[j + 1] & 0xfc) << 3) | (rgba[j + 2] >> 3);
  }
}

/** 565 words → opaque RGBA bytes. */
export function unpackRgb565(src: Uint16Array, out: Uint8Array | Uint8ClampedArray): void {
  const n = Math.min(src.length, out.length >> 2);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const v = src[i];
    const r5 = (v >> 11) & 0x1f;
    const g6 = (v >> 5) & 0x3f;
    const b5 = v & 0x1f;
    out[j] = (r5 << 3) | (r5 >> 2);
    out[j + 1] = (g6 << 2) | (g6 >> 4);
    out[j + 2] = (b5 << 3) | (b5 >> 2);
    out[j + 3] = 255;
  }
}

/** A straight-alpha RGBA sprite placed on a frame (the watermark, a death title card). */
export interface Overlay {
  rgba: Uint8Array | Uint8ClampedArray;
  w: number;
  h: number;
  x: number;
  y: number;
  /** Only on the last `fromEnd` frames of the clip (undefined: every frame). */
  fromEnd?: number;
  /** Frames to fade in over once it starts. */
  fadeFrames?: number;
}

/**
 * Opacity of an overlay on the frame `framesFromEnd` before the clip's last
 * (0 = the last frame). Eased so a title card settles in rather than blinks.
 */
export function overlayAlpha(overlay: Pick<Overlay, 'fromEnd' | 'fadeFrames'>, framesFromEnd: number): number {
  if (overlay.fromEnd === undefined) return 1;
  if (framesFromEnd >= overlay.fromEnd) return 0;
  const fade = Math.max(1, overlay.fadeFrames ?? 1);
  const t = Math.min(1, (overlay.fromEnd - framesFromEnd) / fade);
  return 1 - (1 - t) * (1 - t);
}

/** Alpha-composite an overlay onto a 565 frame in place (clipped to the frame), scaled by `opacity`. */
export function compositeOver565(frame: Uint16Array, fw: number, fh: number, overlay: Overlay, opacity = 1): void {
  if (opacity <= 0) return;
  const { rgba, w, h, x: ox, y: oy } = overlay;
  for (let y = 0; y < h; y++) {
    const fy = oy + y;
    if (fy < 0 || fy >= fh) continue;
    for (let x = 0; x < w; x++) {
      const fx = ox + x;
      if (fx < 0 || fx >= fw) continue;
      const s = (y * w + x) * 4;
      const a = opacity >= 1 ? rgba[s + 3] : Math.round(rgba[s + 3] * opacity);
      if (a === 0) continue;
      const i = fy * fw + fx;
      if (a === 255) {
        frame[i] = rgbTo565(rgba[s], rgba[s + 1], rgba[s + 2]);
        continue;
      }
      const [r, g, b] = rgb565ToRgb(frame[i]);
      const k = a / 255;
      frame[i] = rgbTo565(
        Math.round(rgba[s] * k + r * (1 - k)),
        Math.round(rgba[s + 1] * k + g * (1 - k)),
        Math.round(rgba[s + 2] * k + b * (1 - k)),
      );
    }
  }
}

export type Palette = ReadonlyArray<readonly number[]>;

/**
 * Nearest-palette mapping for 565 frames with a persistent cache (one entry
 * per possible 565 value), so a clip's frames share the lookups instead of
 * re-searching the palette every frame.
 */
export class PaletteMapper {
  private readonly cache = new Int16Array(65536).fill(-1);
  private readonly pr: Int32Array;
  private readonly pg: Int32Array;
  private readonly pb: Int32Array;

  constructor(readonly palette: Palette, readonly colors = palette.length) {
    this.pr = new Int32Array(colors);
    this.pg = new Int32Array(colors);
    this.pb = new Int32Array(colors);
    for (let i = 0; i < colors; i++) {
      this.pr[i] = palette[i][0];
      this.pg[i] = palette[i][1];
      this.pb[i] = palette[i][2];
    }
  }

  indexOf565(v: number): number {
    const hit = this.cache[v];
    if (hit >= 0) return hit;
    const [r, g, b] = rgb565ToRgb(v);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.colors; i++) {
      const dr = this.pr[i] - r;
      const dg = this.pg[i] - g;
      const db = this.pb[i] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
        if (d === 0) break;
      }
    }
    this.cache[v] = best;
    return best;
  }

  map(frame: Uint16Array, out: Uint8Array): void {
    for (let i = 0; i < frame.length; i++) out[i] = this.indexOf565(frame[i]);
  }
}

/**
 * Inter-frame transparency: a pixel whose colour the viewer already sees
 * (within `fuzzSq`, squared RGB distance between palette entries) becomes
 * `transparentIndex`, so the GIF only spends bytes on what moved. `displayed`
 * tracks what the viewer sees (-1 = nothing yet) and is updated in place.
 * Returns how many pixels actually changed.
 */
export function diffAgainstDisplayed(
  index: Uint8Array,
  displayed: Int16Array,
  palette: Palette,
  fuzzSq: number,
  transparentIndex: number,
): number {
  let changed = 0;
  for (let i = 0; i < index.length; i++) {
    const next = index[i];
    const shown = displayed[i];
    if (shown === next) {
      index[i] = transparentIndex;
      continue;
    }
    if (shown >= 0 && fuzzSq > 0) {
      const a = palette[next];
      const b = palette[shown];
      const dr = a[0] - b[0];
      const dg = a[1] - b[1];
      const db = a[2] - b[2];
      if (dr * dr + dg * dg + db * db <= fuzzSq) {
        index[i] = transparentIndex;
        continue;
      }
    }
    displayed[i] = next;
    changed++;
  }
  return changed;
}

/** Average and 95th percentile of a sample set (probe/perf readouts). */
export function summarizeMs(samples: ArrayLike<number>): { n: number; avg: number; p95: number; max: number } {
  const s = Array.from(samples).filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return { n: 0, avg: 0, p95: 0, max: 0 };
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, avg, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] };
}

/** "1.9 MB", "740 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
