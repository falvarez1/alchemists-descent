/** Messages between `app/Clips.ts` (main thread) and `app/clips.worker.ts`. */

export interface ClipOverlayMessage {
  /** Straight-alpha RGBA, w × h × 4 bytes (transferred). */
  rgba: ArrayBuffer;
  w: number;
  h: number;
  x: number;
  y: number;
  /** Only on the clip's last `fromEnd` frames (a death title card). */
  fromEnd?: number;
  fadeFrames?: number;
}

export type ClipWorkerRequest =
  /** Size the ring (frames). Clears it. */
  | { type: 'configure'; capacity: number }
  /** One captured frame, already downscaled on the GPU (transferred). */
  | { type: 'frame'; bitmap: ImageBitmap; t: number }
  /** Drop every held frame (recording switched off, run changed). */
  | { type: 'clear' }
  /**
   * Encode the ring as it stands right now. Frames posted after this message
   * are not part of the clip — the request freezes the moment.
   */
  | {
      type: 'encode';
      id: number;
      overlays: ClipOverlayMessage[];
      nominalMs: number;
      maxBytes: number;
    };

export interface ClipEncodeStats {
  /** Frames in the ring when the clip was frozen. */
  sourceFrames: number;
  /** Frames written to the GIF (identical frames merge into one longer frame). */
  frames: number;
  width: number;
  height: number;
  durationMs: number;
  paletteColors: number;
  paletteMs: number;
  encodeMs: number;
  /** Encode passes (a clip over the byte budget is re-encoded at half rate). */
  passes: number;
  frameStride: number;
  fuzz: number;
}

export type ClipWorkerResponse =
  /** `pass` > 0 means the first encode was over budget and a smaller one is running. */
  | { type: 'progress'; id: number; progress: number; pass: number }
  /** The clip's last frame, sent first so the card can show the moment while it develops. */
  | { type: 'still'; id: number; bitmap: ImageBitmap }
  | { type: 'done'; id: number; gif: ArrayBuffer; poster: Blob | null; stats: ClipEncodeStats }
  | { type: 'error'; id: number; message: string }
  /** Ring size after a frame landed (lets the main thread show "nothing yet"). */
  | { type: 'held'; frames: number; width: number; height: number };
