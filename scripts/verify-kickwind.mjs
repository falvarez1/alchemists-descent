// The kick (F) is a WIND gust: it blows ash (+ embers/gases) into flying motes,
// shoves ambient critters (moths) away, and bends hanging vines — within its cone.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5219/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.player, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 30; f++) window.__game.tick();
  const p = ctx.player;
  const w = ctx.world;
  const ASH = 32;
  const kick = () => { ctx.playerCtl.kickCooldownT = 0; p.aimAngle = 0; ctx.playerCtl.kick(ctx); };
  const countAsh = () => { let n = 0; for (let y = 690; y <= 699; y++) for (let x = 308; x <= 328; x++) if (w.types[w.idx(x, y)] === ASH) n++; return n; };

  // --- ASH: a patch in front of the wizard gets blown to motes ---
  ctx.rigidBodies.clear();
  p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false;
  p.x = 300; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  for (let y = 692; y <= 698; y++) for (let x = 314; x <= 324; x++) w.replaceCellAt(w.idx(x, y), ASH, 0x6b6b6b);
  const ashBefore = countAsh();
  kick();
  const ashAfter = countAsh();

  // --- MOTH (critter): pushed away from the wizard ---
  let mothVx = 0, hadMoth = false;
  if (ctx.critters) {
    ctx.critters.list.push({ kind: 'moth', x: 322, y: 690, vx: 0, vy: 0, phase: 0, gasp: 0, facing: 1 });
    const moth = ctx.critters.list[ctx.critters.list.length - 1];
    p.x = 300; p.y = 699;
    kick();
    mothVx = moth.vx; hadMoth = true;
  }

  // --- VINE: bent by the gust ---
  let vineMoved = 0;
  const vs = ctx.vineStrands.strands;
  if (vs.length) {
    let vine = vs[0];
    for (const s of vs) if (s.nodes[0] && Math.abs(s.nodes[0].x - 440.5) < Math.abs(vine.nodes[0].x - 440.5)) vine = s;
    const mid = Math.floor((vine.nodes.length - 1) * 0.6);
    const node = vine.nodes[mid];
    p.x = node.x - 8; p.y = node.y; p.vx = 0; p.vy = 0;
    const x0 = node.x;
    kick();
    for (let f = 0; f < 5; f++) window.__game.tick();
    vineMoved = node.x - x0;
  }

  return { ashBefore, ashAfter, mothVx: +mothVx.toFixed(2), hadMoth, vineMoved: +vineMoved.toFixed(2) };
});

let pass = 0, fail = 0;
const check = (n, ok, d='') => { if (ok) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' ' + d); } };
console.log('  ' + JSON.stringify(r));
check('kick blows an ash patch into motes (ash cleared)', r.ashBefore > 20 && r.ashAfter < r.ashBefore * 0.5, JSON.stringify(r));
check('kick shoves a moth away from the wizard', !r.hadMoth || r.mothVx > 1.5, JSON.stringify(r));
check('kick bends a nearby hanging vine', r.vineMoved > 0.3, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\nkick-wind probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
