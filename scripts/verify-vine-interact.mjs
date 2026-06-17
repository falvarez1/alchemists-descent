// Hanging vines should visibly MOVE when the player interacts: moving/levitating
// through them (pushFromPlayer), the kick gust, and explosion blast waves.
// Usage: node scripts/verify-vine-interact.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + ' ' + d); } };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.vineStrands, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 20; f++) window.__game.tick();
  const w = ctx.world;
  const p = ctx.player;
  const VS = ctx.vineStrands;

  const setup = () => {
    ctx.state.mode = 'play'; ctx.state.paused = false; ctx.fx.hitstop = 0;
    VS.clear();
    // clear an open shaft and pin a hanging rope from a solid ceiling
    for (let y = 600; y <= 680; y++) for (let x = 480; x <= 540; x++) w.clearCellAt(w.idx(x, y));
    for (let x = 506; x <= 514; x++) { const i = w.idx(x, 598); w.types[i] = 12; w.colors[i] = 0x777777; } // ceiling
    VS.addHanging(510, 599, 40, { thickness: 2 });
    p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false;
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  };
  const restXs = () => VS.strands[0].nodes.map((n) => n.x);
  // max deflection of ANY node from its rest position = "does the vine visibly move"
  const maxDeflectFrom = (rest) => { let m = 0; const ns = VS.strands[0].nodes; for (let i = 0; i < ns.length; i++) m = Math.max(m, Math.abs(ns[i].x - rest[i])); return m; };

  // ---- LEVITATE THROUGH: hover at rope-mid height and cross it --------------
  setup();
  p.x = 470; p.y = 620; p.vx = 0; p.vy = 0; // off to the side, at rope-mid height
  for (let f = 0; f < 40; f++) { p.y = 620; p.vy = 0; window.__game.tick(); }
  const restA = restXs(); // rope hangs ~straight under the anchor (510.5)
  let maxDeflect = 0;
  for (let f = 0; f < 60; f++) {
    p.x = 498 + Math.min(f, 24); // levitate across the rope column
    p.y = 620; p.vx = 1.0; p.vy = 0; // hover (no fall) — what levitation does
    window.__game.tick();
    maxDeflect = Math.max(maxDeflect, maxDeflectFrom(restA));
  }
  const levitateDeflect = +maxDeflect.toFixed(2);

  // ---- KICK GUST near the rope ---------------------------------------------
  setup();
  p.x = 498; p.y = 632; p.vx = 0; p.vy = 0; p.aimAngle = 0;
  for (let f = 0; f < 30; f++) window.__game.tick();
  const restK = restXs();
  ctx.playerCtl.kickCooldownT = 0; ctx.playerCtl.kick(ctx);
  let kMax = 0;
  for (let f = 0; f < 10; f++) { window.__game.tick(); kMax = Math.max(kMax, maxDeflectFrom(restK)); }
  const kickDeflect = +kMax.toFixed(2);

  // ---- EXPLOSION blast wave near the rope -----------------------------------
  setup();
  p.x = 470; p.y = 640;
  for (let f = 0; f < 30; f++) window.__game.tick();
  const restE = restXs();
  ctx.explosions.trigger(495, 640, 20);
  let eMax = 0;
  for (let f = 0; f < 12; f++) { window.__game.tick(); eMax = Math.max(eMax, maxDeflectFrom(restE)); }
  const blastDeflect = +eMax.toFixed(2);

  return { levitateDeflect, kickDeflect, blastDeflect };
});

console.log('  ' + JSON.stringify(r));
check('vine deflects when the player moves through it', r.levitateDeflect > 1.5, JSON.stringify(r));
check('vine bends in the kick gust', r.kickDeflect > 1.5, JSON.stringify(r));
check('vine swings in an explosion blast wave', r.blastDeflect > 1.5, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nvine-interact probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
