import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
const A = process.argv[2] || 'selene-wraith', B = process.argv[3] || 'brann-rook';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 500)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto('http://localhost:5190/?link=off', { waitUntil: 'networkidle' });
await leaveTitleIfShown(page);
await waitForConsoleApi(page);
await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-duel --world campaign-level'); });
await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-duel' && window.__game.ctx.state.mode === 'play', null, { timeout: 40000 });
await page.waitForTimeout(2500);
await page.evaluate(async ([a, b]) => {
  const ctx = window.__game.ctx;
  ctx.state.paused = true;
  document.querySelectorAll('#card-offer-overlay.visible').forEach((e) => e.classList.remove('visible'));
  ctx.fighters.equip(a); await ctx.fighters.whenReady();
  ctx.state.arrivalGraceUntil = 0;
  await ctx.console.exec(`arena add ${b} 1020 639`);
  ctx.arena.reset();
  console.log((await ctx.console.exec('arena bot 0 basic 4')).text);
  console.log((await ctx.console.exec('arena bot 1 basic 4')).text);
}, [A, B]);
for (let seg = 0; seg < 12; seg++) {
  const r = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    for (let i = 0; i < 300; i++) { window.__game.tick(false, { forcePaused: true }); if (ctx.arena.bout.state === 'won') break; }
    const a = ctx.arena.bundle(0).player, b = ctx.arena.bundle(1).player;
    return { t: ctx.state.frameCount, bout: ctx.arena.bout.state, winner: ctx.arena.bout.winner, a: [Math.round(a.x), Math.round(a.hp)], b: [Math.round(b.x), Math.round(b.hp)], enemies: ctx.enemies.length, proj: ctx.projectiles.length };
  });
  console.log(JSON.stringify(r));
  await page.screenshot({ path: `verify-out/duel-${seg}.png` });
  if (r.bout === 'won') break;
}
await browser.close();
