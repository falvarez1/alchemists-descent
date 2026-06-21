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

/** Refuse to decode anything larger before allocating buffers. File-internal. */
const PNG_DIM_CAP = 2048;
const PNG_HEADER_BYTES = 24;
const PNG_BYTE_CAP = 32 * 1024 * 1024;

/**
 * Read width/height straight out of a PNG's IHDR chunk (the first chunk in a
 * valid PNG: 8-byte signature, then a 4-byte length + 'IHDR' tag, then width
 * and height as big-endian uint32 at byte offsets 16 and 20). Returns null for
 * anything that is not a recognizable PNG header so the real decoder can take
 * over and report the failure. This lets us reject a decompression-bomb sized
 * image BEFORE createImageBitmap rasterizes it into memory.
 */
function pngHeaderDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 24) return null;
  // PNG signature: 0x89 'P' 'N' 'G' \r \n 0x1A \n
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return null;
  // First chunk must be IHDR (tag at offset 12).
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

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
  if (blob.size > PNG_BYTE_CAP) {
    throw new Error(`PNG file larger than ${Math.floor(PNG_BYTE_CAP / (1024 * 1024))}MB`);
  }
  // Cap dimensions from the IHDR header BEFORE createImageBitmap rasterizes the
  // image, so a small-on-disk but huge-in-memory PNG is rejected up front. The
  // post-decode check below still guards non-PNG blobs and unparseable headers.
  const header = pngHeaderDimensions(new Uint8Array(await blob.slice(0, PNG_HEADER_BYTES).arrayBuffer()));
  if (header && (header.w > PNG_DIM_CAP || header.h > PNG_DIM_CAP)) {
    throw new Error(`image larger than ${PNG_DIM_CAP}px`);
  }
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
