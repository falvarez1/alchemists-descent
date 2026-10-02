/**
 * THE FIGHTER TUNING RANGE TABLE (docs/arena/TELEMETRY-AND-BALANCE.md 3.5). Declared bounds for the numbers a
 * balance tuner may turn: `FIGHTER_TUNING` and every kit's `TUNING`. They are guardrails, not balance targets: a
 * value outside them is a typo, a unit slip or a runaway sweep (a 1e9 cooldown, a negative duration), and
 * `ParamOverrideApi.set` refuses it and changes nothing.
 *
 * This table is SEPARATE from `config/tuningRanges` on purpose. That one is keyed by leaf name through the
 * Sandbox's `paramSliderSpec` (a `cooldown` is capped at 180, which cannot bound a 540-tick kit cooldown) and it
 * feeds the hosted relay's allowlist: fighter paths stay out of `listTuningPaths` / `verify:tuning-ranges`.
 *
 * Resolution order for a path: its exact entry in PATH_RANGES, then its leaf name in LEAF_RANGES, then its leaf's
 * unit class by suffix (`...Ticks` is ticks, `...Radius` / `...Range` / `...Reach` is cells), then a window
 * derived from the shipped default (0 .. 5x, or symmetric when the default is negative). `tests/param-override.test.ts`
 * asserts that every fighter knob resolves, that its shipped default lies inside its range, and that integer
 * knobs ship integer defaults, so a new knob without a sensible range fails a test instead of silently
 * becoming unbounded.
 */

export interface ParamRange {
  min: number;
  max: number;
  step?: number;
  /** Only whole numbers are valid (ticks, counts). */
  integer?: boolean;
}

const TICKS: ParamRange = { min: 0, max: 7200, step: 1, integer: true };
const CELLS: ParamRange = { min: 0, max: 1000, step: 1 };
const FRACTION: ParamRange = { min: 0, max: 1, step: 0.01 };

/** Whole-path entries: the knobs whose meaning differs from their leaf name's usual one. */
export const PATH_RANGES: Readonly<Record<string, ParamRange>> = {
  'fighter.chargeDealt': { min: 0, max: 0.05, step: 0.0001 },
  'fighter.chargeTaken': { min: 0, max: 0.05, step: 0.0001 },
  'fighter.chargeKill': { min: 0, max: 0.5, step: 0.005 },
  'fighter.chargeTrickle': { min: 0, max: 0.005, step: 0.00001 },
  'fighter.chargeWorldShare': { min: 0, max: 2, step: 0.05 },
  'fighter.pressWindow': { min: 1, max: 60, step: 1, integer: true },
};

/** Leaf-name entries: the same word means the same unit in every kit. */
export const LEAF_RANGES: Readonly<Record<string, ParamRange>> = {
  cooldown: { min: 1, max: 3600, step: 1, integer: true },
  tacticalCooldown: { min: 1, max: 3600, step: 1, integer: true },
  duration: { min: 0, max: 3600, step: 1, integer: true },
  every: { min: 1, max: 7200, step: 1, integer: true },
  damage: { min: 0, max: 400, step: 0.5 },
  burstDamage: { min: 0, max: 400, step: 0.5 },
  scaldDamage: { min: 0, max: 100, step: 0.5 },
  armorMax: { min: 0, max: 300, step: 1 },
  damageTaken: { min: 0.05, max: 1.5, step: 0.01 },
  frontalTaken: { min: 0.05, max: 1.5, step: 0.01 },
  moveScale: { min: 0.2, max: 3, step: 0.01 },
  climbScale: { min: 0.2, max: 4, step: 0.01 },
  concealment: { min: 0, max: 0.95, step: 0.01 },
  concealTicks: TICKS,
  slow: { min: 0.05, max: 1, step: 0.01 },
  slowFactor: { min: 0.05, max: 1, step: 0.01 },
  speed: { min: 0, max: 30, step: 0.1 },
  count: { min: 0, max: 64, step: 1, integer: true },
  tries: { min: 1, max: 2000, step: 1, integer: true },
  ticks: TICKS,
  chance: FRACTION,
  mossShare: FRACTION,
  emberShare: FRACTION,
  puffKeep: FRACTION,
  recallKeep: FRACTION,
  fadeFloor: FRACTION,
  leafStack: FRACTION,
  smooth: FRACTION,
  ceilCover: FRACTION,
  floorCover: FRACTION,
  wallCover: FRACTION,
  max: { min: 0, max: 1000, step: 0.1 },
  cap: { min: 0, max: 1000, step: 0.1 },
};

/** The unit class of a leaf by its suffix, or null. */
function classOf(leaf: string): ParamRange | null {
  if (/Ticks$/.test(leaf)) return TICKS;
  if (/(Radius|Range|Reach|reach|radius|range)$/.test(leaf)) return CELLS;
  return null;
}

/** A window around a shipped default, for a knob with no declared range of its own. */
function derivedFrom(dflt: number): ParamRange {
  if (dflt < 0) return { min: dflt * 5, max: -dflt * 5 };
  if (dflt === 0) return { min: 0, max: 10 };
  return { min: 0, max: dflt * 5 };
}

/** The range for `path` (a dotted fighter path whose last segment is the knob) given the knob's shipped default. */
export function fighterParamRange(path: string, dflt: number): ParamRange {
  const exact = PATH_RANGES[path];
  if (exact) return exact;
  const leaf = path.slice(path.lastIndexOf('.') + 1);
  const byLeaf = LEAF_RANGES[leaf] ?? classOf(leaf);
  if (byLeaf) {
    // A declared range must admit the value the game ships with, or the strict set of the default itself fails.
    if (dflt >= byLeaf.min && dflt <= byLeaf.max) return byLeaf;
    return { ...byLeaf, min: Math.min(byLeaf.min, dflt), max: Math.max(byLeaf.max, dflt) };
  }
  return derivedFrom(dflt);
}

/** True when `value` is a finite number inside `range` (and a whole number when the range says so). */
export function inRange(range: ParamRange, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (value < range.min || value > range.max) return false;
  return range.integer !== true || Number.isInteger(value);
}
