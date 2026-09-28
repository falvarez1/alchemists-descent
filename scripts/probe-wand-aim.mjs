// The wand must point where it shoots. Casts at a fan of cursor angles in the
// physics-test arena, reads back the drawn skeleton's wand angle and the shot's
// actual heading, and saves a close crop of each cast.
// Usage: node scripts/probe-wand-aim.mjs [url]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5173/';
const out = 'verify-out/wand-aim'; mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
let fail = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level physics-test --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page); await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const c = window.__game.ctx; c.player.x += 230; c.camera.zoomLock = 2.6; c.enemies.length = 0; c.state.debugGodMode = true;
    c.player.mana = c.player.maxMana ?? 999;
  });
  // Crops show the world only: the arena's waystone prompt would sit on top.
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } #canvas-holder > canvas { visibility: visible !important }' });
  await page.waitForTimeout(700);
  for (const deg of [-150, -170, 175, 160, -60, -20, 10, 35, 80]) {
    const r = await page.evaluate(async (deg) => {
      const c = window.__game.ctx, p = c.player, a = deg * Math.PI / 180;
      c.state.paused = false; // a pickup card overlay pauses the run
      c.input.mouse.x = p.x + Math.cos(a) * 80; c.input.mouse.y = p.y - 9 + Math.sin(a) * 80;
      const before = new Set(c.projectiles);
      c.input.mouse.down = true; p.firing = true;
      await new Promise(res => setTimeout(res, 140));
      const shot = c.projectiles.find(q => !before.has(q));
      const heading = shot ? Math.atan2(shot.vy, shot.vx) * 180 / Math.PI : null;
      const pose = c.player.costume?.skel ?? null;
      return { aim: +(p.aimAngle * 180 / Math.PI).toFixed(1), heading: heading === null ? null : +heading.toFixed(1),
        wand: pose ? +(pose.wand.angle * 180 / Math.PI).toFixed(1) : null };
    }, deg);
    await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/cast_${deg}.png` });
    await page.evaluate(() => { const c = window.__game.ctx; c.input.mouse.down = false; c.player.firing = false; });
    await page.waitForTimeout(260);
    const diff = (x, y) => Math.abs(((x - y + 540) % 360) - 180);
    const ok = r.wand !== null && diff(r.wand, r.aim) < 1;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} cursor ${deg}°: aim ${r.aim}° wand ${r.wand}° shot heading ${r.heading}°`);
  }
  if (errors.length) { fail++; console.log(errors.join('\n')); }
} finally { await browser.close(); }
process.exit(fail ? 1 : 0);
