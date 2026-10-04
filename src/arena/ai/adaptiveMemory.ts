export interface LearnedMove { context: string; action: string }
interface Outcome { samples: number; value: number; failures: number }
interface Attempt extends LearnedMove { started: number; until: number; attack: string; victim: number; approach?: LearnedMove }

/** Bounded, match-local experience. A timer never makes a twice-failed plan good again. */
export class AdaptiveMemory {
  private readonly outcomes = new Map<string, Outcome>();
  private readonly pending: Attempt[] = [];
  confirmed = 0;
  misses = 0;
  private key(context: string, action: string): string { return `${context}|${action}`; }
  allowed(context: string, action: string): boolean { return (this.outcomes.get(this.key(context, action))?.failures ?? 0) < 2; }
  ready(context: string, action: string): boolean {
    return this.allowed(context, action) && !this.pending.some(move => move.context === context && move.action === action);
  }
  bias(context: string, action: string, strength: number): number {
    const row = this.outcomes.get(this.key(context, action));
    return row ? Math.max(0, Math.min(1, strength)) * (row.value * row.samples / (row.samples + 2) - .3 * row.failures) : 0;
  }
  record(context: string, action: string, success: boolean, damage = 0): void {
    const key = this.key(context, action), row = this.outcomes.get(key) ?? { samples: 0, value: 0, failures: 0 };
    row.samples = Math.min(30, row.samples + 1);
    const reward = success ? .6 + Math.min(.4, Math.max(0, damage) / 40) : -.6;
    row.value += .35 * (reward - row.value);
    row.failures = success ? 0 : Math.min(2, row.failures + 1);
    this.outcomes.delete(key); this.outcomes.set(key, row);
    if (this.outcomes.size > 128) this.outcomes.delete(this.outcomes.keys().next().value!);
  }
  attempt(context: string, action: string, started: number, until: number, attack: string, victim: number, approach?: LearnedMove): void {
    if (this.pending.some(p => p.started === started && p.attack === attack && p.victim === victim)) return;
    if (this.pending.length >= 16) this.pending.shift();
    this.pending.push({ context, action, started, until, attack, victim, approach });
  }
  hit(victim: number, attack: string, tick: number, damage: number): boolean {
    // Credit only the most recent matching move. One hit cannot reward unrelated attempts.
    let index = -1;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.victim === victim && p.attack === attack && tick >= p.started && tick <= p.until) { index = i; break; }
    }
    if (index < 0) return false;
    const [move] = this.pending.splice(index, 1);
    this.record(move.context, move.action, true, damage);
    if (move.approach) this.record(move.approach.context, move.approach.action, true, damage * .5);
    this.confirmed++; return true;
  }
  expire(tick: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const move = this.pending[i];
      if (tick <= move.until) continue;
      this.record(move.context, move.action, false); this.pending.splice(i, 1); this.misses++;
    }
  }
  interrupt(): void { this.pending.length = 0; }
  reset(): void { this.outcomes.clear(); this.pending.length = 0; this.confirmed = this.misses = 0; }
}
