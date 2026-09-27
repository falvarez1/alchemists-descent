// Live player look: drives the alchemist's real input (run, jump, cast) in the
// physics-test arena at a close camera and captures frames under real lighting.
// Usage: node scripts/probe-player-live.mjs [url] [--zoom 2.4]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const zoom = Number(opt('zoom', '2.4'));
const out = 'verify-out/player-live'; mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level physics-test --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page); await page.waitForTimeout(2500);
  await page.evaluate((z) => { const c = window.__game.ctx; c.player.x += 230; c.camera.zoomLock = z; c.enemies.length = 0; c.enemyCtl.spawn('spitter', c.player.x + 110, c.player.y - 4); }, zoom);
  const shot = async (name) => page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/${name}.png` });
  const keys = async (patch) => page.evaluate((p) => Object.assign(window.__game.ctx.input.keys, p), patch);
  await page.waitForTimeout(600); await shot('0-idle');
  await keys({ right: true }); await page.waitForTimeout(450); await shot('1-run');
  await keys({ jump: true }); await page.waitForTimeout(220); await shot('2-jump'); await keys({ jump: false });
  await page.waitForTimeout(500); await shot('3-fall');
  await keys({ right: false }); await page.waitForTimeout(700);
  await page.evaluate(() => { const c = window.__game.ctx; c.input.mouse.x = c.player.x + 60; c.input.mouse.y = c.player.y - 30; c.input.mouse.down = true; });
  await page.waitForTimeout(260); await shot('4-cast');
  await page.evaluate(() => { window.__game.ctx.input.mouse.down = false; });
  console.log(JSON.stringify({ errors }));
} finally { await browser.close(); }
