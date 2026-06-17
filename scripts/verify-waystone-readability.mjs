// Waystone readability: ignition PROGRESS (ws.heat 0..1) is plumbed for the
// "almost lit" tell, climbs while fire sits in the bowl, RESETS when it guts out,
// and crosses to lit. (The render's distinct lit flame / progress arc / objective
// chevron read off ws.lit + ws.heat + player proximity.)
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
  const p = ctx.player, LAVA = 11, STONE = 12;
  const w0 = ctx.world; // capture to detect a mid-run world swap (sandbox detach)
  const w = () => ctx.world; // always write/read the LIVE world
  const rt = ctx.levels.current;
  // Levels.update early-returns if the player is dead, so keep him ALIVE but
  // parked and silent; the test bowls go well to his right.
  p.dead = false;
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  const baseX = Math.round(p.x), baseY = Math.round(p.y);

  // A real waystone sits in a stone bowl that pools the fire; a bare marker lets
  // the lava fall straight out, so build the container the level normally provides.
  const buildBowl = (wx, wy) => {
    const ww = w();
    for (let dx = -4; dx <= 4; dx++) { for (let yy = wy; yy <= wy + 2; yy++) { const i = ww.idx(wx + dx, yy); ww.types[i] = STONE; ww.colors[i] = 0x777777; } }
    for (let dy = -3; dy <= 0; dy++) { for (const sx of [wx - 3, wx + 3]) { const i = ww.idx(sx, wy + dy); ww.types[i] = STONE; ww.colors[i] = 0x777777; } }
  };
  const bowlFill = (wx, wy) => { const ww = w(); for (let dy = -3; dy <= -1; dy++) for (let dx = -2; dx <= 2; dx++) { const i = ww.idx(wx + dx, wy + dy); ww.types[i] = LAVA; ww.colors[i] = 0xff7722; } };
  const bowlClear = (wx, wy) => { const ww = w(); for (let dy = -3; dy <= -1; dy++) for (let dx = -2; dx <= 2; dx++) ww.clearCellAt(ww.idx(wx + dx, wy + dy)); };

  // ---- LIGHT: sustained fire in the bowl climbs ws.heat → lit ---------------
  // keep the player ALIVE every tick (Levels.update — which runs the waystone
  // checks — bails if he's dead); the bowl is far enough that the lava can't reach him.
  const keepAlive = () => { p.dead = false; p.hp = p.maxHp; p.invuln = 120; };
  const wx = baseX + 130, wy = baseY;
  buildBowl(wx, wy);
  rt.waystones.push({ x: wx, y: wy, lit: false });
  const ws = rt.waystones[rt.waystones.length - 1];
  keepAlive(); bowlFill(wx, wy); window.__game.tick();
  const dbg = { mode: ctx.state.mode, lavaInBowl: 0 };
  { const ww = w(); for (let dy = -3; dy <= -1; dy++) for (let dx = -2; dx <= 2; dx++) if (ww.types[ww.idx(wx + dx, wy + dy)] === LAVA) dbg.lavaInBowl++; }
  let heatPeak = ws.heat ?? 0, litAtFrame = -1;
  for (let f = 0; f < 150; f++) {
    keepAlive();
    bowlFill(wx, wy);             // re-assert fire each tick (lava is persistent but flows)
    window.__game.tick();
    heatPeak = Math.max(heatPeak, ws.heat ?? 0);
    if (ws.lit && litAtFrame < 0) litAtFrame = f;
  }

  // ---- RESET: heat partway, then let the fire gut out -----------------------
  const wx2 = baseX + 200, wy2 = baseY;
  buildBowl(wx2, wy2);
  rt.waystones.push({ x: wx2, y: wy2, lit: false });
  const ws2 = rt.waystones[rt.waystones.length - 1];
  for (let f = 0; f < 40; f++) { keepAlive(); bowlFill(wx2, wy2); window.__game.tick(); }
  const heatMid = ws2.heat ?? 0;
  const litMid = ws2.lit;
  bowlClear(wx2, wy2);
  for (let f = 0; f < 16; f++) { keepAlive(); bowlClear(wx2, wy2); window.__game.tick(); }
  const heatAfterGutter = ws2.heat ?? 0;

  return {
    dbg,
    heatPeak: +heatPeak.toFixed(2), lit: ws.lit, litAtFrame,
    heatMid: +heatMid.toFixed(2), litMid, heatAfterGutter: +heatAfterGutter.toFixed(2),
  };
});

// let the rAF render loop run several frames so the new flame/arc/chevron draw
// code actually executes (the physics arena has an on-screen waystone)
await page.waitForTimeout(600);

console.log('  ' + JSON.stringify(r));
check('ws.heat climbs toward ignition (progress tell)', r.heatPeak > 0.9, JSON.stringify(r));
check('sustained fire lights the waystone', r.lit && r.litAtFrame > 0, JSON.stringify(r));
check('heat accumulates partway before lighting', r.heatMid > 0.15 && r.heatMid < 1 && !r.litMid, JSON.stringify(r));
check('heat RESETS when the fire guts out (no false "almost")', r.heatAfterGutter === 0, JSON.stringify(r));
check('no page errors (render draws the new flame/arc/chevron each frame)', errs.length === 0, errs.join(' | '));

console.log(`\nwaystone-readability probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
