// Scratch diagnostic: floor-chase scenario with loco internals dumped.
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { settleMs: 400 });

// EXACT structure of verify-weaver-loco.mjs: setup evaluate with window
// helpers, then a scenario evaluate, then a separate spawn evaluate.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 320; y <= 560; y++) {
    for (let x = 380; x <= 980; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  }
  window.__solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99; w.life[i] = 0; w.charge[i] = 0;
      }
  };
  ctx.enemies.length = 0;
  const p = ctx.player;
  p.hp = p.maxHp = 1e6;
});
const noSilk = process.env.NO_SILK === '1';
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__solid(400, 900, 500, 540); // ground
  window.__solid(600, 640, 400, 512); // pillar
  const p = ctx.player;
  p.x = 730; p.y = 498; p.vx = 0; p.vy = 0;
  ctx.camera.snapTo(640, 450);
});
await page.evaluate((noSilk) => {
  const ctx = window.__game.ctx;
  ctx.enemies.length = 0;
  if (noSilk) {
    ctx.enemyCtl.weaveFootTrail = () => {};
  }
  const e = ctx.enemyCtl.spawn('weaver', 620, 396);
  e.alerted = true;
  e.sleeping = false;
}, noSilk);

for (let k = 0; k < 20; k++) {
  const s = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const e = ctx.enemies.find((f) => f.kind === 'weaver');
    if (!e) return 'no weaver';
    const l = e.weaverLoco;
    const sim = ctx.world.simBounds;
    return {
      x: e.x, y: e.y, px: ctx.player.x,
      cam: { x: Math.round(ctx.camera.x), y: Math.round(ctx.camera.y) },
      sim: { x0: sim.x0, x1: sim.x1, y0: sim.y0, y1: sim.y1 },
      dbg: ctx.debug?.active === true,
      state: { alerted: e.alerted, cranky: e.cranky, windup: e.windup, blink: e.blink, recoil: e.recoil, fleeT: e.fleeT, timer: e.timer },
      loco: l
        ? {
            mode: l.mode, sx: +l.sx.toFixed(1), sy: +l.sy.toFixed(1),
            nx: +l.nx.toFixed(2), ny: +l.ny.toFixed(2), dir: l.dir, face: l.face,
            speed: +l.speed.toFixed(2), blocked: l.blocked, gap: l.gapAhead,
            deep: { dir: l.deepDir, best: l.deepBest === Infinity ? 'inf' : +l.deepBest.toFixed(1), hold: +l.deepHold.toFixed(1), age: l.deepAge },
            recover: l.recoverT, planted: l.legs.filter((g) => g.planted).length,
          }
        : 'none',
    };
  });
  console.log(JSON.stringify(s));
  await page.waitForTimeout(400);
}
await browser.close();
