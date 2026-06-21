// Waystone readability + ignition (real worldgen geometry).
//
// The bowl is built EXACTLY as the cave generator stamps it (stampBrazier):
// a stone floor at baseY, two 2-tall side walls at dx=±3, and the waystone
// anchored at ws.y = baseY - 1 (the first OPEN cell above the floor). Brought
// fire/lava pools at ws.y itself, so this geometry reproduces the off-by-one
// that left cave waystones impossible to light by hand (the old detection rect
// scanned ws.y-3..ws.y-1 and never saw the cup floor). The earlier probe built
// the bowl in the physics-arena convention (stone AT ws.y), which lined up with
// the old rect by luck and masked the bug — so it now matches real worldgen.
//
// Usage: node scripts/verify-waystone-readability.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + ' ' + d); } };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 40; f++) window.__game.tick();
  // the `run test` console path leaves _transitioning latched, which short-circuits
  // Levels.update (waystone checks); clear it so the level logic runs (it's false
  // in real play — the user's prompt, in the same gated block, fires).
  ctx.levels._transitioning = false;
  const p = ctx.player, FIRE = 5, LAVA = 11, STONE = 12;
  const w = () => ctx.world; // always write/read the LIVE world
  const rt = ctx.levels.current;
  // Levels.update early-returns if the player is dead, so keep him ALIVE but
  // parked and silent; the test bowls go well to his right.
  p.dead = false;
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  const baseX = Math.round(p.x), baseY0 = Math.round(p.y);
  const keepAlive = () => { p.dead = false; p.hp = p.maxHp; p.invuln = 120; };

  // Build the cup EXACTLY like CaveGenerator.stampBrazier(cx, baseY):
  //   floor stone at baseY (dx -3..3), 2-tall walls at dx=±3, open interior,
  //   ws anchored at baseY - 1.
  const buildCup = (cx, baseY) => {
    const ww = w();
    for (let dx = -3; dx <= 3; dx++) { const i = ww.idx(cx + dx, baseY); ww.types[i] = STONE; ww.colors[i] = 0x777777; }
    for (let t = 1; t <= 2; t++) for (const sx of [cx - 3, cx + 3]) { const i = ww.idx(sx, baseY - t); ww.types[i] = STONE; ww.colors[i] = 0x777777; }
    for (let dy = 1; dy <= 5; dy++) for (let dx = -2; dx <= 2; dx++) ww.clearCellAt(ww.idx(cx + dx, baseY - dy));
  };
  const addWaystone = (cx, baseY) => { buildCup(cx, baseY); rt.waystones.push({ x: cx, y: baseY - 1, lit: false }); return rt.waystones[rt.waystones.length - 1]; };
  // Fill ONLY the cup-floor row (ws.y === baseY-1) — the exact cell the old rect
  // missed. If this lights it, the off-by-one is fixed.
  const fillFloorRow = (cx, baseY, cell) => { const ww = w(); for (let dx = -2; dx <= 2; dx++) { const i = ww.idx(cx + dx, baseY - 1); ww.types[i] = cell; ww.colors[i] = cell === LAVA ? 0xff7722 : 0xff5522; if (cell === FIRE) ww.life[i] = 30; } };
  const clearCup = (cx, baseY) => { const ww = w(); for (let dy = 1; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) ww.clearCellAt(ww.idx(cx + dx, baseY - dy)); };
  const countHot = (cx, baseY) => { const ww = w(); let n = 0; for (let dy = -2; dy <= 0; dy++) for (let dx = -2; dx <= 2; dx++) { const t = ww.types[ww.idx(cx + dx, baseY + dy)]; if (t === FIRE || t === LAVA) n++; } return n; };

  // ---- Test 1: LAVA poured to the cup floor lights it (persistent path) ------
  const cx1 = baseX + 130, by1 = baseY0;
  const ws1 = addWaystone(cx1, by1);
  let lit1At = -1, heat1Peak = 0;
  for (let f = 0; f < 160; f++) {
    keepAlive(); fillFloorRow(cx1, by1, LAVA); window.__game.tick();
    heat1Peak = Math.max(heat1Peak, ws1.heat ?? 0);
    if (ws1.lit && lit1At < 0) lit1At = f;
  }
  const hotFloor1 = countHot(cx1, by1); // proves fire/lava sits in the (new) rect

  // ---- Test 2: a held FLAME-JET stream (transient fire) lights it ------------
  const cx2 = baseX + 200, by2 = baseY0;
  const ws2 = addWaystone(cx2, by2);
  let lit2At = -1;
  for (let f = 0; f < 160; f++) {
    keepAlive(); fillFloorRow(cx2, by2, FIRE); window.__game.tick(); // re-seed each tick = held stream
    if (ws2.lit && lit2At < 0) lit2At = f;
  }

  // ---- Test 3: GRACE — a brief gap (<= grace) does NOT wipe progress ---------
  const cx3 = baseX + 270, by3 = baseY0;
  const ws3 = addWaystone(cx3, by3);
  for (let f = 0; f < 40; f++) { keepAlive(); fillFloorRow(cx3, by3, FIRE); window.__game.tick(); }
  const heat3Before = ws3.heat ?? 0;
  clearCup(cx3, by3);
  for (let f = 0; f < 8; f++) { keepAlive(); clearCup(cx3, by3); window.__game.tick(); } // 8 frames = 2 checks (<= grace 3)
  const heat3AfterGap = ws3.heat ?? 0;

  // ---- Test 4: GUTTER — a long cold spell fully resets (no false "almost") ---
  const cx4 = baseX + 340, by4 = baseY0;
  const ws4 = addWaystone(cx4, by4);
  for (let f = 0; f < 40; f++) { keepAlive(); fillFloorRow(cx4, by4, FIRE); window.__game.tick(); }
  const heat4Mid = ws4.heat ?? 0; const lit4Mid = ws4.lit;
  clearCup(cx4, by4);
  for (let f = 0; f < 28; f++) { keepAlive(); clearCup(cx4, by4); window.__game.tick(); } // 28 frames = 7 checks (> grace)
  const heat4AfterGutter = ws4.heat ?? 0;

  return {
    heat1Peak: +heat1Peak.toFixed(2), lit1: ws1.lit, lit1At, hotFloor1,
    lit2: ws2.lit, lit2At,
    heat3Before: +heat3Before.toFixed(2), heat3AfterGap: +heat3AfterGap.toFixed(2),
    heat4Mid: +heat4Mid.toFixed(2), lit4Mid, heat4AfterGutter: +heat4AfterGutter.toFixed(2),
  };
});

// let the rAF render loop run several frames so the new flame/arc/chevron/glow
// draw code actually executes (the physics arena has an on-screen waystone)
await page.waitForTimeout(600);

console.log('  ' + JSON.stringify(r));
check('cup-floor fire/lava is inside the detection rect (off-by-one fixed)', r.hotFloor1 > 0, JSON.stringify(r));
check('lava poured to the cup floor lights the waystone', r.lit1 && r.lit1At > 0, JSON.stringify(r));
check('a held flame-jet stream lights the waystone', r.lit2 && r.lit2At > 0, JSON.stringify(r));
check('a brief gap (<= grace) keeps ignition progress', r.heat3AfterGap > 0 && r.heat3AfterGap >= r.heat3Before - 0.05, JSON.stringify(r));
check('heat accumulates partway before lighting', r.heat4Mid > 0.15 && r.heat4Mid < 1 && !r.lit4Mid, JSON.stringify(r));
check('a long gutter RESETS heat (no false "almost lit")', r.heat4AfterGutter === 0, JSON.stringify(r));
check('no page errors (render draws the new flame/arc/chevron/glow each frame)', errs.length === 0, errs.join(' | '));

console.log(`\nwaystone-readability probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
