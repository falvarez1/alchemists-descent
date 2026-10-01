// The Fighter Roster INTEGRATED into the title menu: the Fighter row is on the New descent page (one door in), inside the
// fold at the usual window sizes, a real click opens the roster over the title, choosing a fighter updates the row and
// its card and is remembered, Descend starts the run as that fighter, and the roster's classic choice goes back to the
// classic Alchemist. Real clicks only. (The menu itself is verify-title-menu.mjs.)
// Usage: node scripts/verify-fighter-title.mjs [url] [--sizes 1400x860,960x600,800x600]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const optIdx = args.indexOf('--sizes');
const sizes = (optIdx >= 0 ? args[optIdx + 1] : '1400x860,960x600,800x600').split(',').map((s) => s.split('x').map(Number));
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/fighters', { recursive: true });

const click = async (page, selector) => {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box for ' + selector);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(480); // a menu page animates in
};

for (const [w, h] of sizes) {
  const tag = `${w}x${h}`;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => { try { localStorage.removeItem('alchemists-descent-meta'); localStorage.removeItem('noita-expedition'); sessionStorage.clear(); } catch { /* storage may be blocked */ } });
  await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
  await waitForConsoleApi(page);
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(900);

  // --- one door in, the Fighter row is on screen, with Descend still reachable
  await click(page, '#expedition-entry [data-entry="begin"]');
  const row = await page.evaluate(() => {
    const f = document.querySelector('#expedition-entry [data-entry="fighter"]');
    const d = document.querySelector('#expedition-entry [data-entry="descend"]');
    const box = (el) => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
    return { row: box(f), descend: box(d), text: f?.textContent ?? '', vh: window.innerHeight };
  });
  check(`${tag}: the loadout page has a Fighter row (the classic Alchemist by default)`, row.row !== null && /The Alchemist/.test(row.text), JSON.stringify(row.text));
  check(`${tag}: the row is on screen`, row.row && row.row.y >= 0 && row.row.y + row.row.h <= row.vh, JSON.stringify(row.row));
  check(`${tag}: Descend is reachable`, row.descend && row.descend.y >= 0 && row.descend.y + row.descend.h <= row.vh, JSON.stringify(row.descend));
  await page.screenshot({ path: `verify-out/fighters/title-${tag}.png` });

  // --- a real click opens the roster over the title
  await click(page, '#expedition-entry [data-entry="fighter"]');
  await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
  await page.waitForTimeout(700);
  check(`${tag}: a click on the row opens the Fighter Roster`, await page.evaluate(() => !!document.querySelector('#fighter-roster.visible')));
  await page.screenshot({ path: `verify-out/fighters/title-roster-${tag}.png` });

  // --- Back leaves the roster with nothing changed, and the row keeps the focus
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const backed = await page.evaluate(() => ({ open: !!document.querySelector('#fighter-roster.visible'), row: document.querySelector('#expedition-entry [data-entry="fighter"]')?.textContent ?? '', active: document.activeElement?.dataset?.entry }));
  check(`${tag}: Escape closes the roster, changes nothing and returns to the row`, !backed.open && /The Alchemist/.test(backed.row) && backed.active === 'fighter', JSON.stringify(backed));
  await click(page, '#expedition-entry [data-entry="fighter"]');
  await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
  await page.waitForTimeout(500);

  // --- choose Mara Quell: click her card, then Choose
  await click(page, '#fighter-roster .fr-card[data-entry="mara-quell"]');
  check(`${tag}: her dossier shows`, /Mara Quell/.test(await page.locator('#fighter-roster .fr-name').textContent()));
  await page.screenshot({ path: `verify-out/fighters/title-roster-mara-${tag}.png` });
  await click(page, '#fighter-roster .fr-choose');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    open: !!document.querySelector('#fighter-roster.visible'),
    row: document.querySelector('#expedition-entry [data-entry="fighter"] .tm-value')?.textContent ?? '',
    card: document.querySelector('#expedition-entry .tm-detail')?.textContent ?? '',
    remembered: window.__game?.ctx?.run?.metaView?.().lastFighter ?? 'n/a',
    paused: window.__game?.ctx?.state?.paused,
    active: document.activeElement?.dataset?.entry,
  }));
  check(`${tag}: choosing closes the roster and the row names her`, !after.open && after.row === 'Mara Quell', JSON.stringify(after));
  check(`${tag}: the card names her kit and the keys`, /Resonance Bell/.test(after.card) && /Dead Chime/.test(after.card) && /Z/.test(after.card) && /T/.test(after.card), after.card.slice(0, 160));
  check(`${tag}: the choice is remembered`, after.remembered === 'mara-quell', String(after.remembered));
  check(`${tag}: the title is still paused behind it, the row has the focus`, after.paused === true && after.active === 'fighter', JSON.stringify({ paused: after.paused, active: after.active }));
  await page.screenshot({ path: `verify-out/fighters/title-mara-${tag}.png` });

  // --- Descend as her
  await click(page, '#expedition-entry [data-entry="descend"]');
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active === true, { timeout: 30000 });
  await page.evaluate(() => window.__game.ctx.fighters.whenReady());
  const run = await page.evaluate(() => ({ id: window.__game.ctx.fighters.id, run: window.__game.ctx.run.fighter, t: window.__game.ctx.fighters.view.tactical.name }));
  check(`${tag}: the run starts as Mara Quell`, run.id === 'mara-quell' && run.run === 'mara-quell' && run.t === 'Resonance Bell', JSON.stringify(run));
  await page.waitForTimeout(500);
  const chipsOn = await page.evaluate(() => { const c = document.getElementById('fighter-chips'); return !!c && !c.hidden; });
  check(`${tag}: her ability chips are on the HUD`, chipsOn);
  await browser.close();
  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
}

console.log(`\nfighter title probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
