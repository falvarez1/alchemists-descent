// Findability audit: every level on every seed must place its locks AND keep
// them reachable from spawn. Runs the shared src/world/validate.ts module
// inside the live game. Usage:
//   node scripts/verify-findability.mjs [url] [seedCsv]
// Defaults: http://localhost:5173/  seeds 1,5,1337
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,5,1337').split(',').map(Number);
const DEPTHS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failures = 0;
let missingWaveE = 0;

for (const seed of seeds) {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => {
    console.error('PAGE ERROR:', String(e));
    failures++;
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const results = await page.evaluate(
    async ({ SEED, IDS }) => {
      localStorage.removeItem('noita-expedition');
      const ctx = window.__game.ctx;
      ctx.state.worldSeed = SEED;
      const { validateFindability } = await import('/src/world/validate.ts');
      document.getElementById('mode-play-btn').click();
      await new Promise((r) => setTimeout(r, 1800));

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
        const sensors = rt.mechanisms.filter((m) =>
          ['scale', 'buoy', 'chargelatch'].includes(m.kind),
        ).length;
        const braziersByDoor = {};
        for (const m of rt.mechanisms) {
          if (m.kind === 'brazier') braziersByDoor[m.targetId] = (braziersByDoor[m.targetId] ?? 0) + 1;
        }
        const waveE =
          rt.def.depth < 2 ||
          sensors > 0 ||
          Object.values(braziersByDoor).some((n) => n >= 3);
        out.push({ id, waveE, issues, buried });
      }
      return out;
    },
    { SEED: seed, IDS: DEPTHS },
  );

  for (const lv of results) {
    const bad = lv.issues.length > 0 || !lv.waveE;
    if (lv.issues.length) failures++;
    if (!lv.waveE) missingWaveE++;
    console.log(
      `${bad ? 'FAIL' : ' ok '} seed=${seed} ${lv.id}` +
        (lv.waveE ? '' : ' [NO WAVE-E LOCK]') +
        (lv.issues.length ? ' unreachable: ' + lv.issues.join(' ') : '') +
        (lv.buried ? ` (${lv.buried} buried treasure)` : ''),
    );
  }
  await page.context().close();
}

await browser.close();
console.log(
  failures + missingWaveE === 0
    ? `\nFINDABILITY OK: ${seeds.length} seeds x ${DEPTHS.length} depths clean`
    : `\nFINDABILITY FAILED: ${failures} reachability failures, ${missingWaveE} missing locks`,
);
process.exit(failures + missingWaveE === 0 ? 0 : 1);
