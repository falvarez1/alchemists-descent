// THE LOADOUT SWEEP (docs/arena/MOVESETS-V2.md 6a): how does ONE fighter fare against the whole roster with each of several candidate loadouts?
// For each candidate: that fighter against each of the nine others, both sides, S seeds, level-3 bots; the result is its win rate (95%).
// The tuner can only turn stats; a fighter pinned at a limit needs a different weapon, and this is how one is chosen against evidence.
//
//   node scripts/loadout-sweep.mjs [url] --candidates file.json [--seeds 6] [--out verify-out/fights/sweep]
//
// file.json: [ { "id": "brann-rook", "name": "plain spark", "wands": [ {"frameId":"mortar","cards":["spark",null,null,null,null,null]}, {"frameId":"bone","cards":[null,null,null,null]} ] }, ... ]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const candidates = JSON.parse(readFileSync(opt('candidates', 'candidates.json'), 'utf8'));
const seeds = opt('seeds', '6');
const out = opt('out', 'verify-out/fights/sweep');
mkdirSync(out, { recursive: true });
const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];

const z = 1.96;
const wilson = (w, n) => { if (!n) return [0, 0, 1]; const p = w / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return [p, Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; };

for (const [k, c] of candidates.entries()) {
  const dir = `${out}/${String(k).padStart(2, '0')}-${c.id}-${(c.name ?? 'x').replace(/[^a-z0-9]+/gi, '-')}`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/loadouts.json`;
  writeFileSync(file, JSON.stringify({ [c.id]: { wands: c.wands, ...(c.flasks ? { flasks: c.flasks } : {}) } }));
  const pairs = IDS.filter((i) => i !== c.id).map((o) => `${c.id},${o}`).join(';');
  execFileSync('node', ['scripts/fight-batch.mjs', url, '--pairs', pairs, '--seeds', seeds, '--loadouts', file, '--out', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  const rows = readFileSync(`${dir}/index.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error);
  let w = 0;
  for (const r of rows) { const slot = r.a === c.id ? 0 : 1; if (r.winner === slot) w++; else if (r.winner === null) w += 0.5; }
  const [p, lo, hi] = wilson(w, rows.length);
  const secs = rows.map((r) => r.ticks / 60).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0;
  console.log(`${c.id.padEnd(14)} ${String(c.name ?? '').padEnd(24)} ${String(Math.round(p * 100)).padStart(3)}%  (${Math.round(lo * 100)}-${Math.round(hi * 100)})  ${rows.length} fights, median ${secs.toFixed(1)} s   ${JSON.stringify(c.wands[0].cards.filter(Boolean))} @${c.wands[0].frameId}`);
}
