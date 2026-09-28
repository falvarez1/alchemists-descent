// D1 Works creature probe: drain the Rillback Sluice with its real handwheel
// and watch the eel land (it must fall to the floor, never hang on the valve
// post), then stand in the flooded Undertow beside the Stone Maw and watch it
// hunt. Usage: node scripts/probe-works-creatures.mjs [url] [--shots]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startConsolePlayRun } from './run-helpers.mjs';

const url = process.argv.find(a => a.startsWith('http')) ?? 'http://localhost:5173/';
const shots = process.argv.includes('--shots');
const out = 'verify-out/works-creatures';
mkdirSync(out, { recursive: true });
let fail = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await startConsolePlayRun(page, { seed: 7, settleMs: 600 });
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.paused = false;
  ctx.state.debugGodMode = true;
  document.querySelectorAll('.hint-teach, #hint-teach').forEach(n => n.remove());
});

const place = (x, y) => page.evaluate(([x, y]) => {
  const p = window.__game.ctx.player;
  p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
}, [x, y]);
const creature = (source) => page.evaluate((source) => {
  const ctx = window.__game.ctx, e = ctx.enemies.find(e => e.sourceId === source);
  if (!e) return null;
  const def = ctx.enemyCtl.defs[e.kind];
  return { x: +(e.x + e.fx).toFixed(2), y: +(e.y + e.fy).toFixed(2), vx: +e.vx.toFixed(3), vy: +e.vy.toFixed(3),
    free: ctx.physics.entityFree(e.x, e.y, def.halfW, def.h), grounded: e.grounded, wet: e.rillWet ?? null,
    intent: e.mind?.intent, visible: e.mind?.visible, conf: +(e.mind?.confidence ?? 0).toFixed(2),
    stun: e.mawStun ?? 0, elec: e.status.electrified, wetStatus: e.status.wet, alerted: !!e.alerted, hp: e.hp,
    head: e.body ? [+e.body.nodes[0].x.toFixed(1), +e.body.nodes[0].y.toFixed(1)] : null };
}, source);
const shoot = async (name) => { if (shots) await page.screenshot({ path: `${out}/${name}.png` }); };

// ---- 1. The Rillback Sluice drains out from under its eel ----
console.log('Rillback Sluice');
await place(524, 381);
await page.waitForTimeout(700);
const eel0 = await creature('works-rillback-sluice');
check('the sluice eel exists and starts in water', eel0 && eel0.wet >= 0.28, JSON.stringify(eel0));
// Herd it against the reservoir's west wall — the reported eel hung there
// once the water level fell away beneath it.
await page.evaluate(() => {
  const ctx = window.__game.ctx, e = ctx.enemies.find(e => e.sourceId === 'works-rillback-sluice');
  e.x = 574; e.y = 400; e.fx = 0; e.fy = 0; e.vx = -0.9; e.vy = -0.4; e.body = undefined;
});
await page.waitForTimeout(600);
const opened = await page.evaluate(() => window.__game.ctx.mechanisms.interact(window.__game.ctx));
check('the handwheel opens the sluice valve', opened);
await place(600, 340);
let eel = null;
for (let t = 0; t < 16; t++) {
  // A long drain, compressed: the reservoir empties to its floor puddle.
  await page.evaluate((t) => {
    const w = window.__game.ctx.world, level = 380 + t * 4;
    for (let y = 368; y < Math.min(437, level); y++) for (let x = 560; x < 800; x++) {
      const i = w.idx(x, y);
      if (w.types[i] === 2) w.clearCellAt(i);
    }
  }, t);
  await page.waitForTimeout(400);
  eel = await creature('works-rillback-sluice');
  if (t % 4 === 0) console.log('   ', JSON.stringify(eel));
}
await page.waitForTimeout(2500);
eel = await creature('works-rillback-sluice');
console.log('   ', JSON.stringify(eel));
await shoot('sluice-drained');
check('the drained eel is not wedged in terrain', eel?.free === true, JSON.stringify(eel));
check('the drained eel came to rest on something', eel && (eel.grounded || eel.wet >= 0.28), JSON.stringify(eel));
const later = await creature('works-rillback-sluice');
await page.waitForTimeout(1500);
const after = await creature('works-rillback-sluice');
check('the beached eel still moves (hops/flops)', later && after && (Math.abs(after.x - later.x) + Math.abs(after.y - later.y) > 0.5 || after.grounded),
  `${JSON.stringify(later)} -> ${JSON.stringify(after)}`);

// A truly beached eel: dry air above the plank ledge, its body snagged high.
await page.evaluate(() => {
  const ctx = window.__game.ctx, e = ctx.enemies.find(e => e.sourceId === 'works-rillback-sluice');
  e.x = 600; e.y = 318; e.fx = 0; e.fy = 0; e.vx = 0; e.vy = 0; e.rillWet = 0;
  e.body?.nodes.forEach((n, i) => { n.x = n.previousX = 600; n.y = n.previousY = 300 + i * 4; });
});
await page.waitForTimeout(2000);
const beached = await creature('works-rillback-sluice');
check('a beached eel falls to the ledge instead of hanging in the air', beached && beached.free && beached.y > 335 && beached.y < 342,
  JSON.stringify(beached));

// ---- 2. The Stone Maw in the flooded Undertow ----
console.log('Stone Maw, Undertow');
const maw0 = await creature('works-stonemaw-undertow');
check('the undertow maw exists', !!maw0, JSON.stringify(maw0));
// Flood its trough the way a drained sluice floods it, then stand beside it.
await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  for (let y = 975; y < 1008; y++) for (let x = 690; x < 870; x++) {
    const i = w.idx(x, y);
    if (w.types[i] === 0) w.replaceCellAt(i, 2, 0x44919a);
  }
});
const calm = () => page.evaluate(() => {
  const ctx = window.__game.ctx, e = ctx.enemies.find(e => e.sourceId === 'works-stonemaw-undertow');
  if (e.mind) { e.mind.confidence = 0; e.mind.intent = 'forage'; e.mind.irritation = 0; }
  e.alerted = false; ctx.player.lastDamageSource = null;
  return e.x;
});
// (a) Standing still in the water a few body lengths away (the reported case).
let mawX = await calm();
await place(mawX + 45, 1008);
let bitten = false, a = null;
for (let t = 0; t < 18 && !bitten; t++) {
  await page.waitForTimeout(400);
  a = await creature('works-stonemaw-undertow');
  bitten = await page.evaluate(() => window.__game.ctx.player.lastDamageSource === 'stonemaw-bite');
  if (t % 4 === 0) console.log('   still:', JSON.stringify(a));
}
await shoot('undertow-maw-still');
check('the maw feels a still player nearby, closes and bites', bitten, JSON.stringify(a));
check('the maw is not wedged in the floor', a?.free === true, JSON.stringify(a));
// (b) Wading at a distance: the water carries it.
mawX = await calm();
await place(mawX + 120, 1008);
const d0 = 120;
let closest = Infinity;
for (let t = 0; t < 24; t++) {
  await page.evaluate((t) => { const k = window.__game.ctx.input.keys; k.right = t % 2 === 0; k.left = t % 2 === 1; }, t);
  await page.waitForTimeout(160);
  await page.evaluate(() => { const k = window.__game.ctx.input.keys; k.right = false; k.left = false; });
  await page.waitForTimeout(240);
  const maw = await creature('works-stonemaw-undertow');
  const px = await page.evaluate(() => window.__game.ctx.player.x);
  closest = Math.min(closest, Math.abs(maw.x - px));
  if (t % 6 === 0) console.log('   wading:', JSON.stringify({ ...maw, px }));
}
check('the maw closes on a wading player', closest < d0 - 40, `closest ${closest.toFixed(1)} of ${d0}`);
check('no page errors', errors.length === 0, errors.join('\n'));
await browser.close();
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
