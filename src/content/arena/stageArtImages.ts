/**
 * Decoded baked stage art (public/assets/arena/<stage>/<file>.png): the cell colours of a slab's hull, and its hanging
 * decor. Loaded once per file in the browser; null until ready (and always null in tests). Collision never waits for it.
 */
export interface StageArtImage { readonly width: number; readonly height: number; readonly pixels: Uint8ClampedArray }

const cache = new Map<string, StageArtImage | 'loading' | 'missing'>();
const waiters = new Map<string, Array<(img: StageArtImage) => void>>();

/** The decoded image at `assets/arena/<path>`, or null while it loads (`onReady` runs once it arrives). */
export function stageArtImage(path: string, onReady?: (img: StageArtImage) => void): StageArtImage | null {
  const hit = cache.get(path);
  if (hit && typeof hit !== 'string') return hit;
  if (onReady) { const list = waiters.get(path) ?? []; list.push(onReady); waiters.set(path, list); }
  if (hit === undefined) load(path);
  return null;
}

function load(path: string): void {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') { cache.set(path, 'missing'); return; }
  cache.set(path, 'loading');
  void (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}assets/arena/${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const canvas = document.createElement('canvas');
      const width = bitmap.width, height = bitmap.height;
      canvas.width = width; canvas.height = height;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      if (!g) throw new Error('no 2d context');
      g.drawImage(bitmap, 0, 0);
      bitmap.close();
      const img = { width, height, pixels: g.getImageData(0, 0, width, height).data };
      cache.set(path, img);
      for (const fn of waiters.get(path) ?? []) fn(img);
    } catch {
      cache.set(path, 'missing');
    } finally {
      waiters.delete(path);
    }
  })();
}
