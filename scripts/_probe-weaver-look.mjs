// Weaver look probe: zoomed freeze-frames of the signature poses (idle
// stance, mid-stride, wall cling) for eyeballing the silhouette against the
// reference art — compact body, long high-arched needle legs.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { getGameViewSize, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
const viewSize = await getGameViewSize(page);
await startConsoleTestRun(page, { settleMs: 400 });

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 320; y <= 560; y++)
    for (let x = 380; x <= 980; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99;
      }
  };
  solid(400, 900, 500, 512); // ground
  solid(430, 470, 380, 512); // wall on the left for the cling shot
  ctx.enemies.length = 0;
  ctx.pickups.length = 0;
  const p = ctx.player;
  p.hp = p.maxHp = 1e6;
  p.x = 820; p.y = 498; p.vx = 0; p.vy = 0;
  ctx.params.global.ambient = 0.55;
  ctx.camera.zoomLock = 2;
});

const shotWeaver = async (name) => {
  const clip = await page.evaluate(({ view }) => {
    const e = window.__game.ctx.enemies.find((f) => f.kind === 'weaver');
    const c = document.querySelector('#canvas-holder > canvas');
    if (!e || !c) return null;
    const r = c.getBoundingClientRect();
    const cam = window.__game.ctx.camera;
    const ux = ((e.x - cam.renderX) / view.w - 0.5) * cam.zoom + 0.5;
    const uy = ((e.y - 10 - cam.renderY) / view.h - 0.5) * cam.zoom + 0.5;
    return {
      x: Math.max(0, r.left + ux * r.width - 260),
      y: Math.max(0, r.top + uy * r.height - 200),
      width: 520,
      height: 400,
    };
  }, { view: viewSize });
  if (clip) await page.screenshot({ path: `verify-out/weaver-look-${name}.png`, clip });
  console.log('shot', name);
};

// 1) idle stance (unaware, standing tall)
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.enemies.length = 0;
  const e = ctx.enemyCtl.spawn('weaver', 640, 494);
  e.sleeping = false;
  ctx.player.x = 820; ctx.player.y = 498;
  ctx.camera.snapTo(660, 460);
});
await page.waitForTimeout(2600);
await shotWeaver('idle');

// 2) mid-stride chase (alerted, moving)
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const e = ctx.enemies.find((f) => f.kind === 'weaver');
  e.alerted = true;
  e.cranky = 300;
});
await page.waitForTimeout(1100);
await shotWeaver('stride');

// 3) wall cling (crawl to the wall on the left)
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.enemies.length = 0;
  const e = ctx.enemyCtl.spawn('weaver', 520, 494);
  e.alerted = true;
  e.cranky = 600;
  e.sleeping = false;
  ctx.player.x = 500; ctx.player.y = 390; // up beyond the wall: it must climb
  ctx.player.vx = 0; ctx.player.vy = 0;
  ctx.camera.snapTo(520, 440);
});
for (let k = 0; k < 100; k++) {
  const clinging = await page.evaluate(() => {
    const e = window.__game.ctx.enemies.find((f) => f.kind === 'weaver');
    return e?.weaverLoco?.mode === 'attached' && Math.abs(e.weaverOrient ?? 0) > 1.0;
  });
  if (clinging) break;
  await page.waitForTimeout(100);
}
await shotWeaver('cling');

await browser.close();
