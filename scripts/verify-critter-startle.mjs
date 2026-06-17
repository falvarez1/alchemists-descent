// Ambient critters must REACT when force-pushed: the kick's gust startles them so
// they scatter/flee instead of their AI instantly damping the shove. A grounded
// beetle (which used to re-plant its crawl speed every frame and ignore the push)
// must now get blown away. Usage: node scripts/verify-critter-startle.mjs [url]
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
await page.waitForFunction(() => window.__game?.ctx?.critters, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 20; f++) window.__game.tick();
  const w = ctx.world, p = ctx.player, CR = ctx.critters;

  const arena = () => {
    ctx.state.mode = 'play'; ctx.state.paused = false; ctx.fx.hitstop = 0;
    CR.clear();
    for (let y = 640; y <= 700; y++) for (let x = 300; x <= 420; x++) w.clearCellAt(w.idx(x, y));
    for (let x = 300; x <= 420; x++) { const i = w.idx(x, 670); w.types[i] = 12; w.colors[i] = 0x777777; } // floor
    p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false;
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  };
  const kick = () => { ctx.playerCtl.kickCooldownT = 0; p.aimAngle = 0; ctx.playerCtl.kick(ctx); };

  // ---- BEETLE on the ground: used to ignore the push entirely ---------------
  arena();
  p.x = 330; p.y = 669; p.vx = 0; p.vy = 0; p.grounded = true;
  CR.list.push({ kind: 'beetle', x: 344, y: 669, vx: 0, vy: 0, phase: 0, gasp: 0, facing: -1 });
  const beetle = CR.list[CR.list.length - 1];
  const bx0 = beetle.x;
  kick();
  const beetleStartled = (beetle.startle ?? 0) > 0;
  let bMax = beetle.x;
  for (let f = 0; f < 24; f++) { window.__game.tick(); if (CR.list.includes(beetle)) bMax = Math.max(bMax, beetle.x); }
  const beetlePushed = bMax - bx0;

  // ---- MOTH in the air: scatters and travels --------------------------------
  arena();
  p.x = 330; p.y = 655; p.vx = 0; p.vy = 0;
  CR.list.push({ kind: 'moth', x: 345, y: 650, vx: 0, vy: 0, phase: 0, gasp: 0, facing: 1 });
  const moth = CR.list[CR.list.length - 1];
  const mx0 = moth.x;
  kick();
  const mothStartled = (moth.startle ?? 0) > 0;
  let mMax = moth.x;
  for (let f = 0; f < 20; f++) { window.__game.tick(); if (CR.list.includes(moth)) mMax = Math.max(mMax, moth.x); }
  const mothTravel = mMax - mx0;

  return {
    beetleStartled, beetlePushed: +beetlePushed.toFixed(1),
    mothStartled, mothTravel: +mothTravel.toFixed(1),
  };
});

console.log('  ' + JSON.stringify(r));
check('beetle is startled by the kick gust', r.beetleStartled, JSON.stringify(r));
check('grounded beetle is blown away (no longer ignores the push)', r.beetlePushed > 5, JSON.stringify(r));
check('moth is startled by the kick gust', r.mothStartled, JSON.stringify(r));
check('moth scatters/travels away from the wizard', r.mothTravel > 5, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\ncritter-startle probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
