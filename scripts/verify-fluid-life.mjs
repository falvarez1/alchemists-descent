import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, startGameplayCapture, finishGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent', label = process.argv[3] ?? 'after'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser(), report = { label, errors: [], samples: [], setup: 'Disposable canonical D1 seed 777; positioned at the native valve, god mode. Actual E opens/closes it. A disclosed 21-cell blood tracer is placed in existing water to measure transport.' };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh'); await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await execConsoleCommand(page, 'god on'); await execConsoleCommand(page, 'tp 524 374'); await page.waitForTimeout(2200);
  await page.evaluate(async () => {
    const { Cell } = await import('/src/sim/CellType.ts'), w = window.__game.ctx.world;
    window.__fluidCells = Cell;
    for (let y = 390; y < 393; y++) for (let x = 714; x < 721; x++) if (w.type(x, y) === Cell.Water) w.replaceCellAt(w.idx(x, y), Cell.Blood, 0x8a1b28);
  });
  const sample = () => page.evaluate(() => {
    const ctx = window.__game.ctx, w = ctx.world, Cell = window.__fluidCells;
    let water = 0, blood = 0, bloodX = 0, bloodY = 0;
    for (let y = 330; y < 550; y++) for (let x = 548; x < 900; x++) {
      const cell = w.type(x, y);
      if (x < 800 && y < 445 && cell === Cell.Water) water++;
      if (cell === Cell.Blood) { blood++; bloodX += x; bloodY += y; }
    }
    const eel = ctx.enemies.find(e => e.kind === 'rillback');
    return { tick: ctx.state.frameCount, water, blood, bloodX: blood ? bloodX / blood : null, bloodY: blood ? bloodY / blood : null,
      valve: ctx.levels.current.mechanisms.find(m => m.kind === 'valve').state,
      wheel: ctx.levels.current.living.valveTurn,
      eel: eel && { x: eel.x, y: eel.y, vx: eel.vx, vy: eel.vy, wet: eel.rillWet, body: eel.body?.nodes.map(n => ({ x: n.x, y: n.y, wet: w.type(Math.floor(n.x), Math.floor(n.y)) === Cell.Water })) } };
  });
  report.samples.push(await sample()); await startGameplayCapture(page);
  const observeTurn = () => page.evaluate(async () => {
    const values = [], end = performance.now() + 900;
    while (performance.now() < end) { await new Promise(requestAnimationFrame); values.push(window.__game.ctx.levels.current.living.valveTurn); }
    return values;
  });
  const opening = observeTurn();
  await page.keyboard.press('KeyE'); await page.waitForTimeout(350);
  await page.screenshot({ path: `${output}/fluids-${label}-valve-turn.png` });
  report.opening = await opening;
  await execConsoleCommand(page, 'tp 680 324');
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(1000); report.samples.push(await sample()); }
  await page.screenshot({ path: `${output}/fluids-${label}-drained.png` });
  report.drainedFraction = 1 - report.samples.at(-1).water / report.samples[0].water;
  assert.equal(report.samples.at(-1).valve, 1);
  if (label !== 'before') {
    assert.ok(report.drainedFraction > .6, 'The bulk of the sluice drains within ten seconds');
    assert.ok(report.samples.some(s => s.bloodX > report.samples[0].bloodX + 12 || s.bloodY > report.samples[0].bloodY + 12 || s.blood === 0), 'Blood travels or disperses with the water');
    assert.ok(report.opening.at(-1) - report.opening[0] > 3, 'Handwheel rotates clockwise to open');
    await execConsoleCommand(page, 'tp 524 374'); await page.waitForTimeout(700);
    const closing = observeTurn(); await page.keyboard.press('KeyE'); report.closing = await closing;
    assert.ok(report.closing[0] - report.closing.at(-1) > 3, 'Handwheel reverses to close');
    await page.screenshot({ path: `${output}/fluids-after-valve-closed.png` });
  }
  await finishGameplayCapture(page, `${output}/fluid-life-${label}.webm`);
  if (label !== 'before') archiveGameplayClip('fluid-life', 'Sluice · valve, current and blood', `${output}/fluid-life-${label}.webm`, `${output}/fluids-${label}-drained.png`, report.setup);
  assert.deepEqual(report.errors, []);
} finally { writeFileSync(`${output}/fluid-life-${label}.json`, JSON.stringify(report, null, 2)); await browser.close(); }
