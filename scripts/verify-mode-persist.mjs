// Mode persistence probe (sessionStorage + vite:beforeFullReload).
//
// Asserts the two halves of the contract:
//   1. A saved token reopens the prior mode on the next boot (one-shot).
//   2. A PLAIN reload with no token boots clean into Sandbox — so a manual F5
//      or any headless page.reload() is unaffected (the suite relies on this).
// Plus an end-to-end pass through the real save seam (__persistModeNow), which
// stands in for Vite's own vite:beforeFullReload event (not dispatchable here).
//
// Usage: node scripts/verify-mode-persist.mjs [url]  (dev server must be running)
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:5191/';
const KEY = 'ad-mode-before-reload';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('dialog', (d) => d.accept());
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

const settle = async () => {
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
  await page.waitForTimeout(1000);
};
const boot = async (url) => {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await settle();
};
const reload = async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
};
const snap = () => page.evaluate((k) => ({
  mode: window.__game.ctx.state.mode,
  builderOpen: document.body.classList.contains('builder-open'),
  token: sessionStorage.getItem(k),
  hasSeam: typeof window.__persistModeNow === 'function',
}), KEY);
const setToken = (v) => page.evaluate(([k, val]) => sessionStorage.setItem(k, val), [KEY, v]);
const clearToken = () => page.evaluate((k) => sessionStorage.removeItem(k), KEY);

/* ---------- compatibility guarantee: a plain reload does NOT restore ---------- */
console.log('-- plain reload stays clean (the suite relies on this)');
await boot(base);
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
let s = await snap();
check('builder opens and exposes the dev save seam', s.builderOpen && s.hasSeam, JSON.stringify(s));
await clearToken(); // ensure no token from any prior phase
await reload();
s = await snap();
check('a plain page.reload() boots clean into Sandbox (no auto-restore)', !s.builderOpen && s.mode === 'build', JSON.stringify(s));

/* ---------- a saved "builder" token reopens the Builder, one-shot ---------- */
console.log('-- saved token restores builder');
await setToken('builder');
await reload();
s = await snap();
check('saved "builder" token reopens the Builder', s.builderOpen === true, JSON.stringify(s));
check('token is consumed on restore (one-shot)', s.token === null, JSON.stringify(s));
await reload(); // and a follow-up plain reload falls back to Sandbox
s = await snap();
check('next plain reload falls back to Sandbox', !s.builderOpen, JSON.stringify(s));

/* ---------- a saved "play" token enters Play ---------- */
console.log('-- saved token restores play');
await setToken('play');
await reload();
s = await snap();
check('saved "play" token enters play mode', s.mode === 'play', JSON.stringify(s));
check('token consumed', s.token === null, JSON.stringify(s));

/* ---------- a corrupt token falls back to Sandbox ---------- */
console.log('-- corrupt token ignored');
await boot(base);
await setToken('bogus');
await reload();
s = await snap();
check('corrupt token falls back to Sandbox', s.mode === 'build' && !s.builderOpen, JSON.stringify(s));

/* ---------- end-to-end via the REAL save seam ---------- */
console.log('-- real save -> reload -> restore chain');
await boot(base);
await page.click('#mode-builder-btn'); // enter builder
await page.waitForTimeout(300);
await page.evaluate(() => window.__persistModeNow()); // exactly what vite:beforeFullReload runs
s = await snap();
check('seam saved the current (builder) mode', s.token === 'builder', JSON.stringify(s));
await reload();
s = await snap();
check('the real chain reopens the Builder after reload', s.builderOpen === true, JSON.stringify(s));

check('no page errors during the probe', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
