export interface BlastZone { left: number; right: number; top: number; bottom: number }
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
