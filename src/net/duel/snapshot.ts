import type { Bout } from '@/core/arena';
import type { EventMap } from '@/core/events';
import type {
  StockMatchView,
  StockDodgeView,
  StockGrabView,
  StockLedgeView,
  StockShieldView,
  StockSpecialView,
} from '@/core/arenaMatch';
import type { StockAttackView } from '@/core/stockAttacks';
import type { FighterView } from '@/core/fighters';
import type { BodyProfile } from '@/core/fighterBody';
import type { PlayerState, Projectile, FlyingParticle, LightningArc, AuthoredLight } from '@/core/types';
import type { CellPatch } from '@/authoring/cellPatch';
import { encodeCellPatch, decodeCellPatch } from '@/authoring/cellPatchCodec';
import { MAX_SNAPSHOT_BYTES, integer, record } from './protocol';
import { validPresentation } from './presentationValidation';

export interface ArenaPresentation {
  match: StockMatchView;
  bout: Bout;
  slots: Array<{
    attack: StockAttackView | null;
    shield: StockShieldView | null;
    dodge: StockDodgeView | null;
    ledge: StockLedgeView | null;
    grab: StockGrabView | null;
    special: StockSpecialView | null;
    canRecover: boolean;
    recovering: boolean;
    grabbed: boolean;
    launching: boolean;
  }>;
}
/** Bounded visual commands for kit-owned effects that predate network state.
 * World-space pixels are cosmetic, never collision or gameplay authority. */
export interface DuelEffect {
  layer: 'under' | 'over';
  pixels: number[];
}
export interface DuelFighterState {
  player: PlayerState;
  fighter: FighterView;
  body: BodyProfile;
  concealment: number;
  effects: DuelEffect[];
}
export interface DuelSnapshot {
  epoch: number;
  seq: number;
  base: number;
  baseline: boolean;
  tick: number;
  width: number;
  height: number;
  fighters: [DuelFighterState, DuelFighterState];
  arena: ArenaPresentation;
  camera: { x: number; y: number; tx: number; ty: number; zoom: number; viewScale: number };
  projectiles: Projectile[];
  particles: FlyingParticle[];
  arcs: LightningArc[];
  lights: AuthoredLight[];
  bloom: number;
  shake: number;
  sounds: Array<{ id: string; x?: number; y?: number; gain?: number; pitch?: number; rate?: number; delay?: number }>;
  /** The host's match moments since the last snapshot, in order; a replica re-emits them (announcer, KO burst, cut-in). */
  moments: DuelMoment[];
}

/** The events a replica cannot raise itself (it never ticks the match), carried as data. */
export type DuelMoment =
  | { type: 'stockMatchBeat'; data: EventMap['stockMatchBeat'] }
  | { type: 'fighterDown'; data: EventMap['fighterDown'] }
  | { type: 'stockUltimate'; data: EventMap['stockUltimate'] }
  | { type: 'stockShieldBreak'; data: EventMap['stockShieldBreak'] };
export const DUEL_MOMENT_TYPES = ['stockMatchBeat', 'fighterDown', 'stockUltimate', 'stockShieldBreak'] as const;
/** At most this many moments ride one snapshot (a burst beyond it is dropped, never the frame). */
export const MAX_DUEL_MOMENTS = 32;
const MAGIC = 0x41444431;
const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true });

/** A snapshot and its terrain delta form ONE ordered frame. No torn state. */
export function encodeDuelSnapshot(snapshot: DuelSnapshot, cells: CellPatch): Uint8Array {
  const json = encoder.encode(JSON.stringify(snapshot)),
    terrain = encodeCellPatch(cells);
  const data = new Uint8Array(8 + json.length + terrain.length);
  if (data.length > MAX_SNAPSHOT_BYTES) throw new Error('Duel snapshot exceeds its wire budget');
  const view = new DataView(data.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, json.length, true);
  data.set(json, 8);
  data.set(terrain, 8 + json.length);
  return data;
}

/** Reject unsafe object keys and nonfinite numbers before touching live objects. */
function safeTree(value: unknown, depth = 0): boolean {
  if (depth > 14) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 150_000 && value.every((v) => safeTree(v, depth + 1));
  return (
    record(value) &&
    Object.entries(value).every(
      ([key, v]) => !['__proto__', 'prototype', 'constructor'].includes(key) && safeTree(v, depth + 1),
    )
  );
}
export function decodeDuelSnapshot(data: Uint8Array): { snapshot: DuelSnapshot; cells: CellPatch } | null {
  if (data.byteLength < 20 || data.byteLength > MAX_SNAPSHOT_BYTES) return null;
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength),
      length = view.getUint32(4, true);
    if (view.getUint32(0, true) !== MAGIC || length > data.length - 20) return null;
    const v: unknown = JSON.parse(decoder.decode(data.subarray(8, 8 + length)));
    if (
      !record(v) ||
      !safeTree(v) ||
      !integer(v.epoch, 1) ||
      !integer(v.seq, 1) ||
      !integer(v.base) ||
      !integer(v.tick) ||
      typeof v.baseline !== 'boolean' ||
      !integer(v.width, 1, 4096) ||
      !integer(v.height, 1, 4096)
    )
      return null;
    if (v.base >= v.seq || !validPresentation(v)) return null;
    const cells = decodeCellPatch(data.subarray(8 + length), v.width * v.height);
    return cells ? { snapshot: v as unknown as DuelSnapshot, cells } : null;
  } catch {
    return null;
  }
}
