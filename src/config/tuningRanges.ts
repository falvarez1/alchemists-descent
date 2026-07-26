import { paramSliderSpec } from '@/ui/Inspector';
import { WORLDGEN_LOOK_FIELDS } from '@/config/gen';
import { readTuningDefault } from '@/net/tuningPatch';

/**
 * Declared bounds for tuning paths, for rooms that cannot trust their peers.
 *
 * A LOCAL link is two windows the same person owns, so Phase 1 deliberately
 * skipped range metadata and derived the allowlist from the shipped defaults
 * (see the spec's "the tuning allowlist is derived, not authored"). A HOSTED
 * room is reachable by anyone with the URL, and `ambient = 1e9` or
 * `simSpeed = -40` is a denial of service dressed as a slider drag. So a
 * strict room accepts only paths it can bound.
 *
 * These bounds are still DERIVED, not hand-maintained, everywhere a source
 * already exists:
 *
 *   materials.* / spells.* / player.*   `paramSliderSpec` — the same specs the
 *                                        Sandbox inspector and the Builder's
 *                                        material window already render from
 *   gen.*                                `WORLDGEN_LOOK_FIELDS`
 *   global.*                             GLOBAL_SLIDER_RANGES below
 *
 * `global.*` is the one hand-written table, because those four sliders live as
 * `min`/`max` attributes in `index.html` and nowhere else. That duplication is
 * real; `tests/tuning-ranges.test.ts` asserts the two agree so they cannot
 * drift silently, and moving the markup to render from here is the proper fix.
 *
 * A path with no declared range is not "unbounded" — it is refused by a strict
 * room. Silently clamping would be worse: the sender would believe it applied.
 */

export interface TuningRange {
  min: number;
  max: number;
  step?: number;
}

/** Mirrors the range attributes on the Sandbox Global Controls sliders. */
export const GLOBAL_SLIDER_RANGES: Readonly<Record<string, TuningRange>> = {
  simSpeed: { min: 0, max: 2, step: 0.1 },
  maxBrightness: { min: 1, max: 10, step: 0.5 },
  ambient: { min: 0.02, max: 0.5, step: 0.02 },
};

const GEN_RANGES: Readonly<Record<string, TuningRange>> = Object.fromEntries(
  WORLDGEN_LOOK_FIELDS.map((f) => [f.key, { min: f.min, max: f.max, step: f.step }]),
);

/**
 * Bounds for a dotted tuning path, or null when this build cannot bound it.
 *
 * Booleans have no range; they are reported as `{min:0,max:1}` so a strict
 * room can accept them without a special case.
 */
export function tuningRangeFor(path: string): TuningRange | null {
  const declared = declaredRangeFor(path);
  if (!declared) return null;
  // A declared bound must admit the value the game ships with. Nine inspector
  // sliders currently do not (see KNOWN_SLIDER_CLAMPS) — a real UI defect, but
  // one a security bound must not inherit: a strict room would reject the
  // default value the client boots with. Widening is always safe; it can only
  // ever admit a value the game itself considers normal.
  const shipped = readTuningDefault(path);
  if (typeof shipped !== 'number') return declared;
  if (shipped >= declared.min && shipped <= declared.max) return declared;
  return { min: Math.min(declared.min, shipped), max: Math.max(declared.max, shipped), step: declared.step };
}

/**
 * Sliders whose range excludes their own shipped default.
 *
 * These are pre-existing UI bugs, not schema bugs: dragging one of these in
 * the Sandbox snaps the live value to the slider's end and there is no way to
 * drag back to the default. `paramSliderSpec` has been patched for this class
 * of mistake before (see its `burnDuration`/`particleLife` comment). Listed
 * here so the count cannot grow silently while the range schema quietly
 * absorbs each new one.
 */
export const KNOWN_SLIDER_CLAMPS: readonly string[] = [
  'player.kickSelfRecoil',
  'player.levitRampFrames',
  'player.recoilMaxImpulse',
  'player.vyCapUp',
  'spells.blackhole.collapseLimit',
  'spells.bomb.explosionRadius',
  'spells.bomb.fuseTicks',
  'spells.lightning.range',
  'spells.meteor.explosionRadius',
];

function declaredRangeFor(path: string): TuningRange | null {
  const parts = path.split('.');
  if (parts.length === 2) {
    const [family, key] = parts;
    if (family === 'global') return GLOBAL_SLIDER_RANGES[key] ?? null;
    if (family === 'gen') return GEN_RANGES[key] ?? null;
    if (family === 'player') return specRange(key);
    // `pacing.*` has no authored UI and therefore no bounds this build can
    // vouch for. Local rooms still tune it; hosted rooms refuse it.
    return null;
  }
  if (parts.length === 3) {
    const [family, , key] = parts;
    if (family === 'materials' || family === 'spells') return specRange(key);
    return null;
  }
  return null;
}

/**
 * `paramSliderSpec` is the declared range even when it falls through to its
 * 0..1 default: the Sandbox inspector and the Builder's material window render
 * every material/spell/player dial from it, so a human cannot set a value
 * outside it through the UI either. Treating the fallback as "unknown" would
 * refuse a long tail of perfectly ordinary dials in hosted rooms.
 *
 * `tests/tuning-ranges.test.ts` asserts the shipped default of every bounded
 * path lies inside its range — the check that catches a bound this is wrong
 * about, rather than discovering it when a hosted room rejects a default.
 */
function specRange(key: string): TuningRange | null {
  const spec = paramSliderSpec(key);
  return { min: spec.min, max: spec.max, step: spec.step };
}
