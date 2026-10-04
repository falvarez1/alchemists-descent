// THE DUEL BATCH (docs/arena/STOCK-TELEMETRY.md): run many STOCK matches (the Duel: 3 stocks, ring-outs, the shipped rules)
// between computer fighters in the real game, headless in the paused-step regime, and write one JSON record per match.
// `scripts/duel-analyse.mjs` turns the records into the balance report.
//
//   node scripts/duel-batch.mjs [url] [--pairs all | a,b;c,d] [--seeds 2] [--level 3] [--a-level N] [--b-level N]
//        [--stage foundry | all | foundry,kiln] [--personality fighter | duelist | ...] [--pages 2] [--max-ticks N]
//        [--set path=value ...] [--one-way] [--limit N] [--trace N] [--seed-base 9100] [--out verify-out/duels/<run>]
//
// --seed-base N     where the seeds start (a confirmation run after tuning uses fresh seeds: --seed-base 20000)
//
// --pairs all       every ordered pair of the ten (90): each pair runs both sides, so no fighter is only ever on the left
// --pairs a,b;c,d   the listed pairs (ids), both sides unless --one-way
// --stage all       every stage, round-robin across the jobs (one stage per job, so the job count does not multiply)
// --personality     'fighter' (default: each fighter's own, as the Duel lobby plays it) or one profile for BOTH sides,
//                   which compares the kits under one playstyle (the cleaner balance read)
// --set k=v         a parameter override for the whole batch (stock.<id>.<kind>.<field>, body.<id>.<attr>, kit.<id>...)
// --pages N         N browser pages in parallel (each a whole game: CPU-bound, about one per physical core)
//
// Run long batches against a FROZEN worktree's server: editing src hot-reloads the pages mid-match.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const all = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
const STAGES = ['foundry', 'kiln', 'cistern', 'gallery'];
const seeds = Number(opt('seeds', '2'));
const level = Number(opt('level', '3'));
const aLevel = Number(opt('a-level', String(level))), bLevel = Number(opt('b-level', String(level)));
const personality = opt('personality', 'fighter');
const stageArg = opt('stage', 'foundry');
const stages = stageArg === 'all' ? STAGES : stageArg.split(',');
for (const s of stages) if (!STAGES.includes(s)) throw new Error(`unknown stage "${s}"`);
const maxTicks = opt('max-ticks', '') ? Number(opt('max-ticks', '')) : undefined;
const pagesN = Math.max(1, Number(opt('pages', '1')));
const oneWay = args.includes('--one-way');
const limit = Number(opt('limit', '0'));
const traceEvery = Number(opt('trace', '0'));
const seedBase = Number(opt('seed-base', '9100'));
const overrides = {};
for (const kv of all('set')) {
  const [k, v] = kv.split('=');
  overrides[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
}
const git = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim(); } catch { return 'unknown'; } })();
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain']).toString().trim().length > 0; } catch { return false; } })();
const runId = opt('run', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const out = opt('out', `verify-out/duels/${runId}`);
mkdirSync(out, { recursive: true });

// ---- the jobs ----
let pairs = [];
const pairsArg = opt('pairs', 'all');
if (pairsArg === 'all') { for (const a of IDS) for (const b of IDS) if (a !== b) pairs.push([a, b]); }
else {
  for (const p of pairsArg.split(';')) {
    const [a, b] = p.split(',');
    if (!IDS.includes(a) || !IDS.includes(b)) throw new Error(`unknown fighter in pair "${p}"`);
    pairs.push([a, b]);
    if (!oneWay && a !== b && !pairs.some(([x, y]) => x === b && y === a)) pairs.push([b, a]);
  }
}
let jobs = [];
let n = 0;
for (let s = 0; s < seeds; s++) for (const [a, b] of pairs) {
  jobs.push({ a, b, seed: seedBase + s * 131 + IDS.indexOf(a) * 17 + IDS.indexOf(b), stage: stages[n++ % stages.length] });
}
if (limit > 0) jobs = jobs.slice(0, limit);
jobs.forEach((j, i) => { j.i = i; });
const header = { runId, git, dirty, url, seeds, seedBase, level: [aLevel, bLevel], personality, stages, maxTicks, overrides, pairs: pairs.length, jobs: jobs.length, started: new Date().toISOString() };
writeFileSync(`${out}/run.json`, JSON.stringify(header, null, 2));
console.log(`duel batch ${runId}: ${jobs.length} stock matches (${pairs.length} pairs x ${seeds} seeds), CPU ${aLevel}/${bLevel}, personality ${personality}, stages ${stages.join('+')}, ${pagesN} page(s), git ${git}${dirty ? '+dirty' : ''}${Object.keys(overrides).length ? `, overrides ${JSON.stringify(overrides)}` : ''}`);

// ---- the pages ----
const browser = await launchBrowser();
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
  await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ } });
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle', timeout: 90000 });
  await waitForConsoleApi(page);
  await page.waitForFunction(() => window.__duel && window.__game?.ctx?.versus, null, { timeout: 60000 });
  return page;
}

let next = 0, done = 0, failed = 0;
const t0 = Date.now();
async function worker() {
  let page = await openPage();
  for (;;) {
    const job = jobs[next++];
    if (!job) break;
    const side = (id, lvl) => ({ id, level: lvl, ...(personality !== 'fighter' ? { personality } : {}) });
    const spec = { a: side(job.a, aLevel), b: side(job.b, bLevel), seed: job.seed, stage: job.stage, overrides, ...(maxTicks ? { maxTicks } : {}), ...(traceEvery ? { traceEvery } : {}) };
    try {
      const r = await page.evaluate((s) => window.__duel.run(s), spec);
      appendFileSync(`${out}/duels.ndjson`, JSON.stringify({ i: job.i, ...r }) + '\n');
      done++;
      const w = r.winner === null ? 'draw' : r.sides[r.winner].id;
      console.log(`[${done + failed}/${jobs.length}] ${job.a} vs ${job.b} ${job.stage} s${job.seed}: ${w} ${r.sides[0].stocks}-${r.sides[1].stocks} (${r.reason}, ${(r.ticks / 60).toFixed(0)} s game, ${(r.ms / 1000).toFixed(1)} s wall)`);
    } catch (e) {
      failed++;
      console.log(`[${done + failed}/${jobs.length}] ${job.a} vs ${job.b} s${job.seed}: FAILED ${String(e).slice(0, 300)}`);
      appendFileSync(`${out}/errors.ndjson`, JSON.stringify({ i: job.i, ...job, error: String(e).slice(0, 500) }) + '\n');
      // a page that threw is not trusted: open a fresh one
      try { await page.close(); } catch { /* ignore */ }
      page = await openPage();
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: pagesN }, () => worker()));
await browser.close();
const secs = (Date.now() - t0) / 1000;
writeFileSync(`${out}/run.json`, JSON.stringify({ ...header, done, failed, wallSeconds: Math.round(secs), finished: new Date().toISOString() }, null, 2));
console.log(`\n${done} matches, ${failed} failed, ${secs.toFixed(0)} s wall (${(secs / Math.max(1, done)).toFixed(1)} s/match). Records in ${out}. Next: node scripts/duel-analyse.mjs ${out}`);
process.exit(failed > 0 && done === 0 ? 1 : 0);
