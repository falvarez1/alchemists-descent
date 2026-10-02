// THE LOADOUT LAB (docs/arena/MOVESETS-V2.md 6a): try candidate signature loadouts against a standing target (and optionally a fighting
// one) and print how fast each kills. A loadout is data (content/fighterLoadouts); this is how its numbers get chosen: by measurement.
//
//   node scripts/loadout-lab.mjs [url] --candidates file.json [--target nox-calder] [--seeds 5] [--vs basic]
//
// file.json: [ { "id": "rusk-emberjaw", "name": "bomb", "wands": [ {"frameId":"brass","cards":["loosecannon","bomb",null,null,null]}, {"frameId":"bone","cards":[null,null,null,null]} ] }, ... ]
//   --vs dummy (default): the target stands still. --vs basic: the target is a level-3 bot and fights back (the candidate's win rate is shown too).
import { readFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const candidates = JSON.parse(readFileSync(opt('candidates', 'candidates.json'), 'utf8'));
const target = opt('target', 'nox-calder');
const seeds = Number(opt('seeds', '5'));
const vs = opt('vs', 'dummy');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle', timeout: 60000 });
await leaveTitleIfShown(page);
await waitForConsoleApi(page);
await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-duel --world campaign-level'); });
await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-duel' && window.__game.ctx.state.mode === 'play' && window.__fight, null, { timeout: 60000 });
await page.waitForTimeout(1500);

for (const c of candidates) {
  const rows = [];
  for (let s = 0; s < seeds; s++) {
    const spec = {
      a: { id: c.id, brain: 'basic', level: 5 }, b: { id: target, brain: vs === 'dummy' ? 'dummy' : 'basic', level: 3 },
      seed: 9000 + s * 53, maxTicks: 3600, sampleEvery: 6, loadouts: { [c.id]: { wands: c.wands, ...(c.flasks ? { flasks: c.flasks } : {}) } },
    };
    const r = await page.evaluate((sp) => window.__fight.run(sp), spec);
    const t = r.totals;
    rows.push({ win: r.winner === 0, secs: r.ticks / 60, dealt: Object.values(t.taken).reduce((x, y) => x + y, 0), taken: r.hp[0] });
  }
  const med = (a) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)] ?? 0; };
  const wins = rows.filter((r) => r.win).length;
  console.log(`${c.id.padEnd(14)} ${String(c.name ?? '').padEnd(18)} ${wins}/${rows.length} won  median ${med(rows.map((r) => r.secs)).toFixed(1).padStart(5)} s  target took ${med(rows.map((r) => r.dealt)).toFixed(0).padStart(4)}  left hp ${med(rows.map((r) => r.taken)).toFixed(0).padStart(4)}   ${JSON.stringify(c.wands[0].cards.filter(Boolean))} @${c.wands[0].frameId}`);
}
await browser.close();
