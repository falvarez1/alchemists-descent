// Every player-facing menu, opened the way a player opens it (real keys and
// clicks where the menu has them), captured at desktop and compact sizes.
// Usage: node scripts/shot-menus.mjs [url] [--out dir] [--only bench,map,...] [--tag name]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startConsolePlayRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const out = opt('out', 'verify-out/menus');
const tag = opt('tag', 'current');
const only = opt('only', '')?.split(',').filter(Boolean);
mkdirSync(out, { recursive: true });
const want = (name) => !only.length || only.includes(name);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const sizes = (opt('sizes', '1440x900,960x600')).split(',').map(s => s.split('x').map(Number));
try {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'networkidle' });
    await startConsolePlayRun(page, { seed: 7, settleMs: 800 });
    await page.evaluate(() => {
      const c = window.__game.ctx; c.state.paused = false; c.state.debugGodMode = true;
      // A lived-in bench: a few cards collected, a second card slotted.
      for (const id of ['frostshard', 'bounce', 'heavy', 'double', 'bomb', 'lightning', 'speed', 'shorthoming', 'watertrail', 'critwet', 'flame', 'trigger']) if (!c.wands.collection.includes(id)) c.wands.collection.push(id);
      c.events.emit('wandChanged');
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    const snap = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: `${out}/${tag}-${name}-${w}.png` }); };
    // Close whatever is open without toggling Pause back on: press Escape
    // only while some overlay is actually showing.
    const anyOpen = () => page.evaluate(() => [...document.querySelectorAll('.visible, .open, dialog[open]')]
      .some(n => n.id && /overlay|bench|dialog|sanctum|prompt|offer|grimoire|help|settings/i.test(n.id + ' ' + n.className)));
    const closeAll = async () => {
      for (let i = 0; i < 5 && await anyOpen(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(160); }
      await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; document.getElementById('pause-overlay')?.classList.remove('visible'); });
    };
    const isPaused = () => page.evaluate(() => document.getElementById('pause-overlay')?.classList.contains('visible'));
    if (await isPaused()) await page.keyboard.press('Escape');

    if (want('bench')) {
      await page.keyboard.press('KeyB'); await snap('bench');
      // Hover a slot in the active wand: where does its detail appear?
      const slot = page.locator('#wand-bench .bench-slot, #wand-bench [data-slot]').nth(1);
      if (await slot.count()) { const box = await slot.boundingBox(); if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await snap('bench-hover-slot'); } }
      const card = page.locator('#wand-bench .bench-card, #wand-bench [data-card]').nth(3);
      if (await card.count()) { const box = await card.boundingBox(); if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await snap('bench-hover-card'); } }
      await closeAll();
    }
    if (want('map')) { await page.keyboard.press('KeyM'); await snap('map'); await closeAll(); }
    if (want('pause')) {
      await page.keyboard.press('Escape'); await snap('pause');
      const settings = page.getByRole('button', { name: /controls/i }).first();
      if (await settings.count()) { const box = await settings.boundingBox(); if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await snap('settings'); } }
      await closeAll();
    }
    if (want('handbook')) { await page.keyboard.press('KeyH'); await snap('handbook'); await closeAll(); }
    if (want('grimoire')) { await page.keyboard.press('KeyJ'); await snap('grimoire'); await closeAll(); }
    if (want('offer')) {
      await page.evaluate(() => window.__game.ctx.events.emit('cardOfferRequested', { source: 'tome', title: 'A water-stained tome', prompt: 'Choose one spell to keep.', cards: ['frostshard', 'bounce', 'heavy'], onChoose() {}, onDismiss() {} }));
      await snap('card-offer');
      // A tome offer is a mandatory choice: Escape does nothing, a digit picks a
      // card. Pick one, or the offer stays up and hides every menu shot after it.
      await page.keyboard.press('Digit1'); await page.waitForTimeout(400); await closeAll();
    }
    if (want('waystone')) {
      // The unlit waystone's help is a non-modal teach card (game/waystoneHelp).
      await page.evaluate(() => window.__game.ctx.events.emit('hintTeach', { key: 'waystone-unlit', title: 'An Unlit Waystone', body: 'A waystone lights when fire keeps burning in the stone bowl at its base.' }));
      await snap('waystone'); await closeAll();
    }
    if (want('sanctum')) {
      await page.evaluate(() => { const c = window.__game.ctx; c.state.score = 240; c.sanctum.open(c, () => {}); });
      await snap('sanctum');
      await page.evaluate(() => { const c = window.__game.ctx; c.sanctum.close?.(); c.state.paused = false; });
      await closeAll();
      await page.evaluate(() => { const c = window.__game.ctx; c.sanctum.openShop(c); });
      await snap('shop');
      await page.evaluate(() => { const c = window.__game.ctx; c.sanctum.close?.(); c.state.paused = false; });
      await closeAll();
    }
    if (want('death')) {
      await page.evaluate(() => { const c = window.__game.ctx; c.state.debugGodMode = false; c.player.hp = 1; c.playerCtl.damage(99, 1, -1, 'weaver-bite'); });
      await page.waitForTimeout(5200); await snap('death');
    }
    await page.close();
  }
  if (errors.length) console.log('ERRORS', errors.slice(0, 6));
} finally {
  await browser.close();
}
