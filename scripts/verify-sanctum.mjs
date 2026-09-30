// The Sanctum between floors, PLAYED with real input (dev server running):
//  - keyboard play: 1-3 take a boon, left/right (or Q/E) choose a door, Enter descends; Enter with
//    nothing chosen does nothing; keys never leak into the game underneath (the wand stays put);
//  - a key completes Matron Ash's typewriter line;
//  - Descend paints first: the curtain is up within ~100 ms of the key, over the Sanctum, and the floor
//    is built only after it (the old freeze: a 4 s long task on an unchanged Sanctum);
//  - the Clerk of Works' notice is posted under the title, and Ash answers the boon struck.
//
// Usage: node scripts/verify-sanctum.mjs [url] [--size 1440x900]
import { launchBrowser } from './browser-launch.mjs';
import { startConsolePlayRun, waitForOpeningEnd } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const sizeArg = args.indexOf('--size') >= 0 ? args[args.indexOf('--size') + 1] : '1440x900';
const [W, H] = sizeArg.split('x').map(Number);

let failed = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
};

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await startConsolePlayRun(page, { seed: 7, settleMs: 500 });
  await waitForOpeningEnd(page);
  await page.evaluate(() => {
    const c = window.__game.ctx;
    c.enemies.length = 0; c.state.arrivalGraceUntil = 0;
    const L = c.levels.current; L.keyTaken = true; if (L.living?.tea) L.living.tea.completed = true;
    Object.assign(c.player, { x: 1330, y: 1009, vx: 0, vy: 0 }); c.camera.snapTo(1330, 1000);
    window.__ash = [];
    c.events.on('narration', (n) => { if (n.speaker === 'ash') window.__ash.push(n.text); });
  });
  await page.waitForTimeout(800);
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__game.ctx.levels.current.portal.open, null, { timeout: 8000 });
  await page.keyboard.up('KeyD'); await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__game.ctx.sanctum?.isOpen, null, { timeout: 12000 });
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(1500);

  const state = () => page.evaluate(() => {
    const ov = document.getElementById('sanctum-overlay'), btn = document.getElementById('descend-btn');
    return {
      open: window.__game.ctx.sanctum.isOpen, disabled: btn.disabled, label: btn.textContent,
      taken: [...ov.querySelectorAll('.perk-card')].map((c) => c.classList.contains('taken')),
      chosen: [...ov.querySelectorAll('.sanc-door')].map((d) => d.classList.contains('chosen')),
      ashRest: ov.querySelector('.sa-rest')?.textContent?.length ?? -1,
      wand: window.__game.ctx.wands.active, level: window.__game.ctx.levels.current?.def.id,
    };
  });

  const notice = await page.evaluate(() => document.querySelector('.sanc-notice')?.textContent ?? '');
  if (W >= 1103 && H >= 621) check(/^NOTICE/.test(notice) && notice.includes('The Clerk of Works'), 'the Clerk of Works posted a signed notice', notice.slice(0, 40));

  const before = await state();
  check(before.ashRest > 0, 'Ash is still typing her line', `${before.ashRest} chars to go`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  let s = await state();
  check(s.open && s.disabled, 'Enter with nothing chosen does not descend');
  check(s.ashRest === 0, 'a key completes her typewriter line');

  await page.keyboard.press('Digit2');
  await page.waitForTimeout(250);
  s = await state();
  check(s.taken[1] && !s.taken[0] && !s.taken[2], 'digit 2 takes the second boon');
  check(s.wand === before.wand, 'the digit did not reach the game underneath (wand slot unchanged)');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  s = await state();
  check(s.chosen[1] && !s.disabled && /^Descend to/.test(s.label), 'right arrow chooses the right-hand stair and arms Descend', s.label);
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(150);
  s = await state();
  check(s.chosen[0] && !s.chosen[1], 'Q chooses the left-hand stair');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(150);
  s = await state();
  check(s.chosen[1], 'E chooses the right-hand stair');
  const door = await page.evaluate(() => document.querySelector('#sanctum-overlay .sanc-door.chosen')?.dataset.level);

  // Matron Ash answers the boon (her greeting first; give the narrator its time).
  await page.waitForFunction(() => window.__ash.length >= 2, null, { timeout: 25000 }).then(
    () => check(true, 'Ash answered the boon struck'),
    () => check(false, 'Ash answered the boon struck', 'she said nothing after her greeting'),
  );

  // Descend: the curtain must be up within ~100 ms of the key, before any floor is built.
  await page.evaluate(() => {
    const cur = document.getElementById('level-curtain');
    window.__tm = { key: 0, up: 0, long: [], over: false };
    window.addEventListener('keydown', (e) => { if (e.code === 'Enter') window.__tm.key = performance.now(); }, true);
    new MutationObserver(() => { if (!window.__tm.up && cur.classList.contains('visible')) { window.__tm.up = performance.now(); window.__tm.over = cur.classList.contains('over-menus'); } }).observe(cur, { attributes: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__tm.long.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] });
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__game.ctx.sanctum.isOpen && !window.__game.ctx.levels.transitioning, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const tm = await page.evaluate(() => window.__tm);
  const gap = tm.up - tm.key;
  check(tm.up > 0 && gap < 100, 'the curtain is up within 100 ms of Enter', `${Math.round(gap)} ms`);
  check(tm.over, 'and it is raised over the Sanctum (not under it)');
  const firstLong = tm.long.find(([, d]) => d > 200);
  check(!firstLong || firstLong[0] >= tm.up, 'the floor is built only after the curtain is up');
  s = await state();
  check(s.level === door, 'Enter descended through the chosen door', `${s.level} / ${door}`);
  check(await page.evaluate(() => !document.getElementById('level-curtain').classList.contains('over-menus')), 'the curtain’s stacking is put back');
  check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall Sanctum checks passed');
process.exit(failed ? 1 : 0);
