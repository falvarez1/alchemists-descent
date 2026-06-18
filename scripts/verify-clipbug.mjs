// Repro: in the PHYSICS TEST playground, walking the player into a crate-yard box
// clips him through the floor and he falls (+ a constant sound). Drives REAL input.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5219/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(400);

// load the playground + settle
const setup = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 90; f++) window.__game.tick();
  const p = ctx.player;
  const near = ctx.rigidBodies.bodies
    .filter((b) => b.kind === 'dynamic' && Math.abs(b.x - 130) < 80 && b.y < 705)
    .map((b) => ({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), bB: +(b.y + (b.shape.halfH ?? b.shape.radius ?? 0)).toFixed(1), mat: b.material }));
  return { spawnX: +p.x.toFixed(1), spawnY: +p.y.toFixed(1), grounded: p.grounded, FY: 700, crates: near };
});
console.log('spawn:', JSON.stringify(setup));

// focus the canvas so keyboard events land
const canvas = await page.$('canvas');
if (canvas) { const box = await canvas.boundingBox(); if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }

async function walk(dir, frames) {
  const key = dir === 'right' ? 'd' : 'a';
  await page.keyboard.down(key);
  const trace = await page.evaluate((n) => {
    const ctx = window.__game.ctx;
    const p = ctx.player;
    const w = ctx.world;
    const rows = [];
    let clippedAtF = -1;
    let maxY = p.y;
    let floorDump = null;
    for (let f = 0; f < n; f++) {
      window.__game.tick();
      const rx = Math.round(p.x);
      maxY = Math.max(maxY, p.y);
      if (clippedAtF < 0 && (p.dead || (p.y > 715 && p.vy > 0))) clippedAtF = f;
      if (f <= 10) rows.push({
        f, x: p.x, y: p.y, vy: +p.vy.toFixed(2), g: p.grounded ? 1 : 0,
        efInt: ctx.physics.entityFree(Math.floor(p.x), Math.floor(p.y) + 1, 4, 1) ? 1 : 0,
        efRaw: ctx.physics.entityFree(p.x, p.y + 1, 4, 1) ? 1 : 0,
      });
      if (f === 5) {
        floorDump = { atX: rx, y700: [], y701: [] };
        for (let x = rx - 8; x <= rx + 8; x++) { floorDump.y700.push(w.types[w.idx(x, 700)]); floorDump.y701.push(w.types[w.idx(x, 701)]); }
      }
    }
    return { endX: +p.x.toFixed(1), endY: +p.y.toFixed(1), maxY: +maxY.toFixed(1), clippedAtF, dead: p.dead, rows, floorDump };
  }, frames);
  await page.keyboard.up(key);
  await page.evaluate(() => { for (let f = 0; f < 30; f++) window.__game.tick(); });
  return trace;
}

const right = await walk('right', 120);
console.log('walk RIGHT (toward stone/metal crates):', JSON.stringify(right));

// re-home the player on the floor at spawn before the second test
await page.evaluate((sx) => { const p = window.__game.ctx.player; p.x = sx; p.y = 699; p.vx = p.vy = 0; p.dead = false; for (let f = 0; f < 20; f++) window.__game.tick(); }, setup.spawnX);
const left = await walk('left', 120);
console.log('walk LEFT (toward wood crate):', JSON.stringify(left));

const clipped = right.clippedAtF >= 0 || left.clippedAtF >= 0 || right.dead || left.dead;
console.log(`\nFLOOR CLIP REPRODUCED: ${clipped ? 'YES' : 'no'}`);
console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
process.exit(clipped || errs.length > 0 ? 1 : 0);
