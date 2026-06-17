// Runtime probe for two climb obstacles:
//  - climbing UP past a rock that juts out of the face (bulge around it, depth ~3)
//  - topping out: mantle/pull-up onto a landing instead of dangling at the lip
// Usage: node scripts/verify-climb-obstacles.mjs [url]
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

const climb = (paintSrc, px, py) => `
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for(let y=320;y<=500;y++)for(let x=150;x<=300;x++){const i=w.idx(x,y);w.types[i]=0;w.colors[i]=0;}
  const stone=(x0,y0,x1,y1)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=w.idx(x,y);w.types[i]=12;w.colors[i]=0x6b6b6b;}};
  ${paintSrc}
  p.x=${px}; p.y=${py}; p.vx=0; p.vy=0; p.fx=0; p.fy=0; p.dead=false; p.crawling=false; p.inLiquid=false;
  p.climbing=true; p.climbDir=1; p.climbLean=0; p.wallGrabDir=1; p.wallGrabT=10; p.grounded=false;
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k]=false;
  ctx.input.keys.grab = true; ctx.input.keys.up = true;
  ctx.camera.snapTo(p.x, p.y);
`;

// ---- 1. climb past a rock that juts ~3 cells out of the face ----------------
const overhang = await page.evaluate((setup) => {
  // eslint-disable-next-line no-new-func
  new Function(setup)();
  const ctx = window.__game.ctx, p = ctx.player;
  let minY = p.y;
  for (let f = 0; f < 220; f++) { window.__game.tick(); if (p.y < minY) minY = p.y; }
  return { minY, climbing: p.climbing };
}, climb(
  'stone(210,330,260,480); stone(207,394,209,401);', // wall + a depth-3 nub jutting toward the climber
  204, 430));
// the nub tops out at y=394; clearing it means his feet got well above it
check('climbs up past a rock jutting out of the face', overhang.minY < 388, JSON.stringify(overhang));

// ---- 2. top-out mantle: pull up onto a landing at the wall top --------------
const mantle = await page.evaluate((setup) => {
  // eslint-disable-next-line no-new-func
  new Function(setup)();
  const ctx = window.__game.ctx, p = ctx.player;
  for (let f = 0; f < 240; f++) { window.__game.tick(); if (p.grounded && !p.climbing) break; }
  return { climbing: p.climbing, grounded: p.grounded, x: p.x, y: p.y };
}, climb(
  // an L-corner: left face at x=210 (y>=400) with a flat landing on top (y=400)
  'stone(210,400,265,470);',
  205, 445));
check('tops out by mantling onto the landing (now standing)', !mantle.climbing && mantle.grounded, JSON.stringify(mantle));
check('the mantle lands him up on the ledge (over the lip)', mantle.y <= 401 && mantle.x > 205, JSON.stringify(mantle));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\nclimb obstacles probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
