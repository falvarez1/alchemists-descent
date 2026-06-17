// Rigid bodies must treat small floating cell-clusters (<5) as walk-through, same
// as the player — so a crate never snags on a one/two-cell speck mid-air.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5219/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 30; f++) window.__game.tick();
  const w = ctx.world;
  const rb = ctx.rigidBodies;
  const STONE = 12;
  rb.clear();
  // an isolated 2-cell floating speck at x=300, well above the floor (700)
  w.replaceCellAt(w.idx(300, 690), STONE, 0x808080);
  w.replaceCellAt(w.idx(301, 690), STONE, 0x808080);
  // a big solid reference block (>=5 cells) the crate MUST still land on
  for (let yy = 690; yy <= 694; yy++) for (let xx = 360; xx <= 366; xx++) w.replaceCellAt(w.idx(xx, yy), STONE, 0x808080);

  const drop = (x) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, x, 655, { material: 'stone', friction: 0.6, restitution: 0.1 });
  const onSpeck = drop(300);   // above the lone speck → should fall PAST it to the floor
  const onBlock = drop(363);   // above the solid block → should REST on it
  for (let f = 0; f < 70; f++) window.__game.tick();

  return { speckY: +onSpeck.y.toFixed(1), blockY: +onBlock.y.toFixed(1) };
});

let pass = 0, fail = 0;
const check = (n, ok, d='') => { if (ok) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' ' + d); } };
// past the speck (690) it should reach ~the floor (rests ~696.5); stuck-on-speck would be ~686
check('crate falls THROUGH a 2-cell floating speck (no snag)', r.speckY > 692, JSON.stringify(r));
// the real block (>=5 cells) still stops a crate on top (~rests at 686.5)
check('crate still RESTS on a real solid block (>=5 cells)', r.blockY > 683 && r.blockY < 689, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\nloose-body probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
