// Screenshot of the flask siphon (hold E) effect — the pull-beam, cursor node,
// suck-streaks, and the new drained-patch light.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const main = [...document.querySelectorAll('canvas')].find((c) => c.width === 1050 && c.height === 714);
  if (main) main.id = 'main-render-canvas';
});

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const Stone = 12,
    Sand = 1,
    Empty = 0;
  const PX = 600,
    PY = 500;
  ctx.params.global.ambient = 0.08;
  ctx.state.mode = 'play';
  ctx.state.paused = false;
  ctx.state.playerSpawned = true;
  if (ctx.fx) ctx.fx.hitstop = 0;
  ctx.projectiles.length = 0;
  ctx.enemies.length = 0;
  w.clear();
  w.simBounds.x0 = 0;
  w.simBounds.y0 = 0;
  w.simBounds.x1 = w.width - 1;
  w.simBounds.y1 = w.height - 1;
  // a room with a floor; aim the wand away (up) so the siphon tell stands alone
  const X0 = PX - 120,
    X1 = PX + 120;
  for (let x = X0; x <= X1; x++) {
    for (let y = PY - 80; y <= PY + 80; y++) {
      const i = w.idx(x, y);
      const solid = y > PY + 14;
      w.types[i] = solid ? Stone : Empty;
      w.colors[i] = solid ? 0x554f48 : 0;
    }
  }
  // a sand mound on the floor ~38 cells to the right (within siphon reach, LOS clear)
  for (let x = PX + 30; x <= PX + 46; x++) {
    for (let y = PY + 4; y <= PY + 14; y++) {
      const i = w.idx(x, y);
      w.types[i] = Sand;
      const s = 0xc8 + ((x * 5 + y * 3) % 24);
      w.colors[i] = (s << 16) | ((s - 24) << 8) | (s - 80);
    }
  }
  const p = ctx.player;
  p.x = PX;
  p.y = PY;
  p.dead = false;
  p.aimAngle = -Math.PI / 2; // wand points up, out of the way
  p.vx = p.vy = 0;
  p.fx = p.fy = 0;
  ctx.camera.x = PX;
  ctx.camera.y = PY;
  // hold E: siphon the sand mound
  ctx.input.siphonHeld = true;
  ctx.input.mouse.x = PX + 38;
  ctx.input.mouse.y = PY + 9;
});

// drive frames so streaks spawn and lighting rebuilds; keep re-asserting the
// cursor/hold each tick (some systems clear input on transitions)
for (let k = 0; k < 24; k++) {
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.input.siphonHeld = true;
    ctx.input.mouse.x = 600 + 38;
    ctx.input.mouse.y = 500 + 9;
    window.__game.tick && window.__game.tick();
  });
  await page.waitForTimeout(16);
}

const canvas = await page.$('#main-render-canvas');
await canvas.screenshot({ path: 'siphon.png' });
const taken = await page.evaluate(() => window.__game.ctx.flask.state.count);
console.log('wrote siphon.png — flask count =', taken);
await browser.close();
