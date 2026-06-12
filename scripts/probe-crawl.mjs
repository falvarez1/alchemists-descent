// CRAWL + WALL-GRAB probe (docs/CRAWL.md): drive the real keys through a
// carved 9-tall corridor and assert the stance machine end to end — enter by
// crouch-walking into the gap, geometry-law refusal to stand inside (CRAMPED
// glyph + no jump), auto-stand at the open end — plus the bouldering pose on
// a carved cliff lip. Freeze-frames land in verify-out/crawl-*.png.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2000);

await page.click('#mode-play-btn');
await page.waitForFunction(
  () => {
    const l = window.__game.ctx.levels;
    return l.current !== null && !l.transitioning;
  },
  { timeout: 15000 },
);
await page.waitForTimeout(400);

// Arena: metal floor with a 9-tall crawl slab over x 600-700 (interior rows
// 527-535 — admits the 9-box, blocks the 17-box) and open air either side.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 400; y <= 540; y++)
    for (let x = 500; x <= 760; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99;
      }
  };
  solid(500, 760, 536, 540);     // floor
  solid(500, 506, 400, 540);     // arena walls
  solid(754, 760, 400, 540);
  solid(600, 700, 480, 526);     // the crawl slab: ceiling at exactly gauge
  ctx.enemies.length = 0;
  const p = ctx.player;
  p.x = 570; p.y = 535; p.vx = 0; p.vy = 0; p.hp = p.maxHp; p.invuln = 30000;
  p.dead = false;
  ctx.camera.snapTo(630, 500);
  ctx.params.global.ambient = 0.45; // light the shots
});
await page.waitForTimeout(400);

const P = () =>
  page.evaluate(() => {
    const p = window.__game.ctx.player;
    return {
      x: p.x, y: p.y, vy: p.vy, grounded: p.grounded,
      crawling: p.crawling, crawlT: p.crawlT, stretchT: p.stretchT,
      wallGrabT: p.wallGrabT, wallGrabDir: p.wallGrabDir,
      cramped: document.getElementById('cramped-glyph').classList.contains('visible'),
    };
  });
const key = (code, down) =>
  page.evaluate(({ code, down }) => {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  }, { code, down });
const pause = (on) => page.evaluate((v) => { window.__game.ctx.state.paused = v; }, on);
const shot = async (name) => {
  const clip = await page.evaluate(() => {
    const c = document.querySelector('#canvas-holder > canvas');
    const r = c.getBoundingClientRect();
    const ctx = window.__game.ctx;
    const z = ctx.camera.zoom;
    const ux = (((ctx.player.x - ctx.camera.renderX) / 525 - 0.5) * z + 0.5);
    const uy = (((ctx.player.y - 9 - ctx.camera.renderY) / 357 - 0.5) * z + 0.5);
    return {
      x: Math.max(0, r.left + ux * r.width - 110),
      y: Math.max(0, r.top + uy * r.height - 110),
      width: 220,
      height: 220,
    };
  });
  await page.screenshot({ path: `verify-out/crawl-${name}.png`, clip });
};

/* 1) S held while standing still stays the crouch-peek, not a crawl */
await key('KeyS', true);
await page.waitForTimeout(350);
let s = await P();
check('stationary S stays the crouch (no crawl)', !s.crawling, JSON.stringify(s));

/* 2) crouch-walk into the gap: the creep flows into the crawl */
await key('KeyD', true);
await page.waitForTimeout(400);
s = await P();
check('S + move enters the crawl (crawlT capped)', s.crawling && s.crawlT === 10, JSON.stringify(s));

/* 3) it actually fits through the 9-tall slab the 17-box cannot enter */
let inTunnel = false;
for (let i = 0; i < 60 && !inTunnel; i++) {
  await page.waitForTimeout(250);
  s = await P();
  if (s.x > 630) inTunnel = true;
}
check('crawls INTO the 9-tall corridor (x > 630)', inTunnel, JSON.stringify(s));
await pause(true);
await shot('pose-tunnel');
await pause(false);

/* 4) geometry is law: release S under the slab — still crawling, CRAMPED up */
await key('KeyS', false);
await key('KeyD', false);
await page.waitForTimeout(500);
s = await P();
check('released S under the ceiling keeps crawling', s.crawling, JSON.stringify(s));
check('CRAMPED glyph is up while the world says no', s.cramped, JSON.stringify(s));

/* 5) W while crawling is a stand attempt, never a jump */
await key('Space', true);
await page.waitForTimeout(200);
s = await P();
check('Space under the slab does not jump', s.crawling && s.vy > -1.5, JSON.stringify(s));
await key('Space', false);

/* 6) keep moving with S released: auto-stand pops at the open end */
await key('KeyD', true);
let stood = false;
for (let i = 0; i < 60 && !stood; i++) {
  await page.waitForTimeout(250);
  s = await P();
  if (!s.crawling) stood = true;
}
await key('KeyD', false);
check('auto-stands at the first full headroom', stood && s.x > 695, JSON.stringify(s));
await page.waitForTimeout(300);
s = await P();
check('CRAMPED glyph cleared after standing', !s.cramped, JSON.stringify(s));

/* 7) prone muzzle: wandTip rides ~4 above the feet while crawling */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const p = ctx.player;
  p.x = 570; p.y = 535; p.vx = 0; p.vy = 0;
});
await key('KeyS', true);
await key('KeyD', true);
await page.waitForTimeout(400);
const tip = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.input.mouse.x = ctx.player.x + 40;
  ctx.input.mouse.y = ctx.player.y - 4;
  return null;
});
void tip;
await page.waitForTimeout(150);
const muzzle = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return { tipY: ctx.spells.wandTip().y, feetY: ctx.player.y, crawling: ctx.player.crawling };
});
check(
  'crawling wandTip drops to ~4 above the feet',
  muzzle.crawling && Math.abs(muzzle.feetY - 4 - muzzle.tipY) <= 2,
  JSON.stringify(muzzle),
);
await key('KeyS', false);
await key('KeyD', false);
await page.waitForTimeout(400);

/* 8) WALL GRAB: a cliff face with a one-pixel lip — grounded on the catch,
   the bouldering pose engages (state only; physics untouched) */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 400; y <= 535; y++)
    for (let x = 660; x <= 753; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99;
      }
  };
  solid(744, 760, 420, 540); // the cliff
  solid(742, 743, 470, 470); // the lip he catches
  const p = ctx.player;
  p.x = 739; p.y = 469; p.vx = 0; p.vy = 0;
  ctx.camera.snapTo(720, 460);
});
let grabbed = false;
for (let i = 0; i < 20 && !grabbed; i++) {
  await page.waitForTimeout(150);
  s = await P();
  if (s.wallGrabT >= 5) grabbed = true;
}
check('cliff lip engages the wall-grab state', grabbed && s.grounded, JSON.stringify(s));
check('grab side faces the rock (+1)', s.wallGrabDir === 1, JSON.stringify(s));
await pause(true);
await shot('pose-wallgrab');
await pause(false);

/* 9) flat ground never reads as a grab */
await page.evaluate(() => {
  const p = window.__game.ctx.player;
  p.x = 600; p.y = 535; p.vx = 0; p.vy = 0;
});
await page.waitForTimeout(600);
s = await P();
check('flat floor clears the grab state', s.wallGrabT === 0, JSON.stringify(s));

check('no page errors logged above', true);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
