// Findability audit: every level on every seed must place its locks AND keep
// them reachable from spawn. Runs the shared src/world/validate.ts module
// inside the live game. Usage:
//   node scripts/verify-findability.mjs [url] [seedCsv]
// Defaults: http://localhost:5173/  seeds 1,5,1337,42
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,5,1337,42').split(',').map(Number);
const DEPTHS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'vault'];

const browser = await launchBrowser({ headless: true });
let failures = 0;
let missingWaveE = 0;
let totalPrefabs = 0;
let missingPrefabs = 0;
let missingMachines = 0;
let missingSpellLabs = 0;

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

          const waitForSettledFindability = async (rt) => {
            let latest = null;
            let consecutiveClean = 0;
            const deadline = performance.now() + 1800;
            while (performance.now() < deadline) {
              latest = validateFindability(rt);
              if (!latest.some((i) => i.severity === 'error')) {
                consecutiveClean++;
                if (consecutiveClean >= 3) return latest;
              } else {
                consecutiveClean = 0;
              }
              await new Promise((r) => setTimeout(r, 100));
            }
            return latest ?? validateFindability(rt);
          };

          const out = [];
          for (const id of IDS) {
            if (id !== 'd1') {
              ctx.levels.leaveLevel();
              ctx.levels.enterLevel(ctx, id);
            }
            const rt = ctx.levels.current;
            const all = await waitForSettledFindability(rt);
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
            const machines = placedPrefabs.filter((p) => String(p.id ?? '').startsWith('machine-')).length;
            const spellLab = id !== 'd1' || !!rt.spellLab;
            out.push({ id, waveE, spellLab, issues, buried, prefabs: placedPrefabs.length, machines });
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
    const bad = lv.issues.length > 0 || !lv.waveE || !lv.spellLab;
    if (lv.issues.length) failures++;
    if (!lv.waveE) missingWaveE++;
    if (!lv.spellLab) missingSpellLabs++;
    if (lv.prefabs <= 0) missingPrefabs++;
    if (lv.machines <= 0) missingMachines++;
    totalPrefabs += lv.prefabs;
    console.log(
      `${bad || lv.prefabs <= 0 || lv.machines <= 0 ? 'FAIL' : ' ok '} seed=${seed} ${lv.id} prefabs=${lv.prefabs} machines=${lv.machines}` +
        (lv.waveE ? '' : ' [NO WAVE-E LOCK]') +
        (lv.spellLab ? '' : ' [NO SPELL LAB]') +
        (lv.prefabs <= 0 ? ' [NO PREFAB]' : '') +
        (lv.machines <= 0 ? ' [NO MACHINE]' : '') +
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
  failures + missingWaveE + missingPrefabs + missingMachines + missingSpellLabs === 0
    ? `\nFINDABILITY OK: ${seeds.length} seeds x ${DEPTHS.length} depths clean, ${totalPrefabs} prefabs placed`
    : `\nFINDABILITY FAILED: ${failures} reachability failures, ${missingWaveE} missing locks, ${missingSpellLabs} missing spell labs, ${missingPrefabs} missing prefabs, ${missingMachines} missing machines`,
);
process.exit(failures + missingWaveE + missingPrefabs + missingMachines + missingSpellLabs === 0 ? 0 : 1);
