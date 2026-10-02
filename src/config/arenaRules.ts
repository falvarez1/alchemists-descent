/**
 * THE ARENA'S RULES AS DATA (docs/arena/ARENA-RULES.md): live-tuning numbers like `config/params`, intentionally mutable. The param
 * registry names them `arena.<key>` (fighters/telemetry/fightHarness), so a balance run turns them like any fighter number.
 */
export const ARENA_RULES = {
  /**
   * What share of a blow's damage reaches the fighter it lands on (a fighter's blows on another, not hazards or the world's own drip).
   * The duel's tempo dial: at 1 a signature primary kills in about 6 s, which leaves no room for a tactical or an ultimate to matter
   * (measured: tactical and ultimate damage were near zero in every fight); at 0.4 a fight is 15-20 s, long enough for two cooldowns.
   */
  blowScale: 0.4,
};

export type ArenaRuleKey = keyof typeof ARENA_RULES;

/** The declared range of each rule: a tuner moves a value only inside it. */
export const ARENA_RULE_RANGES: Readonly<Record<ArenaRuleKey, { min: number; max: number }>> = Object.freeze({
  blowScale: { min: 0.1, max: 2 },
});
