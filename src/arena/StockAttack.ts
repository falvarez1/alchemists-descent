import type { StockAttackKind, StockAttackSpec, StockAttackView } from '@/core/stockAttacks';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';

/** One commitment, with one hit per victim. Timing never depends on rendering. */
export class StockAttack implements StockAttackView {
  kind: StockAttackKind | null = null;
  spec: StockAttackSpec | null = null;
  facing = 1;
  age = 0;
  id = 0;
  private readonly victims = new Set<number>();
  get busy(): boolean { return this.spec !== null; }
  get phase(): StockAttackView['phase'] {
    if (!this.spec) return 'idle';
    return this.age < this.spec.startup ? 'startup' : this.age < this.spec.startup + this.spec.active ? 'active' : 'recovery';
  }
  start(kind: StockAttackKind, spec: StockAttackSpec, facing: number): boolean {
    if (this.busy) return false;
    this.kind = kind; this.spec = spec; this.facing = facing < 0 ? -1 : 1;
    this.age = 0; this.id++; this.victims.clear(); return true;
  }
  step(canAct: boolean): void {
    if (!this.spec) return;
    if (!canAct || ++this.age >= this.spec.startup + this.spec.active + this.spec.recovery) this.reset();
  }
  claim(victim: number): boolean {
    if (this.phase !== 'active' || this.victims.has(victim)) return false;
    this.victims.add(victim); return true;
  }
  reset(): void { this.kind = null; this.spec = null; this.age = 0; this.victims.clear(); }
}

export function stockAttackOverlaps(spec: StockAttackSpec, facing: number, x: number, y: number, victimX: number, victimY: number): boolean {
  const dx = (victimX - x) * facing;
  return dx + PLAYER_HALF_W >= (spec.minReach ?? 1) && dx - PLAYER_HALF_W <= spec.reach && victimY >= y + spec.top && victimY - PLAYER_H <= y + spec.bottom;
}
