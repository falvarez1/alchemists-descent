import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, finishGameplayCapture, startGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [], shots: [], setup: 'Canonical D1 seed 777, starter wand, 9999 HP, two console-spawned slimes on opposite sides in the Intake; god off after positioning. Real aiming and firing; no hit, combo, timing or projectile injection.' };
page.on('pageerror', e => report.errors.push(String(e)));
const settings = async () => { await page.locator('#expedition-pause').click(); await page.locator('#pause-settings').click(); };
const close = async () => { await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await page.keyboard.press('Escape'); };
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh --hp 9999 --max-hp 9999'); await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await settings(); await page.locator('[name="trickshotEnabled"]').check(); await close();
  await execConsoleCommand(page, 'tp 205 314');
  await execConsoleCommand(page, 'spawn slime 1 260 313'); await execConsoleCommand(page, 'spawn slime 1 165 313');
  await execConsoleCommand(page, 'god off');
  await page.evaluate(() => {
    const c = window.__game.ctx; window.__chainTargets = c.enemies.slice(-2); window.__chainCadence = [];
    const sample = () => { const r = c.fx.trickshot; window.__chainCadence.push({ time: performance.now(), tick: c.state.frameCount,
      label: r?.label, chain: r?.chain ?? 0, remaining: r?.remainingMs ?? 0, scale: r?.scale ?? 1 });
      if (window.__chainCadence.length < 900) window.__chainCadenceFrame = requestAnimationFrame(sample); };
    sample();
  });
  await startGameplayCapture(page);
  for (let i = 0; i < 20; i++) {
    await page.waitForFunction(() => { const w = window.__game.ctx.wands.wands[0]; return w.cooldown <= 0 && w.mana >= 10; }, null, { timeout: 8000 });
    const target = await page.evaluate(() => {
      const c = window.__game.ctx, targets = window.__chainTargets.filter(e => c.enemies.includes(e));
      if (!targets.length) return null;
      const e = targets.find(e => !c.fx.trickshot?.seen.has(e)) ?? targets[0], r = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
      return { x: r.left + (e.x - c.camera.renderX) / 640 * r.width, y: r.top + (e.y - 5 - c.camera.renderY) / 360 * r.height };
    });
    if (!target) break;
    await page.mouse.move(target.x, target.y); await page.waitForTimeout(30);
    report.shots.push(await page.evaluate(async () => {
      const { getAimGuide } = await import('/src/combat/AimGuide.ts'); const g = getAimGuide(window.__game.ctx);
      return { enemy: g?.enemy?.kind, contact: g?.contact, assisted: g?.assisted, spread: g?.spread, end: g?.points.at(-1) };
    }));
    await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up(); await page.waitForTimeout(190);
    if (await page.evaluate(() => (window.__game.ctx.fx.trickshot?.chain ?? 0) >= 2)) break;
  }
  assert.ok(await page.evaluate(() => (window.__game.ctx.fx.trickshot?.chain ?? 0) >= 2), 'Actual shots chain distinct enemies');
  await page.screenshot({ path: `${output}/trickshot-target-chain.png` });
  await page.waitForTimeout(4200);
  report.cadence = await page.evaluate(() => { cancelAnimationFrame(window.__chainCadenceFrame); return window.__chainCadence; });
  const slow = report.cadence.filter(s => s.remaining > 180 && s.remaining < 580);
  assert.ok(slow.length > 5);
  const windows = report.cadence.map((s, i, samples) => {
    const end = samples.find((t, j) => j > i && t.time - s.time >= 300);
    return end ? { start: s, end, hz: (end.tick - s.tick) * 1000 / (end.time - s.time) } : null;
  }).filter(Boolean);
  report.slowHz = Math.min(...windows.filter(w => w.start.remaining > 350 && w.end.remaining > 120).map(w => w.hz));
  report.recoveredHz = windows.filter(w => w.start.remaining === 0 && w.start.time > report.cadence.at(-1).time - 1800).at(-1)?.hz;
  assert.ok(report.slowHz > 5 && report.slowHz < 35, `Slow cadence ${report.slowHz}`);
  assert.ok(report.recoveredHz > 55 && report.recoveredHz < 65, `Recovered cadence ${report.recoveredHz}`);
  await finishGameplayCapture(page, `${output}/trickshot-chain.webm`);
  archiveGameplayClip('trickshot-chain', 'Borrowed time · two-target chain', `${output}/trickshot-chain.webm`, `${output}/trickshot-target-chain.png`, report.setup);
  const openAfterReload = async () => {
    await page.reload(); await page.waitForFunction(() => window.__game?.ctx);
    await page.evaluate(() => window.__game.ctx.levels.ready); await page.waitForTimeout(800);
    if (await page.locator('[data-entry="settings"]').isVisible()) await page.locator('[data-entry="settings"]').click();
    else await settings();
  };
  await openAfterReload();
  assert.equal(await page.locator('[name="trickshotEnabled"]').isChecked(), true);
  report.onPersisted = true;
  await page.locator('[name="trickshotEnabled"]').uncheck(); await close();
  assert.equal(await page.evaluate(() => window.__game.ctx.fx.trickshot), undefined);
  await openAfterReload();
  assert.equal(await page.locator('[name="trickshotEnabled"]').isChecked(), false);
  report.offPersisted = true;
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = String(error); await page.screenshot({ path: `${output}/trickshot-chain-failure.png` }); throw error; }
finally { writeFileSync(`${output}/trickshot-chain.json`, JSON.stringify(report, null, 2)); await browser.close(); }
