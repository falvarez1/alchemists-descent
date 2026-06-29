// Focused app-dialog probe.
// Usage: node scripts/verify-app-dialogs.mjs [url]  (dev server running)
import { launchBrowser } from './browser-launch.mjs';

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

const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 820 } });
const nativeDialogs = [];
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', async (d) => {
  nativeDialogs.push(`${d.type()}: ${d.message()}`);
  await d.dismiss().catch(() => undefined);
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(900);

await page.click('#btn-level-save');
await page.waitForSelector('.app-dialog-root .app-dialog-input', { timeout: 5000 });
let dialog = await page.evaluate(() => ({
  title: document.querySelector('.app-dialog-title')?.textContent ?? '',
  activeTag: document.activeElement?.tagName ?? '',
}));
check('level save uses app dialog', dialog.title === 'Save Level' && dialog.activeTag === 'INPUT', JSON.stringify(dialog));
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.app-dialog-root'), { timeout: 5000 });

await page.click('#mode-builder-btn');
await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 5000 });
await page.click('[data-menu="document"]');
await page.click('#b-share');
await page.waitForSelector('.app-dialog-root textarea.app-dialog-input', { timeout: 10000 });
dialog = await page.evaluate(() => ({
  title: document.querySelector('.app-dialog-title')?.textContent ?? '',
  textLength: document.querySelector('textarea.app-dialog-input')?.value.length ?? 0,
}));
check('builder share uses app dialog', dialog.title === 'Share Code' && dialog.textLength > 16, JSON.stringify(dialog));
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.app-dialog-root'), { timeout: 5000 });

await page.click('[data-menu="edit"]');
await page.click('#b-capture');
await page.click('#b-new');
await page.waitForSelector('.app-dialog-root', { timeout: 5000 });
dialog = await page.evaluate(() => ({
  title: document.querySelector('.app-dialog-title')?.textContent ?? '',
  confirmText: document.querySelector('.app-dialog-btn.primary')?.textContent ?? '',
}));
check('builder discard uses app confirm', dialog.title === 'New Document' && dialog.confirmText === 'Discard', JSON.stringify(dialog));
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.app-dialog-root'), { timeout: 5000 });

await page.setInputFiles('#level-import', {
  name: 'bad-level.json',
  mimeType: 'application/json',
  buffer: Buffer.from('not json'),
});
await page.waitForSelector('.app-dialog-root', { timeout: 5000 });
dialog = await page.evaluate(() => ({
  title: document.querySelector('.app-dialog-title')?.textContent ?? '',
  message: document.querySelector('.app-dialog-message')?.textContent ?? '',
}));
check('invalid level import uses app alert', dialog.title === 'Import Failed' && dialog.message.includes('valid level'), JSON.stringify(dialog));
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.app-dialog-root'), { timeout: 5000 });

check('no native browser dialogs', nativeDialogs.length === 0, nativeDialogs.join(' | '));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\napp-dialog probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
