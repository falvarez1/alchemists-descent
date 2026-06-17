// The kick must self-recoil the wizard CONSISTENTLY whether grounded or airborne
// (levitating) — a base push-off always applies, like wand recoil, even into open air.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5219/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 20; f++) window.__game.tick();
  const p = ctx.player;
  ctx.rigidBodies.clear();
  const place = (x, y) => { p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; ctx.playerCtl.kickCooldownT = 0; };
  // kick instantly (no tick between aim + kick, or the mouse overwrites aim)
  const kickRight = () => { p.aimAngle = 0; ctx.playerCtl.kick(ctx); return p.vx; };

  // AIRBORNE in open air (no bodies, no terrain in the cone): kick right → shove left
  place(300, 600);
  const airRecoil = kickRight();

  // GROUNDED in the open (same, on the floor): also recoils
  place(300, 699);
  const floorRecoil = kickRight();

  return { airRecoil: +airRecoil.toFixed(2), floorRecoil: +floorRecoil.toFixed(2) };
});

let pass = 0, fail = 0;
const check = (n, ok, d='') => { if (ok) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' ' + d); } };
check('airborne (levitating) kick into open air recoils the wizard', r.airRecoil < -0.8, JSON.stringify(r));
check('grounded kick into open air also recoils (consistent)', r.floorRecoil < -0.8, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\nair-kick probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
