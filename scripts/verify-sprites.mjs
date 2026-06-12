// Animated sprite (Aseprite pipeline) probe: build the fixture sheet PNG +
// JSON in NODE (no canvas — a minimal PNG encoder over zlib), import it
// through the real IMPORT SPRITE file chooser, place a sprite decor, flip it
// emissive through the inspector, PLAYTEST, then inside rAF read the live
// canvas at the decor across ~40 frames and assert (a) the pixels CHANGE
// over time (it animates) and (b) the decor footprint stays non-blocking
// (the visual-only invariant). Finally EXPORT and assert both downloads.
// Usage: node scripts/verify-sprites.mjs [url]   (dev server running)
import { chromium } from 'playwright-core';
import { deflateSync } from 'node:zlib';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

/* ---------- node-side PNG encoder (8-bit RGBA, no filtering) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- the fixture: 16x8 sheet, frame 0 solid red, frame 1 solid blue ---------- */
const SHEET_W = 16, SHEET_H = 8, FRAME = 8;
const rgba = Buffer.alloc(SHEET_W * SHEET_H * 4);
for (let y = 0; y < SHEET_H; y++) {
  for (let x = 0; x < SHEET_W; x++) {
    const o = (y * SHEET_W + x) * 4;
    rgba[o] = x < FRAME ? 255 : 0;
    rgba[o + 2] = x < FRAME ? 0 : 255;
    rgba[o + 3] = 255;
  }
}
const sheetPng = encodePng(rgba, SHEET_W, SHEET_H);
const aseJson = JSON.stringify({
  frames: [0, 1].map((i) => ({
    filename: `probe ${i}.aseprite`,
    frame: { x: i * FRAME, y: 0, w: FRAME, h: FRAME },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: FRAME, h: FRAME },
    sourceSize: { w: FRAME, h: FRAME },
    duration: 50, // 3 ticks/frame -> visibly alternates within ~40 rAF samples
  })),
  meta: { app: 'probe', image: 'probe.sheet.png', frameTags: [{ name: 'burn', from: 0, to: 1, direction: 'forward' }] },
});

/* ---------- browser ---------- */
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
page.on('dialog', (d) => d.accept());
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2200);

await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-sprite:') || key.startsWith('noita-builder-doc:')) {
      localStorage.removeItem(key);
    }
  }
  // metal arena: open interior 430..770 x 375..625
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const Metal = 13;
  for (let y = 375; y <= 625; y++)
    for (let x = 430; x <= 770; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = Metal; w.colors[i] = 0x7a8a99;
      }
  };
  solid(430, 770, 620, 625);
  solid(430, 436, 375, 625);
  solid(764, 770, 375, 625);
  solid(430, 770, 375, 380);
  ctx.camera.snapTo(600, 500);
});
await page.waitForTimeout(200);

const toClient = async (wx, wy) =>
  page.evaluate(([wx, wy]) => {
    const ctx = window.__game.ctx;
    const r = document.getElementById('builder-overlay').getBoundingClientRect();
    const VIEW_W = 525, VIEW_H = 357;
    const ux = ((wx - ctx.camera.renderX) / VIEW_W - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / VIEW_H - 0.5) * ctx.camera.zoom + 0.5;
    return { x: r.left + ux * r.width, y: r.top + uy * r.height };
  }, [wx, wy]);

/* ---------- import through the real file chooser ---------- */
console.log('-- import (Aseprite JSON + sheet PNG paired by basename)');
const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
await page.click('#bp-sprite-import');
await (await chooser).setFiles([
  { name: 'probe.sprite.json', mimeType: 'application/json', buffer: Buffer.from(aseJson) },
  { name: 'probe.sheet.png', mimeType: 'image/png', buffer: sheetPng },
]);
await page.waitForTimeout(600);

const row = await page.evaluate(() => {
  const r = document.querySelector('.bp-sprite-row');
  return r
    ? { name: r.querySelector('.bp-prefab-name')?.textContent, meta: r.querySelector('.bp-prefab-meta')?.textContent }
    : null;
});
check('sprite row appears with name + 8x8x2 badge', !!row && row.name === 'probe' && /8×8×2/.test(row.meta ?? ''), JSON.stringify(row));
const stored = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('noita-builder-sprite:'));
  return key ? JSON.parse(localStorage.getItem(key)) : null;
});
check('sprite stored per-key with frames + tag', !!stored && stored.frames.length === 2 && stored.tags?.[0]?.name === 'burn',
  stored ? `frames ${stored.frames.length}` : 'missing');

/* ---------- place a sprite decor + spawn ---------- */
console.log('-- placement (armed sprite -> decor with sprite params)');
const DECOR = { x: 600, y: 560 };
await page.click('.bp-sprite-row');
await page.waitForTimeout(120);
let pt = await toClient(DECOR.x, DECOR.y);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(120);
await page.keyboard.press('Escape');

const decorParams = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('noita-builder-sprite:'));
  const sid = key ? JSON.parse(localStorage.getItem(key)).id : null;
  const marker = document.querySelector('.b-marker.k-decor');
  return { sid, marker: marker ? marker.title : null };
});
check('decor marker reads "sprite decor (visual only)"', decorParams.marker === 'sprite decor (visual only)', JSON.stringify(decorParams));

// select the decor; the inspector must show the sprite rows + preview canvas
await page.click('.bp-tool[data-tool="select"]');
pt = await toClient(DECOR.x, DECOR.y);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(150);
const inspector = await page.evaluate(() => ({
  select: !!document.querySelector('#builder-inspector select[data-p="spriteId"]'),
  loopTag: !!document.querySelector('#builder-inspector select[data-p="loopTag"]'),
  fps: !!document.querySelector('#builder-inspector input[data-p="fps"]'),
  flip: !!document.querySelector('#builder-inspector input[data-p="flipX"]'),
  emissive: !!document.querySelector('#bi-sprite-emissive'),
  preview: !!document.querySelector('#bi-sprite-prev'),
  hint: document.querySelector('#builder-inspector .bi-empty')?.textContent ?? '',
}));
check('decor inspector: sprite/loopTag/fps/flipX/emissive + animated preview',
  inspector.select && inspector.loopTag && inspector.fps && inspector.flip && inspector.emissive && inspector.preview,
  JSON.stringify(inspector));
check('inspector carries the visual-only hint', /Visual only/.test(inspector.hint), inspector.hint);

// emissive so the probe reads raw sprite colors in a dark cave
await page.check('#bi-sprite-emissive');
await page.waitForTimeout(100);
await page.keyboard.press('Escape');

// player spawn on the arena floor
await page.click('.bp-tool[data-kind="spawn"]');
pt = await toClient(500, 610);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(100);
await page.keyboard.press('Escape');

/* ---------- playtest ---------- */
console.log('-- playtest (runtime decors + animation + visual-only invariant)');
await page.click('#b-playtest');
await page.waitForFunction(() => window.__game.ctx.state.mode === 'play', { timeout: 10000 });
await page.waitForTimeout(800);

const runtime = await page.evaluate(([DECOR]) => {
  const ctx = window.__game.ctx;
  const decors = ctx.levels.current?.decors ?? [];
  // visual-only: every cell under the 8x8 footprint must still be Empty
  let blocked = 0;
  for (let dy = -4; dy < 4; dy++)
    for (let dx = -4; dx < 4; dx++) {
      if (ctx.world.types[ctx.world.idx(DECOR.x + dx, DECOR.y + dy)] !== 0) blocked++;
    }
  return {
    count: decors.length,
    emissive: decors[0]?.sprite.emissive ?? false,
    frames: decors[0]?.sprite.frames.length ?? 0,
    blocked,
  };
}, [DECOR]);
check('runtime.decors has the one placed decor', runtime.count === 1, JSON.stringify(runtime));
check('shared RuntimeSprite decoded (2 frames) + emissive honored', runtime.frames === 2 && runtime.emissive === true, JSON.stringify(runtime));
check('decor footprint stays non-blocking (visual-only invariant)', runtime.blocked === 0, `${runtime.blocked} blocking cells`);

// read the displayed canvas at the decor across ~40 rAF frames
const samples = await page.evaluate(([DECOR]) => new Promise((resolve) => {
  const ctx = window.__game.ctx;
  // the holder also hosts tiny icon canvases — the renderer's is the big one
  const gl = [...document.querySelectorAll('#canvas-holder canvas')].find((c) => c.width > 300);
  const VIEW_W = 525, VIEW_H = 357;
  const tmp = document.createElement('canvas');
  tmp.width = gl.width;
  tmp.height = gl.height;
  const g = tmp.getContext('2d', { willReadFrequently: true });
  const out = [];
  const step = () => {
    g.drawImage(gl, 0, 0);
    const zoom = ctx.camera.zoom || 1;
    const ux = ((DECOR.x - ctx.camera.renderX) / VIEW_W - 0.5) * zoom + 0.5;
    const uy = ((DECOR.y - ctx.camera.renderY) / VIEW_H - 0.5) * zoom + 0.5;
    const cx = Math.round(ux * tmp.width), cy = Math.round(uy * tmp.height);
    const px = g.getImageData(cx - 4, cy - 4, 9, 9).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++; }
    out.push([r / n, gg / n, b / n]);
    if (out.length >= 40) resolve(out);
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), [DECOR]);

const redFrames = samples.filter(([r, , b]) => r > b + 12).length;
const blueFrames = samples.filter(([r, , b]) => b > r + 12).length;
check('decor pixels CHANGE over time (red frames AND blue frames seen)', redFrames >= 3 && blueFrames >= 3,
  `red ${redFrames} blue ${blueFrames} of ${samples.length}; first ${JSON.stringify(samples[0])}`);

/* ---------- export round-trip: both downloads fire ---------- */
console.log('-- export (name.sheet.png + name.sprite.json)');
await page.click('#mode-builder-btn');
await page.waitForTimeout(600);
const dl1p = page.waitForEvent('download', { timeout: 10000 });
await page.click('.bp-sprite-row button[aria-label^="Export"]');
const dl1 = await dl1p;
const dl2 = await page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
const names = [dl1.suggestedFilename(), dl2?.suggestedFilename()].sort();
check('EXPORT downloads probe.sheet.png + probe.sprite.json',
  names[0] === 'probe.sheet.png' && names[1] === 'probe.sprite.json', JSON.stringify(names));

/* ---------- cleanup + verdict ---------- */
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-sprite:')) localStorage.removeItem(key);
  }
});
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
console.log(`\nsprite probe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
