// Menu behaviour probe: real keys and real clicks through the overhauled
// menus. Escape closes only the topmost menu (it never falls through to open
// Pause), Pause's doors open the right menus and leave the game unpaused when
// they close, the Bench's card detail sits beside the tile you point at,
// keyboard-only slotting works, and a tome offer takes 1/2/3.
// Usage: node scripts/verify-menus.mjs [url]
import { chromium } from 'playwright-core';
import { startConsolePlayRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ' — ' + detail}`); };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await startConsolePlayRun(page, { seed: 7, settleMs: 800 });
await page.evaluate(() => {
  const c = window.__game.ctx; c.state.paused = false;
  for (const id of ['frostshard', 'bounce', 'heavy']) if (!c.wands.collection.includes(id)) c.wands.collection.push(id);
});
const state = () => page.evaluate(() => ({
  paused: window.__game.ctx.state.paused,
  pause: document.getElementById('pause-overlay')?.classList.contains('visible'),
  bench: document.getElementById('wand-bench')?.classList.contains('visible'),
  map: document.getElementById('minimap-overlay')?.classList.contains('visible'),
  help: document.getElementById('help-overlay')?.classList.contains('visible'),
}));
const clickEl = async (selector) => { const box = await page.locator(selector).first().boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(160); };

// Bench: open, hover, Escape.
await page.keyboard.press('KeyB'); await page.waitForTimeout(200);
check('B opens the bench and pauses', (await state()).bench && (await state()).paused);
const slot = page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="0"]');
const slotBox = await slot.boundingBox();
await page.mouse.move(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2); await page.waitForTimeout(250);
const pop = await page.evaluate(() => { const p = document.querySelector('#wand-bench .bench-inspect'); const r = p.getBoundingClientRect(); return { shown: p.classList.contains('shown'), top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: p.textContent }; });
const gap = Math.min(Math.abs(pop.top - (slotBox.y + slotBox.height)), Math.abs(slotBox.y - pop.bottom));
check('Hovering a slot shows its card detail right beside it', pop.shown && gap < 24 && pop.left < slotBox.x + slotBox.width && pop.right > slotBox.x, JSON.stringify({ gap, pop, slotBox }));
// Keyboard-only: focus a collection card, Enter to pick up, then Enter on an empty slot.
const card = page.locator('#wand-bench .bench-card-collection [data-bench-card-id="heavy"]');
await card.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
const holding = await page.evaluate(() => document.getElementById('wand-bench').classList.contains('holding'));
await page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="2"]').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
const seated = await page.evaluate(() => window.__game.ctx.wands.wands[0].cards[2]);
check('Keyboard alone picks up a card and seats it (Enter, Enter)', holding && seated === 'heavy', JSON.stringify({ holding, seated }));
// Right-click takes it back out.
const s2 = await page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="2"]').boundingBox();
await page.mouse.click(s2.x + s2.width / 2, s2.y + s2.height / 2, { button: 'right' }); await page.waitForTimeout(120);
check('Right-clicking a slot returns its card to the collection', await page.evaluate(() => window.__game.ctx.wands.wands[0].cards[2] === null && window.__game.ctx.wands.collection.includes('heavy')));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
let st = await state();
check('Escape closes the bench without opening Pause, and unpauses', !st.bench && !st.pause && !st.paused, JSON.stringify(st));

// Pause doors.
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
check('Escape opens Pause', (await state()).pause);
await clickEl('#pause-overlay [data-pause-open="KeyM"]');
st = await state();
check('Pause → Map opens the chart (and Pause steps aside)', st.map && !st.pause, JSON.stringify(st));
const places = await page.locator('#minimap-overlay .map-place').count();
check('The chart lists the places you have found', places > 0, String(places));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
st = await state();
check('Closing the chart returns to play, unpaused', !st.map && !st.pause && !st.paused, JSON.stringify(st));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await clickEl('#pause-overlay [data-pause-open="KeyB"]');
check('Pause → Bench opens the bench', (await state()).bench);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

// Handbook.
await page.keyboard.press('KeyH'); await page.waitForTimeout(200);
const first = await page.locator('#help-overlay .hb-page h3').textContent();
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120);
const second = await page.locator('#help-overlay .hb-page h3').textContent();
check('H opens the handbook; the arrow keys turn its pages', (await state()).help && first !== second, `${first} -> ${second}`);
const keys = await page.locator('#help-overlay .hb-page kbd.key').count();
check('Handbook pages show the live key bindings', keys > 3, String(keys));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
st = await state();
check('Escape closes the handbook without opening Pause', !st.help && !st.pause && !st.paused, JSON.stringify(st));

// A tome offer takes number keys.
await page.evaluate(() => { window.__probeChoice = null; window.__game.ctx.events.emit('cardOfferRequested', { source: 'tome', title: 'A water-stained tome', cards: ['bounce', 'heavy', 'speed'], onChoose(c) { window.__probeChoice = c; } }); });
await page.waitForTimeout(200);
await page.keyboard.press('Digit2'); await page.waitForTimeout(150);
check('Pressing 2 takes the second card of a tome offer', await page.evaluate(() => window.__probeChoice === 'heavy'));

check('No page errors', errors.length === 0, errors.join('\n'));
await browser.close();
console.log(`\nverify-menus: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
