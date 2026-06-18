// Runtime probe for the climb/ceiling feel pass:
//  - ceiling "slip": a horizontal move pinned by a ceiling nub ducks under it
//  - climb speed: faster cells/frame than the old 5-frame cadence
//  - climb tilt: the body leans parallel to an angled wall (climbLean != 0)
//  - climb release: too-shallow / wrong-way faces let go
// Also drops a screenshot of the wizard on an angled wall for an eyeball check.
// Usage: node scripts/verify-climb-feel.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.physics, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// ---- 1. ceiling slip (physics primitive): duck under a down-jutting nub ----
const ceil = await page.evaluate(() => {
  const w = window.__game.ctx.world, phys = window.__game.ctx.physics;
  const stone = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = w.idx(x, y); w.types[i] = 12; w.colors[i] = 0x6b6b6b; } };
  stone(180, 350, 260, 380); // ceiling
  stone(180, 420, 260, 440); // floor (room to duck between)
  stone(201, 381, 202, 383); // a nub jutting 3 cells DOWN from the ceiling
  // feet at 398: body rows 382..398, head pressed near the ceiling; nub hits the head
  const a = { x: 197, y: 398 };
  const blocked = phys.tryMoveEntity(a, 1, 0, 4, 17, 5, 0); // no slip
  const b = { x: 197, y: 398 };
  const ducked = phys.tryMoveEntity(b, 1, 0, 4, 17, 5, 3); // step-down slip
  return { blocked, aStill: a.x === 197 && a.y === 398, ducked, bx: b.x, by: b.y };
});
check('without slip, a ceiling nub pins the sideways move', ceil.blocked === false && ceil.aStill, JSON.stringify(ceil));
check('with slip, it ducks under the nub and slides on', ceil.ducked === true && ceil.bx === 198 && ceil.by > 398, JSON.stringify(ceil));

// ---- helper: set the player climbing a freshly painted wall, then tick ------
// (clears the work region first so a prior test's terrain can't skew the
// wall-distance samples — that contamination, not the code, was the bug.)
const climbSetup = (paintSrc, px, py, keysSrc) => `
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for(let y=320;y<=480;y++)for(let x=150;x<=290;x++){const i=w.idx(x,y);w.types[i]=0;w.colors[i]=0;}
  const stone = (x0,y0,x1,y1)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=w.idx(x,y);w.types[i]=12;w.colors[i]=0x6b6b6b;}};
  ${paintSrc}
  p.x=${px}; p.y=${py}; p.vx=0; p.vy=0; p.fx=0; p.fy=0; p.dead=false; p.crawling=false; p.inLiquid=false;
  p.climbing=true; p.climbDir=1; p.climbLean=0; p.wallGrabDir=1; p.wallGrabT=10;
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k]=false;
  ctx.input.keys.grab = true; ${keysSrc}
  ctx.camera.snapTo(p.x, p.y);
`;

// ---- 2. climb speed: rises clearly faster than the old 5-frame/cell rate ----
const speed = await page.evaluate((setup) => {

  new Function(setup)();
  const ctx = window.__game.ctx, p = ctx.player;
  const startY = p.y;
  for (let f = 0; f < 60; f++) window.__game.tick();
  return { climbed: startY - p.y, climbing: p.climbing };
}, climbSetup('stone(210,330,240,470);', 204, 410, 'ctx.input.keys.up = true;'));
// 60 frames at 3 frames/cell ~= 20 cells (old 5-frame rate would be ~12).
check('climbing is faster (>=16 cells in 60 frames; was ~12)', speed.climbed >= 16, JSON.stringify(speed));

// ---- 3. climb tilt: the body leans parallel to an angled (receding) wall ----
const tilt = await page.evaluate((setup) => {

  new Function(setup)();
  const ctx = window.__game.ctx, p = ctx.player;
  for (let f = 0; f < 30; f++) window.__game.tick();
  return { lean: p.climbLean, climbing: p.climbing };
}, climbSetup(
  // right wall whose face recedes to the RIGHT going up (~0.3 slope): a slab lean
  'for(let y=340;y<=470;y++){const Lx=210+Math.round((410-y)*0.3);stone(Lx,y,Lx+18,y);}',
  204, 410, ''));
check('body leans into an angled wall (climbLean clearly non-zero)', tilt.lean > 0.12 && tilt.climbing, JSON.stringify(tilt));

// ---- 4. the reach limit: a face beyond climbing reach drops the climb -------
const release = await page.evaluate((setup) => {

  new Function(setup)();
  const ctx = window.__game.ctx, p = ctx.player;
  for (let f = 0; f < 12; f++) window.__game.tick();
  return { climbing: p.climbing };
}, climbSetup(
  // wall face ~12 cells off center — past the 8-cell catch reach: he can't hold it
  'stone(219,330,260,470);',
  204, 410, ''));
check('a face beyond climbing reach drops the climb', release.climbing === false, JSON.stringify(release));

// ---- 5. snug-to-wall: the body closes the grip gap (no climbing on air) -----
const gap = await page.evaluate((setup) => {

  new Function(setup)();
  const ctx = window.__game.ctx, p = ctx.player;
  for (let f = 0; f < 10; f++) window.__game.tick();
  // wall face is at x=214; the body half-width is 4, so a snug grip = edge ~213
  return { x: p.x, edge: p.x + 4, gap: 214 - (p.x + 4), climbing: p.climbing };
}, climbSetup('stone(214,330,260,470);', 207, 410, ''));
check('the body snugs to the wall (grip gap <= 2 cells)', gap.gap <= 2 && gap.gap >= 0 && gap.climbing, JSON.stringify(gap));

// ---- screenshot of the angled-wall climb for an eyeball check ---------------
await page.evaluate((setup) => {
  new Function(setup)();
  for (let f = 0; f < 20; f++) window.__game.tick();
}, climbSetup('for(let y=340;y<=470;y++){const Lx=210+Math.round((410-y)*0.3);stone(Lx,y,Lx+18,y);}', 204, 410, ''));
await page.waitForTimeout(250);
await page.screenshot({ path: 'scripts/_climb-shot.png' });
console.log('  ..    wrote scripts/_climb-shot.png');

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\nclimb feel probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
