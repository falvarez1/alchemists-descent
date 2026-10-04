// Generated encounter-lair audit: signature organic enemies must have authored
// habitat cells in the live campaign runtime, and those levels must remain
// findable after generation/entry.
// Usage: node scripts/verify-encounter-lairs.mjs [url] [seedCsv]
//
// Habitat is sampled twice, neither on the wall clock: `generated` the instant
// the level is entered (generation + the synchronous initial repair — a pure
// function of the seed), and `settled` after a FIXED number of sim steps. The
// old single sample was taken whenever the findability wait happened to finish,
// so a habitat still changing under the live sim read a different number every
// run (d2 seed 5's grove: 23 one run, 70 the next, from one identical world).
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
// 2, 3 and 7 joined the defaults after d3 seed 3 (a flora connector through
// the Rillback pool) went unseen for want of a seed that hit it.
const seeds = (process.argv[3] ?? '1,2,3,5,7,1337,42').split(',').map(Number);
// Sim steps (60 per second) the habitat must survive before `settled` is read:
// powder falls, liquids level, a resident Rillback soaks in its pool.
const SETTLE_STEPS = 360;

const CASES = [
  {
    id: 'd2',
    lair: 'encounter-lair-rootloper-grove',
    kind: 'rootloper',
    signature: ['Vines', 'Moss', 'Fungus', 'Glowshroom'],
    minCells: 45,
  },
  {
    id: 'd3',
    lair: 'encounter-lair-rillback-pool',
    kind: 'rillback',
    signature: ['Water', 'Blood', 'Slime'],
    minCells: 180,
  },
  {
    id: 'd4',
    lair: 'encounter-lair-stonemaw-seam',
    kind: 'stonemaw',
    signature: ['RawOre', 'Coal'],
    minCells: 45,
  },
];

const browser = await launchBrowser({ headless: true });
let failures = 0;

function issueCount(rows) {
  let count = 0;
  for (const row of rows) count += row.issues.length;
  return count;
}

try {
  for (const seed of seeds) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await startConsoleTestRun(page, { seed, settleMs: 100 });
      const rows = await page.evaluate(
        async ({ cases, SETTLE_STEPS }) => {
          const { Cell } = await import('/src/sim/CellType.ts');
          const { reachableMask, validateFindability, wizardMask } = await import('/src/world/validate.ts');
          const ctx = window.__game.ctx;
          const w = () => ctx.world;
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const cellId = (name) => Cell[name];
          // The level's MATERIAL, not just the grid: a hanging vine near the
          // player is lifted out of its cells into a swaying soft strand and
          // settles back when far (entities/VineStrands), so the bare grid
          // under-counts a grove by however many strands happen to be live.
          // writeSnapshotCells is the save path's own answer to that.
          const materialTypes = () => {
            const world = w();
            const types = world.types.slice();
            ctx.vineStrands?.writeSnapshotCells?.(world, types, world.life.slice());
            return types;
          };
          const countCells = (rect, names) => {
            if (!rect) return 0;
            const wanted = new Set(names.map(cellId));
            let count = 0;
            const world = w();
            const types = materialTypes();
            for (let y = rect.y0; y <= rect.y1; y++) {
              for (let x = rect.x0; x <= rect.x1; x++) {
                if (world.inBounds(x, y) && wanted.has(types[world.idx(x, y)])) count++;
              }
            }
            return count;
          };
          const enemiesInRect = (rect, kind) => {
            if (!rect) return [];
            return ctx.enemies
              .filter((e) => e.kind === kind && e.x >= rect.x0 && e.x <= rect.x1 && e.y >= rect.y0 && e.y <= rect.y1)
              .map((e) => ({
                kind: e.kind,
                x: Math.round(e.x),
                y: Math.round(e.y),
                hp: Math.round(e.hp ?? 0),
                rillWet: e.rillWet ?? 0,
                // Water around the body. A resident outside the player's sim
                // window is frozen, so its rillWet can still read the spawn
                // default while it sits in the pool; the cells cannot lie.
                bodyWater: (() => {
                  const world = w();
                  let n = 0;
                  for (let dy = -6; dy <= 1; dy++) {
                    for (let dx = -5; dx <= 5; dx++) {
                      const X = Math.round(e.x) + dx;
                      const Y = Math.round(e.y) + dy;
                      if (world.inBounds(X, Y) && world.types[world.idx(X, Y)] === cellId('Water')) n++;
                    }
                  }
                  return n;
                })(),
              }));
          };
          const near = (mask, x, y, r) => {
            const world = w();
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                const X = Math.floor(x) + dx;
                const Y = Math.floor(y) + dy;
                if (world.inBounds(X, Y) && mask[world.idx(X, Y)]) return true;
              }
            }
            return false;
          };
          const countMaskInRect = (mask, rect) => {
            if (!mask || !rect) return 0;
            const world = w();
            let count = 0;
            for (let y = rect.y0; y <= rect.y1; y++) {
              for (let x = rect.x0; x <= rect.x1; x++) {
                if (world.inBounds(x, y) && mask[world.idx(x, y)]) count++;
              }
            }
            return count;
          };
          // The sim advances only as fast as frames render, and a GPU-less CI
          // runner renders a few a second: drive it with the game's manual time
          // (up to 60 queued ticks a frame) until `done()`, then hand time back.
          // The same simulation — just not throttled by the renderer.
          // Exact tick counts (a frame runs up to 60 queued ticks): stops the sim
          // exactly where the audit wants it, on every machine.
          const driveTo = async (target, capMs = 180000) => {
            const deadline = performance.now() + capMs;
            while (w().activity.stepSerial < target) {
              if (performance.now() > deadline) throw new Error(`sim stuck at step ${w().activity.stepSerial} (wanted ${target})`);
              if (ctx.time.queuedTicks === 0) ctx.time.queueTicks(Math.min(60, target - w().activity.stepSerial));
              await sleep(5);
            }
          };
          const withManualTime = async (fn) => {
            const wasManual = ctx.time.manual;
            ctx.time.setManual(true);
            try {
              return await fn();
            } finally {
              if (ctx.time.manual !== wasManual) ctx.time.setManual(wasManual);
            }
          };

          // Findability is judged in SIM STEPS, never on the wall clock. The
          // level keeps simulating while it is audited and powder seams drain for
          // minutes after entry, so the old wall-clock wait audited a different
          // moment on every machine (seed 5 d4: a gunpowder heap plugs the boss
          // approach ~2,000 steps in; a loaded machine reached it, an idle one
          // did not). The game's settled checks are step-scheduled (Levels), so
          // every machine now audits the same window of the same settling, and
          // an error counts only if it holds for the WHOLE window: a curtain of
          // falling grains crosses a route and goes, a heap does not.
          // 40 s in: after the entry checks (12 s) AND the game's late checks at 18, 26 and 36 s. Before that a
          // seam can still be pouring over a route the late checks keep reopening (seed 3 d4: two braziers
          // buried from ~13 s to ~36 s in real time), which no single moment of the pour can judge.
          const AUDIT_FROM_STEP = 2400;
          const AUDIT_WINDOW_STEPS = 600;
          const AUDIT_EVERY_STEPS = 60;
          const issueKey = (i) => `${i.what}@${i.x},${i.y}`;
          const waitForFindability = (rt, entryStep, onSample) => withManualTime(async () => {
            const deadline = performance.now() + 180000;
            while (!ctx.levels.findabilityReady) {
              if (performance.now() > deadline) throw new Error(`Route repair did not finish for ${rt.def.id}`);
              await driveTo(w().activity.stepSerial + 60);
            }
            const from = Math.max(w().activity.stepSerial, entryStep + AUDIT_FROM_STEP);
            let persistent = null;
            let last = [];
            for (let at = from; at <= from + AUDIT_WINDOW_STEPS; at += AUDIT_EVERY_STEPS) {
              await driveTo(at);
              last = validateFindability(rt);
              const now = new Set(last.filter((i) => i.severity === 'error').map(issueKey));
              persistent = persistent === null ? now : new Set([...persistent].filter((e) => now.has(e)));
              onSample();
            }
            return last.filter((i) => i.severity !== 'error' || persistent.has(issueKey(i)));
          });

          // Wait on SIM steps, not the wall clock: a slow frame or a heavy
          // validator call must not move the moment the habitat is judged.
          const waitSteps = (from, steps) => withManualTime(async () => {
            await driveTo(from + steps);
            return w().activity.stepSerial - from;
          });

          const out = [];
          for (const c of cases) {
            if (ctx.levels.current?.def?.id !== c.id) {
              ctx.levels.leaveLevel();
              ctx.levels.enterLevel(ctx, c.id);
            }
            const rt = ctx.levels.current;
            const lair = rt?.placedPrefabs?.find((p) => p.id === c.lair) ?? null;
            const residents = enemiesInRect(lair, c.kind);
            // The generation truth, before a single sim step has run.
            const generatedCells = countCells(lair, c.signature);
            const settleFrom = w().activity.stepSerial;
            const settledSteps = await waitSteps(settleFrom, SETTLE_STEPS);
            const signatureCells = countCells(lair, c.signature);
            const metalCells = countCells(lair, ['Metal']);
            const liquidRect = lair
              ? {
                  x0: Math.max(0, lair.x0 - 4),
                  y0: Math.max(0, lair.y0 - 4),
                  x1: Math.min(w().width - 1, lair.x1 + 4),
                  y1: Math.min(w().height - 1, lair.y1 + 4),
                }
              : null;
            const nearbyLiquid = c.kind === 'rillback' ? countCells(liquidRect, ['Water', 'Blood']) : 0;
            const settledResidents = enemiesInRect(lair, c.kind);
            // Mask sampling rides the findability window: the level SIMULATES
            // while this audits, and a transient falling-debris plug along the
            // fit-path can zero the wizard mask for a moment (the d6 stonemaw
            // flake). The first sample with both masks open inside the lair is
            // kept; if none is, the last one judges.
            let cellReach = null;
            let wizardReach = null;
            let lairCellReachCells = 0;
            let lairWizardReachCells = 0;
            const sampleMasks = () => {
              if (!rt || (lairWizardReachCells > 0 && lairCellReachCells > 0)) return;
              cellReach = reachableMask(rt);
              wizardReach = wizardMask(rt);
              lairCellReachCells = countMaskInRect(cellReach, lair);
              lairWizardReachCells = countMaskInRect(wizardReach, lair);
            };
            const findability = rt ? await waitForFindability(rt, settleFrom, sampleMasks) : [];
            const residentCellReachable = !!cellReach && residents.some((e) => near(cellReach, e.x, e.y, 12));
            const residentWizardReachable = !!wizardReach && residents.some((e) => near(wizardReach, e.x, e.y, 20));
            const lairCellReachable = lairCellReachCells >= 80 || residentCellReachable;
            const lairWizardReachable = lairWizardReachCells >= 30 || residentWizardReachable;
            const findabilityErrors = findability
              .filter((issue) => issue.severity === 'error')
              .map((issue) => `${issue.what}@${issue.x},${issue.y}`);
            const issues = [];
            if (!lair) issues.push('missing lair footprint');
            if (lair && generatedCells < c.minCells) issues.push(`generated signature cells ${generatedCells}/${c.minCells}`);
            if (lair && signatureCells < c.minCells) {
              issues.push(`settled signature cells ${signatureCells}/${c.minCells} after ${settledSteps} steps`);
            }
            if (lair && metalCells > 0) issues.push(`metal cells inside footprint ${metalCells}`);
            if (lair && residents.length === 0) issues.push(`missing resident ${c.kind}`);
            if (lair && !lairCellReachable) issues.push('lair interior not cell-reachable');
            if (lair && !lairWizardReachable) issues.push('lair interior not wizard-reachable');
            if (lair && c.kind === 'rillback' && !residentCellReachable) issues.push('rillback resident not cell-reachable');
            if (lair && c.kind !== 'rillback' && !residentWizardReachable) issues.push(`${c.kind} resident not wizard-reachable`);
            if (c.kind === 'rillback' && nearbyLiquid < 120) issues.push(`rillback pool drained or absent ${nearbyLiquid}`);
            if (c.kind === 'rillback' && !settledResidents.some((e) => e.rillWet >= 0.28 || e.bodyWater >= 24)) {
              issues.push(`rillback dry after settle ${JSON.stringify(settledResidents)}`);
            }
            for (const issue of findabilityErrors) issues.push(`findability ${issue}`);
            out.push({
              id: c.id,
              kind: c.kind,
              lair,
              generatedCells,
              signatureCells,
              settledSteps,
              metalCells,
              residents,
              settledResidents,
              nearbyLiquid,
              lairCellReachable,
              lairWizardReachable,
              lairCellReachCells,
              lairWizardReachCells,
              findabilityErrors,
              issues,
            });
          }
          return out;
        },
        { cases: CASES, SETTLE_STEPS },
      );

      for (const err of pageErrors) {
        failures++;
        console.error(`PAGE ERROR seed=${seed}: ${err}`);
      }
      for (const err of consoleErrors) {
        failures++;
        console.error(`CONSOLE ERROR seed=${seed}: ${err}`);
      }

      failures += issueCount(rows);
      for (const row of rows) {
        const ok = row.issues.length === 0;
        console.log(
          `${ok ? ' ok ' : 'FAIL'} seed=${seed} ${row.id} ${row.kind} cells=${row.generatedCells}/${row.signatureCells}@${row.settledSteps} metal=${row.metalCells} residents=${row.residents.length}` +
            (row.nearbyLiquid ? ` liquid=${row.nearbyLiquid}` : '') +
            ` reach=${row.lairCellReachCells}/${row.lairWizardReachCells}` +
            (row.issues.length ? ` issues=${row.issues.join('; ')}` : ''),
        );
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nENCOUNTER LAIRS FAILED: ${failures} issue(s)`);
  process.exit(1);
}
console.log(`\nENCOUNTER LAIRS OK: ${seeds.length} seeds x ${CASES.length} signature levels`);
