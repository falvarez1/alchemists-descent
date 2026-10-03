// Native settings flow and gameplay light-query independence from visual options.
// Usage: node scripts/verify-presentation-contracts.mjs [dev URL]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5182/';
const dir = 'verify-out/presentation-contracts';
mkdirSync(dir, { recursive: true });
const checker = makeChecker(), errors = [];
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${url}?link=off`, { waitUntil: 'networkidle', timeout: 60000 });
  await startConsoleTestRun(page, { level: 'd1', world: 'campaign-level', seed: 1337, settleMs: 1500, timeout: 60000 });
  const light = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const { Lighting } = await import('/src/render/Lighting.ts');
    const { LightQuery } = await import('/src/render/LightQuery.ts');
    const { VISUAL_FIDELITY: options } = await import('/src/config/visualFidelity.ts');
    ctx.state.paused = true;
    const saved = { dead: ctx.player.dead, frame: ctx.state.frameCount, lights: ctx.levels.current.authoredLights,
      enabled: options.enabled, gain: options.lampIntensity, corpse: ctx.rigidBodies.playerCorpse };
    try {
      ctx.player.dead = true; ctx.rigidBodies.playerCorpse = null; ctx.state.frameCount = 420;
      const x = ctx.camera.renderX + 130, y = ctx.camera.renderY + 90;
      ctx.levels.current.authoredLights = [{ x, y, r: 1, g: .7, b: .25, intensity: .6, radius: 42,
        occluded: false, falloff: 'linear', bloom: 0, flicker: .16, flickerPhase: 1.3, fixture: 'lantern' }];
      const field = new Lighting(), query = new LightQuery(ctx, field);
      const read = () => { field.build(ctx); return Array.from({ length: 40 }, (_, k) => query.level(x + k, y)); };
      options.enabled = false; const base = read();
      options.enabled = true; options.lampIntensity = 3; const detailed = read();
      return { base, detailed, maxDelta: Math.max(...base.map((v, k) => Math.abs(v - detailed[k]))) };
    } finally {
      ctx.player.dead = saved.dead; ctx.rigidBodies.playerCorpse = saved.corpse; ctx.state.frameCount = saved.frame;
      ctx.levels.current.authoredLights = saved.lights; options.enabled = saved.enabled; options.lampIntensity = saved.gain;
    }
  });
  checker.check('visual lamp gain and detail switch preserve actual gameplay light queries', light.maxDelta === 0, JSON.stringify(light));
  await page.evaluate(() => { window.__game.ctx.state.paused = false; });
  await page.locator('#expedition-pause').click();
  await page.locator('#pause-settings').click();
  await page.locator('#settings-tab-display').click();
  const layout = await page.evaluate(() => {
    for (const [name, value] of [['hudScale', '1.25'], ['hudOpacity', '.6']]) {
      const input = document.querySelector(`#player-settings [name="${name}"]`);
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const inspect = selector => {
      const element = document.querySelector(selector), style = getComputedStyle(element), r = element.getBoundingClientRect();
      return { transform: style.transform, opacity: Number(style.opacity), origin: style.transformOrigin,
        x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    };
    return { treasure: inspect('#treasure-row'), objective: inspect('.wave-readout') };
  });
  checker.check('treasure responds to the same HUD scale setting as the objective', layout.treasure.transform === layout.objective.transform && layout.treasure.transform !== 'none', JSON.stringify(layout));
  checker.check('treasure responds to the HUD opacity setting', layout.treasure.opacity === .6 && layout.objective.opacity === .6, JSON.stringify(layout));
  checker.check('scaled treasure stays anchored inside the viewport', layout.treasure.x >= 0 && layout.treasure.right <= 1280 && layout.treasure.bottom <= 720);
  await page.locator('#player-settings [aria-label="Close settings"]').click();
  await page.screenshot({ path: `${dir}/scaled-hud.png` });
  checker.check('settings and lighting checks have no uncaught browser errors', errors.length === 0, errors.join('\n'));
  writeFileSync(`${dir}/measured.json`, JSON.stringify({ light, layout, errors, passed: checker.pass, failed: checker.fail }, null, 2));
  console.log(`${checker.pass} passed, ${checker.fail} failed`);
  if (checker.fail) process.exitCode = 1;
} finally { await browser.close(); }
