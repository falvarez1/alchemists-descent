// Telekinesis (E): lift the crate the MOUSE CURSOR is on → it levitates and tracks
// the hand; E again drops it, F throws it; works at range on ANY crate.
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
  for (let f = 0; f < 30; f++) window.__game.tick();
  const rb = ctx.rigidBodies;
  const p = ctx.player;
  const tick = (n) => { for (let f = 0; f < n; f++) window.__game.tick(); };
  const placePlayer = () => { p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false; p.x = 300; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; };
  const aimAt = (b) => { ctx.input.mouse.x = b.x; ctx.input.mouse.y = b.y; };
  const crate = (x, half = 3.5, material = 'wood') => rb.spawn({ kind: 'box', halfW: half, halfH: half }, x, 695, { material, friction: 0.6, restitution: 0.15 });

  // 1) GRAB AT CURSOR → LEVITATE
  rb.clear(); placePlayer();
  let c = crate(352); tick(30);
  const restY = c.y;
  aimAt(c); tick(1);
  const grabbed = rb.grabAtCursor(ctx);
  const holding = rb.isHolding();
  tick(16);
  const levitY = c.y;                 // lifted to the hand point (off the floor)
  const levitated = levitY < restY - 3 && c.x < 352; // pulled up AND toward the wizard

  // 2) DROP (E again) → it falls
  rb.release(ctx, false);
  const holdingAfterDrop = rb.isHolding();
  const dropY0 = c.y; tick(22);
  const fell = c.y > dropY0 + 3;

  // 3) THROW (F while holding) → flies far along the aim
  rb.clear(); placePlayer();
  c = crate(330); tick(30);
  aimAt(c); tick(1);                        // cursor ON the crate → grab it
  rb.grabAtCursor(ctx); tick(8);
  aimAt({ x: p.x + 60, y: p.y - 8 }); tick(2); // now aim far right for the throw
  const tx0 = c.x;
  rb.release(ctx, true);                    // F → throw
  tick(10);
  const thrown = c.x - tx0 > 18;

  // 4) ANY crate — a heavy large-metal lifts too
  rb.clear(); placePlayer();
  const heavy = crate(345, 6, 'metal'); tick(30);
  aimAt(heavy); tick(1);
  const heavyGrabbed = rb.grabAtCursor(ctx);
  rb.release(ctx, false);

  // 5) out of telekinesis reach → no grab
  rb.clear(); placePlayer();
  const far = crate(560); tick(30);
  aimAt(far); tick(1);
  const farGrabbed = rb.grabAtCursor(ctx);
  rb.release(ctx, false);

  return { grabbed, holding, restY: +restY.toFixed(1), levitY: +levitY.toFixed(1), levitated, holdingAfterDrop, fell, thrown, heavyGrabbed, farGrabbed };
});

// --- real E-KEY toggle (input wiring): press E with the cursor on a crate → grab; E again → drop ---
await page.evaluate(() => {
  const ctx = window.__game.ctx, rb = ctx.rigidBodies, p = ctx.player;
  rb.clear();
  p.dead = false; p.crawling = false; p.climbing = false; p.x = 300; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  const c = rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, 350, 695, { material: 'wood' });
  for (let f = 0; f < 30; f++) window.__game.tick();
  ctx.input.mouse.x = c.x; ctx.input.mouse.y = c.y; // cursor on the crate (world coords)
});
await page.keyboard.press('e'); // E → grab the crate under the cursor
const eGrab = await page.evaluate(() => { for (let f = 0; f < 6; f++) window.__game.tick(); return window.__game.ctx.rigidBodies.isHolding(); });
await page.keyboard.press('e'); // E again → drop
const eDrop = await page.evaluate(() => { window.__game.tick(); return window.__game.ctx.rigidBodies.isHolding(); });

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' ' + d); } };
console.log('  ' + JSON.stringify(r) + ' eGrab=' + eGrab + ' eDrop=' + eDrop);
check('E key grabs the crate under the cursor', eGrab, '');
check('E key again drops it', !eDrop, '');
check('cursor-grab lifts the crate (grabAtCursor + isHolding)', r.grabbed && r.holding, JSON.stringify(r));
check('held crate LEVITATES to the hand (off the floor)', r.levitated, JSON.stringify(r));
check('E again DROPS it (isHolding false → it falls)', !r.holdingAfterDrop && r.fell, JSON.stringify(r));
check('F THROWS the held crate far along the aim', r.thrown, JSON.stringify(r));
check('telekinesis lifts ANY crate (heavy large-metal)', r.heavyGrabbed, JSON.stringify(r));
check('a crate out of reach is NOT grabbed', r.farGrabbed === false, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\ntelekinesis probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
