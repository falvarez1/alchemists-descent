// Runtime verification of the difficulty ladder: the title screen's picker (locked tiers refuse a real
// click and say how they open), a chosen tier actually changes the run, a victory opens the next tier and
// the ledger announces it, the ledger names the tier played, and the daily descent is always Adept.
// Usage (dev server running): node scripts/verify-difficulty-ladder.mjs [url]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, waitForOpeningEnd } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out/difficulty-ladder';
mkdirSync(outDir, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' ' + detail : '')); }
};

const browser = await launchBrowser();
const consoleErrors = [];
const pageErrors = [];
const openTitle = async () => {
  // A new page is a fresh browser profile: no meta, no saved descent.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(600);
  return page;
};
const chips = (page) => page.evaluate(() => [...document.querySelectorAll('#expedition-entry .difficulty-chip')].map((c) => ({
  tier: Number(c.dataset.difficulty),
  checked: c.getAttribute('aria-checked') === 'true',
  locked: c.getAttribute('aria-disabled') === 'true',
  label: c.getAttribute('aria-label'),
})));
const note = (page) => page.evaluate(() => document.querySelector('#expedition-entry .difficulty-picker .kit-note')?.textContent ?? '');
const state = (page) => page.evaluate(() => {
  const c = window.__game.ctx;
  return { difficulty: c.state.difficulty, maxHp: c.player.maxHp, daily: c.run?.daily ?? null };
});

try {
  // ---- a fresh profile: Apprentice and Adept open, Adept chosen -----------------------------------
  let page = await openTitle();
  let row = await chips(page);
  check('the title offers four tiers', row.length === 4, JSON.stringify(row));
  check('a fresh profile has Adept chosen', row.find((c) => c.tier === 2)?.checked === true, JSON.stringify(row));
  check('Apprentice and Adept are open; Conjurer and Archmage are locked', row.filter((c) => !c.locked).map((c) => c.tier).join() === '1,2', JSON.stringify(row));
  check('a locked chip says how it opens', /locked.*Quiet the Kiln on Adept or harder/.test(row.find((c) => c.tier === 3).label ?? ''), row.find((c) => c.tier === 3).label);

  // A REAL click on a locked tier is refused, and its note explains.
  await page.locator('#expedition-entry .difficulty-chip[data-difficulty="4"]').click({ force: true }); // a real mouse click on a chip marked aria-disabled
  row = await chips(page);
  check('a click on Archmage changes nothing', row.find((c) => c.tier === 2).checked && !row.find((c) => c.tier === 4).checked, JSON.stringify(row));
  check('and the note says how to earn it', /Archmage.*locked.*Quiet the Kiln on Conjurer or harder/.test(await note(page)), await note(page));
  await page.screenshot({ path: `${outDir}/title-locked.png` });

  // ---- choose Apprentice for real, and begin -------------------------------------------------------------
  await page.locator('#expedition-entry .difficulty-chip[data-difficulty="1"]').click();
  check('Apprentice can be chosen', (await chips(page)).find((c) => c.tier === 1).checked, await note(page));
  check('its note is the house line', /Apprentice.*[Gg]entler/.test(await note(page)), await note(page));
  await page.locator('#expedition-entry [data-entry="begin"]').click();
  await waitForOpeningEnd(page);
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active, null, { timeout: 30000 });
  let s = await state(page);
  check('the run really runs on Apprentice', s.difficulty === 1, JSON.stringify(s));
  check('and the alchemist is sturdier for it (x1.25 of the Adept 1.1)', s.maxHp > 110, JSON.stringify(s));

  // ---- the ledger names the tier -------------------------------------------------------------------------
  await page.evaluate(() => { const c = window.__game.ctx; c.run.abandon(c); });
  await page.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(800);
  const ledger = await page.evaluate(() => ({
    kicker: document.querySelector('#run-summary .rs-kicker')?.textContent ?? '',
    share: document.querySelector('#run-summary .rs-share')?.textContent ?? '',
    pickerVisible: document.querySelector('#run-summary .difficulty-picker') !== null,
    chosen: [...document.querySelectorAll('#run-summary .difficulty-chip')].find((c) => c.getAttribute('aria-checked') === 'true')?.dataset.difficulty,
  }));
  check('the ledger header names a tier other than Adept', /Apprentice/.test(ledger.kicker), JSON.stringify(ledger));
  check('and so does the share line', /Breathing Works — Apprentice —/.test(ledger.share), JSON.stringify(ledger));
  check('the ledger offers the picker, on the tier just played', ledger.pickerVisible && ledger.chosen === '1', JSON.stringify(ledger));
  await page.screenshot({ path: `${outDir}/ledger-apprentice.png` });
  await page.close();

  // ---- a victory on Adept opens Conjurer, and the ledger announces it ------------------------------------
  page = await openTitle();
  await page.locator('#expedition-entry [data-entry="begin"]').click();
  await waitForOpeningEnd(page);
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active, null, { timeout: 30000 });
  s = await state(page);
  check('the default run is Adept', s.difficulty === 2, JSON.stringify(s));
  await page.evaluate(() => { const c = window.__game.ctx; c.events.emit('runComplete', { gold: 0 }); });
  await page.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);
  const won = await page.evaluate(() => ({
    unlock: [...document.querySelectorAll('#run-summary .rs-unlock')].map((n) => n.textContent),
    chips: [...document.querySelectorAll('#run-summary .difficulty-chip')].map((c) => ({ tier: Number(c.dataset.difficulty), locked: c.getAttribute('aria-disabled') === 'true', fresh: c.classList.contains('fresh') })),
    kicker: document.querySelector('#run-summary .rs-kicker')?.textContent ?? '',
  }));
  check('the victory ledger announces the harder Works', won.unlock.some((t) => /Conjurer \(III\) is open/.test(t)), JSON.stringify(won));
  check('Conjurer is now open in the ledger, and wears the new-unlock shine', won.chips.find((c) => c.tier === 3).locked === false && won.chips.find((c) => c.tier === 3).fresh === true, JSON.stringify(won));
  check('Archmage still is not', won.chips.find((c) => c.tier === 4).locked === true, JSON.stringify(won));
  check('an Adept win does not name Adept in the header', !/Adept/.test(won.kicker), won.kicker);
  await page.screenshot({ path: `${outDir}/ledger-victory-unlock.png` });

  // Choose Conjurer in the ledger with a REAL click and descend again.
  await page.locator('#run-summary .difficulty-chip[data-difficulty="3"]').click();
  await page.locator('#run-summary [data-rs="again"]').click();
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active && document.getElementById('run-summary')?.hidden, null, { timeout: 30000 });
  s = await state(page);
  check('"Descend again" carries the chosen tier: Conjurer', s.difficulty === 3, JSON.stringify(s));
  check('Conjurer is the shipped balance (alchemist at x1.0)', s.maxHp <= 110, JSON.stringify(s));
  await page.close();

  // ---- the profile remembers, and the daily is always Adept ----------------------------------------------
  // (Written the way the game writes it: a victory on Adept is on the books.)
  page = await openTitle();
  await page.evaluate(() => localStorage.setItem('alchemists-descent-meta', JSON.stringify({ version: 1, runsStarted: 2, runsEnded: 2, victories: 1, bestFloor: 4, bestVictoryDifficulty: 2, lastDifficulty: 3, unlockedKits: ['spark', 'frost', 'storm'], lastKit: 'spark' })));
  await page.reload({ waitUntil: 'load' });
  await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(600);
  row = await chips(page);
  check('a profile that has won on Adept opens Conjurer and remembers it was chosen', row.find((c) => c.tier === 3).locked === false && row.find((c) => c.tier === 3).checked === true, JSON.stringify(row));
  check('and Archmage waits', row.find((c) => c.tier === 4).locked === true, JSON.stringify(row));
  await page.locator('#expedition-entry [data-entry="daily"]').click();
  await waitForOpeningEnd(page);
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active, null, { timeout: 30000 });
  s = await state(page);
  check('today’s descent is Adept whatever was chosen', s.difficulty === 2 && s.daily !== null, JSON.stringify(s));
  await page.close();
} catch (error) {
  fail++;
  console.log('  FAIL  probe crashed: ' + (error && error.stack ? error.stack : error));
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
console.log(`\nverify-difficulty-ladder: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
