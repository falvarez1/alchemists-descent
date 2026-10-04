// THE DUEL TUNER (docs/arena/STOCK-TELEMETRY.md): measure the whole roster in stock matches, adjust the stock balance levers of
// whoever is out of line, measure again, until every fighter's win rate sits in the band. Every round is a full matrix run by
// scripts/duel-batch.mjs and read by scripts/duel-analyse.mjs. The result is `balance-patch.json` (the best round's overrides,
// with every round's evidence); `--apply` writes them into src/config/stockBalance.ts (review the diff before committing).
//
//   node scripts/duel-tune.mjs [url] [--rounds 5] [--seeds 3] [--stage all] [--level 3] [--personality duelist]
//        [--knobs dealt,launch] [--tolerance 0.1] [--step 0.06] [--big-step 0.2] [--gain 0.4] [--min-slope 2.5] [--pages 3]
//        [--start run.json | balance-patch.json] [--resume <tune dir>[,<tune dir>...]] [--apply] [--out verify-out/duels/tune-<time>]
//
// Each fighter has ONE strength s: `dealt = shipped * s` (how hard its blows land) and, with the `launch` knob, `launch =
// shipped / s` (how far it flies when hit). Win rate is steep and monotone in s, so a fixed step oscillates (a 20% move took
// Mara from 20% to 83%). The tuner therefore remembers each fighter's (s, win rate) points and takes a SECANT step toward 50%
// (staying between two points that straddle it), falling back to a proportional step (`gain`, at most `step`, or `big-step`
// for a fighter more than 20 points out) until it has two points. A fighter inside `tolerance` is left alone: three seeds of
// the 90 pairs is about +-10 points of noise per fighter. Values stay inside STOCK_BALANCE_RANGES; a fighter pinned at a limit
// while still out of line is reported (it needs a moveset or kit change, not a multiplier). The default personality is ONE
// profile for both sides, so the numbers compare kits, not playstyles. `--resume` continues from an earlier run's rounds.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const rounds = Number(opt('rounds', '5'));
const seeds = opt('seeds', '3');
const stage = opt('stage', 'all');
const level = opt('level', '3');
const personality = opt('personality', 'duelist');
const pages = opt('pages', '3');
const step = Number(opt('step', '0.06'));
const bigStep = Number(opt('big-step', '0.2'));
const gain = Number(opt('gain', '0.4'));
const tolerance = Number(opt('tolerance', '0.1'));
// Measured on this roster: win rate moves about 3 points per 1% of strength (Mara 20% -> 83% over +20%, Rusk 87% -> 39% over
// -16%). A secant through two noisy points close together can come out far flatter, and its step far too long.
const minSlope = Number(opt('min-slope', '2.5'));
const knobs = opt('knobs', 'dealt,launch').split(',');
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
const key = (id, k) => `stockBalance.${id}.${k}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

/** A fighter's strength from a set of overrides (1 = shipped). */
function strengthOf(overrides, id) {
  if (knobs.includes('dealt')) return (overrides[key(id, 'dealt')] ?? shipped[key(id, 'dealt')]) / shipped[key(id, 'dealt')];
  return shipped[key(id, 'launch')] / (overrides[key(id, 'launch')] ?? shipped[key(id, 'launch')]);
}
/** The overrides for a set of strengths (clamped to the ranges); `pinned` collects fighters a range stopped. */
function overridesFor(strength, pinned = {}) {
  const o = {};
  for (const id of IDS) {
    const s = strength[id];
    if (knobs.includes('dealt')) { const [lo, hi] = ranges.dealt; const v = shipped[key(id, 'dealt')] * s; o[key(id, 'dealt')] = round3(clamp(v, lo, hi)); if (v < lo || v > hi) pinned[id] = true; }
    if (knobs.includes('launch')) { const [lo, hi] = ranges.launch; const v = shipped[key(id, 'launch')] / s; o[key(id, 'launch')] = round3(clamp(v, lo, hi)); if (v < lo || v > hi) pinned[id] = true; }
  }
  return o;
}

let current = { ...shipped };
if (opt('start', '') && existsSync(opt('start', ''))) current = { ...current, ...JSON.parse(readFileSync(opt('start', ''), 'utf8')).overrides };
const strength = Object.fromEntries(IDS.map((id) => [id, strengthOf(current, id)]));
/** Every measured point per fighter: { s, rate }. */
const points = Object.fromEntries(IDS.map((id) => [id, []]));
const history = [];
let pinned = {};
let last = null;

// ---- resume: earlier rounds are evidence (their overrides and their win rates) ----
if (opt('resume', '')) {
  for (const base of opt('resume', '').split(',')) for (const d of readdirSync(base).filter((n) => n.startsWith('round-')).sort()) {
    const dir = `${base}/${d}`;
    if (!existsSync(`${dir}/duels.ndjson`)) continue;
    if (!existsSync(`${dir}/report.json`)) execFileSync('node', ['scripts/duel-analyse.mjs', dir], { stdio: 'ignore' });
    const run = JSON.parse(readFileSync(`${dir}/run.json`, 'utf8'));
    const report = JSON.parse(readFileSync(`${dir}/report.json`, 'utf8'));
    if ((run.done ?? report.matches) < 0.9 * (run.jobs ?? report.matches)) continue; // an interrupted round is not evidence
    const overrides = { ...shipped, ...run.overrides };
    const rates = Object.fromEntries(IDS.map((id) => [id, report.fighters[id]?.winRate ?? 0.5]));
    for (const id of IDS) points[id].push({ s: strengthOf(overrides, id), rate: rates[id] });
    const spread = Math.max(...Object.values(rates)) - Math.min(...Object.values(rates));
    history.push({ round: `${base}/${d}`, overrides, rates, spread, flags: report.flags });
    last = dir;
    console.log(`resumed ${dir}: spread ${(spread * 100).toFixed(0)} pts`);
  }
  if (history.length) {
    // Carry on from the last measured round: a fighter inside the band keeps its values, it does not revert to shipped.
    for (const id of IDS) strength[id] = points[id][points[id].length - 1]?.s ?? strength[id];
    step2(history[history.length - 1].rates);
  }
}

/** Next strengths from the latest rates. */
function step2(rates) {
  for (const id of IDS) {
    const delta = 0.5 - rates[id];
    if (Math.abs(delta) <= tolerance) continue;
    const pts = points[id];
    const now = pts[pts.length - 1] ?? { s: strength[id], rate: rates[id] };
    let prev = null;
    for (let i = pts.length - 2; i >= 0; i--) if (Math.abs(Math.log(pts[i].s / now.s)) > 0.01) { prev = pts[i]; break; }
    const x1 = Math.log(now.s);
    const cap = Math.abs(delta) > 0.2 ? bigStep : step;
    let x = x1 + clamp(delta * gain * 2, -cap, cap);
    if (prev) {
      const x0 = Math.log(prev.s), slope = (now.rate - prev.rate) / (x1 - x0);
      if (slope > 0.2) {
        x = x1 + (0.5 - now.rate) / Math.max(minSlope, slope);
        // Two points that straddle 50% bracket the answer: stay strictly between them.
        if ((prev.rate - 0.5) * (now.rate - 0.5) < 0) x = clamp(x, Math.min(x0, x1) + 0.15 * Math.abs(x1 - x0), Math.max(x0, x1) - 0.15 * Math.abs(x1 - x0));
        x = clamp(x, x1 - bigStep, x1 + bigStep);
      }
    }
    strength[id] = Math.exp(x);
  }
  pinned = {};
  current = { ...shipped, ...overridesFor(strength, pinned) };
}

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
  for (const id of IDS) points[id].push({ s: strength[id], rate: rates[id] });
  history.push({ round: dir, overrides: { ...current }, rates, spread, flags: report.flags });
  savePatch();
  const outside = IDS.filter((id) => Math.abs(rates[id] - 0.5) > tolerance);
  if (outside.length === 0) { console.log('every fighter is inside the band: done'); break; }
  if (r === rounds) break;
  step2(rates);
  if (Object.keys(pinned).length) console.log('pinned at a range limit (needs a moveset or kit change):', Object.keys(pinned).join(', '));
}

// The best round so far (the smallest spread) is what a stopped or finished run hands over, not merely the last one.
function savePatch() {
  const best = history.reduce((a, b) => (b.spread < a.spread ? b : a), history[0]);
  const patch = { url, seeds, stage, level, personality, knobs, bestRound: best?.round, bestSpread: best?.spread,
    overrides: Object.fromEntries(Object.entries(best?.overrides ?? current).filter(([k, v]) => v !== shipped[k])), history, pinned };
  writeFileSync(`${out}/balance-patch.json`, JSON.stringify(patch, null, 2));
  return patch;
}
const patch = savePatch();
console.log(`\nwrote ${out}/balance-patch.json (best: ${patch.bestRound}, spread ${(patch.bestSpread * 100).toFixed(0)} pts, ${Object.keys(patch.overrides).length} overrides)`);

if (args.includes('--apply')) {
  const final = { ...shipped, ...patch.overrides };
  let text = readFileSync(SOURCE, 'utf8');
  for (const [k, value] of Object.entries(final)) {
    const [, id, lever] = k.split('.');
    const re = new RegExp(`('${id}': \\{[^}]*?\\b${lever}: )([0-9.]+)`);
    if (!re.test(text)) throw new Error(`cannot find ${k} in ${SOURCE}`);
    text = text.replace(re, `$1${value}`);
  }
  writeFileSync(SOURCE, text);
  console.log(`applied the best round to ${SOURCE}: review the diff, run a confirmation batch on fresh seeds (--seed-base), then commit`);
}
