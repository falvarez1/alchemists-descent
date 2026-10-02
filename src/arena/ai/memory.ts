import type { PerceivedFoe } from '@/arena/ai/execution';
import type { ShotView } from '@/arena/ai/worldView';

export interface ObservedHit { by: number; victim: number; damage: number; tick: number; attack?: string }
export interface OpponentMemory {
  seenAt: number;
  grudge: number;
  projectiles: number;
  hitConfirmedAt: number;
  damageEstimate: number;
}

/** All counters decay in simulation time. At most 16 opponents, 32 pending hits and 64 shots. */
export class CombatMemory {
  readonly opponents = new Map<object, OpponentMemory>();
  private pending: ObservedHit[] = [];
  private shots = new Map<object, number>();
  private lastTick = -1;
  private lastHp = -1;
  confidence = 0;
  caution = 0;
  lastAction = '';
  repetitions = 0;
  constructor(private readonly slot: number) {}

  reset(): void {
    this.opponents.clear(); this.pending.length = 0; this.shots.clear();
    this.lastTick = this.lastHp = -1; this.confidence = this.caution = 0;
    this.lastAction = ''; this.repetitions = 0;
  }
  hear(hit: ObservedHit): void {
    if (hit.by !== this.slot && hit.victim !== this.slot) return;
    if (this.pending.length === 32) this.pending.shift();
    this.pending.push(hit);
  }
  acted(action: string): void {
    this.repetitions = action === this.lastAction ? Math.min(8, this.repetitions + 1) : 0;
    this.lastAction = action;
  }
  get(ref: object): OpponentMemory | undefined { return this.opponents.get(ref); }
  update(tick: number, hp: number, maxHp: number, foes: readonly PerceivedFoe[], shots: readonly ShotView[]): void {
    const dt = this.lastTick < 0 ? 1 : Math.max(0, tick - this.lastTick);
    this.lastTick = tick;
    const decay = Math.pow(0.5, dt / 300);
    this.confidence *= decay; this.caution *= decay;
    if (this.lastHp >= 0 && hp < this.lastHp) this.caution = Math.min(1, this.caution + (this.lastHp - hp) / Math.max(1, maxHp) * 2);
    this.lastHp = hp;
    for (const [ref, m] of this.opponents) {
      m.grudge *= decay; m.projectiles *= decay;
      if (tick - m.seenAt > 600) this.opponents.delete(ref);
    }
    for (const foe of foes) {
      let m = this.opponents.get(foe.foe.ref);
      if (!m) {
        if (this.opponents.size >= 16) this.opponents.delete(this.opponents.keys().next().value!);
        m = { seenAt: tick, grudge: 0, projectiles: 0, hitConfirmedAt: -9999, damageEstimate: 0 };
        this.opponents.set(foe.foe.ref, m);
      }
      m.seenAt = tick;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const hit = this.pending[i];
        if (tick - foe.age < hit.tick || (hit.by !== foe.foe.slot && hit.victim !== foe.foe.slot)) continue;
        if (hit.victim === this.slot) m.grudge = Math.min(1, m.grudge + hit.damage / Math.max(1, maxHp) * 3);
        else {
          m.hitConfirmedAt = tick;
          if (hit.attack === undefined || hit.attack === 'spell') m.damageEstimate = m.damageEstimate === 0 ? hit.damage : m.damageEstimate * 0.75 + hit.damage * 0.25;
          this.confidence = Math.min(1, this.confidence + 0.15);
        }
        this.pending.splice(i, 1);
      }
      for (const shot of shots) {
        if (shot.owner === undefined || shot.owner !== foe.foe.slot || this.shots.has(shot.ref)) continue;
        m.projectiles = Math.min(1, m.projectiles + 0.12);
        this.shots.set(shot.ref, tick);
      }
    }
    this.pending = this.pending.filter(h => tick - h.tick <= 600);
    for (const [ref, at] of this.shots) if (tick - at > 240) this.shots.delete(ref);
    while (this.shots.size > 64) this.shots.delete(this.shots.keys().next().value!);
  }
}
