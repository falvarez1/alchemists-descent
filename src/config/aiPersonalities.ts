import type { FighterId } from '@/content/fighters';

/** Preferences are normalized weights, never permissions or independent random rolls. */
export const PERSONALITY_HELP = {
  aggression: 'Initiate an available exchange sooner.',
  defense: 'Value preventing a perceived hit, including while attacking.',
  risk: 'Accept exposure and closer spacing for a useful attack.',
  pressure: 'Keep advancing after a confirmed hit instead of resetting.',
  patience: 'Prefer a clear shot and a ready weapon over a marginal exchange.',
  opportunism: 'Value observed hitstun, vulnerability and a likely finishing hit.',
  melee: 'Prefer legal close kicks and close weapon spacing.',
  ranged: 'Prefer projectile spacing and ranged attacks when equipped.',
  aerial: 'Value defensive jumps when grounded; attacks still obey their ordinary airborne rules.',
  fastAttack: 'Prefer short weapon cycles and available kicks.',
  heavyAttack: 'Value higher-damage casts when the chance of connecting is useful.',
  combo: 'Prefer a legal follow-up after our own confirmed hit; grants no cancels.',
  counterattack: 'Value attacking after an observed projectile passes or an opponent is stunned.',
  dodge: 'Prefer a legal jump or sidestep against an incoming projectile.',
  block: 'Prefer the equipped fighter\'s guard or protective ability during a threat.',
  mobility: 'Increase footwork distance and repositioning value.',
  strongPosition: 'Avoid being pinned at a stage boundary when choosing a firing position.',
  platform: 'Value reachable platforms when the ground firing lane is obstructed.',
  recoveryCaution: 'Keep extra levitation reserve before optional platform traversal.',
  hazardAvoidance: 'Inspect farther ahead and prefer a safe bypass around harmful cells.',
  targetPersistence: 'Require a larger improvement before switching a valid target.',
  vulnerableTarget: 'Favour visibly wounded opponents.',
  dangerousTarget: 'Prioritize opponents whose observed attacks or proximity threaten us.',
  isolatedTarget: 'Prefer opponents away from other opponents in Arena creature encounters.',
  grudge: 'Modest preference for a recently observed attacker; decays with time.',
  variety: 'Discourage repeated equivalent actions, with bounded seeded variation.',
} as const;
export type PersonalityKey = keyof typeof PERSONALITY_HELP;
export type Personality = Record<PersonalityKey, number>;
export const PERSONALITY_KEYS = Object.keys(PERSONALITY_HELP) as PersonalityKey[];
export const PERSONALITY_IDS = ['berserker', 'duelist', 'ranger', 'assassin', 'guardian', 'trickster'] as const;
export type PersonalityId = typeof PERSONALITY_IDS[number];

const balanced: Personality = Object.fromEntries(PERSONALITY_KEYS.map(k => [k, 0.5])) as Personality;
const profile = (values: Partial<Personality>): Readonly<Personality> => Object.freeze({ ...balanced, ...values });
export const PERSONALITY_DEFAULTS: Readonly<Record<PersonalityId, Readonly<Personality>>> = Object.freeze({
  berserker: profile({ aggression: 0.95, defense: 0.4, risk: 0.85, pressure: 0.95, patience: 0.15, melee: 0.9, ranged: 0.25, heavyAttack: 0.8, combo: 0.8, strongPosition: 0.25, recoveryCaution: 0.4 }),
  duelist: profile({ aggression: 0.55, defense: 0.85, risk: 0.3, pressure: 0.55, patience: 0.85, counterattack: 0.95, combo: 0.75, targetPersistence: 0.8, variety: 0.3 }),
  ranger: profile({ aggression: 0.45, defense: 0.65, risk: 0.2, patience: 0.75, ranged: 0.95, melee: 0.15, mobility: 0.65, strongPosition: 0.8, platform: 0.8, hazardAvoidance: 0.85 }),
  assassin: profile({ aggression: 0.7, defense: 0.45, risk: 0.65, pressure: 0.8, opportunism: 0.95, mobility: 0.95, aerial: 0.75, fastAttack: 0.9, vulnerableTarget: 0.95, isolatedTarget: 0.9, targetPersistence: 0.35 }),
  guardian: profile({ aggression: 0.35, defense: 0.95, risk: 0.15, pressure: 0.25, patience: 0.85, block: 0.95, strongPosition: 0.95, recoveryCaution: 0.95, hazardAvoidance: 0.95, dangerousTarget: 0.8 }),
  trickster: profile({ aggression: 0.65, risk: 0.55, patience: 0.45, opportunism: 0.8, dodge: 0.85, mobility: 0.85, aerial: 0.8, combo: 0.65, variety: 0.95, targetPersistence: 0.4 }),
});
export const AI_PERSONALITIES: Record<PersonalityId, Personality> = Object.fromEntries(PERSONALITY_IDS.map(id => [id, { ...PERSONALITY_DEFAULTS[id] }])) as Record<PersonalityId, Personality>;
export const FIGHTER_PERSONALITIES: Record<FighterId, PersonalityId> = {
  'ilyra-voss': 'berserker', 'brann-rook': 'guardian', 'sable-fen': 'assassin', 'mara-quell': 'ranger',
  'kest-rel': 'assassin', 'nox-calder': 'trickster', 'edda-morrow': 'guardian', 'selene-wraith': 'trickster',
  'rusk-emberjaw': 'berserker', 'father-thorne': 'duelist',
};
export function isPersonality(value: unknown): value is PersonalityId { return PERSONALITY_IDS.includes(value as PersonalityId); }
export function defaultPersonality(fighter: FighterId | null): PersonalityId { return fighter ? FIGHTER_PERSONALITIES[fighter] : 'duelist'; }
export function setPersonalityValue(id: PersonalityId, key: PersonalityKey, value: number): number {
  AI_PERSONALITIES[id][key] = Math.max(0, Math.min(1, Number.isFinite(value) ? value : PERSONALITY_DEFAULTS[id][key]));
  return AI_PERSONALITIES[id][key];
}
export function resetPersonalities(): void { for (const id of PERSONALITY_IDS) Object.assign(AI_PERSONALITIES[id], PERSONALITY_DEFAULTS[id]); }
