// Prefab + asset-pipeline probe: capture a wired room (objects + link +
// light) as a prefab, paste it elsewhere (fresh ids, remapped links), undo
// it as ONE command, and prove the PNG round-trip through the REAL canvas
// codec for all 35 cell types (the one thing vitest's node env cannot test).
// Usage: node scripts/verify-builder-prefabs.mjs [url]  (dev server running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
let nextPromptAnswer = null;
page.on('dialog', (d) => {
  if (d.type() === 'prompt' && nextPromptAnswer !== null) {
    const v = nextPromptAnswer;
    nextPromptAnswer = null;
    d.accept(v);
  } else d.accept();
});
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2200);

/* ---------- builder + arena ---------- */
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-prefab:') || key === 'noita-builder-stamps') {
      localStorage.removeItem(key);
    }
  }
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

const placeAt = async (kind, wx, wy) => {
  await page.click(`.bp-tool[data-kind="${kind}"]`);
  const pt = await toClient(wx, wy);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(70);
  await page.keyboard.press('Escape');
};

/* ---------- author a wired room inside the arena ---------- */
console.log('-- capture (objects + link + light travel with the prefab)');
await placeAt('lever', 520, 612);
await placeAt('door', 600, 560);
await placeAt('enemy', 560, 612);
// wire lever -> door with the LINK tool
await page.keyboard.press('KeyK');
let pt = await toClient(520, 612);
await page.mouse.click(pt.x, pt.y);
pt = await toClient(601, 566);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(100);
await page.keyboard.press('Escape');
// one authored light
await page.click('.bp-tool[data-tool="light"]');
pt = await toClient(580, 500);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(100);
await page.keyboard.press('Escape');

const docCounts = await page.evaluate(() => {
  // reach the open document through a fresh validation run's source
  const markers = document.querySelectorAll('.b-marker').length;
  return { markers };
});
check('room authored (4 markers: lever, door, enemy, light)', docCounts.markers === 4, JSON.stringify(docCounts));

// region around the whole room, then capture
await page.click('.bp-tool[data-tool="region"]');
const ra = await toClient(480, 470); // 241x147 cells — inside the 40k prefab cap
const rb = await toClient(720, 616);
await page.mouse.move(ra.x, ra.y);
await page.mouse.down();
await page.mouse.move(rb.x, rb.y, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(120);
nextPromptAnswer = 'gate room #arena #mech';
await page.click('#bp-prefab-capture');
await page.waitForTimeout(200);

const card = await page.evaluate(() => {
  const c = document.querySelector('.bp-prefab-card');
  return c ? { meta: c.querySelector('.bp-prefab-meta')?.textContent, tags: c.querySelector('.bp-prefab-tagline')?.textContent } : null;
});
check('prefab card appears with object badge', !!card && /3 obj/.test(card.meta ?? ''), JSON.stringify(card));
check('tags parsed from #words', !!card && /#arena/.test(card.tags ?? ''), JSON.stringify(card));

const stored = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('noita-builder-prefab:'));
  return key ? JSON.parse(localStorage.getItem(key)) : null;
});
check('stored prefab carries objects+links+lights', !!stored && stored.objects.length === 3 && stored.links.length === 1 && stored.lights.length === 1,
  stored ? `obj ${stored.objects.length} links ${stored.links.length} lights ${stored.lights.length}` : 'missing');
check('captured link endpoints are prefab-local', !!stored && stored.objects.some((o) => o.id === stored.links[0].fromId) && stored.objects.some((o) => o.id === stored.links[0].toId));

/* ---------- paste: fresh ids, one-undo ---------- */
console.log('-- paste & single undo');
const before = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  // count via markers; the doc object counts equal marker counts here
  return { markers: document.querySelectorAll('.b-marker').length, types: null };
});
await page.click('.bp-prefab-card');
await page.waitForTimeout(100);
pt = await toClient(600, 500);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(150);
let markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('paste adds 4 records (8 markers total)', markers === before.markers + 4, `got ${markers}`);
await page.keyboard.press('Escape'); // disarm prefab
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('ONE undo removes the whole paste', markers === before.markers, `got ${markers}`);

/* ---------- PNG round-trip through the real canvas codec ---------- */
console.log('-- png fidelity (all 35 cell types)');
const png = await page.evaluate(async () => {
  // drive the real modules through dynamic import of the bundled chunks is
  // forbidden (second module instance); instead replicate the codec inline:
  // the palette test in vitest proves the mapping; HERE we prove the canvas
  // round-trips exact RGBA bytes with color management disabled.
  const w = 64, h = 8; // 512 px, covers ids 0..34 repeated
  const rgba = new Uint8ClampedArray(w * h * 4);
  // checkerboard of arbitrary distinct opaque colors incl. extremes
  const colors = [];
  for (let t = 0; t < 35; t++) colors.push([(t * 37) % 256, (t * 91 + 13) % 256, (t * 53 + 200) % 256]);
  colors.push([255, 255, 255], [0, 0, 0], [1, 2, 3]);
  for (let i = 0; i < w * h; i++) {
    const c = colors[i % colors.length];
    const o = i * 4;
    if (i % 7 === 3) continue; // transparent pixel
    rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  const img = g.createImageData(w, h);
  img.data.set(rgba);
  g.putImageData(img, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas2 = document.createElement('canvas');
  canvas2.width = w; canvas2.height = h;
  const g2 = canvas2.getContext('2d', { willReadFrequently: true });
  g2.imageSmoothingEnabled = false;
  g2.drawImage(bitmap, 0, 0);
  const back = g2.getImageData(0, 0, w, h).data;
  let mismatched = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] === 0) {
      if (back[o + 3] >= 128) mismatched++;
      continue;
    }
    if (back[o] !== rgba[o] || back[o + 1] !== rgba[o + 1] || back[o + 2] !== rgba[o + 2] || back[o + 3] !== 255) mismatched++;
  }
  return { mismatched, total: w * h };
});
check('opaque pixels round-trip canvas PNG exactly', png.mismatched === 0, `mismatched ${png.mismatched}/${png.total}`);

/* ---------- cleanup + verdict ---------- */
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-prefab:')) localStorage.removeItem(key);
  }
});
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
console.log(`\nprefab probe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
