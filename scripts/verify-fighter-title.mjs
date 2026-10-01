// The Fighter Roster and the title (docs/TITLE-MENU.md, docs/FIGHTERS.md): the fighters belong to the ARENA, not the campaign.
//   the main page has an Arena door, inside the fold at the usual window sizes
//   a real click opens the Fighter Roster over the title; Escape leaves it with nothing started and the door keeps the focus
//   choosing a fighter starts the Proving Yard as them (a disposable test run, never a saved descent)
//   the campaign has no fighter anywhere: New descent has no Fighter row, and Descend starts the classic Alchemist even when
//   the profile remembers a fighter from the arena
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

  // --- the Arena door is on the main page, inside the fold
  const door = await page.evaluate(() => {
    const a = document.querySelector('#expedition-entry [data-entry="arena"]');
    const r = a?.getBoundingClientRect();
    return { box: r ? { y: r.y, h: r.height } : null, text: a?.textContent ?? '', vh: window.innerHeight };
  });
  check(`${tag}: the main page has an Arena door (the Proving Yard)`, door.box !== null && /Arena/.test(door.text) && /Proving Yard/.test(door.text), JSON.stringify(door.text));
  check(`${tag}: it is on screen`, door.box && door.box.y >= 0 && door.box.y + door.box.h <= door.vh, JSON.stringify(door.box));
  await page.screenshot({ path: `verify-out/fighters/title-${tag}.png` });

  // --- a real click opens the roster over the title
  await click(page, '#expedition-entry [data-entry="arena"]');
  await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
  await page.waitForTimeout(700);
  check(`${tag}: a click on the Arena door opens the Fighter Roster`, await page.evaluate(() => !!document.querySelector('#fighter-roster.visible')));
  await page.screenshot({ path: `verify-out/fighters/title-roster-${tag}.png` });

  // --- Back leaves it with nothing started, and the door keeps the focus
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const backed = await page.evaluate(() => ({ open: !!document.querySelector('#fighter-roster.visible'), active: document.activeElement?.dataset?.entry, level: window.__game.ctx.levels.current?.def.id, entry: !document.getElementById('expedition-entry').hidden }));
  check(`${tag}: Escape closes the roster, starts nothing and returns to the Arena door`, !backed.open && backed.active === 'arena' && backed.entry && backed.level !== 'fighter-test', JSON.stringify(backed));

  // --- choosing a fighter starts the Proving Yard as them
  await click(page, '#expedition-entry [data-entry="arena"]');
  await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
  await page.waitForTimeout(500);
  await click(page, '#fighter-roster .fr-card[data-entry="mara-quell"]');
  check(`${tag}: her dossier shows`, /Mara Quell/.test(await page.locator('#fighter-roster .fr-name').textContent()));
  await page.screenshot({ path: `verify-out/fighters/title-roster-mara-${tag}.png` });
  await click(page, '#fighter-roster .fr-choose');
  await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-test' && window.__game.ctx.state.mode === 'play', null, { timeout: 40000 });
  await page.evaluate(() => window.__game.ctx.fighters.whenReady());
  const yard = await page.evaluate(() => { const c = window.__game.ctx; return { id: c.fighters.id, t: c.fighters.view.tactical.name, remembered: c.run.metaView().lastFighter, test: c.state.playtestSource, entry: document.getElementById('expedition-entry').hidden, panel: !document.getElementById('fighter-arena').hidden }; });
  check(`${tag}: choosing Mara Quell starts the Proving Yard as her (a test run), with the panel up`, yard.id === 'mara-quell' && yard.t === 'Resonance Bell' && yard.test === 'test' && yard.entry && yard.panel, JSON.stringify(yard));
  check(`${tag}: the profile remembers the arena fighter`, yard.remembered === 'mara-quell', String(yard.remembered));
  const chipsOn = await page.evaluate(() => { const c = document.getElementById('fighter-chips'); return !!c && !c.hidden; });
  check(`${tag}: her ability chips are on the HUD`, chipsOn);

  // --- back at the title, the campaign knows no fighter: no row, and Descend starts the classic Alchemist
  await page.evaluate(() => window.dispatchEvent(new Event('expedition-title-request')));
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(600);
  await click(page, '#expedition-entry [data-entry="begin"]');
  check(`${tag}: New descent has no Fighter row`, !(await page.locator('#expedition-entry [data-entry="fighter"]').count()));
  await click(page, '#expedition-entry [data-entry="descend"]');
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active === true && window.__game.ctx.levels.current?.def.id !== 'fighter-test', { timeout: 40000 });
  const camp = await page.evaluate(() => ({ id: window.__game.ctx.fighters.id, runFighter: window.__game.ctx.run.fighter ?? null, chips: !document.getElementById('fighter-chips') || document.getElementById('fighter-chips').hidden, panel: !document.getElementById('fighter-arena').hidden }));
  check(`${tag}: Descend starts the campaign as the classic Alchemist (the remembered arena fighter is not used)`, camp.id === null && camp.runFighter === null && camp.chips && !camp.panel, JSON.stringify(camp));
  await browser.close();
  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
}

console.log(`\nfighter title probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
