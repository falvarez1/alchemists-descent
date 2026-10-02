// THE FIGHT ANALYSER (docs/arena/TELEMETRY-AND-BALANCE.md 3.4): read a batch's JSONL fight records and say, with intervals, who wins, how,
// and where the numbers are out of line. Writes <dir>/report.md and <dir>/report.json and prints the headline.
//
//   node scripts/fight-analyse.mjs <dir> [--target 0.5] [--band 0.1] [--json-only]
//
// Everything is per FIGHTER ID (a fight record names who stood in each slot), so a pair run both sides counts for both fighters once.
// Win rate counts a decisive result (a knockout, or a timeout won on health); draws are half a win.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir || !existsSync(dir)) { console.error('usage: node scripts/fight-analyse.mjs <dir>'); process.exit(2); }
const args = process.argv.slice(3);
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : f; };
const TARGET = opt('target', 0.5), BAND = opt('band', 0.1);

// ---------------------------------------------------------------- reading
const index = readFileSync(`${dir}/index.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error);
const failedRuns = readFileSync(`${dir}/index.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.error).length;
const runMeta = existsSync(`${dir}/run.json`) ? JSON.parse(readFileSync(`${dir}/run.json`, 'utf8')) : {};

function parseFight(row) {
  const text = readFileSync(`${dir}/${row.file}`, 'utf8');
  let header = null; const samples = []; const events = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line);
    if (o.k === 'h') header = o; else if (o.k === 's') samples.push(o); else if (o.k === 'e') events.push(o);
  }
  return { row, header, samples, events };
}

// ---------------------------------------------------------------- stats helpers
const z = 1.96;
function wilson(wins, n) {
  if (n === 0) return [0, 0, 1];
  const p = wins / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return [p, Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------------------------------------------------------------- the accumulation
const fighters = {};
const F = (id) => (fighters[id] ??= {
  id, fights: 0, wins: 0, draws: 0, ko: 0, winsLeft: 0, fightsLeft: 0, winsRight: 0, fightsRight: 0,
  dealt: 0, taken: 0, seconds: 0, winSeconds: [], loseSeconds: [], endHpWin: [],
  byTag: {}, takenBySource: {}, abil: { tactical: { fired: 0, refused: 0, again: 0 }, ultimate: { fired: 0, refused: 0, again: 0 } },
  speedSum: 0, speedN: 0, airN: 0, sampN: 0, gapSum: 0, gapN: 0, stunned: 0,
});
const matrix = {}; // matrix[a][b] = { wins, n }
const pairResults = [];
let totalKO = 0, totalTimeout = 0; const durations = [];

for (const row of index) {
  const f = parseFight(row);
  if (!f.header) continue;
  const ids = f.header.fighters.map((x) => x.id);
  const winner = row.winner; // slot or null
  const secs = row.ticks / 60;
  durations.push(secs);
  if (row.reason === 'ko') totalKO++; else totalTimeout++;
  for (let s = 0; s < ids.length; s++) {
    const me = F(ids[s]);
    me.fights++; me.seconds += secs;
    if (s === 0) me.fightsLeft++; else me.fightsRight++;
    if (winner === s) { me.wins++; if (s === 0) me.winsLeft++; else me.winsRight++; me.winSeconds.push(secs); if (row.reason === 'ko') me.ko++; me.endHpWin.push(row.hp[s] / f.header.fighters[s].maxHp); }
    else if (winner === null) { me.draws++; }
    else me.loseSeconds.push(secs);
  }
  const a = ids[0], b = ids[1];
  ((matrix[a] ??= {})[b] ??= { wins: 0, n: 0 });
  ((matrix[b] ??= {})[a] ??= { wins: 0, n: 0 });
  matrix[a][b].n++; matrix[b][a].n++;
  if (winner === 0) matrix[a][b].wins++; else if (winner === 1) matrix[b][a].wins++; else { matrix[a][b].wins += 0.5; matrix[b][a].wins += 0.5; }
  pairResults.push({ a, b, winner });
  // events
  for (const e of f.events) {
    if (e.e === 'hurt') {
      const dst = ids[e.dst]; if (!dst) continue;
      F(dst).taken += e.taken;
      F(dst).takenBySource[e.source] = (F(dst).takenBySource[e.source] ?? 0) + e.taken;
      if (e.src >= 0 && ids[e.src]) {
        const src = F(ids[e.src]);
        src.dealt += e.taken;
        const tag = e.tag ?? 'unknown';
        src.byTag[tag] = (src.byTag[tag] ?? 0) + e.taken;
      }
    } else if (e.e === 'ability') {
      const who = ids[e.who]; if (!who) continue;
      F(who).abil[e.slot][e.res]++;
    }
  }
  // samples: style
  for (const s of f.samples) {
    for (let k = 0; k < s.f.length; k++) {
      const me = F(ids[k]); const r = s.f[k];
      me.speedSum += Math.hypot(r[2], r[3]); me.speedN++;
      if (!(r[10] & 1)) me.airN++;
      if (r[10] & 8) me.stunned++;
      me.sampN++;
      if (s.f.length === 2) { me.gapSum += Math.abs(r[0] - s.f[1 - k][0]); me.gapN++; }
    }
  }
}

// ---------------------------------------------------------------- Bradley-Terry strengths from pair results
const ids = Object.keys(fighters).sort();
const strength = Object.fromEntries(ids.map((i) => [i, 1]));
for (let it = 0; it < 200; it++) {
  for (const i of ids) {
    let w = 0, d = 0;
    for (const j of ids) {
      if (i === j) continue;
      const m = matrix[i]?.[j]; if (!m || m.n === 0) continue;
      w += m.wins; d += m.n / (strength[i] + strength[j]);
    }
    if (d > 0) strength[i] = Math.max(0.01, w / d);
  }
  const g = Math.exp(mean(ids.map((i) => Math.log(strength[i])))); for (const i of ids) strength[i] /= g;
}

// ---------------------------------------------------------------- the report
const rows = ids.map((id) => {
  const x = fighters[id];
  const [p, lo, hi] = wilson(x.wins + x.draws / 2, x.fights);
  const [pl] = wilson(x.winsLeft, x.fightsLeft), [pr] = wilson(x.winsRight, x.fightsRight);
  return {
    id, fights: x.fights, winRate: p, lo, hi, left: pl, right: pr, ko: x.ko / Math.max(1, x.wins),
    dps: x.dealt / Math.max(1, x.seconds), taken: x.taken / Math.max(1, x.seconds), bt: strength[id],
    ttkWin: median(x.winSeconds), ttkLose: median(x.loseSeconds), endHp: mean(x.endHpWin),
    speed: x.speedSum / Math.max(1, x.speedN), air: x.airN / Math.max(1, x.sampN), gap: x.gapSum / Math.max(1, x.gapN), stunned: x.stunned / Math.max(1, x.sampN),
    tags: Object.fromEntries(Object.entries(x.byTag).map(([k, v]) => [k, v / Math.max(1, x.fights)])),
    taken_by: Object.fromEntries(Object.entries(x.takenBySource).map(([k, v]) => [k, v / Math.max(1, x.fights)])),
    abil: Object.fromEntries(['tactical', 'ultimate'].map((s) => [s, { fired: x.abil[s].fired / Math.max(1, x.fights), refused: x.abil[s].refused / Math.max(1, x.fights) }])),
  };
}).sort((a, b) => b.winRate - a.winRate);

const flags = [];
for (const r of rows) {
  if (r.lo > TARGET + BAND * 0.5 && r.winRate > TARGET + BAND) flags.push({ id: r.id, kind: 'too-strong', detail: `win rate ${pct(r.winRate)} (95% ${pct(r.lo)}-${pct(r.hi)}) against a target of ${pct(TARGET)} +- ${pct(BAND)}` });
  else if (r.hi < TARGET - BAND * 0.5 && r.winRate < TARGET - BAND) flags.push({ id: r.id, kind: 'too-weak', detail: `win rate ${pct(r.winRate)} (95% ${pct(r.lo)}-${pct(r.hi)}) against a target of ${pct(TARGET)} +- ${pct(BAND)}` });
  if (Math.abs(r.left - r.right) > 0.2 && fighters[r.id].fightsLeft >= 10 && fighters[r.id].fightsRight >= 10) flags.push({ id: r.id, kind: 'side-bias', detail: `wins ${pct(r.left)} on the left, ${pct(r.right)} on the right` });
  if (r.taken_by && r.dps > 0) {
    const top = Object.entries(r.tags).sort((a, b) => b[1] - a[1])[0];
    const sum = Object.values(r.tags).reduce((s, v) => s + v, 0);
    if (top && sum > 0 && top[1] / sum > 0.75) flags.push({ id: r.id, kind: 'one-trick', detail: `${pct(top[1] / sum)} of its damage is ${top[0]}` });
  }
  if (r.abil.tactical.fired < 0.5 && fighters[r.id].fights >= 10) flags.push({ id: r.id, kind: 'dead-ability', detail: `its tactical fires ${r2(r.abil.tactical.fired)} times a fight (the bot may not know how)` });
}
const lopsided = [];
for (const a of ids) for (const b of ids) {
  if (a >= b) continue;
  const m1 = matrix[a]?.[b];
  if (!m1 || m1.n < 4) continue;
  const p = m1.wins / m1.n; const [, lo, hi] = wilson(m1.wins, m1.n);
  if (lo > 0.8 || hi < 0.2) lopsided.push({ a, b, aWins: m1.wins, n: m1.n, p });
}

const report = {
  run: runMeta, fights: index.length, failed: failedRuns, ko: totalKO, timeout: totalTimeout,
  medianSeconds: median(durations), p90Seconds: [...durations].sort((a, b) => a - b)[Math.floor(durations.length * 0.9)] ?? 0,
  fighters: rows, matrix: Object.fromEntries(ids.map((a) => [a, Object.fromEntries(ids.filter((b) => b !== a && matrix[a]?.[b]).map((b) => [b, { wins: matrix[a][b].wins, n: matrix[a][b].n }]))])), flags, lopsided,
};
writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));

const short = (id) => id.split('-')[0].slice(0, 6);
const L = [];
L.push(`# Fight report: ${runMeta.runId ?? dir}`, '');
L.push(`${index.length} fights${failedRuns ? ` (${failedRuns} failed to run)` : ''}, git ${runMeta.git ?? '?'}${runMeta.dirty ? '+dirty' : ''}, level ${runMeta.level ?? '?'}${runMeta.overrides && Object.keys(runMeta.overrides).length ? `, overrides ${JSON.stringify(runMeta.overrides)}` : ''}.`);
L.push(`${totalKO} knockouts, ${totalTimeout} timeouts. Median fight ${r1(report.medianSeconds)} s (90th percentile ${r1(report.p90Seconds)} s).`, '');
L.push('## Strength', '', '| fighter | fights | win rate | 95% | left | right | Bradley-Terry | median win | median loss | DPS | taken/s | KO share |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) L.push(`| ${r.id} | ${r.fights} | **${pct(r.winRate)}** | ${pct(r.lo)}-${pct(r.hi)} | ${pct(r.left)} | ${pct(r.right)} | ${r2(r.bt)} | ${r1(r.ttkWin)} s | ${r1(r.ttkLose)} s | ${r1(r.dps)} | ${r1(r.taken)} | ${pct(r.ko)} |`);
L.push('', '## Matchups (row beats column, % of fights)', '', `| | ${ids.map(short).join(' | ')} |`, `|---|${ids.map(() => '---').join('|')}|`);
for (const a of ids) L.push(`| ${short(a)} | ${ids.map((b) => (a === b ? '.' : matrix[a]?.[b]?.n ? pct(matrix[a][b].wins / matrix[a][b].n) : '-')).join(' | ')} |`);
L.push('', '## Where the damage comes from (per fight)', '', '| fighter | spell | kick | tactical | ultimate | passive | world | total dealt |', '|---|---|---|---|---|---|---|---|');
for (const r of rows) { const t = r.tags; L.push(`| ${r.id} | ${r1(t.spell ?? 0)} | ${r1(t.kick ?? 0)} | ${r1(t['ability.tactical'] ?? 0)} | ${r1(t['ability.ultimate'] ?? 0)} | ${r1(t.passive ?? 0)} | ${r1(t.world ?? 0)} | ${r1(Object.values(t).reduce((s, v) => s + v, 0))} |`); }
L.push('', '## Abilities (per fight) and how each fighter moves', '', '| fighter | tactical fired | refused | ultimate fired | speed | airborne | gap to foe | stunned |', '|---|---|---|---|---|---|---|---|');
for (const r of rows) L.push(`| ${r.id} | ${r2(r.abil.tactical.fired)} | ${r2(r.abil.tactical.refused)} | ${r2(r.abil.ultimate.fired)} | ${r2(r.speed)} | ${pct(r.air)} | ${Math.round(r.gap)} | ${pct(r.stunned)} |`);
L.push('', '## Flags', '');
if (!flags.length && !lopsided.length) L.push('None: every fighter is inside the band, no matchup is lopsided.');
for (const f of flags) L.push(`- **${f.id}** ${f.kind}: ${f.detail}`);
for (const m of lopsided) L.push(`- **${m.a} vs ${m.b}** lopsided: ${m.aWins}/${m.n} (${pct(m.p)})`);
writeFileSync(`${dir}/report.md`, L.join('\n') + '\n');

if (!args.includes('--json-only')) {
  try { execFileSync('node', ['scripts/fight-report-html.mjs', dir], { stdio: 'ignore' }); } catch { /* the page is a courtesy: the markdown and json are the record */ }
  console.log(`${index.length} fights, ${totalKO} KO, ${totalTimeout} timeout, median ${r1(report.medianSeconds)} s`);
  for (const r of rows) console.log(`  ${r.id.padEnd(14)} ${pct(r.winRate).padStart(4)} (${pct(r.lo)}-${pct(r.hi)})  BT ${String(r2(r.bt)).padEnd(5)} DPS ${String(r1(r.dps)).padEnd(5)} L/R ${pct(r.left)}/${pct(r.right)}`);
  console.log(`${flags.length} flags, ${lopsided.length} lopsided matchups. Report: ${dir}/report.md and report.html (open it: a timeline of any fight)`);
}
