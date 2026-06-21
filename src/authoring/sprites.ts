import { base64ToBytes } from '@/core/rle';
import { fnv1aString } from '@/core/rng';
import type { RuntimeSprite } from '@/core/types';

/**
 * Neutral authored animated-sprite contract. Builder owns import/storage UI;
 * runtime and authored documents only need the serializable shape.
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
  /** Base64 of raw RGBA bytes, exactly w*h*4 of them. */
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

export const SPRITE_DIM_CAP = 128;
export const SPRITE_FRAME_CAP = 64;
export const SPRITE_ENCODED_CAP = 512 * 1024;

let spriteIdCounter = 0;
export function freshSpriteId(): string {
  return 'sprite-' + Date.now().toString(36) + '-' + (spriteIdCounter++).toString(36);
}

function tagDir(v: unknown): SpriteTagDir {
  if (v === 'reverse') return 'reverse';
  if (v === 'pingpong' || v === 'pingpong_reverse') return 'pingpong';
  return 'forward';
}

/** Aseprite durations are milliseconds; the game runs 60Hz ticks. */
export function durationToTicks(ms: number): number {
  return Math.max(1, Math.round(ms / (1000 / 60)));
}

export function decodeFramePx(px: string, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8Array(w * h * 4);
  base64ToBytes(px, out);
  return new Uint8ClampedArray(out.buffer);
}

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

export function sanitizeSpriteAsset(parsed: unknown): SpriteAsset | null {
  const s = parsed as SpriteAsset;
  if (!s || s.v !== 1 || s.kind !== 'sprite') return null;
  if (typeof s.w !== 'number' || typeof s.h !== 'number') return null;
  const w = Math.floor(s.w);
  const h = Math.floor(s.h);
  if (w < 1 || h < 1 || w > SPRITE_DIM_CAP || h > SPRITE_DIM_CAP) return null;
  if (!Array.isArray(s.frames) || s.frames.length < 1 || s.frames.length > SPRITE_FRAME_CAP) {
    return null;
  }
  const expected = Math.ceil((w * h * 4) / 3) * 4;
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

export function spriteContentSig(s: SpriteAsset): number {
  let hash = fnv1aString(`${s.w}x${s.h}:${s.emissive ? 1 : 0}`);
  for (const f of s.frames) hash = fnv1aString(`${f.durationMs};${f.px}`, hash);
  for (const t of s.tags) hash = fnv1aString(`${t.name},${t.from},${t.to},${t.dir}`, hash);
  return hash;
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

/** Stable per-decor phase from the object id. */
export function spritePhase(objectId: string): number {
  return fnv1aString(objectId) % 1024;
}
