// One-off audit: are the feel-pass micro-interactions actually firing?
// Spies on ctx.audio methods + EventBus, then drives the trigger conditions.
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2000);

// Enter play mode and install spies.
await startConsoleTestRun(page, { settleMs: 1200 });
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__spy = { wandSwap: 0, dryFire: 0, sputter: 0, heartbeat: 0, evWandChanged: 0, evDryFire: 0 };
  for (const m of ['wandSwap', 'dryFire', 'sputter', 'heartbeat']) {
    const orig = ctx.audio[m].bind(ctx.audio);
    ctx.audio[m] = (...a) => { window.__spy[m]++; return orig(...a); };
  }
  ctx.events.on('wandChanged', () => window.__spy.evWandChanged++);
  ctx.events.on('dryFire', () => window.__spy.evDryFire++);
  ctx.player.hp = ctx.player.maxHp; // start healthy
});

// 1) Wand swap via the Digit2 key path (InputManager -> wands.active setter).
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' }));
});
await page.waitForTimeout(200);
// and back via a wheel event on the canvas
await page.evaluate(() => {
  const c = document.querySelector('#canvas-holder > canvas');
  c.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
});
await page.waitForTimeout(200);

// 2) Dry fire: zero mana on the active wand, squeeze the trigger.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  for (const i of [0, 1]) {
    const w = ctx.wands.wands?.[i] ?? null;
    if (w) w.mana = 0;
  }
  ctx.player.firing = true;
});
await page.waitForTimeout(600);
await page.evaluate(() => { window.__game.ctx.player.firing = false; });

// 3) Levitation sputter: airborne, tank nearly empty, jump held.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const p = ctx.player;
  p.levit = p.maxLevit * 0.1;
  p.y -= 26;
  p.vy = 0;
  ctx.input.keys.jump = true;
});
await page.waitForTimeout(800);
await page.evaluate(() => { window.__game.ctx.input.keys.jump = false; });

// 4) Low-HP heartbeat.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.player.hp = ctx.player.maxHp * 0.15;
  ctx.player.invuln = 1e6; // don't die to ambient hazards mid-probe
});
await page.waitForTimeout(1600);

const spy = await page.evaluate(() => {
  window.__game.ctx.player.hp = window.__game.ctx.player.maxHp;
  return window.__spy;
});
console.log(JSON.stringify(spy, null, 2));
await browser.close();
