// Pell, played with real input: the refused tea, hints on the buttons, a choice that only
// talks, the echo's answer, the compass mark's payoff, a regular's visit, the second talk,
// the last page's P.S., the two-shot camera, and his barks (a slime, a wound, lingering, fire).
// Usage (dev server running): node scripts/verify-pell.mjs [url]
import { chromium } from 'playwright-core';
import { startConsolePlayRun, waitForOpeningEnd } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok    ' + name); } else { fail++; console.log('  FAIL  ' + name + ' ' + detail); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

const FIRSTS = ['pell.bellows.first', 'pell.rot.first', 'pell.cold.first', 'pell.cisterns.first', 'pell.glass.first'];
const box = () => page.evaluate(() => ({
  open: document.getElementById('story-dialogue')?.classList.contains('open') === true,
  text: document.querySelector('#story-dialogue .sd-text')?.textContent ?? '',
  choices: [...document.querySelectorAll('#story-dialogue .sd-choice')].map(b => b.childNodes[1]?.textContent ?? ''),
  hints: [...document.querySelectorAll('#story-dialogue .sd-hint')].map(h => h.textContent),
}));
const snapshot = () => page.evaluate(() => window.__game.ctx.story.debugSnapshot());
/** A run on a floor, the opening out of the way, the apprentice healthy at Pell's side. */
async function arrive(level, { hp = 1, meta } = {}) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await startConsolePlayRun(page, { level, seed: 7 });
  await waitForOpeningEnd(page).catch(() => undefined);
  const camp = await page.evaluate(({ hp, meta }) => {
    const c = window.__game.ctx;
    if (meta) c.story.debugSetMeta(meta);
    c.player.hp = Math.max(1, Math.round(c.player.maxHp * hp));
    c.state.arrivalGraceUntil = 0;
    return c.levels.current.story.camp;
  }, { hp, meta });
  return camp;
}
const stand = (camp, dx = 14) => page.evaluate(({ x, y }) => {
  const c = window.__game.ctx; c.player.x = x; c.player.y = y; c.player.vx = 0; c.player.vy = 0; c.state.arrivalGraceUntil = 0;
}, { x: camp.x - dx, y: camp.floorY - 2 });
/** Number keys hurry his lines along until the menu shows. */
async function toMenu() {
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(350);
    const b = await box();
    if (b.choices.length) return b;
    await page.keyboard.press('Digit1');
  }
  return box();
}
const click = async (i) => {
  const r = await page.locator('#story-dialogue .sd-choice').nth(i).boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
};
async function closeTalk() {
  for (let i = 0; i < 60; i++) {
    if (!(await box()).open) return true;
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(250);
  }
  return false;
}

try {
  // ---- floor 3, in rude health: the tea is refused and the menu stays
  let camp = await arrive('d3', { hp: 1 });
  await stand(camp);
  await page.waitForTimeout(700);
  await page.keyboard.press('KeyE');
  let b = await toMenu();
  check('the menu has three buttons with a word on what each gives', b.choices.length === 3 && b.hints.join('|') === 'Compass mark|A spell page|You’re unhurt', JSON.stringify(b));
  const focus = await page.evaluate(() => window.__game.ctx.camera.actionFocus);
  check('the camera eases to a two-shot for the talk', focus !== null && focus.zoom > 1.05, JSON.stringify(focus));
  const hp0 = await page.evaluate(() => window.__game.ctx.player.hp);
  await click(2);
  await page.waitForTimeout(900);
  b = await box();
  check('the tea is refused, in his voice', /picture of health/.test(b.text), b.text);
  check('nothing was given, nothing spent', (await snapshot()).run.pell.d3?.gift === null && (await page.evaluate(() => window.__game.ctx.player.hp)) === hp0);
  for (let i = 0; i < 30 && !b.choices.length; i++) { await page.waitForTimeout(500); b = await box(); }
  check('the menu comes back without the tea', b.choices.length === 2, JSON.stringify(b.choices));
  await click(1);
  await page.waitForTimeout(700);
  check('the page is given (gifts are exclusive)', (await snapshot()).run.pell.d3?.gift === 'page');
  await closeTalk();
  check('the camera is handed back', (await page.evaluate(() => window.__game.ctx.camera.actionFocus)) === null);
  // second talk: a fresh turn of phrase each time, never the last
  const said = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(500);
    said.push((await box()).text);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  check('second talks never repeat the last line', said.every((s, i) => s && (i === 0 || s !== said[i - 1])), JSON.stringify(said));

  // ---- floor 3, hurt: the tea is poured, and the cup stays on the crate
  camp = await arrive('d3', { hp: 0.4 });
  await stand(camp);
  await page.waitForTimeout(700);
  await page.keyboard.press('KeyE');
  b = await toMenu();
  check('the tea button says it restores health', b.hints[2] === 'Restores health', JSON.stringify(b.hints));
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => { const p = window.__game.ctx.player; return { hp: p.hp, max: p.maxHp }; });
  check('the tea restores health in full', after.hp === after.max, JSON.stringify(after));
  check('the tin cup is left on the crate', (await page.evaluate(() => window.__game.ctx.story.view.camp?.dress?.cup)) === true);
  await closeTalk();

  // ---- floor 2: the echo's answer, then the compass mark and its payoff
  camp = await arrive('d2', { hp: 1 });
  await stand(camp);
  await page.waitForTimeout(700);
  await page.keyboard.press('KeyE');
  b = await toMenu();
  check('no "I saw you come down." before the echo', b.choices.length === 2, JSON.stringify(b.choices));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.ctx.story.state.echoes.push('echo.rot'));
  await page.keyboard.press('KeyE');
  b = await toMenu();
  check('"I saw you come down." after it', b.choices.length === 3 && /come down/.test(b.choices[2]), JSON.stringify(b.choices));
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(900);
  check('his reply is the rope', /very good rope/.test((await box()).text));
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(500); b = await box(); if (b.choices.length) break; await page.keyboard.press('Digit2'); }
  check('the menu comes back (the gift is not lost to curiosity)', b.choices.length === 2, JSON.stringify(b.choices));
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(800);
  const pin = (await snapshot()).run.pin;
  check('the mark is remembered', !!pin && pin.level === 'd2', JSON.stringify(pin));
  await closeTalk();
  if (pin) {
    // go to the marked pickup and take it (a tome asks which page)
    await page.evaluate(({ x, y }) => {
      const c = window.__game.ctx, w = c.world;
      for (let yy = y - 26; yy <= y + 2; yy++) for (let xx = x - 8; xx <= x + 8; xx++) if (w.inBounds(xx, yy)) w.clearCellAt(w.idx(xx, yy));
      c.player.x = x; c.player.y = y + 1; c.player.vx = 0; c.player.vy = 0;
    }, pin);
    await page.waitForTimeout(1500);
    const card = page.locator('#card-offer-overlay .card-offer-card').first();
    if (await card.count()) { const r = await card.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
    await page.waitForTimeout(1500);
    const s = await snapshot();
    check('taking what the mark led to pays it', s.run.pinsPaid.includes('d2') && s.run.pin === null, JSON.stringify(s.run));
  }

  // ---- a regular: one line of greeting and a notice, then the menu
  camp = await arrive('d3', { hp: 1, meta: { pellRuns: 4, heard: FIRSTS, openingSeen: true } });
  await page.evaluate(() => window.__game.ctx.story.state.pinsPaid.push('d2'));
  await stand(camp);
  await page.waitForTimeout(700);
  await page.keyboard.press('KeyE');
  const lines = [];
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(350);
    b = await box();
    if (b.text && lines.at(-1) !== b.text) lines.push(b.text);
    if (b.choices.length) break;
    await page.keyboard.press('Digit1');
  }
  check('a regular gets the veteran greeting', /You know the drill/.test(lines[0] ?? ''), JSON.stringify(lines));
  check('and a notice on the mark that paid', lines.some(l => /opened it, didn’t you/.test(l)), JSON.stringify(lines));
  await page.keyboard.press('Escape');

  // ---- the Kiln: his last page, with the P.S.
  camp = await arrive('d4', { hp: 1 });
  await page.evaluate(() => window.__game.ctx.story.state.pinsPaid.push('d3'));
  await stand(camp, 10);
  await page.waitForTimeout(1000);
  await page.keyboard.press('KeyE');
  const pageLines = [];
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(500);
    b = await box();
    if (b.text && pageLines.at(-1) !== b.text) pageLines.push(b.text);
    if (!b.open) break;
    await page.keyboard.press('KeyE'); await page.waitForTimeout(150); await page.keyboard.press('KeyE');
  }
  check('his last page carries the P.S. about the marked room', pageLines.some(l => /^P\.S\. If you opened the marked room/.test(l)), JSON.stringify(pageLines));

  // ---- barks: a slime in sight, a wound, lingering — each once, in a caption
  camp = await arrive('d2', { hp: 1, meta: { pellRuns: 1 } });
  await page.evaluate(({ x, y }) => { window.__game.ctx.player.x = x - 80; window.__game.ctx.player.y = y - 2; }, { x: camp.x, y: camp.floorY });
  await page.waitForTimeout(7500);
  const told = async () => (await snapshot()).run.told;
  const caption = () => page.evaluate(() => document.getElementById('narration-caption')?.textContent ?? '');
  await page.evaluate(({ x, y }) => { const c = window.__game.ctx; c.enemies.length = 0; c.enemyCtl.spawn('slime', x + 36, y - 2); }, { x: camp.x, y: camp.floorY });
  await page.waitForTimeout(1500);
  check('a slime in sight: his slime line, once', /just a slime/.test(await caption()) && (await told()).includes('bark.hostile.slime'), await caption());
  check('...and he points at it', (await snapshot()).pell.react === 'point');
  await page.evaluate(() => { window.__game.ctx.enemies.length = 0; });
  await page.waitForTimeout(14500); // a rest between barks
  await page.evaluate(() => { const c = window.__game.ctx; c.player.hp = c.player.maxHp * 0.2; });
  await page.waitForTimeout(2000);
  check('a wound: bleeding on the map', /bleeding on the map/.test(await caption()) && (await told()).includes('bark.hurt'), await caption());
  await page.evaluate(({ x, y }) => { const c = window.__game.ctx; c.player.hp = c.player.maxHp; c.player.x = x - 20; c.player.y = y - 2; }, { x: camp.x, y: camp.floorY });
  await page.waitForTimeout(24000);
  check('lingering without a word: he speaks up', (await told()).includes('bark.linger'));
  // A second slime has only his general line left; after that, nothing is said twice.
  const provoke = async () => {
    await page.evaluate(() => { const c = window.__game.ctx; c.enemies.length = 0; c.enemyCtl.spawn('slime', c.levels.current.story.camp.x + 36, c.levels.current.story.camp.floorY - 2); c.player.hp = c.player.maxHp * 0.1; });
    await page.waitForTimeout(16000);
  };
  await provoke();
  await provoke();
  const n = (await told()).length;
  await provoke();
  await provoke();
  check('no bark is repeated in a run', (await told()).length === n && new Set(await told()).size === n, JSON.stringify(await told()));
} catch (e) {
  fail++;
  console.log('  FAIL  probe threw: ' + e.message);
}

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
