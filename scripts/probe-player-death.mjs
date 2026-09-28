// Player death probe: runs the real death (ragdoll, slow-mo, camera, overlay)
// mid-stride in an authored arena and captures the sequence.
// Usage: node scripts/probe-player-death.mjs [url] [--tag name] [--vx 1.8] [--vy -2]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const tag = opt('tag', 'death'), vx = Number(opt('vx', '1.8')), vy = Number(opt('vy', '-2.4'));
const out = 'verify-out/player-death'; mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level physics-test --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page); await page.waitForTimeout(2500);
  await page.evaluate(([vx, vy]) => {
    const ctx = window.__game.ctx, p = ctx.player;
    ctx.enemies.length = 0;
    p.vx = vx; p.vy = vy; p.grounded = false; p.y -= 2;
    ctx.playerCtl.kill('slime-bite');
  }, [vx, vy]);
  const stamps = [60, 250, 600, 1100, 1800, 2800, 4200];
  let last = 0;
  for (const t of stamps) {
    await page.waitForTimeout(t - last); last = t;
    await page.screenshot({ path: `${out}/${tag}-${String(t).padStart(4, '0')}ms.png` });
  }
  writeFileSync(`${out}/${tag}.json`, JSON.stringify({ errors }, null, 1));
  console.log(JSON.stringify({ errors }));
} finally { await browser.close(); }
