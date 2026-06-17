// The reworked PHYSICS TEST playground: standalone (generated terrain wiped),
// bright, black backdrop, with a station for every physics feature.
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
  tick(30);
  const w = ctx.world;
  const rb = ctx.rigidBodies;
  const WATER = 2, LAVA = 11;
  const countIn = (x0, x1, y0, y1, t) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y) && w.types[w.idx(x, y)] === t) n++; return n; };

  // generated terrain wiped → cells outside the room box (x 60..1540, y 184..716) are empty
  const offRoomEmpty = [w.types[w.idx(1570, 500)], w.types[w.idx(30, 500)], w.types[w.idx(800, 120)]].every((t) => t === 0);

  const ambient = ctx.params.global.ambient;
  const bd = ctx.levels.current.backdrop;
  const backdropOff = !!bd && Object.values(bd.layers).every((l) => l.visible === false);

  const mechs = ctx.levels.current.mechanisms;
  const hasLever = mechs.some((m) => m.kind === 'lever');
  const hasDispenser = mechs.some((m) => m.kind === 'dispenser');
  const vineCount = ctx.vineStrands.strands.length;
  const barrels = rb.bodies.filter((b) => b.payload === 'explosive').length;
  const waterCells = countIn(851, 1059, 640, 699, WATER);
  const lavaCells = countIn(1205, 1295, 680, 705, LAVA);
  const emitters = ctx.levels.current.emitters?.length ?? 0;

  return { offRoomEmpty, ambient: +ambient.toFixed(2), backdropOff, hasLever, hasDispenser, vineCount, barrels, waterCells, lavaCells, emitters };
});

check('generated terrain is wiped (off-room cells empty)', r.offRoomEmpty, JSON.stringify(r));
check('playground is brightly lit (high ambient)', r.ambient >= 0.8, JSON.stringify(r));
check('backdrop is disabled (black background)', r.backdropOff, JSON.stringify(r));
check('vine-swing rig present (>=3 hanging vines)', r.vineCount >= 3, JSON.stringify(r));
check('dispenser + lever present', r.hasLever && r.hasDispenser, JSON.stringify(r));
check('water pool present', r.waterCells > 300, JSON.stringify(r));
check('lava (fire/ragdoll pit) present', r.lavaCells > 80, JSON.stringify(r));
check('explosive barrels present (>=4)', r.barrels >= 4, JSON.stringify(r));
check('no perpetual water emitter (constant-sound fix)', r.emitters === 0, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nplayground probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
