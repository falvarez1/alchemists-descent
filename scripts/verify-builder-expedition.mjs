// Expedition-protection probe: opening the Builder mid-expedition must NOT
// edit the expedition level's live World (the save-family bleed blocker).
// The Builder detaches onto a scratch world; PLAY re-attaches the real one.
// Usage: node scripts/verify-builder-expedition.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsolePlayRun, waitForRunReady } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('dialog', (d) => d.accept());
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2000);

/* ---------- enter the descent (a REAL expedition level, d1) ---------- */
console.log('-- descend');
await startConsolePlayRun(page, { seed: 777 });
await page.waitForTimeout(800);
const d1 = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return { id: ctx.levels.current.def.id, attached: ctx.world === ctx.levels.current.world };
});
check('expedition running on its own live world', d1.id !== 'custom' && d1.attached, JSON.stringify(d1));

/* ---------- open the Builder: must detach, not adopt, the level ---------- */
console.log('-- open builder mid-expedition');
await page.click('#mode-builder-btn');
await page.waitForSelector('#builder-intent-modal', { timeout: 5000 });
const modalShown = await page.locator('#builder-intent-modal').isVisible();
check('builder asks for play-to-builder intent', modalShown);
await page.click('#builder-intent-modal [data-intent="continue-document"]');
await page.waitForTimeout(400);
const det = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return {
    mode: ctx.state.mode,
    detached: ctx.world !== ctx.levels.current.world,
    levelId: ctx.levels.current.def.id,
  };
});
check('builder detached onto a scratch world', det.detached, JSON.stringify(det));

/* paint into the scratch world; the expedition level must not change */
const before = await page.evaluate(() => {
  const w = window.__game.ctx.levels.current.world;
  let sum = 0;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) sum += w.types[w.idx(x, y)];
  return sum;
});
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world; // the SCRATCH world
  for (let y = 200; y < 240; y++)
    for (let x = 200; x < 240; x++) {
      const i = w.idx(x, y);
      w.types[i] = 13;
      w.colors[i] = 0x7a8a99;
    }
});
const after = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.levels.current.world;
  let sum = 0;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) sum += w.types[w.idx(x, y)];
  let scratch = 0;
  const sw = ctx.world;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) scratch += sw.types[sw.idx(x, y)];
  return { sum, scratch };
});
check('builder edits land in the scratch world', after.scratch === 13 * 40 * 40, `got ${after.scratch}`);
check('the expedition level is untouched', after.sum === before, `before ${before} after ${after.sum}`);

/* ---------- PLAY re-attaches the expedition's own world ---------- */
console.log('-- back to the descent');
await page.click('#b-exit');
await page.click('#mode-play-btn');
await page.waitForSelector('#run-launcher.visible', { timeout: 5000 });
await page.evaluate(() => document.querySelector('#run-launcher [data-action="continue"]')?.click());
await waitForRunReady(page);
await page.waitForTimeout(500);
const back = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  let sum = 0;
  const w = ctx.world;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) sum += w.types[w.idx(x, y)];
  return {
    attached: ctx.world === ctx.levels.current.world,
    levelId: ctx.levels.current.def.id,
    probeSum: sum,
  };
});
check('play re-attaches the expedition world', back.attached, JSON.stringify(back));
check('no scratch metal bled into the level', back.probeSum === before, `before ${before} after ${back.probeSum}`);

/* ---------- edit current scene: snapshot the live play map into Builder ---------- */
console.log('-- edit current scene');
const playSpot = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  let sum = 0;
  const w = ctx.world;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) sum += w.types[w.idx(x, y)];
  return { x: Math.round(ctx.player.x), y: Math.round(ctx.player.y), sum };
});
await page.click('#mode-builder-btn');
await page.waitForSelector('#builder-intent-modal', { timeout: 5000 });
await page.click('#builder-intent-modal [data-intent="current-scene"]');
await page.waitForTimeout(400);
const adopted = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  let sum = 0;
  const w = ctx.world;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) sum += w.types[w.idx(x, y)];
  return {
    mode: ctx.state.mode,
    detached: ctx.world !== ctx.levels.current.world,
    name: document.getElementById('b-doc-name')?.value,
    probeSum: sum,
  };
});
check('edit current scene opens Builder on a detached snapshot', adopted.mode === 'build' && adopted.detached, JSON.stringify(adopted));
check('current scene snapshot matches the visible play terrain', adopted.probeSum === playSpot.sum, `play ${playSpot.sum} builder ${adopted.probeSum}`);
check('scene snapshot gets a named Builder document', /scene edit/i.test(adopted.name ?? ''), String(adopted.name));

/* ---------- PLAY from inside Builder exits to the game, even with an invalid doc ---------- */
console.log('-- header play exits builder');
await page.click('#b-new'); // no terrain / no spawn: invalid for Builder playtest, still fine for game Play
const newDialog = page.locator('.app-dialog-root');
if (await newDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
  await newDialog.locator('.app-dialog-btn.primary').click();
}
await page.click('#mode-play-btn');
await page.waitForFunction(
  () => {
    const ctx = window.__game.ctx;
    return ctx.state.mode === 'play' && ctx.levels.current?.def?.id !== 'custom' && !ctx.levels.transitioning;
  },
  { timeout: 30000 },
);
await page.waitForTimeout(500);
const playAgain = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  return {
    id: rt?.def?.id,
    rootHidden: document.getElementById('builder-root')?.style.display === 'none',
    attached: rt ? ctx.world === rt.world : false,
  };
});
check('header Play exits Builder and resumes the game', playAgain.id !== 'custom' && playAgain.rootHidden && playAgain.attached, JSON.stringify(playAgain));

check('no page or console errors', pageErrors.length === 0 && consoleErrors.length === 0, [...pageErrors, ...consoleErrors].join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
