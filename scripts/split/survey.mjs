#!/usr/bin/env node
// The split survey (docs/split/SPLIT-PLAN.md): every import in src/, what each module is (ownership.mjs), and the
// two prunings the copy sets up.
//
//   node scripts/split/survey.mjs           summary on stdout, full detail in verify-out/split/survey.json
//   node scripts/split/survey.mjs --cuts    also print every import Descent cuts and every campaign import
//                                           CLASHFORGED's kept code makes
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, survey } from './surveyCore.mjs';

const r = survey();
mkdirSync(join(ROOT, 'verify-out', 'split'), { recursive: true });
writeFileSync(join(ROOT, 'verify-out', 'split', 'survey.json'), JSON.stringify(r, null, 1));

const n = (x) => `${String(x.modules).padStart(4)} modules ${String(x.lines).padStart(7)} lines`;
console.log(`${r.modules} modules`);
for (const [p, v] of Object.entries(r.packages).sort((a, b) => b[1].lines - a[1].lines)) console.log(`  ${p.padEnd(12)} ${n(v)}`);

const d = r.descent;
console.log('\nDESCENT deletes the arena');
console.log(`  arena code          ${n(d.deletes)}`);
console.log(`  imports to cut      ${d.cuts} from ${d.cutFiles.length} files ${JSON.stringify(d.cutsByOwner)}`);
console.log(`  ctx arena calls     ${d.seam.refs} in ${d.seam.files} files (top: ${d.seam.byModule.slice(0, 4).map((s) => `${s.module} ${s.refs}`).join(', ')})`);

const c = r.clashforged;
console.log('\nCLASHFORGED deletes the campaign');
console.log(`  campaign code       ${n(c.campaign)}`);
console.log(`  deleted at once     ${n(c.deletesAtOnce)}`);
console.log(`  kept until trimmed  ${n(c.keptUntilTrimmed)}  (still imported by the arena, the engine or the Builder)`);
console.log(`    without Builder   ${n(c.keptUntilTrimmedWithoutBuilder)}`);
console.log(`  campaign imports    ${c.cuts} ${JSON.stringify(c.cutsByOwner)}`);

console.log(`\ntests: ${JSON.stringify(r.tests)}; scripts: ${JSON.stringify(r.scripts)}`);
if (process.argv.includes('--cuts')) {
  console.log('\n-- Descent cuts');
  for (const x of d.cutList) console.log(`  ${x.kind.padEnd(4)} ${x.from} -> ${x.to}`);
  console.log('\n-- CLASHFORGED campaign imports');
  for (const x of c.cutList) console.log(`  ${x.kind.padEnd(4)} ${x.from} -> ${x.to}`);
}
console.log('\ndetail: verify-out/split/survey.json');
