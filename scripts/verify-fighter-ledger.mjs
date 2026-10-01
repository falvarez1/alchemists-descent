// The ledger's "Fighter" chip: after a run ends the Next-descent choices carry the fighter, a real click opens
// the Fighter Roster over the ledger, choosing updates the chip, "Descend again" starts the next run as that
// fighter, and the finished run's ledger names who it was. Real clicks only.
// Usage: node scripts/verify-fighter-ledger.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const t = makeChecker();
const check = t.check;
const click = async (page, selector) => {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 10000 });
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box for ' + selector);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

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

// A run as Ilyra, then end it.
await click(page, '#expedition-entry .fighter-pick-chip');
await page.waitForSelector('#fighter-roster.visible');
await click(page, '#fighter-roster .fr-card[data-entry="ilyra-voss"]');
await click(page, '#fighter-roster .fr-choose');
await page.waitForTimeout(400);
await click(page, '#expedition-entry [data-entry="begin"]');
await page.waitForFunction(() => window.__game?.ctx?.run?.active === true && window.__game.ctx.state.mode === 'play', { timeout: 30000 });
check('the first run is Ilyra\'s', (await page.evaluate(() => window.__game.ctx.fighters.id)) === 'ilyra-voss');
await page.evaluate(() => { window.__game.ctx.state.arrivalGraceUntil = 0; window.__game.ctx.run.abandon(window.__game.ctx); });
await page.waitForSelector('#run-summary.visible', { timeout: 15000 });
await page.waitForTimeout(1800);

const ledger = await page.evaluate(() => ({
  chip: document.querySelector('#run-summary .fighter-pick-chip')?.textContent ?? '',
  hasChoices: !!document.querySelector('#run-summary .rs-choices .rs-fighter'),
}));
check('the ledger carries the Fighter chip, showing the last choice', ledger.hasChoices && /Ilyra Voss/.test(ledger.chip), JSON.stringify(ledger));
await page.screenshot({ path: 'verify-out/fighters/ledger.png' });

await click(page, '#run-summary .fighter-pick-chip');
await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
await page.waitForTimeout(600);
const over = await page.evaluate(() => {
  const r = document.getElementById('fighter-roster'), s = document.getElementById('run-summary');
  const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  return { visible: r.classList.contains('visible'), roosterOnTop: !!top?.closest('#fighter-roster'), summaryStill: s.classList.contains('visible') };
});
check('the roster opens over the ledger and takes the clicks', over.visible && over.roosterOnTop, JSON.stringify(over));
await click(page, '#fighter-roster .fr-card[data-entry="brann-rook"]');
await click(page, '#fighter-roster .fr-choose');
await page.waitForTimeout(500);
const chosen = await page.evaluate(() => ({ open: !!document.querySelector('#fighter-roster.visible'), chip: document.querySelector('#run-summary .fighter-pick-chip')?.textContent ?? '', ledgerOpen: document.getElementById('run-summary').classList.contains('visible') }));
check('choosing Brann closes the roster, keeps the ledger and updates the chip', !chosen.open && chosen.ledgerOpen && /Brann Rook/.test(chosen.chip), JSON.stringify(chosen));

await click(page, '#run-summary [data-rs="again"]');
await page.waitForFunction(() => window.__game.ctx.run.active === true && window.__game.ctx.state.mode === 'play' && !document.getElementById('run-summary').classList.contains('visible'), { timeout: 40000 });
await page.evaluate(() => window.__game.ctx.fighters.whenReady());
const next = await page.evaluate(() => ({ id: window.__game.ctx.fighters.id, run: window.__game.ctx.run.fighter, last: window.__game.ctx.run.metaView().lastFighter }));
check('Descend again starts the next run as Brann Rook', next.id === 'brann-rook' && next.run === 'brann-rook' && next.last === 'brann-rook', JSON.stringify(next));

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\nfighter ledger probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
