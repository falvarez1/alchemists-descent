// Before/after captures for the Sandbox MT prototype (docs/SANDBOX-MT.md), read
// from the game's NATIVE render pixels (not a CSS-scaled screenshot: the
// windowed Sandbox shows the canvas smaller than it renders, which hides
// half-cell detail). Frozen frames, so before and after are the same world.
//   look-*    postFx.subcell off vs on: settled piles/pools, a mid-air spray
//   mt-*      serial vs parallel sweep, same scene, same tick count
// Writes verify-out/compare/*.png plus crops (x4/x3 nearest) and change masks.
// Usage: node scripts/shot-sandbox-mt-compare.mjs [--url http://127.0.0.1:5191/]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launchBrowser } from './browser-launch.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://127.0.0.1:5191/');
const OUT = 'verify-out/compare';
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}?threads=4`, { waitUntil: 'networkidle', timeout: 60000 });
await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 30000 });
await page.locator('#expedition-entry [data-entry="workshops"]').click();
await page.locator('#expedition-entry [data-entry="sandbox"]').click();
await page.locator('#expedition-entry').waitFor({ state: 'hidden', timeout: 10000 });
await page.waitForTimeout(800);
await page.mouse.move(2, 2);

// ------------------------------------------------------------ page helpers
await page.evaluate(() => {
  const ctx = window.__game.ctx, world = ctx.world;
  const r = (n) => Math.floor(Math.random() * n);
  const pack = (a, b, c) => (a << 16) | (b << 8) | c;
  // the sim's own colour factories (sim/colors.ts), with Math.random for fxRandom
  const COLOR = {
    1: () => { const v = Math.random(), t = Math.random(), u = Math.random();
      if (v < 0.16) return pack(156 + (t * 22 | 0), 118 + (t * 18 | 0), 68 + (u * 14 | 0));
      if (v < 0.9) return pack(190 + (t * 26 | 0), 150 + (t * 24 | 0), 86 + (u * 20 | 0));
      return pack(226 + (t * 18 | 0), 204 + (t * 20 | 0), 146 + (u * 26 | 0)); },
    2: () => pack(35 + r(15), 105 + r(25), 240 + r(15)),
    6: () => pack(58 + r(10), 45 + r(8), 35 + r(8)),
    8: () => { const g = 55 + r(15); return pack(g, g, g + 5); },
    13: () => 0x606870,
    17: () => { const v = Math.random(), t = Math.random();
      if (v < 0.06) return pack(255, 238 + (t * 17 | 0), 168 + (t * 50 | 0));
      if (v < 0.3) return pack(234 + (t * 18 | 0), 186 + (t * 22 | 0), 62 + (t * 18 | 0));
      if (v < 0.74) return pack(200 + (t * 22 | 0), 144 + (t * 20 | 0), 40 + (t * 12 | 0));
      return pack(146 + (t * 26 | 0), 98 + (t * 18 | 0), 28 + (t * 10 | 0)); },
    27: () => { const s = 232 + r(18); return pack(s, s, Math.min(255, s + 8)); },
  };
  window.__write = (x, y, type, life = 0) => {
    if (!world.inBounds(x, y)) return;
    const i = world.idx(x, y);
    world.types[i] = type; world.colors[i] = type === 0 ? 0x08080c : (COLOR[type] ?? (() => 0x808080))();
    world.life[i] = life; world.charge[i] = 0;
    world.activity.touchIndex(i);
  };
  window.__box = (x0, y0, x1, y1) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      window.__write(x, y, x === x0 || x === x1 || y === y1 ? 13 : 0);
    }
  };
  window.__view = (cx, cy) => {
    ctx.camera.zoomLock = 1; ctx.camera.zoom = 1;
    if (typeof ctx.camera.snapTo === 'function') ctx.camera.snapTo(cx, cy);
    ctx.camera.x = ctx.camera.tx = cx - 320; ctx.camera.y = ctx.camera.ty = cy - 180;
  };
  // Run exactly n more sim substeps, then pause (the render keeps going).
  window.__runSubsteps = (n) => new Promise((resolve) => {
    const sim = ctx.simulation, orig = sim.processFrame.bind(sim);
    let left = n;
    ctx.state.paused = false;
    sim.processFrame = (c) => {
      if (left <= 0) return;
      orig(c);
      if (--left === 0) { ctx.state.paused = true; sim.processFrame = orig; resolve(); }
    };
  });
  const glCanvas = document.querySelector('#canvas-holder > canvas');
  const tmp = document.createElement('canvas');
  window.__capture = () => new Promise((resolve, reject) => {
    tmp.width = glCanvas.width; tmp.height = glCanvas.height;
    const g = tmp.getContext('2d', { willReadFrequently: true });
    const tryOnce = (attempt) => {
      if (attempt > 60) return reject(new Error('capture: black frames'));
      requestAnimationFrame(() => {
        window.__game.composer.compose(ctx, 1);
        window.__game.renderer.render(ctx);
        g.drawImage(glCanvas, 0, 0);
        const d = g.getImageData(0, 0, tmp.width, tmp.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 16004) sum += d[i] + d[i + 1] + d[i + 2];
        if (sum > 50) resolve({ url: tmp.toDataURL('image/png'), w: tmp.width, h: tmp.height, camX: ctx.camera.renderX, camY: ctx.camera.renderY });
        else tryOnce(attempt + 1);
      });
    };
    tryOnce(0);
  });
  // Freeze the frame clock so both looks render the identical frame.
  let frozen = null, store = ctx.state.frameCount;
  Object.defineProperty(ctx.state, 'frameCount', {
    configurable: true,
    get: () => (frozen !== null ? frozen : store),
    set: (v) => { store = v; },
  });
  window.__freeze = (on) => { frozen = on ? store : null; };
});

const save = async (name, subcell) => {
  await page.evaluate((v) => { window.__game.ctx.state.postFx.subcell = v; }, subcell);
  const shot = await page.evaluate(() => window.__capture());
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.url.split(',')[1], 'base64'));
  return shot;
};

// ------------------------------------------------------------ 1. settled piles and pools
await page.evaluate(async () => {
  const w = window.__write;
  window.__box(600, 700, 1000, 880);
  for (let y = 702; y < 772; y++) for (let x = 640; x < 652; x++) w(x, y, 1);      // sand
  for (let y = 702; y < 752; y++) for (let x = 732; x < 740; x++) w(x, y, 17);     // gold
  for (let y = 702; y < 742; y++) for (let x = 820; x < 827; x++) w(x, y, 8);      // gunpowder
  for (let y = 702; y < 752; y++) for (let x = 930; x < 938; x++) w(x, y, 27);     // snow
  for (let y = 712; y < 760; y++) for (let x = 672; x < 704; x++) w(x, y, 2);      // water between sand and gold
  for (let y = 712; y < 726; y++) for (let x = 862; x < 890; x++) w(x, y, 6);      // oil slick
  window.__view(800, 800);
  await window.__runSubsteps(420);
});
await page.evaluate(() => { window.__freeze(true); Math.random = () => 0.5; });
await page.waitForTimeout(200);
const look = await save('look-full-off', false);
await save('look-full-on', true);

// ------------------------------------------------------------ 2. a mid-air spray
await page.evaluate(async () => {
  window.__freeze(false);
  const ctx = window.__game.ctx;
  // deterministic sprinkle (Math.random is pinned; use a local LCG)
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const w = window.__write;
  const realRandom = Math.random;
  Math.random = rnd;
  for (let y = 706; y < 726; y++) for (let x = 700; x < 900; x++) {
    if (rnd() < 0.3) w(x, y, x < 800 ? 1 : 2);
  }
  Math.random = realRandom;
  ctx.particles.clear();
  await window.__runSubsteps(18);
});
await page.evaluate(() => window.__freeze(true));
await page.waitForTimeout(200);
await save('spray-full-off', false);
await save('spray-full-on', true);
await page.evaluate(() => window.__freeze(false));

// ------------------------------------------------------------ 3. serial vs parallel: same scene, same tick count
const floodScene = async () => page.evaluate(async () => {
  const w = window.__write, ctx = window.__game.ctx;
  let s = 777;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const realRandom = Math.random;
  Math.random = rnd; // same colours both runs
  const cx = 800, floorY = 900, W = 640, H = 340;
  for (let x = cx - W / 2 - 1; x <= cx + W / 2 + 1; x++) for (let y = floorY - H - 1; y <= floorY + 1; y++) {
    const edge = x <= cx - W / 2 - 1 || x >= cx + W / 2 + 1 || y <= floorY - H - 1 || y >= floorY;
    w(x, y, edge ? 13 : 0);
  }
  const X0 = cx - W / 2, X1 = cx + W / 2 - 1, Y0 = floorY - H;
  for (let x = X0; x <= X1; x++) for (let y = Y0; y < Y0 + 90; y++) {
    const band = (((x - X0) / 40) | 0) % 3;
    w(x, y, band === 0 ? 1 : band === 1 ? 2 : 6);
  }
  for (let x = X0; x <= X1; x += 3) w(x, Y0 + 91, 5, 90);
  Math.random = realRandom;
  ctx.particles.clear();
  window.__view(800, 900 - 170);
});
const mtStats = {};
for (const parallel of [false, true]) {
  await page.evaluate((on) => { window.__game.ctx.simulation.parallel.enabled = on; window.__game.ctx.state.postFx.subcell = false; }, parallel);
  await floodScene();
  const t = await page.evaluate(async () => {
    const sim = window.__game.ctx.simulation, orig = sim.processFrame.bind(sim);
    let total = 0, n = 0;
    sim.processFrame = (c) => { const t0 = performance.now(); orig(c); total += performance.now() - t0; n++; };
    await window.__runSubsteps(60);
    sim.processFrame = orig;
    return { msPerTick: total / Math.max(1, n), ticks: n };
  });
  mtStats[parallel ? 'parallel' : 'serial'] = t;
  await page.evaluate(() => window.__freeze(true));
  await page.waitForTimeout(150);
  await save(`mt-${parallel ? 'parallel' : 'serial'}`, false);
  await page.evaluate(() => window.__freeze(false));
}
writeFileSync(`${OUT}/mt-capture-stats.json`, JSON.stringify(mtStats, null, 2));
await browser.close();

// ------------------------------------------------------------ crops + change masks
// Native pixels per cell = w / 640 (2 at the fine presentation). Regions in cells.
const cellPx = look.w / 640;
const crops = [
  // name, source, cell box (x0, y0, x1, y1), zoom
  ['look-sand-water', 'look', [612, 818, 712, 880], 4],
  ['look-gold', 'look', [700, 818, 790, 880], 4],
  ['look-powder-snow', 'look', [790, 830, 990, 880], 3],
  ['spray', 'spray', [690, 700, 910, 800], 3],
];
const cropSpec = JSON.stringify({ crops, cellPx, camX: look.camX, camY: look.camY, out: OUT });
execFileSync('python', ['-c', `
import json
from PIL import Image, ImageChops
spec = json.loads('''${cropSpec}''')
out, s, cx, cy = spec['out'], spec['cellPx'], spec['camX'], spec['camY']
def box(b):
    return (int((b[0]-cx)*s), int((b[1]-cy)*s), int((b[2]-cx)*s), int((b[3]-cy)*s))
for name, src, cells, zoom in spec['crops']:
    a = Image.open(f'{out}/{src}-full-off.png').convert('RGB').crop(box(cells))
    b = Image.open(f'{out}/{src}-full-on.png').convert('RGB').crop(box(cells))
    size = (a.width*zoom, a.height*zoom)
    a.resize(size, Image.NEAREST).save(f'{out}/{name}-off.png')
    b.resize(size, Image.NEAREST).save(f'{out}/{name}-on.png')
    # changed pixels in magenta over a dimmed grey of the after frame
    d = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 6 else 0)
    base = b.convert('L').point(lambda v: v // 3).convert('RGB')
    mag = Image.new('RGB', b.size, (255, 40, 200))
    Image.composite(mag, base, d).resize(size, Image.NEAREST).save(f'{out}/{name}-diff.png')
    changed = sum(1 for v in d.getdata() if v)
    print(name, a.size, 'changed px', changed, 'of', a.width*a.height)
# full-frame masks too
for src in ['look', 'spray']:
    a = Image.open(f'{out}/{src}-full-off.png').convert('RGB'); b = Image.open(f'{out}/{src}-full-on.png').convert('RGB')
    d = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 6 else 0)
    base = b.convert('L').point(lambda v: v // 3).convert('RGB')
    Image.composite(Image.new('RGB', b.size, (255, 40, 200)), base, d).save(f'{out}/{src}-full-diff.png')
a = Image.open(f'{out}/mt-serial.png').convert('RGB'); b = Image.open(f'{out}/mt-parallel.png').convert('RGB')
print('mt frames', a.size)
`], { stdio: 'inherit' });
console.log('native frame', look.w, 'x', look.h, 'cellPx', cellPx, 'mt', JSON.stringify(mtStats));
if (errors.length) console.log('page errors', errors);
