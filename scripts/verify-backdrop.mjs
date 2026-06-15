// Backdrop editor/runtime gate.
// Usage: node scripts/verify-backdrop.mjs [url]   (dev server must be running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await page.waitForTimeout(1200);

await page.click('#mode-builder-btn');
await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 6000 });
await page.click('[data-menu="view"]');
await page.click('#b-backdrop');
await page.waitForFunction(() => getComputedStyle(document.getElementById('builder-backdrop')).display !== 'none');

const opened = await page.evaluate(() => ({
  profiles: document.querySelectorAll('#builder-backdrop [data-profile]').length,
  layers: document.querySelectorAll('#builder-backdrop .bb-layer').length,
  terrainActive: document.getElementById('bb-terrain')?.classList.contains('active') === true,
  profile: document.getElementById('bb-active-profile')?.textContent ?? '',
}));
check('Backdrop editor opens with profiles, layers, and terrain context', opened.profiles >= 10 && opened.layers === 5 && opened.terrainActive, JSON.stringify(opened));

const staged = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const before = ctx.params.backdrop.layers.front.speed;
  const input = document.querySelector('.bb-layer[data-layer="front"] [data-bb-speed-num]');
  input.value = '0.91';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    before,
    live: ctx.params.backdrop.layers.front.speed,
    dirty: document.getElementById('bb-apply')?.disabled === false,
  };
});
check('Backdrop edits stay staged before Apply', staged.before !== 0.91 && staged.live === staged.before && staged.dirty, JSON.stringify(staged));

await page.click('#bb-apply');
await page.waitForTimeout(120);
const applied = await page.evaluate(() => ({
  live: window.__game.ctx.params.backdrop.layers.front.speed,
  applyDisabled: document.getElementById('bb-apply')?.disabled === true,
}));
check('Apply writes staged global backdrop settings to the live document view', Math.abs(applied.live - 0.91) < 0.001 && applied.applyDisabled, JSON.stringify(applied));

await page.click('#builder-backdrop [data-profile="d3"]');
await page.waitForTimeout(80);
await page.click('#bb-override');
await page.evaluate(() => {
  const input = document.querySelector('.bb-layer[data-layer="back"] [data-bb-opacity-num]');
  input.value = '0.42';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const copyQueued = await page.evaluate(() => {
  const before = window.__game.ctx.params.backdrop.levels.d4?.enabled === true;
  document.getElementById('bb-copy-all').click();
  return {
    before,
    after: window.__game.ctx.params.backdrop.levels.d4?.enabled === true,
    active: document.getElementById('bb-copy-all')?.classList.contains('active') === true,
  };
});
check('Copy-to-All is queued, not applied immediately', copyQueued.before === copyQueued.after && copyQueued.active, JSON.stringify(copyQueued));

await page.click('#bb-revert');
await page.waitForTimeout(80);
const revertedCopy = await page.evaluate(() => ({
  copied: window.__game.ctx.params.backdrop.levels.d4?.enabled === true,
  copyActive: document.getElementById('bb-copy-all')?.classList.contains('active') === true,
}));
check('Revert cancels queued Copy-to-All', !revertedCopy.copied && !revertedCopy.copyActive, JSON.stringify(revertedCopy));

await page.click('#bb-override');
await page.evaluate(() => {
  const input = document.querySelector('.bb-layer[data-layer="back"] [data-bb-opacity-num]');
  input.value = '0.42';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.click('#bb-apply');
await page.waitForTimeout(120);
const d3Applied = await page.evaluate(() => ({
  enabled: window.__game.ctx.params.backdrop.levels.d3?.enabled === true,
  opacity: window.__game.ctx.params.backdrop.levels.d3?.layers?.back?.opacity,
  playtestBadge: document.querySelector('#builder-backdrop [data-profile="d3"]')?.classList.contains('playtest') === true,
}));
check('Level override applies and becomes the Builder playtest profile', d3Applied.enabled && Math.abs(d3Applied.opacity - 0.42) < 0.001 && d3Applied.playtestBadge, JSON.stringify(d3Applied));

const clamp = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const res = await ctx.console.exec('set backdrop.layers.front.scale 0');
  const scale = ctx.params.backdrop.layers.front.scale;
  await ctx.console.exec('set backdrop.layers.front.scale 1');
  return { res, scale, restored: ctx.params.backdrop.layers.front.scale };
});
check('Console backdrop set clamps live in-memory settings', clamp.res.ok && clamp.scale === 0.25 && clamp.restored === 1, JSON.stringify(clamp));

const beforePan = await page.evaluate(() => document.getElementById('bb-coords')?.textContent ?? '');
await page.click('#bb-stage');
await page.keyboard.down('KeyD');
await page.waitForTimeout(180);
await page.keyboard.up('KeyD');
const afterPan = await page.evaluate(() => document.getElementById('bb-coords')?.textContent ?? '');
check('Backdrop preview pans smoothly from keyboard input', beforePan !== afterPan, JSON.stringify({ beforePan, afterPan }));

await page.click('#bb-close');
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 470; y <= 625; y++) {
    for (let x = 540; x <= 700; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0;
      w.colors[i] = 0;
      w.life[i] = 0;
      w.charge[i] = 0;
    }
  }
  for (let x = 540; x <= 700; x++) {
    const i = w.idx(x, 620);
    w.types[i] = 13;
    w.colors[i] = 0x7a8a99;
  }
  ctx.camera.snapTo(620, 560);
});
await page.click('[data-menu="edit"]');
await page.click('#b-capture');
await page.click('.bp-tool[data-kind="spawn"]');
const spawnPoint = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const r = document.getElementById('builder-overlay').getBoundingClientRect();
  const wx = 620;
  const wy = 616;
  const ux = ((wx - ctx.camera.renderX) / 525 - 0.5) * ctx.camera.zoom + 0.5;
  const uy = ((wy - ctx.camera.renderY) / 357 - 0.5) * ctx.camera.zoom + 0.5;
  return { x: r.left + ux * r.width, y: r.top + uy * r.height };
});
await page.mouse.click(spawnPoint.x, spawnPoint.y);
await page.waitForTimeout(120);
await page.click('#b-playtest');
await page.waitForFunction(
  () =>
    window.__game.ctx.state.mode === 'play' &&
    window.__game.ctx.state.playtestSource === 'builder' &&
    window.__game.ctx.levels.current?.def.id === 'custom',
  { timeout: 8000 },
);
const playtest = await page.evaluate(() => ({
  levelId: window.__game.ctx.levels.current?.def.id ?? null,
  backdropLevelId: window.__game.ctx.levels.current?.backdropLevelId ?? null,
  opacity: window.__game.ctx.levels.current?.backdrop?.levels?.d3?.layers?.back?.opacity,
  gpuCompose: window.__game.ctx.state.postFx.gpuCompose,
}));
check('Builder playtest compiles document backdrop and selected level profile', playtest.levelId === 'custom' && playtest.backdropLevelId === 'd3' && Math.abs(playtest.opacity - 0.42) < 0.001, JSON.stringify(playtest));
check('GPU compose remains enabled for backdrop runtime path', playtest.gpuCompose === true, JSON.stringify(playtest));

await page.waitForTimeout(600);
const renderSample = await page.evaluate(() => {
  const canvas = document.querySelector('#game-canvas, canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, reason: 'missing canvas' };
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(canvas, 0, 0, 64, 64);
  const data = g.getImageData(0, 0, 64, 64).data;
  let nonBlank = 0;
  let hash = 0;
  for (let i = 0; i < data.length; i += 97) {
    hash = (hash * 33 + data[i]) >>> 0;
    if (data[i] || data[i + 1] || data[i + 2]) nonBlank++;
  }
  return { ok: true, nonBlank, hash };
});
check('Runtime canvas remains nonblank after backdrop changes', renderSample.ok && renderSample.nonBlank > 0 && renderSample.hash > 0, JSON.stringify(renderSample));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nverify-backdrop: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
