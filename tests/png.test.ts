import { describe, expect, it } from 'vitest';
import { pngBlobToRgba } from '@/builder/assets/png';

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[8] = 0;
  bytes[9] = 0;
  bytes[10] = 0;
  bytes[11] = 13;
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('PNG import preflight', () => {
  it('rejects oversized dimensions from the header before browser decode', async () => {
    await expect(pngBlobToRgba(new Blob([pngHeader(4096, 64)], { type: 'image/png' }))).rejects.toThrow(
      'image larger than 2048px',
    );
  });

  it('rejects oversized files before reading bytes', async () => {
    const blob = {
      size: Number.MAX_SAFE_INTEGER,
      slice: () => {
        throw new Error('slice should not be called');
      },
    } as unknown as Blob;

    await expect(pngBlobToRgba(blob)).rejects.toThrow('PNG file larger than');
  });
});
