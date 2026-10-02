// THE DPS RIG (docs/arena/MOVESETS-V2.md 6a): how fast does each fighter's PRIMARY kill a target that does not move or fight back?
// Each of the ten (a level-5 brain) against a standing Nox Calder (a dummy: it presses Z/T but never shoots), several seeds each.
// The target time is the budget the signature loadouts are tuned to: they should sit in one band, with different SHAPES (burst, stream,
// homing, pierce), not different power.
//   node scripts/fight-dps.mjs [url] [--seeds 5] [--target nox-calder] [--out verify-out/fights/dps]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const seeds = opt('seeds', '5');
const target = opt('target', 'nox-calder');
const out = opt('out', 'verify-out/fights/dps');
const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
const pairs = IDS.filter((i) => i !== target).map((i) => `${i},${target}`).join(';');
execFileSync('node', ['scripts/fight-batch.mjs', url, '--pairs', pairs, '--one-way', '--seeds', seeds, '--a-level', '5', '--b-brain', 'dummy', '--max-ticks', '3600', '--out', out], { stdio: 'inherit' });
const rows = readFileSync(`${out}/index.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error);
const by = {};
for (const r of rows) (by[r.a] ??= []).push(r);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
console.log(`\nTime to kill a standing ${target} (median of ${seeds}; a fight that reaches 60 s is a timeout)\n`);
let line = '';
for (const id of IDS.filter((i) => i !== target)) {
  const rs = by[id] ?? [];
  const wins = rs.filter((r) => r.winner === 0);
  const ttk = med(wins.map((r) => r.ticks / 60));
  const dealt = rs.map((r) => Object.values(r.totals.taken).reduce((s, v) => s + v, 0));
  line += `${id.padEnd(14)} ${wins.length}/${rs.length} killed  ttk ${ttk.toFixed(1).padStart(5)} s  damage taken by the target ${med(dealt).toFixed(0)}\n`;
}
console.log(line);
