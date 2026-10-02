import type { Personality } from '@/config/aiPersonalities';
import type { AiTier } from '@/config/aiTiers';
import type { PerceivedFoe } from '@/arena/ai/execution';
import type { MeView } from '@/arena/ai/worldView';
import type { CombatMemory } from '@/arena/ai/memory';
import { AI_BEHAVIOR } from '@/config/aiBehavior';

export type CombatAction = 'shoot' | 'kick' | 'tactical' | 'ultimate' | 'defend' | 'wait';
export interface UtilityScore { action: string; total: number; terms: Record<string, number> }
const unit = (n: number): number => Math.max(0, Math.min(1, n));
const VARIATION: Record<CombatAction, number> = { shoot: 1, kick: -1, tactical: 0.5, ultimate: -0.5, defend: -0.8, wait: 0.3 };
function score(action: string, terms: Record<string, number>): UtilityScore {
  return { action, total: Object.values(terms).reduce((a, b) => a + b, 0), terms };
}

/** Normalized engagement cost, health, crowding and observed threat. No human/CPU discriminator. */
export function targetUtilities(foes: readonly PerceivedFoe[], current: object | null, p: Personality, memory: CombatMemory | undefined, hasLine?: (f: PerceivedFoe) => boolean): UtilityScore[] {
  return foes.map(f => {
    const m = memory?.get(f.foe.ref);
    const crowd = foes.filter(other => other !== f && Math.hypot(f.cx - other.cx, f.cy - other.cy) < 90).length;
    return score(`${f.foe.kind}@${Math.round(f.x)}`, {
      engagement: 0.4 * (1 - unit(f.dist / 600)),
      vulnerability: 0.25 * p.vulnerableTarget * (1 - f.foe.hpFrac),
      opportunity: 0.15 * p.opportunism * (f.foe.staggered || (m && m.hitConfirmedAt > m.seenAt - 30) ? 1 : 0),
      threat: 0.2 * p.dangerousTarget * Math.max(unit(1 - f.dist / 100), m?.projectiles ?? 0),
      isolation: 0.15 * p.isolatedTarget / (1 + crowd),
      retaliation: 0.15 * p.grudge * (m?.grudge ?? 0),
      persistence: f.foe.ref === current ? 0.12 + AI_BEHAVIOR.targetStickiness * p.targetPersistence : 0,
      blocked: hasLine && !hasLine(f) ? -0.3 : 0,
      crowdRisk: -0.12 * (1 - p.risk) * unit(crowd / 3),
    });
  });
}

export interface ActionSituation {
  me: MeView;
  target: PerceivedFoe;
  personality: Personality;
  skill: AiTier;
  memory: CombatMemory;
  tick: number;
  threatened: boolean;
  eligible: Record<CombatAction, boolean>;
  /** Estimated delivered damage from our observed successful hits; zero until evidence exists. */
  damage: number;
  variation: number;
  defensiveKit: boolean;
}

/** Utilities are estimates, not calibrated probabilities. Damage is normalized by target health,
 * distance by weapon range, cooldown by 90 ticks. Illegal actions never reach the score list.
 */
export function actionUtilities(s: ActionSituation): UtilityScore[] {
  const { me, target, personality: p, memory, skill } = s;
  const m = memory.get(target.foe.ref);
  const follow = m && s.tick - m.hitConfirmedAt < 35 ? 1 : 0;
  const hitEstimate = unit(1 - target.dist / Math.max(1, me.weapon.maxRange) * 0.3 - Math.hypot(target.vx, target.vy) * (1 - skill.prediction) * 0.1 - skill.aimError / 60);
  const finish = s.damage > 0 && s.damage >= target.foe.hp ? hitEstimate : 0;
  const threat = s.threatened ? 1 : unit(1 - target.dist / 45);
  const hurt = 1 - me.hpFrac;
  const rows: UtilityScore[] = [];
  const add = (action: CombatAction, terms: Record<string, number>): void => {
    if (!s.eligible[action]) return;
    const repetition = memory.lastAction === action ? memory.repetitions / 8 : 0;
    rows.push(score(action, { ...terms, repetition: -0.12 * p.variety * repetition, variation: s.variation * (0.25 + p.variety) * VARIATION[action] }));
  };
  add('shoot', {
    connect: 0.45 * hitEstimate, initiate: 0.22 * p.aggression, ranged: 0.18 * p.ranged, confidence: 0.06 * memory.confidence,
    finish: 0.55 * finish * (0.5 + p.opportunism), followUp: 0.18 * follow * (p.combo + p.pressure) * (1 - skill.mistake),
    heavy: 0.12 * p.heavyAttack * unit(s.damage / Math.max(1, target.foe.maxHp) * 5),
    tempo: 0.1 * p.fastAttack * (1 - unit((me.weapon.cycleTicks ?? me.wandCooldown) / 90)),
    counter: 0.14 * p.counterattack * Math.max(target.foe.staggered ? 1 : 0, (m?.projectiles ?? 0) * (s.threatened ? 0 : 1)),
    exposure: -0.24 * threat * p.defense * (1 - p.risk), resource: -0.18 * (1 - me.manaFrac) * p.patience,
  });
  add('kick', { contact: 0.55, melee: 0.22 * p.melee, fast: 0.12 * p.fastAttack, followUp: 0.15 * follow * p.combo, pressure: 0.1 * p.pressure, exposure: -0.15 * hurt * (1 - p.risk) });
  add('tactical', { opportunity: 0.53, style: 0.2 * (s.defensiveKit ? p.block : p.opportunism), defense: s.defensiveKit ? 0.3 * threat * p.defense : 0, pressure: 0.1 * p.pressure, mobility: s.defensiveKit ? 0 : 0.1 * p.mobility });
  add('ultimate', { opportunity: 0.66, commit: 0.18 * p.aggression, survival: 0.2 * hurt * p.defense, finish: 0.1 * p.opportunism * (1 - target.foe.hpFrac) });
  add('defend', { imminent: 0.55 * threat, defense: 0.25 * p.defense, dodge: 0.18 * p.dodge, aerial: me.grounded ? 0.08 * p.aerial : 0, survival: 0.18 * hurt * (1 - p.risk), caution: 0.08 * memory.caution, adaptation: 0.12 * (m?.projectiles ?? 0) * skill.adaptation });
  add('wait', { reset: 0.05, patience: 0.2 * p.patience, resource: 0.1 * (1 - me.manaFrac), danger: -0.1 * threat });
  return rows.sort((a, b) => b.total - a.total);
}

/** Keep a legal commitment unless the challenger is clearly better; urgent defense can interrupt intent. */
export function selectAction(rows: readonly UtilityScore[], current: CombatAction, committed: boolean, urgent: boolean): CombatAction {
  const best = rows[0];
  if (!best) return 'wait';
  const old = rows.find(r => r.action === current);
  if (!urgent && old && (committed || best.total < old.total + 0.08)) return current;
  return best.action as CombatAction;
}
