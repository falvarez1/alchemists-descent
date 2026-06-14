// Wave C probes: post-fx render, statuses, brewing e2e, drinking, new enemies.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await startConsoleTestRun(page, { settleMs: 2200 });

// --- 0: post-fx pass renders (not black, not washed out) ---
const px = await page.evaluate(
  () =>
    new Promise((res) => {
      requestAnimationFrame(() => {
        const c = document.querySelector('#canvas-holder > canvas');
        const c2 = document.createElement('canvas');
        c2.width = c.width;
        c2.height = c.height;
        const g = c2.getContext('2d');
        g.drawImage(c, 0, 0);
        const d = g.getImageData(0, 0, c2.width, c2.height).data;
        let nonBlack = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) nonBlack++;
        res(((nonBlack / (d.length / 4)) * 100).toFixed(1));
      });
    }),
);
console.log('post-fx canvas non-black %:', px);
await page.screenshot({ path: 'verify-out/wave-c-1-postfx.png' });

// --- 1: status engine — set the player on fire, then douse ---
const statusProbe = await page.evaluate(async () => {
  const g = window.__game;
  const ctx = g.ctx;
  const p = ctx.player;
  const w = ctx.world;
  const stamp = (t, life) => {
    for (let dx = -5; dx <= 5; dx++)
      for (let dy = 0; dy <= 4; dy++) {
        const i = w.idx(p.x + dx, p.y + 2 + dy - 8);
        w.types[i] = t;
        w.life[i] = life;
      }
  };
  stamp(5, 200); // fire around the body
  await new Promise((r) => setTimeout(r, 400));
  const burning = p.status.burning;
  stamp(2, 0); // douse with water
  await new Promise((r) => setTimeout(r, 400));
  return { burningAfterFire: burning, burningAfterWater: p.status.burning, wet: p.status.wet };
});
console.log('status probe:', JSON.stringify(statusProbe));

// --- 2: brewing e2e at the cauldron ---
const brewProbe = await page.evaluate(async () => {
  const g = window.__game;
  const ctx = g.ctx;
  const c = ctx.levels.current.cauldron;
  if (!c) return { error: 'no cauldron' };
  ctx.player.x = c.x + 10;
  ctx.player.y = c.y;
  ctx.player.hp = ctx.player.maxHp;
  ctx.camera.snapTo(c.x, c.y);
  const w = ctx.world;
  // Ingredients: water + gold in the bowl; flame beside the wall.
  const fill = () => {
    let gold = 0;
    for (let dy = 0; dy >= -1; dy--)
      for (let dx = -3; dx <= 3; dx++) {
        const i = w.idx(c.x + dx, c.y + dy);
        const t = gold < 4 ? 17 : 2;
        if (t === 17) gold++;
        w.types[i] = t;
        w.life[i] = 0;
      }
    // flame hugging the right wall
    for (let dy = -1; dy <= 1; dy++) {
      const i = w.idx(c.x + 5, c.y + dy);
      w.types[i] = 5;
      w.life[i] = 250;
    }
  };
  const before = ctx.state.score;
  for (let t = 0; t < 90; t++) {
    fill();
    await new Promise((r) => setTimeout(r, 100));
    // count elixir cells (21) in bowl
    let elixir = 0;
    for (let dy = -2; dy <= 0; dy++)
      for (let dx = -3; dx <= 3; dx++)
        if (w.types[w.idx(c.x + dx, c.y + dy)] === 21) elixir++;
    if (elixir > 4) return { brewed: true, elixir, scoreDelta: ctx.state.score - before, ticks: t };
  }
  return { brewed: false };
});
console.log('brew probe:', JSON.stringify(brewProbe));
await page.screenshot({ path: 'verify-out/wave-c-2-brew.png' });

// --- 3: drink the elixir (siphon from bowl first) ---
const drinkProbe = await page.evaluate(async () => {
  const g = window.__game;
  const ctx = g.ctx;
  // cheat the flask directly: it stores material 21 (ElixirLife)
  ctx.flask.state.material = 21;
  ctx.flask.state.count = 60;
  ctx.input.drinkHeld = true;
  await new Promise((r) => setTimeout(r, 600));
  ctx.input.drinkHeld = false;
  return { regen: ctx.player.status.regen, flaskLeft: ctx.flask.state.count };
});
console.log('drink probe:', JSON.stringify(drinkProbe));

// --- 4: new enemies spawn + render ---
const enemyProbe = await page.evaluate(async () => {
  const g = window.__game;
  const ctx = g.ctx;
  const p = ctx.player;
  ctx.enemyCtl.spawn('acidslime', p.x - 30, p.y - 10);
  ctx.enemyCtl.spawn('wisp', p.x + 30, p.y - 20);
  ctx.enemyCtl.spawn('mage', p.x + 50, p.y - 10);
  await new Promise((r) => setTimeout(r, 1200));
  const kinds = ctx.enemies.map((e) => e.kind);
  return {
    kinds: kinds.filter((k) => ['acidslime', 'wisp', 'mage'].includes(k)),
    total: ctx.enemies.length,
  };
});
console.log('enemy probe:', JSON.stringify(enemyProbe));
await page.waitForTimeout(800);
await page.screenshot({ path: 'verify-out/wave-c-3-enemies.png' });

console.log('page errors:', pageErrors.length ? JSON.stringify(pageErrors) : 'none');
await browser.close();
