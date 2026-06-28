// Generated-population audit: every planned biome enemy should get an actual
// runtime placement. Requires a running dev server.
// Usage: node scripts/verify-population-placement.mjs [url] [seedCsv]
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,5,1337,42').split(',').map(Number);
const DEPTHS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'vault'];

const browser = await launchBrowser({ headless: true });
let failures = 0;

function total(record) {
  return Object.values(record ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function perKindIssues(population) {
  const issues = [];
  const planned = population.planned ?? {};
  const placed = population.placed ?? {};
  const skipped = population.skipped ?? {};
  const kinds = new Set([...Object.keys(planned), ...Object.keys(placed), ...Object.keys(skipped)]);
  for (const kind of kinds) {
    const want = Number(planned[kind] ?? 0) || 0;
    const got = Number(placed[kind] ?? 0) || 0;
    const missed = Number(skipped[kind] ?? 0) || 0;
    if (want > 0 && got < want) issues.push(`${kind}: placed ${got}/${want}`);
    if (missed > 0) issues.push(`${kind}: skipped ${missed}`);
  }
  return issues;
}

function signatureIssues(levelId, population) {
  const required = {
    d2: ['rootloper'],
    d4: ['rillback'],
    d5: ['rootloper'],
    d6: ['stonemaw'],
    d8: ['stonemaw'],
  }[levelId] ?? [];
  const issues = [];
  for (const kind of required) {
    if ((Number(population.placed?.[kind] ?? 0) || 0) <= 0) issues.push(`${kind}: signature not placed`);
    if ((Number(population.lairs?.[kind] ?? 0) || 0) <= 0) issues.push(`${kind}: habitat lair missing`);
  }
  return issues;
}

try {
  for (const seed of seeds) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await startConsoleTestRun(page, { seed, settleMs: 100 });
      const rows = await page.evaluate(({ depths }) => {
        const ctx = window.__game.ctx;
        const out = [];
        for (const id of depths) {
          if (ctx.levels.current?.def?.id !== id) {
            ctx.levels.leaveLevel();
            ctx.levels.enterLevel(ctx, id);
          }
          const rt = ctx.levels.current;
          const population = rt?.population ?? { planned: {}, placed: {}, skipped: {} };
          out.push({ id, population });
        }
        return out;
      }, { depths: DEPTHS });

      for (const err of pageErrors) {
        console.error(`PAGE ERROR seed=${seed}:`, err);
        failures++;
      }

      for (const row of rows) {
        const planned = total(row.population.planned);
        const placed = total(row.population.placed);
        const skipped = total(row.population.skipped);
        const issues = [...perKindIssues(row.population), ...signatureIssues(row.id, row.population)];
        const ok = skipped === 0 && placed >= planned && issues.length === 0;
        if (!ok) failures++;
        console.log(
          `${ok ? ' ok ' : 'FAIL'} seed=${seed} ${row.id} planned=${planned} placed=${placed} skipped=${skipped}`,
          JSON.stringify(row.population),
          issues.length ? `issues=${issues.join('; ')}` : '',
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
  console.error(`\nPOPULATION PLACEMENT FAILED: ${failures} issue(s)`);
  process.exit(1);
}
console.log(`\nPOPULATION PLACEMENT OK: ${seeds.length} seeds x ${DEPTHS.length} depths`);
