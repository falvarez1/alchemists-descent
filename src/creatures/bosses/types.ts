import type { Enemy, EnemyDef } from '@/core/types';

/**
 * Boss brains (WS-N): the phase, the committed move and its clock, and the
 * bookkeeping that keeps a boss fight honest — a boss only takes damage from
 * what the player caused, never starts a fight already hurt, and its designed
 * weakness lands as a readable beat rather than a silent drain.
 *
 * Presentation reads the brain too (the rig poses from `move`/`moveT`), so
 * every tell the player sees is the same clock the attack fires on.
 */
export type BossMove =
  // Kiln Colossus
  | 'march' | 'slam' | 'stomp' | 'throw' | 'vent' | 'quench' | 'roar' | 'dying'
  // Sunken Leviathan
  | 'lurk' | 'lunge' | 'volley' | 'thrash' | 'dive' | 'shock' | 'beached';

/** A stomp's shockwave, running along the real floor. */
export interface ShockWave {
  x: number;
  y: number;
  dir: number;
  life: number;
  hit: boolean;
}

export interface BossBrain {
  /** 1 (fresh) → 2 (below 66%) → 3 (below 33%). */
  phase: number;
  move: BossMove;
  moveT: number;
  moveDur: number;
  lastMove: BossMove;
  /** Colossus: furnace heat 0..1. Only a hot kiln cracks when water hits it. */
  heat: number;
  /** Colossus: the thermal-shock re-arm. Rime Warden: ticks until its rime has re-set (no plate goes before). */
  quenchCd: number;
  /** The player has entered the fight (its entrance ran, or he struck it), and when. */
  engaged: boolean;
  engagedAt: number;
  /** Tick the current soaking began: only water that arrives after the fight starts counts. */
  wetStart: number;
  /** Damage the player has caused; a boss the player never touched starts whole. */
  playerDamage: number;
  wasWet: boolean;
  waves: ShockWave[];
  /** The committed target of the current move (where the throw lands, where the lunge goes). */
  aimX: number;
  aimY: number;
  /** Colossus: armour plates still on (phase 3 sheds them). */
  plates: number;
  /** Ticks left in a vulnerability window (a quenched, kneeling kiln; a beached leviathan's gasp). */
  exposed: number;
  /** Own-attack grace: blows that land before this tick are its own (a slam's blast) and ignored. */
  selfHarmUntil: number;
  /** Leviathan: ticks until the next electrocution jolt may land. */
  jolt: number;
  /** The death sequence has handed off to the kill path. */
  finished: boolean;
  /** One-off callouts already shown this fight (a name is said once). */
  said: string[];
}

export function makeBossBrain(): BossBrain {
  return {
    phase: 1, move: 'march', moveT: 0, moveDur: 0, lastMove: 'march', heat: 1, quenchCd: 0,
    engaged: false, engagedAt: 0, wetStart: -1, playerDamage: 0, wasWet: false, waves: [], aimX: 0, aimY: 0, plates: 6,
    exposed: 0, selfHarmUntil: 0, jolt: 0, finished: false, said: [],
  };
}

export function ensureBossBrain(e: Enemy): BossBrain {
  e.boss ??= makeBossBrain();
  return e.boss;
}

/** The fight starts now (idempotent): the player walked into the lair or struck the boss. */
export function engageBoss(b: BossBrain, tick: number): void {
  if (b.engaged) return;
  b.engaged = true;
  b.engagedAt = tick;
}

/** What a boss module may ask of the enemy system that owns it. */
export interface BossHost {
  voice(e: Enemy, fn: () => void, range?: number): void;
  shakeAt(x: number, y: number, amount: number, cap: number): void;
  hasAttackLine(e: Enemy, def: EnemyDef, lob?: boolean): boolean;
  /** Hand a finished death sequence to the ordinary kill path (payout, events, run end). */
  finishDeath(e: Enemy): void;
  /** The Leviathan's ranged arm: its own pool thrown at the alchemist. */
  poolVolley(e: Enemy): void;
  /** May the world's harm (current, a flood) land on this boss now? core/bossWard (player engaged). */
  worldHarm(e: Enemy): boolean;
  /** The ward's thermal-shock clock: this tick's crack damage (KILN_QUENCH), or 0. */
  quenchTick(e: Enemy, soaked: boolean): number;
  /** True while this boss is still introducing itself. */
  introducing(e: Enemy): boolean;
}

/** The per-tick read of the fight the enemy loop already computed. */
export interface BossSense {
  targetAlive: boolean;
  canAttack: boolean;
  pdx: number;
  pdy: number;
  pDist: number;
  debugSuppressed: boolean;
}

/** Phase for a health fraction: 1 above 66%, 2 above 33%, then 3. */
export function bossPhaseFor(hpFrac: number): number {
  return hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;
}
