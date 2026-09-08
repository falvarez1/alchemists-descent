// Browser integration probe for D1's authored Metroidvania loop.
// It uses the real tome offer, wand card, ice projectile, material simulation,
// sensors, retracting gates and crank. Console positioning isolates each leg;
// unaided movement remains the responsibility of verify-living-traversal.mjs.
// Usage: node scripts/verify-cold-loop.mjs [url]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent';
mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [], warnings: [], casts: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  const text = message.text();
  if (/findability:.*repaired|SAFE ROUTE TEARS OPEN/i.test(text)) report.warnings.push(text);
});

const snapshot = () => page.evaluate(async () => {
  const { Cell } = await import('/src/sim/CellType.ts');
  const ctx = window.__game.ctx, rt = ctx.levels.current;
  const basin = { x0: 302, y0: 333, x1: 327, y1: 341 };
  const count = type => {
    let total = 0;
    for (let y = basin.y0; y <= basin.y1; y++) for (let x = basin.x0; x <= basin.x1; x++) {
      if (ctx.world.type(x, y) === type) total++;
    }
    return total;
  };
  const gates = rt.mechanisms.filter(m => m.id === 8301 || m.id === 8302);
  const gateCells = gates.map(gate => {
    let metal = 0;
    for (let y = gate.y; y < gate.y + gate.h; y++) for (let x = gate.x; x < gate.x + gate.w; x++) {
      if (ctx.world.type(x, y) === Cell.Metal) metal++;
    }
    return { id: gate.id, state: gate.state, metal, dissolve: gate.dissolve?.length ?? 0 };
  });
  return {
    objective: document.getElementById('objective')?.textContent ?? '',
    water: count(Cell.Water), ice: count(Cell.Ice), gates: gateCells,
    crank: rt.mechanisms.find(m => m.id === 8201),
    sensors: rt.mechanisms.filter(m => m.id === 8303 || m.id === 8304)
      .map(m => ({ id: m.id, state: m.state, reading: m.reading, broken: m.broken })),
    broken: rt.mechanisms.filter(m => m.broken !== undefined).map(m => ({ id: m.id, kind: m.kind, broken: m.broken })),
    frostOwned: ctx.wands.collection.includes('frostshard') || ctx.wands.wands.some(w => w.cards.includes('frostshard')),
    tea: rt.living.tea,
  };
});

async function frameLock(name) {
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.camera.zoomLock = 2;
    ctx.camera.setInspectionFocus(360, 320, { snap: true });
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/${name}.png` });
}

async function castAtWorld(worldX, worldY) {
  const target = await page.evaluate(({ worldX, worldY }) => {
    const ctx = window.__game.ctx;
    const canvas = document.querySelector('canvas[data-input-attached="true"]');
    const rect = canvas.getBoundingClientRect();
    const viewW = 640, viewH = 360, zoom = ctx.camera.zoom;
    const fracX = ctx.camera.x - Math.floor(ctx.camera.x);
    const fracY = ctx.camera.y - Math.floor(ctx.camera.y);
    const scaleX = (1 + 4 / viewW) * zoom;
    const scaleY = (1 + 4 / viewH) * zoom;
    const offsetX = -fracX * (2 / viewW) * zoom;
    const offsetY = fracY * (2 / viewH) * zoom;
    const texU = (worldX - ctx.camera.renderX) / viewW;
    const texV = (worldY - ctx.camera.renderY) / viewH;
    const ndcX = offsetX + (texU - .5) * 2 * scaleX;
    const ndcY = offsetY + (.5 - texV) * 2 * scaleY;
    return { x: rect.left + (ndcX + 1) * .5 * rect.width,
      y: rect.top + (1 - ndcY) * .5 * rect.height };
  }, { worldX, worldY });
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(50);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.up();
}

try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await page.waitForTimeout(500);

  report.initial = await snapshot();
  assert.match(report.initial.objective, /cold-locked/i);
  assert.ok(report.initial.water >= 32);
  assert.equal(report.initial.ice, 0);
  assert.ok(report.initial.gates.every(gate => gate.state === 0 && gate.metal > 0));
  assert.deepEqual(report.initial.broken, []);
  await frameLock('cold-lock-before');

  await execConsoleCommand(page, 'tp 892 735');
  await execConsoleCommand(page, 'god off');
  await page.locator('#card-offer-overlay.visible').waitFor({ timeout: 5000 });
  const frostChoice = page.locator('#card-offer-overlay [data-card-offer-id="frostshard"]');
  await frostChoice.waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${output}/frost-shard-reward.png` });
  await frostChoice.click();
  await page.waitForFunction(() => !document.getElementById('card-offer-overlay')?.classList.contains('visible'));
  assert.equal((await snapshot()).frostOwned, true);

  await execConsoleCommand(page, 'tp 370 314');
  await execConsoleCommand(page, 'god off');
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const index = ctx.wands.collection.indexOf('frostshard');
    if (index >= 0) ctx.wands.slotCollectionCard(index, 0, 0);
    ctx.wands.active = 0;
    ctx.player.fireBlockedUntilRelease = false;
    ctx.camera.clearInspectionFocus();
    ctx.camera.zoomLock = null;
  });
  for (let attempt = 0; attempt < 8; attempt++) {
    await castAtWorld(315, 338);
    await page.waitForTimeout(420);
    const state = await snapshot();
    report.casts.push({ attempt: attempt + 1, ice: state.ice, gates: state.gates });
    if (state.ice >= 32) break;
  }
  await page.waitForFunction(() => {
    const gates = window.__game.ctx.levels.current.mechanisms.filter(m => m.id === 8301 || m.id === 8302);
    return gates.length === 2 && gates.every(gate => gate.state === 1 && !gate.dissolve?.length);
  }, null, { timeout: 8000 });
  report.unlocked = await snapshot();
  assert.ok(report.unlocked.ice >= 32);
  assert.ok(report.unlocked.gates.every(gate => gate.state === 1 && gate.metal === 0));
  assert.deepEqual(report.unlocked.broken, []);
  await frameLock('cold-lock-after');

  await execConsoleCommand(page, 'tp 430 311');
  await execConsoleCommand(page, 'god off');
  await page.evaluate(() => { const ctx = window.__game.ctx; ctx.camera.clearInspectionFocus(); ctx.camera.zoomLock = null; });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => (window.__game.ctx.levels.current.living.tea?.stage ?? 0) >= 1, null, { timeout: 6000 });
  report.started = await snapshot();
  assert.ok(report.started.tea.stage >= 1);
  assert.deepEqual(report.started.broken, []);
  await page.screenshot({ path: `${output}/cold-loop-engine-start.png` });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  report.completed = true;
  console.log(JSON.stringify({ casts: report.casts.length, ice: report.unlocked.ice,
    gates: report.unlocked.gates.map(gate => gate.state), teaStage: report.started.tea.stage }));
} finally {
  writeFileSync(`${output}/cold-loop.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
