import type { FighterId } from '@/content/fighters';

export type VersusDevice = 'keyboard' | 'cpu' | `pad:${number}`;
export type VersusPhase = 'idle' | 'lobby' | 'loading' | 'playing' | 'reconnect';
export interface VersusSeat {
  fighter: FighterId;
  device: VersusDevice;
  ready: boolean;
}
export interface VersusApi {
  readonly phase: VersusPhase;
  readonly active: boolean;
  readonly seats: readonly Readonly<VersusSeat>[];
  readonly message: string;
  readonly canStart: boolean;
  readonly disconnected: readonly number[];
  readonly devices: ReadonlyArray<{ device: VersusDevice; label: string }>;
  open(): void;
  close(): void;
  chooseFighter(slot: number, fighter: FighterId): void;
  chooseDevice(slot: number, device: VersusDevice): boolean;
  ready(slot: number): void;
  start(): Promise<boolean>;
  rematch(): void;
  resume(): void;
  /** Returns true when this session owns gamepad polling. Menus still poll while paused. */
  poll(pads: readonly (Gamepad | null)[], blocked: boolean): boolean;
}
