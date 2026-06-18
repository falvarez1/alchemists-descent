// End-to-end probe: live tuning (Global Controls, player feel, worldgen look,
// material params) must survive a full page reload — the whole point of the
// tuning store. Edits the live params, waits out the debounce, reloads, and
// asserts the values came back. Usage: node scripts/verify-tuning-persist.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.params, { timeout: 20000 });

// Clean slate so a stale profile can't mask a regression.
await page.evaluate(() => { try { localStorage.removeItem('ad:tuning:v1'); } catch {} });

// Edit live tuning through the real paramsChanged path, then let the 500ms
// debounce write fire (visibilitychange flush would also work).
const edited = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.params.global.ambient = 0.44; // in the g-ambient slider's 0.02..0.50 range
  ctx.params.player.jumpCut = 0.41;
  ctx.params.materials[2].flowRate = 0.37; // Water=2
  ctx.state.brushSize = 14;
  ctx.events.emit('paramsChanged');
  await new Promise((r) => setTimeout(r, 800));
  let raw = null;
  try { raw = localStorage.getItem('ad:tuning:v1'); } catch {}
  return { raw };
});
check('a tuning edit is written to localStorage', !!edited.raw, JSON.stringify(edited));
const stored = edited.raw ? JSON.parse(edited.raw) : {};
check('stored blob is a sparse diff (only changed keys)',
  stored.global && 'ambient' in stored.global && !('simSpeed' in (stored.global || {})),
  edited.raw || '');

// The actual test: a full reload re-evaluates every config module to its shipped
// defaults — the store must rehydrate the edits before the first tick.
await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.params, { timeout: 20000 });

const after = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const slider = document.getElementById('g-ambient');
  return {
    ambient: ctx.params.global.ambient,
    jumpCut: ctx.params.player.jumpCut,
    waterFlow: ctx.params.materials[2].flowRate,
    brush: ctx.state.brushSize,
    sliderVal: slider ? parseFloat(slider.value) : null,
  };
});
check('global ambient survived the reload', Math.abs(after.ambient - 0.44) < 1e-6, JSON.stringify(after));
check('player jumpCut survived the reload', Math.abs(after.jumpCut - 0.41) < 1e-6, JSON.stringify(after));
check('material (water flowRate) survived the reload', Math.abs(after.waterFlow - 0.37) < 1e-6, JSON.stringify(after));
check('brush size survived the reload', after.brush === 14, JSON.stringify(after));
check('the Global Controls slider re-seeds from the restored value', after.sliderVal !== null && Math.abs(after.sliderVal - 0.44) < 1e-6, JSON.stringify(after));

// Leave no tuned state behind in the test profile.
await page.evaluate(() => { try { localStorage.removeItem('ad:tuning:v1'); } catch {} });

console.log(`\ntuning-persist probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
