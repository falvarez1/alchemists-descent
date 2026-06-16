// Verifies the hanging ropes/vines in the PHYSICS TEST ARENA: persistent Verlet
// strands, pinned at the top, that react to the player walking into them.
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
await page.waitForTimeout(800);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  const vs = ctx.vineStrands;
  for (let f = 0; f < 90; f++) window.__game.tick(); // let the ropes settle to a hang
  const count0 = vs.strands.length;
  // Pick the hanging vine nearest x≈740.
  let vine = vs.strands[0];
  for (const s of vs.strands) {
    if (s.nodes[0] && Math.abs(s.nodes[0].x - 740.5) < Math.abs(vine.nodes[0].x - 740.5)) vine = s;
  }
  const anchorX = vine.nodes[0].x;
  const node0y = vine.nodes[0].y;
  const last = vine.nodes.length - 1;
  // Persistence + pin: keep ticking; the anchor must stay put and strands persist.
  for (let f = 0; f < 150; f++) window.__game.tick();
  const node0yLater = vine.nodes[0].y;
  const count1 = vs.strands.length;
  const restBottomX = vine.nodes[last].x;
  const bottomY = vine.nodes[last].y;
  // Player interaction: stand just left of the vine and measure the peak swing.
  const p = ctx.player;
  p.dead = false;
  p.x = anchorX - 4;
  p.y = 599;
  p.vx = p.vy = 0;
  const mid = Math.floor(last * 0.9);
  let peak = 0;
  for (let f = 0; f < 30; f++) {
    window.__game.tick();
    peak = Math.max(peak, vine.nodes[mid].x - restBottomX);
  }

  // Detach-on-anchor-loss: destroy the beam a hanging rope hangs from and it
  // must fall (un-pin its top + drop), not freeze in mid-air.
  let rope = vs.strands[0];
  for (const s of vs.strands) {
    if (s.nodes[0] && Math.abs(s.nodes[0].x - 904.5) < Math.abs(rope.nodes[0].x - 904.5)) rope = s;
  }
  const ropeAnchorX = Math.floor(rope.nodes[0].x);
  const ropeTop0 = rope.nodes[0].y;
  const ropePersist0 = rope.persistent === true;
  // Blast away the beam cells at/above the anchor (rows 456..461, a few columns).
  const world = ctx.world;
  for (let cx = ropeAnchorX - 4; cx <= ropeAnchorX + 4; cx++)
    for (let cy = 456; cy <= 461; cy++)
      if (world.inBounds(cx, cy)) world.clearCellAt(world.idx(cx, cy));
  window.__game.tick();
  const ropePersist1 = rope.persistent === true;
  for (let f = 0; f < 60; f++) window.__game.tick();
  const ropeTop1 = rope.nodes[0].y;

  return {
    count0, count1, anchorX, node0y, node0yLater, restBottomX,
    peakShove: +peak.toFixed(2), bottomY, len: vine.nodes.length,
    ropeTop0: +ropeTop0.toFixed(2), ropeTop1: +ropeTop1.toFixed(2),
    ropePersist0, ropePersist1, ropeDrop: +(ropeTop1 - ropeTop0).toFixed(2),
  };
});

check('hanging strands exist (>=4 ropes/vines)', r.count0 >= 4, JSON.stringify(r));
check('strands are PERSISTENT (do not settle away)', r.count1 >= 4, JSON.stringify(r));
check('top node is PINNED at the anchor (~461.5, does not fall)', Math.abs(r.node0y - 461.5) < 1.5 && Math.abs(r.node0yLater - 461.5) < 1.5, JSON.stringify(r));
check('vine hangs to near the floor', r.bottomY > 560, JSON.stringify(r));
check('player walking into the vine shoves it', r.peakShove > 1.5, JSON.stringify(r));
check('rope starts pinned/persistent', r.ropePersist0 && Math.abs(r.ropeTop0 - 461.5) < 1.5, JSON.stringify(r));
check('destroying its anchor un-pins the rope', r.ropePersist1 === false, JSON.stringify(r));
check('un-anchored rope falls (top drops, no hover)', r.ropeDrop > 15, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nvines probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
