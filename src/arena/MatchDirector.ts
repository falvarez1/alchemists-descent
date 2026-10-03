import { STOCK_LAUNCH } from '@/config/stockRules';
import type { BlastZone, StockFighter, StockMatchView, StockRules } from '@/core/arenaMatch';

/** Influence changes angle only; holding parallel to the launch cannot add speed. */
export function influenceLaunch(x: number, y: number, inputX: number, inputY: number): { x: number; y: number } {
  const speed = Math.hypot(x, y), input = Math.hypot(inputX, inputY);
  if (speed < .001 || input < .001) return { x, y };
  const turn = Math.max(-1, Math.min(1, (x * inputY - y * inputX) / (speed * input))) * Math.PI / 15;
  return { x: x * Math.cos(turn) - y * Math.sin(turn), y: x * Math.sin(turn) + y * Math.cos(turn) };
}

/** Returns final velocity: mass is applied HERE, never again by Player.applyImpulse. */
export function stockLaunch(kx: number, ky: number, damage: number, volatility: number, mass: number, growth = 1, stun = 1): { x: number; y: number; stun: number } {
  const length = Math.hypot(kx, ky);
  if (!Number.isFinite(length) || length < 0.001) return { x: 0, y: 0, stun: 0 };
  const k = STOCK_LAUNCH;
  const speed = Math.min(k.maxSpeed, (k.base + Math.min(6, length) + damage * k.damage + volatility * k.growth * growth) / Math.max(0.25, mass));
  // A horizontal blow lifts a grounded body clear of friction. Downward spikes retain their direction.
  const dx = kx / length, dy = ky === 0 ? -0.35 : ky / length;
  const norm = Math.hypot(dx, dy);
  return { x: dx / norm * speed, y: dy / norm * speed, stun: Math.min(k.maxStun, Math.round(speed * k.stunPerSpeed * stun)) };
}

/** Pure tick-driven stock lifecycle. It resolves all boundary exits together, before picking a winner. */
export class MatchDirector implements StockMatchView {
  state: StockMatchView['state'] = 'idle';
  readonly fighters: StockFighter[] = [];
  remainingTicks = 0;
  countdown = 0;
  winner: number | null = null;
  reason: StockMatchView['reason'] = null;

  constructor(readonly rules: Readonly<StockRules>, readonly zone: Readonly<BlastZone>) {}

  stop(): void {
    this.state = 'idle'; this.fighters.length = 0; this.winner = null; this.reason = null;
    this.countdown = 0; this.remainingTicks = this.rules.timeTicks;
  }

  start(count: number): void {
    this.fighters.length = 0;
    for (let i = 0; i < count; i++) this.fighters.push({ stocks: this.rules.stocks, volatility: 0, respawn: 0, protection: 0 });
    this.countdown = this.rules.countdownTicks;
    this.remainingTicks = this.rules.timeTicks;
    this.state = this.countdown > 0 ? 'countdown' : 'fighting';
    this.winner = null;
    this.reason = null;
  }

  hurt(slot: number, damage: number): boolean {
    const f = this.fighters[slot];
    if (this.state !== 'fighting' || !f || f.stocks <= 0 || f.respawn > 0 || f.protection > 0 || !Number.isFinite(damage) || damage <= 0) return false;
    f.volatility = Math.min(999, f.volatility + damage);
    return true;
  }

  step(positions: ReadonlyArray<{ x: number; y: number; dead?: boolean }>): { downs: number[]; respawns: number[] } {
    const changes = { downs: [] as number[], respawns: [] as number[] };
    if (this.state === 'countdown') {
      if (--this.countdown <= 0) this.state = 'fighting';
      return changes;
    }
    if (this.state !== 'fighting') return changes;
    const z = this.zone;
    for (let slot = 0; slot < this.fighters.length; slot++) {
      const f = this.fighters[slot], p = positions[slot];
      if (f.stocks <= 0) continue;
      if (f.respawn > 0) {
        if (--f.respawn === 0) {
          f.volatility = 0; f.protection = this.rules.protectionTicks;
          changes.respawns.push(slot);
        }
        continue;
      }
      if (f.protection > 0) f.protection--;
      if (p && (p.dead || p.x < z.left || p.x > z.right || p.y < z.top || p.y > z.bottom)) {
        f.stocks--; f.protection = 0;
        f.respawn = f.stocks > 0 ? this.rules.respawnTicks : 0;
        changes.downs.push(slot);
      }
    }
    const survivors = this.fighters.map((f, slot) => ({ f, slot })).filter(({ f }) => f.stocks > 0);
    if (survivors.length <= 1) {
      this.finish(survivors[0]?.slot ?? null, survivors.length ? 'stocks' : 'draw');
    } else if (--this.remainingTicks <= 0) {
      survivors.sort((a, b) => b.f.stocks - a.f.stocks || a.f.volatility - b.f.volatility);
      const [a, b] = survivors;
      const tied = a.f.stocks === b.f.stocks && a.f.volatility === b.f.volatility;
      this.finish(tied ? null : a.slot, tied ? 'draw' : 'timeout');
    }
    return changes;
  }

  private finish(winner: number | null, reason: NonNullable<StockMatchView['reason']>): void {
    this.state = 'finished'; this.winner = winner; this.reason = reason;
  }
}
