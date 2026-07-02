// The three Noita-style physics verbs, end to end in the REAL game:
//   1. MARSH GAS - rises off the floor and pools under the ceiling; one spark
//      races the pocket as a flame front; a blast LIGHTS a pocket, never
//      erases it.
//   2. FLASK THROW - the bottle lobs, shatters, and its stored cells land in
//      the world (physics grenade).
//   3. FREEZE-TERRAFORMING - an icelance crusts a water pool into standable
//      ice; fire melts it back.
// Run with the dev server up: node scripts/verify-physics-verbs.mjs
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

const GAS = 38, ICE = 10, WATER = 2, FIRE = 5;

const buildChamber = () =>
  page.evaluate(() => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    for (let y = 380; y <= 560; y++)
      for (let x = 500; x <= 900; x++) {
        const i = w.idx(x, y);
        w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
      }
    const solid = (x0, x1, y0, y1, t = 13) => {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = w.idx(x, y);
          w.types[i] = t; w.colors[i] = 0x7a8a99;
        }
    };
    // sealed chamber: interior x 522-698, y 422-538
    solid(520, 700, 415, 421); // ceiling
    solid(520, 700, 539, 545); // floor
    solid(520, 526, 415, 545); // left wall
    solid(694, 700, 415, 545); // right wall
    ctx.enemies.length = 0;
    ctx.pickups.length = 0;
    const p = ctx.player;
    p.hp = p.maxHp = 1e6;
    p.x = 780; p.y = 520; p.vx = 0; p.vy = 0; // outside the chamber
    ctx.camera.snapTo(640, 470);
  });

const countIn = (t, x0, x1, y0, y1) =>
  page.evaluate(({ t, x0, x1, y0, y1 }) => {
    const w = window.__game.ctx.world;
    let n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (w.types[w.idx(x, y)] === t) n++;
    return n;
  }, { t, x0, x1, y0, y1 });

// ---------------------------------------------------- 1a) gas rises + pools
console.log('scenario: marsh gas rises and pools under the ceiling');
await buildChamber();
await page.evaluate((GAS) => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 528; y <= 536; y++)
    for (let x = 560; x <= 660; x++) {
      const i = w.idx(x, y);
      if (w.types[i] === 0) { w.types[i] = GAS; w.colors[i] = 0x8a9a4e; }
    }
}, GAS);
const seeded = await countIn(GAS, 522, 698, 416, 545);
await page.waitForTimeout(4500);
{
  const total = await countIn(GAS, 522, 698, 416, 545);
  const top = await countIn(GAS, 522, 698, 422, 452); // top band under the ceiling
  check('gas persists (no dissipation)', total > seeded * 0.9, `seeded=${seeded} now=${total}`);
  check('gas pooled under the ceiling', top / Math.max(1, total) > 0.75, `top=${top}/${total}`);
}

// ---------------------------------------------------- 1b) one spark = whoosh
console.log('scenario: one spark races the pocket as a flame front');
await page.evaluate(({ FIRE, GAS }) => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  // find the pocket's left edge and strike the spark INSIDE it (a lone flame
  // 30 cells from the cloud just burns out - like a torch in clear air)
  let lit = 0;
  outer: for (let x = 522; x <= 698 && lit < 3; x++) {
    for (let y = 416; y <= 545; y++) {
      const i = w.idx(x, y);
      if (w.types[i] === GAS) {
        w.types[i] = FIRE; w.colors[i] = 0xff4600; w.life[i] = 40;
        if (++lit >= 3) break outer;
      }
    }
  }
}, { FIRE, GAS });
await page.waitForTimeout(1600);
{
  const left = await countIn(GAS, 522, 698, 416, 545);
  check('the pocket burned down (whoosh)', left < seeded * 0.2, `left=${left}/${seeded}`);
}

// ---------------------------------------------------- 1c) a blast LIGHTS gas
console.log('scenario: an explosion ignites the pocket instead of erasing it');
await buildChamber();
await page.evaluate((GAS) => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 424; y <= 430; y++)
    for (let x = 540; x <= 680; x++) {
      const i = w.idx(x, y);
      if (w.types[i] === 0) { w.types[i] = GAS; w.colors[i] = 0x8a9a4e; }
    }
}, GAS);
const seeded2 = await countIn(GAS, 522, 698, 416, 545);
await page.evaluate(() => {
  window.__game.ctx.explosions.trigger(560, 434, 12);
});
await page.waitForTimeout(1500);
{
  const left = await countIn(GAS, 522, 698, 416, 545);
  check('blast chained the whole pocket', left < seeded2 * 0.25, `left=${left}/${seeded2}`);
  check('no page errors so far', pageErrors.length === 0, pageErrors.join('; '));
}

// ---------------------------------------------------- 2) flask throw grenade
console.log('scenario: thrown flask shatters into its stored cells');
await buildChamber();
const flaskResult = await page.evaluate(({ WATER }) => {
  const ctx = window.__game.ctx;
  ctx.player.x = 560; ctx.player.y = 534; // inside the chamber, lobbing right
  ctx.player.vx = 0; ctx.player.vy = 0;
  ctx.input.mouse = ctx.input.mouse || {};
  // aim right-and-up (the flask lobs toward the cursor)
  if (ctx.input.aim) { ctx.input.aim.x = 660; ctx.input.aim.y = 500; }
  ctx.input.mouseWorldX = 660; ctx.input.mouseWorldY = 500;
  ctx.flask.selectSlot(0);
  ctx.flask.setSlot(0, WATER, 60);
  const before = ctx.flask.state.count ?? ctx.flask.state.amount ?? 60;
  ctx.flask.throwFlask(ctx);
  return { before, bottle: ctx.flask.bottleView() !== null };
}, { WATER });
await page.waitForTimeout(2500);
{
  const water = await countIn(WATER, 522, 698, 416, 545);
  check('bottle went airborne', flaskResult.bottle === true, JSON.stringify(flaskResult));
  check('shatter released the stored water', water > 20, `water=${water}`);
}

// ---------------------------------------------------- 3) freeze-terraforming
console.log('scenario: icelance crusts a pool into standable ice; fire melts it');
await buildChamber();
await page.evaluate((WATER) => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 528; y <= 538; y++)
    for (let x = 560; x <= 660; x++) {
      const i = w.idx(x, y);
      if (w.types[i] === 0) { w.types[i] = WATER; w.colors[i] = 0x2369f0; }
    }
  // fire a real icelance into the pool
  ctx.projectiles.push({
    x: 545, y: 500, vx: 2.6, vy: 2.2,
    type: 'icelance', life: 200, age: 0, charging: false, hostile: false,
  });
}, WATER);
await page.waitForTimeout(1500);
const iceCount = await countIn(ICE, 522, 698, 500, 545);
check('the pool crusted into ice', iceCount > 25, `ice=${iceCount}`);
// sustained flame held on the crust (a resting lava strip just cools to
// stone before it wins) - repaint the fire line every poll like a fire spell
for (let k = 0; k < 10; k++) {
  await page.evaluate(({ FIRE, ICE }) => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    for (let x = 580; x <= 640; x++) {
      for (let y = 520; y <= 538; y++) {
        const i = w.idx(x, y);
        if (w.types[i] === ICE) {
          // torch the exposed crust face
          const above = w.idx(x, y - 1);
          if (w.types[above] === 0) { w.types[above] = FIRE; w.colors[above] = 0xff4600; w.life[above] = 30; }
          break;
        }
      }
    }
  }, { FIRE, ICE });
  await page.waitForTimeout(250);
}
{
  const iceAfter = await countIn(ICE, 522, 698, 500, 545);
  check('heat melts the crust back', iceAfter < iceCount * 0.8, `ice ${iceCount} -> ${iceAfter}`);
}
check('no page errors', pageErrors.length === 0, pageErrors.join('; '));

console.log(`\n${pass} ok, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
