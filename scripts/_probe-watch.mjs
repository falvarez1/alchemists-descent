// HONEST observation: spawn into the weaver-test arena, place the player like the
// report screenshot (on a platform, across a gap from a den weaver), and WATCH the
// nearest weaver behave naturally for ~12s. NO forcing of alerted/cranky/teleport.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 600 });
  // census: list every weaver and the player spawn
  const census = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    return {
      player: { x: Math.round(ctx.player.x), y: Math.round(ctx.player.y) },
      weavers: ctx.enemies.filter(e => e.kind === 'weaver').map(e => ({ x: Math.round(e.x), y: Math.round(e.y), sleeping: e.sleeping === true, alerted: e.alerted === true })),
    };
  });
  console.log('CENSUS', JSON.stringify(census));
  // tag the weaver nearest the player; do NOT touch its state. Just observe.
  await page.evaluate(() => {
    const ctx = window.__game.ctx, p = ctx.player;
    const e = ctx.enemies.filter(g => g.kind === 'weaver').sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (e) e.__watch = 1;
  });
  const sample = () => page.evaluate(() => {
    const ctx = window.__game.ctx, p = ctx.player;
    const e = ctx.enemies.find(g => g.__watch === 1);
    if (!e) return { gone: true };
    return {
      x: Math.round(e.x), y: Math.round(e.y), dx: Math.round(p.x - e.x), dy: Math.round(p.y - e.y),
      dist: Math.round(Math.hypot(p.x - e.x, p.y - e.y)),
      sleeping: e.sleeping === true, alerted: e.alerted === true, cranky: Math.round(e.cranky ?? 0),
      vx: +(e.vx ?? 0).toFixed(2), vy: +(e.vy ?? 0).toFixed(2), grounded: e.grounded === true,
      climbT: e.weaverClimbT ?? 0, blink: e.blink ?? 0, windup: e.windup ?? 0, attackCd: Math.round(e.attackCd ?? 0),
    };
  });
  const grab = (f) => page.evaluate(() => new Promise(res => {
    const ctx = window.__game.ctx, e = ctx.enemies.find(g => g.__watch === 1) || ctx.player;
    ctx.camera.zoomLock = 1; ctx.camera.snapTo((e.x + ctx.player.x) / 2, (e.y + ctx.player.y) / 2 - 10);
    requestAnimationFrame(() => {
      const gl = document.querySelector('#canvas-holder > canvas');
      res(gl.toDataURL('image/png'));
    });
  })).then(d => writeFileSync('verify-out/watch-' + f + '.png', Buffer.from(d.split(',')[1], 'base64')));

  // advance frames naturally (camera follows the action), sampling
  for (let f = 0; f <= 720; f++) {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    if (f % 90 === 0) { console.log('t' + f, JSON.stringify(await sample())); }
    if (f === 0 || f === 240 || f === 480 || f === 720) await grab(f);
  }
} finally { await browser.close(); }
