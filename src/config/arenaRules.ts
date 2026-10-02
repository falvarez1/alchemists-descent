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
  /**
   * 1: every fighter has the SAME effective health in a duel (a blow is divided by the victim's body health multiplier, so Brann's x1.35
   * is no longer extra hit points); 0: the designed bodies stand (a wall has more health, glass less). The first tuning pass found that
   * health is the strongest lever on who wins and the one that most erases a character (it made Brann frail and Nox a tank); a duel
   * should be won with the weapon, the movement and the kit, so tankiness comes from mass, armor and the plate, not raw hit points.
   */
  healthEquality: 1,
  /**
   * What share of the WORLD's harm (a flame, a current, an acid, a blast it lit: anything not a fighter's own blow) reaches a fighter, on top of
   * the tempo. The measurement: after the opening exchange most duels settled into a slow drip of fire and electricity (20-46 a fight, as much
   * as half of all damage) that the loser simply could not stand out of; a fight should be decided by what the fighters do to each other.
   */
  hazardScale: 0.35,
  /**
   * Ticks a fighter cannot be hurt after a blow (the campaign's is 30: half a second of nothing lands). In a duel that is a thumb on the scale
   * for the big single hit: a pair of sparks, a fan of darts or a chain of lightning lose all but the first hit to the window (measured: the
   * three heavy-hit loadouts took half the damage of the rapid ones and won 74-99%). A short window lets every kind of weapon count.
   */
  invulnTicks: 10,
};

export type ArenaRuleKey = keyof typeof ARENA_RULES;

/** The declared range of each rule: a tuner moves a value only inside it. */
export const ARENA_RULE_RANGES: Readonly<Record<ArenaRuleKey, { min: number; max: number }>> = Object.freeze({
  blowScale: { min: 0.1, max: 2 },
  healthEquality: { min: 0, max: 1 },
  hazardScale: { min: 0, max: 2 },
  invulnTicks: { min: 0, max: 60 },
});
