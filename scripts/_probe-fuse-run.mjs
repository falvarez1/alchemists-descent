// THE FUSE RUN, end to end in the real game: ignite the stake end of the
// gasworks powder trestle and assert the fire races the line and detonates
// the barrel pit. Run with the dev server up.
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

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.levels.leaveLevel();
  ctx.levels.enterLevel(ctx, 'gas-test');
});
await page.waitForTimeout(1200);

const state = () =>
  page.evaluate(() => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const FLOOR = 640;
    let powder = 0;
    for (let y = FLOOR - 10; y <= FLOOR + 7; y++)
      for (let x = 375; x <= 600; x++) if (w.types[w.idx(x, y)] === 8) powder++;
    return { powder, bodies: ctx.rigidBodies.list?.length ?? ctx.rigidBodies.bodies?.length ?? -1 };
  });

const before = await state();
check('powder line + keg cone staged', before.powder > 300, `powder=${before.powder}`);

// stand the wizard clear of the blast and touch LAVA to the stake base (a
// painted Fire cell has life 0 and dies before it spreads)
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  ctx.player.x = 220;
  ctx.player.y = 638;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.camera.snapTo(460, 560);
  const i = w.idx(371, 639);
  w.types[i] = 11;
  w.colors[i] = 0xfa4600;
});
// the line burns at ~25 cells/sec — poll up to 14s for the full chain
let after = await state();
for (let t = 0; t < 14 && !(after.powder < before.powder * 0.15 && after.bodies < before.bodies); t++) {
  await page.waitForTimeout(1000);
  after = await state();
}
check('the fire raced the powder line', after.powder < before.powder * 0.15, `powder ${before.powder} -> ${after.powder}`);
check('the keg cone detonated the barrel pit', after.bodies < before.bodies, `bodies ${before.bodies} -> ${after.bodies}`);
check('no page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 300));
console.log(`\n${pass} ok, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
