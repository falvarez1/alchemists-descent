// Rigid-body stress probe: the adversarial cases the body caps exist for.
// Watches for the Rapier solver fault ("[RigidBodies] physics solver fault",
// the PHYSICS RESET toast) and reports cost and body counts per phase.
//
//   column   400 bodies dropped as one tall column onto a flat floor (a deep
//            stacking island, the worst contact graph)
//   chain    a row of 40 explosive barrels inside the pile, lit at one end
//            (chain detonations: fast debris, shatter pieces, spawn churn)
//   blasts   repeated strong blasts into the settled heap
//
// Usage: node scripts/probe-physics-stress.mjs [url]   (dev server running)
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5190/';
const browser = await launchBrowser({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const faults = [];
page.on('console', (m) => { if (/solver fault|PHYSICS RESET|recursive use/i.test(m.text())) faults.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => faults.push(`pageerror: ${String(e).slice(0, 200)}`));
await page.goto(url, { waitUntil: 'networkidle' });
await startConsoleTestRun(page, { seed: 777, level: 'physics-test', settleMs: 2000 });

const setup = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  ctx.player.hp = ctx.player.maxHp = ctx.player.invuln = 999999;
  ctx.enemies.length = 0; ctx.projectiles.length = 0; ctx.particles.clear(); ctx.rigidBodies.clear();
  if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0;
  const px = 800, floorY = 690;
  const cell = (x, y, t, c) => { const i = w.idx(x, y); w.types[i] = t; w.colors[i] = c; w.life[i] = 0; w.charge[i] = 0; w.activity.touchIndex(i); };
  for (let x = px - 281; x <= px + 281; x++) for (let y = floorY - 320; y <= floorY + 1; y++) {
    const edge = x === px - 281 || x === px + 281 || y === floorY - 320 || y >= floorY;
    cell(x, y, edge ? 13 : 0, edge ? 0x606870 : 0x08080c);
  }
  ctx.player.x = px - 250; ctx.player.y = floorY - 1;
  let s = 7;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const mats = ['wood', 'stone', 'metal'];
  // A tall column: 20 wide x 20 high cells of bodies.
  const ROWS = Number(new URLSearchParams(location.search).get("rows") ?? 20);
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < 20; col++) {
    const x = px - 120 + col * 12 + rnd() * 2, y = floorY - 30 - row * 13;
    const material = mats[(row + col) % 3];
    const isBarrel = row === 2 && col % 1 === 0 && col < 20;
    if (isBarrel) ctx.rigidBodies.spawn({ kind: 'box', halfW: 3, halfH: 4 }, x, y, { material: 'wood', payload: 'explosive' });
    else if ((row * 20 + col) % 4 === 3) ctx.rigidBodies.spawn({ kind: 'circle', radius: 2 + rnd() * 2.5 }, x, y, { material });
    else ctx.rigidBodies.spawn({ kind: 'box', halfW: 2 + rnd() * 3, halfH: 2 + rnd() * 3 }, x, y, { material, angle: rnd() });
  }
  return { bodies: ctx.rigidBodies.bodies.length };
});

async function phase(name, ms, action) {
  if (action) await page.evaluate(action);
  const r = await page.evaluate(async (ms) => {
    window.__perfSamples = []; window.__perfTicks = []; window.__perfRecord = true;
    let peak = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const check = () => {
        peak = Math.max(peak, window.__game.ctx.rigidBodies.bodies.length);
        if (performance.now() - t0 >= ms) res(); else setTimeout(check, 50);
      };
      check();
    });
    window.__perfRecord = false;
    const ticks = window.__perfTicks.map((t) => t.total);
    const frames = window.__perfSamples.length;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const ent = window.__perfSamples.filter((s) => s.didTick).map((s) => s.entities / Math.max(1, s.tickCount));
    return { fps: frames / (ms / 1000), tickMs: mean(ticks), entitiesMs: mean(ent), peakBodies: peak, bodies: window.__game.ctx.rigidBodies.bodies.length };
  }, ms);
  console.log(`${name.padEnd(8)} fps ${r.fps.toFixed(1).padStart(5)}  tick ${r.tickMs.toFixed(2)} ms  entities ${r.entitiesMs.toFixed(2)} ms  bodies ${r.bodies} (peak ${r.peakBodies})`);
  return r;
}

console.log('setup', setup);
await phase('column', 6000);
await phase('chain', 7000, () => {
  const ctx = window.__game.ctx;
  // Light the first barrel: the rest detonate in a ripple.
  const barrel = ctx.rigidBodies.bodies.find((b) => b.payload === 'explosive');
  if (barrel) ctx.rigidBodies.igniteArea(barrel.x, barrel.y, 4);
});
await phase('blasts', 7000, () => {
  const ctx = window.__game.ctx;
  let k = 0;
  window.__blaster = setInterval(() => {
    const x = 700 + (k++ % 5) * 50;
    ctx.explosions.trigger(x, 670, 14);
    ctx.rigidBodies.applyRadialImpulse(x, 670, 90, 10);
  }, 400);
});
await page.evaluate(() => clearInterval(window.__blaster));
console.log(faults.length ? `FAULTS (${faults.length}):\n  ${faults.join('\n  ')}` : 'no solver faults');
await browser.close();
process.exitCode = faults.length ? 1 : 0;
