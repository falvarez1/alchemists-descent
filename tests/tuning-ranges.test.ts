import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { GLOBAL_SLIDER_RANGES, KNOWN_SLIDER_CLAMPS, tuningRangeFor } from '@/config/tuningRanges';
import { paramSliderSpec } from '@/ui/Inspector';
import { listTuningPaths, readTuningDefault, readTuningPath } from '@/net/tuningPatch';

/**
 * Bounds only protect a hosted room if they are RIGHT. A range that excludes
 * its own shipped default would make a strict relay reject the value the game
 * boots with — a failure that would only surface on a real hosted room, after
 * a deploy, to whoever happened to nudge that dial.
 */
describe('tuning ranges', () => {
  it('bounds most of the tunable surface', () => {
    const paths = listTuningPaths();
    const bounded = paths.filter((p) => tuningRangeFor(p) !== null);
    expect(paths.length).toBeGreaterThan(150);
    // Not all of it: `pacing.*` and some `gen.*`/`global.*` dials have no
    // authored UI and therefore no range this build can vouch for. A strict
    // room refuses those rather than guessing.
    expect(bounded.length / paths.length).toBeGreaterThan(0.8);
  });

  it('never declares a range that excludes the shipped default', () => {
    const offenders: string[] = [];
    for (const path of listTuningPaths()) {
      const range = tuningRangeFor(path);
      if (!range) continue;
      const value = readTuningPath(path);
      if (typeof value !== 'number') continue;
      if (value < range.min || value > range.max) {
        offenders.push(`${path}=${value} outside [${range.min}, ${range.max}]`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the global table in step with the Sandbox sliders', () => {
    // These three ranges live twice: here, and as min/max attributes in
    // index.html. Until the markup renders from this table, the only thing
    // stopping them drifting is this assertion.
    const html = readFileSync('index.html', 'utf8');
    const sliderIds: Record<string, string> = {
      simSpeed: 'g-speed',
      maxBrightness: 'g-bright',
      ambient: 'g-ambient',
    };
    for (const [key, id] of Object.entries(sliderIds)) {
      const match = new RegExp(`id="${id}"[^>]*`).exec(html);
      expect(match, `no slider #${id} in index.html`).not.toBeNull();
      const tag = match![0];
      const min = Number(/min="([^"]+)"/.exec(tag)?.[1]);
      const max = Number(/max="([^"]+)"/.exec(tag)?.[1]);
      expect({ key, min, max }).toEqual({
        key,
        min: GLOBAL_SLIDER_RANGES[key].min,
        max: GLOBAL_SLIDER_RANGES[key].max,
      });
    }
  });

  it('tracks the sliders whose own range excludes their default', () => {
    // A real UI defect, not a schema one: dragging these in the Sandbox snaps
    // the value to the slider end with no way back to the shipped default.
    // The range schema widens to admit the default so a hosted room does not
    // inherit the bug — this test stops the list growing unnoticed.
    const offenders: string[] = [];
    for (const path of listTuningPaths()) {
      const shipped = readTuningDefault(path);
      if (typeof shipped !== 'number') continue;
      const parts = path.split('.');
      const family = parts[0];
      if (family !== 'player' && family !== 'materials' && family !== 'spells') continue;
      const spec = paramSliderSpec(parts[parts.length - 1]);
      if (shipped < spec.min || shipped > spec.max) offenders.push(path);
    }
    expect(offenders.sort()).toEqual([...KNOWN_SLIDER_CLAMPS].sort());
  });

  it('refuses paths it cannot bound instead of inventing a range', () => {
    expect(tuningRangeFor('pacing.playerStart')).toBeNull();
    expect(tuningRangeFor('nonsense.key')).toBeNull();
    expect(tuningRangeFor('global.definitelyNotADial')).toBeNull();
  });

  it('keeps the generated relay table in step with the schema', () => {
    // The relay hosts run plain JS and cannot import the TS schema, so the
    // table is generated. A stale table means a hosted room silently refuses
    // changes the client considers legal.
    // Normalize line endings first: git checks this out CRLF on Windows and
    // LF on Linux, so a pattern anchored on a bare \n passes in CI and fails
    // on a dev machine — a flake that looks like a real schema mismatch.
    const generated = readFileSync('servers/authorlink/tuningRanges.generated.mjs', 'utf8').replace(/\r\n/g, '\n');
    const match = /export const TUNING_RANGES = ([\s\S]*?);\n/.exec(generated);
    expect(match, 'could not find TUNING_RANGES in the generated table').not.toBeNull();
    const table = JSON.parse(match![1]) as Record<string, { min: number; max: number }>;
    const mismatches: string[] = [];
    for (const path of listTuningPaths()) {
      const range = tuningRangeFor(path);
      const emitted = table[path];
      if (!range && !emitted) continue;
      if (!range || !emitted) {
        mismatches.push(`${path}: ${range ? 'missing from table' : 'stale entry in table'}`);
        continue;
      }
      if (range.min !== emitted.min || range.max !== emitted.max) {
        mismatches.push(`${path}: [${range.min},${range.max}] vs [${emitted.min},${emitted.max}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
