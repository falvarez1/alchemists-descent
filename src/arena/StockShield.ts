import type { StockShieldView } from '@/core/arenaMatch';

/** Grounded defense with a finite budget. Contact stun and break cannot be canceled. */
export class StockShield implements StockShieldView {
  strength = 100;
  phase: StockShieldView['phase'] = 'idle';
  private ticks = 0;
  private regenDelay = 0;
  private needsRelease = false;
  get busy(): boolean { return this.phase !== 'idle'; }
  get guarding(): boolean { return this.phase === 'guard'; }
  get canDodge(): boolean { return this.phase === 'idle' || (this.guarding && this.ticks === 0); }
  step(held: boolean, canAct: boolean, grounded: boolean): void {
    if (!held) this.needsRelease = false;
    if (this.regenDelay > 0) this.regenDelay--;
    if (this.ticks > 0) this.ticks--;
    if (this.phase === 'broken' || this.phase === 'release') {
      if (this.ticks === 0) this.phase = 'idle';
      else return;
    }
    if (this.guarding && (!canAct || !grounded)) this.drop();
    if (this.guarding && !held && this.ticks === 0) { this.phase = 'release'; this.ticks = 7; }
    if (this.phase === 'idle' && held && canAct && grounded && !this.needsRelease && this.strength >= 12) this.phase = 'guard';
    if (this.guarding) {
      this.strength = Math.max(0, this.strength - .4); this.regenDelay = 60;
      if (this.strength === 0) this.break();
    } else if (this.regenDelay === 0) this.strength = Math.min(100, this.strength + .25);
  }
  block(damage: number): boolean {
    if (!this.guarding || damage <= 0) return false;
    this.strength = Math.max(0, this.strength - 6 - damage * .9);
    this.ticks = Math.min(18, 5 + Math.ceil(damage * .35)); this.regenDelay = 60;
    if (this.strength === 0) this.break();
    return true;
  }
  private break(): void { this.phase = 'broken'; this.ticks = 90; this.needsRelease = true; }
  drop(): void { this.phase = 'idle'; this.ticks = 0; }
  reset(): void { this.drop(); this.strength = 100; this.regenDelay = 0; this.needsRelease = false; }
}
