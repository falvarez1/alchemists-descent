// Creature pipeline cost: rig step + raster draw per kind, measured in-page
// on the real modules (dev server). Usage: node scripts/bench-creatures.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(url);
  await waitForConsoleApi(page);
  const res = await page.evaluate(async () => {
    const { World } = await import('/src/sim/World.ts');
    const { Cell } = await import('/src/sim/CellType.ts');
    const { drawCreatureSprite } = await import('/src/render/sprites/CreatureArt.ts');
    const { createDefaultStatus } = await import('/src/entities/status.ts');
    const { ensureCreatureMind } = await import('/src/creatures/perception.ts');
    const { tickCreaturePose } = await import('/src/creatures/pose.ts');
    const { ENEMY_DEFS } = await import('/src/content/enemyDefs.ts');
    const { tickWeaverLocomotion } = await import('/src/entities/weaverLocomotion.ts');
    const source = window.__game.ctx;
    const world = new World(300, 160);
    for (let y = 131; y < 160; y++) for (let x = 0; x < 300; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x444444);
    const ctx = { ...source, world, state: { ...source.state, frameCount: 0, mode: 'play' }, player: { ...source.player, x: 250, y: 124 } };
    let sink = 0;
    const surf = { pixelStep: 0.5, setFinePx(x, y, r) { sink += r; }, addFinePx(x, y, r) { sink += r; }, blendFinePx(x, y, r) { sink += r; }, setPx() {}, addPx() {} };
    const field = { sample: () => ({ r: 1, g: 1, b: 1 }) };
    const out = {};
    for (const kind of Object.keys(ENEMY_DEFS)) {
      const def = ENEMY_DEFS[kind];
      const e = { kind, x: 150, y: 130, fx: 0, fy: 0, vx: 0.4, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0, timer: 0, attackCd: 80, bobPhase: .4,
        grounded: true, stride: 0, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0, status: createDefaultStatus() };
      ensureCreatureMind(e, 7);
      let tStep = 0, tDraw = 0;
      const N = 240;
      for (let t = 0; t < N; t++) {
        ctx.state.frameCount = t;
        e.fx += 0.4; if (e.fx >= 1) { e.x = 150 + ((e.x - 149) % 20); e.fx -= 1; }
        const a = performance.now();
        if (kind === 'weaver') tickWeaverLocomotion(ctx, e, def, { move: 'toward', tx: 250, ty: 120, urgency: .5, stance: 'normal', speedScale: 1 });
        tickCreaturePose(ctx, e);
        const b = performance.now();
        drawCreatureSprite(surf, field, ctx, e);
        const c = performance.now();
        if (t > 40) { tStep += b - a; tDraw += c - b; }
      }
      out[kind] = { stepMs: +(tStep / (N - 41)).toFixed(3), drawMs: +(tDraw / (N - 41)).toFixed(3) };
    }
    return { out, sink };
  });
  console.table(res.out);
} finally { await browser.close(); }
