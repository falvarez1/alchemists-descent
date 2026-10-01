// The run ledger and the fighters (docs/TITLE-MENU.md): the fighters belong to the arena, so the ledger offers no fighter.
// A campaign run, ended, shows the kit and difficulty pickers and NO fighter chip, and "Descend again" starts the classic
// Alchemist. (The old ledger chip was removed when fighters moved out of the campaign.)
// Usage: node scripts/verify-fighter-ledger.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5173/';
const t = makeChecker();
const check = t.check;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.addInitScript(() => { try { localStorage.removeItem('alchemists-descent-meta'); localStorage.removeItem('noita-expedition'); sessionStorage.clear(); } catch { /* blocked */ } });
await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
await waitForConsoleApi(page);
await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 20000 });
await page.waitForTimeout(700);
const click = async (selector) => {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  const b = await loc.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(480);
};

// a profile that remembers an arena fighter still descends as the classic Alchemist
await page.evaluate(() => window.__game.ctx.run.chooseFighter('ilyra-voss'));
await click('#expedition-entry [data-entry="begin"]');
await click('#expedition-entry [data-entry="descend"]');
await page.waitForFunction(() => window.__game?.ctx?.run?.active === true && window.__game.ctx.state.mode === 'play', { timeout: 30000 });
check('the first run is the classic Alchemist, whatever the profile remembers', (await page.evaluate(() => window.__game.ctx.fighters.id)) === null);
await page.evaluate(() => { window.__game.ctx.state.arrivalGraceUntil = 0; window.__game.ctx.run.abandon(window.__game.ctx); });
await page.waitForSelector('#run-summary.visible', { timeout: 15000 });
await page.waitForTimeout(1800);
const ledger = await page.evaluate(() => ({
  chip: !!document.querySelector('#run-summary .fighter-pick-chip, #run-summary .rs-fighter'),
  kits: !!document.querySelector('#run-summary .rs-kits'),
  grades: !!document.querySelector('#run-summary .difficulty-picker'),
  side: !!document.querySelector('#run-summary .rs-side'),
}));
check('the ledger offers the case and the difficulty, and no fighter', ledger.kits && ledger.grades && !ledger.chip && !ledger.side, JSON.stringify(ledger));
await page.screenshot({ path: 'verify-out/fighters/ledger-no-fighter.png' });
await click('#run-summary [data-rs="again"]');
await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active && !document.getElementById('run-summary').classList.contains('visible'), null, { timeout: 40000 });
check('Descend again starts the classic Alchemist', (await page.evaluate(() => window.__game.ctx.fighters.id)) === null);
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\nfighter ledger probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
