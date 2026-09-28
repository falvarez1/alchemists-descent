// Pell's camps are dry ground: on every generated floor and the hand-built
// Bellows, no liquid sits above the camp's floor once the world has settled
// around it (world/storySites keeps camps off liquid basins; Levels.drainCamp
// is the fail-open backstop). The player is parked at the camp so the sim
// actually runs there (a region outside the sim window is frozen), then the
// camp is read after SETTLE_STEPS material steps.
// Usage: node scripts/verify-camps-dry.mjs [url] [seedCsv] [levelCsv] [shotDir]
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,2,3,5,7,42,1337').split(',').map(Number);
const levels = (process.argv[4] ?? 'd1,d2,d2b,d3,d3b,d4').split(',');
const shotDir = process.argv[5] ?? null;
const SETTLE_STEPS = 420;

const browser = await launchBrowser({ headless: true });
let failures = 0;
let checked = 0;
try {
  for (const seed of seeds) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await startConsoleTestRun(page, { seed, settleMs: 100 });
      for (const id of levels) {
        const res = await page.evaluate(async ({ id, seed, SETTLE_STEPS }) => {
          const ctx = window.__game.ctx;
          if (id !== 'd1' || ctx.levels.current?.def.id !== 'd1') {
            const started = await ctx.console.exec(`run test --level ${id} --world campaign-level --seed ${seed} --loadout fresh`);
            if (!started.ok) throw new Error(started.text ?? JSON.stringify(started));
          }
          const rt = ctx.levels.current;
          const camp = rt.story?.camp;
          if (!camp) return { id, camp: null };
          ctx.state.debugGodMode = true;
          // Park beside the camp so the sim runs there, and let the world settle.
          Object.assign(ctx.player, { x: camp.x + 20, y: camp.floorY - 1, vx: 0, vy: 0 });
          ctx.camera.snapTo(camp.x, camp.floorY - 10);
          const start = rt.world.activity.stepSerial;
          const deadline = performance.now() + 40000;
          while (rt.world.activity.stepSerial - start < SETTLE_STEPS && performance.now() < deadline) {
            if (ctx.state.paused) ctx.state.paused = false; // a pickup's card offer must not stall the settle
            await new Promise((r) => setTimeout(r, 100));
          }
          const { isLiquid } = await import('/src/sim/CellType.ts');
          const w = rt.world;
          let liquid = 0;
          for (let x = camp.x0; x <= camp.x1; x++) for (let y = camp.floorY - 30; y <= camp.floorY; y++) if (isLiquid(w.types[w.idx(x, y)])) liquid++;
          return { id, camp: { x: camp.x, floorY: camp.floorY }, liquid, steps: rt.world.activity.stepSerial - start };
        }, { id, seed, SETTLE_STEPS });
        if (!res.camp) { console.log(`  -   seed=${seed} ${id}: no camp`); continue; }
        checked++;
        const ok = res.liquid === 0;
        if (!ok) failures++;
        console.log(`${ok ? ' ok ' : 'FAIL'} seed=${seed} ${id}: camp ${res.camp.x},${res.camp.floorY} liquid above the floor ${res.liquid} (${res.steps} steps)`);
        if (shotDir && (!ok || seed === seeds[0])) await page.screenshot({ path: `${shotDir}/camp-${id}-${seed}.png` });
      }
      for (const e of errors) { console.error('PAGE ERROR:', e); failures++; }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? `\nCAMPS DRY: ${checked} camps, no liquid above a camp floor` : `\nCAMPS WET: ${failures} failure(s) over ${checked} camps`);
process.exit(failures === 0 ? 0 : 1);
