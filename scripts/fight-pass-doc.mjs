// A BALANCE PASS, WRITTEN DOWN (docs/arena/TELEMETRY-AND-BALANCE.md 3.6): turn a tuner's balance-patch.json (and, optionally, a validation
// run of the tuned numbers) into docs/fighters/balance/pass-NN.md: what moved, why, and what the win rates were before and after.
//
//   node scripts/fight-pass-doc.mjs <tune-dir> [--validate <fight-dir>] [--n 1]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const dir = process.argv[2];
if (!dir || !existsSync(`${dir}/balance-patch.json`)) { console.error('usage: node scripts/fight-pass-doc.mjs <tune-dir> [--validate <fight-dir>] [--n 1]'); process.exit(2); }
const arg = (n, f) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f; };
const n = String(arg('n', '1')).padStart(2, '0');
const patch = JSON.parse(readFileSync(`${dir}/balance-patch.json`, 'utf8'));
const validate = arg('validate', '') && existsSync(`${arg('validate', '')}/report.json`) ? JSON.parse(readFileSync(`${arg('validate', '')}/report.json`, 'utf8')) : null;
const first = patch.history[0];
const IDS = Object.keys(patch.result);
const pct = (x) => `${Math.round(x * 100)}%`;
const vrate = (id) => validate?.fighters.find((f) => f.id === id);

const L = [];
L.push(`# Balance pass ${n}`, '');
L.push(`Generated ${patch.generated} by \`scripts/fight-tune.mjs\`. Basis: ${patch.basis}. Level-3 \`basic\` bots, every ordered pair, both sides.`, '');
const KNOBS = [...new Set(Object.keys(patch.shipped).map((k) => k.split('.').pop()))];
L.push('## What moved', '', `| fighter | start | tuned | change (${KNOBS.join(', ')}) |`, '|---|---|---|---|');
for (const id of IDS) {
  const s = KNOBS.map((k) => patch.shipped[`body.${id}.${k}`]);
  const t = KNOBS.map((k, i) => patch.overrides[`body.${id}.${k}`] ?? s[i]);
  L.push(`| ${id} | ${KNOBS.map((k, i) => `${k} ${s[i]}`).join(', ')} | ${KNOBS.map((k, i) => `${k} ${t[i]}`).join(', ')} | ${t.every((v, i) => v === s[i]) ? 'none' : KNOBS.map((k, i) => `${k} ${(t[i] / s[i] * 100 - 100).toFixed(0)}%`).join(', ')} |`);
}
L.push('', '## Win rates', '', `| fighter | before | after (last round)${validate ? ' | validated (' + validate.fights + ' fights)' : ''} |`, `|---|---|---|${validate ? '---|' : ''}`);
for (const id of IDS) {
  const v = vrate(id);
  L.push(`| ${id} | ${pct(first.rates[id])} | ${pct(patch.result[id])} |${validate ? ` ${v ? `${pct(v.winRate)} (${pct(v.lo)}-${pct(v.hi)})` : '-'} |` : ''}`);
}
L.push('', '## Round by round (worst fighter, points from 50%)', '', '| round | worst | ' + IDS.map((i) => i.split('-')[0]).join(' | ') + ' |', '|---|---|' + IDS.map(() => '---').join('|') + '|');
for (const h of patch.history) L.push(`| ${h.round} | ${(h.worst * 100).toFixed(0)} | ${IDS.map((i) => Math.round(h.rates[i] * 100)).join(' | ')} |`);
const pinned = Object.entries(patch.pinnedAtALimit ?? {});
L.push('', '## Pinned at a limit', '', pinned.length ? pinned.map(([k, v]) => `- \`${k}\` = ${v.value}: wants ${v.wants} (win rate ${pct(v.winRate)}): a stat cannot fix this, change a loadout or a kit number.`).join('\n') : 'None: every knob the tuner turned had room.');
L.push('', '## To apply', '', 'Read the table, then write the tuned numbers into `src/content/fighterBodies.ts` (the tuner never edits the source) and commit them with this file as the evidence:', '', '```json', JSON.stringify(patch.overrides, null, 2), '```', '');
mkdirSync('docs/fighters/balance', { recursive: true });
writeFileSync(`docs/fighters/balance/pass-${n}.md`, L.join('\n'));
console.log(`docs/fighters/balance/pass-${n}.md written (${IDS.length} fighters, ${patch.history.length} rounds${validate ? ', validated' : ''}).`);
