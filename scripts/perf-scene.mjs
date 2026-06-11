// Repeatable worst-case perf scene + autosave hitch benchmark.
// Usage: node scripts/perf-scene.mjs <label> [url] [runs] [frames]
// Writes verify-out/perf-<label>.json. If verify-out/perf-before.json exists
// and label !== "before", prints a Welch t-test comparison per bucket.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const label = process.argv[2] ?? 'before';
const url = process.argv[3] ?? 'http://localhost:5173/';
const RUNS = Number(process.argv[4] ?? 3);
const FRAMES = Number(process.argv[5] ?? 700);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const all = { sim: [], entities: [], render: [], frame: [], autosaveMs: [] };

for (let run = 0; run < RUNS; run++) {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(
    async ({ FRAMES }) => {
      localStorage.removeItem('noita-expedition');
      const ctx = window.__game.ctx;
      ctx.state.worldSeed = 777; // same world every run
      document.getElementById('mode-play-btn').click();
      await new Promise((r) => setTimeout(r, 1500));

      const w = ctx.world;
      const px = Math.floor(ctx.player.x);
      const py = Math.floor(ctx.player.y);
      ctx.player.hp = 999999;
      ctx.player.maxHp = 999999;
      ctx.player.invuln = 999999;

      // ---- CHAOS SCENE (fixed layout relative to spawn) ----
      // big cavity so everything interacts on screen
      for (let dx = -120; dx <= 120; dx++) {
        for (let dy = -70; dy <= 20; dy++) {
          const X = px + dx,
            Y = py + dy;
          if (!w.inBounds(X, Y)) continue;
          const i = w.idx(X, Y);
          const edge = Math.abs(dx) === 120 || dy === 20 || dy === -70;
          if (edge) {
            w.types[i] = 13;
            w.colors[i] = 0x606870;
          } else if (w.types[i] !== 0) {
            w.types[i] = 0;
            w.colors[i] = 0x08080c;
          }
        }
      }
      // floor
      for (let dx = -119; dx <= 119; dx++) {
        const i = w.idx(px + dx, py + 19);
        w.types[i] = 12;
      }
      // water slab (left), lava slab (right) -> permanent steam front
      for (let dx = -110; dx <= -40; dx++)
        for (let dy = -60; dy <= -40; dy++) {
          const i = w.idx(px + dx, py + dy);
          w.types[i] = 2;
          w.colors[i] = 0x1e8ce6;
        }
      for (let dx = 40; dx <= 110; dx++)
        for (let dy = -60; dy <= -40; dy++) {
          const i = w.idx(px + dx, py + dy);
          w.types[i] = 11;
          w.colors[i] = 0xfc3c08;
        }
      // oil pond + sand columns mid-air
      for (let dx = -30; dx <= 30; dx++)
        for (let dy = 10; dy <= 16; dy++) {
          const i = w.idx(px + dx, py + dy);
          w.types[i] = 6;
          w.colors[i] = 0x55401e;
        }
      for (const cx of [-70, 0, 70])
        for (let dy = -35; dy <= -20; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const i = w.idx(px + cx + dx, py + dy);
            w.types[i] = 1;
            w.colors[i] = 0xd2b45e;
          }
      // ignite the oil
      for (let dx = -3; dx <= 3; dx++) {
        const i = w.idx(px + dx, py + 9);
        w.types[i] = 5;
        w.life[i] = 90;
      }
      // hostile crowd
      const roster = [
        ['slime', -80], ['slime', -60], ['slime', 60], ['slime', 80],
        ['imp', -50], ['imp', 50], ['imp', 90],
        ['golem', -90], ['golem', 95],
        ['bat', -30], ['bat', 30], ['bat', 0],
        ['spitter', -100], ['spitter', 100],
      ];
      for (const [kind, dx] of roster) ctx.enemyCtl.spawn(kind, px + dx, py + 10);

      // scripted explosions during recording keep particle pressure high
      const offsets = [-90, -45, 0, 45, 90];
      let bomb = 0;
      const bomber = setInterval(() => {
        ctx.explosions.trigger(px + offsets[bomb % offsets.length], py - 10 - (bomb % 3) * 12, 11);
        bomb++;
      }, 700);

      await new Promise((r) => setTimeout(r, 1500)); // warm-up / JIT

      window.__perfSamples = [];
      window.__perfRecord = true;
      await new Promise((resolve) => {
        const check = () => {
          if ((window.__perfSamples?.length ?? 0) >= FRAMES) resolve();
          else setTimeout(check, 200);
        };
        check();
      });
      window.__perfRecord = false;
      clearInterval(bomber);
      const samples = window.__perfSamples;

      // ---- AUTOSAVE HITCH: visit 5 levels, then time saveExpedition ----
      for (const id of ['d2', 'd3', 'd4', 'd5']) {
        ctx.levels.leaveLevel();
        ctx.levels.enterLevel(ctx, id);
        await new Promise((r) => setTimeout(r, 250));
      }
      const saves = [];
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now();
        ctx.levels.saveExpedition(ctx);
        saves.push(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 120));
      }
      return { samples, saves, particles: ctx.particles.list?.length ?? -1 };
    },
    { FRAMES },
  );

  for (const s of result.samples) {
    all.sim.push(s.sim);
    all.entities.push(s.entities);
    all.render.push(s.render);
    all.frame.push(s.frame);
  }
  all.autosaveMs.push(...result.saves);
  console.log(
    `run ${run + 1}/${RUNS}: ${result.samples.length} frames, autosave [${result.saves
      .map((v) => v.toFixed(1))
      .join(', ')}]ms`,
  );
  await page.context().close();
}
await browser.close();

const stats = (arr) => {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    n,
    mean,
    sd,
    p50: sorted[Math.floor(n * 0.5)],
    p95: sorted[Math.floor(n * 0.95)],
    max: sorted[n - 1],
  };
};

const summary = {};
for (const k of ['sim', 'entities', 'render', 'frame', 'autosaveMs']) summary[k] = stats(all[k]);

mkdirSync('verify-out', { recursive: true });
writeFileSync(`verify-out/perf-${label}.json`, JSON.stringify({ label, summary, raw: all }));

console.log(`\n=== ${label.toUpperCase()} ===`);
for (const k of ['sim', 'entities', 'render', 'frame', 'autosaveMs']) {
  const s = summary[k];
  console.log(
    `${k.padEnd(10)} mean ${s.mean.toFixed(3)}ms  sd ${s.sd.toFixed(3)}  p50 ${s.p50.toFixed(
      3,
    )}  p95 ${s.p95.toFixed(3)}  max ${s.max.toFixed(1)}  n=${s.n}`,
  );
}

if (label !== 'before' && existsSync('verify-out/perf-before.json')) {
  const before = JSON.parse(readFileSync('verify-out/perf-before.json', 'utf8'));
  console.log('\n=== WELCH T-TEST vs BEFORE (negative t = faster now) ===');
  for (const k of ['sim', 'entities', 'render', 'frame', 'autosaveMs']) {
    const a = before.raw[k];
    const b = all[k];
    const sa = stats(a),
      sb = stats(b);
    const t =
      (sb.mean - sa.mean) / Math.sqrt((sa.sd * sa.sd) / sa.n + (sb.sd * sb.sd) / sb.n);
    const pct = ((sb.mean - sa.mean) / sa.mean) * 100;
    const sig = Math.abs(t) > 3.29 ? 'p<0.001 SIGNIFICANT' : Math.abs(t) > 1.96 ? 'p<0.05' : 'ns';
    console.log(
      `${k.padEnd(10)} ${sa.mean.toFixed(3)} -> ${sb.mean.toFixed(3)}ms  (${pct >= 0 ? '+' : ''}${pct.toFixed(
        1,
      )}%)  t=${t.toFixed(1)}  ${sig}`,
    );
  }
}
