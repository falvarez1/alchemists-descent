// The settings dialog ("Controls & comfort"): structure, navigation, reachability and loading.
//
//   node scripts/verify-settings.mjs [url] [--sizes 1440x900,960x600,390x844]
//
// For every viewport: opens the dialog from the title with a real click, then per tab
//  - the tab row is a real ARIA tablist (roles, aria-selected, roving tabindex, one visible panel),
//  - ArrowRight/ArrowLeft/Home/End move the selection AND the focus,
//  - every visible control is the topmost thing at its own centre (real clicks reach it) and
//    the last control of the panel can be scrolled into view,
//  - the dialog keeps one size across tabs and stays inside the viewport.
// Then loads the page with old / corrupt / hostile saved preferences and checks it still
// boots with sane values (the preference reader is defensive), and that the pause
// menu's own "Controls & comfort" button opens the same dialog.
//
// Exit code 1 on any failure. Screenshots go to verify-out/settings/.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsolePlayRun, waitForOpeningEnd } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const sizes = opt('sizes', '1440x900,960x600,390x844').split(',').map((s) => s.split('x').map(Number));
const out = 'verify-out/settings';
mkdirSync(out, { recursive: true });

let failures = 0;
const check = (ok, what) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

const click = async (page, loc) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error('no bounding box for click');
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

// Runs in the page: visible controls of the open dialog that a real click would miss.
const hitTest = () => {
  const root = document.querySelector('#player-settings');
  const panel = root.querySelector('.settings-panels');
  const covered = [];
  let checked = 0;
  const sel = 'button, input, select, textarea, [role="tab"]';
  for (const el of root.querySelectorAll(sel)) {
    if (el.closest('[hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // A control inside the scrolling panel is reached by scrolling: test it after scrolling it in.
    if (panel.contains(el)) el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    checked++;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    if (top && (top === el || el.contains(top) || top.contains(el) || (el.closest('label') && el.closest('label').contains(top)))) continue;
    covered.push(`${el.tagName.toLowerCase()}[name=${el.getAttribute('name') ?? el.id}] by ${top ? top.tagName.toLowerCase() + '.' + top.className : 'nothing'}`);
  }
  panel.scrollTop = 0;
  return { checked, covered };
};

const browser = await launchBrowser();
try {
  for (const [w, h] of sizes) {
    const mobile = w < 600;
    const context = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    console.log(`\n== ${w}x${h}${mobile ? ' (touch)' : ''}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#expedition-entry').waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    await click(page, page.locator('#expedition-entry [data-entry="settings"]'));
    await page.waitForSelector('#player-settings[open]');
    await page.waitForTimeout(250);

    const tabs = await page.locator('#player-settings [role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab));
    check(tabs.length >= 4, `tab row has ${tabs.length} tabs (${tabs.join(', ')})`);
    check(await page.locator('#player-settings [role="tablist"]').count() === 1, 'one role=tablist');

    const structure = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#player-settings [role="tab"]')];
      const panels = [...document.querySelectorAll('#player-settings [role="tabpanel"]')];
      return {
        selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length,
        tabbable: tabs.filter((t) => t.tabIndex === 0).length,
        visiblePanels: panels.filter((p) => !p.hidden).length,
        linked: tabs.every((t) => { const p = document.getElementById(t.getAttribute('aria-controls')); return p && p.getAttribute('aria-labelledby') === t.id; }),
        focusOnSelected: document.activeElement?.getAttribute('aria-selected') === 'true',
      };
    });
    check(structure.selected === 1 && structure.tabbable === 1, 'exactly one selected, roving-tabindex tab');
    check(structure.visiblePanels === 1, 'exactly one visible panel');
    check(structure.linked, 'every tab controls a panel that is labelled by it');
    check(structure.focusOnSelected, 'opening the dialog focuses the selected tab');

    // Keyboard: arrows, wrap-around, Home/End; focus follows selection.
    const selectedTab = () => page.evaluate(() => document.querySelector('#player-settings [role="tab"][aria-selected="true"]')?.dataset.tab);
    const focusedTab = () => page.evaluate(() => document.activeElement?.dataset?.tab);
    await page.keyboard.press('ArrowRight');
    check((await selectedTab()) === tabs[1] && (await focusedTab()) === tabs[1], `ArrowRight -> ${tabs[1]} (selected and focused)`);
    await page.keyboard.press('End');
    check((await selectedTab()) === tabs[tabs.length - 1], `End -> ${tabs[tabs.length - 1]}`);
    await page.keyboard.press('ArrowRight');
    check((await selectedTab()) === tabs[0], 'ArrowRight wraps to the first tab');
    await page.keyboard.press('ArrowLeft');
    check((await selectedTab()) === tabs[tabs.length - 1], 'ArrowLeft wraps to the last tab');
    await page.keyboard.press('Home');
    check((await selectedTab()) === tabs[0], 'Home -> first tab');

    // Every tab: real-click select, hit-test, size stability, inside the viewport.
    let firstSize = null;
    for (const id of tabs) {
      await click(page, page.locator(`#player-settings [data-tab="${id}"]`));
      await page.waitForTimeout(120);
      const res = await page.evaluate(hitTest);
      check(res.covered.length === 0, `${id}: ${res.checked} controls reachable${res.covered.length ? ' - covered: ' + res.covered.join('; ') : ''}`);
      const geo = await page.evaluate(() => {
        const r = document.querySelector('#player-settings').getBoundingClientRect();
        const p = document.querySelector('#player-settings .settings-panels');
        return { w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, hOverflow: p.scrollWidth > p.clientWidth + 1 };
      });
      firstSize ??= geo;
      check(geo.inside && !geo.hOverflow && geo.w === firstSize.w && geo.h === firstSize.h, `${id}: dialog ${geo.w}x${geo.h} inside the viewport, same size as the first tab, no sideways scroll`);
      await page.screenshot({ path: `${out}/${w}x${h}-${id}.png` });
    }

    // Esc closes the native dialog.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(await page.evaluate(() => !document.querySelector('#player-settings').open), 'Escape closes the dialog');
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await context.close();
  }

  // Saved preferences from before the tabs (and hostile ones) must load.
  console.log('\n== loading saved preferences');
  const saves = {
    'old save (boolean shake, no newer fields)': JSON.stringify({ textScale: 1.15, reducedFlashes: true, cameraShake: false, highReadability: true, creatureCaptions: true, muted: true, narration: false }),
    'corrupt JSON': '{"textScale": 1.3, ',
    'JSON null': 'null',
    'JSON array': '[1,2,3]',
    'hostile values': JSON.stringify({ textScale: 'big', cameraShake: { x: 1 }, volume: { master: 'loud', music: 9e9 }, trickshot: 7, unknownField: 'x', hudScale: 1e9, brightness: -4, pauseOnBlur: 'sure' }),
  };
  for (const [name, raw] of Object.entries(saves)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((value) => { try { localStorage.setItem('ad-player-preferences-v1', value); } catch { /* */ } }, raw);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#expedition-entry').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await click(page, page.locator('#expedition-entry [data-entry="settings"]'));
    await page.waitForSelector('#player-settings[open]');
    const state = await page.evaluate(() => ({ text: document.documentElement.style.getPropertyValue('--text-scale'), vols: [...document.querySelectorAll('#player-settings input[name^="volume-"]')].map((i) => Number(i.value)) }));
    const sane = ['1', '1.15', '1.3'].includes(state.text) && state.vols.every((v) => v >= 0 && v <= 100);
    check(errors.length === 0 && sane, `${name}: boots, text scale ${state.text}, volumes ${state.vols.join('/')}`);
    await context.close();
  }

  // The pause menu's entry opens the same dialog.
  console.log('\n== pause menu entry');
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await startConsolePlayRun(page, { seed: 7, settleMs: 5200 });
    await waitForOpeningEnd(page).catch(() => undefined);
    await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; c.state.debugGodMode = false; });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await click(page, page.locator('#pause-settings'));
    await page.waitForSelector('#player-settings[open]');
    check(true, 'pause menu "Controls & comfort" opens the dialog');
    await page.screenshot({ path: `${out}/from-pause.png` });
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
