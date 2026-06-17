// (1) The player can't CRAWL while gripping a wall face (it read as lying off the
// rock). (2) While CLIMBING, pressing AWAY from the wall dislodges him into a fall.
// Usage: node scripts/verify-wall-pose.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + ' ' + d); } };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.player, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 30; f++) window.__game.tick();
  ctx.levels._transitioning = false;
  const w = ctx.world, p = ctx.player, keys = ctx.input.keys, STONE = 12;
  const setKeys = (o) => { for (const k of Object.keys(keys)) keys[k] = false; Object.assign(keys, o); };
  const clear = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.clearCellAt(w.idx(x, y)); };
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = w.idx(x, y); w.types[i] = STONE; w.colors[i] = 0x777777; } };
  const reset = () => { ctx.state.mode = 'play'; ctx.state.paused = false; p.dead = false; p.crawling = false; p.climbing = false; p.wallGrabT = 0; setKeys({}); };

  // ---- (2) CLIMB DISLODGE: grip a wall, press away → fall ---------------------
  reset();
  const bx = Math.round(p.x);
  clear(bx - 20, 380, bx + 20, 480);
  fill(bx + 5, 380, bx + 10, 478);         // a tall wall just off the RIGHT edge
  p.x = bx; p.y = 440; p.vx = 0; p.vy = 0; p.grounded = false; p.facing = 1;
  setKeys({ grab: true, right: true });    // grip toward the wall (right = into it → keeps climbing)
  let climbing = false;
  for (let f = 0; f < 12; f++) { window.__game.tick(); if (p.climbing) climbing = true; }
  const climbDir = p.climbDir, wasClimbing = p.climbing;
  // press AWAY from the wall (wall on right → press left), keep gripping
  setKeys({ grab: true, left: true });
  const yBefore = p.y;
  window.__game.tick();
  const dislodged = wasClimbing && !p.climbing;
  for (let f = 0; f < 14; f++) window.__game.tick();
  const fell = p.y > yBefore + 3; // gravity took him down after letting go

  // ---- (1) NO CRAWL ON A WALL: lip grab pose, S+dir must not crawl -----------
  reset();
  clear(bx - 20, 380, bx + 20, 480);
  // a narrow lip: floor only under the RIGHT edge, a tall wall rising beside it
  fill(bx + 3, 461, bx + 6, 463);          // the lip (under the body's right edge)
  fill(bx + 5, 446, bx + 6, 461);          // tall face beside it (for the grip)
  p.x = bx; p.y = 460; p.vx = 0; p.vy = 0;
  setKeys({ down: true, right: true });
  let crawledOnWall = false, grabbed = false;
  for (let f = 0; f < 14; f++) { window.__game.tick(); if ((p.wallGrabT ?? 0) > 0) grabbed = true; if (p.crawling) crawledOnWall = true; }

  // ...and crawling on OPEN ground still works (control)
  reset();
  clear(bx - 30, 461, bx + 30, 480);
  fill(bx - 30, 464, bx + 30, 470);        // a wide flat floor, no walls
  p.x = bx; p.y = 463; p.vx = 0; p.vy = 0;
  setKeys({ down: true, right: true });
  let crawledOpen = false;
  for (let f = 0; f < 16; f++) { window.__game.tick(); if (p.crawling) { crawledOpen = true; break; } }

  return { climbing, climbDir, dislodged, fell, grabbed, crawledOnWall, crawledOpen };
});

console.log('  ' + JSON.stringify(r));
check('player grips/climbs the test wall', r.climbing, JSON.stringify(r));
check('pressing AWAY from the wall dislodges the climb', r.dislodged, JSON.stringify(r));
check('dislodged player falls', r.fell, JSON.stringify(r));
check('wall-grip pose engages on the lip', r.grabbed, JSON.stringify(r));
check('CANNOT crawl while gripping a wall', !r.crawledOnWall, JSON.stringify(r));
check('crawling on open ground still works (control)', r.crawledOpen, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nwall-pose probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
