// Focused fullscreen pause probe.
// Usage: node scripts/verify-fullscreen-pause.mjs [url]  (dev server running)
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
const page = await browser.newPage({ viewport: { width: 1300, height: 820 } });
const pageErrors = [];
const nativeDialogs = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', async (d) => {
  nativeDialogs.push(`${d.type()}: ${d.message()}`);
  await d.dismiss().catch(() => undefined);
});

await page.addInitScript(() => {
  let fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  document.exitFullscreen = async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  HTMLElement.prototype.requestFullscreen = async function requestFullscreen() {
    fullscreenElement = this;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(500);

await page.click('#immersive-play-btn');
await page.waitForFunction(
  () =>
    window.__game.ctx.state.mode === 'play' &&
    document.fullscreenElement?.id === 'canvas-holder' &&
    document.getElementById('immersive-play-btn')?.classList.contains('lit'),
  { timeout: 5000 },
);
check('fullscreen play enters stage fullscreen', true);

await page.keyboard.press('Escape');
await page.waitForFunction(
  () =>
    document.getElementById('pause-overlay')?.classList.contains('visible') &&
    document.getElementById('pause-exit-fullscreen')?.classList.contains('visible'),
  { timeout: 5000 },
);
const paused = await page.evaluate(() => ({
  paused: window.__game.ctx.state.paused,
  fullscreenId: document.fullscreenElement?.id ?? '',
}));
check('Escape pauses and reveals fullscreen exit', paused.paused && paused.fullscreenId === 'canvas-holder', JSON.stringify(paused));

await page.click('#pause-exit-fullscreen');
await page.waitForFunction(
  () =>
    !document.fullscreenElement &&
    !document.getElementById('pause-exit-fullscreen')?.classList.contains('visible') &&
    !document.getElementById('immersive-play-btn')?.classList.contains('lit'),
  { timeout: 5000 },
);
check('Exit Fullscreen clears fullscreen UI state', true);

check('no native browser dialogs', nativeDialogs.length === 0, nativeDialogs.join(' | '));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nfullscreen-pause probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
