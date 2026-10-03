export type StockAttackKind = 'opener' | 'launcher' | 'aerial' | 'finisher';
export interface StockAttackSpec {
  readonly name: string;
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  /** Raw damage still passes through the arena tempo and the defender's armor. */
  readonly damage: number;
  readonly reach: number;
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
