// Findability audit: every level on every seed must place its locks AND keep
// them reachable from spawn. Runs the shared src/world/validate.ts module
// inside the live game. Usage:
//   node scripts/verify-findability.mjs [url] [seedCsv] [depthCsv]
// Defaults: http://localhost:5173/  seeds 1,5,1337,42, every door (d1 d2 d2b d3 d3b d4)
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,5,1337,42').split(',').map(Number);
const DEPTHS = (process.argv[4] ?? 'd1,d2,d2b,d3,d3b,d4').split(','); // every door of the four floors

const browser = await launchBrowser({ headless: true });
let failures = 0;
let missingWaveE = 0;
let totalPrefabs = 0;
let missingPrefabs = 0;
let missingMachines = 0;
let missingOpeningLandmarks = 0;

async function auditSeed(seed) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__game?.ctx, { timeout: 15000 });
      await page.waitForTimeout(2000);
      await startConsoleTestRun(page, { seed, settleMs: 350 });

      const results = await page.evaluate(
        async ({ IDS, seed }) => {
          const ctx = window.__game.ctx;
          const { validateFindability } = await import('/src/world/validate.ts');

          // Everything here is measured in SIM STEPS, never the wall clock. The
          // level keeps simulating while it is audited, and powder seams drain
          // for minutes after entry (a falling curtain can cross a route for a
          // second or two). The old wall-clock wait audited at whatever step
          // the machine had reached: ~3,800 steps on a desktop, ~840 on a
          // GPU-less CI runner, where d3b seed 5 was mid-pour (run 37224329533).
          // The game's settled checks are step-scheduled too (Levels), so every
          // machine now audits the same moments of the same settling.
          //
          // 40 s in: after the entry checks (12 s) AND the game's late checks at 18, 26 and 36 s. Before that a
          // seam can still be pouring over a route the late checks keep reopening (seed 3 d4: two braziers
          // buried from ~13 s to ~36 s in real time), which no single moment of the pour can judge.
          const AUDIT_FROM_STEP = 2400;
          const AUDIT_WINDOW_STEPS = 600; // 10 s of sim
          const AUDIT_EVERY_STEPS = 60;
          const stepOf = (rt) => rt.world.activity.stepSerial;
          const driveTo = async (rt, target) => {
            // Exact tick counts in manual time (a frame runs up to 60 queued ticks): the same simulation, just
            // not throttled by the renderer, and stopped exactly where the audit wants it.
            const deadline = performance.now() + 180000;
            while (stepOf(rt) < target) {
              if (performance.now() > deadline) throw new Error(`${rt.def.id}: sim stuck at step ${stepOf(rt)} (wanted ${target})`);
              if (ctx.time.queuedTicks === 0) ctx.time.queueTicks(Math.min(60, target - stepOf(rt)));
              await new Promise((r) => setTimeout(r, 5));
            }
          };
          const errorsOf = (issues) => issues.filter((i) => i.severity === 'error').map((i) => `${i.what}@${i.x},${i.y}`);
          const waitForSettledFindability = async (rt, startStep) => {
            ctx.time.setManual(true);
            try {
              const deadline = performance.now() + 180000;
              while (!ctx.levels.findabilityReady) {
                if (performance.now() > deadline) throw new Error(`Route repair did not finish for ${rt.def.id}`);
                await driveTo(rt, stepOf(rt) + 60);
              }
              // A route is unreachable when it stays shut for the whole window: a curtain of falling grains
              // crosses and goes, a heap does not (and the game's late checks repair heaps inside it).
              const from = Math.max(stepOf(rt), startStep + AUDIT_FROM_STEP);
              let persistent = null;
              let last = [];
              for (let at = from; at <= from + AUDIT_WINDOW_STEPS; at += AUDIT_EVERY_STEPS) {
                await driveTo(rt, at);
                last = validateFindability(rt);
                const now = new Set(errorsOf(last));
                persistent = persistent === null ? now : new Set([...persistent].filter((e) => now.has(e)));
              }
              return last.filter((i) => i.severity !== 'error' || persistent.has(`${i.what}@${i.x},${i.y}`));
            } finally {
              ctx.time.setManual(false);
            }
          };

          const out = [];
          for (const id of IDS) {
            if (id !== 'd1') {
              const started = await ctx.console.exec(`run test --level ${id} --world campaign-level --seed ${seed} --loadout fresh`);
              if (!started.ok) throw new Error(started.text ?? JSON.stringify(started));
            }
            const rt = ctx.levels.current;
            if (rt?.def.id !== id) throw new Error(`Expected ${id}, received ${rt?.def.id}`);
            // Each level is a fresh World whose step counter starts at 0 on entry (d1 was entered by the
            // console run above, a few real-time ticks ago; its window is still counted from entry).
            const entryStep = id === 'd1' ? 0 : stepOf(rt);
            const all = await waitForSettledFindability(rt, entryStep);
            const issues = all
              .filter((i) => i.severity === 'error')
              .map((i) => `${i.what}@${i.x},${i.y}`);
            const buried = all
              .filter((i) => i.severity === 'info')
              .map((i) => `${i.what}@${i.x},${i.y}`);
            // 'sensor' joined the lock roster with the Freeze Bridge (archetype 4)
            const sensors = rt.mechanisms.filter((m) =>
              ['scale', 'buoy', 'chargelatch', 'sensor'].includes(m.kind),
            ).length;
            const braziersByDoor = {};
            for (const m of rt.mechanisms) {
              if (m.kind === 'brazier') braziersByDoor[m.targetId] = (braziersByDoor[m.targetId] ?? 0) + 1;
            }
            const waveE =
              rt.def.depth < 2 ||
              sensors > 0 ||
              Object.values(braziersByDoor).some((n) => n >= 3);
            const placedPrefabs = rt.placedPrefabs ?? [];
            const machines = rt.living ? rt.mechanisms.filter(m => m.kind === 'valve').length : placedPrefabs.filter((p) => String(p.id ?? '').startsWith('machine-')).length;
            const surfaceConflicts =
              rt.def.id === 'd1' && Number.isFinite(rt.surfaceSkyLine)
                ? placedPrefabs.filter((p) => p.y0 <= rt.surfaceSkyLine + 44).map((p) => `${p.id}@${p.x0},${p.y0}`)
                : [];
            const openingLandmarks = id !== 'd1' || (!!rt.living && !!rt.refuge &&
              placedPrefabs.some(p => p.id === 'works-bell-tea-engine') &&
              placedPrefabs.filter(p => p.id !== 'works-bell-tea-engine').length === 8 &&
              rt.mechanisms.some(m => m.id === 8201) && rt.pickups.some(p => p.kind === 'key'));
            out.push({ id, waveE, openingLandmarks, issues, buried, prefabs: placedPrefabs.length, machines, surfaceConflicts });
          }
          return out;
        },
        { IDS: DEPTHS, seed },
      );
      await context.close();
      return { results, pageErrors };
    } catch (error) {
      lastError = error;
      await context.close().catch(() => undefined);
      if (attempt < 2) console.warn(`seed=${seed} audit page reloaded; retrying`);
    }
  }
  throw lastError;
}

for (const seed of seeds) {
  const { results, pageErrors } = await auditSeed(seed);
  for (const err of pageErrors) {
    console.error('PAGE ERROR:', err);
    failures++;
  }

  for (const lv of results) {
    const bad = lv.issues.length > 0 || !lv.waveE || !lv.openingLandmarks || lv.surfaceConflicts.length > 0;
    if (lv.issues.length) failures++;
    if (lv.surfaceConflicts.length) failures++;
    if (!lv.waveE) missingWaveE++;
    if (!lv.openingLandmarks) missingOpeningLandmarks++;
    if (lv.prefabs <= 0) missingPrefabs++;
    if (lv.machines <= 0) missingMachines++;
    totalPrefabs += lv.prefabs;
    console.log(
      `${bad || lv.prefabs <= 0 || lv.machines <= 0 ? 'FAIL' : ' ok '} seed=${seed} ${lv.id} prefabs=${lv.prefabs} machines=${lv.machines}` +
        (lv.waveE ? '' : ' [NO WAVE-E LOCK]') +
        (lv.openingLandmarks ? '' : ' [MISSING OPENING LANDMARK]') +
        (lv.prefabs <= 0 ? ' [NO PREFAB]' : '') +
        (lv.machines <= 0 ? ' [NO MACHINE]' : '') +
        (lv.surfaceConflicts.length ? ' surface-conflict: ' + lv.surfaceConflicts.join(' ') : '') +
        (lv.issues.length ? ' unreachable: ' + lv.issues.join(' ') : ''),
    );
  }
}

await browser.close();
// Statistical floor: slots are optional per level, but a run where NOTHING
// placed anywhere means the prefab pass is broken, not unlucky.
if (totalPrefabs === 0) {
  failures++;
  console.error('PREFAB FLOOR FAILED: 0 prefabs placed across the entire run');
}
console.log(
  failures + missingWaveE + missingPrefabs + missingMachines + missingOpeningLandmarks === 0
    ? `\nFINDABILITY OK: ${seeds.length} seeds x ${DEPTHS.length} depths clean, ${totalPrefabs} prefabs placed`
    : `\nFINDABILITY FAILED: ${failures} reachability failures, ${missingWaveE} missing locks, ${missingOpeningLandmarks} missing opening landmarks, ${missingPrefabs} missing prefabs, ${missingMachines} missing machines`,
);
process.exit(failures + missingWaveE + missingPrefabs + missingMachines + missingOpeningLandmarks === 0 ? 0 : 1);
