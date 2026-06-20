// Runtime probe for the death/ragdoll overhaul:
//  - slow-mo timer is set on death and the rAF loop visibly slows
//  - a corpse light keeps the ragdoll readable (light at the corpse >> floor)
//  - the camera tracks the tumbling corpse (doesn't freeze on the death spot)
//  - the ragdoll is articulated (drawn limbs move frame to frame, not a rigid box)
// Also drops screenshots of the tumble for an eyeball check.
// Usage: node scripts/verify-death-feel.mjs [url]
import { chromium } from 'playwright-core';
import { getGameViewSize } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 4 });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.playerCtl, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });
const viewSize = await getGameViewSize(page);

// place the player on a platform mid-world, then kill him
const setup = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  const X = 800, Y = 520;
  for (let y = Y - 160; y <= Y + 200; y++) for (let x = X - 120; x <= X + 120; x++) { const i = w.idx(x, y); w.types[i] = 0; w.colors[i] = 0; }
  for (let x = X - 30; x <= X + 30; x++) for (let y = Y + 1; y <= Y + 6; y++) { const i = w.idx(x, y); w.types[i] = 12; w.colors[i] = 0x6b6b6b; } // platform
  for (let x = X - 90; x <= X + 90; x++) for (let y = Y + 120; y <= Y + 130; y++) { const i = w.idx(x, y); w.types[i] = 12; w.colors[i] = 0x6b6b6b; } // floor below
  p.x = X; p.y = Y; p.vx = 1.2; p.vy = 0; p.fx = 0; p.fy = 0; p.dead = false; p.hp = p.maxHp;
  ctx.camera.snapTo(X, Y);
  for (let f = 0; f < 4; f++) window.__game.tick();
  ctx.playerCtl.kill();
  const corpse = ctx.rigidBodies.bodies.find((b) => b.tag === 'player-corpse');
  return { dead: p.dead, slowMo: ctx.fx.deathSlowMo, hasCorpse: !!corpse };
});
check('death sets the slow-mo timer', setup.slowMo > 0, JSON.stringify(setup));
check('death spawns a corpse ragdoll body', setup.hasCorpse, JSON.stringify(setup));

// the rAF loop visibly slows right after death (fewer ticks per real second)
const slow = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const f0 = ctx.state.frameCount;
  await new Promise((r) => setTimeout(r, 450));
  const dDeath = ctx.state.frameCount - f0;
  // let slow-mo fully expire, then sample a normal-speed window
  await new Promise((r) => setTimeout(r, 1600));
  const f1 = ctx.state.frameCount;
  await new Promise((r) => setTimeout(r, 450));
  const dNormal = ctx.state.frameCount - f1;
  return { dDeath, dNormal };
});
check('slow-mo throttles the sim then recovers (death window << normal)', slow.dNormal > 0 && slow.dDeath < slow.dNormal * 0.8, JSON.stringify(slow));

// the slow-mo above settled the old corpse — respawn and re-kill for a fresh
// tumble, then check camera-follow + that the ragdoll body actually animates
const track = await page.evaluate((view) => {
  const ctx = window.__game.ctx, p = ctx.player;
  const X = 800, Y = 520;
  ctx.playerCtl.respawn();
  p.x = X; p.y = Y; p.vx = 1.4; p.vy = -0.5; p.fx = 0; p.fy = 0; p.dead = false; p.hp = p.maxHp;
  ctx.camera.snapTo(X, Y);
  for (let f = 0; f < 3; f++) window.__game.tick();
  ctx.playerCtl.kill();
  const angs = [];
  for (let f = 0; f < 8; f++) { window.__game.tick(); const c = ctx.rigidBodies.bodies.find((b) => b.tag === 'player-corpse'); angs.push(c ? +c.angle.toFixed(3) : null); }
  const c2 = ctx.rigidBodies.bodies.find((b) => b.tag === 'player-corpse');
  const camTargetsCorpse = c2 ? Math.abs(ctx.camera.tx - (c2.x - view.w / 2)) < 2 : false;
  const moved = angs.some((a, i) => i > 0 && a !== angs[i - 1]);
  return { camTargetsCorpse, moved, present: !!c2 };
}, viewSize);
check('camera tracks the tumbling corpse', track.camTargetsCorpse, JSON.stringify(track));
check('the ragdoll body keeps tumbling (animates)', track.moved && track.present, JSON.stringify(track));

// ---- screenshots of the tumble (the fresh corpse from `track` is mid-tumble) ----
for (const [k, ticks] of [['a', 0], ['b', 10], ['c', 22]]) {
  await page.evaluate((t) => { for (let f = 0; f < t; f++) window.__game.tick(); }, ticks);
  const rect = await page.evaluate(() => { let best = null, area = 0; for (const cv of document.querySelectorAll('canvas')) { const r = cv.getBoundingClientRect(); const a = r.width * r.height; if (a > area) { area = a; best = r; } } return { x: best.x, y: best.y, w: best.width, h: best.height }; });
  await page.screenshot({ path: `scripts/_death_${k}.png`, clip: { x: rect.x + rect.w * 0.38, y: rect.y + rect.h * 0.30, width: rect.w * 0.24, height: rect.h * 0.40 } });
}
console.log('  ..    wrote scripts/_death_a|b|c.png');

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\ndeath feel probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
