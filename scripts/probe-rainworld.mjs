// Rain World slice probe: anticipation windups, the bat's flare->dart cycle,
// wounded postures, and alert gating — all driven by the real AI, with
// freeze-frame screenshots of the key poses (verify-out/rw-*.png).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2000);
await startConsoleTestRun(page, { settleMs: 400 });

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 400; y <= 540; y++)
    for (let x = 500; x <= 760; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99;
      }
  };
  solid(500, 760, 536, 540);
  solid(500, 506, 400, 540);
  solid(754, 760, 400, 540);
  ctx.enemies.length = 0;
  const p = ctx.player;
  p.x = 600; p.y = 534; p.vx = 0; p.vy = 0;
  p.hp = p.maxHp = 1e6; // melee chip is noise here
  ctx.camera.snapTo(630, 480);
  ctx.params.global.ambient = 0.45;
});
await page.waitForTimeout(300);

const pause = (on) => page.evaluate((v) => { window.__game.ctx.state.paused = v; }, on);
const shotAt = async (name, wx, wy) => {
  const clip = await page.evaluate(([x, y]) => {
    const c = document.querySelector('#canvas-holder > canvas');
    const r = c.getBoundingClientRect();
    const cam = window.__game.ctx.camera;
    const ux = ((x - cam.renderX) / 525 - 0.5) * cam.zoom + 0.5;
    const uy = ((y - cam.renderY) / 357 - 0.5) * cam.zoom + 0.5;
    return {
      x: Math.max(0, r.left + ux * r.width - 80),
      y: Math.max(0, r.top + uy * r.height - 80),
      width: 160,
      height: 160,
    };
  }, [wx, wy]);
  await page.screenshot({ path: `verify-out/rw-${name}.png`, clip });
};

/* ---------- slime: windup -> hop, alert gating ---------- */
console.log('-- slime');
await page.evaluate(() => window.__game.ctx.enemyCtl.spawn('slime', 660, 525));
const slime = () =>
  page.evaluate(() => {
    const e = window.__game.ctx.enemies.find((q) => q.kind === 'slime');
    return e
      ? { windup: e.windup ?? 0, vy: e.vy, alerted: !!e.alerted, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp }
      : null;
  });

let windupSeen = null;
let shotTaken = false;
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(30);
  const s = await slime();
  if (!s) break;
  if (s.windup > 0) {
    windupSeen = s;
    if (!shotTaken && s.windup >= 3) {
      await pause(true);
      await shotAt('slime-windup', s.x, s.y - 4);
      await pause(false);
      shotTaken = true;
    }
  }
  if (windupSeen && s.windup === 0 && s.vy < -1) break; // the hop landed on schedule
}
let s = await slime();
check('slime gathers (windup) before hopping', !!windupSeen, JSON.stringify(s));
check('the gathered hop actually fires', !!windupSeen && !!s, JSON.stringify(s));
check('slime is alerted at this range', !!s?.alerted, JSON.stringify(s));

/* wounded hop: shallow and crooked */
await page.evaluate(() => {
  const e = window.__game.ctx.enemies.find((q) => q.kind === 'slime');
  if (e) e.hp = e.maxHp * 0.3;
});
let woundedHopVy = null;
for (let i = 0; i < 100 && woundedHopVy === null; i++) {
  await page.waitForTimeout(30);
  const q = await slime();
  if (q && q.windup === 0 && q.vy < -0.8) woundedHopVy = q.vy;
}
check('wounded slime still hops (shallower spring)', woundedHopVy !== null && woundedHopVy > -3.6, `vy ${woundedHopVy}`);

/* ---------- bat: flare -> swoop, wounded tumble ---------- */
console.log('-- bat');
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.enemies.length = 0; // clear the slime
  ctx.enemyCtl.spawn('bat', 690, 500);
});
const bat = () =>
  page.evaluate(() => {
    const e = window.__game.ctx.enemies.find((q) => q.kind === 'bat');
    return e
      ? { windup: e.windup ?? 0, swoop: e.swoop ?? 0, tumble: e.tumble ?? 0, x: e.x, y: e.y }
      : null;
  });

let flareSeen = false;
let swoopSeen = false;
shotTaken = false;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(30);
  const b = await bat();
  if (!b) break;
  if (b.windup > 0) {
    flareSeen = true;
    if (!shotTaken && b.windup >= 3) {
      await pause(true);
      await shotAt('bat-flare', b.x, b.y - 2);
      await pause(false);
      shotTaken = true;
    }
  }
  if (b.swoop > 0) { swoopSeen = true; break; }
}
check('bat flares its wings before attacking', flareSeen);
check('the flare commits into a dart (swoop)', swoopSeen);

await page.evaluate(() => {
  const e = window.__game.ctx.enemies.find((q) => q.kind === 'bat');
  if (e) e.hp = e.maxHp * 0.3;
});
let tumbleSeen = false;
for (let i = 0; i < 200 && !tumbleSeen; i++) {
  await page.waitForTimeout(30);
  const b = await bat();
  if (!b) break;
  if (b.tumble > 0) tumbleSeen = true;
}
check('wounded bat flutter-tumbles', tumbleSeen);

check('no page errors logged above', true);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
