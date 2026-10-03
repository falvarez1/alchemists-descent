import { STOCK_DODGE as RULES } from '@/config/stockMovement';
import type { StockDodgeView } from '@/core/arenaMatch';

/** Commitment belongs to the fighter, independent of its kit or health invulnerability. */
export class StockDodge implements StockDodgeView {
  private age = -1;
  private cooldown = 0;
  private airUsed = false;
  private dx = 0;
  private dy = 0;
  private airborne = false;

  get phase(): StockDodgeView['phase'] {
    if (this.age < 0) return 'idle';
    if (this.age < RULES.startup) return 'startup';
    if (this.age < RULES.startup + RULES.active) return 'evade';
    return 'recovery';
  }
  get busy(): boolean { return this.age >= 0; }
  get evading(): boolean { return this.age >= RULES.startup && this.age < RULES.startup + RULES.invulnerable; }
  get airReady(): boolean { return !this.airUsed; }
  get vx(): number { return this.phase === 'evade' ? this.dx * (this.airborne ? RULES.airSpeed : RULES.groundSpeed) : 0; }
  get vy(): number { return this.phase === 'evade' && this.airborne ? this.dy * RULES.airSpeed : 0; }
  get inAir(): boolean { return this.airborne; }

  step(request: boolean, canAct: boolean, grounded: boolean, x: number, y: number): void {
    if (grounded) this.airUsed = false;
    if (this.cooldown > 0) this.cooldown--;
    if (this.age >= 0) {
      this.age++;
      if (!canAct || this.age >= RULES.startup + RULES.active + RULES.recovery) {
        this.age = -1; this.cooldown = RULES.cooldown;
      }
    }
    if (!request || !canAct || this.busy || this.cooldown > 0 || (!grounded && this.airUsed)) return;
    this.airborne = !grounded;
    if (!grounded) this.airUsed = true;
    const length = Math.hypot(x, grounded ? 0 : y) || 1;
    this.dx = x / length; this.dy = grounded ? 0 : y / length;
    this.age = 0;
  }

  reset(): void { this.age = -1; this.cooldown = 0; this.airUsed = false; this.dx = 0; this.dy = 0; this.airborne = false; }
}
