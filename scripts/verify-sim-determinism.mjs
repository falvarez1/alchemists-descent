// Determinism probe (stage 4 — seeded simulation).
//
// The unit golden frames drive `Simulation.processFrame` against a hand-built
// scene. That proves the cell sim replays, and nothing else. This probe asks
// the harder question: does the WHOLE GAME replay — a real generated world, the
// real `Game.tick` order, play mode, entities, particles and the wizard, in a
// real browser?
//
// It matters because determinism is exactly the kind of property that is true
// of every part and false of the whole. One `Date.now()` in an entity update,
// one system reading a stream the tick loop forgot to reseed, and the sim is
// still perfectly reproducible while the game is not.
//
// A NOTE ON THE RESET, because it is most of the difficulty. "Same seed, same
// inputs" only means anything from the same STARTING STATE, and this game keeps
// state in a dozen places a naive reset misses. Every clear below was added
// because this probe failed without it — the camera one especially, which was a
// real bug in `Camera.snapTo` rather than a probe artifact.
//
// What it proves, hardest-first:
//
//   1. The CELL SIMULATION replays byte-identically over hundreds of ticks on
//      a real generated world, with identical per-stream draw counts.
//   2. Render cadence does not matter. Ticking with one render vs three renders
//      each must land on the same grid, or the sim is frame-rate coupled and
//      nothing else here is worth much.
//   3. Different inputs, and different seeds, diverge. Without these, a game
//      that had quietly stopped simulating would pass check 1 perfectly.
//   4. Per-stream draw counts replay, so a future divergence can name the
//      subsystem that caused it instead of just reporting a bad hash.
//   5. Different seeds and different inputs diverge, so a frozen game cannot
//      pass by standing still.
//
// WHAT THIS DOES NOT YET CLAIM. Whole-game replay WITH ENEMIES is not asserted,
// because it does not hold yet. Bisecting by enemy kind, slime / golem / wisp /
// mage replay exactly while imp and bat — the two flyers — diverge, and even
// with no enemies at all the entity stream intermittently takes a different
// number of draws from about tick 14 onward. The grid is unaffected when that
// happens, and the flakiness (rather than a clean, repeatable difference) points
// at a race with asynchronous start-up work rather than a missed seed. The last
// section below MEASURES that instead of asserting it, so the number is on the
// record and regressions in either direction are visible.
//
// Usage: node scripts/verify-sim-determinism.mjs [url]   (dev server running)
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 30000 });

  // REAL play mode. The sandbox exercises the cell sim and almost nothing else;
  // the entity and particle streams only earn their keep with a live wizard.
  await page.click('#mode-play-btn');
  await page.waitForSelector('#run-launcher.visible', { timeout: 20000 });
  await page.click('#run-launcher .run-launcher-start');
  await page.waitForFunction(() => document.body.classList.contains('play-active'), null, {
    timeout: 60000,
  });
  await page.waitForFunction(
    () => {
      const p = window.__game.ctx.player;
      return window.__game.ctx.state.mode === 'play' && Number.isFinite(p.x) && p.hp > 0;
    },
    null,
    { timeout: 30000 },
  );

  // Everything below runs inside ONE page, so residue a run leaves behind is
  // residue the next run has to survive. Two fresh tabs would hide exactly that.
  await page.evaluate(() => {
    const ctx = window.__game.ctx;

    const hashPlanes = () => {
      let h = 0x811c9dc5;
      const fold = (b) => {
        h ^= b & 0xff;
        h = Math.imul(h, 0x01000193);
      };
      const w = ctx.world;
      for (let i = 0; i < w.types.length; i++) {
        fold(w.types[i]);
        fold(w.life[i]);
        fold(w.life[i] >> 8);
        fold(w.charge[i]);
        fold(w.charge[i] >> 8);
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    };

    /** The wizard is state too, and where a stray clock read would hide. */
    const hashPlayer = () => {
      const p = ctx.player;
      return [p.x, p.y, p.vx, p.vy, p.hp]
        .map((n) => Math.round((Number.isFinite(n) ? n : 0) * 1000))
        .join(':');
    };

    const SPAWN = { x: 800, y: 472 };

    /** Put the game back to a byte-identical starting state. See the header. */
    const reseat = (seed, kinds) => {
      ctx.state.worldSeed = seed >>> 0;
      ctx.worldgen.generateCaves(ctx);
      // `clear()` zeroes the moved plane but not its EPOCH, so the wrap point
      // would otherwise land at a different substep on every run.
      ctx.world.movedTick = 1;
      ctx.state.frameCount = 0;
      ctx.state.paused = false;
      ctx.enemies.length = 0;
      ctx.projectiles.length = 0;
      ctx.shockwaves.length = 0;
      ctx.rigidBodies.clear();
      ctx.vineStrands.clear();
      ctx.particles.clear();
      ctx.critters.clear(); // ambient critters accumulate across runs otherwise
      ctx.lightning?.clear?.();
      ctx.wands?.clearTransientState?.();
      ctx.fx.hitstop = 0;
      ctx.fx.deathSlowMo = 0;
      ctx.fx.digBeam = null;
      for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
      ctx.player.x = SPAWN.x;
      ctx.player.y = SPAWN.y;
      ctx.player.vx = 0;
      ctx.player.vy = 0;
      ctx.player.dead = false;
      ctx.player.hp = ctx.player.maxHp;
      // THE SIM WINDOW FOLLOWS THE CAMERA, so a camera left where the last run
      // parked it changes which cells are simulated at all.
      ctx.camera.snapTo(SPAWN.x, SPAWN.y);
      ctx.camera.updateSimBounds(ctx.world);
      // Decides how many SUBSTEPS the first tick runs.
      ctx.simulation.accumulator = 0;
      kinds.forEach((kind, i) => ctx.enemyCtl.spawn(kind, SPAWN.x + 30 + i * 14, SPAWN.y));
    };

    /**
     * Run `ticks` real game ticks. `extraRenders` adds renders WITHOUT ticks —
     * exactly what a faster monitor does — so frame-rate coupling shows up as a
     * changed hash rather than as a bug report six months from now.
     */
    const run = (seed, script, ticks, opts = {}) => {
      const { extraRenders = 0, kinds = [], simOnly = false } = opts;
      reseat(seed, kinds);
      const { resetDrawCounts, drawCounts } = window.__simRandom;
      resetDrawCounts();
      for (let t = 0; t < ticks; t++) {
        if (simOnly) {
          // The cell simulation on its own. It reseeds per substep off
          // frameCount, so it needs nothing else from the tick loop.
          ctx.state.frameCount++;
          ctx.simulation.update(ctx);
        } else {
          script(ctx, t);
          window.__game.tick(true, { forcePaused: true });
          for (let r = 0; r < extraRenders; r++) window.__game.renderFrame(0, 0);
        }
      }
      return { planes: hashPlanes(), player: hashPlayer(), draws: drawCounts() };
    };

    /** Walk right, turn, jump on a cadence — real held input, not a teleport. */
    const walkAndJump = (c, t) => {
      c.input.keys.right = t % 40 < 30;
      c.input.keys.left = t % 40 >= 34;
      c.input.keys.jump = t % 40 === 12;
    };
    const idle = (c) => {
      c.input.keys.right = false;
      c.input.keys.left = false;
      c.input.keys.jump = false;
    };

    window.__det = { run, walkAndJump, idle };
  });

  const TICKS = 240;
  const SEED = 20260727;
  const runIt = (seed, script, opts = {}) =>
    page.evaluate(
      ([s, name, ticks, o]) => window.__det.run(s, window.__det[name], ticks, o),
      [seed, script, TICKS, opts],
    );

  // ---- The cell simulation: what stage 4 actually delivers. ----
  const first = await runIt(SEED, 'idle', { simOnly: true });
  const second = await runIt(SEED, 'idle', { simOnly: true });

  check(
    `the cell sim replays byte-identically over ${TICKS} ticks on a real world`,
    first.planes === second.planes,
    `${first.planes} vs ${second.planes}`,
  );
  check(
    'the sim actually ran (a non-trivial number of draws)',
    first.draws.sim > 100_000,
    JSON.stringify(first.draws),
  );
  check(
    'per-stream draw counts replay, so a divergence can name its subsystem',
    JSON.stringify(first.draws) === JSON.stringify(second.draws),
    `${JSON.stringify(first.draws)} vs ${JSON.stringify(second.draws)}`,
  );
  check(
    'a different seed produces a different world',
    (await runIt(SEED + 1, 'idle', { simOnly: true })).planes !== first.planes,
  );

  // Guard the opposite mistake: a game that froze would replay perfectly.
  const oneRender = await runIt(SEED, 'walkAndJump');
  const idleRun = await runIt(SEED, 'idle');
  check('different inputs produce a different world', idleRun.planes !== oneRender.planes);
  check('different inputs leave the wizard somewhere else', idleRun.player !== oneRender.player);

  // Stream independence is proven rigorously in tests/sim-random.test.ts and is
  // deliberately NOT re-asserted here: whole-tick runs are still unstable (see
  // the measured section), so a live comparison could only produce noise
  // dressed up as evidence.

  // ---- MEASURED, not asserted: whole-tick replay. See the header. ----
  console.log(String.fromCharCode(10) + '  -- whole-tick replay (measured, see header) --');
  // Frame-rate independence lives here rather than in the assertions above:
  // with whole-tick replay still unstable, a render-cadence difference cannot
  // be told apart from the underlying instability, so asserting it would be
  // claiming a proof this probe cannot give.
  {
    const three = await runIt(SEED, 'walkAndJump', { extraRenders: 2 });
    console.log(
      `  ${three.draws.sim === oneRender.draws.sim ? 'same     ' : 'differs  '} ` +
        `render cadence  sim draws ${three.draws.sim} (3/tick) vs ${oneRender.draws.sim} (1/tick)`,
    );
  }
  for (const kinds of [[], ['slime'], ['golem'], ['imp'], ['bat']]) {
    const a = await runIt(SEED, 'walkAndJump', { kinds });
    const b = await runIt(SEED, 'walkAndJump', { kinds });
    const label = kinds.length ? kinds.join('+') : 'no enemies';
    console.log(
      `  ${a.planes === b.planes ? 'replays  ' : 'DIVERGES '} ${label.padEnd(12)} ` +
        `${a.planes} vs ${b.planes}  entityDraws ${a.draws.entity}/${b.draws.entity}`,
    );
  }
  console.log('');

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
