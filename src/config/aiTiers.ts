/**
 * THE BOT SKILL LEVELS (docs/arena/AI-FIGHTERS.md 2): skill is a dial, not a different bot. The same brain is a
 * tutorial opponent at level 1 and a balance-testing opponent at level 5. Personality is independent.
 *
 *   reaction  how many ticks old the bot's picture of its foes is (it sees where they WERE)
 *   aimError  the half-width, in degrees, of its aim error at rest (it grows with the target's speed)
 *   decision  how many ticks pass between re-deciding what to do (Intent and the plan)
 *   mistake   the chance, at each decision, of briefly keeping the old plan
 * See docs/arena/AI-TUNING.md for all fields, units, ranges and observable effects.
 *
 * Intentionally MUTABLE live-tuning data (like config/params): `AI_TIERS` is read every tick by the brains, so a
 * slider or the console (`ai tier`) retunes a running bot. `AI_TIER_RANGES` bounds what a tuner may write.
 * The numbers are starting points (AI-FIGHTERS.md 2); the measured quality is in docs/arena/AI-FIGHTERS.md 9.
 */

export type AiLevel = 1 | 2 | 3 | 4 | 5;

export const AI_LEVELS: readonly AiLevel[] = [1, 2, 3, 4, 5];
export const AI_DIFFICULTIES = { easy: 1, normal: 3, hard: 4, expert: 5 } as const;
export function difficultyLevel(value: string): AiLevel | null {
  if (Object.hasOwn(AI_DIFFICULTIES, value)) return AI_DIFFICULTIES[value as keyof typeof AI_DIFFICULTIES];
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n as AiLevel : null;
}

export interface AiTier {
  /** Ticks the bot's view of its foes lags the world. */
  reaction: number;
  /** Degrees of aim error at rest. */
  aimError: number;
  /** Ticks between decisions. */
  decision: number;
  /** 0..1 chance per decision of a lapse. */
  mistake: number;
  reactionVariance: number;
  awareness: number;
  prediction: number;
  spacingError: number;
  /** 0..1 strength of match-local learning from confirmed attacks, missed moves and successful approaches. */
  adaptation: number;
  decisionNoise: number;
  overcommit: number;
}

export type AiTierKey = keyof AiTier;

export const AI_TIER_KEYS: readonly AiTierKey[] = ['reaction', 'aimError', 'decision', 'mistake', 'reactionVariance', 'awareness', 'prediction', 'spacingError', 'adaptation', 'decisionNoise', 'overcommit'];

/** The shipped numbers (frozen: `resetAiTiers` restores them). */
export const AI_TIER_DEFAULTS: Readonly<Record<AiLevel, Readonly<AiTier>>> = Object.freeze({
  1: Object.freeze({ reaction: 22, aimError: 16, decision: 20, mistake: 0.12, reactionVariance: 4, awareness: 340, prediction: 0.35, spacingError: 12, adaptation: 0.2, decisionNoise: 0.08, overcommit: 0.3 }),
  2: Object.freeze({ reaction: 18, aimError: 9, decision: 14, mistake: 0.07, reactionVariance: 3, awareness: 380, prediction: 0.5, spacingError: 8, adaptation: 0.35, decisionNoise: 0.06, overcommit: 0.22 }),
  3: Object.freeze({ reaction: 14, aimError: 5, decision: 10, mistake: 0.04, reactionVariance: 3, awareness: 440, prediction: 0.7, spacingError: 5, adaptation: 0.5, decisionNoise: 0.04, overcommit: 0.15 }),
  4: Object.freeze({ reaction: 10, aimError: 3, decision: 8, mistake: 0.02, reactionVariance: 2, awareness: 520, prediction: 0.85, spacingError: 3, adaptation: 0.7, decisionNoise: 0.025, overcommit: 0.1 }),
  5: Object.freeze({ reaction: 7, aimError: 1.5, decision: 6, mistake: 0.01, reactionVariance: 1, awareness: 640, prediction: 0.95, spacingError: 1, adaptation: 0.85, decisionNoise: 0.015, overcommit: 0.05 }),
});

/** The live table. Mutable on purpose. */
export const AI_TIERS: Record<AiLevel, AiTier> = {
  1: { ...AI_TIER_DEFAULTS[1] },
  2: { ...AI_TIER_DEFAULTS[2] },
  3: { ...AI_TIER_DEFAULTS[3] },
  4: { ...AI_TIER_DEFAULTS[4] },
  5: { ...AI_TIER_DEFAULTS[5] },
};

export interface AiRange {
  min: number;
  max: number;
  step: number;
}

export const AI_TIER_RANGES: Readonly<Record<AiTierKey, AiRange>> = Object.freeze({
  reaction: { min: 1, max: 60, step: 1 },
  aimError: { min: 0, max: 45, step: 0.5 },
  decision: { min: 2, max: 60, step: 1 },
  mistake: { min: 0, max: 0.5, step: 0.01 },
  reactionVariance: { min: 0, max: 10, step: 1 },
  awareness: { min: 240, max: 800, step: 10 },
  prediction: { min: 0, max: 1, step: 0.05 },
  spacingError: { min: 0, max: 24, step: 1 },
  adaptation: { min: 0, max: 1, step: 0.05 },
  decisionNoise: { min: 0, max: 0.1, step: 0.005 },
  overcommit: { min: 0, max: 0.5, step: 0.05 },
});

/** Round and clamp any number to a level 1..5 (the console and the panel pass whatever they were given). */
export function clampAiLevel(level: number): AiLevel {
  const n = Number.isFinite(level) ? Math.round(level) : 3;
  return Math.min(5, Math.max(1, n)) as AiLevel;
}

export function aiTier(level: number): AiTier {
  return AI_TIERS[clampAiLevel(level)];
}

/** Write one live number, clamped to its range (and stepped). Returns what was applied. */
export function setAiTierValue(level: number, key: AiTierKey, value: number): number {
  const range = AI_TIER_RANGES[key];
  const clamped = Math.min(range.max, Math.max(range.min, Number.isFinite(value) ? value : range.min));
  const applied = Math.round(clamped / range.step) * range.step;
  AI_TIERS[clampAiLevel(level)][key] = Math.min(range.max, Math.max(range.min, Number(applied.toFixed(4))));
  return AI_TIERS[clampAiLevel(level)][key];
}

export function resetAiTiers(): void {
  for (const level of AI_LEVELS) Object.assign(AI_TIERS[level], AI_TIER_DEFAULTS[level]);
}
