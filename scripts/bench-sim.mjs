// Cell-sim micro-benchmark under Node (Vite ssrLoadModule, same modules the game runs).
// Steps the multi-chunk golden fixture (tests/fixtures/largeSimScene.ts) at a
// screen-ish size and reports ms per substep plus the resulting state hash, so a
// bookkeeping optimisation can be timed AND proven behaviour-identical in one run.
// Usage: node scripts/bench-sim.mjs [width=800] [height=480] [ticks=160] [reps=3]
//        node --cpu-prof --cpu-prof-dir=verify-out scripts/bench-sim.mjs ...
import { createServer } from 'vite';

const [W = 800, H = 480, TICKS = 160, REPS = 3] = process.argv.slice(2).map(Number);
const server = await createServer({ logLevel: 'error', server: { hmr: false, middlewareMode: true } });
try {
  const fx = await server.ssrLoadModule('/tests/fixtures/largeSimScene.ts');
  const simRandom = await server.ssrLoadModule('/src/core/simRandom.ts');
  const { World } = await server.ssrLoadModule('/src/sim/World.ts');
  const { Simulation } = await server.ssrLoadModule('/src/sim/Simulation.ts');
  const results = [];
  for (let rep = 0; rep < REPS; rep++) {
    const world = new World(W, H);
    fx.buildLargeScene(world);
    world.simBounds.x0 = 0; world.simBounds.x1 = Math.floor(W * 0.6);
    world.simBounds.y0 = 0; world.simBounds.y1 = H;
    simRandom.reseedAllStreams(7);
    const ctx = fx.makeSimCtx(world, 7);
    const sim = new Simulation();
    const times = [];
    for (let t = 0; t < TICKS; t++) {
      ctx.state.frameCount++;
      simRandom.reseedTickStreams(7, ctx.state.frameCount);
      const t0 = performance.now();
      sim.processFrame(ctx);
      times.push(performance.now() - t0);
    }
    const steady = times.slice(20);
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    const sorted = [...steady].sort((a, b) => a - b);
    results.push({ mean, p50: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * 0.95)], hash: fx.hashSimState(world) });
  }
  const best = results.reduce((a, b) => (b.mean < a.mean ? b : a));
  for (const r of results) console.log(`  mean ${r.mean.toFixed(2)} ms  p50 ${r.p50.toFixed(2)}  p95 ${r.p95.toFixed(2)}  state ${r.hash}`);
  console.log(`bench-sim ${W}x${H} ticks=${TICKS}: best mean ${best.mean.toFixed(2)} ms/substep  state ${best.hash}`);
} finally {
  await server.close();
}
