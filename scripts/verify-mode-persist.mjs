// Mode persistence probe: the app mirrors its top-level mode into sessionStorage
// on every change, so a PLAIN browser reload returns to Builder / Play instead
// of resetting to Sandbox — and returning to Sandbox clears it so a reload there
// stays in Sandbox.
// Usage: node scripts/verify-mode-persist.mjs [url]  (dev server must be running)
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:5191/';
const KEY = 'ad-mode';
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
  await page.waitForTimeout(900);
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
}), KEY);

/* ---------- fresh boot is Sandbox, clean ---------- */
console.log('-- fresh boot');
await boot(base);
let s = await snap();
check('fresh boot is Sandbox', s.mode === 'build' && !s.builderOpen, JSON.stringify(s));
check('fresh boot stores no token', s.token === null, JSON.stringify(s));

/* ---------- Builder survives a PLAIN reload ---------- */
console.log('-- builder persists across a manual refresh');
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
s = await snap();
check('opening the Builder records token=builder', s.builderOpen && s.token === 'builder', JSON.stringify(s));
await reload();
s = await snap();
check('a plain reload reopens the Builder (not Sandbox)', s.builderOpen === true, JSON.stringify(s));

/* ---------- closing the Builder clears it; reload stays Sandbox ---------- */
console.log('-- leaving the Builder clears persistence');
await page.click('#mode-builder-btn'); // it is open (restored) -> this closes it
await page.waitForTimeout(300);
s = await snap();
check('closing the Builder clears the token', !s.builderOpen && s.token === null, JSON.stringify(s));
await reload();
s = await snap();
check('a plain reload after closing stays in Sandbox', s.mode === 'build' && !s.builderOpen, JSON.stringify(s));

/* ---------- Play survives a PLAIN reload (entered via the real launcher) ---------- */
console.log('-- play persists across a manual refresh');
await page.click('#mode-play-btn');
const launcher = await page.$('#run-launcher.visible').catch(() => null);
if (!launcher) {
  // launcher may animate in; wait for it
  await page.waitForSelector('#run-launcher.visible', { timeout: 5000 }).catch(() => {});
}
await page.click('#run-launcher .run-launcher-start');
await page.waitForTimeout(600);
s = await snap();
check('entering Play (launcher START) records token=play', s.mode === 'play' && s.token === 'play', JSON.stringify(s));
await reload();
s = await snap();
check('a plain reload re-enters Play (not Sandbox)', s.mode === 'play' && s.token === 'play', JSON.stringify(s));

/* ---------- direct token restore (covers a fresh tab/navigation) ---------- */
console.log('-- restore from a pre-set token');
await page.evaluate((k) => sessionStorage.setItem(k, 'builder'), KEY);
await reload();
s = await snap();
check('a pre-set "builder" token opens the Builder on boot', s.builderOpen === true, JSON.stringify(s));
await page.evaluate((k) => sessionStorage.setItem(k, 'bogus'), KEY);
await reload();
s = await snap();
check('a corrupt token falls back to Sandbox', s.mode === 'build' && !s.builderOpen, JSON.stringify(s));

check('no page errors during the probe', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
