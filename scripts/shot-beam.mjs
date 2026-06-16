// Eyeball screenshots of the wand beam in a dark corridor — captures the main
// WebGL render canvas (the 1050x714 one), forcing the play view.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1200);

// tag the main render canvas so we can screenshot exactly it
await page.evaluate(() => {
  const main = [...document.querySelectorAll('canvas')].find((c) => c.width === 1050 && c.height === 714);
  if (main) main.id = 'main-render-canvas';
});

const setup = async (aim) => {
  await page.evaluate((aim) => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const Stone = 12,
      Empty = 0;
    const PX = 600,
      PY = 500;
    ctx.params.global.ambient = 0.08;
    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.state.playerSpawned = true;
    if (ctx.fx) ctx.fx.hitstop = 0;
    if (ctx.player.status) ctx.player.status.torch = 0;
    if (ctx.player.perks) ctx.player.perks.torchbearer = false;
    ctx.projectiles.length = 0;
    ctx.enemies.length = 0;
    w.clear();
    w.simBounds.x0 = 0;
    w.simBounds.y0 = 0;
    w.simBounds.x1 = w.width - 1;
    w.simBounds.y1 = w.height - 1;
    const X0 = PX - 252,
      X1 = PX + 252;
    for (let x = X0; x <= X1; x++) {
      for (let y = PY - 90; y <= PY + 90; y++) {
        const i = w.idx(x, y);
        // textured floor/ceiling so the light reads on the corridor surfaces
        const tunnel = y >= PY - 16 && y <= PY + 14;
        w.types[i] = tunnel ? Empty : Stone;
        const shade = 0x40 + ((x * 7 + y * 13) % 24);
        w.colors[i] = tunnel ? 0 : (shade << 16) | ((shade - 6) << 8) | (shade - 12);
      }
    }
    const p = ctx.player;
    p.x = PX;
    p.y = PY;
    p.dead = false;
    p.aimAngle = aim;
    p.facing = Math.cos(aim) >= 0 ? 1 : -1;
    p.vx = p.vy = 0;
    p.fx = p.fy = 0;
    // pin the camera so all three shots frame the same corridor
    ctx.camera.x = PX;
    ctx.camera.y = PY;
  }, aim);
  // drive several real frames so the camera settles and lighting rebuilds
  for (let k = 0; k < 12; k++) {
    await page.evaluate(() => window.__game.tick && window.__game.tick());
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
};

const canvas = await page.$('#main-render-canvas');
await setup(0);
await canvas.screenshot({ path: 'beam-right.png' });
await setup(Math.PI);
await canvas.screenshot({ path: 'beam-left.png' });
await setup(-Math.PI / 2);
await canvas.screenshot({ path: 'beam-up.png' });

// Spark Bolt streak: aim the wand UP (beam into the ceiling, out of the way),
// fire a bolt down the corridor near the floor, and catch it mid-flight so its
// glow rakes the floor/walls it passes.
await setup(-Math.PI / 2);
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.projectiles.length = 0;
  ctx.projectiles.push({
    x: 600 - 150,
    y: 500 + 8,
    vx: 8, // new unmodified base Spark Bolt speed
    vy: 0,
    type: 'bolt',
    life: 180,
    age: 0,
    charging: false,
    hostile: false,
  });
});
for (let k = 0; k < 14; k++) {
  await page.evaluate(() => window.__game.tick && window.__game.tick());
  await page.waitForTimeout(16);
}
await canvas.screenshot({ path: 'bolt-streak.png' });

// Occlusion test: a stone pillar in the aim cone. The occluded beam throws a
// hard shadow behind it; the non-occluded ambient glow should lift that shadow
// (and the pillar's far face) to a faint readable wash — without erasing the
// shadow contrast.
await setup(0);
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const Stone = 12;
  const PX = 600,
    PY = 500;
  // a freestanding pillar ~55 cells ahead, inside the corridor
  for (let x = PX + 52; x <= PX + 60; x++) {
    for (let y = PY - 14; y <= PY + 14; y++) {
      const i = w.idx(x, y);
      w.types[i] = Stone;
      const shade = 0x46 + ((x * 7 + y * 13) % 22);
      w.colors[i] = (shade << 16) | ((shade - 6) << 8) | (shade - 12);
    }
  }
});
for (let k = 0; k < 8; k++) {
  await page.evaluate(() => window.__game.tick && window.__game.tick());
  await page.waitForTimeout(16);
}
await canvas.screenshot({ path: 'glow-pillar.png' });
console.log('wrote beam-right.png / beam-left.png / beam-up.png / bolt-streak.png / glow-pillar.png');
await browser.close();
