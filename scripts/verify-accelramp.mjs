// At a high top speed (Swift stacks / God Mode) pressing a direction must RAMP up
// over several frames, not snap to max in one — the per-frame gain is capped.
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.player, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 30; f++) window.__game.tick();
  const p = ctx.player;
  p.status.swift = 9999; p.perks.swiftfoot = true; // God-Mode-grade top speed
  p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0;
  p.x = 300; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  ctx.input.keys.right = true;
  let prev = 0, maxDvx = 0; const vs = [];
  for (let f = 0; f < 26; f++) { window.__game.tick(); const d = p.vx - prev; if (d > maxDvx) maxDvx = d; prev = p.vx; vs.push(+p.vx.toFixed(2)); }
  ctx.input.keys.right = false;
  const maxVx = Math.max(...vs);
  let f90 = vs.findIndex((v) => v >= 0.9 * maxVx);
  return { maxDvx: +maxDvx.toFixed(3), maxVx: +maxVx.toFixed(2), f90, vs: vs.slice(0, 12) };
});

let pass = 0, fail = 0;
const check = (n, ok, d='') => { if (ok) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' ' + d); } };
console.log('  ' + JSON.stringify(r));
check('reaches a high top speed (God Mode)', r.maxVx > 4, JSON.stringify(r));
check('per-frame speed gain is CAPPED (no snap to max)', r.maxDvx <= 0.62, JSON.stringify(r));
check('top speed RAMPS over several frames (not ~5)', r.f90 >= 6, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\naccel-ramp probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
