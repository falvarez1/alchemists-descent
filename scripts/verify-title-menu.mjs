// The title screen as a game menu (ui/ExpeditionEntry, ui/title/*): a short main list, each door opens its own page,
// the card beside a page explains the row in focus. Real keys and a real mouse; a fresh profile at three window sizes.
//   main page: only the doors (no kit / difficulty / fighter / seed controls dumped on it), all above the fold
//   keyboard: Up / Down wrap, Home / End, Enter opens, Escape and Backspace go back and the page you left keeps its place
//   rows: Left / Right change a choice in place (and persist), Enter opens the list, a locked entry refuses and explains
//   pointer: moving the mouse moves the selection, a page changing under a resting pointer does not
//   seed: a page with a field; the chosen seed shows on its row and starts the descent
//   pad: the keys InputManager dispatches for the d-pad / A / B do the same things
//   Descend starts a run with exactly what the rows say
// Usage: node scripts/verify-title-menu.mjs [url] [--sizes 1400x860,1280x720,960x600]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const optIdx = args.indexOf('--sizes');
const sizes = (optIdx >= 0 ? args[optIdx + 1] : '1400x860,1280x720,960x600').split(',').map((s) => s.split('x').map(Number));
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/title', { recursive: true });

const SETTLE = 480; // a page change animates in for ~0.4 s

for (const [w, h] of sizes) {
  const tag = `${w}x${h}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION_REFUSED|favicon/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.removeItem('alchemists-descent-meta'); localStorage.removeItem('noita-expedition'); sessionStorage.clear(); } catch { /* storage may be blocked */ } });
  await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
  await waitForConsoleApi(page);
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(900);

  const items = () => page.evaluate(() => [...document.querySelectorAll('#expedition-entry .tm-item')].map((n) => n.dataset.entry));
  const focused = () => page.evaluate(() => document.activeElement?.dataset?.entry ?? document.activeElement?.id ?? document.activeElement?.tagName);
  const press = async (key) => { await page.keyboard.press(key); await page.waitForTimeout(90); };
  const settle = () => page.waitForTimeout(SETTLE);
  const rowValue = (id) => page.evaluate((entry) => document.querySelector(`#expedition-entry .tm-item[data-entry="${entry}"] .tm-value`)?.textContent ?? '', id);
  const card = () => page.evaluate(() => { const d = document.querySelector('#expedition-entry .tm-detail'); return d && !d.hidden ? d.textContent : ''; });
  const visible = (selector) => page.locator(selector).first().isVisible().catch(() => false);
  const click = async (selector) => {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    const b = await loc.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(SETTLE);
  };
  const inFold = () => page.evaluate(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll('#expedition-entry .tm-item, #expedition-entry .tm-detail:not([hidden]), #expedition-entry .tm-page-head')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.top < -1 || r.bottom > vh + 1 || r.left < -1 || r.right > vw + 1) bad.push(`${el.dataset?.entry ?? el.className} ${Math.round(r.top)}..${Math.round(r.bottom)} of ${vh}`);
    }
    const root = document.getElementById('expedition-entry');
    return { bad, hscroll: root.scrollWidth > root.clientWidth + 1 };
  });

  // ---- the main page: only the doors ----
  const main = await items();
  check(`${tag}: the main page lists the doors, in order`, JSON.stringify(main.filter((id) => id !== 'workshops')) === JSON.stringify(['begin', 'daily', 'extras', 'settings']), JSON.stringify(main));
  check(`${tag}: it is short (six rows at most)`, main.length <= 6, String(main.length));
  const dumped = await page.evaluate(() => ['.kit-chip', '.difficulty-chip', '.fighter-pick-chip', '[data-entry="case"]', '[data-entry="fighter"]', '[data-entry="seed"]', '[data-entry="trailer"]'].filter((s) => document.querySelector(`#expedition-entry ${s}`)));
  check(`${tag}: no case, fighter, difficulty, seed or trailer controls on the main page`, dumped.length === 0, JSON.stringify(dumped));
  check(`${tag}: New descent holds the focus (the call to action)`, (await focused()) === 'begin', await focused());
  const fold0 = await inFold();
  check(`${tag}: every row is above the fold, nothing scrolls sideways`, fold0.bad.length === 0 && !fold0.hscroll, JSON.stringify(fold0));
  const big = await page.evaluate(() => document.querySelector('#expedition-entry h1').getBoundingClientRect().height);
  check(`${tag}: the title is the big wordmark`, big > 70, String(big));
  check(`${tag}: the key legend names Select and Open`, /Select/.test(await page.locator('#expedition-entry .tm-keys').textContent()) && /Open/.test(await page.locator('#expedition-entry .tm-keys').textContent()));
  check(`${tag}: Today's descent shows the date`, /\d{4}-\d{2}-\d{2}/.test(await page.locator('#expedition-entry [data-entry="daily"]').textContent()));
  await page.screenshot({ path: `verify-out/title/menu-${tag}-main.png` });

  // ---- keyboard on the main page ----
  await press('ArrowDown');
  check(`${tag}: Down moves to Today's descent`, (await focused()) === 'daily', await focused());
  await press('ArrowUp'); await press('ArrowUp');
  check(`${tag}: Up from the first row wraps to the last`, (await focused()) === 'settings', await focused());
  await press('Home');
  check(`${tag}: Home is the first row`, (await focused()) === 'begin', await focused());
  await press('End');
  check(`${tag}: End is the last row`, (await focused()) === 'settings', await focused());
  await press('Escape');
  check(`${tag}: Escape on the main page does nothing`, (await visible('#expedition-entry [data-entry="begin"]')) && (await focused()) === 'settings');
  await press('Home');

  // ---- New descent: the loadout page ----
  await press('Enter'); await settle();
  const descent = await items();
  check(`${tag}: Enter opens the loadout page`, JSON.stringify(descent) === JSON.stringify(['case', 'fighter', 'difficulty', 'complications', 'seed', 'descend', 'back']), JSON.stringify(descent));
  check(`${tag}: it opens on Descend`, (await focused()) === 'descend', await focused());
  const small = await page.evaluate(() => document.querySelector('#expedition-entry h1').getBoundingClientRect().height);
  check(`${tag}: the title steps back to a wordmark`, small < 60 && small < big / 1.6, `${small} vs ${big}`);
  check(`${tag}: the page is named`, /Prepare your descent/.test(await page.locator('#expedition-entry .tm-title').textContent()));
  check(`${tag}: Descend has no card (nothing to explain)`, (await card()) === '');
  check(`${tag}: the legend gains Back`, /Back/.test(await page.locator('#expedition-entry .tm-keys').textContent()));
  check(`${tag}: the rows show a fresh profile's choices`, (await rowValue('case')) === 'Sparkwright' && (await rowValue('fighter')) === 'The Alchemist' && /Adept/.test(await rowValue('difficulty')) && (await rowValue('seed')) === 'Random');
  await press('ArrowUp'); await press('ArrowUp'); await press('ArrowUp'); await press('ArrowUp'); await press('ArrowUp');
  check(`${tag}: five Ups reach Case`, (await focused()) === 'case', await focused());
  check(`${tag}: its card explains the case`, /Sparkwright/.test(await card()) && /Spark bolt/.test(await card()), (await card()).slice(0, 80));
  const fold1 = await inFold();
  check(`${tag}: the page and its card are above the fold`, fold1.bad.length === 0 && !fold1.hscroll, JSON.stringify(fold1));
  await page.screenshot({ path: `verify-out/title/menu-${tag}-descent.png` });

  // ---- rows change in place ----
  await press('ArrowRight');
  check(`${tag}: Right on Case with one case owned changes nothing`, (await rowValue('case')) === 'Sparkwright');
  await press('ArrowDown'); await press('ArrowRight');
  const fighterNow = await rowValue('fighter');
  check(`${tag}: Right on Fighter picks the first fighter`, fighterNow === 'Ilyra Voss', fighterNow);
  check(`${tag}: and the card lists her three abilities with the keys`, /Volatile Mixture/.test(await card()) && /Flash Crucible/.test(await card()) && /Phoenix Draft/.test(await card()) && /Z/.test(await card()), (await card()).slice(0, 120));
  await page.screenshot({ path: `verify-out/title/menu-${tag}-fighter.png` });
  const fold2 = await inFold();
  check(`${tag}: the tall fighter card still fits the window`, fold2.bad.length === 0, JSON.stringify(fold2));
  await press('ArrowLeft'); await press('ArrowLeft');
  check(`${tag}: Left twice wraps to the last fighter`, (await rowValue('fighter')) === 'Father Thorne', await rowValue('fighter'));
  await press('ArrowRight');
  check(`${tag}: Right wraps back to the classic Alchemist`, (await rowValue('fighter')) === 'The Alchemist', await rowValue('fighter'));
  await press('ArrowRight');
  await press('ArrowDown'); await press('ArrowRight');
  check(`${tag}: Right on Difficulty goes to Apprentice (the open tiers wrap)`, /Apprentice/.test(await rowValue('difficulty')), await rowValue('difficulty'));
  const meta = await page.evaluate(() => ({ f: window.__game.ctx.run.metaView().lastFighter, d: window.__game.ctx.run.metaView().lastDifficulty }));
  check(`${tag}: the choices are remembered by the profile`, meta.f === 'ilyra-voss' && meta.d === 1, JSON.stringify(meta));

  // ---- lists: the current choice is focused, a locked one refuses and explains ----
  await press('ArrowUp'); await press('ArrowUp');
  await press('Enter'); await settle();
  check(`${tag}: Enter on Case opens the case list`, (await visible('#expedition-entry .tm-item[data-kit]')) && /Your case/.test(await page.locator('#expedition-entry .tm-title').textContent()));
  check(`${tag}: it opens on the case in use`, (await focused()) === 'kit-spark', await focused());
  const kits = await page.evaluate(() => [...document.querySelectorAll('#expedition-entry .tm-item[data-kit]')].map((n) => `${n.dataset.kit}:${n.classList.contains('locked') ? 'locked' : 'open'}:${n.getAttribute('aria-checked')}`));
  check(`${tag}: one case open and chosen, three locked`, JSON.stringify(kits) === JSON.stringify(['spark:open:true', 'frost:locked:false', 'ember:locked:false', 'storm:locked:false']), JSON.stringify(kits));
  await click('#expedition-entry .tm-item[data-kit="frost"]');
  check(`${tag}: choosing a locked case refuses (the list stays) and the card says how to earn it`, (await visible('#expedition-entry .tm-item[data-kit]')) && /Locked/.test(await card()) && /floor 2/i.test(await card()), (await card()).slice(0, 100));
  await page.screenshot({ path: `verify-out/title/menu-${tag}-case-list.png` });
  await press('Backspace'); await settle();
  check(`${tag}: Backspace goes back to the loadout page, on the row it came from`, (await focused()) === 'case', await focused());
  await press('ArrowDown'); await press('ArrowDown');
  await press('Enter'); await settle();
  check(`${tag}: Enter on Difficulty opens the tiers, on the current one`, (await focused()) === 'difficulty-1', await focused());
  await click('#expedition-entry .tm-item[data-difficulty="2"]');
  check(`${tag}: choosing Adept returns to the loadout page with the row updated`, (await visible('#expedition-entry [data-entry="descend"]')) && /Adept/.test(await rowValue('difficulty')), await rowValue('difficulty'));

  // ---- the fighter roster opens from the row, and Back returns to it ----
  await press('ArrowUp');
  await press('Enter');
  await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
  check(`${tag}: Enter on Fighter opens the roster`, await visible('#fighter-roster.visible'));
  await click('#fighter-roster .fr-card[data-entry="mara-quell"]');
  await click('#fighter-roster .fr-choose');
  await page.waitForTimeout(600);
  check(`${tag}: choosing in the roster updates the row and returns to it`, (await rowValue('fighter')) === 'Mara Quell' && (await focused()) === 'fighter', `${await rowValue('fighter')} / ${await focused()}`);

  // ---- the Complications page: toggles, three at a time ----
  await press('ArrowDown'); await press('ArrowDown');
  check(`${tag}: Complications row`, (await focused()) === 'complications', await focused());
  check(`${tag}: it says None, and its card says the Works as issued`, (await rowValue('complications')) === 'None' && /The Works as issued/.test(await card()), `${await rowValue('complications')} / ${(await card()).slice(0, 60)}`);
  await press('Enter'); await settle();
  const toggles = await page.evaluate(() => [...document.querySelectorAll('#expedition-entry .tm-item[data-mutator]')].map((n) => n.dataset.mutator));
  check(`${tag}: Enter opens twelve toggles`, toggles.length === 12 && toggles[0] === 'wet-floors', JSON.stringify(toggles));
  check(`${tag}: the legend says Toggle`, /Toggle/.test(await page.locator('#expedition-entry .tm-keys').textContent()));
  await press('Enter'); await press('ArrowDown'); await press('ArrowDown'); await press('Enter'); await press('ArrowDown'); await press('Enter'); await press('ArrowDown');
  const checkedNow = await page.evaluate(() => [...document.querySelectorAll('#expedition-entry .tm-item[data-mutator][aria-checked="true"]')].map((n) => n.dataset.mutator));
  check(`${tag}: Enter toggles an entry on and stays on the page`, JSON.stringify(checkedNow) === JSON.stringify(['wet-floors', 'slime-rain', 'gas-leak']), JSON.stringify(checkedNow));
  check(`${tag}: the page says what three add up to`, /3 in force/.test(await page.locator('#expedition-entry .tm-note').textContent()), await page.locator('#expedition-entry .tm-note').textContent());
  const fullLocked = await page.evaluate(() => [...document.querySelectorAll('#expedition-entry .tm-item[data-mutator]:not([aria-checked="true"])')].every((n) => n.getAttribute('aria-disabled') === 'true'));
  check(`${tag}: with three in force every other entry is locked`, fullLocked);
  await press('Enter');
  check(`${tag}: Enter on a locked entry refuses and its card says why`, /3 at a time/.test(await card()) && (await page.evaluate(() => document.querySelectorAll('#expedition-entry .tm-item[data-mutator][aria-checked="true"]').length)) === 3, (await card()).slice(0, 100));
  const fold3 = await inFold();
  check(`${tag}: the list may be taller than a short window, but nothing sticks out sideways`, !fold3.hscroll, JSON.stringify(fold3));
  await page.screenshot({ path: `verify-out/title/menu-${tag}-complications.png` });
  await press('Escape'); await settle();
  check(`${tag}: Escape returns to the row, which now says 3 in force; the recap counts them`, (await focused()) === 'complications' && (await rowValue('complications')) === '3 in force' && /3 complications/.test(await page.locator('#expedition-entry [data-entry="descend"]').textContent()), `${await focused()} / ${await rowValue('complications')}`);
  const storedMut = await page.evaluate(() => window.__game.ctx.run.metaView().lastMutators);
  check(`${tag}: the profile remembers them`, JSON.stringify(storedMut) === JSON.stringify(['wet-floors', 'slime-rain', 'gas-leak']), JSON.stringify(storedMut));

  // ---- the seed page ----
  await press('ArrowDown');
  check(`${tag}: Seed row`, (await focused()) === 'seed', await focused());
  await press('Enter'); await settle();
  check(`${tag}: the seed page opens in its field`, (await focused()) === 'entry-seed-input', await focused());
  check(`${tag}: Use this seed waits for a seed`, (await page.locator('#expedition-entry [data-seed="use"]').getAttribute('aria-disabled')) === 'true');
  await page.keyboard.type('Kettleby');
  check(`${tag}: words preview the number`, /Those words make seed \d+/.test(await page.locator('#entry-seed-preview').textContent()), await page.locator('#entry-seed-preview').textContent());
  check(`${tag}: letters typed in the field are the field's (Left, Backspace, n do not leave or mute)`, (await page.locator('#entry-seed-input').inputValue()) === 'Kettleby' && (await visible('#entry-seed-input')));
  await press('Backspace'); await press('ArrowLeft'); await press('b');
  check(`${tag}: editing keys edit`, (await page.locator('#entry-seed-input').inputValue()) !== 'Kettleby' && (await visible('#entry-seed-input')));
  await press('ArrowDown');
  check(`${tag}: Down from the field reaches Use this seed`, (await focused()) === 'use', await focused());
  await press('ArrowUp');
  check(`${tag}: Up returns to the field`, (await focused()) === 'entry-seed-input', await focused());
  await press('Enter'); await settle();
  const seedRow = await rowValue('seed');
  check(`${tag}: Enter in the field uses the seed: back on the loadout page, the row shows it`, /^\d+$/.test(seedRow) && (await visible('#expedition-entry [data-entry="descend"]')), seedRow);
  check(`${tag}: the recap on Descend names the seed`, new RegExp(`seed ${seedRow}`).test(await page.locator('#expedition-entry [data-entry="descend"]').textContent()));

  // ---- the pointer ----
  await page.mouse.move(40, 40);
  await page.mouse.move(60, 60);
  const caseBox = await page.locator('#expedition-entry [data-entry="case"]').boundingBox();
  await page.mouse.move(caseBox.x + 120, caseBox.y + 10);
  await page.mouse.move(caseBox.x + 130, caseBox.y + 14);
  await page.waitForTimeout(150);
  check(`${tag}: moving the mouse over a row selects it`, (await focused()) === 'case', await focused());
  await page.mouse.click(caseBox.x + 130, caseBox.y + 14);
  await settle();
  check(`${tag}: a click opens its page`, await visible('#expedition-entry .tm-item[data-kit]'));
  check(`${tag}: and the pointer resting where the click was does not pull the selection off the page's opening row`, (await focused()) === 'kit-spark', await focused());
  await click('#expedition-entry [data-entry="back"]');
  check(`${tag}: the Back row works with the mouse`, (await visible('#expedition-entry [data-entry="descend"]')) && (await focused()) === 'case', await focused());

  // ---- the pad: the keys InputManager dispatches ----
  await page.evaluate(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true })); });
  await page.waitForTimeout(90);
  check(`${tag}: a dispatched d-pad Down moves the selection`, (await focused()) === 'fighter', await focused());
  await page.evaluate(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); });
  await settle();
  check(`${tag}: and a dispatched B goes back to the main page, on New descent`, (await visible('#expedition-entry [data-entry="daily"]')) && (await focused()) === 'begin', await focused());

  // ---- extras ----
  for (let n = 0; n < 6 && (await focused()) !== 'extras'; n++) await press('ArrowDown'); // (an authoring build has a Workshops row before it)
  check(`${tag}: Extras`, (await focused()) === 'extras', await focused());
  await press('Enter'); await settle();
  const extras = await items();
  check(`${tag}: Extras holds the trailer (the opening only once it has been seen)`, JSON.stringify(extras) === JSON.stringify(['trailer', 'back']), JSON.stringify(extras));
  await page.screenshot({ path: `verify-out/title/menu-${tag}-extras.png` });
  await press('Escape'); await settle();
  await press('Home');

  // ---- a REAL pad through InputManager: a stand-in Gamepad the game polls (d-pad, A, B) ----
  await page.evaluate(() => {
    const pad = { connected: true, mapping: 'standard', id: 'probe pad', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  const tap = async (index) => {
    await page.evaluate((i) => { window.__pad.buttons[i].pressed = true; }, index);
    await page.waitForTimeout(140);
    await page.evaluate((i) => { window.__pad.buttons[i].pressed = false; }, index);
    await page.waitForTimeout(140);
  };
  const padKeys = await page.evaluate(() => [...document.querySelectorAll('#expedition-entry .tm-keys kbd')].map((k) => k.textContent));
  check(`${tag}: with a pad connected the legend names its buttons`, padKeys.includes('D-pad') && padKeys.includes('A') && !padKeys.includes('Enter'), JSON.stringify(padKeys));
  await tap(13);
  check(`${tag}: pad d-pad Down moves the selection`, (await focused()) === 'daily', await focused());
  await tap(12);
  check(`${tag}: pad d-pad Up moves it back`, (await focused()) === 'begin', await focused());
  await tap(0);
  await settle();
  check(`${tag}: pad A opens New descent, on Descend`, (await visible('#expedition-entry [data-entry="descend"]')) && (await focused()) === 'descend', await focused());
  await tap(12); await tap(12); await tap(12);
  check(`${tag}: three d-pad Ups reach Difficulty`, (await focused()) === 'difficulty', await focused());
  const before = await rowValue('difficulty');
  await tap(15);
  const changed = await rowValue('difficulty');
  check(`${tag}: pad d-pad Right changes the row in place`, changed !== before, `${before} -> ${changed}`);
  await tap(14);
  check(`${tag}: pad d-pad Left changes it back`, (await rowValue('difficulty')) === before, await rowValue('difficulty'));
  await tap(1);
  await settle();
  check(`${tag}: pad B goes back to the main page, on New descent`, (await visible('#expedition-entry [data-entry="daily"]')) && (await focused()) === 'begin', await focused());
  await page.evaluate(() => { navigator.getGamepads = () => []; window.dispatchEvent(new Event('gamepaddisconnected')); });

  // ---- Descend starts the run with exactly what the rows say ----
  await press('Enter'); await settle();
  check(`${tag}: back on the loadout page (the seed is still set)`, /^\d+$/.test(await rowValue('seed')), await rowValue('seed'));
  await press('Enter'); // Descend
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active === true, { timeout: 30000 });
  await page.evaluate(() => window.__game.ctx.fighters.whenReady());
  const run = await page.evaluate(() => { const c = window.__game.ctx; return { fighter: c.fighters.id, difficulty: c.state.difficulty, kit: c.run.snapshotForSave()?.kit, seed: c.run.snapshotForSave()?.seed, chosen: c.run.snapshotForSave()?.seedChosen, mutators: c.run.snapshotForSave()?.mutators ?? null, hidden: document.getElementById('expedition-entry').hidden }; });
  check(`${tag}: Descend starts the run as Mara Quell on Adept with the chosen seed`, run.fighter === 'mara-quell' && run.difficulty === 2 && run.kit === 'spark' && String(run.seed) === seedRow && run.chosen === true && run.hidden, JSON.stringify(run));
  check(`${tag}: and carries the three complications`, JSON.stringify(run.mutators) === JSON.stringify(['wet-floors', 'slime-rain', 'gas-leak']), JSON.stringify(run.mutators));
  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

console.log(`\ntitle menu probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
