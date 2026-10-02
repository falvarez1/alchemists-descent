// Screenshots of the title menu, page by page, walked with REAL keys: the main list, New descent (the loadout
// page and the card for each row), the case / difficulty lists, the seed page, Extras. For the eye.
// Usage: node scripts/shot-title.mjs [url] [--sizes 1400x860,1280x720] [--saved]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const optIdx = args.indexOf('--sizes');
const sizes = (optIdx >= 0 ? args[optIdx + 1] : '1400x860').split(',').map((s) => s.split('x').map(Number));
mkdirSync('verify-out/title', { recursive: true });

for (const [w, h] of sizes) {
  const tag = `${w}x${h}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.addInitScript(() => { try { localStorage.removeItem('alchemists-descent-meta'); localStorage.removeItem('noita-expedition'); sessionStorage.clear(); } catch { /* storage may be blocked */ } });
  await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
  await waitForConsoleApi(page);
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const shot = async (name) => { await page.waitForTimeout(550); await page.screenshot({ path: `verify-out/title/${tag}-${name}.png` }); };
  const focused = () => page.evaluate(() => document.activeElement?.dataset?.entry ?? document.activeElement?.id ?? document.activeElement?.tagName);
  const press = async (key) => { await page.keyboard.press(key); await page.waitForTimeout(80); };

  await shot('1-main');
  console.log(tag, 'main focus:', await focused());
  await press('Enter'); // New descent
  await shot('2-descent');
  console.log(tag, 'descent focus:', await focused());
  await press('ArrowUp'); await press('ArrowUp'); await press('ArrowUp'); await press('ArrowUp'); // case
  await shot('3-case-row');
  await press('ArrowRight');
  await shot('3b-case-stepped');
  await press('ArrowDown'); // fighter
  await press('ArrowRight'); await press('ArrowRight');
  await shot('4-fighter-row');
  await press('ArrowDown'); // difficulty
  await shot('5-difficulty-row');
  await press('Enter'); // the difficulty list
  await shot('6-difficulty-list');
  await press('Escape');
  await press('ArrowUp'); await press('ArrowUp'); await press('Enter'); // the case list
  await shot('7-case-list');
  await press('Escape');
  await press('ArrowDown'); await press('ArrowDown'); await press('ArrowDown'); await press('Enter'); // seed
  await shot('8-seed');
  await page.keyboard.type('breathing works');
  await shot('8b-seed-typed');
  await press('Enter');
  await shot('9-back-with-seed');
  await press('Escape'); // main
  await press('ArrowDown'); await press('ArrowDown'); await press('ArrowDown'); // daily -> extras
  console.log(tag, 'main focus after moves:', await focused());
  await shot('10-main-moved');
  await press('Enter');
  await shot('11-extras');
  await browser.close();
}
console.log('screenshots in verify-out/title/');
