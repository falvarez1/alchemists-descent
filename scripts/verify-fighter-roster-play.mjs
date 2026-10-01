// All ten fighters through a REAL run, one after another: the same start the title makes, then on the real first
// floor (not the carved arena): the kit loads, the HUD chips appear, Z and T go through the real key path and
// either fire or refuse for a reason (never crash), a floor change clears what the kit placed and keeps the
// fighter, a death and a respawn reset it cleanly, and nothing throws. A screenshot of each fighter standing on
// the real floor is saved for the eye (verify-out/fighters/play-<id>.png).
//
// This is the smoke test across the whole roster; each kit's own probe proves what its abilities DO.
// Usage: node scripts/verify-fighter-roster-play.mjs [url] [--only id,id]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, leaveTitleIfShown, waitForConsoleApi, waitForOpeningEnd } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/fighters', { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.addInitScript(() => { try { localStorage.removeItem('alchemists-descent-meta'); localStorage.removeItem('noita-expedition'); sessionStorage.clear(); } catch { /* blocked */ } });
await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
await leaveTitleIfShown(page);
await waitForConsoleApi(page);
await page.waitForFunction(() => window.__game?.ctx?.run, { timeout: 20000 });

const ids = await page.evaluate(async () => (await import('/src/content/fighters.ts')).FIGHTER_ORDER);
const tick = (n = 1) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__game.tick(false, { forcePaused: true }); }, n);
const view = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.ctx.fighters.view)));
let firstRun = true;

for (const id of ids.filter((i) => !only || only.includes(i))) {
  console.log(`\n== ${id}`);
  const errorsBefore = errors.length;
  // The same start the title makes.
  await page.evaluate((id) => { window.__game.ctx.state.paused = false; window.__game.ctx.run.startNewRun(window.__game.ctx, { kit: 'spark', daily: false, fighter: id }); }, id);
  await page.waitForFunction(() => window.__game.ctx.run.active === true && window.__game.ctx.state.mode === 'play', { timeout: 60000 });
  if (firstRun) { await waitForOpeningEnd(page).catch(() => undefined); firstRun = false; }
  await page.evaluate(() => window.__game.ctx.fighters.whenReady());
  await page.waitForTimeout(400);
  await page.evaluate(() => { const c = window.__game.ctx; c.state.arrivalGraceUntil = 0; c.state.paused = true; });
  await tick(30);

  let v = await view();
  check(`${id}: equipped, abilities named, kit loaded`, v.id === id && v.tactical.name.length > 0 && v.ultimate.name.length > 0 && v.tactical.ready === true, JSON.stringify({ id: v.id, t: v.tactical }));
  const chips = await page.evaluate(() => { const c = document.getElementById('fighter-chips'); return c ? { hidden: c.hidden, icons: c.querySelectorAll('.fc-icon svg').length } : null; });
  check(`${id}: the HUD chips show with their own glyphs`, chips && !chips.hidden && chips.icons === 2, JSON.stringify(chips));
  const look = await page.evaluate(async (id) => (await import('/src/render/player/looks/index.ts')).lookFor(id) !== undefined, id);
  check(`${id}: has a look`, look === true);

  // Z through the real key path: it fires, or it refuses with a reason; it never throws.
  await page.keyboard.down('KeyZ'); await tick(2); await page.keyboard.up('KeyZ'); await tick(40);
  v = await view();
  const zFired = v.tactical.usedAt >= 0, zRefused = v.tactical.refusedAt >= 0;
  check(`${id}: Z ${zFired ? 'fired' : 'refused'} (the real key path)`, zFired || zRefused, JSON.stringify(v.tactical));
  // T with a full bar.
  await page.evaluate(() => { window.__game.ctx.fighters.refill(); window.__game.ctx.player.hp = 100; });
  await tick(2);
  await page.keyboard.down('KeyT'); await tick(2); await page.keyboard.up('KeyT'); await tick(60);
  v = await view();
  const tFired = v.ultimate.usedAt >= 0, tRefused = v.ultimate.refusedAt >= 0;
  check(`${id}: T ${tFired ? 'fired' : 'refused'} (the real key path)`, tFired || tRefused, JSON.stringify(v.ultimate));
  console.log(`  note  ${id}: Z ${zFired ? 'fired' : 'refused'}, T ${tFired ? 'fired' : 'refused'}`);
  await page.screenshot({ path: `verify-out/fighters/play-${id}.png` });

  // A floor change: the fighter stays, what the kit placed is cleared.
  const before = await page.evaluate(() => ({ id: window.__game.ctx.fighters.id, charge: window.__game.ctx.fighters.view.ultimate.charge }));
  await page.evaluate(() => { window.__game.ctx.state.paused = false; });
  await execConsoleCommand(page, 'goto d2', { rejectOnError: false });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__game.ctx.state.arrivalGraceUntil = 0; window.__game.ctx.state.paused = true; });
  await tick(10);
  const after = await page.evaluate(() => { const f = window.__game.ctx.fighters; return { id: f.id, level: window.__game.ctx.levels.current?.def.id, drawables: f.drawables.length, owns: f.ownsMovement }; });
  // (a passive with an always-on layer, Sable's spoor or Mara's ripples, re-mounts its own drawable on the next tick: at most that one remains)
check(`${id}: a floor change keeps the fighter and clears what it placed`, after.id === id && after.drawables <= 1 && after.owns === false, JSON.stringify(after));
  void before;

  // Death and respawn.
  await page.evaluate(() => { window.__game.ctx.state.paused = false; window.__game.ctx.playerCtl.kill('probe'); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__game.ctx.state.paused = true; });
  await tick(30);
  check(`${id}: dead, the chips go away`, await page.evaluate(() => document.getElementById('fighter-chips')?.hidden === true));
  await page.evaluate(() => { window.__game.ctx.state.paused = false; window.__game.ctx.playerCtl.respawn(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__game.ctx.state.paused = true; });
  await tick(10);
  const resp = await page.evaluate(() => { const f = window.__game.ctx.fighters; return { id: f.id, dead: window.__game.ctx.player.dead, charge: f.view.ultimate.charge, ownsM: f.ownsMovement }; });
  check(`${id}: a respawn is a clean start for the same fighter`, resp.id === id && !resp.dead && resp.charge < 0.1 && !resp.ownsM, JSON.stringify(resp));
  check(`${id}: no page errors`, errors.length === errorsBefore, errors.slice(errorsBefore, errorsBefore + 2).join(' | '));
}

await browser.close();
console.log(`\nfighter roster play probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
