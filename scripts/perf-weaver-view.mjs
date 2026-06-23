// Focused Weaver performance benchmark: compares a quiet scene against visible
// Weaver crowds and writes per-bucket frame timing summaries.
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
import {
  addSampleBuckets,
  currentCommandLine,
  currentGitState,
  emptyBuckets,
  printBucketSummary,
  sanitizeLabel,
  summarizeBuckets,
  writeJson,
} from './perf-harness.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const frames = Number(process.argv[3] || 360);
const counts = (process.argv[4] || '0,4,8,12')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 0);

if (counts.length === 0) throw new Error('Provide at least one Weaver count.');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 500 });

  const payload = {
    command: currentCommandLine(),
    git: currentGitState(),
    url,
    frames,
    counts,
    scenarios: {},
    pageErrors,
    consoleErrors,
  };

  for (const count of counts) {
    const raw = emptyBuckets();
    const setup = await page.evaluate(
      async ({ count, frames }) => {
        const ctx = window.__game.ctx;
        const world = ctx.world;
        const STONE = 12;
        const cx = 600;
        const floorY = 610;
        ctx.enemies.length = 0;
        ctx.projectiles.length = 0;
        ctx.shockwaves.length = 0;
        ctx.particles.clear();
        ctx.player.x = cx + 160;
        ctx.player.y = floorY - 1;
        ctx.player.vx = 0;
        ctx.player.vy = 0;
        ctx.player.hp = 999999;
        ctx.player.maxHp = 999999;
        ctx.camera.zoomLock = 1;
        ctx.camera.snapTo(cx, floorY - 44);
        ctx.params.global.ambientLight = Math.max(ctx.params.global.ambientLight, 0.5);
        ctx.params.global.maxBrightness = Math.max(ctx.params.global.maxBrightness, 2.2);

        for (let y = floorY - 160; y <= floorY + 24; y++) {
          for (let x = cx - 260; x <= cx + 260; x++) {
            if (!world.inBounds(x, y)) continue;
            const i = world.idx(x, y);
            world.types[i] = 0;
            world.colors[i] = 0x08080c;
            world.life[i] = 0;
            world.charge[i] = 0;
          }
        }
        for (let y = floorY; y <= floorY + 8; y++) {
          for (let x = cx - 260; x <= cx + 260; x++) {
            if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
          }
        }

        for (let i = 0; i < count; i++) {
          const x = cx - 190 + i * 34;
          ctx.enemyCtl.spawn('weaver', x, floorY - 1);
          const e = ctx.enemies[ctx.enemies.length - 1];
          e.x = x;
          e.y = floorY - 1;
          e.vx = 0;
          e.vy = 0;
          e.fx = 0;
          e.fy = 0;
          e.sleeping = false;
          e.alerted = true;
          e.cranky = 600;
          e.attackCd = 9999;
          e.windup = 0;
          e.blink = 0;
          e.webPulse = 18;
        }

        await new Promise((resolve) => setTimeout(resolve, 1200));
        window.__perfSamples = [];
        window.__perfRecord = true;
        await new Promise((resolve) => {
          const tick = () => {
            if ((window.__perfSamples?.length ?? 0) >= frames) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        window.__perfRecord = false;
        return {
          count,
          enemies: ctx.enemies.length,
          samples: window.__perfSamples,
          frameCount: ctx.state.frameCount,
        };
      },
      { count, frames },
    );
    addSampleBuckets(raw, setup.samples);
    const summary = summarizeBuckets(raw);
    payload.scenarios[`weavers-${count}`] = { setup: { ...setup, samples: setup.samples.length }, summary };
    printBucketSummary(`weavers-${count}`, summary, ['entities', 'compose', 'render', 'frame']);
  }

  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }

  const out = `verify-out/perf-weaver-view-${sanitizeLabel(counts.join('-'))}-${Date.now()}.json`;
  writeJson(out, payload);
  console.log(`Wrote ${out}`);
} finally {
  await browser.close();
}
