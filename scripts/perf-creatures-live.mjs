// Live creature render cost: wraps the composer's enemy-draw callback in the
// running game and measures ms/frame spent drawing creatures (and corpses)
// with the perf-scene roster on screen. Usage: node scripts/perf-creatures-live.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url); await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level physics-test --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page); await page.waitForTimeout(3000);
  const res = await page.evaluate(async () => {
    const game = window.__game, ctx = game.ctx, comp = game.composer;
    const p = ctx.player; p.hp = p.maxHp = 999999; p.invuln = 999999;
    ctx.enemies.length = 0;
    const roster = [['slime', -80], ['slime', -60], ['slime', 60], ['slime', 80], ['imp', -50], ['imp', 50], ['imp', 90], ['golem', -90], ['golem', 95],
      ['bat', -30], ['bat', 30], ['bat', 0], ['spitter', -100], ['spitter', 100], ['weaver', 20], ['rootloper', -20]];
    for (const [k, dx] of roster) ctx.enemyCtl.spawn(k, p.x + dx, p.y - 10);
    const orig = comp.drawEnemy;
    let drawMs = 0, draws = 0;
    comp.drawEnemy = (s, l, c, e) => { const t0 = performance.now(); orig(s, l, c, e); drawMs += performance.now() - t0; draws++; };
    const t0 = performance.now(); let frames = 0; let tickMs = 0;
    const origUpdate = ctx.enemyCtl.update.bind(ctx.enemyCtl);
    ctx.enemyCtl.update = (c) => { const a = performance.now(); origUpdate(c); tickMs += performance.now() - a; };
    await new Promise(res => { const step = () => { frames++; if (frames < 300) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    comp.drawEnemy = orig; ctx.enemyCtl.update = origUpdate;
    return { frames, wallMs: performance.now() - t0, drawMsPerFrame: drawMs / frames, drawsPerFrame: draws / frames, enemyTickMsPerFrame: tickMs / frames, alive: ctx.enemies.length };
  });
  console.log(JSON.stringify(res, null, 1));
} finally { await browser.close(); }
