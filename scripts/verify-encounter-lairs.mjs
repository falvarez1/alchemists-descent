// Generated encounter-lair audit: signature organic enemies must have authored
// habitat cells in the live campaign runtime, and those levels must remain
// findable after generation/entry.
// Usage: node scripts/verify-encounter-lairs.mjs [url] [seedCsv]
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,5,1337,42').split(',').map(Number);

const CASES = [
  {
    id: 'd2',
    lair: 'encounter-lair-rootloper-grove',
    kind: 'rootloper',
    signature: ['Vines', 'Moss', 'Fungus', 'Glowshroom'],
    minCells: 45,
  },
  {
    id: 'd4',
    lair: 'encounter-lair-rillback-pool',
    kind: 'rillback',
    signature: ['Water', 'Blood', 'Slime'],
    minCells: 180,
  },
  {
    id: 'd5',
    lair: 'encounter-lair-rootloper-grove',
    kind: 'rootloper',
    signature: ['Vines', 'Moss', 'Fungus', 'Glowshroom'],
    minCells: 45,
  },
  {
    id: 'd6',
    lair: 'encounter-lair-stonemaw-seam',
    kind: 'stonemaw',
    signature: ['RawOre', 'Coal'],
    minCells: 45,
  },
  {
    id: 'd8',
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
        async ({ cases }) => {
          const { Cell } = await import('/src/sim/CellType.ts');
          const { reachableMask, validateFindability, wizardMask } = await import('/src/world/validate.ts');
          const ctx = window.__game.ctx;
          const w = () => ctx.world;
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const cellId = (name) => Cell[name];
          const countCells = (rect, names) => {
            if (!rect) return 0;
            const wanted = new Set(names.map(cellId));
            let count = 0;
            const world = w();
            for (let y = rect.y0; y <= rect.y1; y++) {
              for (let x = rect.x0; x <= rect.x1; x++) {
                if (world.inBounds(x, y) && wanted.has(world.types[world.idx(x, y)])) count++;
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
          const waitForFindability = async (rt) => {
            let latest = [];
            let cleanFrames = 0;
            const deadline = performance.now() + 1800;
            while (performance.now() < deadline) {
              latest = validateFindability(rt);
              if (latest.every((issue) => issue.severity !== 'error')) {
                cleanFrames++;
                if (cleanFrames >= 3) return latest;
              } else {
                cleanFrames = 0;
              }
              await sleep(100);
            }
            return latest;
          };

          const out = [];
          for (const c of cases) {
            if (ctx.levels.current?.def?.id !== c.id) {
              ctx.levels.leaveLevel();
              ctx.levels.enterLevel(ctx, c.id);
            }
            const rt = ctx.levels.current;
            const lair = rt?.placedPrefabs?.find((p) => p.id === c.lair) ?? null;
            const residents = enemiesInRect(lair, c.kind);
            const findability = await waitForFindability(rt);
            if (c.kind === 'rillback') await sleep(5200);
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
            const cellReach = rt ? reachableMask(rt) : null;
            const wizardReach = rt ? wizardMask(rt) : null;
            const lairCellReachCells = countMaskInRect(cellReach, lair);
            const lairWizardReachCells = countMaskInRect(wizardReach, lair);
            const residentCellReachable = !!cellReach && residents.some((e) => near(cellReach, e.x, e.y, 12));
            const residentWizardReachable = !!wizardReach && residents.some((e) => near(wizardReach, e.x, e.y, 20));
            const lairCellReachable = lairCellReachCells >= 80 || residentCellReachable;
            const lairWizardReachable = lairWizardReachCells >= 30 || residentWizardReachable;
            const findabilityErrors = findability
              .filter((issue) => issue.severity === 'error')
              .map((issue) => `${issue.what}@${issue.x},${issue.y}`);
            const issues = [];
            if (!lair) issues.push('missing lair footprint');
            if (lair && signatureCells < c.minCells) issues.push(`signature cells ${signatureCells}/${c.minCells}`);
            if (lair && metalCells > 0) issues.push(`metal cells inside footprint ${metalCells}`);
            if (lair && residents.length === 0) issues.push(`missing resident ${c.kind}`);
            if (lair && !lairCellReachable) issues.push('lair interior not cell-reachable');
            if (lair && !lairWizardReachable) issues.push('lair interior not wizard-reachable');
            if (lair && c.kind === 'rillback' && !residentCellReachable) issues.push('rillback resident not cell-reachable');
            if (lair && c.kind !== 'rillback' && !residentWizardReachable) issues.push(`${c.kind} resident not wizard-reachable`);
            if (c.kind === 'rillback' && nearbyLiquid < 120) issues.push(`rillback pool drained or absent ${nearbyLiquid}`);
            if (c.kind === 'rillback' && !settledResidents.some((e) => e.rillWet >= 0.28)) {
              issues.push(`rillback dry after settle ${JSON.stringify(settledResidents)}`);
            }
            for (const issue of findabilityErrors) issues.push(`findability ${issue}`);
            out.push({
              id: c.id,
              kind: c.kind,
              lair,
              signatureCells,
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
        { cases: CASES },
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
          `${ok ? ' ok ' : 'FAIL'} seed=${seed} ${row.id} ${row.kind} cells=${row.signatureCells} metal=${row.metalCells} residents=${row.residents.length}` +
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
