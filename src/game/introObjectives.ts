import type { CardId } from '@/core/types';

/**
 * Single source of truth for the D1 onboarding contract.
 *
 * `IntroProgression` PRODUCES these objective lines; the HUD CONSUMES them (the
 * pre-key passthrough set + the control-hint row). Keeping the strings, the
 * passthrough set, the control hints, and the gate card in one module stops the
 * producer and consumer from drifting into silent mismatches — a stale string on
 * either side used to fall straight through to "FIND THE GOLDEN KEY" and drop its
 * control prompt with nothing to catch it.
 */

/** Card the D1 Spell Lab grants and the wand bench must slot before descent. */
export const INTRO_REWARD_CARD: CardId = 'heavy';

export const INTRO_OBJECTIVE = {
  surface: 'DESCEND INTO THE CAVE',
  movement: 'MOVE THROUGH THE CAVE',
  spark: 'WAND I: FIRE A SPARK',
  dig: 'WAND II: EXCAVATE ROCK OR SAND',
  flask: 'STARTER FLASK: USE THE WATER',
  spellLab: 'FIND THE SPELL LAB NEAR REFUGE',
  labDig: 'SPELL LAB: EXCAVATE THE SAND',
  labWater: 'SPELL LAB: POUR WATER ON HEAT',
  labSpark: 'SPELL LAB: SPARK THE COIL',
  labTome: 'SPELL LAB: CLAIM THE TOME',
  bench: 'WAND BENCH: SLOT HEAVY',
  benchAvailable: 'WAND BENCH READY — PRESS B',
  returnPortal: 'RETURN TO THE PORTAL',
  findKey: 'FIND THE GOLDEN KEY',
} as const;

/**
 * Objectives shown BEFORE the golden key is taken — the HUD lets these pass
 * through instead of collapsing them to FIND THE GOLDEN KEY. (benchAvailable is
 * a post-key nudge, so it is deliberately absent.)
 */
export const INTRO_PRE_KEY_OBJECTIVES: ReadonlySet<string> = new Set([
  INTRO_OBJECTIVE.surface,
  INTRO_OBJECTIVE.movement,
  INTRO_OBJECTIVE.spark,
  INTRO_OBJECTIVE.dig,
  INTRO_OBJECTIVE.flask,
  INTRO_OBJECTIVE.spellLab,
  INTRO_OBJECTIVE.labDig,
  INTRO_OBJECTIVE.labWater,
  INTRO_OBJECTIVE.labSpark,
  INTRO_OBJECTIVE.labTome,
  INTRO_OBJECTIVE.bench,
]);

export interface IntroControlHintPart {
  key: string;
  label: string;
}

const BENCH_HINT: readonly IntroControlHintPart[] = [
  { key: 'B', label: 'open wand bench' },
  { key: 'Heavy', label: 'slot card' },
  { key: '1 / 2', label: 'choose wand' },
];

/** Per-objective control prompt shown under the objective line during onboarding. */
const INTRO_CONTROL_HINTS: Readonly<Record<string, readonly IntroControlHintPart[]>> = {
  [INTRO_OBJECTIVE.surface]: [
    { key: 'A / D', label: 'explore the surface' },
    { key: 'SPACE', label: 'jump' },
    { key: 'cave mouth', label: 'drop in to descend' },
  ],
  [INTRO_OBJECTIVE.movement]: [
    { key: 'A / D', label: 'move' },
    { key: 'SPACE', label: 'jump / levitate' },
    { key: 'S + move', label: 'crawl' },
  ],
  [INTRO_OBJECTIVE.spark]: [
    { key: '1', label: 'draw Wand I' },
    { key: 'mouse', label: 'aim' },
    { key: 'LMB', label: 'cast Spark' },
  ],
  [INTRO_OBJECTIVE.dig]: [
    { key: '2 / wheel', label: 'draw Wand II' },
    { key: 'mouse', label: 'aim' },
    { key: 'LMB', label: 'excavate cells' },
  ],
  [INTRO_OBJECTIVE.flask]: [
    { key: 'E', label: 'siphon' },
    { key: 'Q', label: 'pour' },
    { key: 'X', label: 'drink' },
    { key: 'RMB', label: 'throw' },
  ],
  [INTRO_OBJECTIVE.spellLab]: [
    { key: 'Dig', label: 'sand' },
    { key: 'Fire', label: 'wood' },
    { key: 'Water', label: 'heat' },
    { key: 'Spark', label: 'coil' },
  ],
  [INTRO_OBJECTIVE.labDig]: [
    { key: '2 / wheel', label: 'draw Wand II' },
    { key: 'LMB', label: 'cut the sand cells' },
  ],
  [INTRO_OBJECTIVE.labWater]: [
    { key: 'Q', label: 'pour water' },
    { key: 'RMB', label: 'throw flask' },
    { key: 'E', label: 'siphon basin water' },
  ],
  [INTRO_OBJECTIVE.labSpark]: [
    { key: '1', label: 'draw Wand I' },
    { key: 'LMB', label: 'spark the coil' },
  ],
  [INTRO_OBJECTIVE.labTome]: [
    { key: 'Tome', label: 'walk over the reward' },
    { key: 'Heavy', label: 'new card' },
  ],
  [INTRO_OBJECTIVE.bench]: BENCH_HINT,
  [INTRO_OBJECTIVE.benchAvailable]: BENCH_HINT,
};

export function introControlHintForObjective(text: string): IntroControlHintPart[] | null {
  const hint = INTRO_CONTROL_HINTS[text];
  return hint ? hint.map((part) => ({ ...part })) : null;
}
