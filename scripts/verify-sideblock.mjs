// Repro: standing on a crate's RIGHT face and pressing RIGHT must NOT teleport the
// player to the crate's LEFT (the side-resolution face-selection bug). Real input.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5219/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(400);

const setup = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 30; f++) window.__game.tick();
  // a heavy crate on clear floor at x=400
  const c = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, 400, 695, { material: 'stone', friction: 0.6, restitution: 0.1 });
  for (let f = 0; f < 40; f++) window.__game.tick(); // settle
  const ex = 3.5;
  const p = ctx.player;
  // stand the player flush against the crate's RIGHT face, on the floor
  p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false; p.diveT = 0;
  p.x = Math.round(c.x + ex + 4); p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  for (let f = 0; f < 5; f++) window.__game.tick();
  return { crateX: +c.x.toFixed(1), startX: +p.x.toFixed(1) };
});

const canvas = await page.$('canvas');
if (canvas) { const box = await canvas.boundingBox(); if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }

await page.keyboard.down('d'); // press RIGHT
const r = await page.evaluate((crateX) => {
  const p = window.__game.ctx.player;
  let minX = p.x, maxX = p.x;
  const xs = [];
  for (let f = 0; f < 24; f++) {
    window.__game.tick();
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    if (f % 4 === 0) xs.push(+p.x.toFixed(1));
  }
  return { minX: +minX.toFixed(1), maxX: +maxX.toFixed(1), endX: +p.x.toFixed(1), crateX, xs };
}, setup.crateX);
await page.keyboard.up('d');

console.log('crateX:', setup.crateX, 'startX:', setup.startX, '->', JSON.stringify(r));
// teleport bug = the player jumps to the LEFT of the crate centre
const teleported = r.minX < setup.crateX;
console.log(`\nTELEPORT-TO-LEFT BUG: ${teleported ? 'YES (minX ' + r.minX + ' < crateX ' + setup.crateX + ')' : 'no'}`);
console.log(`moved right as expected: ${r.maxX > setup.startX ? 'yes' : 'NO'}`);
console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
process.exit(teleported ? 1 : 0);
