import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const out = 'docs/arena/platform-fighter/evidence';
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url + 'docs/arena/platform-fighter/IMPLEMENTATION-PLAN.html');
  await page.locator('img').evaluateAll(async images => { for (const image of images) image.loading = 'eager'; await Promise.all(images.map(image => image.decode())); });
  assert.ok(await page.locator('img').evaluateAll(images => images.every(i => i.naturalWidth > 0)), 'Every plan image loads');
  await page.screenshot({ path: `${out}/plan-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Plan fits a narrow screen');
  await page.screenshot({ path: `${out}/plan-mobile.png` });
  if (process.argv.includes('--docs-only')) { console.log('Desktop and mobile plan verified'); await browser.close(); process.exit(0); }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page);
  await waitForConsoleApi(page);
  await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-duel --world campaign-level'); });
  await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'fighter-duel');
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    c.fighters.equip('ilyra-voss'); await c.fighters.whenReady();
    await c.arena.addRival('brann-rook', 970, 639);
    c.player.x = 660;
    c.state.arrivalGraceUntil = 0;
    document.getElementById('fighter-arena')?.classList.add('collapsed');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/duel-before.png` });
  console.log('Baseline saved');
} finally { await browser.close(); }
