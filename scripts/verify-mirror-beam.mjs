// LIGHT THAT TURNS CORNERS, in the real renderer: the wand's beam bounces off
// Mirror cells and splits in Crystal (render/Lighting + sim/beam), and the
// turned light is what the gameplay light query (and so a photocell) reads.
// Builds a sealed test box in the level, aims the real beam, builds the real
// light field, and reads wandField around the corner.
//   node scripts/verify-mirror-beam.mjs [--url=http://localhost:5173/]
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const url = opt('url', 'http://localhost:5173/');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await startConsoleTestRun(page, { level: 'd3b', seed: 3, settleMs: 600 });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const result = await page.evaluate(() => {
  const game = window.__game;
  const ctx = game.ctx;
  const light = game.composer.light;
  const w = ctx.world;
  const C = { Empty: 0, Wall: 3, Stone: 12, Crystal: 29, Mirror: 43 };
  const X0 = 700, Y0 = 300, W = 220, H = 170;
  const set = (x, y, t, c) => { const i = w.idx(x, y); w.types[i] = t; w.colors[i] = c; w.life[i] = 0; };
  // A sealed stone box, cleared inside.
  for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++) {
    const edge = x < X0 + 3 || x >= X0 + W - 3 || y < Y0 + 3 || y >= Y0 + H - 3;
    set(x, y, edge ? C.Stone : C.Empty, edge ? 0x4a4a50 : 0x08080c);
  }
  // A "\" mirror, two cells thick, at the box's right: a rightward beam turns down.
  const mx = X0 + 100, my = Y0 + 20;
  for (let k = 0; k < 44; k++) { set(mx + k, my + k, C.Mirror, 0xd0d8e4); set(mx + k + 1, my + k, C.Mirror, 0xb8c4d2); }
  // A wall between the player and the target below, so only the turned beam reaches it.
  for (let y = Y0 + 70; y < Y0 + H - 3; y++) for (let x = X0 + 88; x < X0 + 94; x++) set(x, y, C.Stone, 0x4a4a50);
  w.activity?.invalidateAll?.();

  ctx.state.paused = true;
  ctx.state.lanternHooded = false;
  const p = ctx.player;
  p.x = X0 + 60; p.y = Y0 + 60; p.dead = false;
  p.aimAngle = 0;
  const wand = ctx.state.wandLight;
  const saved = { ...wand };
  wand.flicker = 0;
  const sample = () => {
    ctx.camera.renderX = Math.round(p.x - 120);
    ctx.camera.renderY = Math.round(p.y - 120);
    ctx.camera.snapTo?.(p.x, p.y);
    light.build(ctx);
    const read = (x, y) => {
      const lx = (Math.floor(x) - light.originX) >> 1, ly = (Math.floor(y) - light.originY) >> 1;
      if (lx < 0 || ly < 0 || lx >= light.LW || ly >= light.LH) return -1;
      return light.wandField[ly * light.LW + lx];
    };
    // The target: straight below where the beam meets the mirror, behind the wall.
    const tx = mx + 31, ty = Y0 + 110;
    let best = 0;
    for (let dy = -6; dy <= 6; dy += 2) for (let dx = -10; dx <= 10; dx += 2) best = Math.max(best, read(tx + dx, ty + dy));
    return { target: best, query: ctx.lightQuery?.wandLight(tx, ty) ?? -1 };
  };
  const withMirror = sample();
  // Control: take the mirror away; the target must go dark.
  for (let k = 0; k < 44; k++) { set(mx + k, my + k, C.Empty, 0x08080c); set(mx + k + 1, my + k, C.Empty, 0x08080c); }
  const without = sample();
  Object.assign(wand, saved);
  return { withMirror, without, mx, my };
});
console.log(JSON.stringify(result));
check(result.withMirror.target >= 0.07, `the turned beam lights the target behind the wall (wandField ${result.withMirror.target.toFixed(3)})`);
check(result.without.target < 0.02, `without the mirror the target is dark (${result.without.target.toFixed(3)})`);

check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
