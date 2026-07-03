// Smoke the three proving grounds: enter each, assert its signature content
// landed and the game keeps ticking with no page errors.
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};
const pageErrors = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { settleMs: 400 });

const enter = (id) =>
  page.evaluate((id) => {
    const ctx = window.__game.ctx;
    ctx.levels.leaveLevel();
    ctx.levels.enterLevel(ctx, id);
    return ctx.levels.current?.def?.id ?? null;
  }, id);
const count = (t) =>
  page.evaluate((t) => {
    const w = window.__game.ctx.world;
    let n = 0;
    for (let i = 0; i < w.types.length; i++) if (w.types[i] === t) n++;
    return n;
  }, t);

for (const [id, sig, sigName, min] of [
  ['alchemy-test', 7, 'acid tub', 300],
  ['gas-test', 38, 'marsh gas galleries', 2000],
  ['frost-test', 2, 'the lake', 10000],
]) {
  const landed = await enter(id);
  await page.waitForTimeout(1200);
  check(`${id}: entered`, landed === id, `landed=${landed}`);
  const n = await count(sig);
  check(`${id}: ${sigName} present`, n > min, `${sigName}=${n}`);
  const alive = await page.evaluate(async () => {
    const f0 = window.__game.ctx.state.frameCount;
    await new Promise((r) => setTimeout(r, 400));
    return window.__game.ctx.state.frameCount > f0;
  });
  check(`${id}: game ticking`, alive === true, '');
}
// the alchemy grounds must stage the run's secret pair
{
  await enter('alchemy-test');
  await page.waitForTimeout(600);
  const staged = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const s = ctx.state.secretReaction;
    if (!s) return { ok: false };
    const w = ctx.world;
    let a = 0;
    let b = 0;
    for (let y = 560; y <= 664; y++)
      for (let x = 1100; x <= 1250; x++) {
        const t = w.types[w.idx(x, y)];
        if (t === s.a) a++;
        if (t === s.b) b++;
      }
    return { ok: a > 40 && b > 40, a, b, name: s.name };
  });
  check(`alchemy-test: secret pair staged ("${staged.name ?? '?'}")`, staged.ok === true, JSON.stringify(staged));
}
check('no page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 300));
console.log(`\n${pass} ok, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
