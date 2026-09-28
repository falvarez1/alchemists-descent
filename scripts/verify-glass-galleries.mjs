// THE GLASS GALLERIES' light rooms, live in the real game (d3b), lit by the
// REAL wand beam through the real renderer's raycast (render/Lighting builds
// the light field; the photocells read it through ctx.lightQuery):
//  - THE PERISCOPE: standing on the brass inlay under the light well and
//    shining straight up turns the beam off the well's head mirror, down the
//    lens tunnel, onto the sealed photocell — the strongroom gate opens.
//    Control: shining from the room floor elsewhere never charges it.
//  - THE PRISM GATE: shining level through the lens-house window into the
//    crystal prism lights BOTH blinder-tubed photocells at once — the gate
//    opens. Control: with the prism gone, the same beam lights neither.
//  - the Galleries' dressing is there (mirror panels, chandeliers, vitrines).
//   node scripts/verify-glass-galleries.mjs [--seed=7] [--url=http://localhost:5173/]
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const url = opt('url', 'http://localhost:5173/');
const seed = Number(opt('seed', '7'));
const shots = opt('shots', '');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await startConsoleTestRun(page, { level: 'd3b', seed, settleMs: 800 });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

await page.evaluate(() => {
  const game = window.__game, ctx = game.ctx;
  ctx.state.debugGodMode = true;
  ctx.state.lanternHooded = false;
  // One tick with the beam held at `aim` from where the alchemist stands: the
  // real light field is rebuilt around him first (the renderer's own pass).
  window.__shine = (aim, n) => {
    const p = ctx.player, light = game.composer.light;
    for (let k = 0; k < n; k++) {
      p.aimAngle = aim; p.vx = 0;
      ctx.camera.renderX = Math.round(p.x - 320);
      ctx.camera.renderY = Math.round(p.y - 180);
      light.build(ctx);
      ctx.state.paused = false;
      game.tick(false);
    }
  };
  window.__gateOf = (lensMechs) => {
    const ids = new Set(lensMechs.map((m) => m.targetId));
    return ctx.levels.current.mechanisms.find((m) => ids.has(m.id)) ?? null;
  };
});

const pieces = await page.evaluate(() => (window.__game.ctx.levels.current.placedPrefabs ?? []).filter((p) => p.id.startsWith('glass-')));
check(pieces.some((p) => p.id === 'glass-periscope'), `the Periscope is placed (${pieces.map((p) => p.id).join(', ')})`);
check(pieces.some((p) => p.id === 'glass-prism-gate'), 'the Prism Gate is placed');

const dressing = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let mirror = 0, glass = 0, crystal = 0;
  for (let i = 0; i < w.types.length; i++) { const t = w.types[i]; if (t === 43) mirror++; else if (t === 31) glass++; else if (t === 29) crystal++; }
  return { mirror, glass, crystal };
});
console.log(JSON.stringify(dressing));
check(dressing.mirror > 150, `silvered panels on the gallery walls (${dressing.mirror} mirror cells)`);
check(dressing.glass > 150, `vitrines and windows (${dressing.glass} glass cells)`);

const peri = pieces.find((p) => p.id === 'glass-periscope');
if (peri) {
  const r = await page.evaluate((P) => {
    const ctx = window.__game.ctx, w = ctx.world;
    const h = P.y1 - P.y0 + 1;
    const floorY = P.y0 + h - 12, wellX = P.x0 + 46;
    const lenses = ctx.levels.current.mechanisms.filter((m) => m.kind === 'sensor' && m.sensorType === 'light' && m.x > P.x0 && m.x < P.x1 && m.y > P.y0 && m.y < P.y1);
    const gate = window.__gateOf(lenses);
    // The optics are whole (no repair carved the sealed attic open to the lens).
    const lens = lenses[0];
    let housing = 0; for (const [bx, by] of lens?.body ?? []) if (w.types[w.idx(bx, by)] === 12) housing++;
    let atticHoles = 0; for (let y = P.y0 + 10; y < P.y0 + 14; y++) for (let x = P.x0 + 8; x <= P.x1 - 8; x++) if (w.types[w.idx(x, y)] !== 13) atticHoles++;
    // Control first: from the room floor well east of the well, shine up at the attic.
    Object.assign(ctx.player, { x: wellX + 30, y: floorY - 1 });
    window.__shine(-Math.PI / 2, 150);
    const control = { lens: lenses.map((m) => +(m.reading ?? 0).toFixed(2)), state: lenses.map((m) => m.state), gate: gate?.state ?? -1 };
    // The answer: stand on the inlay, shine straight up the well.
    Object.assign(ctx.player, { x: wellX, y: floorY - 1 });
    window.__shine(-Math.PI / 2, 200);
    const lit = { lens: lenses.map((m) => +(m.reading ?? 0).toFixed(2)), state: lenses.map((m) => m.state), gate: gate?.state ?? -1 };
    const gateCells = gate ? (() => { let n = 0; for (let dy = 0; dy < gate.h; dy++) for (let dx = 0; dx < gate.w; dx++) if (w.types[w.idx(gate.x + dx, gate.y + dy)] === 13) n++; return n; })() : -1;
    return { lenses: lenses.length, control, lit, gateCells, housing, atticHoles };
  }, peri);
  console.log(JSON.stringify(r));
  check(r.lenses === 1, 'one sealed photocell in the attic');
  check(r.housing === 6 && r.atticHoles === 0, `the attic and the lens housing are whole (housing ${r.housing}/6, ${r.atticHoles} holes)`);
  check(r.control.state[0] === 0, `shining from elsewhere never charges it (${JSON.stringify(r.control)})`);
  check(r.lit.state[0] > 0 && r.lit.gate === 1, `up the well, off the mirror, the photocell latches and the gate opens (${JSON.stringify(r.lit)})`);
}

const prism = pieces.find((p) => p.id === 'glass-prism-gate');
if (prism) {
  const r = await page.evaluate((P) => {
    const ctx = window.__game.ctx, w = ctx.world;
    const h = P.y1 - P.y0 + 1;
    const floorY = P.y0 + h - 12, x1 = P.x1;
    const hx1 = x1 - 44, hx0 = hx1 - 30, px = hx0 + 8, py = floorY - 10;
    const lenses = ctx.levels.current.mechanisms.filter((m) => m.kind === 'sensor' && m.sensorType === 'light' && m.x > P.x0 && m.x < P.x1 && m.y > P.y0 && m.y < P.y1);
    const gate = window.__gateOf(lenses);
    const standX = hx0 - 40;
    // Control: the prism taken out (a straight beam through an empty window).
    const saved = [];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const i = w.idx(px + dx, py + dy); saved.push([i, w.types[i], w.colors[i]]); w.types[i] = 0; w.colors[i] = 0x08080c; }
    Object.assign(ctx.player, { x: standX, y: floorY - 1 });
    const aim = Math.atan2(py - (floorY - 10), px - standX);
    window.__shine(aim, 150);
    const control = { lens: lenses.map((m) => +(m.reading ?? 0).toFixed(2)), state: lenses.map((m) => m.state), gate: gate?.state ?? -1 };
    for (const [i, t, c] of saved) { w.types[i] = t; w.colors[i] = c; }
    for (const m of lenses) { m.state = 0; m.reading = 0; }
    // The answer: shine level through the window into the prism.
    window.__shine(aim, 220);
    const lit = { lens: lenses.map((m) => +(m.reading ?? 0).toFixed(2)), state: lenses.map((m) => m.state), gate: gate?.state ?? -1 };
    return { lenses: lenses.length, control, lit, standX, px, py };
  }, prism);
  console.log(JSON.stringify(r));
  check(r.lenses === 2, 'twin photocells in the lens-house');
  check(r.control.gate !== 1, `without the prism the level beam opens nothing (${JSON.stringify(r.control)})`);
  check(r.lit.gate === 1, `through the window into the prism, both tubes light and the gate opens (${JSON.stringify(r.lit)})`);
}

if (shots) {
  for (const p of pieces) {
    await page.evaluate((P) => {
      const ctx = window.__game.ctx;
      Object.assign(ctx.player, { x: P.x0 + 30, y: P.y1 - 13 });
      ctx.camera.snapTo?.(P.x0 + (P.x1 - P.x0) / 2, P.y0 + (P.y1 - P.y0) / 2);
      for (let k = 0; k < 30; k++) { ctx.state.paused = false; window.__game.tick(false); }
    }, p);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/${p.id}.png` });
  }
}

check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
