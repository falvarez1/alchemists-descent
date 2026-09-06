import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, startGameplayCapture, finishGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const report = { errors: [], setup: 'Disposable canonical D1 seed 777, console positioning and god mode. Actual F kicks an authored fern. Disclosed contact fixtures: one flying ember, water on its crown, fire replacing one supporting timber column, and a native spawned Rillback initially posed with its tail in a frozen surface. After that one-time pose/material setup, ordinary AI, body constraints, heat, water and gravity own all motion. No per-frame position or velocity overrides.' };
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => report.errors.push(String(e)));
const plant = index => page.evaluate(index => ({ ...window.__game.ctx.levels.current.living.plants[index] }), index);
async function aim(x, y) {
  const point = await page.evaluate(({ x, y }) => {
    const c = window.__game.ctx, r = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
    return { x: r.left + (x - c.camera.renderX) * r.width / 640, y: r.top + (y - c.camera.renderY) * r.height / 360 };
  }, { x, y });
  await page.mouse.move(point.x, point.y);
}
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh --hp 9999 --max-hp 9999');
  await waitForRunReady(page); await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await execConsoleCommand(page, 'god on'); await execConsoleCommand(page, 'tp 210 314'); await page.waitForTimeout(1100);
  await startGameplayCapture(page); report.beforeKick = await plant(2);
  await aim(226, 303); await page.keyboard.press('KeyF'); await page.waitForTimeout(85);
  report.kicked = await plant(2); assert.ok(Math.abs(report.kicked.angle - report.beforeKick.angle) > .1, 'Actual F bends the fern');
  await page.screenshot({ path: `${output}/habitat-kick.png` }); await page.waitForTimeout(1300);
  await page.evaluate(async () => {
    const c = window.__game.ctx, { Cell } = await import('/src/sim/CellType.ts');
    c.particles.spawn(205, 302, 7, 0, Cell.Ember, 0xffaa44, 35, { grav: 0, glow: 1, deposit: true });
  });
  await page.waitForFunction(() => window.__game.ctx.levels.current.living.plants[2].burning, null, { timeout: 5000 });
  await page.waitForTimeout(600); report.emberBurn = await plant(2);
  await page.screenshot({ path: `${output}/habitat-ember-fire.png` });
  await page.evaluate(async () => {
    const c = window.__game.ctx, { Cell } = await import('/src/sim/CellType.ts');
    for (let y = 299; y <= 310; y++) for (let x = 223; x <= 229; x++) if (!c.world.type(x, y) || c.world.type(x, y) === Cell.Fire) c.world.replaceCellAt(c.world.idx(x, y), Cell.Water, 0x295862);
  });
  await page.waitForFunction(() => !window.__game.ctx.levels.current.living.plants[2].burning);
  report.quenched = await plant(2); assert.ok(report.quenched.burn > 0);
  await page.screenshot({ path: `${output}/habitat-quenched.png` });
  await execConsoleCommand(page, 'tp 680 324'); await page.waitForTimeout(1200);
  report.supported = await plant(9); assert.equal(report.supported.detached, false);
  await page.evaluate(async () => {
    const c = window.__game.ctx, p = c.levels.current.living.plants[9], { Cell } = await import('/src/sim/CellType.ts');
    for (let y = p.rootY + 1; y <= p.rootY + 8; y++) for (let x = 698; x <= 700; x++) {
      if (c.world.type(x, y) !== Cell.Wood) continue;
      const i = c.world.idx(x, y); c.world.replaceCellAt(i, Cell.Fire, 0xffaa44); c.world.life[i] = 90;
    }
  });
  await page.waitForFunction(() => window.__game.ctx.levels.current.living.plants[9].detached);
  await page.waitForTimeout(230); report.falling = await plant(9);
  assert.equal(report.falling.spent, false); assert.ok(report.falling.y > report.supported.y + 3);
  await page.screenshot({ path: `${output}/habitat-burning-crown-falls.png` }); await page.waitForTimeout(1800);
  report.vineFixture = await page.evaluate(async () => {
    const c = window.__game.ctx, { Cell } = await import('/src/sim/CellType.ts');
    const vine = c.vineStrands.strands.find(s => s.foliage && s.nodes[0].x > 700 && s.nodes[0].x < 720);
    if (!vine) throw new Error('Native hanging sluice vine missing');
    const index = vine.nodes.findIndex((n, i) => i > 5 && n.leafLength), n = vine.nodes[index], before = vine.nodes[index - 1];
    const dx = n.x - before.x, dy = n.y - before.y, d = Math.hypot(dx, dy), length = n.leafLength;
    const x = n.x - dy / d * length * .7 + dx / d * length * .245, y = n.y + dx / d * length * .7 + dy / d * length * .245;
    window.__burningVineNode = n;
    c.particles.spawn(x, y, 0, 0, Cell.Ember, 0xffaa44, 35, { grav: 0, glow: 1 });
    return { x, y, index };
  });
  await page.waitForFunction(() => window.__burningVineNode.burning, null, { timeout: 4000 });
  await page.waitForTimeout(800); await page.screenshot({ path: `${output}/habitat-vine-burning.png` });
  await page.waitForFunction(() => !window.__game.ctx.vineStrands.strands.some(s => s.nodes.includes(window.__burningVineNode)), null, { timeout: 5000 });
  report.vineBurnedThrough = true;
  await page.screenshot({ path: `${output}/habitat-vine-burned-through.png` });
  await finishGameplayCapture(page, `${output}/habitat-interactions.webm`);
  archiveGameplayClip('habitat-interactions', 'Living foliage · kick, ignite, quench and fall', `${output}/habitat-interactions.webm`, `${output}/habitat-ember-fire.png`, report.setup);

  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh --hp 9999 --max-hp 9999');
  await waitForRunReady(page); await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await execConsoleCommand(page, 'god on'); await execConsoleCommand(page, 'tp 651 438'); await page.waitForTimeout(900);
  await execConsoleCommand(page, 'spawn rillback 1 645 405');
  report.iceFixture = await page.evaluate(async () => {
    const c = window.__game.ctx, { Cell } = await import('/src/sim/CellType.ts'), { createChain } = await import('/src/creatures/body.ts');
    const e = c.enemies.at(-1); window.__iceVictim = e;
    let surface = 360; for (let y = 330; y < 415; y++) if (c.world.type(645, y) === Cell.Water) { surface = y; break; }
    e.x = 645; e.y = surface + 37; e.fx = e.fy = e.vx = e.vy = 0;
    e.body = createChain(645, surface + 33);
    for (let i = 0; i < e.body.nodes.length; i++) { const n = e.body.nodes[i]; n.x = n.previousX = 645; n.y = n.previousY = surface + 33 - i * 4; }
    for (let y = surface; y <= surface + 3; y++) for (let x = 610; x <= 680; x++) {
      if (c.world.type(x, y) === Cell.Water) c.world.replaceCellAt(c.world.idx(x, y), Cell.Ice, 0x9ecbd0);
    }
    window.__iceSurface = surface; window.__iceSamples = [];
    window.__iceTimer = setInterval(() => {
      const n = e.body.nodes; window.__iceSamples.push({ x: e.x + e.fx, y: e.y + e.fy, hp: e.hp,
        tail: { x: n.at(-1).x, y: n.at(-1).y }, maxLink: Math.max(...n.slice(1).map((b, i) => Math.hypot(b.x - n[i].x, b.y - n[i].y))) });
    }, 16);
    return { surface, x: 645, headY: e.y, tailY: e.body.nodes.at(-1).y };
  });
  await startGameplayCapture(page); await page.waitForTimeout(3200);
  report.frozen = await page.evaluate(() => window.__iceSamples.splice(0));
  assert.ok(report.frozen.length > 60);
  assert.ok(Math.max(...report.frozen.map(s => s.maxLink)) <= 4.241, 'Ice cannot stretch a body link');
  assert.ok(report.frozen.every(s => Math.hypot(s.tail.x - 645, s.tail.y - report.iceFixture.tailY) < 1), 'Frozen tail remains attached to its actual ice contact');
  await page.screenshot({ path: `${output}/rillback-frozen-tail.png` });
  await page.evaluate(async () => {
    const c = window.__game.ctx, { Cell } = await import('/src/sim/CellType.ts'), surface = window.__iceSurface;
    for (let y = surface; y <= surface + 3; y++) for (let x = 610; x <= 680; x++) if (c.world.type(x, y) === Cell.Ice) c.world.replaceCellAt(c.world.idx(x, y), Cell.Water, 0x295862);
  });
  await page.waitForTimeout(2800); report.thawed = await page.evaluate(() => { clearInterval(window.__iceTimer); return window.__iceSamples; });
  assert.ok(Math.max(...report.thawed.map(s => s.maxLink)) <= 4.241);
  assert.ok(report.thawed.some(s => Math.hypot(s.tail.x - 645, s.tail.y - report.iceFixture.tailY) > 8), 'The released tail swims free');
  await page.screenshot({ path: `${output}/rillback-thawed-tail.png` });
  await finishGameplayCapture(page, `${output}/rillback-ice-release.webm`);
  archiveGameplayClip('rillback-ice-release', 'Rillback · caught in ice, then released', `${output}/rillback-ice-release.webm`, `${output}/rillback-frozen-tail.png`, report.setup);
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error); await page.screenshot({ path: `${output}/habitat-interactions-failure.png` }); throw error;
} finally { writeFileSync(`${output}/habitat-interactions.json`, JSON.stringify(report, null, 2)); await browser.close(); }
