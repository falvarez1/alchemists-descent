// Re-classify and summarize the saved output of scripts/audit-world-sanity.mjs:
// counts per class / category / floor / severity, the arrival-vs-settled split
// (a placement bug vs a settling bug), and every flag with its crop/shot.
// Usage: node scripts/audit-world-sanity-report.mjs [--out=DIR]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, scanFlags } from './audit-world-sanity-rules.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2]] : [a, '']; }));
const OUT = args.out ?? 'verify-out/world-sanity';
const files = readdirSync(OUT).filter((f) => /^d\d+b?-s\d+\.json$/.test(f)).sort();
const rows = [];
const levels = [];
for (const f of files) {
  const r = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
  const level = r.meta.level, seed = f.match(/-s(\d+)\.json$/)[1];
  const arrivalById = new Map(r.arrival.map((it) => [it.id, it]));
  const settled = r.settled.filter((it) => it.cat !== 'flora');
  for (const it of settled) it.flags = classify(it, arrivalById.get(it.id), level);
  for (const it of r.arrival) it.flags = classify(it, null, level);
  const scans = scanFlags(r.settledScan);
  // Keep the crop/shot file names the run attached to scan items.
  const prevScan = new Map(r.settled.filter((it) => it.cat === 'flora').map((it) => [it.id, it]));
  for (const s of scans) { const p = prevScan.get(s.id); if (p) { s.crop = p.crop; s.shot = p.shot; } }
  const all = [...settled, ...scans];
  levels.push({ level, seed, items: all.length, wallMs: r.wallMs, pauses: r.log.filter((l) => l.pausedBy).length, errors: r.errors?.length ?? 0,
    fireInWater: r.settledScan.fireInWater, growthUnderLiquid: r.settledScan.grassUnderLiquid });
  for (const it of all) {
    const arr = arrivalById.get(it.id);
    for (const fl of it.flags ?? []) {
      const atArrival = arr ? (arr.flags ?? []).some((a) => a.cls === fl.cls) : null;
      rows.push({ level, seed, cat: it.cat, kind: it.kind, id: it.id, x: it.x, y: it.y, cls: fl.cls, sev: fl.sev, why: fl.why, atArrival, crop: it.crop ?? null, shot: it.shot ?? null });
    }
  }
}

const count = (keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const sevOrder = { P1: 0, P2: 1, P3: 2 };
rows.sort((a, b) => sevOrder[a.sev] - sevOrder[b.sev] || a.cls.localeCompare(b.cls) || a.cat.localeCompare(b.cat) || a.level.localeCompare(b.level));

let md = `# World sanity audit (raw)\n\n${files.length} level runs: ${[...new Set(levels.map((l) => l.level))].join(', ')} x seeds ${[...new Set(levels.map((l) => l.seed))].join(', ')}\n\n`;
md += '## Counts by class and severity\n\n| class | P1 | P2 | P3 | total |\n|---|---|---|---|---|\n';
for (const cls of ['SUBMERGED', 'FLOATING', 'BURIED', 'BLOCKED', 'ABSURD']) {
  const r = rows.filter((x) => x.cls === cls);
  md += `| ${cls} | ${r.filter((x) => x.sev === 'P1').length} | ${r.filter((x) => x.sev === 'P2').length} | ${r.filter((x) => x.sev === 'P3').length} | ${r.length} |\n`;
}
md += '\n## Counts by category x class (all severities)\n\n| category/class | count | P1+P2 | floors | at arrival |\n|---|---|---|---|---|\n';
for (const [k, n] of count((r) => `${r.cat} ${r.cls}`)) {
  const r = rows.filter((x) => `${x.cat} ${x.cls}` === k);
  md += `| ${k} | ${n} | ${r.filter((x) => x.sev !== 'P3').length} | ${[...new Set(r.map((x) => x.level))].join(' ')} | ${r.filter((x) => x.atArrival).length} |\n`;
}
md += '\n## Per level run\n\n| level | seed | items | flags | P1 | P2 | fire-in-water cells | growth under liquid | wall s | pauses | page errors |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const l of levels) {
  const r = rows.filter((x) => x.level === l.level && x.seed === l.seed);
  md += `| ${l.level} | ${l.seed} | ${l.items} | ${r.length} | ${r.filter((x) => x.sev === 'P1').length} | ${r.filter((x) => x.sev === 'P2').length} | ${l.fireInWater} | ${l.growthUnderLiquid} | ${Math.round(l.wallMs / 1000)} | ${l.pauses} | ${l.errors} |\n`;
}
md += '\n## Every P1/P2 flag\n\n| sev | class | floor | seed | what | at | measured | arrival? | crop | shot |\n|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of rows.filter((x) => x.sev !== 'P3')) {
  md += `| ${r.sev} | ${r.cls} | ${r.level} | ${r.seed} | ${r.cat}:${r.kind} | ${r.x},${r.y} | ${r.why.replace(/\|/g, '/')} | ${r.atArrival === null ? '-' : r.atArrival ? 'yes' : 'no'} | ${r.crop ?? ''} | ${r.shot ?? ''} |\n`;
}
md += '\n## P3 flags (grouped)\n\n| category/class | count | examples |\n|---|---|---|\n';
for (const [k] of count((r) => r.sev === 'P3' ? `${r.cat} ${r.cls}` : '')) {
  if (!k) continue;
  const r = rows.filter((x) => x.sev === 'P3' && `${x.cat} ${x.cls}` === k);
  md += `| ${k} | ${r.length} | ${r.slice(0, 4).map((x) => `${x.level}/s${x.seed} ${x.x},${x.y}: ${x.why.replace(/\|/g, '/')}`).join('; ')} |\n`;
}
writeFileSync(join(OUT, 'summary.md'), md);
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ levels, rows }, null, 1));
console.log(`summary: ${rows.length} flags over ${files.length} runs -> ${join(OUT, 'summary.md')}`);
