import type { FighterId } from '@/content/fighters';
import type { StockStageId } from '@/config/stockStage';

export type VersusDevice = 'keyboard' | 'cpu' | `pad:${number}`;
export type VersusPhase = 'idle' | 'lobby' | 'loading' | 'playing' | 'reconnect';
export interface VersusSeat {
  fighter: FighterId;
  device: VersusDevice;
  ready: boolean;
  cpuLevel: number;
}
export interface VersusApi {
  readonly phase: VersusPhase;
  readonly active: boolean;
  readonly seats: readonly Readonly<VersusSeat>[];
  /** The stage the next match is played on (lobby choice; kept for rematches). */
  readonly stage: StockStageId;
  readonly message: string;
  readonly canStart: boolean;
  readonly disconnected: readonly number[];
  readonly devices: ReadonlyArray<{ device: VersusDevice; label: string }>;
  open(): void;
  close(): void;
  chooseFighter(slot: number, fighter: FighterId): void;
  chooseDevice(slot: number, device: VersusDevice): boolean;
  chooseStage(stage: StockStageId): void;
  chooseDifficulty(slot: number, level: number): void;
  ready(slot: number): void;
  start(): Promise<boolean>;
  /** The VS card (phase 'loading'): stop holding it; the countdown starts as soon as the stage is built. */
  skipIntro(): void;
  /** The VS card was skipped this load. */
  readonly introCut: boolean;
  rematch(): void;
  resume(): void;
  /** Returns true when this session owns gamepad polling. Menus still poll while paused. */
  poll(pads: readonly (Gamepad | null)[], blocked: boolean): boolean;
}

/**
 * True from a match's loading until it returns to the lobby: the Duel's own flow, in which nothing of the descent (its
 * curtain copy, test-arena hints, objectives) may show.
 */
export function versusMatchUnderway(versus: Pick<VersusApi, 'phase'> | null | undefined): boolean {
  const phase = versus?.phase;
  return phase === 'loading' || phase === 'playing' || phase === 'reconnect';
}
