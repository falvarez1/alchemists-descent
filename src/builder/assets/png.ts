/**
 * Browser PNG codec — deliberately ZERO mapping logic (that lives in
 * pixmap.ts where vitest can reach it; this file is proven by the headless
 * probe instead, the only place real canvas color behavior can be tested).
 *
 * Decode disables color management (`colorSpaceConversion: 'none'`) and
 * premultiplication: ICC profiles embedded by Photoshop are the main way
 * browsers silently shift pixel values. Opaque pixels then round-trip
 * exactly; semi-transparent ones are the importer's warning case.
 */

/** Refuse to decode anything larger before allocating buffers. */
export const PNG_DIM_CAP = 2048;

export async function rgbaToPngBlob(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(w, h);
  img.data.set(rgba);
  g.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))),
      'image/png',
    );
  });
}

export async function pngBlobToRgba(
  blob: Blob,
): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    if (bitmap.width > PNG_DIM_CAP || bitmap.height > PNG_DIM_CAP) {
      throw new Error(`image larger than ${PNG_DIM_CAP}px`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    g.drawImage(bitmap, 0, 0);
    const data = g.getImageData(0, 0, bitmap.width, bitmap.height);
    return { rgba: data.data, w: bitmap.width, h: bitmap.height };
  } finally {
    bitmap.close();
  }
}
