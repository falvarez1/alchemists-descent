import type { Enemy, EnemyKind } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { impulse } from '@/creatures/rig/physics';
import { softImpulse } from '@/creatures/rig/softbody';

/**
 * IDLE LIFE (WS-N, the Rain World bar): an animal that is not busy is not a
 * statue. Every few seconds a resting or foraging creature does one small
 * thing from its own repertoire — looks around, sniffs the ground, grooms,
 * shakes itself, stretches a wing on the roost, settles its weight — then
 * goes still again. Purely presentation: a deterministic clock per individual
 * (no simulation randomness), read by the pose layer and the species rigs.
 */
export type IdleAct = 'none' | 'look' | 'sniff' | 'groom' | 'shiver' | 'stretch' | 'settle';

export interface IdleLife {
  act: IdleAct;
  /** Ticks into the act, and its length. */
  t: number;
  dur: number;
  /** Tick the next act may start. */
  next: number;
  /** Which way it looks / which wing it stretches. */
  side: number;
}

/** Length of each act (ticks). */
export const IDLE_DUR: Record<Exclude<IdleAct, 'none'>, number> = {
  look: 84, sniff: 56, groom: 90, shiver: 26, stretch: 70, settle: 110,
};
/** Quiet between acts: base + up to spread ticks (per individual). */
export const IDLE_GAP = 170;
export const IDLE_GAP_SPREAD = 320;

const REPERTOIRE: Partial<Record<EnemyKind, readonly IdleAct[]>> = {
  bat: ['look', 'shiver', 'groom'],
  slime: ['look', 'shiver', 'settle'],
  acidslime: ['look', 'shiver', 'settle'],
  bomber: ['shiver', 'look'],
  spitter: ['look', 'sniff', 'groom', 'shiver'],
  imp: ['look', 'groom', 'shiver'],
  wisp: ['look', 'shiver'],
  golem: ['look', 'settle', 'shiver'],
  colossus: ['look', 'settle'],
  rimewarden: ['look', 'settle'],
  mage: ['look', 'groom'],
  rootloper: ['look', 'sniff', 'shiver'],
  rillback: ['sniff', 'look'],
  stonemaw: ['sniff'],
  leviathan: ['look'],
};
/** A roosting bat has its own small life: it stretches a wing, ruffles, grooms. */
const ROOST: readonly IdleAct[] = ['stretch', 'shiver', 'groom', 'stretch'];

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** May it idle now? Only an animal with nothing to do, holding still. */
function restful(e: Enemy): boolean {
  if (e.hp <= 0 || (e.windup ?? 0) > 0 || (e.swoop ?? 0) > 0 || e.flash > 0 || (e.knockT ?? 0) > 0) return false;
  if (e.status.burning > 0 || e.status.electrified > 0 || (e.fleeT ?? 0) > 0) return false;
  if (e.sleeping) return e.kind === 'bat';
  const intent = e.mind?.intent ?? 'forage';
  if (intent === 'hunt' || intent === 'retreat' || intent === 'investigate') return false;
  if (e.boss && e.boss.move !== 'march' && e.boss.move !== 'lurk') return false;
  const flier = e.kind === 'bat' || e.kind === 'imp' || e.kind === 'wisp';
  return flier || Math.abs(e.vx) < 0.3;
}

/** Advance the idle clock one tick; returns the act in progress. */
export function tickIdleLife(e: Enemy, tick: number): IdleLife {
  const phase = e.mind?.phase ?? Math.floor(e.bobPhase * 1000);
  const life = e.idle ??= { act: 'none', t: 0, dur: 0, next: tick + 60 + Math.floor(hash(phase, 1) * IDLE_GAP_SPREAD), side: 1 };
  const menu = e.sleeping && e.kind === 'bat' ? ROOST : REPERTOIRE[e.kind];
  if (!menu || !restful(e)) {
    if (life.act !== 'none') { life.act = 'none'; life.next = tick + IDLE_GAP; }
    return life;
  }
  if (life.act !== 'none') {
    life.t++;
    if (life.t >= life.dur) {
      life.act = 'none';
      life.next = tick + IDLE_GAP + Math.floor(hash(phase, tick) * IDLE_GAP_SPREAD);
    }
    return life;
  }
  if (tick < life.next) return life;
  const pick = menu[Math.floor(hash(phase + 7, tick) * menu.length) % menu.length];
  life.act = pick;
  life.t = 0;
  life.dur = IDLE_DUR[pick as Exclude<IdleAct, 'none'>];
  life.side = hash(phase + 13, tick) < 0.5 ? -1 : 1;
  return life;
}

/** 0 → 1 → 0 envelope over the act (eased in and out). */
export function idleEnvelope(life: IdleLife): number {
  if (life.act === 'none' || life.dur <= 0) return 0;
  const k = life.t / life.dur;
  const up = Math.min(1, k / 0.25), down = Math.min(1, (1 - k) / 0.25);
  const m = Math.min(up, down);
  return m * m * (3 - 2 * m);
}

/**
 * The generic half of idle life, applied after the species rig has stepped:
 * a shiver shakes every chunk of the body (gel jiggles), a sniff or a groom
 * dips the head toward the ground or the chest. Species rigs pose their own
 * acts (a bat's wing stretch, a slime settling) from `e.idle`.
 */
export function applyIdleToRig(e: Enemy, rig: CreatureRig, head: number): void {
  const life = e.idle;
  if (!life || life.act === 'none') return;
  const env = idleEnvelope(life);
  if (life.act === 'shiver') {
    const s = (life.t % 4 < 2 ? 1 : -1) * 0.22 * env;
    for (let i = 0; i < rig.pts.length; i++) impulse(rig.pts[i], i % 2 === 0 ? s : -s, -Math.abs(s) * 0.3);
    if (rig.soft && life.t % 3 === 0) softImpulse(rig.soft, s * 0.6, -0.15 * env, 0.5);
  } else if ((life.act === 'sniff' || life.act === 'groom') && head >= 0 && head < rig.pts.length) {
    const p = rig.pts[head];
    const face = e.mind?.facing ?? 1;
    // A sniff noses down and forward in little pecks; a groom tucks toward the chest.
    const peck = life.act === 'sniff' ? Math.max(0, Math.sin(life.t * 0.45)) : Math.sin(life.t * 0.9) * 0.5;
    const dx = life.act === 'sniff' ? face * 0.6 : -face * 0.9;
    p.x += (dx * env) * 0.35;
    p.y += ((life.act === 'sniff' ? 1.6 : 1.1) + peck * 0.8) * env * 0.35;
  }
}

/** Gaze override for a look-around: where the eyes should be (null = no override). */
export function idleGaze(e: Enemy): { x: number; y: number } | null {
  const life = e.idle;
  if (!life || life.act !== 'look') return null;
  const env = idleEnvelope(life);
  // Look one way, hold, glance back over the shoulder, return.
  const k = life.t / Math.max(1, life.dur);
  const x = (k < 0.55 ? life.side : -life.side * 0.8) * 0.95 * env;
  return { x, y: (k < 0.55 ? -0.25 : 0.15) * env };
}
