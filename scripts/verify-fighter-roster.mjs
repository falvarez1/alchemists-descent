// Drive the Fighter Roster (src/ui/FighterRoster.ts) in the real game with real clicks and key presses.
//
// What it proves, at every window size and in each place the roster will live:
//   - every control is reachable and inside the view (topmost at its own centre, no clipped text),
//   - arrow keys walk the grid with wrap, the dossier follows the focus, the role filter and the
//     search narrow it and the empty state offers the way back,
//   - the concept sheet is NOT requested until asked for (one request after, others only on step),
//   - Choose fires onChoose with the right id, Escape fires onCancel, focus is trapped and restored,
//     the game stays paused while it is open and is put back after,
//   - locked fighters can be read but not chosen, rebound keys show on the ability chips,
//   - reduced motion stills it, the game's hotkeys do not open anything underneath.
//
// Modes: title (over #expedition-entry, where the player meets it; the view is the whole window),
// play (over a run: the 16:9 letterbox, so 800x600 is an 800x450 view) and sandbox (the Workshop's
// smaller holder, one size only).
//
// Usage (dev server running): node scripts/verify-fighter-roster.mjs [url] [--sizes 800x600,960x600,1280x720,1600x900]
//                             [--modes title,play,sandbox] [--out verify-out/fighter-roster] [--no-shots]
// Exit code 1 on any failure.
import { mkdir } from 'node:fs/promises';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, startConsolePlayRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const sizes = opt('sizes', '800x600,960x600,1280x720,1600x900').split(',').map((s) => s.split('x').map(Number));
const modes = opt('modes', 'title,play,sandbox').split(',').filter(Boolean);
const outDir = opt('out', 'verify-out/fighter-roster');
const shots = !args.includes('--no-shots');

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) { passes++; console.log(`  ok    ${label}`); return; }
  failures++;
  console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ''}`);
};

const ROOT = '#fighter-roster';
const card = (id) => `${ROOT} .fr-card[data-entry="${id}"]`;

/** A real click at the middle of the element (never a synthetic event: hit-testing must be exercised). */
async function click(page, selector, { scroll = false } = {}) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 5000 });
  if (scroll) await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

const focusedEntry = (page) => page.evaluate(() => document.activeElement?.dataset?.entry ?? null);
const dossierName = (page) => page.locator(`${ROOT} .fr-name`).textContent();
const isOpen = (page) => page.evaluate(() => !!document.querySelector('#fighter-roster.visible') && !document.getElementById('fighter-roster').hidden);
const settle = (page, ms = 950) => page.waitForTimeout(ms);

/** In the page: the layout audit. Returns the problems found, as strings. */
const auditLayout = () => {
  const root = document.querySelector('#fighter-roster');
  const issues = [];
  const rr = root.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const rect = (r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  const label = (n) => `${n.tagName.toLowerCase()}${n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/)[0] : ''} "${(n.textContent || n.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
  const shell = root.querySelector('.fr-shell').getBoundingClientRect();
  if (shell.left < rr.left - 1 || shell.top < rr.top - 1 || shell.right > rr.right + 1 || shell.bottom > rr.bottom + 1) issues.push(`shell ${rect(shell)} spills out of root ${rect(rr)}`);
  if (rr.right > vw + 1 || rr.bottom > vh + 1) issues.push(`root ${rect(rr)} spills out of the window ${vw}x${vh}`);

  // Every control topmost at its own centre (clipped by the scrolling ancestors that hold it).
  const sel = 'button, input, summary, [tabindex="0"]';
  let checked = 0;
  for (const el of root.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    let l = r.left, t = r.top, rt = r.right, b = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (!/(auto|scroll|hidden|clip)/.test(o.overflowY + o.overflowX)) continue;
      const pr = p.getBoundingClientRect();
      l = Math.max(l, pr.left); t = Math.max(t, pr.top); rt = Math.min(rt, pr.right); b = Math.min(b, pr.bottom);
    }
    if (rt - l < 2 || b - t < 2) { issues.push(`NEEDS SCROLL (nothing showing) ${label(el)} @${rect(r)}`); continue; }
    checked++;
    const x = Math.min(Math.max((Math.max(l, 0) + Math.min(rt, vw)) / 2, 0), vw - 1);
    const y = Math.min(Math.max((Math.max(t, 0) + Math.min(b, vh)) / 2, 0), vh - 1);
    const top = document.elementFromPoint(x, y);
    if (!(top && (top === el || el.contains(top) || top.contains(el)))) issues.push(`COVERED ${label(el)} @${rect(r)} by ${top ? label(top) : 'nothing'}`);
  }
  // The controls that must be whole and in view, not merely clickable somewhere.
  for (const s of ['.fr-back', '.fr-search-input', '.fr-choose', '.fr-filter[aria-checked="true"]']) {
    const n = root.querySelector(s);
    if (!n || n.closest('[hidden]')) continue;
    const r = n.getBoundingClientRect();
    if (r.left < rr.left - 1 || r.top < rr.top - 1 || r.right > rr.right + 1 || r.bottom > rr.bottom + 1) issues.push(`NOT WHOLE IN VIEW ${s} @${rect(r)} root ${rect(rr)}`);
  }
  // Text that is cut off (an ellipsis is a decision for card names; headings and buttons must fit).
  for (const n of root.querySelectorAll('.fr-name, .fr-subtitle, .fr-title, .fr-choose-label, .fr-filter, .fr-sheet-btn, .fr-back, .fr-sheet-title, .fr-weapons, .fr-card-name, .fr-card-short, .fr-card-title, .fr-search-input, .fr-stage-sheet')) {
    if (n.closest('[hidden]') || getComputedStyle(n).display === 'none' || n.getClientRects().length === 0) continue;
    if (n.scrollWidth > n.clientWidth + 1) issues.push(`TEXT CLIPPED ${label(n)} scrollWidth ${n.scrollWidth} > ${n.clientWidth}`);
    if (n.matches('.fr-card-title') && n.scrollHeight > n.clientHeight + 1) issues.push(`TEXT CLIPPED (lines) ${label(n)} scrollHeight ${n.scrollHeight} > ${n.clientHeight}`);
  }
  // A placeholder is text too: the search box must show all of it.
  const input = root.querySelector('.fr-search-input');
  if (input && input.offsetParent) {
    const m = document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(input);
    m.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const need = m.measureText(input.placeholder).width;
    const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (need > room + 1) issues.push(`PLACEHOLDER CLIPPED needs ${Math.round(need)} has ${Math.round(room)}`);
  }
  return { issues, checked };
};

async function mount(page, mode) {
  await page.evaluate(async (placed) => {
    const { FighterRoster } = await import('/src/ui/FighterRoster.ts');
    window.__chosen = undefined;
    window.__cancelled = 0;
    window.__chooseCalls = 0;
    window.__roster = new FighterRoster(window.__game.ctx, {
      onChoose: (id) => { window.__chooseCalls++; window.__chosen = id ?? 'classic'; },
      onCancel: () => { window.__cancelled++; },
      unlockHint: (id) => `Probe hint for ${id}.`,
    });
    // A control that had focus before the roster opened: the roster must hand it back.
    const opener = document.createElement('button');
    opener.id = 'probe-opener';
    opener.textContent = 'opener';
    opener.style.cssText = 'position:fixed;left:2px;bottom:2px;z-index:1';
    document.body.appendChild(opener);
    // The host adds '#fighter-roster.visible' to KEYBOARD_UI_BLOCK_SELECTOR (input/InputManager.ts) so the game's own
    // key handler stands down while the roster is up. Until it does, stand in with an element that list already matches
    // (present only while the roster shows), so play and the Workshop behave here as they will once it is integrated.
    // The title needs no stand-in: #expedition-entry is on the list.
    if (placed !== 'title') {
      const owner = document.createElement('div');
      owner.className = 'app-dialog-root';
      owner.id = 'probe-keyboard-owner';
      owner.hidden = true;
      owner.style.display = 'none';
      window.__standIn = true;
      const sync = () => { const open = window.__standIn && !!document.querySelector('#fighter-roster.visible'); if (open && !owner.isConnected) document.body.appendChild(owner); else if (!open && owner.isConnected) owner.remove(); };
      window.__syncStandIn = sync;
      new MutationObserver(sync).observe(document.getElementById('fighter-roster'), { attributes: true, attributeFilter: ['class', 'hidden'] });
    }
  }, mode);
}

async function openRoster(page, id) {
  await page.evaluate((who) => { document.getElementById('probe-opener')?.focus(); window.__roster.open(who); }, id);
}

async function prepare(browser, [w, h], mode, extra = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, ...extra });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION_REFUSED|favicon/.test(m.text())) errors.push(m.text()); });
  // Import the roster module before the app's own scripts run, as the host's static import will at boot: its capture-phase key
  // guard then sits ahead of the game's listeners, which is the order the shipped game has.
  await page.addInitScript(() => { import('/src/ui/FighterRoster.ts').catch(() => {}); });
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}link=off`, { waitUntil: 'networkidle' });
  if (mode === 'sandbox') await leaveTitleIfShown(page);
  else if (mode === 'play') {
    await startConsolePlayRun(page, { seed: 7, settleMs: 5200 });
    await page.evaluate(() => { const c = window.__game.ctx; c.state.paused = false; c.state.debugGodMode = false; });
    await page.waitForFunction(() => !document.querySelector('#story-cinema.show'), null, { timeout: 30000 }).catch(() => {});
  } else {
    await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 15000 });
  }
  await page.waitForFunction(() => !!window.__game?.ctx, null, { timeout: 15000 });
  await mount(page, mode);
  return { page, context, requests, errors };
}

const tag = (w, h, mode) => `${mode} ${w}x${h}`;

/** The checks that depend on the window size: geometry, hit tests, key walk. */
async function sizeChecks(browser, size, mode) {
  const [w, h] = size;
  const t = tag(w, h, mode);
  console.log(`\n== ${t} ==`);
  const { page, context, requests, errors } = await prepare(browser, size, mode);
  try {
    const fighterRequests = () => requests.filter((u) => u.includes('/assets/fighters/'));
    check(`${t}: nothing under /assets/fighters/ is fetched before the roster is opened`, fighterRequests().length === 0, fighterRequests().join(' '));

    // ---- open: wide, with a fighter selected ----
    const pausedBefore = await page.evaluate(() => window.__game.ctx.state.paused);
    await openRoster(page, 'brann-rook');
    await settle(page);
    check(`${t}: open('brann-rook') shows the dialog`, await isOpen(page));
    const dlg = await page.evaluate(() => {
      const r = document.getElementById('fighter-roster');
      return { role: r.getAttribute('role'), modal: r.getAttribute('aria-modal'), labelled: !!document.getElementById(r.getAttribute('aria-labelledby')), z: getComputedStyle(r).zIndex, parent: r.parentElement?.id, paused: window.__game.ctx.state.paused, bodyClass: document.body.classList.contains('fighter-roster-open') };
    });
    check(`${t}: role=dialog, aria-modal, labelled, z-index 92, in #canvas-holder`, dlg.role === 'dialog' && dlg.modal === 'true' && dlg.labelled && dlg.z === '92' && dlg.parent === 'canvas-holder', JSON.stringify(dlg));
    check(`${t}: the game is paused while it is open`, dlg.paused === true);
    check(`${t}: focus lands on the selected fighter's card`, (await focusedEntry(page)) === 'brann-rook', String(await focusedEntry(page)));
    check(`${t}: the dossier shows the selected fighter`, (await dossierName(page)) === 'Brann Rook');
    const art = fighterRequests().filter((u) => !u.includes('/sheets/'));
    check(`${t}: the ten portraits load on first open, no sheet does`, art.length >= 10 && fighterRequests().every((u) => !u.includes('/sheets/')), `${art.length} portraits, ${fighterRequests().length - art.length} sheets`);

    // ---- geometry ----
    const audit = await page.evaluate(auditLayout);
    check(`${t}: ${audit.checked} controls topmost and in view, no clipped text`, audit.issues.length === 0, audit.issues.join(' | '));
    const stack = await page.evaluate(() => {
      const root = document.getElementById('fighter-roster');
      const rr = root.getBoundingClientRect();
      const probe = (el) => { if (!el || el.getClientRects().length === 0) return 'absent'; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return root.contains(top) ? 'covered-by-roster' : `ABOVE:${top?.id || top?.className}`; };
      const entry = document.getElementById('expedition-entry');
      return { widget: probe(document.getElementById('sound-quick')), entry: entry && !entry.hidden ? probe(entry.querySelector('.entry-content button')) : 'n/a', rr: `${Math.round(rr.width)}x${Math.round(rr.height)}`, holder: (() => { const c = document.getElementById('canvas-holder'); return `${c.clientWidth}x${c.clientHeight}`; })() };
    });
    check(`${t}: root fills the view (${stack.rr} of holder ${stack.holder})`, stack.rr === stack.holder, `${stack.rr} vs ${stack.holder}`);
    check(`${t}: it draws over the sound widget and the title (${stack.widget}, ${stack.entry})`, !String(stack.widget).startsWith('ABOVE') && !String(stack.entry).startsWith('ABOVE'), JSON.stringify(stack));
    const layout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#fighter-roster .fr-card:not([hidden])')];
      const first = cards[0];
      const cols = cards.filter((c) => Math.abs(c.offsetTop - first.offsetTop) < 4).length;
      const grid = document.querySelector('#fighter-roster .fr-grid');
      const dossier = document.querySelector('#fighter-roster .fr-dossier').getBoundingClientRect();
      const rootBox = document.getElementById('fighter-roster'); return { rw: rootBox.clientWidth, rh: rootBox.clientHeight, cards: cards.length, cols, gridScrolls: grid.scrollHeight > grid.clientHeight + 1 || grid.scrollWidth > grid.clientWidth + 1, dossierW: Math.round(dossier.width), dossierH: Math.round(dossier.height), nameFits: [...document.querySelectorAll('#fighter-roster .fr-card-name')].filter((n) => n.offsetParent && n.scrollWidth > n.clientWidth + 1).length };
    });
    console.log(`        layout: ${layout.cards} cards, ${layout.cols} across, grid scrolls=${layout.gridScrolls}, dossier ${layout.dossierW}x${layout.dossierH}`);
    check(`${t}: eleven cards (the classic Alchemist, then the ten)`, layout.cards === 11, String(layout.cards));
    // The layout is chosen by the overlay's own size (a run's view is the 16:9 letterbox inside the window), so judge by that.
    if (layout.rw >= 1100 && layout.rh >= 640) check(`${t}: the wide layout (view ${layout.rw}x${layout.rh}) shows every card without scrolling`, !layout.gridScrolls && layout.cols === 6, JSON.stringify(layout));
    else check(`${t}: the compact layout (view ${layout.rw}x${layout.rh}) is four across`, layout.cols === 4 || layout.rw < 640, JSON.stringify(layout));

    // ---- the dossier follows arrow keys; wrap; grid-aware up/down ----
    const order = await page.evaluate(async () => { const m = await import('/src/content/fighters.ts'); return ['classic', ...m.FIGHTER_ORDER]; });
    await page.locator(card('classic')).focus();
    await page.keyboard.press('ArrowLeft');
    check(`${t}: ArrowLeft from the first card wraps to the last`, (await focusedEntry(page)) === order[order.length - 1], String(await focusedEntry(page)));
    check(`${t}: the dossier followed the focus (${order[order.length - 1]})`, (await dossierName(page)) === 'Father Thorne', await dossierName(page));
    await page.keyboard.press('ArrowRight');
    check(`${t}: ArrowRight from the last card wraps to the first`, (await focusedEntry(page)) === 'classic');
    let seq = [];
    for (let i = 0; i < order.length - 1; i++) { await page.keyboard.press('ArrowRight'); seq.push(await focusedEntry(page)); }
    check(`${t}: ArrowRight walks the whole grid in order`, JSON.stringify(seq) === JSON.stringify(order.slice(1)), seq.join(','));
    await page.waitForTimeout(450);
    const cols = layout.cols;
    const expectDown = (i) => { if (cols >= order.length) return i; const rows = Math.ceil(order.length / cols); const row = Math.floor(i / cols), col = i % cols; return Math.min(((row + 1) % rows) * cols + col, order.length - 1); };
    const expectUp = (i) => { if (cols >= order.length) return i; const rows = Math.ceil(order.length / cols); const row = Math.floor(i / cols), col = i % cols; return Math.min(((row - 1 + rows) % rows) * cols + col, order.length - 1); };
    let bad = [];
    for (const start of [0, 1, Math.min(5, order.length - 1), Math.min(cols, order.length - 1), order.length - 1]) {
      await page.locator(card(order[start])).focus();
      await page.keyboard.press('ArrowDown');
      const down = order.indexOf(await focusedEntry(page));
      if (down !== expectDown(start)) bad.push(`down ${start}->${down} want ${expectDown(start)}`);
      await page.locator(card(order[start])).focus();
      await page.keyboard.press('ArrowUp');
      const up = order.indexOf(await focusedEntry(page));
      if (up !== expectUp(start)) bad.push(`up ${start}->${up} want ${expectUp(start)}`);
    }
    check(`${t}: ArrowUp/ArrowDown keep the column and wrap (${cols} across)`, bad.length === 0, bad.join('; '));
    await page.keyboard.press('Home');
    check(`${t}: Home goes to the first card`, (await focusedEntry(page)) === 'classic');
    await page.keyboard.press('End');
    check(`${t}: End goes to the last card`, (await focusedEntry(page)) === order[order.length - 1]);
    // A card the walk reached is whole inside the grid's visible box (the strip/scroller follows the focus).
    await page.waitForTimeout(500);
    let offscreen = [];
    for (const id of order) {
      await page.locator(card(id)).focus();
      await page.waitForTimeout(w < 1100 || h < 640 ? 360 : 40);
      const vis = await page.evaluate((who) => {
        const c = document.querySelector(`#fighter-roster .fr-card[data-entry="${who}"]`).getBoundingClientRect();
        const g = document.querySelector('#fighter-roster .fr-grid').getBoundingClientRect();
        return c.left >= g.left - 2 && c.right <= g.right + 2 && c.top >= g.top - 2 && c.bottom <= g.bottom + 2;
      }, id);
      if (!vis) offscreen.push(id);
    }
    check(`${t}: each focused card scrolls fully into view`, offscreen.length === 0, offscreen.join(','));

    // ---- every fighter in the dossier: nothing clipped, the buttons say the name ----
    let dossierIssues = [];
    for (const id of order) {
      await page.locator(card(id)).focus();
      await page.waitForTimeout(30);
      const a = await page.evaluate(auditLayout);
      if (a.issues.length) dossierIssues.push(`${id}: ${a.issues.join(' / ')}`);
    }
    check(`${t}: no clipped text or covered control for any of the ${order.length} dossiers`, dossierIssues.length === 0, dossierIssues.join(' || '));
    const longest = await page.evaluate(() => {
      const out = [];
      for (const id of ['rusk-emberjaw', 'father-thorne', 'selene-wraith']) {
        document.querySelector(`#fighter-roster .fr-card[data-entry="${id}"]`).focus();
        const b = document.querySelector('#fighter-roster .fr-choose');
        const l = b.querySelector('.fr-choose-label');
        out.push(`${l.textContent}:${l.scrollWidth <= l.clientWidth + 1 ? 'fits' : 'CLIPPED'}`);
      }
      return out;
    });
    check(`${t}: the longest Choose labels fit (${longest.join(', ')})`, longest.every((s) => s.endsWith('fits')), longest.join(', '));

    // ---- text scale: a player's larger text keeps the controls in view ----
    await page.evaluate(() => document.documentElement.style.setProperty('--text-scale', '1.2'));
    await page.waitForTimeout(120);
    const big = await page.evaluate(auditLayout);
    await page.evaluate(() => document.documentElement.style.removeProperty('--text-scale'));
    check(`${t}: at text scale 1.2 the controls stay in view`, big.issues.filter((s) => !s.startsWith('TEXT CLIPPED')).length === 0, big.issues.join(' | '));
    const bigClipped = big.issues.filter((s) => s.startsWith('TEXT CLIPPED'));
    if (bigClipped.length) console.log(`  note  ${t}: at text scale 1.2 ${bigClipped.length} text(s) clip: ${bigClipped.slice(0, 3).join(' | ')}`);

    // ---- screenshots ----
    if (shots) {
      await mkdir(outDir, { recursive: true });
      const base = `${outDir}/${mode}-${w}x${h}`;
      await page.locator(card('sable-fen')).focus();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${base}-selected.png` });
      await page.locator(card('classic')).focus();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${base}-classic.png` });
      await click(page, `${ROOT} .fr-filter[data-role="Controller"]`);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${base}-filtered.png` });
      await click(page, `${ROOT} .fr-filter[data-role="All"]`);
      await click(page, `${ROOT} .fr-search-input`);
      await page.keyboard.type('zzz');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${base}-empty.png` });
      await click(page, `${ROOT} .fr-empty-reset`);
      await page.waitForTimeout(700);
      await page.locator(card('mara-quell')).focus();
      await click(page, `${ROOT} .fr-sheet-btn`);
      await page.waitForFunction(() => { const i = document.querySelector('#fighter-roster .fr-sheet-img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${base}-sheet.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }

    // ---- close, and the host's state is put back ----
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(`${t}: Escape closes it and fires onCancel once`, !(await isOpen(page)) && (await page.evaluate(() => window.__cancelled)) === 1);
    check(`${t}: the pause the roster took is put back`, (await page.evaluate(() => window.__game.ctx.state.paused)) === pausedBefore);
    check(`${t}: focus returns to the control that opened it`, (await page.evaluate(() => document.activeElement?.id)) === 'probe-opener', await page.evaluate(() => document.activeElement?.id));
    check(`${t}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

/** The behaviour checks: run once per mode at one comfortable size. */
async function behaviourChecks(browser, size, mode) {
  const [w, h] = size;
  const t = `${tag(w, h, mode)} behaviour`;
  console.log(`\n== ${t} ==`);
  const { page, context, requests, errors } = await prepare(browser, size, mode);
  try {
    const sheetRequests = () => requests.filter((u) => u.includes('/assets/fighters/sheets/'));
    // -- open with the classic and read the first card --
    await openRoster(page, null);
    await settle(page);
    check(`${t}: open(null) focuses the classic Alchemist and the dossier says so`, (await focusedEntry(page)) === 'classic' && (await dossierName(page)) === 'The Alchemist');
    const classic = await page.evaluate(() => ({
      blurb: document.querySelector('#fighter-roster .fr-lore').textContent,
      sheetHidden: document.querySelector('#fighter-roster .fr-sheet-btn').hidden,
      choose: document.querySelector('#fighter-roster .fr-choose-label').textContent,
      weapons: document.querySelector('#fighter-roster .fr-weapons').textContent,
      current: document.querySelector('#fighter-roster .fr-card[data-entry="classic"]').classList.contains('is-current'),
    }));
    check(`${t}: the classic copy is the brief's`, classic.blurb === 'The classic descent: the Alchemist, no passive and no abilities.', classic.blurb);
    check(`${t}: no concept sheet for the classic; Choose says Keep; the weapons line is there`, classic.sheetHidden && classic.choose === 'Keep the Alchemist' && classic.weapons === 'Weapons come from your kit and from loot.', JSON.stringify(classic));
    check(`${t}: the card for what the host had chosen wears the current mark`, classic.current);

    // -- click a card: the dossier follows; Enter hops to Choose --
    await click(page, card('mara-quell'), { scroll: true });
    await page.waitForTimeout(120);
    check(`${t}: clicking a card shows its dossier`, (await dossierName(page)) === 'Mara Quell' && (await page.locator(`${ROOT} .fr-subtitle`).textContent()) === 'The Bell Witch');
    const kit = await page.evaluate(() => [...document.querySelectorAll('#fighter-roster .fr-ability')].map((a) => `${a.querySelector('.fr-ability-type span').textContent}:${a.querySelector('.fr-ability-key').hidden ? '-' : a.querySelector('.fr-ability-key').textContent}:${a.querySelector('.fr-ability-name').textContent}`));
    check(`${t}: the kit shows Passive, Tactical on Z, Ultimate on T`, JSON.stringify(kit) === JSON.stringify(['Passive:-:Keen Resonance', 'Tactical:Z:Resonance Bell', 'Ultimate:T:Dead Chime']), kit.join(' | '));
    const stats = await page.evaluate(() => [...document.querySelectorAll('#fighter-roster .fr-stat')].map((s) => `${s.querySelector('.fr-stat-head span').textContent}=${s.querySelector('.fr-stat-value').textContent}:${s.querySelectorAll('.fr-tick.is-on').length}`));
    check(`${t}: the stat bars are Offense 4, Mobility 5, Survival 5, Utility 10`, JSON.stringify(stats) === JSON.stringify(['Offense=4:4', 'Mobility=5:5', 'Survival=5:5', 'Utility=10:10']), stats.join(' | '));
    await page.keyboard.press('Enter');
    check(`${t}: Enter on a card keeps its dossier and carries on to Choose`, (await dossierName(page)) === 'Mara Quell' && (await page.evaluate(() => document.activeElement?.classList.contains('fr-choose'))));
    const rebound = await page.evaluate(() => { window.__roster.refresh({ keyLabels: { tactical: 'Q', ultimate: 'R' } }); return [...document.querySelectorAll('#fighter-roster .fr-ability-key')].filter((k) => !k.hidden).map((k) => k.textContent).join(''); });
    check(`${t}: refresh({keyLabels}) rebinds the chips (Q, R)`, rebound === 'QR', rebound);
    await page.evaluate(() => window.__roster.refresh({ keyLabels: { tactical: 'Z', ultimate: 'T' } }));

    // -- the role filter and the search --
    await click(page, `${ROOT} .fr-filter[data-role="Duelist"]`);
    await page.waitForTimeout(150);
    const duelists = await page.evaluate(() => [...document.querySelectorAll('#fighter-roster .fr-card:not([hidden])')].map((c) => c.dataset.entry));
    check(`${t}: the Duelist filter shows the three duelists (and not the classic)`, JSON.stringify(duelists) === JSON.stringify(['ilyra-voss', 'kest-rel', 'selene-wraith']), duelists.join(','));
    check(`${t}: the dossier moved to a duelist the filter kept`, ['Ilyra Voss', 'Kest Rel', 'Selene Wraith'].includes(await dossierName(page)), await dossierName(page));
    check(`${t}: the filter bar says what is pressed`, (await page.locator(`${ROOT} .fr-filter[data-role="Duelist"]`).getAttribute('aria-checked')) === 'true' && (await page.locator(`${ROOT} .fr-filter[data-role="All"]`).getAttribute('aria-checked')) === 'false');
    await click(page, `${ROOT} .fr-search-input`);
    await page.keyboard.type('smoke');
    await page.waitForTimeout(150);
    const smoke = await page.evaluate(() => [...document.querySelectorAll('#fighter-roster .fr-card:not([hidden])')].map((c) => c.dataset.entry));
    check(`${t}: "smoke" within Duelist leaves Kest Rel`, JSON.stringify(smoke) === JSON.stringify(['kest-rel']), smoke.join(','));
    check(`${t}: the typed letters reached the search box and no hotkey fired`, (await page.locator(`${ROOT} .fr-search-input`).inputValue()) === 'smoke' && !(await page.evaluate(() => !!document.querySelector('#wand-bench.visible, #help-overlay.visible, #minimap-overlay.visible, #grimoire-overlay.open'))));
    await click(page, `${ROOT} .fr-filter[data-role="All"]`);
    await page.waitForTimeout(150);
    const smokeAll = await page.evaluate(() => [...document.querySelectorAll('#fighter-roster .fr-card:not([hidden])')].map((c) => c.dataset.entry));
    check(`${t}: "smoke" across all roles finds Kest Rel and Nox Calder`, smokeAll.includes('kest-rel') && smokeAll.includes('nox-calder') && !smokeAll.includes('classic'), smokeAll.join(','));
    await page.locator(`${ROOT} .fr-search-input`).fill('');
    await page.keyboard.type('zzzz');
    await page.waitForTimeout(150);
    const empty = await page.evaluate(() => ({ shown: !document.querySelector('#fighter-roster .fr-empty').hidden, msg: document.querySelector('#fighter-roster .fr-empty-text').textContent, grid: document.querySelector('#fighter-roster .fr-grid').hidden }));
    check(`${t}: nothing matching shows the empty state with a way back`, empty.shown && empty.grid && /zzzz/.test(empty.msg), JSON.stringify(empty));
    await click(page, `${ROOT} .fr-empty-reset`);
    await page.waitForTimeout(150);
    const reset = await page.evaluate(() => ({ cards: document.querySelectorAll('#fighter-roster .fr-card:not([hidden])').length, q: document.querySelector('#fighter-roster .fr-search-input').value, focus: document.activeElement?.className }));
    check(`${t}: Clear search and filter restores all eleven cards`, reset.cards === 11 && reset.q === '', JSON.stringify(reset));
    // "/" focuses the search from the grid; Escape clears it first, then closes
    await page.locator(card('kest-rel')).focus();
    await page.keyboard.press('Slash');
    check(`${t}: "/" focuses the search`, await page.evaluate(() => document.activeElement?.classList.contains('fr-search-input')));
    await page.keyboard.type('bell');
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    check(`${t}: Escape in the search clears it and keeps the roster open`, (await isOpen(page)) && (await page.locator(`${ROOT} .fr-search-input`).inputValue()) === '' && (await page.evaluate(() => window.__cancelled)) === 0);
    await page.keyboard.press('ArrowDown');
    check(`${t}: ArrowDown from the search drops into the grid`, (await page.evaluate(() => document.activeElement?.classList.contains('fr-card'))));

    // -- the role filters are a roving radio group --
    await page.locator(`${ROOT} .fr-filter[aria-checked="true"]`).focus();
    await page.keyboard.press('ArrowRight');
    check(`${t}: ArrowRight on the filters moves and applies the next role (Duelist)`, (await page.locator(`${ROOT} .fr-filter[data-role="Duelist"]`).getAttribute('aria-checked')) === 'true');
    await page.keyboard.press('Home');
    check(`${t}: Home on the filters returns to All`, (await page.locator(`${ROOT} .fr-filter[data-role="All"]`).getAttribute('aria-checked')) === 'true');

    // -- the concept sheet: lazy --
    check(`${t}: no concept sheet has been requested yet`, sheetRequests().length === 0, sheetRequests().join(' '));
    await click(page, card('selene-wraith'), { scroll: true });
    await click(page, `${ROOT} .fr-sheet-btn`);
    await page.waitForFunction(() => { const i = document.querySelector('#fighter-roster .fr-sheet-img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
    check(`${t}: asking for the sheet requests exactly that one`, sheetRequests().length === 1 && sheetRequests()[0].endsWith('/sheets/selene-wraith.webp'), sheetRequests().join(' '));
    const sheetUi = await page.evaluate(() => ({
      main: document.querySelector('#fighter-roster .fr-main').hidden, sheet: !document.querySelector('#fighter-roster .fr-sheet').hidden,
      title: document.querySelector('#fighter-roster .fr-sheet-title').textContent, count: document.querySelector('#fighter-roster .fr-sheet-count').textContent,
      focus: document.activeElement?.className, alt: document.querySelector('#fighter-roster .fr-sheet-img').alt.slice(0, 40),
    }));
    check(`${t}: the sheet replaces the browse view and names the fighter (${sheetUi.count})`, sheetUi.main && sheetUi.sheet && sheetUi.title === 'Selene Wraith' && sheetUi.count === '08 / 10' && /fr-sheet-back/.test(sheetUi.focus), JSON.stringify(sheetUi));
    const sheetFit = await page.evaluate(auditLayout);
    check(`${t}: the sheet's controls are in view and clickable (${sheetFit.checked})`, sheetFit.issues.length === 0, sheetFit.issues.join(' | '));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#fighter-roster .fr-sheet-title').textContent === 'Rusk Emberjaw', null, { timeout: 5000 }).catch(() => {});
    check(`${t}: ArrowRight steps to the next sheet, which loads on demand`, (await page.locator(`${ROOT} .fr-sheet-title`).textContent()) === 'Rusk Emberjaw' && sheetRequests().length === 2, `${sheetRequests().length} requests`);
    await click(page, `${ROOT} .fr-sheet-zoom`);
    check(`${t}: the zoom toggle switches the fit`, (await page.locator(`${ROOT} .fr-sheet-zoom`).getAttribute('aria-pressed')) !== null);
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    check(`${t}: Tab stays inside the sheet`, await page.evaluate(() => document.getElementById('fighter-roster').contains(document.activeElement) && !document.querySelector('#fighter-roster .fr-main').contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(`${t}: Escape closes the sheet, not the roster; focus returns to Concept sheet`, (await isOpen(page)) && (await page.evaluate(() => document.activeElement?.classList.contains('fr-sheet-btn'))) && (await page.evaluate(() => window.__cancelled)) === 0);
    check(`${t}: the dossier follows the sheet's last fighter`, (await dossierName(page)) === 'Rusk Emberjaw', await dossierName(page));

    // -- focus trap --
    const escaped = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      if (!(await page.evaluate(() => document.getElementById('fighter-roster').contains(document.activeElement)))) escaped.push(i);
    }
    check(`${t}: 40 Tab / Shift+Tab presses never leave the roster`, escaped.length === 0, escaped.join(','));

    // -- hotkeys do not open anything underneath --
    // The roster's own capture guard (installed when its module loads) must keep the hotkeys out even if the host's
    // keyboard-owner list never heard of it: take the stand-in away for this one check.
    await page.evaluate(() => { window.__standIn = false; window.__syncStandIn?.(); });
    for (const code of ['KeyB', 'KeyH', 'KeyM', 'KeyJ', 'KeyI', 'KeyL', 'KeyP']) await page.keyboard.press(code);
    const under = await page.evaluate(() => ['#wand-bench.visible', '#help-overlay.visible', '#minimap-overlay.visible', '#grimoire-overlay.open', '#dev-console.open', '#pause-overlay.visible'].filter((s) => document.querySelector(s)));
    check(`${t}: B, H, M, J, I, L, P open nothing underneath (${under.join(',') || 'nothing'})`, under.length === 0, under.join(','));
    await page.evaluate(() => { window.__standIn = true; window.__syncStandIn?.(); });

    // -- choose --
    await click(page, card('kest-rel'), { scroll: true });
    check(`${t}: Choose reads "Choose Kest Rel"`, (await page.locator(`${ROOT} .fr-choose-label`).textContent()) === 'Choose Kest Rel');
    await click(page, `${ROOT} .fr-choose`);
    await page.waitForTimeout(150);
    check(`${t}: Choose fires onChoose('kest-rel') once and closes`, (await page.evaluate(() => window.__chosen)) === 'kest-rel' && (await page.evaluate(() => window.__chooseCalls)) === 1 && !(await isOpen(page)));
    check(`${t}: onCancel was not called by a choice`, (await page.evaluate(() => window.__cancelled)) === 0);
    check(`${t}: focus returns to the opener after a choice`, (await page.evaluate(() => document.activeElement?.id)) === 'probe-opener');

    // -- reopen on that fighter: Keep; classic via double-click --
    await openRoster(page, 'kest-rel');
    await settle(page, 700);
    check(`${t}: reopened on Kest Rel the button says Keep and the card wears the mark`, (await page.locator(`${ROOT} .fr-choose-label`).textContent()) === 'Keep Kest Rel' && (await page.evaluate(() => document.querySelector('#fighter-roster .fr-card[data-entry="kest-rel"]').classList.contains('is-current'))));
    await page.locator(card('classic')).scrollIntoViewIfNeeded();
    const cb = await page.locator(card('classic')).boundingBox();
    await page.mouse.dblclick(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.waitForTimeout(150);
    check(`${t}: double-clicking the classic card chooses it (onChoose gets null)`, (await page.evaluate(() => window.__chosen)) === 'classic' && (await page.evaluate(() => window.__chooseCalls)) === 2 && !(await isOpen(page)));

    // -- locked fighters: readable, never chosen --
    await openRoster(page, 'ilyra-voss');
    await settle(page, 700);
    await page.evaluate(() => window.__roster.refresh({ unlocked: new Set(['ilyra-voss', 'brann-rook', 'sable-fen']) }));
    const lockedCards = await page.evaluate(() => [...document.querySelectorAll('#fighter-roster .fr-card.is-locked')].map((c) => c.dataset.entry));
    check(`${t}: seven cards are locked and still focusable`, lockedCards.length === 7 && (await page.evaluate(() => document.querySelector('#fighter-roster .fr-card[data-entry="rusk-emberjaw"]').getAttribute('aria-disabled'))) === 'true', lockedCards.join(','));
    await click(page, card('rusk-emberjaw'), { scroll: true });
    await page.waitForTimeout(150);
    const lock = await page.evaluate(() => ({ note: document.querySelector('#fighter-roster .fr-lock-note').hidden ? '' : document.querySelector('#fighter-roster .fr-lock-note').textContent, choose: document.querySelector('#fighter-roster .fr-choose-label').textContent, aria: document.querySelector('#fighter-roster .fr-choose').getAttribute('aria-disabled') }));
    check(`${t}: a locked fighter's dossier carries the hint and Choose says Locked`, /Probe hint for rusk-emberjaw/.test(lock.note) && lock.choose === 'Locked' && lock.aria === 'true', JSON.stringify(lock));
    const callsBefore = await page.evaluate(() => window.__chooseCalls);
    await click(page, `${ROOT} .fr-choose`);
    await page.waitForTimeout(150);
    check(`${t}: Choose on a locked fighter does nothing but refuse`, (await page.evaluate(() => window.__chooseCalls)) === callsBefore && (await isOpen(page)));
    const sheetBefore = sheetRequests().length;
    await click(page, `${ROOT} .fr-sheet-btn`);
    await page.waitForTimeout(150);
    check(`${t}: and its concept sheet stays shut`, (await page.evaluate(() => document.querySelector('#fighter-roster .fr-sheet').hidden)) && sheetRequests().length === sheetBefore);
    await page.evaluate(() => window.__roster.refresh({ unlocked: undefined }));
    check(`${t}: refresh({unlocked: undefined}) unlocks everyone`, (await page.evaluate(() => document.querySelectorAll('#fighter-roster .fr-card.is-locked').length)) === 0);

    // -- Back button --
    await click(page, `${ROOT} .fr-back`);
    await page.waitForTimeout(150);
    check(`${t}: Back closes it and fires onCancel`, !(await isOpen(page)) && (await page.evaluate(() => window.__cancelled)) === 1);

    // -- the pad's B / a pause request means Back, and the pause menu stays shut --
    await openRoster(page, null);
    await settle(page, 400);
    await page.evaluate(() => window.dispatchEvent(new Event('game-pause-request')));
    await page.waitForTimeout(150);
    check(`${t}: a game-pause-request (pad B) closes it as Back and opens no pause menu`, !(await isOpen(page)) && (await page.evaluate(() => window.__cancelled)) === 2 && !(await page.evaluate(() => !!document.querySelector('#pause-overlay.visible'))));

    // -- dispose removes it --
    await page.evaluate(() => window.__roster.dispose());
    check(`${t}: dispose() removes the overlay`, (await page.evaluate(() => !document.getElementById('fighter-roster'))));
    check(`${t}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

/** The states a still frame cannot show by default: mid-entrance, hover, locked, a larger text size. Screenshots only. */
async function stateShots(browser, size, mode) {
  const [w, h] = size;
  console.log(`\n== ${tag(w, h, mode)} states (screenshots) ==`);
  const { page, context } = await prepare(browser, size, mode);
  try {
    await mkdir(outDir, { recursive: true });
    const base = `${outDir}/state-${mode}-${w}x${h}`;
    await openRoster(page, 'edda-morrow');
    await page.waitForTimeout(130);
    await page.screenshot({ path: `${base}-entrance.png` });
    await page.waitForTimeout(900);
    const b = await page.locator(card('rusk-emberjaw')).boundingBox();
    if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${base}-hover.png` });
    await page.evaluate(() => window.__roster.refresh({ unlocked: new Set(['ilyra-voss', 'brann-rook', 'sable-fen', 'edda-morrow']) }));
    await page.mouse.move(2, 2);
    await page.locator(card('nox-calder')).focus();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${base}-locked.png` });
    await page.evaluate(() => { window.__roster.refresh({ unlocked: undefined }); document.documentElement.style.setProperty('--text-scale', '1.25'); });
    await page.locator(card('selene-wraith')).focus();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${base}-textscale.png` });
    check(`${tag(w, h, mode)}: state screenshots written`, true);
  } finally {
    await context.close();
  }
}

/** Reduced motion: no animation or transition survives. */
async function motionChecks(browser, size, mode) {
  const t = `${tag(size[0], size[1], mode)} reduced motion`;
  console.log(`\n== ${t} ==`);
  const { page, context } = await prepare(browser, size, mode, { reducedMotion: 'reduce' });
  try {
    await openRoster(page, 'ilyra-voss');
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const names = (sel) => { const n = document.querySelector(sel); const cs = getComputedStyle(n); return `${cs.animationName}/${cs.transitionDuration}`; };
      return { card: names('#fighter-roster .fr-card'), shell: names('#fighter-roster .fr-shell'), root: names('#fighter-roster'), tick: names('#fighter-roster .fr-tick') };
    });
    check(`${t}: no animation or transition on the root, shell, cards or ticks`, Object.values(m).every((s) => s.startsWith('none/') && /\/0s$/.test(s)), JSON.stringify(m));
  } finally {
    await context.close();
  }
  // The player's own "reduce flashes" setting stills it too, with the system preference left alone.
  const second = await prepare(browser, size, mode);
  try {
    await second.page.evaluate(() => { window.__game.ctx.state.reduceFlashes = true; });
    await openRoster(second.page, 'ilyra-voss');
    await second.page.waitForTimeout(150);
    const m = await second.page.evaluate(() => {
      const names = (sel) => { const cs = getComputedStyle(document.querySelector(sel)); return `${cs.animationName}/${cs.transitionDuration}`; };
      return { still: document.getElementById('fighter-roster').classList.contains('fr-still'), card: names('#fighter-roster .fr-card'), shell: names('#fighter-roster .fr-shell'), root: names('#fighter-roster') };
    });
    check(`${t}: ctx.state.reduceFlashes stills it as well (fr-still)`, m.still && [m.card, m.shell, m.root].every((s) => s.startsWith('none/') && /\/0s$/.test(s)), JSON.stringify(m));
  } finally {
    await second.context.close();
  }
}

const browser = await launchBrowser();
try {
  for (const mode of modes) {
    if (mode === 'sandbox') { await sizeChecks(browser, [1600, 900], 'sandbox'); continue; }
    for (const size of sizes) await sizeChecks(browser, size, mode);
    await behaviourChecks(browser, [1280, 720], mode);
    if (mode === 'title' || mode === 'play') await behaviourChecks(browser, [800, 600], mode);
    await motionChecks(browser, [1280, 720], mode);
    if (shots && mode === 'title') await stateShots(browser, [1280, 720], mode);
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failure(s), ${passes} passed` : `\nall ${passes} checks passed`);
process.exit(failures ? 1 : 0);
