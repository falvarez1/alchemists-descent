// Hanging cell-vines come ALIVE near the camera: a Cell.Vines tendril is lifted
// into a soft Verlet VineStrand (cells cleared, pinned at the top), it sways when
// the world shakes, and it settles back into its ORIGINAL cells when far off-screen.
// Usage: node scripts/verify-vine-lift.mjs [url]
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
await page.waitForFunction(() => window.__game?.ctx?.vineStrands, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 40; f++) window.__game.tick();
  const w = ctx.world, p = ctx.player, VS = ctx.vineStrands, VINES = 15, STONE = 12;
  const keepAlive = () => { p.dead = false; p.hp = p.maxHp; p.invuln = 120; };
  keepAlive();

  // a ceiling-hung vine column inside the camera view
  const camX = Math.floor(ctx.camera.x), camY = Math.floor(ctx.camera.y);
  const vx = camX + 60, vyTop = camY + 50, len = 6;
  for (let y = vyTop - 3; y <= vyTop + len + 4; y++) for (let x = vx - 3; x <= vx + 3; x++) w.clearCellAt(w.idx(x, y));
  for (let x = vx - 1; x <= vx + 1; x++) { for (let y = vyTop - 2; y <= vyTop - 1; y++) { const i = w.idx(x, y); w.types[i] = STONE; w.colors[i] = 0x777777; } } // ceiling
  for (let d = 0; d < len; d++) { const i = w.idx(vx, vyTop + d); w.types[i] = VINES; w.colors[i] = 0x4a7a30; w.life[i] = -1; } // the hanging vine

  const vineCellsAt = () => { let n = 0; for (let d = 0; d < len; d++) if (w.types[w.idx(vx, vyTop + d)] === VINES) n++; return n; };
  const cellsBefore = vineCellsAt();

  // tick so the on-screen scan (every 8f) lifts it
  for (let f = 0; f < 18; f++) { keepAlive(); window.__game.tick(); }
  const cellsAfterLift = vineCellsAt();
  const tendril = VS.strands.find((s) => s.tendril && Math.abs((s.anchorX ?? 0) - (vx + 0.5)) < 2);
  const lifted = !!tendril;
  const nodeCount = tendril ? tendril.nodes.length : 0;

  // SWAY: shake the world; the free (bottom) node should jitter while node 0 stays pinned
  let bottomMin = Infinity, bottomMax = -Infinity, anchorDrift = 0;
  if (tendril) {
    for (let f = 0; f < 8; f++) {
      keepAlive();
      ctx.fx.screenShake = 0.06;
      window.__game.tick();
      const bn = tendril.nodes[tendril.nodes.length - 1];
      bottomMin = Math.min(bottomMin, bn.x);
      bottomMax = Math.max(bottomMax, bn.x);
      anchorDrift = Math.max(anchorDrift, Math.abs(tendril.nodes[0].x - (tendril.anchorX ?? 0)));
    }
  }
  const swayRange = tendril ? +(bottomMax - bottomMin).toFixed(2) : 0;

  // SETTLE BACK: force the tendril "far" → it repaints its original cells
  if (tendril) tendril.anchorX = camX + 99999;
  for (let f = 0; f < 2; f++) { keepAlive(); window.__game.tick(); }
  const stillLifted = VS.strands.some((s) => s.tendril && (s.originCells ?? []).includes(w.idx(vx, vyTop)));
  const cellsAfterSettle = vineCellsAt();

  return { cellsBefore, cellsAfterLift, lifted, nodeCount, swayRange, anchorDrift: +anchorDrift.toFixed(2), stillLifted, cellsAfterSettle };
});

console.log('  ' + JSON.stringify(r));
check('hanging vine starts as cells', r.cellsBefore >= 5, JSON.stringify(r));
check('it is LIFTED into a soft strand near the camera', r.lifted && r.nodeCount >= 5, JSON.stringify(r));
check('its cells are cleared while lifted (strand holds them)', r.cellsAfterLift === 0, JSON.stringify(r));
check('the world shaking SWAYS the free end', r.swayRange > 0.3, JSON.stringify(r));
check('the top stays pinned to its anchor while swaying', r.anchorDrift < 1.2, JSON.stringify(r));
check('it SETTLES back to its original cells when far', !r.stillLifted && r.cellsAfterSettle >= 5, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nvine-lift probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
