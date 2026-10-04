// THE DUEL ANALYSER (docs/arena/STOCK-TELEMETRY.md): read a duel-batch directory (duels.ndjson) and write report.md + report.json:
// each fighter's win rate with a 95% interval, the matchup matrix, stocks, KOs and self-destructs, damage by move group, the
// blows that take stocks, how often each blow lands, defense (shields, dodges, grabs), and behaviour checks that say whether
// the CPUs fought like people (crossings on one surface, time in the air, spacing). Flags say what to look at first.
//
//   node scripts/duel-analyse.mjs <dir> [--compare <baseline dir>] [--band 0.1]
//
// --compare  a second run (the same jobs before a change): each fighter's win-rate delta is printed beside its rate
// --band     the balance band around 50% (default 0.10: a fighter outside 40..60% whose interval excludes 50% is flagged)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('usage: node scripts/duel-analyse.mjs <dir> [--compare <dir>] [--band 0.1]'); process.exit(2); }
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const band = Number(opt('band', '0.1'));
const compareDir = opt('compare', '');

const NAMES = {
  'ilyra-voss': 'Ilyra', 'brann-rook': 'Brann', 'sable-fen': 'Sable', 'mara-quell': 'Mara', 'kest-rel': 'Kest',
  'nox-calder': 'Nox', 'edda-morrow': 'Edda', 'selene-wraith': 'Selene', 'rusk-emberjaw': 'Rusk', 'father-thorne': 'Thorne',
};
const name = (id) => NAMES[id] ?? id;

function load(d) {
  const file = join(d, 'duels.ndjson');
  if (!existsSync(file)) throw new Error(`no duels.ndjson in ${d}`);
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const run = existsSync(join(d, 'run.json')) ? JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')) : {};
  return { rows, run };
}

/** Wilson score interval for k of n at 95%. */
function wilson(k, n) {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const fix = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const add = (obj, k, v = 1) => { obj[k] = (obj[k] ?? 0) + v; };

function aggregate(rows) {
  const F = {};
  const fighter = (id) => (F[id] ??= {
    id, n: 0, wins: 0, draws: 0, stocksLeft: 0, stockDiff: 0, kos: 0, selfKos: 0, deaths: 0, dealt: 0, taken: 0, dealtBy: {},
    deathPercents: [], minutes: 0, starts: {}, hits: {}, shields: 0, dodges: 0, grabs: 0, specials: 0, ultimates: 0, shieldBreaks: 0,
    airTicks: 0, stunTicks: 0, ticks: 0, tactics: {}, koBlows: {}, vs: {},
  });
  const M = {};
  const behaviour = { crossings: [], air: [], neutral: [], close: [], dist: [] };
  const reasons = {}, stages = {};
  let side0 = 0, decided = 0;
  for (const r of rows) {
    add(reasons, r.reason);
    const st = (stages[r.stage] ??= { n: 0, ticks: 0, kos: 0, selfKos: 0 });
    st.n++; st.ticks += r.ticks;
    behaviour.crossings.push(r.behaviour.crossingsPerMin);
    behaviour.air.push(...r.behaviour.airShare);
    behaviour.neutral.push(r.behaviour.neutralShare);
    behaviour.close.push(r.behaviour.closeShare);
    behaviour.dist.push(r.behaviour.meanDist);
    if (r.winner !== null) { decided++; if (r.winner === 0) side0++; }
    for (const s of [0, 1]) {
      const me = r.sides[s], foe = r.sides[1 - s], f = fighter(me.id);
      f.n++; f.ticks += r.ticks; f.minutes += r.ticks / 3600;
      if (r.winner === s) f.wins++; else if (r.winner === null) f.draws++;
      f.stocksLeft += me.stocks; f.stockDiff += me.stocks - foe.stocks;
      f.kos += me.kos; f.selfKos += me.selfKos; f.dealt += me.dealtTotal; f.taken += me.taken;
      for (const [k, v] of Object.entries(me.dealt)) add(f.dealtBy, k, v);
      for (const [k, v] of Object.entries(me.starts)) add(f.starts, k, v);
      for (const [k, v] of Object.entries(me.hits)) add(f.hits, k, v);
      for (const [k, v] of Object.entries(me.tactics ?? {})) add(f.tactics, k, v);
      f.shields += me.shields; f.dodges += me.dodges; f.grabs += me.grabs; f.specials += me.specials; f.ultimates += me.ultimates;
      f.shieldBreaks += me.shieldBreaks; f.airTicks += me.airTicks; f.stunTicks += me.stunTicks;
      const vs = (f.vs[foe.id] ??= { n: 0, wins: 0 });
      vs.n++; if (r.winner === s) vs.wins++;
      const key = `${me.id}|${foe.id}`;
      (M[key] ??= { n: 0, wins: 0 }).n++; if (r.winner === s) M[key].wins++;
    }
    for (const ko of r.kos) {
      const victim = fighter(r.sides[ko.slot].id);
      victim.deaths++; victim.deathPercents.push(ko.percent);
      st.kos++;
      if (ko.by === ko.slot) st.selfKos++;
      else add(fighter(r.sides[ko.by].id).koBlows, ko.last ?? 'unknown');
    }
  }
  return { F, M, behaviour, reasons, stages, side0, decided };
}

const { rows, run } = load(dir);
if (rows.length === 0) { console.error('no matches in', dir); process.exit(1); }
const A = aggregate(rows);
const B = compareDir ? aggregate(load(compareDir).rows) : null;
const ids = Object.keys(A.F).sort((a, b) => A.F[b].wins / A.F[b].n - A.F[a].wins / A.F[a].n);

// ---- flags ----
const flags = [];
for (const id of ids) {
  const f = A.F[id], rate = f.wins / f.n, [lo, hi] = wilson(f.wins, f.n);
  if ((rate > 0.5 + band && lo > 0.5) || (rate < 0.5 - band && hi < 0.5)) flags.push(`${name(id)} wins ${pct(rate)} (95% ${pct(lo)}-${pct(hi)}): outside the ${pct(0.5 - band)}-${pct(0.5 + band)} band`);
  const sdRate = f.selfKos / Math.max(1, f.deaths);
  if (f.deaths >= 4 && sdRate > 0.25) flags.push(`${name(id)} loses ${pct(sdRate)} of its stocks to itself (self-destructs: recovery or edge play)`);
}
const timeouts = (A.reasons.timeout ?? 0) + (A.reasons.cap ?? 0);
if (timeouts / rows.length > 0.1) flags.push(`${pct(timeouts / rows.length)} of matches reached the clock: the CPUs stall`);
const cross = mean(A.behaviour.crossings);
if (cross > 6) flags.push(`fighters cross through each other ${fix(cross)} times a minute on one surface (target < 6): spacing is breaking down`);
const air = mean(A.behaviour.air);
if (air > 0.35) flags.push(`fighters spend ${pct(air)} of the fight airborne outside hitstun (target < 35%): too much jumping`);
if (A.decided >= 20) {
  const s0 = A.side0 / A.decided, [lo, hi] = wilson(A.side0, A.decided);
  if (lo > 0.5 || hi < 0.5) flags.push(`slot 0 (the left spawn) wins ${pct(s0)} of decided matches (95% ${pct(lo)}-${pct(hi)}): a side bias`);
}

// ---- the report ----
const L = [];
const minutes = rows.reduce((a, r) => a + r.ticks, 0) / 3600;
L.push(`# Duel balance report`, '');
L.push(`${rows.length} stock matches, ${fix(minutes, 0)} fight-minutes. Run \`${run.runId ?? dir}\` at git ${run.git ?? '?'}${run.dirty ? '+dirty' : ''}; CPU level ${(run.level ?? []).join('/') || '?'}, personality ${run.personality ?? '?'}, stages ${(run.stages ?? []).join(', ') || '?'}${run.overrides && Object.keys(run.overrides).length ? `, overrides \`${JSON.stringify(run.overrides)}\`` : ''}.`);
L.push(`Outcomes: ${Object.entries(A.reasons).map(([k, v]) => `${k} ${v}`).join(', ')}. Median match ${fix(median(rows.map((r) => r.ticks / 60)), 0)} s.`, '');
L.push('## Flags', '');
if (flags.length === 0) L.push('None: every fighter is inside the band (or the sample cannot tell it from 50%), and the behaviour checks pass.');
for (const f of flags) L.push(`- ${f}`);
L.push('');
L.push('## Fighters', '');
L.push(`| Fighter | Matches | Win rate (95%) |${B ? ' vs baseline |' : ''} Stock diff | KOs | Self-KOs | Dealt % | Taken % | Dies at % | Specials | Shields | Grabs |`);
L.push(`|---|---|---|${B ? '---|' : ''}---|---|---|---|---|---|---|---|---|`);
for (const id of ids) {
  const f = A.F[id], rate = f.wins / f.n, [lo, hi] = wilson(f.wins, f.n), per = (x) => fix(x / f.n);
  const delta = B?.F[id] ? `${rate - B.F[id].wins / B.F[id].n >= 0 ? '+' : ''}${pct(rate - B.F[id].wins / B.F[id].n)} |` : (B ? ' - |' : '');
  L.push(`| ${name(id)} | ${f.n} | ${pct(rate)} (${pct(lo)}-${pct(hi)}) |${B ? ` ${delta}` : ''} ${fix(f.stockDiff / f.n, 2)} | ${per(f.kos)} | ${per(f.selfKos)} | ${per(f.dealt)} | ${per(f.taken)} | ${fix(mean(f.deathPercents), 0)} | ${per(f.specials)} | ${per(f.shields)} | ${per(f.grabs)} |`);
}
L.push('', 'Per match: stock diff, KOs, self-KOs, percent dealt and taken, specials spent, shields raised, grabs reached. "Dies at" is the mean percent when a stock was lost.', '');
L.push('## Matchups (row wins vs column, both sides pooled)', '');
L.push(`| | ${ids.map(name).join(' | ')} |`);
L.push(`|---|${ids.map(() => '---').join('|')}|`);
for (const a of ids) {
  L.push(`| **${name(a)}** | ${ids.map((b) => { if (a === b) return '·'; const m = A.M[`${a}|${b}`]; return m ? `${pct(m.wins / m.n)} (${m.n})` : '-'; }).join(' | ')} |`);
}
L.push('');
L.push('## Blows', '');
L.push('| Fighter | Openers (hit) | Launchers (hit) | Finishers (hit) | Aerials (hit) | Throws | Melee % of damage | KO blows |');
L.push('|---|---|---|---|---|---|---|---|');
for (const id of ids) {
  const f = A.F[id];
  const cell = (k) => { const s = f.starts[k] ?? 0, h = f.hits[`melee.${k}`] ?? 0; return s ? `${fix(s / f.minutes, 1)}/min (${pct(h / s)})` : '-'; };
  const throws = Object.entries(f.hits).filter(([k]) => k.startsWith('throw.')).reduce((a, [, v]) => a + v, 0);
  const meleeShare = (f.dealtBy.melee ?? 0) / Math.max(1, f.dealt);
  const ko = Object.entries(f.koBlows).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k.replace('melee.', '')} ${v}`).join(', ');
  L.push(`| ${name(id)} | ${cell('opener')} | ${cell('launcher')} | ${cell('finisher')} | ${cell('aerial')} | ${fix(throws / f.n)} | ${pct(meleeShare)} | ${ko || '-'} |`);
}
L.push('', 'Starts per fight-minute and the share that landed. "KO blows" is the last blow before each stock this fighter took.', '');
L.push('## How the CPUs fought', '');
L.push(`- Crossings through each other on one surface: ${fix(cross)} per minute (max ${fix(Math.max(...A.behaviour.crossings))}).`);
L.push(`- Airborne outside hitstun: ${pct(air)} of the fight. Mean spacing ${fix(mean(A.behaviour.dist), 0)} cells; in close range (<40) ${pct(mean(A.behaviour.close))}, in footsie range (40-90) ${pct(mean(A.behaviour.neutral))}.`);
const T = {};
for (const id of ids) for (const [k, v] of Object.entries(A.F[id].tactics)) add(T, k, v);
const tm = (k) => fix((T[k] ?? 0) / minutes, 1);
L.push(`- Per fight-minute (both fighters): approaches ${tm('mode_approach')}, punishes ${tm('punishes')}, counter-pokes ${tm('counterPokes')}, shields ${tm('shields')} (+${tm('preShields')} early), step-outs ${tm('stepOuts')}, dodges ${tm('dodges')}, out-of-shield grabs ${tm('oosGrabs')}, edge-guards ${tm('mode_edgeguard')}, follow-ups ${tm('mode_pressure')}, corner escapes ${tm('escapes')}.`);
if (A.decided > 0) L.push(`- Slot 0 (left spawn) won ${pct(A.side0 / A.decided)} of ${A.decided} decided matches.`);
if (Object.keys(A.stages).length > 1) {
  L.push('', '| Stage | Matches | Mean length | KOs/match | Self-KO share |', '|---|---|---|---|---|');
  for (const [s, v] of Object.entries(A.stages)) L.push(`| ${s} | ${v.n} | ${fix(v.ticks / v.n / 60, 0)} s | ${fix(v.kos / v.n)} | ${pct(v.selfKos / Math.max(1, v.kos))} |`);
}
L.push('', '## Tuning', '');
L.push('Re-run the same jobs with an override and compare: `node scripts/duel-batch.mjs <url> --pairs all --seeds 2 --set stock.<id>.finisher.damage=40 --out verify-out/duels/try` then `node scripts/duel-analyse.mjs verify-out/duels/try --compare ' + dir + '`. Levers: `stock.<id>.<kind>.<field>` (damage, startup, recovery, reach, knockX/Y, growth, stun), `body.<id>.<attr>` (`dealt`, `mass`, speed, jump...). `window.__duel.knobs("stock.")` lists them with ranges.');

function median(xs) { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }

const report = {
  run, matches: rows.length, minutes, reasons: A.reasons, flags,
  fighters: Object.fromEntries(ids.map((id) => { const f = A.F[id]; const [lo, hi] = wilson(f.wins, f.n); return [id, { n: f.n, winRate: f.wins / f.n, ci: [lo, hi], stockDiff: f.stockDiff / f.n, kos: f.kos / f.n, selfKos: f.selfKos / f.n, dealt: f.dealt / f.n, taken: f.taken / f.n, diesAt: mean(f.deathPercents), dealtBy: f.dealtBy, starts: f.starts, hits: f.hits, koBlows: f.koBlows, tactics: f.tactics, vs: f.vs }]; })),
  behaviour: { crossingsPerMin: cross, airShare: air, meanDist: mean(A.behaviour.dist), closeShare: mean(A.behaviour.close), neutralShare: mean(A.behaviour.neutral) },
  side0: A.decided ? A.side0 / A.decided : null, stages: A.stages,
};
writeFileSync(join(dir, 'report.md'), L.join('\n') + '\n');
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
console.log(L.join('\n'));
console.log(`\nwrote ${join(dir, 'report.md')} and report.json`);
