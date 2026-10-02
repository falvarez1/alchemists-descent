// ONE FIGHTER, SEVERAL SETTINGS (docs/arena/TELEMETRY-AND-BALANCE.md 3.6): how does a fighter fare against the whole roster (both sides) under
// each of several sets of parameter overrides? The knob-turning cousin of loadout-sweep: use it on a fighter the tuner could not move with a stat.
//   node scripts/fighter-sweep.mjs [url] --id brann-rook --variants file.json [--seeds 6] [--out verify-out/fights/fsweep]
// file.json: [ { "name": "calmer ult", "set": { "kit.brann-rook.redline.damageTaken": 0.7 } }, ... ]   (the first variant is usually {} : the baseline)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const id = opt('id', 'brann-rook');
const variants = JSON.parse(readFileSync(opt('variants', 'variants.json'), 'utf8'));
const seeds = opt('seeds', '6');
const out = opt('out', 'verify-out/fights/fsweep');
mkdirSync(out, { recursive: true });
const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
const z = 1.96;
const wilson = (w, n) => { if (!n) return [0, 0, 1]; const p = w / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return [p, Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; };
for (const [k, v] of variants.entries()) {
  const dir = `${out}/${String(k).padStart(2, '0')}-${id}-${(v.name ?? 'x').replace(/[^a-z0-9]+/gi, '-')}`;
  mkdirSync(dir, { recursive: true });
  const pairs = IDS.filter((i) => i !== id).map((o) => `${id},${o}`).join(';');
  const sets = Object.entries(v.set ?? {}).flatMap(([p, val]) => ['--set', `${p}=${val}`]);
  execFileSync('node', ['scripts/fight-batch.mjs', url, '--pairs', pairs, '--seeds', seeds, '--out', dir, ...sets], { stdio: ['ignore', 'ignore', 'inherit'] });
  const rows = readFileSync(`${dir}/index.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error);
  let w = 0;
  for (const r of rows) { const slot = r.a === id ? 0 : 1; if (r.winner === slot) w++; else if (r.winner === null) w += 0.5; }
  const [p, lo, hi] = wilson(w, rows.length);
  const secs = rows.map((r) => r.ticks / 60).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0;
  console.log(`${id.padEnd(14)} ${String(v.name ?? '').padEnd(30)} ${String(Math.round(p * 100)).padStart(3)}%  (${Math.round(lo * 100)}-${Math.round(hi * 100)})  ${rows.length} fights, median ${secs.toFixed(1)} s   ${JSON.stringify(v.set ?? {})}`);
}
