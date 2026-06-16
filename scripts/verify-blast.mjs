// Verifies explosions eject nearby rigid bodies (and never crash Rapier by
// removing terrain colliders out from under a launched body).
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(800);

const out = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const blast = (radius) => {
    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.fx.hitstop = 0;
    w.clear();
    w.simBounds.x0 = 200; w.simBounds.y0 = 420; w.simBounds.x1 = 520; w.simBounds.y1 = 560;
    ctx.player.x = 250; ctx.player.y = 460; ctx.player.dead = true;
    ctx.rigidBodies.clear();
    for (let x = 220; x <= 500; x++) for (let y = 500; y <= 508; y++) { const i = w.idx(x, y); w.types[i] = 12; w.colors[i] = 0x777777; }
    const b = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, 360, 470, {});
    for (let f = 0; f < 110; f++) window.__game.tick();
    const x0 = b.x, y0 = b.y;
    ctx.explosions.trigger(Math.round(b.x + 8), Math.round(b.y), radius);
    for (let f = 0; f < 25; f++) {
      try { window.__game.tick(); } catch (e) { return { radius, crashed: true, error: String(e).slice(0, 80) }; }
    }
    return { radius, dist: +Math.hypot(b.x - x0, b.y - y0).toFixed(1) };
  };
  return { bomb: blast(52), spark: blast(14) };
});

check('bomb blast does not crash Rapier', !out.bomb.crashed, JSON.stringify(out.bomb));
check('bomb blast launches the crate hard (>40 cells)', out.bomb.dist > 40, JSON.stringify(out.bomb));
check('spark blast does not crash Rapier', !out.spark.crashed, JSON.stringify(out.spark));
check('spark blast gives a noticeable shove (>8 cells)', out.spark.dist > 8, JSON.stringify(out.spark));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nblast probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
