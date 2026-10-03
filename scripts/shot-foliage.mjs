// Foreground/background foliage, in-game, for the eye. Dev server running:
//   node scripts/shot-foliage.mjs [url] [outDir] [levels=d1,d2,d3,d4] [seed=1337]
// For each floor it frames up to four foreground clumps (player beside one of
// them), plus one shot with the player standing inside a clump. Writes PNGs.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, startConsoleTestRun } from './run-helpers.mjs';
import { takeArrivalGift } from './lock-probe-helpers.mjs';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5191/'); url.searchParams.set('link', 'off');
const dir = process.argv[3] ?? 'verify-out/foliage-shots'; mkdirSync(dir, { recursive: true });
const levels = (process.argv[4] ?? 'd1,d2,d3,d4').split(',');
const seed = Number(process.argv[5] ?? 1337);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', e => console.log('pageerror', String(e)));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 60000 });
  await leaveTitleIfShown(page);
  for (const level of levels) {
    await startConsoleTestRun(page, { level, world: 'campaign-level', seed, settleMs: 1500, timeout: 60000 });
    await page.waitForFunction(() => window.__game.composer.layers.ready);
    await page.addStyleTag({ content: '#wave-banner, #toast-stack, .hint-teach-overlay { visibility: hidden !important; }' });
    await takeArrivalGift(page);
    const spots = await page.evaluate(async () => {
      const ctx = window.__game.ctx;
      ctx.state.arrivalGraceUntil = 0; ctx.player.godMode = true; ctx.enemies.length = 0;
      const { surfaceFoliageInBounds } = await import('/src/game/SurfaceFoliage.ts');
      const roots = surfaceFoliageInBounds(ctx.world, 0, 0, ctx.world.width, ctx.world.height);
      const front = roots.filter(p => p.foreground);
      const picks = [];
      for (const p of front) if (picks.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 260)) picks.push({ x: p.x, y: p.y });
      return { picks: picks.slice(0, 4), front: front.length, all: roots.length,
        biome: ctx.levels.current.biome, step: window.__game.composer.pixelStep };
    });
    console.log(level, JSON.stringify({ front: spots.front, all: spots.all, biome: spots.biome, step: spots.step }));
    let n = 0;
    for (const spot of spots.picks) {
      await page.evaluate(({ x, y, inside }) => {
        const ctx = window.__game.ctx;
        Object.assign(ctx.player, { x: inside ? x : x - 26, y, vx: 0, vy: 0 });
        ctx.camera.zoomLock = 1.7; ctx.camera.snapTo(x, y - 20);
        ctx.state.paused = false;
      }, { ...spot, inside: n === 0 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${dir}/${level}-${n}.png` });
      n++;
    }
  }
} finally { await browser.close(); }
