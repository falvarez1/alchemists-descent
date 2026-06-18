import { describe, expect, it } from 'vitest';

import { rleDecodeExact, rleEncode } from '@/core/rle';

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
