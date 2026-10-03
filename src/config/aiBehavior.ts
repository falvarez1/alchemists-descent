/** Shared combat mechanics tuning for Arena and Duel. Ticks are fixed 60 Hz; distances are cells.
 * Live edits affect existing brains. Skill/reaction/error remain independent in aiTiers.ts.
 */
export const AI_BEHAVIOR_DEFAULTS = Object.freeze({
  aggression: 1,
  caution: 0.8,
  finishHealth: 0.3,
  retreatHealth: 0.3,
  manaReserve: 0.12,
  manaResume: 0.45,
  strafeDistance: 18,
  strafeTicks: 42,
  dodgeLookahead: 18,
  dodgeCooldown: 44,
  dodgeHold: 9,
  dodgeLevitReserve: 16,
  aimLead: 0.9,
  maxLeadTicks: 26,
  targetStickiness: 0.2,
  pressureRange: 30,
  blockedTicks: 24,
  hazardLookahead: 18,
  cornerEscapeCooldown: 180,
  weaponSwapTicks: 60,
});

export type AiBehaviorKey = keyof typeof AI_BEHAVIOR_DEFAULTS;
export type AiBehavior = Record<AiBehaviorKey, number>;
export const AI_BEHAVIOR: AiBehavior = { ...AI_BEHAVIOR_DEFAULTS };
export const AI_BEHAVIOR_KEYS = Object.keys(AI_BEHAVIOR_DEFAULTS) as AiBehaviorKey[];

export const AI_BEHAVIOR_RANGES: Record<AiBehaviorKey, { min: number; max: number; step: number; description: string }> = {
  aggression: { min: 0, max: 2, step: 0.05, description: 'Scales each fighter\'s willingness to close distance.' },
  caution: { min: 0, max: 2, step: 0.05, description: 'Weight of nearby enemies and low health when backing away.' },
  finishHealth: { min: 0, max: 0.8, step: 0.05, description: 'Wounded-target threshold for pressure; does not estimate knockout damage or force heavy attacks.' },
  retreatHealth: { min: 0, max: 0.8, step: 0.05, description: 'Own health fraction below which to favour safer spacing.' },
  manaReserve: { min: 0, max: 0.4, step: 0.02, description: 'Start saving mana below this fraction.' },
  manaResume: { min: 0.45, max: 1, step: 0.05, description: 'Resume sustained fire above this mana fraction.' },
  strafeDistance: { min: 0, max: 48, step: 1, description: 'Footwork distance within the preferred firing band, in cells.' },
  strafeTicks: { min: 15, max: 180, step: 1, description: 'Average ticks before changing footwork direction.' },
  dodgeLookahead: { min: 0, max: 36, step: 1, description: 'Look this many ticks ahead for an incoming hit; zero disables dodging.' },
  dodgeCooldown: { min: 20, max: 180, step: 1, description: 'Minimum ticks between defensive jumps.' },
  dodgeHold: { min: 1, max: 16, step: 1, description: 'Ticks to hold a defensive jump before releasing.' },
  dodgeLevitReserve: { min: 6, max: 60, step: 1, description: 'Levitation kept in reserve when evading an observed shot in midair.' },
  aimLead: { min: 0, max: 1.2, step: 0.05, description: 'How much observed velocity contributes to projectile lead.' },
  maxLeadTicks: { min: 0, max: 50, step: 1, description: 'Limit on extrapolating a target\'s old motion.' },
  targetStickiness: { min: 0, max: 0.6, step: 0.05, description: 'Preference for continuing to fight the same opponent.' },
  pressureRange: { min: 20, max: 80, step: 1, description: 'Closest desired range while pursuing a wounded opponent.' },
  blockedTicks: { min: 6, max: 120, step: 1, description: 'Ticks without a clear shot before changing position.' },
  hazardLookahead: { min: 6, max: 40, step: 1, description: 'Cells of movement checked for dangerous terrain.' },
  cornerEscapeCooldown: { min: 60, max: 600, step: 1, description: 'Minimum ticks between attempts to jump out of a corner.' },
  weaponSwapTicks: { min: 15, max: 180, step: 1, description: 'Minimum ticks between range-based weapon changes.' },
};

export function setAiBehaviorValue(key: AiBehaviorKey, value: number): number {
  const r = AI_BEHAVIOR_RANGES[key];
  const n = Number.isFinite(value) ? value : AI_BEHAVIOR_DEFAULTS[key];
  AI_BEHAVIOR[key] = Number(Math.max(r.min, Math.min(r.max, Math.round(n / r.step) * r.step)).toFixed(4));
  return AI_BEHAVIOR[key];
}

export function resetAiBehavior(): void {
  Object.assign(AI_BEHAVIOR, AI_BEHAVIOR_DEFAULTS);
}
