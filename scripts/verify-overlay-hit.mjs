// Hit-test every player-facing menu: for each clickable element inside an open
// overlay, is it the topmost thing at its own centre? Catches a control that
// draws fine but that real clicks fall straight through (or that another fixed
// element — the sound widget, the pause hint — sits on top of).
//
// Usage: node scripts/verify-overlay-hit.mjs [url] [--sizes 1280x720,960x600] [--only sanctum,map]
// Exit code 1 when any control is covered.
import { launchBrowser } from './browser-launch.mjs';
import { startConsolePlayRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const sizes = opt('sizes', '1920x1080,1440x900,1366x768,1280x720,1100x700,1024x640,960x600,800x600')
  .split(',').map((s) => s.split('x').map(Number));
const only = opt('only', '')?.split(',').filter(Boolean);
const want = (name) => !only.length || only.includes(name);

// Runs in the page. `root` is the overlay element; returns covered controls.
const hitTest = (rootSelector) => {
  const root = document.querySelector(rootSelector);
  if (!root) return { missing: true, covered: [], checked: 0 };
  const rr = root.getBoundingClientRect();
  const sel = 'button, a[href], input, select, textarea, summary, [role="button"], [tabindex="0"]';
  const covered = [];
  let checked = 0;
  for (const el of root.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    // A disabled control is still geometry: a primary button that is greyed out
    // while a widget sits on it will be covered the moment it is enabled.
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    // The part of the control a player can actually see: the element clipped by
    // the viewport and by every scrolling / clipping ancestor. A card half-way
    // under a sticky footer is fine (it scrolls into view); we test the middle of
    // what is showing. Nothing showing at all means "needs a scroll", not a bug.
    const vw = innerWidth, vh = innerHeight;
    let l = r.left, t = r.top, rt = r.right, b = r.bottom;
    let clippedAway = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (!/(auto|scroll|hidden|clip)/.test(o.overflowY + o.overflowX)) continue;
      const pr = p.getBoundingClientRect();
      l = Math.max(l, pr.left); t = Math.max(t, pr.top); rt = Math.min(rt, pr.right); b = Math.min(b, pr.bottom);
    }
    if (rt - l < 2 || b - t < 2) clippedAway = true;
    if (clippedAway) continue;
    // Off-screen entirely (a real layout bug of its own).
    const offscreen = rt <= 0 || b <= 0 || l >= vw || t >= vh;
    const x = Math.min(Math.max((Math.max(l, 0) + Math.min(rt, vw)) / 2, 0), vw - 1);
    const y = Math.min(Math.max((Math.max(t, 0) + Math.min(b, vh)) / 2, 0), vh - 1);
    checked++;
    if (offscreen) { covered.push({ what: label(el), by: 'OFFSCREEN', rect: rect(r) }); continue; }
    const top = document.elementFromPoint(x, y);
    if (top && (top === el || el.contains(top) || top.contains(el))) continue;
    // A label wrapping its input is fine.
    if (top && el.closest('label') && el.closest('label').contains(top)) continue;
    covered.push({ what: label(el), by: top ? label(top) : 'nothing', rect: rect(r) });
  }
  return { covered, checked, root: rect(rr) };

  function label(n) {
    const t = (n.textContent || n.getAttribute('aria-label') || n.title || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/)[0] : ''} "${t}"`;
  }
  function rect(r) { return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; }
};

// Runs in the page: Sanctum doors and boon cards that fall outside the body's
// visible box (i.e. need a scroll before the player can even read them).
const foldTest = () => {
  const body = document.querySelector('#sanctum-overlay .sanc-body');
  if (!body) return { missing: true, out: [] };
  const b = body.getBoundingClientRect();
  const out = [];
  for (const el of document.querySelectorAll('#sanctum-overlay .sanc-door, #sanctum-overlay .perk-card')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4) continue;
    if (r.top < b.top - 1 || r.bottom > b.bottom + 1) {
      out.push(`${String(el.className).split(' ')[0]} "${(el.textContent || '').trim().slice(0, 22)}" ${Math.round(r.top)}-${Math.round(r.bottom)} vs body ${Math.round(b.top)}-${Math.round(b.bottom)}`);
    }
  }
  return { out };
};

const browser = await launchBrowser();
let bad = 0;
const report = [];
try {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(url, { waitUntil: 'networkidle' });
    await startConsolePlayRun(page, { seed: 7, settleMs: 5200 });
    await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; c.state.debugGodMode = false; });
    const closeAll = async () => {
      for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(140); }
      await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; document.getElementById('pause-overlay')?.classList.remove('visible'); });
    };
    const probe = async (name, rootSelector, settle = 700) => {
      await page.waitForTimeout(settle);
      // A story beat (the Docent over the Sanctum, an opening plate) is a designed,
      // temporary cover with its own z-index; judge the menu once it has passed.
      await page.waitForFunction(() => !document.querySelector('#story-cinema.show'), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(300);
      const res = await page.evaluate(hitTest, rootSelector);
      const tag = `${String(w).padStart(4)}x${String(h).padEnd(4)} ${name.padEnd(9)}`;
      if (res.missing) { console.log(`  ??    ${tag} root ${rootSelector} not found`); return; }
      if (!res.covered.length) { console.log(`  ok    ${tag} ${res.checked} controls`); return; }
      for (const c of res.covered) { bad++; console.log(`  FAIL  ${tag} ${c.what} @${c.rect} covered by ${c.by}`); report.push({ size: `${w}x${h}`, name, ...c }); }
    };

    if (want('pause')) { await page.keyboard.press('Escape'); await probe('pause', '#pause-overlay'); await closeAll(); }
    if (want('bench')) { await page.keyboard.press('KeyB'); await probe('bench', '#wand-bench'); await closeAll(); }
    if (want('map')) { await page.keyboard.press('KeyM'); await probe('map', '#minimap-overlay'); await closeAll(); }
    if (want('handbook')) { await page.keyboard.press('KeyH'); await probe('handbook', '#help-overlay'); await closeAll(); }
    if (want('grimoire')) { await page.keyboard.press('KeyJ'); await probe('grimoire', '#grimoire-overlay'); await closeAll(); }
    if (want('settings')) {
      // Open the pause menu (the earlier steps' closeAll can leave Esc's own toggle out of step with the page, so press until it shows),
      // then press its own "Controls & comfort" button with a real click. Without this the step could pass with the dialog never open (0 controls).
      for (let i = 0; i < 3 && !(await page.evaluate(() => document.querySelector('#pause-overlay.visible') !== null)); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      const b = page.locator('#pause-settings');
      if (await b.count()) { const box = await b.boundingBox(); if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }
      await probe('settings', '#player-settings'); await closeAll();
    }
    if (want('offer')) {
      await page.evaluate(() => window.__game.ctx.events.emit('cardOfferRequested', { source: 'tome', title: 'A water-stained tome', prompt: 'Choose one spell to keep.', cards: ['frostshard', 'bounce', 'heavy'], onChoose() {}, onDismiss() {} }));
      await probe('offer', '#card-offer-overlay');
      await page.keyboard.press('Digit1'); await page.waitForTimeout(400); await closeAll();
    }
    if (want('sanctum')) {
      await page.evaluate(() => { const c = window.__game.ctx; c.state.score = 240; c.sanctum.open(c, () => {}); });
      await probe('sanctum', '#sanctum-overlay', 1400);
      // The Sanctum's promise (menus.css): the doors, the boons and the button that
      // waits on them sit in view without scrolling; only the optional provisions
      // may. Judged with Matron Ash's line up and typed out, as a player meets it.
      await page.waitForTimeout(2600);
      const fold = await page.evaluate(foldTest);
      const ftag = `${String(w).padStart(4)}x${String(h).padEnd(4)} sanc-fold`;
      if (fold.missing) console.log(`  ??    ${ftag} .sanc-body not found`);
      else if (!fold.out.length) console.log(`  ok    ${ftag} doors and boons in view`);
      // Under ~1100x690 the 16:9 view is under 620 px tall: the doors' lore and the
      // boons cannot both fit without cutting content, so the body scrolls there. Noted, not failed.
      else if (w < 1100 || h < 690) console.log(`  note  ${ftag} tiny view scrolls: ${fold.out.length} card(s) below the fold`);
      else { bad++; console.log(`  FAIL  ${ftag} below the fold: ${fold.out.join(' | ')}`); }
      await page.evaluate(() => { const c = window.__game.ctx; c.sanctum.close?.(); c.state.paused = false; });
      await closeAll();
      await page.evaluate(() => { const c = window.__game.ctx; c.sanctum.openShop(c); });
      await probe('shop', '#sanctum-overlay', 1000);
      await page.evaluate(() => { const c = window.__game.ctx; c.sanctum.close?.(); c.state.paused = false; });
      await closeAll();
    }
    if (errs.length) console.log('  page errors:', errs.slice(0, 3));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(bad ? `\n${bad} covered control(s)` : '\nall controls reachable');
process.exit(bad ? 1 : 0);
