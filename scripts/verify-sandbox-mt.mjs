// Functional checks of the multithreaded Sandbox sweep in the real game
// (docs/SANDBOX-MT.md): every side-effect path the workers can't run in place.
//   1. a packed gunpowder clump next to fire detonates (explosion replay)
//   2. a charged metal bar in water spreads charge into the pool, and the
//      charge index stays in step with the plane (charge-index replay)
//   3. burning oil throws particles (particle replay)
//   4. Clear Canvas (world.clear) and a trip to Play and back keep working
//   5. no page errors, no fallback to the serial sweep
// Usage: node scripts/verify-sandbox-mt.mjs [--url http://127.0.0.1:5191/] [--threads 4]
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://127.0.0.1:5191/');
const THREADS = arg('threads', '4');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.text().includes('[sandbox-mt]')) console.log(`  [page] ${msg.text()}`);
});
await page.goto(`${BASE}?threads=${THREADS}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 30000 });
if (!(await page.locator('#expedition-entry .entry-workshops').evaluate((d) => d.open))) {
  await page.locator('#expedition-entry .entry-workshops > summary').click();
}
await page.locator('#expedition-entry [data-entry="sandbox"]').click();
await page.locator('#expedition-entry').waitFor({ state: 'hidden', timeout: 10000 });
await page.waitForTimeout(1000);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

const setup = () => page.evaluate(() => {
  const ctx = window.__game.ctx, world = ctx.world;
  const write = (x, y, type, life = 0) => {
    const i = world.idx(x, y);
    world.types[i] = type; world.colors[i] = 0x808080; world.life[i] = life; world.charge[i] = 0;
    world.activity.touchIndex(i);
  };
  // clear a 300x160 metal box
  const x0 = 650, y0 = 700, x1 = 950, y1 = 860;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    write(x, y, x === x0 || x === x1 || y === y0 || y === y1 ? 13 : 0);
  }
  ctx.camera.x = ctx.camera.tx = 480; ctx.camera.y = ctx.camera.ty = 600;
  return { write: true };
});

// 1. explosion
await setup();
const blast = await page.evaluate(async () => {
  const ctx = window.__game.ctx, world = ctx.world;
  let blasts = 0;
  const orig = ctx.explosions.trigger.bind(ctx.explosions);
  ctx.explosions.trigger = (...a) => { blasts++; return orig(...a); };
  const write = (x, y, type, life = 0) => {
    const i = world.idx(x, y);
    world.types[i] = type; world.colors[i] = 0x404040; world.life[i] = life; world.charge[i] = 0;
    world.activity.touchIndex(i);
  };
  for (let x = 700; x < 712; x++) for (let y = 840; y < 859; y++) write(x, y, 8); // packed gunpowder clump
  for (let x = 712; x < 716; x++) for (let y = 850; y < 859; y++) write(x, y, 5, 120); // fire beside it
  const before = ctx.simulation.parallel.stats.substeps;
  await new Promise((r) => setTimeout(r, 1500));
  ctx.explosions.trigger = orig;
  let powder = 0;
  for (let x = 700; x < 712; x++) for (let y = 840; y < 859; y++) if (world.types[world.idx(x, y)] === 8) powder++;
  return { blasts, powder, substeps: ctx.simulation.parallel.stats.substeps - before };
});
check('gunpowder clump detonates through the explosion replay', blast.blasts > 0 && blast.powder < 50, JSON.stringify(blast));

// 2. electricity
await setup();
const shock = await page.evaluate(async () => {
  const ctx = window.__game.ctx, world = ctx.world;
  const write = (x, y, type) => {
    const i = world.idx(x, y);
    world.types[i] = type; world.colors[i] = 0x1e8ce6; world.life[i] = 0; world.charge[i] = 0;
    world.activity.touchIndex(i);
  };
  for (let x = 651; x < 950; x++) for (let y = 800; y < 860; y++) write(x, y, 2); // a pool
  for (let x = 760; x < 840; x++) write(x, 830, 13); // metal bar in it
  await new Promise((r) => setTimeout(r, 300));
  for (let x = 760; x < 790; x++) world.setChargeAt(world.idx(x, 830), 200);
  let peakWater = 0;
  for (let k = 0; k < 20; k++) {
    await new Promise((r) => setTimeout(r, 50));
    let charged = 0;
    for (let x = 651; x < 950; x++) for (let y = 800; y < 860; y++) {
      const i = world.idx(x, y);
      if (world.types[i] === 2 && world.charge[i] > 0) charged++;
    }
    peakWater = Math.max(peakWater, charged);
  }
  let missing = 0, stale = 0;
  for (let i = 0; i < world.charge.length; i++) if (world.charge[i] > 0 && !world.activeCharges.has(i)) missing++;
  for (const i of world.activeCharges) if (world.charge[i] === 0) stale++;
  return { peakWater, missing, stale, indexSize: world.activeCharges.size };
});
check('charge conducts into the pool', shock.peakWater > 20, JSON.stringify(shock));
check('the charge index matches the charge plane', shock.missing === 0, `missing ${shock.missing}`);

// 3. particles from burning oil
await setup();
const smoke = await page.evaluate(async () => {
  const ctx = window.__game.ctx, world = ctx.world;
  ctx.particles.clear();
  const write = (x, y, type, life = 0) => {
    const i = world.idx(x, y);
    world.types[i] = type; world.colors[i] = 0x55401e; world.life[i] = life; world.charge[i] = 0;
    world.activity.touchIndex(i);
  };
  for (let x = 700; x < 900; x++) for (let y = 845; y < 859; y++) write(x, y, 6);
  for (let x = 700; x < 900; x += 4) write(x, 844, 5, 90);
  let peak = 0;
  for (let k = 0; k < 20; k++) {
    await new Promise((r) => setTimeout(r, 60));
    peak = Math.max(peak, ctx.particles.list.length);
  }
  return { peakParticles: peak };
});
check('burning oil throws particles through the replay', smoke.peakParticles > 20, JSON.stringify(smoke));

// 4. clear + play round trip
const clear = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.world.clear();
  await new Promise((r) => setTimeout(r, 400));
  let nonEmpty = 0;
  for (let i = 0; i < ctx.world.types.length; i += 97) if (ctx.world.types[i] !== 0) nonEmpty++;
  return { nonEmpty, handles: ctx.simulation.parallel.handles(ctx.world) };
});
check('world.clear() on the shared world', clear.handles, JSON.stringify(clear));

await startConsoleTestRun(page);
await page.waitForTimeout(1500);
const inPlay = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return { mode: ctx.state.mode, handles: ctx.simulation.parallel.handles(ctx.world) };
});
// back through the header's SANDBOX tab (the play screen hides the header;
// the DOM click is what the tab's own handler listens for)
await page.evaluate(() => document.getElementById('mode-build-btn')?.click());
await page.waitForTimeout(1500);
const back = await page.evaluate(() => {
  const ctx = window.__game.ctx, p = ctx.simulation.parallel;
  const before = p.stats.substeps;
  return new Promise((resolve) => setTimeout(() => resolve({
    mode: ctx.state.mode, handles: p.handles(ctx.world), advanced: p.stats.substeps - before, failure: p.failure,
  }), 2000));
});
check('Play uses the serial sweep on its level world', inPlay.mode === 'play' && !inPlay.handles, JSON.stringify(inPlay));
check('back in the Sandbox the parallel sweep resumes', back.mode !== 'play' && back.handles && back.advanced > 30, JSON.stringify(back));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
