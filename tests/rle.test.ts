import { describe, expect, it } from 'vitest';

import {
  packColorDiffs,
  packIndexRuns,
  packValueRuns,
  rleDecodeExact,
  rleEncode,
  unpackColorDiffs,
  unpackIndexRuns,
  unpackValueRuns,
} from '@/core/rle';

describe('rle codec', () => {
  it('decodes only streams that exactly cover the destination buffer', () => {
    const source = new Uint8Array([1, 1, 2, 2, 2, 3]);
    const exact = new Uint8Array(source.length);
    const tooShort = new Uint8Array(source.length + 1);

    expect(rleDecodeExact(rleEncode(source), exact)).toBe(true);
    expect(exact).toEqual(source);
    expect(rleDecodeExact(rleEncode(source), tooShort)).toBe(false);
    expect(rleDecodeExact('not base64', new Uint8Array(source.length))).toBe(false);
  });
});

describe('packed colour differences (world layer tints)', () => {
  /** A seeded scatter of differences: noisy cells, flat slabs, the first and last cell. */
  function scene(): { base: Uint32Array; colors: Uint32Array } {
    const n = 4000;
    const base = new Uint32Array(n);
    for (let i = 0; i < n; i++) base[i] = (i * 2654435761) >>> 8;
    const colors = base.slice();
    let s = 12345;
    const rand = (): number => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
    for (let k = 0; k < 300; k++) colors[Math.floor(rand() * n)] = Math.floor(rand() * 0xffffff);
    for (let i = 1000; i < 1240; i++) colors[i] = 0x2266dd; // an authored slab
    for (let i = 1240; i < 1244; i++) colors[i] = 0x111111 + i; // noise right after it
    colors[0] = 0xabcdef;
    colors[n - 1] = 0x123456;
    return { base, colors };
  }

  it('round-trips exactly onto the base, touching only the differing cells', () => {
    const { base, colors } = scene();
    const packed = packColorDiffs(colors, base);
    const out = base.slice();
    const touched: number[] = [];
    expect(unpackColorDiffs(packed, out, (i) => touched.push(i))).toBe(true);
    expect(out).toEqual(colors);
    for (const i of touched) expect(colors[i]).not.toBe(base[i]);
    expect(touched.length).toBe(colors.filter((c, i) => c !== base[i]).length);
  });

  it('packs a flat slab as runs, a few bytes, not a few per cell', () => {
    const base = new Uint32Array(100_000);
    const colors = base.slice();
    for (let row = 0; row < 50; row++) for (let x = 0; x < 200; x++) colors[row * 1000 + x] = 0x445566;
    expect(packColorDiffs(colors, base).length).toBeLessThan(50 * 10); // 10,000 cells, 50 runs of ~7 bytes
  });

  it('is empty when nothing differs', () => {
    const base = new Uint32Array(64).fill(7);
    expect(packColorDiffs(base.slice(), base)).toBe('');
  });

  it('refuses a stream that runs past the plane or is cut short, and writes nothing out of bounds', () => {
    const { base, colors } = scene();
    const packed = packColorDiffs(colors, base);
    const small = new Uint32Array(500);
    expect(unpackColorDiffs(packed, small)).toBe(false);
    const truncated = packed.slice(0, Math.floor(packed.length / 2 / 4) * 4);
    expect(unpackColorDiffs(truncated, base.slice())).toBe(false);
    expect(unpackColorDiffs('not base64 !!', base.slice())).toBe(false);
  });
});

describe('packed index runs (world layer scars)', () => {
  it('round-trips a mask and refuses an index past the limit', () => {
    const mask = new Uint8Array(5000);
    for (const i of [0, 1, 2, 3, 99, 1000, 1001, 4999]) mask[i] = 1;
    const packed = packIndexRuns(mask);
    const seen: number[] = [];
    expect(unpackIndexRuns(packed, mask.length, (i) => seen.push(i))).toBe(true);
    expect(seen).toEqual([0, 1, 2, 3, 99, 1000, 1001, 4999]);
    expect(unpackIndexRuns(packed, 4000, () => undefined)).toBe(false);
    expect(packIndexRuns(new Uint8Array(10))).toBe('');
  });
});

describe('packed value runs (world layer life and charge)', () => {
  it('round-trips signed values, keeps only what keep() allows, and refuses an overrun', () => {
    const life = new Int16Array(3000);
    for (let i = 100; i < 160; i++) life[i] = -1; // a settled lawn
    life[5] = 321;
    life[6] = -32768;
    life[7] = 32767;
    life[2999] = 4;
    life[2000] = 77; // dropped by keep
    const packed = packValueRuns(life, (i) => i !== 2000);
    const back = new Int16Array(life.length);
    expect(unpackValueRuns(packed, life.length, (i, v) => { back[i] = v; })).toBe(true);
    const expected = life.slice();
    expected[2000] = 0;
    expect(back).toEqual(expected);
    expect(unpackValueRuns(packed, 2500, () => undefined)).toBe(false);
    expect(packValueRuns(new Uint16Array(9))).toBe('');
  });
});
