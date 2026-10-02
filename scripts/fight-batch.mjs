// THE FIGHT BATCH (docs/arena/TELEMETRY-AND-BALANCE.md 3.3): run a lot of duels between computer fighters in the real game, headless in the
// paused-step regime (nothing is rendered), and write one JSONL fight record each plus an index. `scripts/fight-analyse.mjs` reads them.
//
//   node scripts/fight-batch.mjs [url] [--pairs all | a,b;c,d] [--seeds 3] [--level 3] [--max-ticks 5400] [--pages 1]
//        [--out verify-out/fights/<run>] [--set path=value ...] [--one-way] [--sample-every 6] [--limit N] [--swap-spawns]
//        [--a-brain basic|dummy] [--b-brain basic|dummy] [--a-level 1-5] [--b-level 1-5]   (a dummy stands still: a target for a DPS measurement)
//
// --pairs all     every ordered pair of the ten (90): each pair runs both sides, so a fighter is never only on the left
// --pairs a,b;c,d the listed pairs (ids), both sides unless --one-way
// --set k=v       a parameter override for the whole batch (the path syntax of src/fighters/paramOverride: body.brann-rook.dealt=1.05)
// --pages N       N browser pages in parallel (each a full game: it is CPU-bound, so about one per physical core)
import { execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const all = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
const seeds = Number(opt('seeds', '3'));
const level = Number(opt('level', '3'));
const aBrain = opt('a-brain', 'basic'), bBrain = opt('b-brain', 'basic');
const aLevel = Number(opt('a-level', String(level))), bLevel = Number(opt('b-level', String(level)));
const maxTicks = Number(opt('max-ticks', '5400'));
const pagesN = Math.max(1, Number(opt('pages', '1')));
const sampleEvery = Number(opt('sample-every', '6'));
const oneWay = args.includes('--one-way');
const swapSpawns = args.includes('--swap-spawns');
const limit = Number(opt('limit', '0'));
const pairsArg = opt('pairs', 'all');
const overrides = {};
for (const kv of all('set')) {
  const [k, v] = kv.split('=');
  overrides[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
}
const git = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim(); } catch { return 'unknown'; } })();
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain']).toString().trim().length > 0; } catch { return false; } })();
const runId = opt('run', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const out = opt('out', `verify-out/fights/${runId}`);
mkdirSync(out, { recursive: true });

// ---- the jobs ----
let pairs = [];
if (pairsArg === 'all') { for (const a of IDS) for (const b of IDS) if (a !== b) pairs.push([a, b]); }
else {
  for (const p of pairsArg.split(';')) {
    const [a, b] = p.split(',');
    if (!IDS.includes(a) || !IDS.includes(b)) throw new Error(`unknown fighter in pair "${p}"`);
    pairs.push([a, b]);
    if (!oneWay && !pairs.some(([x, y]) => x === b && y === a)) pairs.push([b, a]);
  }
}
let jobs = [];
for (let s = 0; s < seeds; s++) for (const [a, b] of pairs) jobs.push({ a, b, seed: 7000 + s * 131 + IDS.indexOf(a) * 17 + IDS.indexOf(b) });
if (limit > 0) jobs = jobs.slice(0, limit);
jobs.forEach((j, i) => { j.i = i; });
writeFileSync(`${out}/run.json`, JSON.stringify({ runId, git, dirty, url, seeds, level, maxTicks, overrides, pairs: pairs.length, jobs: jobs.length, started: new Date().toISOString() }, null, 2));
console.log(`fight batch ${runId}: ${jobs.length} fights (${pairs.length} pairs x ${seeds} seeds), level ${level}, cap ${maxTicks} ticks, ${pagesN} page(s), git ${git}${dirty ? '+dirty' : ''}${Object.keys(overrides).length ? `, overrides ${JSON.stringify(overrides)}` : ''}`);

// ---- the pages ----
const browser = await launchBrowser();
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
  await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ } });
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle', timeout: 60000 });
  await leaveTitleIfShown(page);
  await waitForConsoleApi(page);
  await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-duel --world campaign-level'); });
  await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-duel' && window.__game.ctx.state.mode === 'play' && window.__fight, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelectorAll('#card-offer-overlay.visible').forEach((e) => e.classList.remove('visible')); });
  return page;
}

let next = 0, done = 0, failed = 0;
const t0 = Date.now();
async function worker(n) {
  const page = await openPage();
  for (;;) {
    const job = jobs[next++];
    if (!job) break;
    const spec = {
      a: { id: job.a, brain: aBrain, level: aLevel }, b: { id: job.b, brain: bBrain, level: bLevel },
      seed: job.seed, maxTicks, sampleEvery, overrides, runId, fight: job.i, git, dirty, swapSpawns,
    };
    try {
      const r = await page.evaluate((s) => window.__fight.run(s), spec);
      const file = `${String(job.i).padStart(4, '0')}-${job.a}-vs-${job.b}-s${job.seed}.jsonl`;
      writeFileSync(`${out}/${file}`, r.jsonl);
      appendFileSync(`${out}/index.jsonl`, JSON.stringify({ i: job.i, file, a: job.a, b: job.b, seed: job.seed, winner: r.winner, reason: r.reason, ticks: r.ticks, hp: r.hp.map((h) => Math.round(h)), ms: Math.round(r.ms), totals: r.totals }) + '\n');
      done++;
      const w = r.winner === null ? 'draw' : r.winner === 0 ? job.a : job.b;
      console.log(`[${done + failed}/${jobs.length}] ${job.a} vs ${job.b} s${job.seed}: ${w} (${r.reason}, ${(r.ticks / 60).toFixed(1)} s game, ${(r.ms / 1000).toFixed(1)} s wall)`);
    } catch (e) {
      failed++;
      console.log(`[${done + failed}/${jobs.length}] ${job.a} vs ${job.b} s${job.seed}: FAILED ${String(e).slice(0, 300)}`);
      appendFileSync(`${out}/index.jsonl`, JSON.stringify({ i: job.i, a: job.a, b: job.b, seed: job.seed, error: String(e).slice(0, 500) }) + '\n');
      // a page that threw is not trusted: open a fresh one
      try { await page.close(); } catch { /* ignore */ }
      return worker(n);
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: pagesN }, (_, n) => worker(n)));
await browser.close();
const secs = (Date.now() - t0) / 1000;
writeFileSync(`${out}/run.json`, JSON.stringify({ runId, git, dirty, url, seeds, level, maxTicks, overrides, pairs: pairs.length, jobs: jobs.length, done, failed, wallSeconds: Math.round(secs), finished: new Date().toISOString() }, null, 2));
console.log(`\n${done} fights, ${failed} failed, ${secs.toFixed(0)} s wall (${(secs / Math.max(1, done)).toFixed(1)} s/fight). Records in ${out}. Next: node scripts/fight-analyse.mjs ${out}`);
process.exit(failed > 0 && done === 0 ? 1 : 0);
