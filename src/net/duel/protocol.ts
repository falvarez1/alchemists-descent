import type { FighterId } from '@/content/fighters';
// Relative path: this validator is also bundled before Vite's alias config exists.
import { isFighterId } from '../../content/fighters.ts';
import type { DuelInput } from './input.ts';

/** Bump for incompatible wire or simulation presentation changes. 2: Ilyra's and Brann's completed moves (442d426).
 *  3: a snapshot every tick, carrying the input it acknowledges (both reached 2 separately; merged, they are 3). */
export const DUEL_PROTOCOL = 3;
export const DUEL_PATH = '/__duel';
export const MAX_CONTROL_BYTES = 4096;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export type DuelPhase = 'lobby' | 'loading' | 'playing' | 'paused';
export interface DuelSeat {
  fighter: FighterId;
  ready: boolean;
  connected: boolean;
}
export interface DuelRoomState {
  room: string;
  epoch: number;
  phase: DuelPhase;
  seats: [DuelSeat, DuelSeat];
}
export type DuelCommand =
  | { type: 'choose'; fighter: FighterId }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' | 'pause' | 'resume' | 'rematch' | 'lobby' | 'resync' | 'leave' }
  | { type: 'loaded'; epoch: number }
  | ({ type: 'input'; epoch: number } & DuelInput)
  | { type: 'ping'; at: number };
export interface DuelHello {
  type: 'hello';
  protocol: number;
  build: string;
  role: 'host' | 'guest';
  room: string;
  token?: string;
}
export type DuelServerMessage =
  | { type: 'welcome'; slot: 0 | 1; token: string; state: DuelRoomState }
  | { type: 'room'; state: DuelRoomState }
  | { type: 'prepare'; state: DuelRoomState }
  | ({ type: 'input'; epoch: number } & DuelInput)
  | { type: 'resync' }
  | { type: 'pong'; at: number }
  | { type: 'error' | 'ended'; message: string };

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

export function parseClientMessage(data: string): DuelHello | DuelCommand | null {
  if (data.length > MAX_CONTROL_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (!record(v)) return null;
  switch (v.type) {
    case 'hello':
      return integer(v.protocol) &&
        typeof v.build === 'string' &&
        v.build.length <= 100 &&
        (v.role === 'host' || v.role === 'guest') &&
        typeof v.room === 'string' &&
        /^[A-Z0-9]{0,8}$/.test(v.room) &&
        (v.token === undefined || (typeof v.token === 'string' && /^[a-f0-9]{48}$/.test(v.token)))
        ? (v as unknown as DuelHello)
        : null;
    case 'choose':
      return typeof v.fighter === 'string' && isFighterId(v.fighter) ? { type: 'choose', fighter: v.fighter } : null;
    case 'ready':
      return typeof v.ready === 'boolean' ? { type: 'ready', ready: v.ready } : null;
    case 'loaded':
      return integer(v.epoch) ? { type: 'loaded', epoch: v.epoch } : null;
    case 'input':
      return integer(v.epoch) &&
        integer(v.seq) &&
        integer(v.buttons, 0, 32767) &&
        typeof v.aim === 'number' &&
        Number.isFinite(v.aim) &&
        Math.abs(v.aim) <= Math.PI
        ? { type: 'input', epoch: v.epoch, seq: v.seq, buttons: v.buttons, aim: v.aim }
        : null;
    case 'ping':
      return typeof v.at === 'number' && Number.isFinite(v.at) ? { type: 'ping', at: v.at } : null;
    case 'start':
    case 'pause':
    case 'resume':
    case 'rematch':
    case 'lobby':
    case 'resync':
    case 'leave':
      return { type: v.type };
    default:
      return null;
  }
}

export function isRoomState(v: unknown): v is DuelRoomState {
  return (
    record(v) &&
    typeof v.room === 'string' &&
    /^[A-Z0-9]{6}$/.test(v.room) &&
    integer(v.epoch) &&
    ['lobby', 'loading', 'playing', 'paused'].includes(String(v.phase)) &&
    Array.isArray(v.seats) &&
    v.seats.length === 2 &&
    v.seats.every(
      (s) =>
        record(s) &&
        typeof s.fighter === 'string' &&
        isFighterId(s.fighter) &&
        typeof s.ready === 'boolean' &&
        typeof s.connected === 'boolean',
    )
  );
}
export function parseServerMessage(data: string): DuelServerMessage | null {
  if (data.length > MAX_CONTROL_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (!record(v)) return null;
  if (
    v.type === 'welcome' &&
    (v.slot === 0 || v.slot === 1) &&
    typeof v.token === 'string' &&
    /^[a-f0-9]{48}$/.test(v.token) &&
    isRoomState(v.state)
  )
    return v as unknown as DuelServerMessage;
  if ((v.type === 'room' || v.type === 'prepare') && isRoomState(v.state)) return v as unknown as DuelServerMessage;
  if ((v.type === 'error' || v.type === 'ended') && typeof v.message === 'string' && v.message.length < 300)
    return { type: v.type, message: v.message };
  if (v.type === 'resync') return { type: 'resync' };
  if (v.type === 'pong' && typeof v.at === 'number' && Number.isFinite(v.at)) return { type: 'pong', at: v.at };
  if (v.type === 'input') {
    const parsed = parseClientMessage(data);
    if (parsed?.type === 'input') return parsed;
  }
  return null;
}
