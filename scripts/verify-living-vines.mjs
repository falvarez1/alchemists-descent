import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, startGameplayCapture, finishGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent', label = process.argv[3] ?? 'after'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser(), report = { label, errors: [], setup: 'Canonical disposable D1 seed 777; console positioning near a native vine. Cutting uses real mouse shots, no terrain/strand injection.' };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh'); await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await execConsoleCommand(page, 'tp 210 310');
  await page.waitForTimeout(3500);
  report.native = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    return ctx.vineStrands.strands.filter(s => !s.web).map(s => ({ anchorX: s.anchorX, anchorY: s.anchorY, tendril: s.tendril, nodes: s.nodes.length, segments: s.segments.length, span: Math.max(...s.nodes.map(n => n.y)) - Math.min(...s.nodes.map(n => n.y)) }));
  });
  await page.screenshot({ path: `${output}/vines-${label}-native.png` });
  if (label === 'before') process.exitCode = 0;
  else {
    assert.ok(report.native.some(s => Math.abs(s.anchorX - 160.5) < 2 && s.span > 55), 'The complete curved intake vine is alive');
    await startGameplayCapture(page);
    report.sway = await page.evaluate(async () => {
      const s = window.__game.ctx.vineStrands.strands.find(s => Math.abs(s.anchorX - 160.5) < 2 && s.tendril);
      window.__observedVine = s;
      const anchor = { x: s.nodes[0].x, y: s.nodes[0].y }, values = [];
      const end = performance.now() + 3000;
      while (performance.now() < end) { await new Promise(requestAnimationFrame); values.push(s.nodes.at(-1).x); }
      return { range: Math.max(...values) - Math.min(...values), anchorDrift: Math.hypot(s.nodes[0].x - anchor.x, s.nodes[0].y - anchor.y) };
    });
    assert.ok(report.sway.range > .2, 'The free end sways while its root remains attached');
    assert.equal(report.sway.anchorDrift, 0);
    // Rise alongside the authored root. Only the setup uses the console;
    // the projectile must intersect the visible physical stem to sever it.
    await execConsoleCommand(page, 'tp 210 132');
    await page.keyboard.down('KeyW');
    for (let attempt = 0; attempt < 20; attempt++) {
      const aim = await page.evaluate(() => {
        const ctx = window.__game.ctx, s = window.__observedVine, n = s.nodes[Math.min(2, s.nodes.length - 1)];
        const box = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
        return { x: box.left + (n.x - ctx.camera.x) / 640 * box.width, y: box.top + (n.y - ctx.camera.y) / 360 * box.height,
          intact: ctx.vineStrands.strands.includes(s), playerY: ctx.player.y };
      });
      if (!aim.intact) break;
      await page.mouse.move(aim.x, aim.y); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(140);
    }
    await page.keyboard.up('KeyW');
    report.cut = await page.evaluate(() => {
      const ctx = window.__game.ctx, original = window.__observedVine;
      return { originalPresent: ctx.vineStrands.strands.includes(original), fragments: ctx.vineStrands.strands.filter(s => s.foliage && !s.tendril && !s.persistent).map(s => ({ nodes: s.nodes.length, y: s.nodes[0].y, py: s.nodes[0].py })) };
    });
    assert.equal(report.cut.originalPresent, false, 'Actual shots split the physical stem');
    assert.ok(report.cut.fragments.some(s => s.nodes > 8), 'The hanging section becomes a falling leafy strand');
    await page.screenshot({ path: `${output}/vines-cut-falling.png` });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${output}/vines-cut-landed.png` });
    await finishGameplayCapture(page, `${output}/living-vines.webm`);
    archiveGameplayClip('living-vines', 'Vines · sway, cut and fall', `${output}/living-vines.webm`, `${output}/vines-after-native.png`, report.setup);
  }
  assert.deepEqual(report.errors, []);
} finally { writeFileSync(`${output}/living-vines-${label}.json`, JSON.stringify(report, null, 2)); await browser.close(); }
