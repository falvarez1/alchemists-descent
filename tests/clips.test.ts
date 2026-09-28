import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIP_CAPACITY,
  CLIP_FPS,
  CLIP_INTERVAL_MS,
  CaptureCadence,
  PaletteMapper,
  RingIndex,
  clipFilename,
  clipSize,
  compositeOver565,
  diffAgainstDisplayed,
  floorWords,
  formatBytes,
  gifDelaysCs,
  overlayAlpha,
  packRgb565,
  placeLabel,
  rgb565ToRgb,
  rgbTo565,
  summarizeMs,
  titleCase,
  unpackRgb565,
} from '@/app/clipCore';
import { DEFAULT_BINDINGS, sanitizeBindings } from '@/input/bindings';

describe('clip ring', () => {
  it('fills in order, then overwrites the oldest', () => {
    const ring = new RingIndex(4);
    expect([ring.push(), ring.push(), ring.push()]).toEqual([0, 1, 2]);
    expect(ring.count).toBe(3);
    expect(ring.oldestFirst()).toEqual([0, 1, 2]);
    expect([ring.push(), ring.push(), ring.push()]).toEqual([3, 0, 1]);
    expect(ring.count).toBe(4);
    // Slots 0 and 1 now hold the two newest frames; slot 2 is the oldest.
    expect(ring.oldestFirst()).toEqual([2, 3, 0, 1]);
    ring.clear();
    expect(ring.count).toBe(0);
    expect(ring.oldestFirst()).toEqual([]);
    expect(ring.push()).toBe(0);
  });

  it('holds exactly ten seconds at the capture rate', () => {
    expect(CLIP_CAPACITY).toBe(CLIP_FPS * 10);
    const ring = new RingIndex(CLIP_CAPACITY);
    for (let i = 0; i < CLIP_CAPACITY * 3 + 7; i++) ring.push();
    const order = ring.oldestFirst();
    expect(order).toHaveLength(CLIP_CAPACITY);
    expect(new Set(order).size).toBe(CLIP_CAPACITY);
    expect(order[0]).toBe(7); // the next slot to be overwritten is the oldest
  });

  it('rejects a nonsense capacity', () => {
    expect(() => new RingIndex(0)).toThrow();
    expect(() => new RingIndex(2.5)).toThrow();
  });
});

describe('capture cadence', () => {
  const run = (hz: number, seconds: number, cadence = new CaptureCadence()): number[] => {
    const captured: number[] = [];
    const step = 1000 / hz;
    for (let i = 0; i < hz * seconds; i++) {
      // A little rAF jitter, as real frames have.
      const t = 1000 + i * step + (i % 3 === 0 ? 0.6 : -0.4);
      if (cadence.due(t)) captured.push(i);
    }
    return captured;
  };

  it('takes exactly every 4th frame at 60 Hz', () => {
    const frames = run(60, 2);
    expect(frames.length).toBe(30);
    for (let i = 1; i < frames.length; i++) expect(frames[i] - frames[i - 1]).toBe(4);
  });

  it('decimates 144 Hz and 120 Hz down to ~15 fps', () => {
    expect(run(144, 10).length).toBeGreaterThanOrEqual(148);
    expect(run(144, 10).length).toBeLessThanOrEqual(151);
    expect(run(120, 10).length).toBe(150);
  });

  it('resyncs after a stall instead of bursting to catch up', () => {
    const c = new CaptureCadence(CLIP_INTERVAL_MS);
    expect(c.due(0)).toBe(true);
    expect(c.due(20)).toBe(false);
    expect(c.due(3000)).toBe(true); // back from a pause
    expect(c.due(3016)).toBe(false);
    expect(c.due(3033)).toBe(false);
    expect(c.due(3050)).toBe(false);
    expect(c.due(3067)).toBe(true);
  });

  it('captures immediately after a reset', () => {
    const c = new CaptureCadence();
    c.due(0);
    expect(c.due(10)).toBe(false);
    c.reset();
    expect(c.due(10)).toBe(true);
  });
});

describe('GIF timing', () => {
  it('keeps real-time pace at 15 fps (6s and 7s, 20 cs per three frames)', () => {
    const times = Array.from({ length: 150 }, (_, i) => i * (1000 / 15));
    const delays = gifDelaysCs(times);
    expect(delays).toHaveLength(150);
    expect(new Set(delays)).toEqual(new Set([6, 7]));
    for (let i = 0; i + 3 <= delays.length; i += 3) expect(delays[i] + delays[i + 1] + delays[i + 2]).toBe(20);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('clamps a pause gap so the clip never hangs', () => {
    const delays = gifDelaysCs([0, 66.7, 5000, 5066.7]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(14);
  });

  it('never emits a delay browsers would slow down (< 2 cs)', () => {
    const times = [0, 5, 10, 15, 20, 90];
    for (const d of gifDelaysCs(times)) expect(d).toBeGreaterThanOrEqual(2);
  });

  it('handles empty and single-frame clips', () => {
    expect(gifDelaysCs([])).toEqual([]);
    expect(gifDelaysCs([123])).toEqual([7]);
  });
});

describe('naming', () => {
  it('formats the download filename in local time', () => {
    expect(clipFilename(new Date(2026, 8, 26, 9, 30, 5), 'breathing-works')).toBe('breathing-works-20260926-093005.gif');
    expect(clipFilename(new Date(2027, 0, 1, 23, 59, 59), 'x')).toBe('x-20270101-235959.gif');
  });

  it('sets level names like book titles and avoids the title stutter', () => {
    expect(titleCase('THE KILN HEART')).toBe('The Kiln Heart');
    expect(titleCase('PHYSICS TEST ARENA')).toBe('Physics Test Arena');
    expect(titleCase('the rot of the gardens')).toBe('The Rot of the Gardens');
    expect(placeLabel('THE BELLOWS', 1, 'Breathing Works')).toBe('The Bellows');
    expect(placeLabel('THE BREATHING WORKS', 1, 'Breathing Works')).toBe('First Floor');
    expect(placeLabel(null, 3, 'Breathing Works')).toBe('Third Floor');
    expect(placeLabel(null, null, 'Breathing Works')).toBe('The Workshop');
    expect(floorWords(12)).toBe('Floor 12');
  });

  it('formats sizes for the card', () => {
    expect(formatBytes(4_377_230)).toBe('4.2 MB');
    expect(formatBytes(740 * 1024)).toBe('740 KB');
    expect(formatBytes(10)).toBe('1 KB');
  });

  it('sizes the clip from the canvas without upscaling', () => {
    expect(clipSize(1280, 720)).toEqual({ w: 480, h: 270 });
    expect(clipSize(1920, 1080)).toEqual({ w: 480, h: 270 });
    expect(clipSize(320, 180)).toEqual({ w: 320, h: 180 });
  });
});

describe('pixels', () => {
  it('round-trips primaries and extremes through RGB565', () => {
    const cases: [number, number, number][] = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
    const rgba = new Uint8Array(cases.flatMap(([r, g, b]) => [r, g, b, 255]));
    const packed = new Uint16Array(cases.length);
    packRgb565(rgba, packed);
    const back = new Uint8Array(rgba.length);
    unpackRgb565(packed, back);
    expect(Array.from(back)).toEqual(Array.from(rgba));
    expect(rgb565ToRgb(rgbTo565(200, 100, 50)).map((v, i) => Math.abs(v - [200, 100, 50][i]) <= 7)).toEqual([true, true, true]);
  });

  it('alpha-composites an overlay, clipped to the frame', () => {
    const frame = new Uint16Array(4 * 2).fill(rgbTo565(0, 0, 0));
    const overlay = {
      // 2x1: opaque white, then half-transparent white
      rgba: new Uint8Array([255, 255, 255, 255, 255, 255, 255, 128]),
      w: 2,
      h: 1,
      x: 3,
      y: 1,
    };
    compositeOver565(frame, 4, 2, overlay);
    expect(rgb565ToRgb(frame[4 + 3])).toEqual([255, 255, 255]);
    expect(frame[0]).toBe(0);
    // Second pixel falls off the right edge: nothing written, nothing thrown.
    const half = new Uint16Array(1).fill(0);
    compositeOver565(half, 1, 1, { ...overlay, x: 0, y: 0, rgba: new Uint8Array([255, 255, 255, 128]), w: 1 });
    const [r] = rgb565ToRgb(half[0]);
    expect(r).toBeGreaterThan(110);
    expect(r).toBeLessThan(145);
  });

  it('fades a title card in over the closing frames', () => {
    expect(overlayAlpha({}, 999)).toBe(1);
    const card = { fromEnd: 20, fadeFrames: 8 };
    expect(overlayAlpha(card, 25)).toBe(0);
    expect(overlayAlpha(card, 20)).toBe(0);
    expect(overlayAlpha(card, 19)).toBeGreaterThan(0);
    expect(overlayAlpha(card, 16)).toBeLessThan(1);
    expect(overlayAlpha(card, 12)).toBe(1);
    expect(overlayAlpha(card, 0)).toBe(1);
  });

  it('maps to the nearest palette colour and caches it', () => {
    const palette = [[0, 0, 0], [250, 250, 250], [200, 40, 30], [0, 0, 0]];
    const mapper = new PaletteMapper(palette, 3); // index 3 is the reserved transparent slot
    const frame = new Uint16Array([rgbTo565(10, 10, 10), rgbTo565(240, 240, 240), rgbTo565(190, 50, 40), rgbTo565(1, 1, 1)]);
    const out = new Uint8Array(4);
    mapper.map(frame, out);
    expect(Array.from(out)).toEqual([0, 1, 2, 0]);
  });
});

describe('inter-frame transparency', () => {
  const palette = [[0, 0, 0], [10, 10, 10], [200, 0, 0], [0, 0, 0]];
  const T = 3;

  it('writes every pixel of the first frame', () => {
    const displayed = new Int16Array(3).fill(-1);
    const index = new Uint8Array([0, 1, 2]);
    expect(diffAgainstDisplayed(index, displayed, palette, 0, T)).toBe(3);
    expect(Array.from(index)).toEqual([0, 1, 2]);
    expect(Array.from(displayed)).toEqual([0, 1, 2]);
  });

  it('makes unchanged pixels transparent and only spends bytes on what moved', () => {
    const displayed = new Int16Array([0, 1, 2]);
    const index = new Uint8Array([0, 2, 2]);
    expect(diffAgainstDisplayed(index, displayed, palette, 0, T)).toBe(1);
    expect(Array.from(index)).toEqual([T, 2, T]);
    expect(Array.from(displayed)).toEqual([0, 2, 2]);
  });

  it('absorbs near-identical colours within the fuzz (grain), not real changes', () => {
    const displayed = new Int16Array([0, 0]);
    const index = new Uint8Array([1, 2]); // 1 is 17 away in RGB from 0; 2 is far
    expect(diffAgainstDisplayed(index, displayed, palette, 18 * 18, T)).toBe(1);
    expect(Array.from(index)).toEqual([T, 2]);
    expect(Array.from(displayed)).toEqual([0, 2]);
  });
});

describe('clip hotkey binding', () => {
  it('is P by default and remappable like every other action', () => {
    expect(DEFAULT_BINDINGS.clip).toBe('KeyP');
    expect(sanitizeBindings({ clip: 'KeyK' }).clip).toBe('KeyK');
  });

  it('does not wipe a saved layout that already used P', () => {
    // A layout saved before clips existed, with kick moved to P.
    const migrated = sanitizeBindings({ kick: 'KeyP' });
    expect(migrated.kick).toBe('KeyP');
    expect(migrated.clip).toBe('KeyK');
    expect(migrated.left).toBe('KeyA');
    expect(new Set(Object.values(migrated)).size).toBe(Object.keys(migrated).length);
  });

  it('still rejects a genuinely conflicting saved clip key', () => {
    expect(sanitizeBindings({ clip: 'KeyA' })).toEqual(DEFAULT_BINDINGS);
  });
});

describe('record-clips preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('defaults on, persists off, and tells listeners', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const settings = await import('@/config/clipSettings');
    expect(settings.isClipRecordingEnabled()).toBe(true);
    const heard: boolean[] = [];
    const off = settings.onClipRecordingChanged((on) => heard.push(on));
    expect(settings.setClipRecordingEnabled(false)).toBe(true);
    expect(settings.isClipRecordingEnabled()).toBe(false);
    expect(store.get('ad-clip-recording-v1')).toBe('off');
    settings.setClipRecordingEnabled(false); // no change, no event
    settings.setClipRecordingEnabled(true);
    expect(store.has('ad-clip-recording-v1')).toBe(false);
    off();
    settings.setClipRecordingEnabled(false);
    expect(heard).toEqual([false, true]);
  });

  it('survives storage that throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    const settings = await import('@/config/clipSettings');
    expect(settings.isClipRecordingEnabled()).toBe(true);
    expect(settings.setClipRecordingEnabled(false)).toBe(false);
    expect(settings.isClipRecordingEnabled()).toBe(false);
  });
});

describe('timing summaries', () => {
  it('reports average and p95, ignoring unfilled samples', () => {
    const samples = new Float64Array(8).fill(Number.NaN);
    samples.set([0.1, 0.1, 0.1, 0.1, 1]);
    const s = summarizeMs(samples);
    expect(s.n).toBe(5);
    expect(s.avg).toBeCloseTo(0.28, 5);
    expect(s.max).toBe(1);
    expect(summarizeMs([]).n).toBe(0);
  });
});
