// Runtime probe for dive-stomp: (1) a dive that lands on a crate no longer
// latches diveT (jump/levitation work again), (2) stomping a destructible crate
// smashes it and bounces, a tough one just clangs, (3) a dive-stomp kills a
// stompable foe and bounces, but a plain fall does NOT, (4) the run-speed cap.
// Usage: node scripts/verify-stomp.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.physics, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// dive onto a fresh crate of `material`; report whether it was destroyed + the dive cleared
const crateStomp = (material) => page.evaluate((material) => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for (let y = 655; y <= 706; y++) for (let x = 520; x <= 600; x++) { const i = w.idx(x, y); w.types[i] = y >= 700 ? 12 : 0; w.colors[i] = y >= 700 ? 0x6b6b6b : 0; }
  const crate = ctx.rigidBodies.spawn({ kind: 'box', halfW: 4, halfH: 4 }, 560, 694, { material });
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  for (let f = 0; f < 6; f++) window.__game.tick(); // settle the crate on the floor
  const present0 = ctx.rigidBodies.bodies.includes(crate);
  const top = crate.y - 4;
  p.x = crate.x; p.y = top - 25; p.vx = 0; p.vy = 5; p.fx = 0; p.fy = 0;
  p.dead = false; p.crawling = false; p.climbing = false; p.inLiquid = false; p.grounded = false;
  p.diveT = 1; // a committed dive (as if S were pressed mid-air)
  let bounced = false;
  for (let f = 0; f < 26; f++) { window.__game.tick(); if (p.vy < -0.2) bounced = true; }
  return { present0, gone: !ctx.rigidBodies.bodies.includes(crate), diveT: p.diveT, bounced };
}, material);

const wood = await crateStomp('wood');
console.log(`  ..    wood crate stomp: ${JSON.stringify(wood)}`);
check('the dive clears on landing a crate (no more diveT lock-up)', wood.present0 && wood.diveT === 0, JSON.stringify(wood));
check('stomping a destructible (wood) crate smashes it', wood.gone, JSON.stringify(wood));
check('stomping a destructible crate bounces the player off', wood.bounced, JSON.stringify(wood));

const metal = await crateStomp('metal');
console.log(`  ..    metal crate stomp: ${JSON.stringify(metal)}`);
check('a tough (metal) crate is NOT destroyed by a stomp', metal.present0 && !metal.gone, JSON.stringify(metal));
check('but the dive still clears on the tough crate (bug fix)', metal.diveT === 0, JSON.stringify(metal));

// dive onto a slime (diving) vs fall onto it (not diving)
const enemyResult = (diving) => page.evaluate((diving) => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for (let y = 655; y <= 706; y++) for (let x = 520; x <= 600; x++) { const i = w.idx(x, y); w.types[i] = y >= 700 ? 12 : 0; w.colors[i] = y >= 700 ? 0x6b6b6b : 0; }
  ctx.enemies.length = 0;
  ctx.enemyCtl.spawn('slime', 560, 699);
  const e = ctx.enemies[0];
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  const crown = e.y - ctx.enemyCtl.defs.slime.h;
  p.x = e.x; p.y = crown - 22; p.vx = 0; p.vy = 5; p.fx = 0; p.fy = 0;
  p.dead = false; p.crawling = false; p.climbing = false; p.inLiquid = false; p.grounded = false;
  p.diveT = diving ? 1 : 0;
  let bounced = false;
  for (let f = 0; f < 24; f++) { window.__game.tick(); if (p.vy < -0.2) bounced = true; }
  return { killed: !ctx.enemies.includes(e), bounced };
}, diving);

const stomp = await enemyResult(true);
console.log(`  ..    enemy dive-stomp: ${JSON.stringify(stomp)}`);
check('a dive-stomp kills a stompable foe', stomp.killed, JSON.stringify(stomp));
check('a dive-stomp bounces the player off the kill', stomp.bounced, JSON.stringify(stomp));

const fall = await enemyResult(false);
console.log(`  ..    plain fall onto foe: ${JSON.stringify(fall)}`);
check('a plain fall (no dive) does NOT stomp-kill the foe', !fall.killed, JSON.stringify(fall));

// run-speed cap: max capabilities still obey the precision ceiling
const cap = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for (let y = 690; y <= 706; y++) for (let x = 400; x <= 740; x++) { const i = w.idx(x, y); w.types[i] = y >= 700 ? 12 : 0; w.colors[i] = y >= 700 ? 0x6b6b6b : 0; }
  p.x = 540; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; p.diveT = 0; p.crawling = false; p.climbing = false;
  p.status.swift = 600; p.perks.swiftfoot = true; // speedK 1.77 -> uncapped maxRun would be ~4.6
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  for (let f = 0; f < 4; f++) window.__game.tick();
  ctx.input.keys.right = true;
  let peak = 0;
  for (let f = 0; f < 40; f++) { window.__game.tick(); if (Math.abs(p.vx) > peak) peak = Math.abs(p.vx); }
  ctx.input.keys.right = false;
  return { vx: +peak.toFixed(2) };
});
console.log(`  ..    god-mode top speed: vx=${cap.vx} (base 2.6, cap 3.6, uncapped would be ~4.6)`);
check('speed buffs still feel faster than base (vx > 2.7)', cap.vx > 2.7, JSON.stringify(cap));
check('but the top speed is capped for control (vx <= 3.7)', cap.vx <= 3.7, JSON.stringify(cap));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\nstomp probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
