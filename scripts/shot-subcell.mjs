// The sub-cell look (postFx.subcell; docs/SANDBOX-MT.md) against the cell-block
// look, on the same settled Sandbox scene: a sand pile, a gold heap, a water
// pool against a pile, gunpowder and snow drifts, an oil slick.
// Writes verify-out/subcell-{off,on}.png (camera zoomed 3x) and a side-by-side
// verify-out/subcell-compare.png of the centre.
// Usage: node scripts/shot-subcell.mjs [--url http://127.0.0.1:5191/] [--zoom 3]
import { launchBrowser } from './browser-launch.mjs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://127.0.0.1:5191/');
const ZOOM = Number(arg('zoom', 3));

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 2400, height: 1500 } });
await page.goto(`${BASE}?threads=4`, { waitUntil: 'networkidle', timeout: 60000 });
await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 30000 });
if (!(await page.locator('#expedition-entry .entry-workshops').evaluate((d) => d.open))) {
  await page.locator('#expedition-entry .entry-workshops > summary').click();
}
await page.locator('#expedition-entry [data-entry="sandbox"]').click();
await page.locator('#expedition-entry').waitFor({ state: 'hidden', timeout: 10000 });
await page.waitForTimeout(800);

await page.evaluate(() => {
  const ctx = window.__game.ctx, world = ctx.world;
  const COL = { 1: 0xd2b45e, 2: 0x1e8ce6, 6: 0x55401e, 8: 0x3a3a3a, 13: 0x606870, 17: 0xf0c030, 27: 0xe8f0f8 };
  const write = (x, y, type) => {
    if (!world.inBounds(x, y)) return;
    const i = world.idx(x, y);
    // the sim tints every cell a little (sim/colors); so does this scene
    const base = type === 0 ? 0x08080c : COL[type] ?? 0x808080, j = () => Math.floor((Math.random() - 0.5) * 22);
    const ch = (v) => Math.max(0, Math.min(255, v + j()));
    world.types[i] = type;
    world.colors[i] = type === 0 || type === 13 ? base : (ch(base >> 16) << 16) | (ch((base >> 8) & 255) << 8) | ch(base & 255);
    world.life[i] = 0; world.charge[i] = 0;
    world.activity.touchIndex(i);
  };
  // real colours with the sim's own per-cell tint: pour from the palette brush if present
  const x0 = 640, x1 = 960, y0 = 700, y1 = 880;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) write(x, y, x === x0 || x === x1 || y === y1 ? 13 : 0);
  // falling columns that settle into piles
  for (let y = y0 + 2; y < y0 + 60; y++) for (let x = 690; x < 700; x++) write(x, y, 1);
  for (let y = y0 + 2; y < y0 + 50; y++) for (let x = 760; x < 767; x++) write(x, y, 17);
  for (let y = y0 + 2; y < y0 + 40; y++) for (let x = 830; x < 836; x++) write(x, y, 8);
  for (let y = y0 + 2; y < y0 + 40; y++) for (let x = 900; x < 906; x++) write(x, y, 27);
  for (let y = y0 + 10; y < y0 + 50; y++) for (let x = 720; x < 745; x++) write(x, y, 2);
  for (let y = y0 + 10; y < y0 + 20; y++) for (let x = 860; x < 880; x++) write(x, y, 6);
  ctx.camera.zoomLock = 1;
});
await page.waitForTimeout(6000); // settle
// freeze, then shoot both looks of the same frame
await page.evaluate((zoom) => {
  const ctx = window.__game.ctx;
  ctx.params.global.simSpeed = 0;
  ctx.camera.zoomLock = zoom;
  // zoom scales about the view centre: centre on the settled piles
  ctx.camera.x = ctx.camera.tx = 800 - 320; ctx.camera.y = ctx.camera.ty = 850 - 180;
}, ZOOM);
await page.mouse.move(2, 2);
await page.waitForTimeout(1200);
const box = await page.locator('#canvas-holder > canvas').boundingBox();
for (const on of [false, true]) {
  await page.evaluate((v) => { window.__game.ctx.state.postFx.subcell = v; }, on);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `verify-out/subcell-${on ? 'on' : 'off'}.png`, clip: box ?? undefined });
}
// airborne: a spray of sand and water falling through open air, frozen mid-flight
await page.evaluate(() => {
  const ctx = window.__game.ctx, world = ctx.world;
  ctx.params.global.simSpeed = 1;
  for (let y = 705; y < 720; y++) for (let x = 740; x < 860; x++) {
    if (Math.random() < 0.35) {
      const i = world.idx(x, y), sand = x < 800;
      world.types[i] = sand ? 1 : 2; world.colors[i] = sand ? 0xd2b45e : 0x1e8ce6; world.life[i] = 0;
      world.activity.touchIndex(i);
    }
  }
});
await page.waitForTimeout(450);
await page.evaluate(() => { window.__game.ctx.params.global.simSpeed = 0; });
await page.waitForTimeout(300);
for (const on of [false, true]) {
  await page.evaluate((v) => { window.__game.ctx.state.postFx.subcell = v; }, on);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `verify-out/subcell-air-${on ? 'on' : 'off'}.png`, clip: box ?? undefined });
}
await browser.close();
execFileSync('python', ['-c', `
from PIL import Image
a = Image.open('verify-out/subcell-off.png').convert('RGB'); b = Image.open('verify-out/subcell-on.png').convert('RGB')
w, h = a.size
box = (int(w*0.0), int(h*0.52), int(w*0.45), int(h*0.78))
a = a.crop(box); b = b.crop(box)
c = Image.new('RGB', (a.width, a.height * 2 + 8), (255, 255, 255)); c.paste(a, (0, 0)); c.paste(b, (0, a.height + 8))
c.save('verify-out/subcell-compare.png')
a = Image.open('verify-out/subcell-air-off.png').convert('RGB'); b = Image.open('verify-out/subcell-air-on.png').convert('RGB')
box = (int(w*0.2), int(h*0.25), int(w*0.8), int(h*0.62))
a = a.crop(box); b = b.crop(box)
c = Image.new('RGB', (a.width, a.height * 2 + 8), (255, 255, 255)); c.paste(a, (0, 0)); c.paste(b, (0, a.height + 8))
c.save('verify-out/subcell-air-compare.png')
`]);
console.log('wrote verify-out/subcell-{off,on,compare}.png');
