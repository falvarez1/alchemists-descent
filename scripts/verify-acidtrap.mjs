// "The Alchemist's Folly" Rube Goldberg trap in the PHYSICS TEST playground:
// step on the plate → relay opens a valve + ignites a wood crate → the flaming
// crate drops onto explosive barrels → they chain-detonate → the blast shoves
// the victim into the acid vat (damage/death).
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
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  const rb = ctx.rigidBodies;
  const p = ctx.player;
  const w = ctx.world;
  const mechs = ctx.levels.current.mechanisms;
  const plate = mechs.find((m) => m.kind === 'plate');
  const relay = mechs.find((m) => m.kind === 'relay');
  const wired = !!plate && !!relay;
  const footTypes = () => (relay?.body || []).map(([bx, by]) => w.types[w.idx(bx, by)]);
  const preFoot = footTypes();
  for (let f = 0; f < 30; f++) window.__game.tick();
  const floorRow = (y) => [1500, 1535, 1540, 1545, 1600, 1620, 1660, 1700, 1755, 300].map((x) => w.types[w.idx(x, y)]);
  const relayDiag = relay ? {
    rx: relay.x, ry: relay.y, broken0: relay.broken,
    body: relay.body, preFoot, postFoot: footTypes(),
    floorY700: floorRow(700), floorY701: floorRow(701), floorY705: floorRow(705),
  } : null;
  const barrelsOf = () => rb.bodies.filter((b) => b.payload === 'explosive').length;
  const burningBarrels = () => rb.bodies.filter((b) => b.payload === 'explosive' && b.burnT).length;

  // stand the victim on the trigger plate
  p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false; p.diveT = 0;
  p.x = 1654; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; p.hp = p.maxHp; p.invuln = 0;
  const barrelsBefore = barrelsOf();
  const hp0 = p.hp;
  const x0 = p.x;

  let relayFired = false;
  let detonatedAt = -1;
  let igniteAt = -1;
  let maxX = x0;
  const trace = [];
  for (let f = 0; f < 260; f++) {
    if (f < 24) { p.x = 1654; p.y = 699; p.vx = 0; p.dead = false; p.hp = p.maxHp; } // stay on the plate until it triggers
    window.__game.tick();
    if (relay && relay.state === 1) relayFired = true;
    if (igniteAt < 0 && burningBarrels() > 0) igniteAt = f;
    if (detonatedAt < 0 && barrelsOf() < barrelsBefore) detonatedAt = f;
    maxX = Math.max(maxX, p.x);
    if (f < 18) trace.push({ f, pressed: plate?.pressed === true, pst: plate?.state, fuse: relay?.fuseT, rst: relay?.state, rbk: relay?.broken });
  }
  const barrelsAfter = barrelsOf();

  return {
    wired, relayDiag, barrelsBefore, barrelsAfter, relayFired, igniteAt, detonatedAt,
    hp0: +hp0.toFixed(1), hpEnd: +p.hp.toFixed(1), x0, xEnd: +p.x.toFixed(1), maxX: +maxX.toFixed(1), dead: p.dead,
    trace,
  };
});

console.log('  relayDiag:', JSON.stringify(r.relayDiag));
console.log('  trace:', JSON.stringify(r.trace?.slice(0, 6)));
check('trap is wired (plate + relay)', r.wired, JSON.stringify(r));
check('stepping the plate fires the relay', r.relayFired, JSON.stringify(r));
check('the barrels chain-detonate', r.barrelsAfter < r.barrelsBefore && r.detonatedAt > 0, JSON.stringify(r));
check('the whole nest goes off', r.barrelsAfter === 0, JSON.stringify(r));
check('the victim is shoved toward / into the acid vat (x≥1668) or killed', r.maxX > 1668 || r.dead || r.hpEnd < r.hp0, JSON.stringify({ relayFired: r.relayFired, igniteAt: r.igniteAt, detonatedAt: r.detonatedAt, maxX: r.maxX, hpEnd: r.hpEnd, dead: r.dead }));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nacid-trap probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
