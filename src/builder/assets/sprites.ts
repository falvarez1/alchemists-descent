import { base64ToBytes, bytesToBase64 } from '@/core/rle';
import type { RuntimeSprite } from '@/core/types';

/**
 * SpriteAsset v1 — the authored animated-sprite format (Aseprite pipeline).
 *
 * VISUAL-ONLY INVARIANT: sprites are presentation, the same class as enemy
 * sprites, critters and pickup glyphs. A sprite never writes cells, never
 * collides, never blocks, never gates progression — the grid doesn't know
 * it's there. "If the grid can't explain it, it doesn't ship" governs
 * MECHANICS; decor has none.
 *
 * Pixels are TRUE RGBA art colors (NOT the cell palette — that maps
 * terrain); the renderer thresholds alpha at 128. This module is pure and
 * node-testable: parsing Aseprite "Export Sprite Sheet" JSON (hash AND
 * array layouts), compositing trimmed frames back into their sourceSize
 * box, slicing uniform grids for lone PNGs, and producing our own export
 * (single-row sheet + Aseprite array-form JSON) that round-trips through
 * this same parser. Browser PNG bytes live in png.ts; storage in
 * spritelib.ts.
 */

export type SpriteTagDir = 'forward' | 'reverse' | 'pingpong';

export interface SpriteTag {
  name: string;
  /** Inclusive frame range. */
  from: number;
  to: number;
  dir: SpriteTagDir;
}

export interface SpriteFrame {
  durationMs: number;
  /** base64 of raw RGBA bytes, exactly w*h*4 of them. */
  px: string;
}

export interface SpriteAsset {
  v: 1;
  kind: 'sprite';
  id: string;
  name: string;
  w: number;
  h: number;
  frames: SpriteFrame[];
  tags: SpriteTag[];
  /** Emissive sprites are their own light source: drawn raw, never light-multiplied. */
  emissive: boolean;
}

/** Hard caps — a sprite is a torch, not a cutscene. */
export const SPRITE_DIM_CAP = 128;
export const SPRITE_FRAME_CAP = 64;
/** Cap on the JSON-encoded asset (localStorage + share codes stay sane). */
export const SPRITE_ENCODED_CAP = 512 * 1024;

/** Aseprite durations are milliseconds; the game runs 60Hz ticks. */
export function durationToTicks(ms: number): number {
  return Math.max(1, Math.round(ms / (1000 / 60)));
}

let spriteIdCounter = 0;
/** Local id maker (NOT document.ts freshId — that import would be cyclic). */
export function freshSpriteId(): string {
  return 'sprite-' + Date.now().toString(36) + '-' + (spriteIdCounter++).toString(36);
}

/* ---------------- raw pixel codec ---------------- */

export function encodeFramePx(data: Uint8ClampedArray): string {
  return bytesToBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

export function decodeFramePx(px: string, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8Array(w * h * 4);
  base64ToBytes(px, out);
  return new Uint8ClampedArray(out.buffer);
}

/* ---------------- Aseprite "Export Sprite Sheet" JSON ---------------- */

interface AseRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One frame's geometry on the sheet + its composite box + timing. */
export interface ParsedAseFrame {
  /** Pixel rect on the sheet. */
  rect: AseRect;
  /** Where the trimmed rect sits inside the sourceSize box. */
  offX: number;
  offY: number;
  durationMs: number;
}

export interface ParsedAseprite {
  /** Untrimmed frame box — every frame composites into this size. */
  w: number;
  h: number;
  frames: ParsedAseFrame[];
  tags: SpriteTag[];
}

function asRect(v: unknown): AseRect | null {
  const r = v as AseRect;
  if (
    !r ||
    typeof r.x !== 'number' ||
    typeof r.y !== 'number' ||
    typeof r.w !== 'number' ||
    typeof r.h !== 'number'
  ) {
    return null;
  }
  return r;
}

function tagDir(v: unknown): SpriteTagDir {
  if (v === 'reverse') return 'reverse';
  // Aseprite also emits 'pingpong_reverse'; fold it into pingpong
  if (v === 'pingpong' || v === 'pingpong_reverse') return 'pingpong';
  return 'forward';
}

/**
 * Parse Aseprite's sheet JSON — BOTH layouts ("Hash" keys frames by name,
 * "Array" lists them; Aseprite writes either in frame order). Trimmed
 * frames keep their spriteSourceSize offset so the importer can composite
 * them back into the full sourceSize box. Throws Error with a designer-
 * readable message on anything this pipeline cannot honor:
 * `rotated: true` (we never rotate pixels) and mixed sourceSize (frames
 * exported from different sprites).
 */
export function parseAsepriteJson(parsed: unknown): ParsedAseprite {
  const root = parsed as { frames?: unknown; meta?: { frameTags?: unknown } };
  if (!root || root.frames === undefined || root.frames === null) {
    throw new Error('not an Aseprite sheet JSON (no "frames")');
  }
  const entries: unknown[] = Array.isArray(root.frames)
    ? root.frames
    : typeof root.frames === 'object'
      ? Object.values(root.frames as Record<string, unknown>)
      : [];
  if (entries.length === 0) throw new Error('sheet JSON has zero frames');
  if (entries.length > SPRITE_FRAME_CAP) {
    throw new Error(`too many frames (${entries.length} > ${SPRITE_FRAME_CAP})`);
  }

  const frames: ParsedAseFrame[] = [];
  let w = -1,
    h = -1;
  for (const e of entries) {
    const f = e as {
      frame?: unknown;
      rotated?: unknown;
      spriteSourceSize?: unknown;
      sourceSize?: { w?: number; h?: number };
      duration?: unknown;
    };
    const rect = asRect(f.frame);
    if (!rect) throw new Error('frame entry without a pixel rect');
    if (f.rotated === true) {
      throw new Error('rotated frames are not supported — export with "Rotation" disabled');
    }
    const src = f.sourceSize;
    const sw = typeof src?.w === 'number' ? src.w : rect.w;
    const sh = typeof src?.h === 'number' ? src.h : rect.h;
    if (w === -1) {
      w = sw;
      h = sh;
    } else if (sw !== w || sh !== h) {
      throw new Error('mixed sourceSize — all frames must come from one sprite');
    }
    const sss = asRect(f.spriteSourceSize);
    frames.push({
      rect,
      offX: sss ? sss.x : 0,
      offY: sss ? sss.y : 0,
      durationMs: typeof f.duration === 'number' && f.duration > 0 ? f.duration : 100,
    });
  }
  if (w < 1 || h < 1 || w > SPRITE_DIM_CAP || h > SPRITE_DIM_CAP) {
    throw new Error(`frame size ${w}x${h} outside 1..${SPRITE_DIM_CAP}`);
  }

  const tags: SpriteTag[] = [];
  const rawTags = root.meta?.frameTags;
  if (Array.isArray(rawTags)) {
    for (const t of rawTags as Array<{ name?: unknown; from?: unknown; to?: unknown; direction?: unknown }>) {
      if (typeof t?.name !== 'string') continue;
      let from = typeof t.from === 'number' ? Math.floor(t.from) : 0;
      let to = typeof t.to === 'number' ? Math.floor(t.to) : frames.length - 1;
      from = Math.max(0, Math.min(frames.length - 1, from));
      to = Math.max(0, Math.min(frames.length - 1, to));
      if (to < from) [from, to] = [to, from];
      tags.push({ name: t.name, from, to, dir: tagDir(t.direction) });
    }
  }
  return { w, h, frames, tags };
}

/**
 * Cut a decoded sheet into a SpriteAsset using parsed Aseprite geometry:
 * each (possibly trimmed) rect is copied into a fresh sourceSize-sized RGBA
 * buffer at its spriteSourceSize offset.
 */
export function sliceSheet(
  rgba: Uint8ClampedArray,
  sheetW: number,
  sheetH: number,
  parsed: ParsedAseprite,
  name: string,
): SpriteAsset {
  const { w, h } = parsed;
  const frames: SpriteFrame[] = [];
  for (const f of parsed.frames) {
    const { rect, offX, offY } = f;
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > sheetW || rect.y + rect.h > sheetH) {
      throw new Error('frame rect falls outside the sheet PNG — JSON/PNG pair mismatch?');
    }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < rect.h; y++) {
      const ty = y + offY;
      if (ty < 0 || ty >= h) continue;
      for (let x = 0; x < rect.w; x++) {
        const tx = x + offX;
        if (tx < 0 || tx >= w) continue;
        const so = ((rect.y + y) * sheetW + rect.x + x) * 4;
        const to = (ty * w + tx) * 4;
        out[to] = rgba[so];
        out[to + 1] = rgba[so + 1];
        out[to + 2] = rgba[so + 2];
        out[to + 3] = rgba[so + 3];
      }
    }
    frames.push({ durationMs: f.durationMs, px: encodeFramePx(out) });
  }
  return finishAsset(name, w, h, frames, parsed.tags);
}

/**
 * Fallback for a lone sheet PNG (no JSON): cut a uniform grid, row-major,
 * every full tile, all frames at one fps.
 */
export function sliceUniformGrid(
  rgba: Uint8ClampedArray,
  sheetW: number,
  sheetH: number,
  frameW: number,
  frameH: number,
  fps: number,
  name: string,
): SpriteAsset {
  if (frameW < 1 || frameH < 1 || frameW > SPRITE_DIM_CAP || frameH > SPRITE_DIM_CAP) {
    throw new Error(`frame size ${frameW}x${frameH} outside 1..${SPRITE_DIM_CAP}`);
  }
  const cols = Math.floor(sheetW / frameW);
  const rows = Math.floor(sheetH / frameH);
  const count = cols * rows;
  if (count < 1) throw new Error('frame size larger than the sheet');
  if (count > SPRITE_FRAME_CAP) {
    throw new Error(`grid yields ${count} frames (> ${SPRITE_FRAME_CAP}) — wrong frame size?`);
  }
  const durationMs = 1000 / Math.max(1, Math.min(60, fps || 8));
  const frames: SpriteFrame[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const out = new Uint8ClampedArray(frameW * frameH * 4);
      for (let y = 0; y < frameH; y++) {
        const so = ((r * frameH + y) * sheetW + c * frameW) * 4;
        out.set(rgba.subarray(so, so + frameW * 4), y * frameW * 4);
      }
      frames.push({ durationMs, px: encodeFramePx(out) });
    }
  }
  return finishAsset(name, frameW, frameH, frames, []);
}

function finishAsset(
  name: string,
  w: number,
  h: number,
  frames: SpriteFrame[],
  tags: SpriteTag[],
): SpriteAsset {
  const asset: SpriteAsset = {
    v: 1,
    kind: 'sprite',
    id: freshSpriteId(),
    name: name.trim() || 'sprite',
    w,
    h,
    frames,
    tags,
    emissive: false,
  };
  const encoded = JSON.stringify(asset).length;
  if (encoded > SPRITE_ENCODED_CAP) {
    throw new Error(`sprite encodes to ${Math.round(encoded / 1024)}KB (cap ${SPRITE_ENCODED_CAP / 1024}KB)`);
  }
  return asset;
}

/* ---------------- import sanitization (validate-then-accept) ---------------- */

/**
 * Mirror of sanitizePrefab for sprites: every field validated before the
 * asset is allowed anywhere near the library or a document. Null on garbage;
 * never throws. Frame px MUST decode to exactly w*h*4 bytes.
 */
export function sanitizeSpriteAsset(parsed: unknown): SpriteAsset | null {
  const s = parsed as SpriteAsset;
  if (!s || s.v !== 1 || s.kind !== 'sprite') return null;
  if (typeof s.w !== 'number' || typeof s.h !== 'number') return null;
  const w = Math.floor(s.w),
    h = Math.floor(s.h);
  if (w < 1 || h < 1 || w > SPRITE_DIM_CAP || h > SPRITE_DIM_CAP) return null;
  if (!Array.isArray(s.frames) || s.frames.length < 1 || s.frames.length > SPRITE_FRAME_CAP) {
    return null;
  }
  const expected = Math.ceil((w * h * 4) / 3) * 4; // exact base64 length (rle pads)
  const frames: SpriteFrame[] = [];
  for (const f of s.frames) {
    if (!f || typeof f.px !== 'string' || f.px.length !== expected) return null;
    try {
      atob(f.px);
    } catch {
      return null;
    }
    const ms = typeof f.durationMs === 'number' && Number.isFinite(f.durationMs) ? f.durationMs : 100;
    frames.push({ durationMs: Math.max(1, Math.min(10000, ms)), px: f.px });
  }
  const tags: SpriteTag[] = [];
  if (Array.isArray(s.tags)) {
    for (const t of s.tags) {
      if (!t || typeof t.name !== 'string') continue;
      let from = typeof t.from === 'number' ? Math.floor(t.from) : 0;
      let to = typeof t.to === 'number' ? Math.floor(t.to) : frames.length - 1;
      from = Math.max(0, Math.min(frames.length - 1, from));
      to = Math.max(0, Math.min(frames.length - 1, to));
      if (to < from) [from, to] = [to, from];
      tags.push({ name: t.name, from, to, dir: tagDir(t.dir) });
    }
  }
  const out: SpriteAsset = {
    v: 1,
    kind: 'sprite',
    id: typeof s.id === 'string' && s.id ? s.id : freshSpriteId(),
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : 'sprite',
    w,
    h,
    frames,
    tags,
    emissive: s.emissive === true,
  };
  if (JSON.stringify(out).length > SPRITE_ENCODED_CAP) return null;
  return out;
}

/** Content identity (id/name excluded) — import collisions re-id on mismatch. */
export function spriteContentSig(s: SpriteAsset): number {
  let hash = 0x811c9dc5;
  const fold = (str: string): void => {
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  fold(`${s.w}x${s.h}:${s.emissive ? 1 : 0}`);
  for (const f of s.frames) fold(`${f.durationMs};${f.px}`);
  for (const t of s.tags) fold(`${t.name},${t.from},${t.to},${t.dir}`);
  return hash >>> 0;
}

/* ---------------- runtime decode ---------------- */

/** Decode an asset into render-ready frame buffers (done ONCE per compile;
 *  every decor instance referencing the same asset shares this object). */
export function decodeRuntimeSprite(asset: SpriteAsset): RuntimeSprite {
  const frames: RuntimeSprite['frames'] = [];
  const starts: number[] = [];
  let total = 0;
  for (const f of asset.frames) {
    const ticks = durationToTicks(f.durationMs);
    starts.push(total);
    total += ticks;
    frames.push({ ticks, data: decodeFramePx(f.px, asset.w, asset.h) });
  }
  return { w: asset.w, h: asset.h, frames, starts, totalTicks: total, emissive: asset.emissive };
}

/** A loop tag by name; missing/empty name = the whole strip, forward. */
export function resolveLoopTag(
  asset: SpriteAsset,
  tagName: string,
): { from: number; to: number; dir: SpriteTagDir } {
  const tag = tagName ? asset.tags.find((t) => t.name === tagName) : undefined;
  if (tag) return { from: tag.from, to: tag.to, dir: tag.dir };
  return { from: 0, to: asset.frames.length - 1, dir: 'forward' };
}

/** Stable per-decor phase from the object id (identical torches desync). */
export function spritePhase(objectId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < objectId.length; i++) {
    hash ^= objectId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 1024;
}

/* ---------------- export (closes the Aseprite round-trip) ---------------- */

/**
 * Pack the asset back into a sheet + Aseprite ARRAY-form JSON. Single-row
 * packing; rows wrap only when a row would exceed the PNG decode cap (2048),
 * so our own export always re-imports (the JSON carries exact rects, so
 * packing shape is irrelevant to readers). Aseprite itself opens the PNG
 * and our importer reads the JSON — round-trip closed.
 */
export function spriteToSheet(asset: SpriteAsset): {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  json: unknown;
} {
  const n = asset.frames.length;
  const perRow = Math.max(1, Math.min(n, Math.floor(2048 / asset.w)));
  const rows = Math.ceil(n / perRow);
  const sheetW = Math.min(n, perRow) * asset.w;
  const sheetH = rows * asset.h;
  const rgba = new Uint8ClampedArray(sheetW * sheetH * 4);
  const jsonFrames: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const fx = (i % perRow) * asset.w;
    const fy = Math.floor(i / perRow) * asset.h;
    const data = decodeFramePx(asset.frames[i].px, asset.w, asset.h);
    for (let y = 0; y < asset.h; y++) {
      rgba.set(
        data.subarray(y * asset.w * 4, (y + 1) * asset.w * 4),
        ((fy + y) * sheetW + fx) * 4,
      );
    }
    jsonFrames.push({
      filename: `${asset.name} ${i}.aseprite`,
      frame: { x: fx, y: fy, w: asset.w, h: asset.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: asset.w, h: asset.h },
      sourceSize: { w: asset.w, h: asset.h },
      duration: asset.frames[i].durationMs,
    });
  }
  const json = {
    frames: jsonFrames,
    meta: {
      app: 'alchemists-descent',
      image: `${asset.name}.sheet.png`,
      format: 'RGBA8888',
      size: { w: sheetW, h: sheetH },
      scale: '1',
      frameTags: asset.tags.map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.dir })),
    },
  };
  return { rgba, w: sheetW, h: sheetH, json };
}
