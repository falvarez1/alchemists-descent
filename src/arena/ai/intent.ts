import type { FighterId } from '@/content/fighters';
import type { EnemyKind } from '@/core/types';
import type { PerceivedFoe } from '@/arena/ai/execution';
import type { MeView } from '@/arena/ai/worldView';
import { AI_BEHAVIOR } from '@/config/aiBehavior';
import type { Personality } from '@/config/aiPersonalities';
import type { CombatMemory } from '@/arena/ai/memory';
import { targetUtilities } from '@/arena/ai/utility';

/**
 * INTENT (docs/arena/AI-FIGHTERS.md 2.2): a small utility chooser. Given what the bot perceives, it scores a handful of
 * goals from 0 to 1 and takes the best, sticky so the bot does not flicker between them:
 *
 *   approach    close the distance to a foe that is further than the fighter likes
 *   retreat     get away from something dangerous (a golem's slam reach), or from a foe that is too close
 *   zone        hold the preferred range and fight from it
 *   pressure    stay on top of a wounded foe and finish it
 *   reposition  change level or find a line of fire (the nav's edges)
 *   search      nothing in sight: go where a fight is likely
 *
 * Each fighter's `Style` (archetype weights as data) sets its preferred range and how much it loves to close in; the foes'
 * `FOE_TRAITS` say how far each reaches and how much it hurts. v1 shares one chooser between all ten fighters; the per-fighter
 * playbooks (docs/arena/AI-FIGHTERS.md 4) layer on top in v2.
 */

export type IntentId = 'approach' | 'retreat' | 'zone' | 'pressure' | 'reposition' | 'recover' | 'search';

export const INTENT_IDS: readonly IntentId[] = ['approach', 'retreat', 'zone', 'pressure', 'reposition', 'recover', 'search'];

/** A fighter's archetype weights. */
export interface Style {
  /** The distance (cells, shoulder to body centre) it likes to fight at. */
  range: number;
  /** How far either side of `range` is still "at range". */
  band: number;
  /** 0..1: how readily it closes in (a brawler loves `approach`, a kiter hates it). */
  aggression: number;
  /** The distances (body centre to body centre, cells) between which its tactical (Z) is worth pressing on a foe. */
  z: readonly [number, number];
}

export const CLASSIC_STYLE: Readonly<Style> = Object.freeze({ range: 70, band: 24, aggression: 0.55, z: [0, 0] as const });

/** From docs/arena/ROSTER-IDENTITY.md (the archetype of each sheet and its AI playbook's range). */
export const FIGHTER_STYLES: Readonly<Record<FighterId, Readonly<Style>>> = Object.freeze({
  'ilyra-voss': { range: 52, band: 22, aggression: 0.8, z: [34, 110] }, // rushdown: close to mid; the crucible lands at a foe's feet
  'brann-rook': { range: 40, band: 16, aggression: 0.9, z: [0, 55] }, // the wall that walks forward; the plate is for what is in front of him
  'sable-fen': { range: 72, band: 26, aggression: 0.6, z: [30, 130] }, // hunter: the tether reaches a long way
  'mara-quell': { range: 112, band: 30, aggression: 0.3, z: [40, 170] }, // zoner: a bell on the approach lane
  'kest-rel': { range: 66, band: 24, aggression: 0.7, z: [22, 70] }, // skirmisher: the dash is 36 cells long
  'nox-calder': { range: 58, band: 22, aggression: 0.65, z: [30, 140] }, // stalker: the canister is thrown ahead
  'edda-morrow': { range: 86, band: 26, aggression: 0.45, z: [0, 90] }, // support: the shard before a trade
  'selene-wraith': { range: 60, band: 24, aggression: 0.7, z: [30, 90] }, // trickster: the blink is 40 long
  'rusk-emberjaw': { range: 30, band: 14, aggression: 1, z: [20, 80] }, // charger: the ram closes the gap
  'father-thorne': { range: 72, band: 24, aggression: 0.5, z: [30, 110] }, // trapper: vines on the surface the foe crosses
});

export function styleFor(id: FighterId | null): Readonly<Style> {
  return id === null ? CLASSIC_STYLE : FIGHTER_STYLES[id];
}

/** What a foe kind does to a bot that stands near it. */
export interface FoeTraits {
  /** The distance (cells, centre to centre) inside which it can hurt in melee. */
  reach: number;
  /** 0..1: how much a bot should fear being in that reach. */
  danger: number;
}

const DEFAULT_TRAITS: FoeTraits = { reach: 16, danger: 0.5 };

/** Read from `Enemies.ts` (the golem's slam lands inside |dx| 15, |dy| 22; a slime is a contact hazard). */
export const FOE_TRAITS: Readonly<Partial<Record<EnemyKind, FoeTraits>>> = Object.freeze({
  slime: { reach: 13, danger: 0.3 },
  acidslime: { reach: 13, danger: 0.4 },
  golem: { reach: 26, danger: 1 },
  imp: { reach: 18, danger: 0.5 },
  bat: { reach: 14, danger: 0.3 },
  wisp: { reach: 10, danger: 0.3 },
  bomber: { reach: 26, danger: 0.8 },
  spitter: { reach: 0, danger: 0.3 },
  mage: { reach: 0, danger: 0.45 },
});

export function traitsOf(kind: EnemyKind): FoeTraits {
  return FOE_TRAITS[kind] ?? DEFAULT_TRAITS;
}

export interface IntentInput {
  personality?: Personality;
  memory?: CombatMemory;
  tick?: number;
  me: MeView;
  foes: readonly PerceivedFoe[];
  style: Readonly<Style>;
  /** The goal it is in now, and how many ticks it has held it. */
  current: IntentId;
  heldFor: number;
  /** The foe it was after (kept unless something clearly better appears). */
  currentTarget: object | null;
  /** The target stands on another surface than the bot (the nav must carry it there). */
  otherLevel: (foe: PerceivedFoe) => boolean;
  /** Ticks the bot has had no line of fire to its target while in range. */
  noShotTicks: number;
  recovering?: boolean;
  hasLine?: (foe: PerceivedFoe) => boolean;
}

export interface IntentChoice {
  intent: IntentId;
  target: PerceivedFoe | null;
  /** The preferred distance to this target (the style's, pushed out by the foe's reach). */
  range: number;
  scores: Record<IntentId, number>;
}

const MIN_HOLD = 14;
const STICK_BONUS = 0.1;

/** The distance the bot wants from `foe`: its style's range, never inside the foe's reach plus a margin. */
export function preferredRange(style: Readonly<Style>, foe: PerceivedFoe): number {
  return Math.max(style.range, traitsOf(foe.foe.kind).reach + 24);
}

/** Pick the foe to fight: the nearest, favouring the wounded and the one already chosen. */
export function pickTarget(foes: readonly PerceivedFoe[], current: object | null, hasLine?: (foe: PerceivedFoe) => boolean): PerceivedFoe | null {
  let best: PerceivedFoe | null = null;
  let bestScore = Infinity;
  for (const f of foes) {
    let s = f.dist;
    if (f.foe.hpFrac < AI_BEHAVIOR.finishHealth) s *= 0.75;
    if (current !== null && f.foe.ref === current) s *= 1 - AI_BEHAVIOR.targetStickiness;
    if (hasLine && !hasLine(f)) s += 90;
    if (s < bestScore) { best = f; bestScore = s; }
  }
  return best;
}

export function chooseIntent(input: IntentInput): IntentChoice {
  const { me, foes, style } = input;
  const scores: Record<IntentId, number> = { approach: 0, retreat: 0, zone: 0, pressure: 0, reposition: 0, recover: 0, search: 0 };
  let target = pickTarget(foes, input.currentTarget, input.hasLine);
  const p = input.personality;
  if (p) {
    const ranked = targetUtilities(foes, input.currentTarget, p, input.memory, input.hasLine);
    let best = -Infinity;
    for (let i = 0; i < foes.length; i++) if (ranked[i].total > best) { target = foes[i]; best = ranked[i].total; }
  }
  if (target === null) {
    scores.search = 1;
    return { intent: 'search', target: null, range: 0, scores };
  }
  const styled = p ? { ...style, range: style.range * (0.8 + 0.6 * p.ranged - 0.35 * p.melee) + 8 * p.patience - 8 * p.risk } : style;
  const range = Math.max(me.weapon.minRange + style.band + 6, Math.min(me.weapon.maxRange - 12, preferredRange(styled, target)));
  const lo = range - style.band;
  const hi = range + style.band;
  const d = target.dist;
  const aggr = Math.min(1, (p ? 0.3 * style.aggression + 0.7 * p.aggression : style.aggression) * AI_BEHAVIOR.aggression);

  // retreat: the worst thing standing too close, then a general "too close for my taste", then being hurt
  let danger = 0;
  for (const f of foes) {
    const t = traitsOf(f.foe.kind);
    const margin = t.reach + 22;
    const near = Math.max(0, (margin - Math.abs(f.cx - me.x)) / margin);
    if (Math.abs(f.cy - me.sy) < 40) danger = Math.max(danger, t.danger * near);
  }
  const tooClose = d < lo ? ((lo - d) / Math.max(1, lo)) * 0.35 * (1 - aggr) : 0;
  const hurt = me.hpFrac < AI_BEHAVIOR.retreatHealth && d < hi ? 0.8 : 0;
  scores.retreat = Math.min(1, (danger + tooClose + hurt) * AI_BEHAVIOR.caution * (p ? 0.65 + p.defense * 0.65 - p.risk * 0.2 : 1));
  if (d < me.weapon.minRange + 6) scores.retreat = 1.2;
  scores.recover = input.recovering ? 0.95 : 0;

  scores.approach = d > hi ? Math.max(0.25, Math.min(1, (d - hi) / 50)) * (0.55 + 0.45 * aggr) : 0;
  scores.zone = d >= lo && d <= hi ? 0.5 : 0.12;
  scores.pressure = target.foe.hpFrac < AI_BEHAVIOR.finishHealth && me.hpFrac > target.foe.hpFrac && !input.recovering && d < hi + 60 ? 0.5 + 0.4 * aggr : 0;
  const confirmed = input.memory?.get(target.foe.ref)?.hitConfirmedAt ?? -9999;
  if (p && !input.recovering && (input.tick ?? 0) - confirmed < 45 && d < hi + 60) scores.pressure = Math.max(scores.pressure, 0.4 + 0.4 * p.pressure + 0.12 * p.opportunism);
  scores.reposition = input.otherLevel(target) ? 1.1 : input.noShotTicks > AI_BEHAVIOR.blockedTicks ? 0.9 : 0;
  if (p) {
    scores.reposition += scores.reposition > 0 ? 0.1 * p.platform + 0.08 * p.mobility : 0;
    scores.zone += p.patience * 0.1;
  }
  if (input.noShotTicks > AI_BEHAVIOR.blockedTicks) scores.approach *= 0.4;

  const hold = input.heldFor < MIN_HOLD;
  scores[input.current] += STICK_BONUS;
  let intent: IntentId = 'zone';
  let top = -1;
  for (const id of INTENT_IDS) {
    if (id === 'search') continue;
    if (scores[id] > top) { top = scores[id]; intent = id; }
  }
  // sticky: keep the goal for a short while unless a retreat has become urgent
  if (hold && input.current !== 'search' && intent !== input.current && !(intent === 'retreat' && scores.retreat > 0.8)) intent = input.current;
  return { intent, target, range, scores };
}
