// THE DUEL TUNER (docs/arena/STOCK-TELEMETRY.md): measure the whole roster in stock matches, nudge the stock balance lever of
// whoever is out of line, measure again, until every fighter's win rate sits in the band. Every round is a full matrix run by
// scripts/duel-batch.mjs and read by scripts/duel-analyse.mjs. The result is `balance-patch.json` (the overrides, with each
// round's evidence); `--apply` writes the final values into src/config/stockBalance.ts (review the diff before committing).
//
//   node scripts/duel-tune.mjs [url] [--rounds 5] [--seeds 2] [--stage all] [--level 3] [--personality duelist]
//        [--knobs dealt] [--step 0.15] [--gain 0.8] [--tolerance 0.07] [--pages 3] [--start balance-patch.json] [--apply]
//        [--out verify-out/duels/tune-<time>]
//
// The default knob is `stockBalance.<id>.dealt` alone (how hard a fighter's blows land in a stock match): its body is its
// feel and its moveset its identity. `--knobs dealt,launch` also turns how far it flies when hit (KO resistance). A knob moves
// by at most `step` (a fraction) a round, in proportion to how far the win rate is from 50%, and only inside its range. A
// fighter pinned at a range limit while still out of line is reported: it needs a moveset or kit change, not a multiplier.
// The default personality is ONE profile for both sides, so the numbers compare kits, not playstyles.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const rounds = Number(opt('rounds', '5'));
const seeds = opt('seeds', '2');
const stage = opt('stage', 'all');
const level = opt('level', '3');
const personality = opt('personality', 'duelist');
const pages = opt('pages', '3');
const step = Number(opt('step', '0.15'));
const gain = Number(opt('gain', '0.8'));
const tolerance = Number(opt('tolerance', '0.07'));
const knobs = opt('knobs', 'dealt').split(',');
const out = opt('out', `verify-out/duels/tune-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
mkdirSync(out, { recursive: true });

const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
const SOURCE = 'src/config/stockBalance.ts';
// The ranges live in the source (STOCK_BALANCE_RANGES); the shipped values are read from it so a patch is relative to what is committed.
const src = readFileSync(SOURCE, 'utf8');
const ranges = {};
for (const k of knobs) {
  const m = new RegExp(`\\b${k}: \\{ min: ([0-9.]+), max: ([0-9.]+)`).exec(src.slice(src.indexOf('STOCK_BALANCE_RANGES')));
  if (!m) throw new Error(`no range for knob "${k}" in ${SOURCE}`);
  ranges[k] = [Number(m[1]), Number(m[2])];
}
const shipped = {};
for (const id of IDS) {
  const m = new RegExp(`'${id}': \\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`no stock balance entry for ${id}`);
  for (const k of knobs) { const v = new RegExp(`\\b${k}: ([0-9.]+)`).exec(m[1]); shipped[`stockBalance.${id}.${k}`] = v ? Number(v[1]) : 1; }
}
let current = { ...shipped };
if (opt('start', '') && existsSync(opt('start', ''))) current = { ...current, ...JSON.parse(readFileSync(opt('start', ''), 'utf8')).overrides };

const history = [];
let pinned = {};
let last = null;
for (let r = 1; r <= rounds; r++) {
  const dir = `${out}/round-${String(r).padStart(2, '0')}`;
  const sets = Object.entries(current).filter(([k, v]) => v !== shipped[k]).flatMap(([k, v]) => ['--set', `${k}=${v}`]);
  console.log(`\n=== round ${r}/${rounds}: ${sets.length / 2} overrides ===`);
  execFileSync('node', ['scripts/duel-batch.mjs', url, '--pairs', 'all', '--seeds', seeds, '--stage', stage, '--level', level,
    '--personality', personality, '--pages', pages, '--out', dir, ...sets], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('node', ['scripts/duel-analyse.mjs', dir, ...(last ? ['--compare', last] : [])], { stdio: 'ignore' });
  last = dir;
  const report = JSON.parse(readFileSync(`${dir}/report.json`, 'utf8'));
  const rates = Object.fromEntries(IDS.map((id) => [id, report.fighters[id]?.winRate ?? 0.5]));
  const spread = Math.max(...Object.values(rates)) - Math.min(...Object.values(rates));
  console.log(IDS.map((id) => `${id.split('-')[0]} ${(rates[id] * 100).toFixed(0)}%`).join('  '), `| spread ${(spread * 100).toFixed(0)} pts`);
  history.push({ round: r, overrides: { ...current }, rates, spread, flags: report.flags });
  const out_ = IDS.filter((id) => Math.abs(rates[id] - 0.5) > tolerance);
  if (out_.length === 0) { console.log('every fighter is inside the band: done'); break; }
  if (r === rounds) break;
  pinned = {};
  for (const id of out_) {
    const delta = 0.5 - rates[id];
    for (const k of knobs) {
      const key = `stockBalance.${id}.${k}`, [lo, hi] = ranges[k];
      // dealt UP helps a loser; launch DOWN (flies less) helps a loser.
      const sign = k === 'launch' ? -1 : 1;
      const move = Math.max(-step, Math.min(step, delta * gain * 2)) * sign;
      const next = Math.round(Math.max(lo, Math.min(hi, current[key] * (1 + move))) * 1000) / 1000;
      if (next === current[key]) pinned[key] = rates[id];
      current[key] = next;
    }
  }
  if (Object.keys(pinned).length) console.log('pinned at a range limit (needs a moveset or kit change):', Object.keys(pinned).join(', '));
}
const patch = { url, seeds, stage, level, personality, knobs, overrides: Object.fromEntries(Object.entries(current).filter(([k, v]) => v !== shipped[k])), history, pinned };
writeFileSync(`${out}/balance-patch.json`, JSON.stringify(patch, null, 2));
console.log(`\nwrote ${out}/balance-patch.json (${Object.keys(patch.overrides).length} overrides)`);

if (args.includes('--apply')) {
  let text = readFileSync(SOURCE, 'utf8');
  for (const [key, value] of Object.entries(current)) {
    const [, id, k] = key.split('.');
    const re = new RegExp(`('${id}': \\{[^}]*?\\b${k}: )([0-9.]+)`);
    if (!re.test(text)) throw new Error(`cannot find ${key} in ${SOURCE}`);
    text = text.replace(re, `$1${value}`);
  }
  writeFileSync(SOURCE, text);
  console.log(`applied to ${SOURCE}: review the diff, re-run a confirmation batch, then commit with the round evidence`);
}
