import type { StockGrabView } from '@/core/arenaMatch';

/** Finite commitments. The arena owns body contact, terrain checks, and victim binding. */
export class StockGrab implements StockGrabView {
  phase: StockGrabView['phase'] = 'idle';
  age = 0;
  facing = 1;
  victim: number | null = null;
  throwX = 0;
  throwY = 0;
  get busy(): boolean { return this.phase !== 'idle'; }
  get canThrow(): boolean { return this.phase === 'hold' && this.age >= 8; }
  start(facing: number): boolean {
    if (this.busy) return false;
    this.phase = 'startup'; this.age = 0; this.facing = facing < 0 ? -1 : 1; return true;
  }
  step(canAct: boolean): void {
    if (!canAct) { this.reset(); return; }
    if (!this.busy) return;
    this.age++;
    if (this.phase === 'startup' && this.age >= 6) { this.phase = 'active'; this.age = 0; }
    else if (this.phase === 'active' && this.age >= 3) this.release();
    else if (this.phase === 'hold' && this.age >= 50) this.release();
    else if (this.phase === 'recovery' && this.age >= 22) this.reset();
  }
  catch(victim: number): boolean {
    if (this.phase !== 'active') return false;
    this.victim = victim; this.phase = 'hold'; this.age = 0; return true;
  }
  release(x = 0, y = 0): void {
    this.victim = null; this.phase = 'recovery'; this.age = 0; this.throwX = x; this.throwY = y;
    if (x) this.facing = Math.sign(x);
  }
  reset(): void { this.victim = null; this.phase = 'idle'; this.age = 0; this.throwX = this.throwY = 0; }
}
