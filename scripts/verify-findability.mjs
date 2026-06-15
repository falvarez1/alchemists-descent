// Findability audit: every level on every seed must place its locks AND keep
// them reachable from spawn. Runs the shared src/world/validate.ts module
// inside the live game. Usage:
//   node scripts/verify-findability.mjs [url] [seedCsv]
// Defaults: http://localhost:5173/  seeds 1,5,1337,42
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,5,1337,42').split(',').map(Number);
const DEPTHS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'vault'];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failures = 0;
let missingWaveE = 0;
let totalPrefabs = 0;

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
        async ({ IDS }) => {
          const ctx = window.__game.ctx;
          const { validateFindability } = await import('/src/world/validate.ts');

          const out = [];
          for (const id of IDS) {
            if (id !== 'd1') {
              ctx.levels.leaveLevel();
              ctx.levels.enterLevel(ctx, id);
              await new Promise((r) => setTimeout(r, 350));
            }
            const rt = ctx.levels.current;
            const all = validateFindability(rt);
            const issues = all
              .filter((i) => i.severity === 'error')
              .map((i) => `${i.what}@${i.x},${i.y}`);
            const buried = all.filter((i) => i.severity === 'info').length;
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
            out.push({ id, waveE, issues, buried, prefabs: rt.placedPrefabs?.length ?? 0 });
          }
          return out;
        },
        { IDS: DEPTHS },
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
    const bad = lv.issues.length > 0 || !lv.waveE;
    if (lv.issues.length) failures++;
    if (!lv.waveE) missingWaveE++;
    totalPrefabs += lv.prefabs;
    console.log(
      `${bad ? 'FAIL' : ' ok '} seed=${seed} ${lv.id} prefabs=${lv.prefabs}` +
        (lv.waveE ? '' : ' [NO WAVE-E LOCK]') +
        (lv.issues.length ? ' unreachable: ' + lv.issues.join(' ') : '') +
        (lv.buried ? ` (${lv.buried} buried treasure)` : ''),
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
  failures + missingWaveE === 0
    ? `\nFINDABILITY OK: ${seeds.length} seeds x ${DEPTHS.length} depths clean, ${totalPrefabs} prefabs placed`
    : `\nFINDABILITY FAILED: ${failures} reachability failures, ${missingWaveE} missing locks`,
);
process.exit(failures + missingWaveE === 0 ? 0 : 1);
