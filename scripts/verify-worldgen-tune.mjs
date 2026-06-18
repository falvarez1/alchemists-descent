// Runtime probe for live worldgen look-tuning (Sandbox "Look tuning" panel):
//  - the panel renders sliders (cave size, sink fill, dressing)
//  - cave-size tweak + regenerate opens/closes the caves
//  - sink-fill tweak fills more walk-surface pits
//  - a dressing tweak (Moss) changes the biome decoration
// Usage: node scripts/verify-worldgen-tune.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.worldgen, { timeout: 20000 });

// panel renders
const panel = await page.evaluate(() => {
  const host = document.getElementById('worldgen-tune');
  const labels = host ? Array.from(host.querySelectorAll('.wg-tune-top span:first-child')).map((s) => s.textContent) : [];
  const inputs = host ? host.querySelectorAll('input[type="range"]').length : 0;
  return { has: !!host, inputs, labels };
});
console.log(`  ..    panel sliders: ${panel.inputs} (${panel.labels.join(', ')})`);
check('the worldgen Look-tuning panel renders sliders', panel.has && panel.inputs >= 4, JSON.stringify(panel));
check('it includes the sink-fill + cave-size + a dressing slider', panel.labels.includes('Cave size') && panel.labels.includes('Sink fill width') && panel.labels.some((l) => l === 'Moss' || l === 'Gold richness'), JSON.stringify(panel.labels));

// drive a slider by its row label, then regenerate via the Generate Caves button
const tweakAndCount = (label, value, countCell) => page.evaluate(({ label, value, countCell }) => {
  const host = document.getElementById('worldgen-tune');
  const rows = Array.from(host.querySelectorAll('.wg-tune-row'));
  const row = rows.find((r) => r.querySelector('.wg-tune-top span:first-child')?.textContent === label);
  if (row) {
    const input = row.querySelector('input[type="range"]');
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
  }
  document.getElementById('btn-caves').click();
  const w = window.__game.ctx.world;
  let n = 0;
  for (let i = 0; i < w.types.length; i++) if (w.types[i] === countCell) n++;
  return { found: !!row, n };
}, { label, value, countCell });

// cave size: bigger scale opens more cave (more Empty=0 cells)
const small = await tweakAndCount('Cave size', 0.7, 0);
const big = await tweakAndCount('Cave size', 2.1, 0);
console.log(`  ..    open cells: caveScale 0.7 -> ${small.n}, 2.1 -> ${big.n}`);
check('cave-size slider + regenerate changes cave openness', small.found && big.n > small.n * 1.15, JSON.stringify({ small: small.n, big: big.n }));

// sink fill: aggressive fill leaves fewer open cells than no surface-pit fill
await tweakAndCount('Cave size', 1.5, 0); // reset to shipped scale
const noFill = await tweakAndCount('Sink fill width', 0, 0);
const wide = await tweakAndCount('Sink fill width', 24, 0);
const deeper = (await page.evaluate(() => {
  const host = document.getElementById('worldgen-tune');
  const rows = Array.from(host.querySelectorAll('.wg-tune-row'));
  const row = rows.find((r) => r.querySelector('.wg-tune-top span:first-child')?.textContent === 'Sink fill depth');
  const input = row.querySelector('input[type="range"]'); input.value = '14'; input.dispatchEvent(new Event('input'));
  document.getElementById('btn-caves').click();
  const w = window.__game.ctx.world; let n = 0; for (let i = 0; i < w.types.length; i++) if (w.types[i] === 0) n++; return n;
}));
console.log(`  ..    open cells: sink-fill off -> ${noFill.n}, width24 -> ${wide.n}, +depth14 -> ${deeper}`);
check('more aggressive sink-fill fills more cells (fewer open)', deeper < noFill.n, JSON.stringify({ noFill: noFill.n, deeper }));

// dressing: earthen's rubble channel is Moss — density up = more moss
const mossOff = await tweakAndCount('Rubble/moss density', 0, 34);
const mossHi = await tweakAndCount('Rubble/moss density', 2, 34);
console.log(`  ..    Moss cells: rubble density 0 -> ${mossOff.n}, 2.0 -> ${mossHi.n}`);
check('a dressing slider (rubble/moss) + regenerate changes decoration', mossHi.found && mossHi.n > mossOff.n + 50, JSON.stringify({ off: mossOff.n, hi: mossHi.n }));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\nworldgen-tune probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
