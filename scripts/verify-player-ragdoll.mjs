// #4 Player death ragdoll, in the PHYSICS TEST ARENA:
//  - on death a 'player-corpse' rigid body spawns and is flung
//  - the game-over overlay is DEFERRED (not shown the instant you die)
//  - the corpse tumbles, settles, marks data.settled → overlay reveals
//  - respawn removes the corpse
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
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const tick = (n) => { for (let f = 0; f < n; f++) window.__game.tick(); };
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  tick(20);
  const rb = ctx.rigidBodies;
  const p = ctx.player;
  const overlayVisible = () => document.getElementById('gameover-overlay')?.classList.contains('visible') ?? false;
  const corpseOf = () => rb.bodies.find((b) => b.tag === 'player-corpse');

  // stand on the floor with some rightward momentum, then die
  p.dead = false; p.x = 835; p.y = 599; p.vx = 3; p.vy = 0; p.fx = 0; p.fy = 0;
  tick(2);
  ctx.playerCtl.kill();

  const c0 = corpseOf();
  const spawned = !!c0;
  const deadFlag = p.dead === true;
  const overlayAtDeath = overlayVisible(); // should be FALSE (deferred)
  const cx0 = c0 ? c0.x : 0, cy0 = c0 ? c0.y : 0;
  tick(12);
  const flung = c0 ? Math.abs(c0.x - cx0) + Math.abs(c0.y - cy0) : 0;

  tick(265); // let it tumble + settle (or hit the timeout)
  const c1 = corpseOf();
  const settled = c1 ? c1.data?.settled === true : false;
  const overlayAfterSettle = overlayVisible(); // should be TRUE now

  ctx.playerCtl.respawn();
  const corpseGone = !corpseOf();
  const aliveAgain = p.dead === false;

  return { spawned, deadFlag, overlayAtDeath, flung: +flung.toFixed(2), settled, overlayAfterSettle, corpseGone, aliveAgain };
});

check('death spawns a player-corpse ragdoll body', r.spawned, JSON.stringify(r));
check('player is marked dead', r.deadFlag, JSON.stringify(r));
check('game-over overlay is DEFERRED (not shown at the instant of death)', r.overlayAtDeath === false, JSON.stringify(r));
check('the corpse is flung / falls', r.flung > 2, JSON.stringify(r));
check('the corpse settles (data.settled)', r.settled, JSON.stringify(r));
check('overlay reveals once the corpse settles', r.overlayAfterSettle, JSON.stringify(r));
check('respawn removes the corpse', r.corpseGone, JSON.stringify(r));
check('respawn revives the player', r.aliveAgain, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nplayer-ragdoll probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
