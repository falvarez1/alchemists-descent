// Light wave probe (docs/FEEL.md §10): designed darkness, eyeshine, the hooded
// lantern, creatures answering the beam, and the light puzzles — in the real
// game, real renderer. Screenshots land in verify-out/light/.
// Usage: node scripts/probe-light.mjs [url] [--scenes undertow,reveal,...] [--seed 777] [--compose gpu|cpu]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const seed = Number(opt('seed', '777'));
const scenes = opt('scenes', 'undertow').split(',');
const compose = opt('compose', 'gpu');
const out = opt('out', 'verify-out/light');
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const results = {};
let failed = false;
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function shot(name) {
  await page.waitForTimeout(60);
  await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/${name}.png` });
}

/** Run `ticks` real game ticks with the player posed each tick (paused world stepping). */
async function hold(ticks, pose) {
  await page.evaluate(({ ticks, pose }) => {
    const game = window.__game, ctx = game.ctx, p = ctx.player;
    for (let t = 0; t < ticks; t++) {
      if (pose) {
        if (pose.x !== undefined) { p.x = pose.x; p.vx = 0; }
        if (pose.y !== undefined) { p.y = pose.y; p.vy = 0; }
        if (pose.aimX !== undefined) { ctx.input.mouse.x = pose.aimX; ctx.input.mouse.y = pose.aimY; }
      }
      game.tick(false, { forcePaused: true });
    }
  }, { ticks, pose });
}

async function frame(x, y, zoom = 1.6) {
  await page.evaluate(({ x, y, zoom }) => {
    const c = window.__game.ctx;
    c.camera.zoomLock = zoom;
    c.camera.actionFocus = { x, y, zoom };
  }, { x, y, zoom });
}

async function startLevel(level) {
  await execConsoleCommand(page, `run test --level ${level} --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  await page.waitForTimeout(1200);
  await page.evaluate((compose) => {
    const ctx = window.__game.ctx;
    ctx.state.postFx.gpuCompose = compose === 'gpu';
    ctx.state.debugGodMode = true;
    ctx.player.hp = ctx.player.maxHp = 99999;
  }, compose);
  // Let the level title card clear (real-time CSS).
  await page.waitForTimeout(4800);
}

try {
  await page.goto(url);
  await waitForConsoleApi(page);

  if (scenes.includes('undertow')) {
    await startLevel('d1');
    // Stand in the Undertow, aim the beam down the trough.
    const pose = { x: 470, y: 1008, aimX: 700, aimY: 990 };
    await hold(90, pose);
    await frame(560, 960, 1.3);
    await hold(40, pose);
    await shot(`undertow-${compose}`);
    results.undertow = await page.evaluate(() => {
      const ctx = window.__game.ctx, q = ctx.lightQuery;
      return {
        dark: q?.darkness(470, 990), darkMid: q?.darkness(620, 950), darkOut: q?.darkness(200, 300),
        levelFar: q?.level(800, 990), levelNear: q?.level(480, 1000), wandNear: q?.wandLight(480, 1000), wandAim: q?.wandLight(560, 996),
      };
    });
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  console.log(JSON.stringify(results, null, 1));
  if (errors.length) { console.error('PAGE ERRORS:', errors.slice(0, 8)); failed = true; }
  await browser.close();
  process.exit(failed ? 1 : 0);
}
