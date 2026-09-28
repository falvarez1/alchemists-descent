import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, finishGameplayCapture, startGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [], scenes: [], setup: 'Canonical D1 seed 777. Console position fixtures, real movement and gravity; playerCtl.kill triggers death at the measured momentum. No terrain, corpse or physics state injection.' };
page.on('pageerror', e => report.errors.push(String(e)));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  for (const scene of ['running', 'falling']) {
    await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh'); await waitForRunReady(page);
    await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
    await execConsoleCommand(page, scene === 'running' ? 'tp 225 314' : 'tp 260 180');
    await execConsoleCommand(page, 'god off'); // tp deliberately enables the debug safety flag
    await startGameplayCapture(page);
    if (scene === 'running') await page.keyboard.down('KeyD');
    await page.waitForTimeout(scene === 'running' ? 350 : 200);
    const entry = { scene, initial: await page.evaluate(() => {
      const c = window.__game.ctx, p = c.player, initial = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
      c.playerCtl.kill('fall');
      if (!p.dead || !c.rigidBodies.playerRagdoll) throw new Error('Death fixture did not create a mortal ragdoll');
      if (document.querySelector('#gameover-overlay.visible')) throw new Error('Return panel must wait for the landing');
      window.__ragdollMeasurements = [];
      const measure = () => {
        const rig = c.rigidBodies.playerRagdoll;
        if (!rig) return;
        const pt = (b, a) => ({ x: b.x + a.x * Math.cos(b.angle) - a.y * Math.sin(b.angle), y: b.y + a.x * Math.sin(b.angle) + a.y * Math.cos(b.angle) });
        let gap = 0;
        for (const j of rig.joints) { const a = pt(rig.parts[j.a], j.anchorA), b = pt(rig.parts[j.b], j.anchorB); gap = Math.max(gap, Math.hypot(a.x - b.x, a.y - b.y)); }
        window.__ragdollMeasurements.push({ time: performance.now(), tick: c.state.frameCount, gap, count: Object.keys(rig.parts).length,
          parts: Object.fromEntries(Object.entries(rig.parts).map(([name, b]) => [name, { x: b.x, y: b.y, angle: b.angle, vx: b.vx, vy: b.vy, sleeping: b.sleeping }])) });
        if (window.__ragdollMeasurements.length < 450) window.__ragdollMeasureFrame = requestAnimationFrame(measure);
      }; measure(); return initial;
    }) };
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(850); await page.screenshot({ path: `${output}/ragdoll-${scene}-impact.png` });
    await page.waitForTimeout(1300); await page.screenshot({ path: `${output}/ragdoll-${scene}-landing.png` });
    await page.locator('#gameover-overlay.visible').waitFor({ timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__game.ctx.rigidBodies.playerCorpse?.data?.settled), true);
    await page.screenshot({ path: `${output}/ragdoll-${scene}-settled.png` });
    entry.samples = await page.evaluate(() => { cancelAnimationFrame(window.__ragdollMeasureFrame); return window.__ragdollMeasurements; });
    assert.ok(entry.samples.length > 80);
    entry.maxJointGap = Math.max(...entry.samples.map(s => s.gap));
    assert.ok(entry.maxJointGap < 1.1, `Visible joints stay connected: ${entry.maxJointGap}`);
    assert.ok(entry.samples.every(s => s.count === 11 && Object.values(s.parts).every(b => Number.isFinite(b.x + b.y + b.angle))));
    if (scene === 'running') assert.ok(entry.initial.vx > 2);
    else assert.ok(entry.initial.vy > 2);
    await finishGameplayCapture(page, `${output}/ragdoll-${scene}.webm`);
    archiveGameplayClip(`ragdoll-${scene}`, `Player death · ${scene} impact`, `${output}/ragdoll-${scene}.webm`, `${output}/ragdoll-${scene}-landing.png`, report.setup);
    if (scene === 'falling') {
      await page.setViewportSize({ width: 720, height: 480 });
      await page.locator('#respawn-btn').scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${output}/ragdoll-settled-compact.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      entry.compactComposition = await page.evaluate(() => {
        const c = window.__game.ctx, canvas = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
        const parts = Object.entries(c.rigidBodies.playerRagdoll.parts).filter(([name]) => name !== 'hat').map(([, b]) => b);
        const body = { left: canvas.left + (Math.min(...parts.map(b => b.x)) - 4 - c.camera.renderX) / 640 * canvas.width,
          right: canvas.left + (Math.max(...parts.map(b => b.x)) + 4 - c.camera.renderX) / 640 * canvas.width,
          top: canvas.top + (Math.min(...parts.map(b => b.y)) - 4 - c.camera.renderY) / 360 * canvas.height,
          bottom: canvas.top + (Math.max(...parts.map(b => b.y)) + 4 - c.camera.renderY) / 360 * canvas.height };
        const r = document.querySelector('.go-panel').getBoundingClientRect(), panel = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        return { body, panel, overlaps: panel.left < body.right && panel.right > body.left && panel.top < body.bottom && panel.bottom > body.top };
      });
      assert.equal(entry.compactComposition.overlaps, false, 'Compact death panel leaves the connected body visible');
    }
    await page.locator('#respawn-btn').click();
    await page.waitForFunction(() => !window.__game.ctx.player.dead && !window.__game.ctx.rigidBodies.playerRagdoll);
    assert.equal(await page.evaluate(() => window.__game.ctx.rigidBodies.bodies.some(b => b.tag?.startsWith('player-corpse'))), false);
    entry.respawnClearedEveryPart = true; report.scenes.push(entry);
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error); await page.screenshot({ path: `${output}/ragdoll-failure.png` }); throw error;
} finally { writeFileSync(`${output}/player-ragdoll.json`, JSON.stringify(report, null, 2)); await browser.close(); }
