// The settled findability repair, played: entry settling can seal a limb AFTER the
// floor is entered (worldgen-change-pitfalls #5), so the cascade re-audits until the
// floor is still, and each audit must be cheap enough not to freeze the game.
//
//   1. CONVERGENCE: with the floor entered and the cascade still running, wall the first
//      waystone into solid rock (a ring of Stone) and assert the repair carves a way in
//      within 8 s, leaving the floor with no error-severity findability issue.
//   2. SMOOTHNESS: over the whole window, at most two frames longer than 60 ms (the one
//      dirty verdict hands over to the synchronous repair; every clean audit is sliced
//      a few ms a frame). On the old build this is seven freezes of 80-170 ms.
//
// Dev server running.   node scripts/verify-settled-repair.mjs [url] [seed]
import { launchBrowser } from './browser-launch.mjs';
import { startConsolePlayRun, waitForOpeningEnd } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seed = Number(process.argv[3] ?? 7);
const REOPEN_WITHIN_MS = 8000;
const MAX_LONG_FRAMES = 2;

const browser = await launchBrowser({ headless: true });
let failed = false;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  ' + detail : ''}`);
  if (!ok) failed = true;
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await startConsolePlayRun(page, { seed, settleMs: 100 });
  await waitForOpeningEnd(page);

  await page.evaluate(() => {
    const c = window.__game.ctx;
    c.enemies.length = 0;
    c.state.arrivalGraceUntil = 0;
    const L = c.levels;
    const t0 = performance.now();
    window.__repairs = [];
    const repair = L.repairFindability.bind(L);
    L.repairFindability = (...a) => {
      const s = performance.now();
      const r = repair(...a);
      window.__repairs.push({ at: Math.round(s - t0), ms: Math.round(performance.now() - s), carved: r });
      return r;
    };
    // Frames carry their timestamps so the probe's OWN validator calls (each a ~90 ms pass) can be excluded from the verdict.
    window.__mine = [];
    window.__frames = { last: performance.now(), dts: [] };
    const loop = (t) => { window.__frames.dts.push([window.__frames.last, t]); window.__frames.last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__t0 = t0;
  });
  await page.waitForTimeout(250);

  // Wall the first waystone into rock, then judge with the shared validator.
  const sealed = await page.evaluate(async () => {
    const c = window.__game.ctx;
    const rt = c.levels.current;
    const { validateFindability } = await import('/src/world/validate.ts');
    const ws = rt.waystones[0];
    const w = c.world;
    const STONE = 12;
    let ring = 0;
    for (let dy = -20; dy <= 20; dy++) {
      for (let dx = -20; dx <= 20; dx++) {
        const r = Math.hypot(dx, dy);
        if (r < 12 || r > 20) continue;
        const x = Math.round(ws.x + dx), y = Math.round(ws.y + dy);
        if (!w.inBounds(x, y)) continue;
        w.replaceCellAt(x + y * w.width, STONE, 0x596170);
        ring++;
      }
    }
    const m0 = performance.now();
    const errors = validateFindability(rt).filter((i) => i.severity === 'error');
    window.__mine.push([m0, performance.now()]);
    return { ws: { x: ws.x, y: ws.y }, ring, errors: errors.map((i) => i.what), waitingOnCascade: !c.levels.findabilityReady, at: Math.round(performance.now() - window.__t0) };
  });
  console.log('sealed', JSON.stringify(sealed));
  check(sealed.waitingOnCascade, 'the settled cascade is still running when the seal goes in');
  check(sealed.errors.includes('waystone'), 'the sealed waystone is an error-severity findability issue');

  // Poll for the reopening (the shared validator, a few times; each call is itself a ~90 ms pass).
  const started = Date.now();
  let reopenedMs = -1;
  while (Date.now() - started < REOPEN_WITHIN_MS + 4000) {
    await page.waitForTimeout(400);
    const errs = await page.evaluate(async () => {
      const { validateFindability } = await import('/src/world/validate.ts');
      const m0 = performance.now();
      const out = validateFindability(window.__game.ctx.levels.current).filter((i) => i.severity === 'error').map((i) => i.what);
      window.__mine.push([m0, performance.now()]);
      return out;
    });
    if (!errs.includes('waystone')) { reopenedMs = Date.now() - started; break; }
  }
  check(reopenedMs >= 0 && reopenedMs <= REOPEN_WITHIN_MS, `the repair reopens the waystone within ${REOPEN_WITHIN_MS / 1000} s`, `(${reopenedMs} ms)`);

  // Let the rest of the cascade finish, then the floor must be clean and the window smooth.
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 40000 });
  const end = await page.evaluate(async () => {
    const { validateFindability } = await import('/src/world/validate.ts');
    // A frame is the probe's own if a validator call of ours overlaps it.
    const dts = window.__frames.dts.slice(1)
      .filter(([a, b]) => !window.__mine.some(([m0, m1]) => m0 < b && m1 > a))
      .map(([a, b]) => b - a);
    const sorted = [...dts].sort((a, b) => a - b);
    return {
      errors: validateFindability(window.__game.ctx.levels.current).filter((i) => i.severity === 'error').map((i) => `${i.what}@${i.x},${i.y}`),
      repairs: window.__repairs,
      frames: dts.length,
      p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1),
      max: +sorted[sorted.length - 1].toFixed(1),
      over60: dts.filter((d) => d > 60).length,
      over33: dts.filter((d) => d > 33.4).length,
    };
  });
  console.log('end', JSON.stringify(end));
  check(end.errors.length === 0, 'the settled floor has no error-severity findability issue', end.errors.join(' '));
  check(end.repairs.some((r) => r.carved), 'the synchronous repair carved (the seal really was dug out)');
  check(end.over60 <= MAX_LONG_FRAMES, `at most ${MAX_LONG_FRAMES} frames over 60 ms across the cascade`, `(${end.over60} over 60 ms, ${end.over33} over 33 ms, p99 ${end.p99} ms, max ${end.max} ms)`);
  check(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
