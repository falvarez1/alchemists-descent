// Screenshot the upgraded waystone (runestone w/ fire + hieroglyph) and the big
// ornate cauldron. Usage: node scripts/shot-monuments.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
mkdirSync('verify-out', { recursive: true });

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });
await page.waitForTimeout(400);

const shot = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 40; f++) window.__game.tick();
  ctx.levels._transitioning = false;
  const w = ctx.world, p = ctx.player, rt = ctx.levels.current;
  const STONE = 12, WATER = 2, LAVA = 11;
  const bx = 800, groundY = Math.round(p.y) + 2; // fixed, well away from world edges
  p.x = bx;

  for (let y = groundY - 50; y <= groundY + 8; y++) for (let x = bx - 80; x <= bx + 80; x++) w.clearCellAt(w.idx(x, y));
  for (let y = groundY; y <= groundY + 8; y++) for (let x = bx - 80; x <= bx + 80; x++) { const i = w.idx(x, y); w.types[i] = STONE; w.colors[i] = 0x6a6a6a; }

  // CAULDRON: real stone basin so the brew pools + renders; lava burner beside it
  const cauX = bx - 40, cauY = groundY - 1;
  rt.cauldron = { x: cauX, y: cauY };
  for (let dx = -4; dx <= 4; dx++) w.types[w.idx(cauX + dx, cauY + 1)] = STONE;     // basin floor
  for (let t = 0; t <= 2; t++) { w.types[w.idx(cauX - 4, cauY - t)] = STONE; w.types[w.idx(cauX + 4, cauY - t)] = STONE; }
  for (let dy = -2; dy <= 0; dy++) for (let dx = -3; dx <= 3; dx++) { const i = w.idx(cauX + dx, cauY + dy); w.types[i] = WATER; w.colors[i] = 0x3a78c8; }
  for (let dy = 0; dy <= 2; dy++) { const i = w.idx(cauX + 6, cauY + dy); w.types[i] = LAVA; w.colors[i] = 0xff7722; }

  rt.waystones.length = 0;
  rt.waystones.push({ x: bx + 22, y: groundY - 1, lit: true });
  rt.waystones.push({ x: bx + 56, y: groundY - 1, lit: false, heat: 0.5 });

  for (let f = 0; f < 20; f++) { p.dead = false; p.hp = p.maxHp; p.x = bx; p.y = groundY; window.__game.tick(); }
  return { cauX, wsLit: bx + 22, wsUnlit: bx + 56, groundY };
});

// center the play camera on a world point via inspectionFocus + zoom in
const frame = async (fx, fy, name) => {
  const diag = await page.evaluate(({ fx, fy }) => {
    const ctx = window.__game.ctx;
    ctx.camera.zoomLock = 4;
    ctx.camera.setInspectionFocus(fx, fy, { snap: true });
    for (let f = 0; f < 30; f++) { ctx.player.dead = false; ctx.player.hp = ctx.player.maxHp; window.__game.tick(); }
    return { zoom: +ctx.camera.zoom.toFixed(2), camX: ctx.camera.renderX, camY: ctx.camera.renderY };
  }, { fx, fy });
  await page.waitForTimeout(450);
  const holder = await page.$('#canvas-holder');
  const b = await holder.boundingBox();
  const cw = Math.min(440, b.width), chh = Math.min(380, b.height);
  await page.screenshot({
    path: `verify-out/${name}.png`,
    clip: { x: b.x + b.width / 2 - cw / 2, y: b.y + b.height / 2 - chh / 2, width: cw, height: chh },
  });
  console.log(`${name}: zoom=${diag.zoom} cam=(${diag.camX},${diag.camY})`);
};

await frame(shot.cauX, shot.groundY - 8, 'mon-cauldron');
await frame(shot.wsLit, shot.groundY - 16, 'mon-waystone-lit');
await frame(shot.wsUnlit, shot.groundY - 16, 'mon-waystone-unlit');
console.log('errors:', errs.join(' | ') || 'none');
await browser.close();
