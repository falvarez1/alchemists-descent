export const STOCK_ATTACK_KINDS = ['opener', 'launcher', 'aerial', 'finisher', 'neutral_air', 'back_air', 'up_air', 'down_air', 'up_smash', 'down_smash'] as const;
export type StockAttackKind = typeof STOCK_ATTACK_KINDS[number];
export type CoreStockAttackKind = 'opener' | 'launcher' | 'aerial' | 'finisher';
export interface StockAttackSpec {
  readonly name: string;
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  /** Raw damage still passes through the arena tempo and the defender's armor. */
  readonly damage: number;
  readonly reach: number;
  /** Signed near edge along facing; negative values allow rear or two-sided volumes. Defaults to 1. */
  readonly minReach?: number;
  /** Hit volume relative to the attacker's feet. Negative y is above the feet. */
  readonly top: number;
  readonly bottom: number;
  readonly knockX: number;
  readonly knockY: number;
  readonly growth: number;
  readonly stun: number;
}
export interface StockAttackView {
  readonly kind: StockAttackKind | null;
  readonly phase: 'idle' | 'startup' | 'active' | 'recovery';
  readonly busy: boolean;
  readonly facing: number;
  readonly age: number;
  readonly id: number;
  readonly spec: StockAttackSpec | null;
}
