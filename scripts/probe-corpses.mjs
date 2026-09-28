// Corpse probe: spawn creatures in a carved arena (with a water trough), kill
// them with a sideways blow and capture the remains falling, settling and
// finally melting back into grid cells. Usage: node scripts/probe-corpses.mjs [url] [--kinds a,b]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const kinds = opt('kinds', 'spitter,golem,slime,bat,weaver,rillback').split(',');
const out = 'verify-out/corpses'; mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, `run test --level ${opt('level', 'physics-test')} --world campaign-level --seed 777 --loadout fresh`);
  await waitForRunReady(page); await page.waitForTimeout(3200); // let the settled findability repair run before we carve
  const info = await page.evaluate((kinds) => {
    const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
    ctx.enemies.length = 0;
    if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0; // parked: the arena is ours
    const cx = Math.max(260, Math.min(w.width - 260, Math.floor(p.x))), floor = Math.max(170, Math.min(w.height - 30, Math.floor(p.y)));
    for (let y = floor - 120; y <= floor + 8; y++) for (let x = cx - 200; x <= cx + 200; x++) {
      if (!w.inBounds(x, y)) continue;
      const wall = y > floor || y < floor - 114 || x < cx - 192 || x > cx + 192;
      const pool = !wall && y > floor - 16 && x > cx + 80 && x < cx + 180;
      const ledge = !wall && y > floor - 30 && y <= floor - 26 && x > cx - 120 && x < cx - 60;
      w.replaceCellAt(w.idx(x, y), wall || ledge ? 12 : pool ? 2 : 0, wall || ledge ? 0x565d63 : pool ? 0x2a5f8a : 0);
    }
    p.x = cx - 170; p.y = floor; p.hp = p.maxHp = 9999;
    const spawned = kinds.map((k, i) => {
      const x = cx - 150 + i * (300 / kinds.length);
      const y = k === 'bat' ? floor - 60 : k === 'rillback' ? floor - 4 : k === 'spitter' ? floor - 31 : floor;
      return ctx.enemyCtl.spawn(k, k === 'rillback' ? cx + 120 : k === 'spitter' ? cx - 90 : x, y);
    });
    ctx.camera.zoomLock = 2; ctx.camera.actionFocus = { x: cx, y: floor - 40, zoom: 2 };
    window.__corpseTest = spawned;
    return { cx, floor, n: spawned.filter(Boolean).length };
  }, kinds);
  await page.waitForTimeout(1500);
  await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/0-alive.png` });
  await page.evaluate(() => { const ctx = window.__game.ctx; for (const e of window.__corpseTest) if (e && ctx.enemies.includes(e)) ctx.enemyCtl.kill(e, 2.5, -1.5); });
  for (const [ms, name] of [[250, '1-falling'], [1500, '2-settled'], [5000, '3-resting']]) {
    await page.waitForTimeout(ms);
    await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/${name}.png` });
  }
  const mid = await page.evaluate(async () => { const { corpses } = await import('/src/creatures/corpses.ts'); return corpses().length; });
  await page.waitForTimeout(8000);
  await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/4-melted.png` });
  writeFileSync(`${out}/probe.json`, JSON.stringify({ info, mid, errors }, null, 1));
  console.log(JSON.stringify({ info, errors }));
} finally { await browser.close(); }
