// Player-build probe for the run (Breathing Works). A production build has no
// window.__game handle, so this drives the DOM only: the title carries the
// brand and no authoring fold, Begin reaches play with three phials on the HUD,
// and the pause menu offers Abandon run / Quit to title without the run
// launcher. Usage (after `npm run build`):
//   npx vite preview --port 5192 --strictPort
//   node scripts/verify-run-player-build.mjs http://localhost:5192/ [shotsDir]
import { launchBrowser } from './browser-launch.mjs';
const url = process.argv[2] ?? 'http://localhost:5192/';
const out = process.argv[3];
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? ' ok ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++; };
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 30000 });
check('no __game debug handle in production', await page.evaluate(() => !('__game' in window)));
check('no authoring Workshops fold on the title', await page.evaluate(() => !document.querySelector('.entry-workshops')));
const brand = (await page.innerText('#expedition-title')).replace(/\s+/g, ' ').trim();
check('title reads the brand', brand === 'Breathing Works', brand);
const b = await (await page.$('#expedition-entry [data-entry="begin"]')).boundingBox();
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await page.waitForFunction(() => document.body.classList.contains('play-active') && document.getElementById('expedition-entry').hidden, null, { timeout: 30000 });
await page.waitForFunction(() => !document.getElementById('level-curtain')?.classList.contains('visible'), null, { timeout: 30000 });
await page.waitForTimeout(1500);
check('HUD phial row visible in play', await page.evaluate(() => { const r = document.getElementById('phial-row'); return !!r && !r.hidden && r.querySelectorAll('.phial[data-state="full"]').length === 3; }));
await page.keyboard.press('Escape');
await page.waitForSelector('#pause-overlay.visible', { timeout: 5000 });
const menu = await page.evaluate(() => ({
  launcher: !!document.getElementById('pause-launcher'),
  abandon: !document.getElementById('pause-abandon')?.hidden,
  title: !document.getElementById('pause-title-btn')?.hidden,
  restart: !document.getElementById('pause-restart')?.hidden,
}));
check('player build: no "Set up a run" in the pause menu', !menu.launcher, JSON.stringify(menu));
check('player build: Abandon run + Quit to title offered', menu.abandon && menu.title && !menu.restart, JSON.stringify(menu));
if (out) await page.screenshot({ path: `${out}/prod-pause.png` });
for (const e of errors) { console.error('PAGE ERROR', e); fails++; }
await browser.close();
console.log(fails ? `PROD PROBE FAILED ${fails}` : 'PROD PROBE OK');
process.exit(fails ? 1 : 0);
