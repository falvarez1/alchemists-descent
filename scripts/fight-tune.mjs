// THE BALANCE TUNER (docs/arena/TELEMETRY-AND-BALANCE.md 3.6): measure the whole roster, turn the stat knobs of whoever is out of line a
// little, measure again, until every fighter's win rate sits in the band. Every round is a full matrix (every ordered pair, several seeds)
// run by scripts/fight-batch.mjs and read by scripts/fight-analyse.mjs; the result is a `balance-patch.json` (the overrides, with the
// evidence of each round) that you review and then write into content/fighterBodies.ts by hand. Nothing here edits the source.
//
//   node scripts/fight-tune.mjs [url] [--rounds 6] [--seeds 3] [--step 0.12] [--gain 0.6] [--tolerance 0.08] [--knobs dealt,maxHp]
//        [--level 3] [--out verify-out/fights/tune-<time>] [--start balance-patch.json]
// The default knob is `dealt` ALONE: a fighter's body is its feel and its health its fantasy (Brann the wall, Kest the glass), so the lever
// is how hard it hits. `--knobs dealt,maxHp` also turns health (the first pass did, and made Brann frail and Nox a tank: balanced, and wrong).
//
// A knob moves by at most `step` (a fraction) a round, in proportion to how far the fighter's win rate is from 50%, and only inside its
// declared range (core/fighterBody BODY_RANGES). A fighter pinned at a range limit while still out of line is reported: that one needs
// something a stat cannot give (a different loadout, a kit number), and the tuner says so rather than pretending.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const rounds = Number(opt('rounds', '6'));
const seeds = opt('seeds', '3');
const step = Number(opt('step', '0.12'));
const gain = Number(opt('gain', '0.6'));
const tolerance = Number(opt('tolerance', '0.08'));
const knobs = opt('knobs', 'dealt').split(',');
const level = opt('level', '3');
const out = opt('out', `verify-out/fights/tune-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
mkdirSync(out, { recursive: true });

const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
const RANGES = { dealt: [0.6, 1.6], maxHp: [0.6, 1.6], mass: [0.6, 1.6], run: [0.7, 1.4] };
// the shipped values (read from the source so a patch is relative to what is committed)
const shipped = {};
{
  const src = readFileSync('src/content/fighterBodies.ts', 'utf8');
  for (const id of IDS) {
    const m = new RegExp(`'${id}': tunableBody\\(\\{([\\s\\S]*?)\\}\\)`).exec(src);
    const body = m ? m[1] : '';
    for (const k of knobs) { const v = new RegExp(`\\b${k}: ([0-9.]+)`).exec(body); shipped[`body.${id}.${k}`] = v ? Number(v[1]) : 1; }
  }
}
let current = { ...shipped };
if (opt('start', '') && existsSync(opt('start', ''))) current = { ...current, ...JSON.parse(readFileSync(opt('start', ''), 'utf8')).overrides };

const history = [];
let pinned = {};
for (let r = 1; r <= rounds; r++) {
  const dir = `${out}/round-${String(r).padStart(2, '0')}`;
  const sets = Object.entries(current).filter(([k, v]) => v !== shipped[k]).flatMap(([k, v]) => ['--set', `${k}=${v}`]);
  console.log(`\n=== round ${r}/${rounds}: ${sets.length / 2} overrides ===`);
  execFileSync('node', ['scripts/fight-batch.mjs', url, '--pairs', 'all', '--seeds', seeds, '--level', level, '--out', dir, ...sets], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('node', ['scripts/fight-analyse.mjs', dir, '--json-only']);
  const report = JSON.parse(readFileSync(`${dir}/report.json`, 'utf8'));
  const rates = Object.fromEntries(report.fighters.map((f) => [f.id, { win: f.winRate, lo: f.lo, hi: f.hi }]));
  const worst = Math.max(...Object.values(rates).map((x) => Math.abs(x.win - 0.5)));
  history.push({ round: r, dir, overrides: { ...current }, rates, worst, fights: report.fights, medianSeconds: report.medianSeconds });
  console.log(IDS.map((id) => `${id.split('-')[0].padEnd(8)} ${Math.round(rates[id].win * 100)}%`).join('  '));
  console.log(`worst ${(worst * 100).toFixed(0)} points from 50% (tolerance ${(tolerance * 100).toFixed(0)}), median fight ${report.medianSeconds.toFixed(1)} s`);
  if (worst <= tolerance || r === rounds) break;
  // ---- the adjustment ----
  pinned = {};
  for (const id of IDS) {
    const e = rates[id].win - 0.5;
    if (Math.abs(e) < tolerance * 0.5) continue; // inside half the band: leave it
    const delta = Math.max(-step, Math.min(step, -gain * e)); // positive = make it stronger
    for (const k of knobs) {
      const path = `body.${id}.${k}`;
      const [lo, hi] = RANGES[k] ?? [0.5, 1.5];
      const was = current[path];
      const share = knobs.length > 1 && k === 'dealt' ? 0.5 : 1; // two power knobs split the move; a lone knob takes it all
      let next = was * (1 + delta * share);
      next = Math.round(Math.min(hi, Math.max(lo, next)) * 1000) / 1000;
      if ((next === hi && delta > 0) || (next === lo && delta < 0)) pinned[path] = { value: next, wants: delta > 0 ? 'more' : 'less', winRate: rates[id].win };
      current[path] = next;
    }
  }
}

const final = history[history.length - 1];
const patch = {
  generated: new Date().toISOString(),
  basis: 'level-' + level + ' basic bots, every ordered pair, ' + seeds + ' seeds, round ' + final.round,
  overrides: Object.fromEntries(Object.entries(current).filter(([k, v]) => v !== shipped[k])),
  shipped,
  pinnedAtALimit: pinned,
  result: Object.fromEntries(IDS.map((id) => [id, Math.round(final.rates[id].win * 100) / 100])),
  history: history.map((h) => ({ round: h.round, worst: Math.round(h.worst * 1000) / 1000, rates: Object.fromEntries(IDS.map((id) => [id, Math.round(h.rates[id].win * 100) / 100])), overrides: h.overrides })),
};
writeFileSync(`${out}/balance-patch.json`, JSON.stringify(patch, null, 2));
console.log(`\nbalance-patch.json: ${Object.keys(patch.overrides).length} changes after ${history.length} round(s); worst fighter ${(final.worst * 100).toFixed(0)} points from 50%.`);
if (Object.keys(pinned).length) console.log(`Pinned at a range limit (a stat cannot fix these): ${Object.entries(pinned).map(([k, v]) => `${k} wants ${v.wants} (${Math.round(v.winRate * 100)}%)`).join('; ')}`);
console.log(`Written to ${out}/balance-patch.json`);
