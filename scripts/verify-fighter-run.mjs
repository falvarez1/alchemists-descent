// A fighter through the REAL run lifecycle: chosen at the start (equipped, Z/T live), kept across a save and
// a continue (id, charge, cooldown), dropped on the daily, cleared by a fresh classic run, and the classic
// Alchemist untouched throughout.
// Usage: node scripts/verify-fighter-run.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const t = makeChecker();
const check = t.check;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
await leaveTitleIfShown(page);
await waitForConsoleApi(page);
await page.waitForFunction(() => window.__game?.ctx?.run, { timeout: 20000 });
await page.evaluate(() => localStorage.removeItem('noita-expedition'));

const start = (opts) => page.evaluate(async (opts) => {
  const ctx = window.__game.ctx;
  const r = ctx.run.startNewRun(ctx, opts);
  await ctx.fighters.whenReady();
  for (let i = 0; i < 5; i++) window.__game.tick(false, { forcePaused: true });
  return { ok: r.ok, fighter: ctx.fighters.id, runFighter: ctx.run.fighter, kit: ctx.run.kit, view: JSON.parse(JSON.stringify(ctx.fighters.view)), mode: ctx.state.mode, meta: ctx.run.metaView().lastFighter };
}, opts);

// --- a normal descent as Brann
let s = await start({ kit: 'spark', daily: false, fighter: 'brann-rook' });
check('a normal run starts as the chosen fighter', s.ok && s.fighter === 'brann-rook' && s.runFighter === 'brann-rook', JSON.stringify({ f: s.fighter, r: s.runFighter }));
check('the fighter\'s abilities are named on the view', s.view.tactical.name === 'Boiler Guard' && s.view.ultimate.name === 'Redline');
check('the choice is remembered by the meta profile', s.meta === 'brann-rook');
check('the kit is independent of the fighter (the spark case)', s.kit === 'spark');

// --- the fighter's own numbers survive a save and a continue
await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.fighters.addCharge(0.5);
  window.__game.tick(false, { forcePaused: true });
  ctx.state.paused = false;
  await ctx.levels.saveExpedition?.(ctx);
});
await page.waitForTimeout(600);
const saved = await page.evaluate(() => window.__game.ctx.fighters.snapshot());
check('the snapshot carries the id and the charge', saved && saved.id === 'brann-rook' && saved.charge > 0.45, JSON.stringify(saved));
// A fresh page, as a returning player has: the save is read back from storage at boot.
await page.reload({ waitUntil: 'networkidle' });
await leaveTitleIfShown(page);
await page.waitForFunction(() => window.__game?.ctx?.run, { timeout: 20000 });
// (the dev build may already have resumed play by itself after the reload: either way the continue below must land on the same fighter)
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__resume = ctx.levels.startRun(ctx, { mode: 'normal', worldSource: 'campaign', continueSave: true, loadout: 'fresh' });
});
// The resume reads the save from IndexedDB, so it lands a moment later.
await page.waitForFunction(() => window.__game.ctx.fighters.id !== null, { timeout: 8000 }).catch(() => undefined);
const cont = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.fighters.whenReady();
  for (let i = 0; i < 3; i++) window.__game.tick(false, { forcePaused: true });
  return { ok: window.__resume?.ok, id: ctx.fighters.id, charge: ctx.fighters.view.ultimate.charge, runFighter: ctx.run.fighter };
});
check('a continue brings the same fighter back', cont.id === 'brann-rook' && cont.runFighter === 'brann-rook', JSON.stringify(cont));
check('...and its charge', cont.charge > 0.4, String(cont.charge));

// --- the daily is the classic Alchemist, and a new classic run clears the fighter
s = await start({ kit: 'spark', daily: true, fighter: 'brann-rook' });
check('today\'s descent is the classic Alchemist whatever was chosen', s.fighter === null && s.runFighter === null, JSON.stringify(s.fighter));
s = await start({ kit: 'spark', daily: false });
check('a new run with no fighter is the classic Alchemist', s.fighter === null && s.view.id === null);
await page.evaluate(() => { window.__game.ctx.state.paused = false; });

// --- Z and T do nothing for the classic Alchemist; the player is unchanged
const before = await page.evaluate(() => ({ x: window.__game.ctx.player.x, hp: window.__game.ctx.player.hp }));
await page.keyboard.press('KeyZ');
await page.keyboard.press('KeyT');
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({ x: window.__game.ctx.player.x, hp: window.__game.ctx.player.hp, own: window.__game.ctx.fighters.ownsMovement }));
check('Z and T are inert for the classic Alchemist', after.own === false && Math.abs(after.hp - before.hp) < 0.5);

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\nfighter run probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
