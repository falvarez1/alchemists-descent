// Reliability trials for the Bell & Tea Engine: the real game tick (cell sim,
// Rapier bodies, the director) driven as fast as the CPU allows. By default a
// scripted alchemist answers each of the three faults with the REAL verb — a
// Spark Bolt cast at the priming pan through the wand system, a kick through
// the player controller, the water flask poured through the grate — after a
// human reaction delay, standing where a player would stand. Reports the tick
// each stage began and where anything stalled.
// Usage: node scripts/trial-tea-machine.mjs [url] [--seeds 1,2,3] [--trials 8]
//          [--idle]      nobody helps: the slow backups must finish the engine
//          [--away]      the player is elsewhere in the level the whole time
//          [--enemies]   leave the level's creatures alive
import { chromium } from 'playwright-core';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const trials = Number(opt('trials', '8'));
const seeds = opt('seeds', '')?.split(',').filter(Boolean).map(Number);
const mode = args.includes('--away') ? 'away' : args.includes('--idle') ? 'idle' : 'player';
const keepEnemies = args.includes('--enemies');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(url); await waitForConsoleApi(page);
const results = [];
for (let t = 0; t < trials; t++) {
  const seed = seeds.length ? seeds[t % seeds.length] : 1000 + t * 37;
  await execConsoleCommand(page, `run test --level d1 --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  const result = await page.evaluate(async ({ mode, keepEnemies }) => {
    const game = window.__game, ctx = game.ctx, rt = ctx.levels.current;
    if (!keepEnemies) ctx.enemies.length = 0;
    ctx.state.debugGodMode = true;
    const place = (x, y = 311) => { ctx.player.x = x; ctx.player.y = y; ctx.player.vx = 0; ctx.player.vy = 0; };
    place(...(mode === 'away' ? [170, 314] : [430, 311]));
    ctx.state.paused = true;
    const tick = () => game.tick(false, { forcePaused: true });
    for (let i = 0; i < 90; i++) tick(); // the workshop settles while a player walks up
    rt.mechanisms.find(m => m.id === 8201).state = 1;
    const stageAt = {}, t0 = performance.now(), verbs = [];
    let last = -1, since = 0, n = 0;
    const aimAt = (x, y) => { ctx.input.mouse.x = x; ctx.input.mouse.y = y; };
    while (n < 12000) {
      for (let k = 0; k < 300; k++, n++) {
        const tea = rt.living.tea;
        if (tea.stage !== last) { last = tea.stage; stageAt[tea.stage] = n; since = n; }
        const wait = n - since;
        if (mode === 'player') {
          // SPARK (2): stand under the coupling and cast the Spark Bolt at the pan.
          if (tea.stage === 2 && wait === 60) place(505);
          if (tea.stage === 2 && wait >= 70 && wait < 74) { aimAt(523, 267); ctx.player.firing = true; ctx.player.firePressed = true; }
          if (tea.stage === 2 && wait === 74) { ctx.player.firing = false; verbs.push(['spark', n]); }
          // KICK (6): walk under the Persuader and kick it.
          if (tea.stage === 6 && wait === 60) place(740);
          if (tea.stage === 6 && wait >= 70 && wait % 30 === 10) {
            const bob = ctx.rigidBodies.bodies.find(b => b.tag === 'tea-persuader');
            aimAt(bob.x, bob.y); ctx.player.aimAngle = Math.atan2(bob.y - (ctx.player.y - 9), bob.x - ctx.player.x);
            ctx.playerCtl.kick(ctx); verbs.push(['kick', n]);
          }
          // POUR (9): stand beside the grate and pour the water flask through it.
          if (tea.stage === 9 && wait === 60) { place(1030); ctx.flask.selectSlot(0); }
          if (tea.stage === 9 && wait >= 64 && wait < 110) { aimAt(1000, 312); ctx.input.pourHeld = true; }
          if (tea.stage === 9 && wait === 110) { ctx.input.pourHeld = false; verbs.push(['pour', n]); }
        }
        tick();
        if (tea.completed || tea.stalled) break;
      }
      const tea = rt.living.tea;
      if (tea.completed || tea.stalled) break;
      await new Promise(r => setTimeout(r, 0));
    }
    ctx.input.pourHeld = false; ctx.player.firing = false;
    const tea = rt.living.tea;
    const bodies = Object.fromEntries(ctx.rigidBodies.bodies.filter(b => b.tag?.startsWith('tea-')).map(b => [b.tag.slice(4), [Math.round(b.x), Math.round(b.y), +b.angle.toFixed(2), b.rope ? 'R' : '', b.tether ? 'T' : '']]));
    ctx.state.paused = false;
    return { completed: tea.completed, stalled: tea.stalled, stage: tea.stage, stageAt, ticks: n, travel: tea.travel,
      ms: Math.round(performance.now() - t0), bodies, verbs, assists: ctx.telemetry?.snapshot?.() };
  }, { mode, keepEnemies });
  results.push({ seed, ...result });
  console.log(`seed ${seed}: ${result.completed ? 'COMPLETED' : `STOPPED at stage ${result.stage}`} in ${result.ticks} ticks (${(result.ticks / 60).toFixed(1)} s game, ${result.ms} ms) stages ${JSON.stringify(result.stageAt)}${result.completed ? '' : ' travel ' + JSON.stringify(result.travel) + ' bodies ' + JSON.stringify(result.bodies)}`);
}
const done = results.filter(r => r.completed).length;
const byStage = {}; for (const r of results) if (!r.completed) byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
const mean = results.filter(r => r.completed).reduce((a, r) => a + r.ticks, 0) / Math.max(1, done) / 60;
console.log(`\n[${mode}${keepEnemies ? '+enemies' : ''}] ${done}/${results.length} completed, mean ${mean.toFixed(1)} s; stops by stage: ${JSON.stringify(byStage)}`);
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
await browser.close();
