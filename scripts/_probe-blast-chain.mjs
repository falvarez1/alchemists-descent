// Chained-detonation probe: bombers clustered with slimes, set off by an AoE.
// The old explosion entity-loop indexed the live enemies array while nested
// bomber-death blasts swap-removed from it — this crashed the tick. Asserts
// the chain resolves with no page errors and every enemy accounted for.
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};
const pageErrors = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { settleMs: 400 });

const result = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 400; y <= 560; y++)
    for (let x = 480; x <= 900; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  for (let y = 520; y <= 540; y++)
    for (let x = 480; x <= 900; x++) {
      const i = w.idx(x, y);
      w.types[i] = 13; w.colors[i] = 0x7a8a99;
    }
  ctx.enemies.length = 0;
  ctx.pickups.length = 0;
  const p = ctx.player;
  p.hp = p.maxHp = 1e6;
  p.x = 850; p.y = 518; p.vx = 0; p.vy = 0;
  ctx.camera.snapTo(700, 470);
  // a tight cluster: bombers between slimes so nested blasts overlap victims
  const spawned = [];
  for (const [kind, x] of [
    ['slime', 600], ['bomber', 608], ['slime', 616], ['bomber', 624],
    ['slime', 632], ['bomber', 640], ['slime', 648],
  ]) {
    const e = ctx.enemyCtl.spawn(kind, x, 518);
    if (e) { e.alerted = true; spawned.push(kind); }
  }
  const before = ctx.enemies.length;
  // one central AoE catches the whole cluster -> bomber deaths chain nested blasts
  ctx.explosions.trigger(624, 512, 26);
  return { before, after: ctx.enemies.length, spawned: spawned.length };
});
await page.waitForTimeout(1200);
const post = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return {
    enemies: ctx.enemies.length,
    anyUndefined: ctx.enemies.some((e) => !e),
    frame: ctx.state.frameCount,
  };
});
await page.waitForTimeout(500);
const post2 = await page.evaluate(() => window.__game.ctx.state.frameCount);

check('cluster spawned', result.spawned === 7, `spawned=${result.spawned}`);
check('chain reduced the cluster', result.after < result.before, `${result.before} -> ${result.after}`);
check('no undefined holes in the enemies array', !post.anyUndefined, '');
check('the tick loop is still running', post2 > post.frame, `${post.frame} -> ${post2}`);
check('no page errors during the chain', pageErrors.length === 0, pageErrors.join('; '));

console.log(`\n${pass} ok, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
