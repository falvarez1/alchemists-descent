// A floor's look, in the real renderer: a blueprint of the whole level (colors
// plane, with its placed set pieces boxed and labelled) plus lit, in-game
// camera frames at the spawn, at every placed set piece and at the boss.
// THE eyeball pass for a procedural floor. Usage:
//   node scripts/shot-floor.mjs <levelId> [--seed=N] [--url=...] [--out=dir]
//     [--zoom=Z] [--at=x,y;x,y] (extra frames) [--no-pieces]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const url = opt('url', 'http://localhost:5173/');
const seed = Number(opt('seed', '7'));
const outDir = opt('out', 'verify-out');
const zoom = Number(opt('zoom', '1.6'));
const extra = opt('at', '').split(';').filter(Boolean).map((p) => p.split(',').map(Number));
const pieces = !args.includes('--no-pieces');
const id = args.find((a) => !a.startsWith('--')) ?? 'd2';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { seed, level: id, settleMs: 600 });

const info = await page.evaluate(async ({ ID }) => {
  const ctx = window.__game.ctx;
  if (ctx.levels.current?.def?.id !== ID) {
    ctx.levels.leaveLevel();
    ctx.levels.enterLevel(ctx, ID);
    await new Promise((r) => setTimeout(r, 800));
  }
  const rt = ctx.levels.current;
  return {
    id: rt.def.id,
    biome: rt.def.biome,
    spawn: rt.spawn,
    boss: rt.boss,
    portal: rt.portal ? { x: rt.portal.x, y: rt.portal.y } : null,
    placed: (rt.placedPrefabs ?? []).map((p) => ({ id: p.id, x: Math.round((p.x0 + p.x1) / 2), y: Math.round((p.y0 + p.y1) / 2), x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 })),
    enemies: ctx.enemies.map((e) => e.kind),
  };
}, { ID: id });
console.log(JSON.stringify({ ...info, placed: info.placed.map((p) => `${p.id}@${p.x},${p.y}`) }));

// Blueprint.
const blue = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world, DS = 2;
  const ow = Math.floor(w.width / DS), oh = Math.floor(w.height / DS);
  const canvas = document.createElement('canvas');
  canvas.width = ow; canvas.height = oh;
  const g = canvas.getContext('2d');
  const img = g.createImageData(ow, oh);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const c = w.colors[x * DS + y * DS * w.width];
    const o = (x + y * ow) * 4;
    img.data[o] = (c >> 16) & 0xff; img.data[o + 1] = (c >> 8) & 0xff; img.data[o + 2] = c & 0xff; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const rt = ctx.levels.current;
  g.font = '11px monospace';
  for (const p of rt.placedPrefabs ?? []) {
    g.strokeStyle = 'rgba(255,220,120,0.9)';
    g.strokeRect(p.x0 / DS, p.y0 / DS, (p.x1 - p.x0) / DS, (p.y1 - p.y0) / DS);
    g.fillStyle = 'rgba(255,220,120,1)';
    g.fillText(p.id, p.x0 / DS, p.y0 / DS - 2);
  }
  g.fillStyle = '#ff00ff';
  g.fillRect(rt.spawn.x / DS - 3, rt.spawn.y / DS - 3, 7, 7);
  if (rt.boss) { g.fillStyle = '#ff2020'; g.fillRect(rt.boss.x / DS - 5, rt.boss.y / DS - 5, 11, 11); }
  if (rt.portal) { g.fillStyle = '#ffd040'; g.fillRect(rt.portal.x / DS - 4, rt.portal.y / DS - 4, 9, 9); }
  g.fillStyle = '#ff6060';
  for (const e of ctx.enemies) g.fillRect(e.x / DS - 1, e.y / DS - 1, 3, 3);
  return canvas.toDataURL('image/png');
});
writeFileSync(`${outDir}/floor-${id}-s${seed}-blueprint.png`, Buffer.from(blue.split(',')[1], 'base64'));

const frame = async (fx, fy, name) => {
  await page.evaluate(({ fx, fy, zoom }) => {
    const ctx = window.__game.ctx;
    ctx.state.debugGodMode = true;
    ctx.player.x = fx; ctx.player.y = fy;
    ctx.player.vx = 0; ctx.player.vy = 0;
    ctx.camera.zoomLock = zoom;
    ctx.camera.setInspectionFocus(fx, fy - 10, { snap: true });
  }, { fx, fy, zoom });
  await page.waitForTimeout(900);
  const holder = await page.$('#canvas-holder');
  const b = await holder.boundingBox();
  await page.screenshot({ path: `${outDir}/floor-${id}-s${seed}-${name}.png`, clip: { x: b.x, y: b.y, width: b.width, height: b.height } });
};

await frame(info.spawn.x, info.spawn.y, 'spawn');
if (pieces) {
  for (const p of info.placed) await frame(p.x, p.y, p.id.replace(/[^a-z0-9-]/gi, '_'));
  if (info.boss) await frame(info.boss.x, info.boss.y - 10, 'boss');
  if (info.portal) await frame(info.portal.x, info.portal.y, 'portal');
}
for (let k = 0; k < extra.length; k++) await frame(extra[k][0], extra[k][1], `at${k}`);
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
