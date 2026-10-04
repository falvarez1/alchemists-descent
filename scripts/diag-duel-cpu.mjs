// DIAG: two CPU seats in the stock Duel, exactly as the lobby installs them (no seed, default personalities), stepped
// paused. Prints how often they cross over each other, how much of the fight is spent airborne, what hits, and dumps a
// per-tick trace for reading. node scripts/diag-duel-cpu.mjs [url] [--a ilyra-voss] [--b brann-rook] [--level 3]
//   [--ticks 3600] [--stage foundry] [--seed 11]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://127.0.0.1:5231/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const A = opt('a', 'ilyra-voss'), B = opt('b', 'brann-rook'), level = Number(opt('level', '3'));
const ticks = Number(opt('ticks', '3600')), stage = opt('stage', 'foundry'), seed = Number(opt('seed', '11'));
const out = 'verify-out/duel-cpu';
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.locator('[data-entry="duel"]').click();
  await page.waitForFunction(() => window.__game.ctx.versus?.phase === 'lobby');
  await page.evaluate(({ A, B, level, stage, seed }) => {
    const c = window.__game.ctx, v = c.versus;
    c.state.worldSeed = seed;
    v.chooseDevice(0, 'cpu'); v.chooseDevice(1, 'cpu');
    v.chooseFighter(0, A); v.chooseFighter(1, B);
    v.chooseDifficulty(0, level); v.chooseDifficulty(1, level);
    v.chooseStage(stage);
    void v.start(); v.skipIntro();
  }, { A, B, level, stage, seed });
  await page.waitForFunction(() => window.__game.ctx.versus?.phase === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => { window.__game.ctx.state.paused = true; });
  const result = await page.evaluate(async (ticks) => {
    const g = window.__game, c = g.ctx, a = c.arena;
    const trace = [], hits = [], downs = [];
    const offHit = c.events.on('fighterHit', h => hits.push({ t: c.state.frameCount, by: h.by, victim: h.victim, attack: h.attack, damage: +(h.damage ?? 0).toFixed(1) }));
    const offDown = c.events.on('fighterDown', d => downs.push({ t: c.state.frameCount, slot: d.slot, by: d.by }));
    let lastSide = 0, crossings = 0, airCross = 0;
    const air = [0, 0], jumps = [0, 0], wasGround = [true, true], kinds = [{}, {}];
    let fighting = 0, close = 0, dist = 0;
    const hopLog = [], lastHops = [0, 0], lastAtk = [0, 0];
    for (let i = 0; i < ticks && a.stockMatch.state !== 'finished'; i++) {
      g.tick(false, { forcePaused: true });
      if (a.stockMatch.state !== 'fighting') continue;
      const p = [0, 1].map(s => a.bundle(s).player);
      if (p[0].dead || p[1].dead) { lastSide = 0; continue; }
      fighting++;
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); dist += d; if (d < 40) close++;
      const side = Math.sign(p[1].x - p[0].x);
      if (side && lastSide && side !== lastSide) { crossings++; if (!p[0].grounded || !p[1].grounded) airCross++; }
      if (side) lastSide = side;
      const status = (await c.console.exec('arena status')).data.bots;
      for (const s of [0, 1]) {
        const hopsNow = status[s]?.stats.hops ?? 0;
        if (hopsNow > (lastHops[s] ?? 0)) {
          // what is in front: the cell types in the body box 5 cells ahead, lowest blocking row
          const b = a.bundle(s), dir = Number(b.input.keys.right) - Number(b.input.keys.left) || p[s].facing;
          const types = {};
          for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy < 20; dy++) {
            const X = Math.round(p[s].x + dir * 5 + dx), Y = Math.round(p[s].y - dy);
            if (c.physics.cellBlocks(X, Y)) { const t = c.world.types[X + Y * 1600]; types[t] = (types[t] ?? 0) + 1; }
          }
          const fire = {};
          for (let dx = -4; dx <= 40; dx++) for (let dy = -3; dy < 17; dy++) {
            const X = Math.round(p[s].x + dir * dx), Y = Math.round(p[s].y - dy), t = c.world.types[X + Y * 1600];
            if (t === 5 || t === 7 || t === 11 || t === 20) fire[t] = (fire[t] ?? 0) + 1;
          }
          hopLog.push({ t: c.state.frameCount, s, x: Math.round(p[s].x), dir, blocking: types, hazardsAhead: fire, rule: status[s]?.rule,
            hazardHops: status[s]?.stats.hazardHops, foeX: Math.round(p[1 - s].x) });
        }
        lastHops[s] = hopsNow;
        if (!p[s].grounded) air[s]++;
        if (wasGround[s] && !p[s].grounded && p[s].vy < -1 && p[s].stunT <= 0) jumps[s]++; // a jump, not a launch
        wasGround[s] = p[s].grounded;
        const atk = a.stockAttack(s);
        if (atk?.busy && atk.id !== lastAtk[s]) { kinds[s][atk.kind] = (kinds[s][atk.kind] ?? 0) + 1; lastAtk[s] = atk.id; }
      }
      if (i % 2 === 0) trace.push({ t: c.state.frameCount, p: [0, 1].map(s => {
        const b = a.bundle(s), k = b.input.keys, bot = status[s];
        return { x: Math.round(p[s].x), y: Math.round(p[s].y), vx: +p[s].vx.toFixed(1), vy: +p[s].vy.toFixed(1), g: p[s].grounded ? 1 : 0,
          fuel: Math.round(p[s].levit), keys: `${k.left ? 'L' : ''}${k.right ? 'R' : ''}${k.jump ? 'J' : ''}${k.up ? 'U' : ''}${k.down ? 'D' : ''}`,
          face: p[s].facing, intent: bot?.intent, rule: bot?.rule, action: bot?.action, goal: bot?.goalX == null ? null : Math.round(bot.goalX),
          hops: bot?.stats.hops, dodges: bot?.stats.dodges, stuck: bot?.stats.stuck, edges: bot?.stats.edges, hz: bot?.stats.hazardHops, atk: a.stockAttack(s)?.busy ? `${a.stockAttack(s).kind}:${a.stockAttack(s).phase}` : '', stun: p[s].stunT, pct: +(a.stockMatch.fighters[s].volatility ?? 0).toFixed(0) };
      }) });
    }
    offHit(); offDown();
    const bots = (await c.console.exec('arena status')).data.bots;
    return { hopLog, fighting, crossings, airCross, air, jumps, kinds, close, meanDist: dist / Math.max(1, fighting), hits, downs,
      state: a.stockMatch.state, fighters: a.stockMatch.fighters, stats: bots.map(b => b?.stats), personality: bots.map(b => b?.personality), trace };
  }, ticks);
  const perMin = (n) => +(n / Math.max(1, result.fighting) * 3600).toFixed(1);
  const summary = {
    A, B, level, stage, seed, fightingTicks: result.fighting, state: result.state,
    crossingsPerMin: perMin(result.crossings), airCrossingsPerMin: perMin(result.airCross),
    airShare: result.air.map(n => +(n / Math.max(1, result.fighting)).toFixed(2)), jumpsPerMin: result.jumps.map(perMin),
    closeShare: +(result.close / Math.max(1, result.fighting)).toFixed(2), meanDist: Math.round(result.meanDist),
    attacks: result.kinds, hits: result.hits.length, hitsBy: [0, 1].map(s => result.hits.filter(h => h.by === s).length),
    hitKinds: result.hits.reduce((m, h) => (m[h.attack] = (m[h.attack] ?? 0) + 1, m), {}),
    downs: result.downs, stocks: result.fighters.map(f => f.stocks), personality: result.personality, errors,
  };
  console.log(JSON.stringify(summary, null, 1));
  writeFileSync(`${out}/${A}-${B}-${seed}.json`, JSON.stringify({ summary, hopLog: result.hopLog, stats: result.stats, hits: result.hits, trace: result.trace }, null, 1));
} finally { await browser.close(); }
