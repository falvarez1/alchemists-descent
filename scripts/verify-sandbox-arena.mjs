// The sandbox has to be a place you can actually work.
//
// It used to boot into `generateCaves` — campaign terrain, packed solid to
// bedrock since GEN_VERSION 30. Pretty, and useless: a falling-sand sandbox
// with nowhere to drop sand, showing a level you never play.
//
// "It looks better" is not a test, so this asserts the properties that make a
// sandbox WORK, each of which the cave map failed:
//
//   1. There is room. Most of what you see is open space.
//   2. It is enclosed. Material poured in stays in — nothing drains off-world,
//      which is what makes an experiment repeatable.
//   3. Powder falls, tumbles and piles on the cascade.
//   4. Liquid pools DEEP in the basin instead of spreading one cell thin.
//   5. The timber frame catches and burns.
//   6. You can see it. A workshop lit only by ambient rendered as a black
//      rectangle, so the lamps are load-bearing, not decoration.
//
// Usage: node scripts/verify-sandbox-arena.mjs [url]   (dev server running)
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const Cell = { Empty: 0, Sand: 1, Water: 2, Wood: 4, Fire: 5, Stone: 12, Metal: 13, Crystal: 29 };

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1400, height: 880 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 30000 });
  await page.waitForFunction(() => window.__game.ctx.state.frameCount > 5, { timeout: 20000 });

  await page.evaluate((C) => {
    const ctx = window.__game.ctx;
    window.__sb = {
      C,
      ctx,
      tick: (n) => {
        for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true });
      },
      count: (type, x0, y0, x1, y1) => {
        const w = ctx.world;
        let n = 0;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (w.inBounds(x, y) && w.types[w.idx(x, y)] === type) n++;
          }
        }
        return n;
      },
      view: () => ({
        x0: Math.floor(ctx.camera.renderX),
        y0: Math.floor(ctx.camera.renderY),
        x1: Math.floor(ctx.camera.renderX) + 574,
        y1: Math.floor(ctx.camera.renderY) + 390,
      }),
    };
  }, Cell);

  // ---- 1. Room to work in. ----
  const space = await page.evaluate(() => {
    const { ctx, view } = window.__sb;
    const v = view();
    const w = ctx.world;
    let empty = 0;
    let total = 0;
    for (let y = v.y0; y <= v.y1; y += 2) {
      for (let x = v.x0; x <= v.x1; x += 2) {
        if (!w.inBounds(x, y)) continue;
        total++;
        if (w.types[w.idx(x, y)] === 0) empty++;
      }
    }
    return { frac: empty / total, total };
  });
  check(
    'most of the view is open space to work in',
    space.frac > 0.6,
    `${(space.frac * 100).toFixed(0)}% empty`,
  );

  // ---- 2 & 3. Powder falls, tumbles, and none of it escapes. ----
  const sand = await page.evaluate(() => {
    const { ctx, C, tick, count } = window.__sb;
    const w = ctx.world;
    const cx = 800;
    // Pour onto the top cascade shelf.
    // Enough to OVERFLOW the top ledge. A short pour just fills the first one
    // and stops, which tests nothing about a cascade — holding the brush down
    // is the real gesture, so the test does that.
    let poured = 0;
    for (let y = 660; y < 716; y++) {
      for (let x = cx - 276; x < cx - 236; x++) {
        if (w.inBounds(x, y) && w.types[w.idx(x, y)] === C.Empty) {
          w.replaceCellAt(w.idx(x, y), C.Sand, 0xe0b45a);
          poured++;
        }
      }
    }
    const before = count(C.Sand, 0, 0, 1599, 1063);
    tick(400);
    const after = count(C.Sand, 0, 0, 1599, 1063);
    // Did it actually STEP DOWN? Total spread is a bad proxy — 555 cells in a
    // single floor pile measure ~58 wide at the angle of repose all on their
    // own, which looks like a cascade and is not one. Count the ledges left
    // holding sand instead: that only happens if material came to rest on each
    // one in turn.
    let ledgesLoaded = 0;
    for (let step = 0; step < 4; step++) {
      const ly = 880 - 152 + step * 34;
      const lx0 = cx - 268 + step * 34;
      let onLedge = 0;
      for (let y = ly - 26; y < ly; y++) {
        for (let x = lx0; x < lx0 + 40; x++) {
          if (w.inBounds(x, y) && w.types[w.idx(x, y)] === C.Sand) onLedge++;
        }
      }
      if (onLedge > 12) ledgesLoaded++;
    }
    return { poured, before, after, ledgesLoaded };
  });
  check('sand can be poured into open space', sand.poured > 300, `${sand.poured} cells`);
  check(
    'nothing drains out of the world — the arena is enclosed',
    sand.after >= sand.before * 0.98,
    `${sand.before} poured -> ${sand.after} still present`,
  );
  // >= 2, not 4: what matters is that material comes to rest on a ledge BELOW
  // the one it was poured onto, which is the definition of cascading. How far
  // down it gets is a function of how long you hold the brush, so demanding all
  // four would be asserting the size of the pour, not the shape of the arena.
  check(
    'powder steps DOWN the cascade rather than dropping past it',
    sand.ledgesLoaded >= 2,
    `${sand.ledgesLoaded} of 4 ledges holding sand`,
  );

  // ---- 4. Liquid pools deep in the basin. ----
  const pool = await page.evaluate(() => {
    const { ctx, C, tick } = window.__sb;
    const w = ctx.world;
    const cx = 800;
    for (let y = 800; y < 830; y++) {
      for (let x = cx - 120; x < cx - 50; x++) {
        if (w.inBounds(x, y) && w.types[w.idx(x, y)] === C.Empty) {
          w.replaceCellAt(w.idx(x, y), C.Water, 0x2369f0);
        }
      }
    }
    tick(500);
    // Deepest continuous column of water anywhere in the basin.
    let deepest = 0;
    for (let x = cx - 130; x < cx - 40; x++) {
      let run = 0;
      for (let y = 830; y < 935; y++) {
        if (w.inBounds(x, y) && w.types[w.idx(x, y)] === C.Water) run++;
        else run = 0;
        if (run > deepest) deepest = run;
      }
    }
    return { deepest };
  });
  check(
    'liquid pools deep in the basin, not one cell thin across the floor',
    pool.deepest >= 10,
    `${pool.deepest} cells deep`,
  );

  // ---- 5. The timber frame burns. ----
  const burn = await page.evaluate(() => {
    const { ctx, C, tick, count } = window.__sb;
    const w = ctx.world;
    const cx = 800;
    const woodBefore = count(C.Wood, cx + 150, 700, cx + 320, 900);
    // Light it at the base of the left upright.
    for (let y = 860; y < 875; y++) {
      for (let x = cx + 190; x < cx + 202; x++) {
        if (w.inBounds(x, y)) {
          w.replaceCellAt(w.idx(x, y), C.Fire, 0xff7a1e);
          w.life[w.idx(x, y)] = 300;
        }
      }
    }
    tick(700);
    const woodAfter = count(C.Wood, cx + 150, 700, cx + 320, 900);
    return { woodBefore, woodAfter, burned: woodBefore - woodAfter };
  });
  check(
    'the timber frame really burns',
    burn.woodBefore > 100 && burn.burned > 20,
    `${burn.burned} of ${burn.woodBefore} wood cells consumed`,
  );

  // ---- 6. You can see it. ----
  const lit = await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const canvas = document.querySelector('#canvas-holder > canvas');
          const off = document.createElement('canvas');
          off.width = 200;
          off.height = 130;
          const g = off.getContext('2d');
          g.drawImage(canvas, 0, 0, off.width, off.height);
          const { data } = g.getImageData(0, 0, off.width, off.height);
          let visible = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] + data[i + 1] + data[i + 2] > 60) visible++;
          }
          resolve({ visible, of: data.length / 4 });
        });
      }),
  );
  check(
    'the workshop is lit well enough to see',
    lit.visible > 900,
    `${lit.visible} of ${lit.of} sampled pixels above black`,
  );

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
