#!/usr/bin/env node
// THE SPLIT'S BEHAVIOUR ORACLES (docs/split/SPLIT-PLAN.md, section 6): numbers that must come out the same after
// every phase of the untangling, because every phase is meant to move code, not change what it does.
//
//   node scripts/split/oracles.mjs record [url]   measure, and write scripts/split/oracles.json
//   node scripts/split/oracles.mjs check  [url]   measure again and compare (exit 1 on any difference)
//
// url defaults to http://localhost:5173/. Run it against a FROZEN worktree's dev server: a src edit hot-reloads the
// pages mid-match. The oracles:
//   sim       scripts/bench-sim.mjs: the golden multi-chunk scene stepped in Node, its state hash
//   cellSim   scripts/verify-sim-determinism.mjs: a real generated world in the real game, 240 cell-sim ticks, the
//             plane hash and per-stream draw counts (the probe itself must pass too)
//   genGolden tests/gen-golden.test.ts (the cave generator's FNV hashes): must pass
//   duels     scripts/duel-batch.mjs: 20 seeded stock matches, every fighter on both sides, all four stages.
//             Whole-tick replay is not exact yet (the determinism probe measures that), so `record` runs the batch
//             TWICE: a match that replayed identically is held exactly (winner, ticks, stocks); one that did not is
//             held to its winner only, and is listed as unstable so the number is on the record.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './surveyCore.mjs';

const [mode, urlArg] = process.argv.slice(2);
if (!['record', 'check'].includes(mode)) {
  console.error('usage: node scripts/split/oracles.mjs record|check [url]');
  process.exit(2);
}
const url = urlArg ?? 'http://localhost:5173/';
const ORACLES = join(ROOT, 'scripts', 'split', 'oracles.json');
const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
// A ring: every fighter meets both neighbours, from both sides (duel-batch adds the reverse of each pair): 20 matches.
const PAIRS = IDS.map((a, i) => `${a},${IDS[(i + 1) % IDS.length]}`).join(';');

const node = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
const step = (name) => process.stdout.write(`-- ${name}\n`);

function measureSim() {
  step('sim (bench-sim, Node)');
  const r = node(['scripts/bench-sim.mjs', '800', '480', '160', '1']);
  const m = /state (\w+)\s*$/m.exec(r.stdout);
  if (!m) throw new Error(`bench-sim printed no state hash:\n${r.stdout}\n${r.stderr}`);
  return { size: '800x480', ticks: 160, state: m[1] };
}

function measureCellSim() {
  step('cellSim (verify-sim-determinism, browser)');
  const r = node(['scripts/verify-sim-determinism.mjs', url]);
  const m = /^ORACLE cell-sim seed=(\d+) ticks=(\d+) planes=(\w+) draws=(\{.*\})$/m.exec(r.stdout);
  if (r.status !== 0 || !m) throw new Error(`verify-sim-determinism failed:\n${r.stdout.slice(-3000)}\n${r.stderr.slice(-2000)}`);
  return { seed: Number(m[1]), ticks: Number(m[2]), planes: m[3], draws: JSON.parse(m[4]) };
}

function measureGenGolden() {
  step('genGolden (vitest)');
  const r = spawnSync('npx', ['vitest', 'run', 'tests/gen-golden.test.ts'], { cwd: ROOT, encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error(`gen-golden failed:\n${r.stdout.slice(-3000)}`);
  return { passed: true };
}

function duelBatch(tag) {
  const out = join('verify-out', 'split', `oracle-duels-${tag}`);
  rmSync(join(ROOT, out), { recursive: true, force: true });
  const r = node(['scripts/duel-batch.mjs', url, '--pairs', PAIRS, '--seeds', '1', '--stage', 'all', '--pages', '2', '--out', out], { stdio: ['ignore', 'pipe', 'inherit'] });
  if (r.status !== 0) throw new Error(`duel-batch failed:\n${r.stdout.slice(-3000)}`);
  const rows = readFileSync(join(ROOT, out, 'duels.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return Object.fromEntries(
    rows.map((d) => [
      `${d.i}:${d.sides[0].id}-${d.sides[1].id}@${d.stage}#${d.spec?.seed ?? ''}`,
      { winner: d.winner === null ? 'draw' : d.sides[d.winner].id, ticks: d.ticks, stocks: d.sides.map((s) => s.stocks), reason: d.reason },
    ]),
  );
}

function measureDuels(times) {
  step(`duels (duel-batch x${times})`);
  const runs = Array.from({ length: times }, (_, k) => duelBatch(`${mode}-${k}`));
  return runs;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const git = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { return 'unknown'; } })();

if (mode === 'record') {
  const sim = measureSim();
  const cellSim = measureCellSim();
  const genGolden = measureGenGolden();
  const [a, b] = measureDuels(2);
  const exact = {};
  const winnerOnly = {};
  for (const [k, v] of Object.entries(a)) {
    if (!b[k]) throw new Error(`second duel batch lacks ${k}`);
    if (same(v, b[k])) exact[k] = v;
    else winnerOnly[k] = { winner: v.winner === b[k].winner ? v.winner : null, first: v, second: b[k] };
  }
  const record = { recordedAt: new Date().toISOString(), git, url, sim, cellSim, genGolden, duels: { pairs: PAIRS, exact, winnerOnly } };
  writeFileSync(ORACLES, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\noracles recorded at ${git}: sim ${sim.state}, cell sim ${cellSim.planes}, ${Object.keys(exact).length} exact duels, ${Object.keys(winnerOnly).length} unstable (winner only)`);
} else {
  const base = JSON.parse(readFileSync(ORACLES, 'utf8'));
  const diffs = [];
  const sim = measureSim();
  if (sim.state !== base.sim.state) diffs.push(`sim state ${base.sim.state} -> ${sim.state}`);
  const cellSim = measureCellSim();
  if (cellSim.planes !== base.cellSim.planes) diffs.push(`cell sim planes ${base.cellSim.planes} -> ${cellSim.planes}`);
  if (!same(cellSim.draws, base.cellSim.draws)) diffs.push(`cell sim draws ${JSON.stringify(base.cellSim.draws)} -> ${JSON.stringify(cellSim.draws)}`);
  measureGenGolden();
  const [now] = measureDuels(1);
  for (const [k, v] of Object.entries(base.duels.exact)) {
    if (!now[k]) diffs.push(`duel ${k} missing`);
    else if (!same(now[k], v)) diffs.push(`duel ${k}: ${JSON.stringify(v)} -> ${JSON.stringify(now[k])}`);
  }
  let unstableFlips = 0;
  for (const [k, v] of Object.entries(base.duels.winnerOnly)) {
    if (v.winner !== null && now[k] && now[k].winner !== v.winner) unstableFlips++;
  }
  if (unstableFlips) console.log(`note: ${unstableFlips} of ${Object.keys(base.duels.winnerOnly).length} replay-unstable duels changed winner (not a failure on its own)`);
  if (diffs.length) {
    console.error(`\nORACLES CHANGED (baseline ${base.git}):\n  ${diffs.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`\noracles identical to ${base.git}: sim, cell sim, gen golden, ${Object.keys(base.duels.exact).length} exact duels`);
}
