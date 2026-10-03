export interface BlastZone { left: number; right: number; top: number; bottom: number }
export interface StockGrabView {
  readonly phase: 'idle' | 'startup' | 'active' | 'hold' | 'recovery';
  readonly busy: boolean;
  readonly age: number;
  readonly facing: number;
  readonly victim: number | null;
  readonly throwX: number;
  readonly throwY: number;
}
export interface StockShieldView {
  readonly phase: 'idle' | 'guard' | 'release' | 'broken';
  readonly busy: boolean;
  readonly guarding: boolean;
  readonly strength: number;
}
export interface StockLedgeInput { dir: number; up: boolean; down: boolean; jump: boolean }
export interface StockLedgeView {
  readonly phase: 'idle' | 'hang' | 'climb';
  readonly busy: boolean;
  readonly protected: boolean;
  readonly airReady: boolean;
  readonly x: number;
  readonly y: number;
  readonly side: number;
  readonly age: number;
}
export interface StockDodgeView {
  readonly phase: 'idle' | 'startup' | 'evade' | 'recovery';
  readonly busy: boolean;
  readonly evading: boolean;
  readonly airReady: boolean;
  readonly inAir: boolean;
  readonly vx: number;
  readonly vy: number;
}
export interface StockSpecialView {
  readonly charges: number;
  readonly progress: number;
  readonly busy: boolean;
}
export interface StockRules {
  stocks: number;
  timeTicks: number;
  countdownTicks: number;
  respawnTicks: number;
  protectionTicks: number;
}
export interface StockFighter {
  stocks: number;
  volatility: number;
  respawn: number;
  protection: number;
}
export interface StockMatchView {
  readonly state: 'idle' | 'countdown' | 'fighting' | 'finished';
  readonly fighters: ReadonlyArray<Readonly<StockFighter>>;
  readonly remainingTicks: number;
  readonly countdown: number;
  readonly winner: number | null;
  readonly reason: 'stocks' | 'timeout' | 'draw' | null;
  readonly zone: Readonly<BlastZone>;
}
