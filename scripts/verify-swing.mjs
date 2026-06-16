// #2 Vine swing, in the PHYSICS TEST ARENA (hanging vines at x≈716/740/764/904):
//  - latch the nearest vine (grabVine true)
//  - a push makes the wizard pendulum (x oscillates), held to the rope length
//  - jumping launches him off the vine (upward boost + breaks the rope)
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
await page.waitForFunction(() => window.__game?.ctx?.vineStrands, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const tick = (n) => { for (let f = 0; f < n; f++) window.__game.tick(); };
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  tick(60); // let the vines settle into a hang
  const vs = ctx.vineStrands;
  const p = ctx.player;
  for (const k of ['left', 'right', 'up', 'jump', 'down']) ctx.input.keys[k] = false;

  // pick the vine nearest x≈764 (the thick one) and read its anchor (pinned top)
  let vine = vs.strands[0];
  for (const s of vs.strands) {
    if (s.nodes[0] && Math.abs(s.nodes[0].x - 764.5) < Math.abs(vine.nodes[0].x - 764.5)) vine = s;
  }
  const anchorX = vine.nodes[0].x;
  const anchorY = vine.nodes[0].y;
  const distFromAnchor = () => Math.hypot(p.x - anchorX, p.y - anchorY);

  // stand at the vine's x, mid-length, and latch on
  p.dead = false; p.climbing = false; p.crawling = false; p.diveT = 0;
  p.x = anchorX; p.y = 560; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  tick(2);
  const latched = ctx.playerCtl.grabVine(ctx);
  tick(3);
  const ropeLen = distFromAnchor();

  // shove him into a swing and watch the arc
  p.vx = 5;
  let minX = p.x, maxX = p.x, maxDist = 0;
  for (let f = 0; f < 90; f++) {
    window.__game.tick();
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    maxDist = Math.max(maxDist, distFromAnchor());
  }
  const swingRange = maxX - minX;
  const ropeHeld = maxDist <= ropeLen + 8; // never flies off the rope

  // jump to launch off the vine
  const vyBefore = p.vy;
  ctx.input.keys.jump = true;
  window.__game.tick();
  ctx.input.keys.jump = false;
  const vyAfter = p.vy;
  const launched = vyAfter < vyBefore - 1.4;
  tick(45);
  const brokeFree = distFromAnchor() > ropeLen + 10; // free of the rope after release

  return {
    latched, ropeLen: +ropeLen.toFixed(1), swingRange: +swingRange.toFixed(1),
    maxDist: +maxDist.toFixed(1), ropeHeld, launched, brokeFree,
  };
});

check('latches onto the nearest hanging vine', r.latched, JSON.stringify(r));
check('the wizard pendulums (x oscillates)', r.swingRange > 15, JSON.stringify(r));
check('he is held to the rope length (never flies off)', r.ropeHeld, JSON.stringify(r));
check('jumping launches him upward off the vine', r.launched, JSON.stringify(r));
check('release frees him from the rope', r.brokeFree, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nswing probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
