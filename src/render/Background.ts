import { BACKDROP_LAYER_SPECS } from '@/config/backdrop';
import type { ParallaxBitmapLayer, ParallaxLayers } from '@/render/pixels';

function fallbackPixel(alpha: number): Uint8ClampedArray {
  return new Uint8ClampedArray([4, 5, 9, alpha]);
}

/**
 * Image-backed parallax backdrop.
 *
 * Each layer remains a separate RGBA bitmap so its alpha and texture move with
 * the same camera multiplier. The renderer samples these bitmaps directly;
 * there is no shared noise mask or generated cutout pass.
 */
export class Background implements ParallaxLayers {
  readonly backdropLayers: ParallaxBitmapLayer[];

  private loadedCount = 0;

  constructor() {
    this.backdropLayers = BACKDROP_LAYER_SPECS.map((spec, index) => ({
      id: spec.id,
      label: spec.label,
      file: spec.file,
      src: spec.src,
      defaultSpeed: spec.defaultSpeed,
      version: 0,
      width: 1,
      height: 1,
      pixels: fallbackPixel(index === 0 ? 255 : 0),
      loaded: false,
    }));

    if (typeof document === 'undefined' || typeof Image === 'undefined') return;
    for (const layer of this.backdropLayers) this.loadLayer(layer);
  }

  get ready(): boolean {
    return this.loadedCount === this.backdropLayers.length;
  }

  private loadLayer(layer: ParallaxBitmapLayer): void {
    if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
      void this.loadLayerBitmap(layer);
      return;
    }
    this.loadLayerImage(layer);
  }

  private async loadLayerBitmap(layer: ParallaxBitmapLayer): Promise<void> {
    try {
      const response = await fetch(layer.src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      this.commitLayerPixels(layer, bitmap, bitmap.width, bitmap.height);
      bitmap.close();
    } catch {
      this.loadLayerImage(layer);
    }
  }

  private loadLayerImage(layer: ParallaxBitmapLayer): void {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      this.commitLayerPixels(layer, img, w, h);
    };
    img.onerror = () => {
      console.warn(`[background] failed to load ${layer.file}`);
    };
    img.src = layer.src;
  }

  private commitLayerPixels(
    layer: ParallaxBitmapLayer,
    source: CanvasImageSource,
    width: number,
    height: number,
  ): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    layer.width = w;
    layer.height = h;
    layer.pixels = ctx.getImageData(0, 0, w, h).data;
    if (!layer.loaded) this.loadedCount++;
    layer.loaded = true;
    layer.version++;
  }
}
