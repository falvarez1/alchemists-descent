// The death card's way back (ui/deathCardGate): held shut until it has faded in, so a Space/Enter mashed through
// the fall cannot respawn past a card nobody has seen and spend a phial; and patience has a limit, so any key or
// click after 1.5 s plays the rest of the reveal quickly.
//
//   1. MASH: Space/Enter every 100 ms for the first 1.4 s of the card: still dead, button disabled and unfocused.
//   2. NATURAL: left alone, the button is enabled and focused only after it is fully visible (and then Enter works).
//   3. SKIP: a key at 1.5 s+ brings the button in well before the natural 3.9 s; a real click on it respawns.
//   4. LEDGER: the last phial's death guards "Read the ledger" the same way, and Enter then opens the ledger.
//
// Dev server running.   node scripts/verify-death-card-gate.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { startConsolePlayRun, waitForOpeningEnd } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await launchBrowser({ headless: true });
let failed = false;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  ' + detail : ''}`);
  if (!ok) failed = true;
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await startConsolePlayRun(page, { seed: 7, settleMs: 300 });
  await waitForOpeningEnd(page);
  await page.evaluate(() => {
    const c = window.__game.ctx;
    c.enemies.length = 0;
    c.state.arrivalGraceUntil = 0;
    const g = document.getElementById('gameover-overlay');
    window.__reveal = 0;
    new MutationObserver(() => {
      if (g.classList.contains('visible') && !window.__reveal) window.__reveal = performance.now();
      if (!g.classList.contains('visible')) window.__reveal = 0;
    }).observe(g, { attributes: true, attributeFilter: ['class'] });
  });

  const die = async () => {
    await page.evaluate(() => {
      const c = window.__game.ctx;
      c.player.invuln = 0;
      c.state.arrivalGraceUntil = 0;
      c.player.hp = 1;
      c.playerCtl.damage(99, 1, -1, 'weaver-bite');
    });
    await page.waitForFunction(() => window.__reveal > 0, null, { timeout: 15000 });
  };
  const age = () => page.evaluate(() => Math.round(performance.now() - window.__reveal));
  const state = () => page.evaluate(() => {
    const b = document.getElementById('respawn-btn');
    const l = document.getElementById('ledger-btn');
    const visibleButton = b.hidden ? l : b;
    return {
      dead: window.__game.ctx.player.dead,
      phials: window.__game.ctx.run?.phials,
      disabled: visibleButton.disabled,
      opacity: Number(getComputedStyle(visibleButton).opacity),
      focus: document.activeElement?.id || document.activeElement?.tagName,
      which: b.hidden ? 'ledger-btn' : 'respawn-btn',
    };
  });
  const waitUsable = async (timeout = 9000) => {
    await page.waitForFunction(() => {
      const b = document.getElementById('respawn-btn');
      const l = document.getElementById('ledger-btn');
      return (!b.hidden && !b.disabled) || (!l.hidden && !l.disabled);
    }, null, { timeout });
    return { at: await age(), ...(await state()) };
  };

  // 1 + 2. Mash through the first second and a half; never respawns; then wait it out.
  await die();
  const phialsAtDeath = (await state()).phials;
  let mashedDead = true, mashedDisabled = true, presses = 0;
  while ((await age()) < 1400) {
    await page.keyboard.press(presses % 2 ? 'Space' : 'Enter');
    presses++;
    const s = await state();
    if (!s.dead) mashedDead = false;
    if (!s.disabled) mashedDisabled = false;
    await page.waitForTimeout(100);
  }
  check(presses >= 8 && mashedDead, `${presses} mashed Space/Enter presses in the first 1.4 s do not respawn`);
  check(mashedDisabled, 'the way back stays disabled while it fades in');
  const natural = await waitUsable();
  check(natural.at >= 3200, 'left alone, the button is live only once fully visible', `(at ${natural.at} ms, opacity ${natural.opacity})`);
  check(natural.opacity >= 0.99 && natural.focus === 'respawn-btn', 'and it takes focus then', `(focus ${natural.focus})`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const afterEnter = await state();
  check(!afterEnter.dead && afterEnter.phials === phialsAtDeath, 'Enter on the live button respawns, spending the one phial the death already spent');

  // 3. Skip: a key after 1.5 s brings the button in early; a real click on it respawns.
  await page.waitForTimeout(500);
  await die();
  while ((await age()) < 1600) await page.waitForTimeout(50);
  const beforeSkip = await state();
  check(beforeSkip.disabled && beforeSkip.opacity < 0.5, 'at 1.6 s the button is still out of reach', `(opacity ${beforeSkip.opacity})`);
  await page.keyboard.press('KeyX');
  const skipped = await waitUsable(4000);
  check(skipped.at < 3200, 'a key after 1.5 s makes the button live well before the natural 3.9 s', `(at ${skipped.at} ms)`);
  const box = await page.locator('#respawn-btn').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  check(!(await state()).dead, 'a real click on the live button respawns');

  // 4. The last phial: the ledger button is guarded the same way.
  await page.waitForTimeout(400);
  for (let phials = (await state()).phials; phials > 0; phials--) {
    await die();
    await waitUsable();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
  }
  await die();
  let ledgerMashed = false;
  while ((await age()) < 1400) {
    await page.keyboard.press('Space');
    if (await page.evaluate(() => document.getElementById('run-summary')?.classList.contains('visible'))) ledgerMashed = true;
    await page.waitForTimeout(100);
  }
  check(!ledgerMashed, 'mashing through the final death does not open the ledger unseen');
  const ledger = await waitUsable();
  check(ledger.which === 'ledger-btn' && ledger.focus === 'ledger-btn' && ledger.at >= 3200, '"Read the ledger" is live and focused only once visible', `(at ${ledger.at} ms)`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#run-summary.visible', { timeout: 5000 }).then(() => check(true, 'Enter then opens the ledger'), () => check(false, 'Enter then opens the ledger'));
  check(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
