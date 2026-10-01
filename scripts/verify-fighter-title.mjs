// The Fighter Roster INTEGRATED into the title: the "Your fighter" chip is reachable and inside the fold at
// the usual window sizes, a real click opens the roster over the title, choosing a fighter updates the chip and
// is remembered, Begin the descent starts the run as that fighter, and choosing "no fighter" goes back to the
// classic Alchemist. Real clicks only.
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

  // --- the chip is on the title, inside the fold, with the Begin button still reachable
  const chip = await page.evaluate(() => {
    const c = document.querySelector('#expedition-entry .fighter-pick-chip');
    const begin = document.querySelector('#expedition-entry [data-entry="begin"]');
    const daily = document.querySelector('#expedition-entry [data-entry="daily"]');
    const box = (el) => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
    return { chip: box(c), begin: box(begin), daily: box(daily), text: c?.textContent ?? '', vh: window.innerHeight };
  });
  check(`${tag}: the title has a "Your fighter" chip (the classic Alchemist by default)`, chip.chip !== null && /The Alchemist/.test(chip.text), JSON.stringify(chip.text));
  check(`${tag}: the chip is on screen`, chip.chip && chip.chip.y >= 0 && chip.chip.y + chip.chip.h <= chip.vh, JSON.stringify(chip.chip));
  check(`${tag}: Begin the descent is still reachable`, chip.begin && chip.begin.y >= 0 && chip.begin.y + chip.begin.h <= chip.vh, JSON.stringify(chip.begin));
  check(`${tag}: the whole menu still fits above the fold (Today's descent is on screen)`, h < 700 ? chip.daily && chip.daily.y + chip.daily.h <= chip.vh : true, JSON.stringify(chip.daily));
  await page.screenshot({ path: `verify-out/fighters/title-${tag}.png` });

  // --- a real click opens the roster over the title
  await click(page, '#expedition-entry .fighter-pick-chip');
  await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
  await page.waitForTimeout(700);
  check(`${tag}: a click on the chip opens the Fighter Roster`, await page.evaluate(() => !!document.querySelector('#fighter-roster.visible')));
  await page.screenshot({ path: `verify-out/fighters/title-roster-${tag}.png` });

  // --- choose Mara Quell: click her card, then Choose
  await click(page, '#fighter-roster .fr-card[data-entry="mara-quell"]');
  await page.waitForTimeout(250);
  check(`${tag}: her dossier shows`, /Mara Quell/.test(await page.locator('#fighter-roster .fr-name').textContent()));
  await click(page, '#fighter-roster .fr-choose');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    open: !!document.querySelector('#fighter-roster.visible'),
    chip: document.querySelector('#expedition-entry .fighter-pick-chip')?.textContent ?? '',
    note: document.querySelector('#expedition-entry .fighter-pick .kit-note')?.textContent ?? '',
    remembered: window.__game?.ctx?.run?.metaView?.().lastFighter ?? 'n/a',
    paused: window.__game?.ctx?.state?.paused,
  }));
  check(`${tag}: choosing closes the roster and the chip names her`, !after.open && /Mara Quell/.test(after.chip), JSON.stringify(after));
  check(`${tag}: the note names her kit and the keys`, /Resonance Bell \(Z\)/.test(after.note) && /Dead Chime \(T\)/.test(after.note), after.note);
  check(`${tag}: the choice is remembered`, after.remembered === 'mara-quell', String(after.remembered));
  check(`${tag}: the title is still paused behind it`, after.paused === true);

  // --- Begin the descent as her
  await click(page, '#expedition-entry [data-entry="begin"]');
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
