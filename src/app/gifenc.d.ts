/**
 * Minimal typings for `gifenc` (MIT, mattdesl) — only the surface Clips uses.
 * The package ships plain JS; see node_modules/gifenc/src/index.js.
 */
declare module 'gifenc' {
  export type GifPalette = number[][];

  export interface GifFrameOptions {
    /** Required on the first frame (becomes the global colour table); omit later to reuse it. */
    palette?: GifPalette | null;
    /** Milliseconds; stored as centiseconds (Math.round(delay / 10)). */
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** -1 = once, 0 = forever (default), n = n extra loops. */
    repeat?: number;
    colorDepth?: number;
    /** GIF disposal method; 1 = keep this frame under the next one. */
    dispose?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean; useSqrt?: boolean },
  ): GifPalette;

  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}
