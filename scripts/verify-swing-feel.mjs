// Swing FEEL fixes: (1) left/right pump now matches intuition (RIGHT swings the
// wizard to the right), and (2) releasing mid-swing keeps the built-up momentum
// (it no longer instantly clamps to walk speed).
// Usage: node scripts/verify-swing-feel.mjs [url]
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
  const w = ctx.world, p = ctx.player, VS = ctx.vineStrands, keys = ctx.input.keys;

  const setup = (anchorX, anchorY, len) => {
    ctx.state.mode = 'play'; ctx.state.paused = false; ctx.fx.hitstop = 0;
    VS.clear();
    for (let y = anchorY; y <= anchorY + len + 40; y++) for (let x = anchorX - 60; x <= anchorX + 60; x++) w.clearCellAt(w.idx(x, y));
    for (let x = anchorX - 4; x <= anchorX + 4; x++) { const i = w.idx(x, anchorY - 1); w.types[i] = 12; w.colors[i] = 0x777777; }
    VS.addHanging(anchorX, anchorY, len, { thickness: 2 });
    p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false;
    for (const k of Object.keys(keys)) keys[k] = false;
  };

  // ---- (1) FLIP: hang at rest below the anchor, hold RIGHT, expect +x -------
  setup(510, 600, 28);
  p.x = 510; p.y = 626; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  for (let f = 0; f < 3; f++) window.__game.tick();
  const grabbedR = ctx.playerCtl.grabVine(ctx);
  const xBeforeR = p.x;
  keys.right = true;
  for (let f = 0; f < 26; f++) window.__game.tick();
  const rightDx = p.x - xBeforeR;       // should be POSITIVE (moved right)
  keys.right = false;

  // ...and LEFT swings the other way
  setup(510, 600, 28);
  p.x = 510; p.y = 626; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  for (let f = 0; f < 3; f++) window.__game.tick();
  ctx.playerCtl.grabVine(ctx);
  const xBeforeL = p.x;
  keys.left = true;
  for (let f = 0; f < 26; f++) window.__game.tick();
  const leftDx = p.x - xBeforeL;        // should be NEGATIVE (moved left)
  keys.left = false;

  // ---- (2) MOMENTUM: a fast swing, then let go — the launch must carry ------
  setup(510, 600, 28);
  p.x = 510; p.y = 626; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; // hang straight down
  for (let f = 0; f < 3; f++) window.__game.tick();
  ctx.playerCtl.grabVine(ctx);
  p.vx = 6; // a hard tangential swing at the bottom of the arc
  window.__game.tick();
  window.__game.tick();
  const vxBefore = p.vx;          // still swinging fast
  p.grounded = true;              // reproduce the stale-grounded condition that caused the bug
  ctx.playerCtl.releaseVine(ctx); // let go of "G"
  window.__game.tick();           // first free-flight frame
  const vxAfter = p.vx;

  return {
    grabbedR, rightDx: +rightDx.toFixed(2), leftDx: +leftDx.toFixed(2),
    vxBefore: +vxBefore.toFixed(2), vxAfter: +vxAfter.toFixed(2),
  };
});

console.log('  ' + JSON.stringify(r));
check('grabs the test vine', r.grabbedR, JSON.stringify(r));
check('RIGHT swings the wizard to the right (+x)', r.rightDx > 3, JSON.stringify(r));
check('LEFT swings the wizard to the left (−x)', r.leftDx < -3, JSON.stringify(r));
check('release KEEPS the swing momentum (not clamped to walk speed 2.6)', Math.abs(r.vxAfter) > 4 && Math.abs(r.vxAfter) >= Math.abs(r.vxBefore) * 0.9, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nswing-feel probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
