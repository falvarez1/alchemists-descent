#!/usr/bin/env node
// The split survey (docs/split/SPLIT-PLAN.md): every import in src/, each module's target package (ownership.mjs),
// and every import that crosses a boundary the target layout forbids.
//
//   node scripts/split/survey.mjs                   summary on stdout, full detail in verify-out/split/survey.json
//   node scripts/split/survey.mjs --edges           also print every forbidden edge
//   node scripts/split/survey.mjs --check           compare with scripts/split/baseline.json (exit 1 on any change)
//   node scripts/split/survey.mjs --write-baseline  bank today's numbers as the baseline (only ever after a DROP)
//
// The ratchet (tests/split-boundaries.test.ts) fails when a pair's edge count or the arena seam's ctx refs rise, and
// also when they fall without the baseline being lowered: run --write-baseline in the commit that removed them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_PATH, ROOT, compareToBaseline, ratchetNumbers, readBaseline, survey } from './surveyCore.mjs';

const args = process.argv.slice(2);
const report = survey();
mkdirSync(join(ROOT, 'verify-out', 'split'), { recursive: true });
writeFileSync(join(ROOT, 'verify-out', 'split', 'survey.json'), JSON.stringify(report, null, 1));

console.log(`${report.modules} modules`);
for (const [p, v] of Object.entries(report.packages).sort((a, b) => b[1].lines - a[1].lines)) {
  console.log(`  ${p.padEnd(11)} ${String(v.modules).padStart(4)} modules ${String(v.lines).padStart(7)} lines`);
}
console.log(`forbidden edges: ${report.forbiddenEdges}`);
for (const [k, v] of Object.entries(report.forbiddenByPair)) console.log(`  ${k.padEnd(24)} ${String(v.edges).padStart(4)} edges from ${v.files.length} files`);
const seam = report.arenaSeamInSharedCode;
console.log(`arena seam in shared code: ${seam.refs} ctx refs in ${seam.files} files`);
console.log(`tests: ${JSON.stringify(report.tests)}; scripts: ${JSON.stringify(report.scripts)}`);
if (args.includes('--edges')) for (const f of report.forbidden) console.log(`  ${f.pair}  ${f.kind}  ${f.from} -> ${f.to}`);
console.log('detail: verify-out/split/survey.json');

const now = ratchetNumbers(report);
if (args.includes('--write-baseline')) {
  const prev = (() => { try { return readBaseline(); } catch { return null; } })();
  if (prev) {
    const { rises } = compareToBaseline(now, prev);
    if (rises.length && !args.includes('--allow-rise')) {
      console.error(`\nrefusing to RAISE the baseline:\n  ${rises.join('\n  ')}\n(an ownership-map correction may; pass --allow-rise and say why in the commit)`);
      process.exit(1);
    }
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(now, null, 2)}\n`);
  console.log(`\nbaseline written: ${now.forbiddenEdges} forbidden edges, ${now.arenaSeamRefs} seam refs`);
} else if (args.includes('--check')) {
  const { rises, drops } = compareToBaseline(now, readBaseline());
  if (rises.length) console.error(`\nboundary RISES (a new crossing import):\n  ${rises.join('\n  ')}`);
  if (drops.length) console.error(`\nboundary drops not yet banked (run --write-baseline):\n  ${drops.join('\n  ')}`);
  if (rises.length || drops.length) process.exit(1);
  console.log('\nratchet: at the baseline');
}
