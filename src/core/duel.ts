import type { FighterId } from '@/content/fighters';
import type { DuelRoomState } from '@/net/duel/protocol';
import type { ArenaPresentation } from '@/net/duel/snapshot';

/** The game sees match semantics only. No socket, URL, database, or SDK types. */
export interface DuelApi {
  readonly active: boolean;
  readonly replica: boolean;
  readonly room: DuelRoomState | null;
  readonly slot: 0 | 1 | null;
  readonly status: string;
  readonly latency: number;
  readonly connected: boolean;
  readonly playing: boolean;
  readonly snapshotCount: number;
  host(): void;
  join(room: string): void;
  leave(): void;
  choose(fighter: FighterId): void;
  ready(): void;
  start(): void;
  pause(): void;
  resume(): void;
  rematch(): void;
  lobby(): void;
  /** Presentation frame housekeeping, including reconnect and input sampling. */
  frame(now: number): void;
  /** Authority only, at the normal fixed-step input boundary. */
  beforeTick(): void;
  afterTick(): void;
  readonly presentation: ArenaPresentation | null;
}
