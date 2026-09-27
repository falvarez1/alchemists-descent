// D1 Undertow, as reported: the real Stone Maw hunts a god-mode alchemist
// (chewing, dropping spoil) while its spine is measured every tick; then the
// Undertow Weaver is brought over the chewed floor and killed, and its
// remains are followed until they rest. Screenshots land in verify-out/undertow.
// Usage: node scripts/probe-undertow-remains.mjs [url] [--seed 777] [--ticks 1800]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const seed = Number(opt('seed', '777')), ticks = Number(opt('ticks', '1800'));
const out = 'verify-out/undertow'; mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url); await waitForConsoleApi(page);
  await execConsoleCommand(page, `run test --level d1 --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page); await page.waitForTimeout(1500);
  const hunt = await page.evaluate(({ ticks }) => {
    const game = window.__game, ctx = game.ctx, p = ctx.player;
    const maw = ctx.enemies.find(e => e.kind === 'stonemaw');
    if (!maw) return { error: 'no stonemaw' };
    ctx.state.debugGodMode = true; p.hp = p.maxHp = 99999;
    p.x = maw.x + 70; p.y = 1008; p.vx = p.vy = 0;
    ctx.state.paused = true;
    const tick = () => game.tick(false, { forcePaused: true });
    let worst = 0, when = '', taut = 0, chewT = 0;
    for (let t = 0; t < ticks; t++) {
      // Keep moving so it hears footsteps and keeps chewing toward us.
      p.x = maw.x + 70 + Math.sin(t / 50) * 30; p.vx = Math.cos(t / 50) * 0.6;
      tick();
      if ((maw.mawChewT ?? 0) > 0) chewT++;
      const n = maw.body?.nodes;
      if (!n) continue;
      for (let i = 1; i < n.length; i++) {
        const d = Math.hypot(n[i].x - n[i - 1].x, n[i].y - n[i - 1].y);
        if (d > maw.body.spacing * 1.3) taut++;
        if (d > worst) { worst = d; when = `t${t} link${i} at ${n[i].x.toFixed(0)},${n[i].y.toFixed(0)}`; }
      }
    }
    ctx.state.paused = false;
    return { worst: +worst.toFixed(1), when, taut, chewTicks: chewT, maw: [maw.x, maw.y], spacing: maw.body?.spacing };
  }, { ticks });
  console.log('Stone Maw hunt:', JSON.stringify(hunt));
  if (hunt.error || hunt.worst > hunt.spacing * 1.5 + 0.01) failed = true;
  await page.evaluate(() => { const c = window.__game.ctx, maw = c.enemies.find(e => e.kind === 'stonemaw');
    c.camera.zoomLock = 2.2; c.camera.actionFocus = { x: maw.x, y: maw.y - 10, zoom: 2.2 }; });
  await page.waitForTimeout(900);
  await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/maw-after-hunt.png` });
  const rest = await page.evaluate(async () => {
    const game = window.__game, ctx = game.ctx, w = ctx.world;
    const maw = ctx.enemies.find(e => e.kind === 'stonemaw'), weaver = ctx.enemies.find(e => e.kind === 'weaver' && e.y > 900);
    if (!weaver) return { error: 'no undertow weaver' };
    // Drop the Weaver onto the ground the Maw has been chewing, then kill both.
    weaver.x = maw.x + 6; weaver.y = maw.y - 40; weaver.vx = weaver.vy = 0;
    ctx.state.paused = true;
    const tick = () => game.tick(false, { forcePaused: true });
    for (let i = 0; i < 4; i++) tick();
    ctx.enemyCtl.kill(weaver, 2, 3);
    ctx.enemyCtl.kill(maw, -3, -2);
    const solid = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); if (!w.inBounds(ix, iy)) return true;
      const t = w.types[w.idx(ix, iy)]; return t === 12 || t === 13 || t === 3 || t === 1 || t === 4; };
    const SIL = [[-8.6, 2.4, 8.6, 6.6], [2.6, 0.8, 6.2, 4.6], [9.2, 1.2, 3.8, 3.3]];
    const buried = () => { const l = weaver.weaverLoco; let n = 0; const tx = -l.ny * l.face, ty = l.nx * l.face;
      for (const [ca, co, ra, ro] of SIL) for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, al = ca + Math.cos(a) * (ra - 1), ou = co + Math.sin(a) * (ro - 1);
        if (solid(l.px + tx * al + l.nx * ou, l.py + ty * al + l.ny * ou)) n++; } return n; };
    let inside = 0, worst = 0;
    for (let t = 0; t < 420; t++) {
      tick();
      if (buried() > 0) inside++;
      const n = maw.body.nodes;
      for (let i = 1; i < n.length; i++) worst = Math.max(worst, Math.hypot(n[i].x - n[i - 1].x, n[i].y - n[i - 1].y));
    }
    ctx.state.paused = false;
    ctx.camera.actionFocus = { x: weaver.weaverLoco.px, y: weaver.weaverLoco.py, zoom: 2.2 };
    return { weaverRest: [+weaver.weaverLoco.px.toFixed(1), +weaver.weaverLoco.py.toFixed(1)], anchorY: weaver.y,
      belly: +weaver.weaverLoco.ny.toFixed(2), weaverInsideTicks: inside, weaverEndInside: buried() > 0, mawDeadWorstLink: +worst.toFixed(1) };
  });
  console.log('Remains:', JSON.stringify(rest));
  if (rest.error || rest.weaverEndInside || rest.weaverInsideTicks > 30 || rest.mawDeadWorstLink > 6.01) failed = true;
  await page.waitForTimeout(900);
  await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/weaver-remains.png` });
} finally { await browser.close(); }
console.log(failed ? 'FAIL' : 'PASS: spine held and remains rest on the ground');
process.exitCode = failed ? 1 : 0;
