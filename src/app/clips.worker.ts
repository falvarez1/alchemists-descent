/**
 * Clips worker: holds the rolling ring of captured frames and encodes it to
 * GIF, entirely off the main thread.
 *
 * Frames arrive as GPU-downscaled ImageBitmaps (the main thread's only cost is
 * one createImageBitmap per captured frame). The readback to CPU pixels
 * happens HERE, into an OffscreenCanvas, and the pixels are packed to RGB565 —
 * 2 bytes/px, so 150 frames at 480×270 hold ~39 MB instead of ~78 MB of
 * GPU-side bitmaps.
 *
 * Encoding: one global palette built from samples across the whole clip (no
 * colour flicker between frames, and it lets unchanged pixels go transparent),
 * no dithering (dither noise destroys pixel art and the LZW compression), and
 * inter-frame transparency so a GIF only spends bytes on what moved.
 */
import { GIFEncoder, quantize, type GifPalette } from 'gifenc';
import {
  PaletteMapper,
  RingIndex,
  compositeOver565,
  diffAgainstDisplayed,
  overlayAlpha,
  gifDelaysCs,
  packRgb565,
  rgb565ToRgb,
  unpackRgb565,
  type Overlay,
} from '@/app/clipCore';
import type { ClipEncodeStats, ClipOverlayMessage, ClipWorkerRequest, ClipWorkerResponse } from '@/app/clipProtocol';

let ring = new RingIndex(1);
let frames: (Uint16Array | null)[] = [];
let times = new Float64Array(1);
let width = 0;
let height = 0;
let reader: OffscreenCanvasRenderingContext2D | null = null;
let held = 0;
/** True while a clip is being encoded: the ring is frozen and late frames are dropped. */
let frozen = false;

function post(message: ClipWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as { postMessage(m: ClipWorkerResponse, t: Transferable[]): void }).postMessage(message, transfer);
}

function configure(capacity: number): void {
  ring = new RingIndex(Math.max(1, Math.floor(capacity)));
  frames = new Array<Uint16Array | null>(ring.capacity).fill(null);
  times = new Float64Array(ring.capacity);
  held = 0;
}

function clear(): void {
  ring.clear();
  // Release the pixel memory, not just the indices: a player who turns
  // recording off expects the ~39 MB back.
  frames.fill(null);
  held = 0;
}

function ingest(bitmap: ImageBitmap, t: number): void {
  try {
    // A frame captured just before the request can arrive mid-encode; writing
    // it would overwrite the clip's oldest slot. It is dropped instead.
    if (frozen) return;
    const w = bitmap.width;
    const h = bitmap.height;
    if (w !== width || h !== height || !reader) {
      width = w;
      height = h;
      reader = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true, alpha: false });
      clear();
    }
    if (!reader) return;
    reader.drawImage(bitmap, 0, 0);
    const pixels = reader.getImageData(0, 0, w, h).data;
    const slot = ring.push();
    let store = frames[slot];
    if (!store || store.length !== w * h) store = frames[slot] = new Uint16Array(w * h);
    packRgb565(pixels, store);
    times[slot] = t;
    held = ring.count;
    if (held === 1 || held % 15 === 0) post({ type: 'held', frames: held, width: w, height: h });
  } finally {
    bitmap.close();
  }
}

function toOverlay(o: ClipOverlayMessage): Overlay {
  return { rgba: new Uint8Array(o.rgba), w: o.w, h: o.h, x: o.x, y: o.y, fromEnd: o.fromEnd, fadeFrames: o.fadeFrames };
}

/**
 * Frame `pos` of the frozen clip (0 = oldest) into `scratch`, with every
 * overlay composited at its opacity for that position. Returns false when the
 * slot is empty.
 */
function composeFrame(slots: number[], pos: number, overlays: Overlay[], scratch: Uint16Array): boolean {
  const src = frames[slots[pos]];
  if (!src) return false;
  scratch.set(src);
  const fromEnd = slots.length - 1 - pos;
  for (const o of overlays) compositeOver565(scratch, width, height, o, overlayAlpha(o, fromEnd));
  return true;
}

interface EncodePass {
  /** Keep every Nth frame. */
  stride: number;
  /** Largest RGB distance treated as "unchanged" by the transparency diff. */
  fuzz: number;
}

/**
 * The size ladder, tried in order until the GIF fits the byte budget.
 * Measured on one 10 s clip with the camera moving the whole time (the worst
 * case for inter-frame transparency): fuzz 0 → 7.7 MB, 6 → 7.1, 10 → 5.2,
 * 16 → 3.5, and stride 2 at 16 → 2.1 MB. Fuzz 10 differs from the exact frame
 * by at most 9/255 per pixel (mean 0.9): invisible, so it is the default; a
 * still camera lands around 3–4 MB. The later passes only run for clips that
 * would not post.
 */
const CLIP_PASSES: EncodePass[] = [
  { stride: 1, fuzz: 10 },
  { stride: 1, fuzz: 18 },
  { stride: 2, fuzz: 18 },
];

interface EncodeResult {
  bytes: Uint8Array<ArrayBuffer>;
  frames: number;
  durationMs: number;
  paletteColors: number;
  paletteMs: number;
  /** Position (0 = oldest) of the frame used for the still. */
  posterPos: number;
}

/**
 * Global palette from pixels sampled across the clip. Sampling every frame at
 * a stride (rather than a few whole frames) catches a one-frame explosion
 * flash, which is exactly the colour a clip must not lose.
 */
function buildPalette(slots: number[], overlays: Overlay[], scratch: Uint16Array): GifPalette {
  const px = width * height;
  const budget = 1_200_000; // sampled pixels across the clip
  const perFrame = Math.max(1, Math.floor(budget / Math.max(1, slots.length)));
  const step = Math.max(1, Math.floor(px / perFrame));
  const samples = new Uint8Array(Math.ceil(px / step) * slots.length * 4 + overlays.reduce((n, o) => n + o.w * o.h * 4, 0));
  let k = 0;
  for (let pos = 0; pos < slots.length; pos++) {
    if (!composeFrame(slots, pos, overlays, scratch)) continue;
    // Offset the phase per frame so the sampled lattice does not alias one column.
    for (let i = (pos * 7) % step; i < px; i += step) {
      const [r, g, b] = rgb565ToRgb(scratch[i]);
      samples[k++] = r;
      samples[k++] = g;
      samples[k++] = b;
      samples[k++] = 255;
    }
  }
  // Overlays (the watermark) are a few hundred pixels in a sea of cave: weigh
  // them in explicitly so their brass and shadow get palette entries.
  for (const o of overlays) {
    for (let i = 0; i < o.w * o.h; i++) {
      if (o.rgba[i * 4 + 3] < 128) continue;
      samples[k++] = o.rgba[i * 4];
      samples[k++] = o.rgba[i * 4 + 1];
      samples[k++] = o.rgba[i * 4 + 2];
      samples[k++] = 255;
    }
  }
  // 255 colours: index 255 is reserved for "unchanged" (transparent).
  return quantize(samples.subarray(0, k), 255, { format: 'rgb565' });
}

function encodePass(
  id: number,
  slots: number[],
  overlays: Overlay[],
  nominalMs: number,
  pass: EncodePass,
  progressBase: number,
  progressSpan: number,
  passIndex: number,
): EncodeResult {
  const px = width * height;
  const scratch = new Uint16Array(px);
  const t0 = performance.now();
  const palette = buildPalette(slots, overlays, scratch);
  const paletteMs = performance.now() - t0;
  const colors = palette.length;
  const transparentIndex = colors; // first free slot after the real colours
  const gifPalette: GifPalette = palette.map((c) => [c[0], c[1], c[2]]);
  gifPalette.push([0, 0, 0]);
  const mapper = new PaletteMapper(gifPalette, colors);

  // Positions (0 = oldest) of the frames this pass writes; the last frame is
  // always kept so the clip still ends on the moment.
  const chosen: number[] = [];
  for (let pos = 0; pos < slots.length; pos++) if (pos % pass.stride === 0 || pos === slots.length - 1) chosen.push(pos);
  const chosenTimes = chosen.map((pos) => times[slots[pos]]);
  const delays = gifDelaysCs(chosenTimes, nominalMs * pass.stride);
  const fuzzSq = pass.fuzz * pass.fuzz;

  const gif = GIFEncoder({ initialCapacity: 1 << 20 });
  const displayed = new Int16Array(px).fill(-1);
  let pending: { index: Uint8Array; delayCs: number } | null = null;
  let written = 0;
  let durationCs = 0;
  // The poster (the still for "Copy") is the busiest frame after the first:
  // usually the blast, not the calm before it. A clip that ends on a title
  // card (a death) is posted as its last frame, title and all.
  const endsOnCard = overlays.some((o) => o.fromEnd !== undefined);
  let posterPos = chosen[chosen.length - 1] ?? 0;
  let posterScore = endsOnCard ? Infinity : -1;
  const write = (frame: { index: Uint8Array; delayCs: number }): void => {
    gif.writeFrame(frame.index, width, height, {
      palette: written === 0 ? gifPalette : undefined,
      delay: frame.delayCs * 10,
      transparent: written > 0,
      transparentIndex,
      dispose: 1, // keep: transparent pixels show the frame beneath
      repeat: 0,
    });
    durationCs += frame.delayCs;
    written++;
  };

  for (let f = 0; f < chosen.length; f++) {
    if (!composeFrame(slots, chosen[f], overlays, scratch)) continue;
    const index = new Uint8Array(px);
    mapper.map(scratch, index);
    const changed = diffAgainstDisplayed(index, displayed, gifPalette, fuzzSq, transparentIndex);
    if (f > 0 && changed >= posterScore) {
      posterScore = changed;
      posterPos = chosen[f];
    }
    if (pending && changed === 0) {
      pending.delayCs += delays[f];
    } else {
      if (pending) write(pending);
      pending = { index, delayCs: delays[f] };
    }
    if (f % 6 === 0) post({ type: 'progress', id, progress: progressBase + progressSpan * ((f + 1) / chosen.length), pass: passIndex });
  }
  if (pending) write(pending);
  gif.finish();
  return { bytes: gif.bytes(), frames: written, durationMs: durationCs * 10, paletteColors: colors, paletteMs, posterPos };
}

async function posterPng(slots: number[], pos: number, overlays: Overlay[]): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const scratch = new Uint16Array(width * height);
    if (!composeFrame(slots, pos, overlays, scratch)) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    unpackRgb565(scratch, rgba);
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.putImageData(new ImageData(rgba, width, height), 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } catch {
    return null;
  }
}

async function postStill(id: number, slot: number): Promise<void> {
  const src = frames[slot];
  if (!src) return;
  try {
    const rgba = new Uint8ClampedArray(width * height * 4);
    unpackRgb565(src, rgba);
    const bitmap = await createImageBitmap(new ImageData(rgba, width, height));
    post({ type: 'still', id, bitmap }, [bitmap]);
  } catch {
    /* The card simply develops without a still. */
  }
}

async function encode(request: Extract<ClipWorkerRequest, { type: 'encode' }>): Promise<void> {
  const { id } = request;
  // Freeze: the slot list is taken NOW. Frames that arrive while we encode
  // queue behind this message and land in the ring afterwards.
  const slots = ring.oldestFirst().filter((s) => frames[s] !== null);
  if (slots.length < 2) {
    post({ type: 'error', id, message: 'nothing on the plate yet' });
    return;
  }
  const overlays = request.overlays.map(toOverlay);
  const started = performance.now();
  await postStill(id, slots[slots.length - 1]);
  post({ type: 'progress', id, progress: 0.02, pass: 0 });
  const passes: EncodePass[] = CLIP_PASSES;
  let result: EncodeResult | null = null;
  let used: EncodePass = passes[0];
  let passCount = 0;
  for (let p = 0; p < passes.length; p++) {
    used = passes[p];
    passCount++;
    // A retry winds the ring back a little (and the card says why) rather
    // than pretending the first pass was the whole job.
    const base = p === 0 ? 0.04 : 0.45 + 0.2 * (p - 1);
    const span = 0.92 - base;
    if (p > 0) post({ type: 'progress', id, progress: base, pass: p });
    result = encodePass(id, slots, overlays, request.nominalMs, used, base, span, p);
    if (result.bytes.length <= request.maxBytes) break;
  }
  if (!result) return;
  const poster = await posterPng(slots, result.posterPos, overlays);
  const gif = result.bytes.buffer;
  const stats: ClipEncodeStats = {
    sourceFrames: slots.length,
    frames: result.frames,
    width,
    height,
    durationMs: result.durationMs,
    paletteColors: result.paletteColors,
    paletteMs: result.paletteMs,
    encodeMs: performance.now() - started,
    passes: passCount,
    frameStride: used.stride,
    fuzz: used.fuzz,
  };
  post({ type: 'progress', id, progress: 1, pass: passCount - 1 });
  post({ type: 'done', id, gif, poster, stats }, [gif]);
}

let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<ClipWorkerRequest>): void => {
  const message = event.data;
  if (message.type === 'frame') {
    // Frames are synchronous and cheap; do not let them wait on an encode's
    // async tail (the poster PNG) and pile up GPU bitmaps.
    ingest(message.bitmap, message.t);
    return;
  }
  // Freeze on ARRIVAL, not when the queue gets to it: nothing that lands
  // after the request may touch the ring the request is about.
  if (message.type === 'encode') frozen = true;
  queue = queue.then(async () => {
    try {
      if (message.type === 'configure') configure(message.capacity);
      else if (message.type === 'clear') clear();
      else if (message.type === 'encode') await encode(message);
    } catch (error) {
      if (message.type === 'encode') post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (message.type === 'encode') frozen = false;
    }
  });
};
