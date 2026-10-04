import { describe, expect, it } from 'vitest';
import { OVERRIDES, RULES } from '../scripts/split/ownership.mjs';
import { compareToBaseline, ratchetNumbers, readBaseline, survey } from '../scripts/split/surveyCore.mjs';

/**
 * The split ratchet (docs/split/SPLIT-PLAN.md, Phase 0). The repo is becoming two games on one engine, and until
 * the files move, nothing but this test stops new code from crossing a boundary the target layout forbids (engine
 * code naming the campaign or the arena, the Builder naming campaign content, the campaign naming fighters).
 *
 * The forbidden-edge count per package pair, and the shared code's ctx.arena / ctx.fighters / ctx.versus /
 * ctx.duel calls, may only go DOWN, and a drop must be banked (`node scripts/split/survey.mjs --write-baseline`)
 * in the commit that made it, or the slack is there for the next crossing to spend.
 */
describe('split boundaries ratchet', () => {
  const report = survey();

  it('adds no import that crosses a forbidden boundary, and banks every one removed', () => {
    const { rises, drops } = compareToBaseline(ratchetNumbers(report), readBaseline());
    const lines = [
      ...rises.map((r) => `ROSE   ${r}`),
      ...drops.map((d) => `FELL   ${d}  (bank it: node scripts/split/survey.mjs --write-baseline)`),
    ];
    if (rises.length) {
      const risen = new Set(rises.map((r) => r.split(':')[0]));
      for (const f of report.forbidden) if (risen.has(f.pair)) lines.push(`         ${f.pair}  ${f.from} -> ${f.to}`);
    }
    expect(lines, `split boundaries moved from scripts/split/baseline.json:\n${lines.join('\n')}`).toEqual([]);
  });

  it('every override names a module that exists, and changes what the rules say', () => {
    for (const [m, pkg] of Object.entries(OVERRIDES)) {
      expect(report.ownership[m], `override for a missing module ${m}`).toBe(pkg);
      const byRule = RULES.find(([, r]) => (typeof r === 'function' ? r(m) : r.test(m)))?.[0];
      expect(byRule, `override for ${m} repeats its rule; delete it`).not.toBe(pkg);
    }
  });
});
