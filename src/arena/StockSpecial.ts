import { STOCK_SPECIAL as T } from '@/config/stockSpecial';
import type { StockSpecialView } from '@/core/arenaMatch';

export class StockSpecial implements StockSpecialView {
  charges: number = T.capacity;
  private refill = 0;
  private recovery = 0;
  get progress(): number { return this.refill / T.rechargeTicks; }
  get busy(): boolean { return this.recovery > 0; }
  canSpend(cost = 1): boolean { return !this.busy && this.charges >= cost; }
  spend(cost = 1): boolean {
    if (!this.canSpend(cost)) return false;
    this.charges -= cost; this.recovery = T.recoveryTicks; return true;
  }
  step(): void { this.recovery = Math.max(0, this.recovery - 1); this.recharge(1); }
  /** Only the synchronous ability reservation can be cancelled. No refill time elapses inside it. */
  refund(cost = 1): void { this.charges = Math.min(T.capacity, this.charges + cost); this.recovery = 0; }
  rewardMelee(): void { this.recharge(T.meleeCredit); }
  private recharge(ticks: number): void {
    if (this.charges >= T.capacity) return;
    this.refill += ticks;
    if (this.refill >= T.rechargeTicks) { this.charges++; this.refill -= T.rechargeTicks; }
    if (this.charges >= T.capacity) this.refill = 0;
  }
  reset(): void { this.charges = T.capacity; this.refill = this.recovery = 0; }
}
