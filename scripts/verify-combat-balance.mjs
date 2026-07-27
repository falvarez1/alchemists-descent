// Playability guardrails for combat (blood, shock, enemy damage).
//
// These four numbers are what a player actually feels, and three of them had
// drifted far enough to make the game read as unfair rather than hard:
//
//   * a shot died in the blood its own last kill left on the floor, so an arena
//     got harder to shoot across the longer you fought in it;
//   * `shockDamage` sat at 9.2 — a typo for 0.2, 46x the intended value and 9x
//     above the top of its own Builder slider — so firing at the ground near
//     your feet electrified what you were standing on and killed you in under
//     a second;
//   * two or three kills drowned the floor in gore;
//   * enemy attacks against 100 HP put death five connected blows away.
//
// Balance lives in mutable params by design, which means nothing stops it
// drifting again. This asserts the OUTCOMES in a real browser — time to die,
// damage per blow, blood left standing, and whether a shot crosses a puddle —
// rather than asserting the constants, which would just restate them.
//
// Usage: node scripts/verify-combat-balance.mjs [url]   (dev server running)
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

const Cell = { Empty: 0, Water: 2, Metal: 13, Blood: 18 };

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 30000 });
  await page.click('#mode-play-btn');
  await page.waitForSelector('#run-launcher.visible', { timeout: 20000 });
  await page.click('#run-launcher .run-launcher-start');
  await page.waitForFunction(() => document.body.classList.contains('play-active'), null, {
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__game.ctx.player.hp > 0, null, { timeout: 30000 });

  await page.evaluate((C) => {
    const ctx = window.__game.ctx;
    window.__cb = { C, ctx };

    /** Clear a room around a point and stand the wizard in it. The player is 17
     *  cells tall, so the carve needs real headroom or he wedges and every
     *  movement assertion quietly passes against a stuck body. */
    window.__cb.arena = (cx, cy, w = 90, h = 46) => {
      const world = ctx.world;
      for (let y = cy - h; y <= cy + 6; y++) {
        for (let x = cx - w; x <= cx + w; x++) {
          if (!world.inBounds(x, y)) continue;
          world.replaceCellAt(world.idx(x, y), C.Empty, 0);
        }
      }
      for (let x = cx - w; x <= cx + w; x++) {
        for (let d = 1; d <= 3; d++) {
          if (world.inBounds(x, cy + d)) world.replaceCellAt(world.idx(x, cy + d), C.Metal, 0x60707f);
        }
      }
      ctx.enemies.length = 0;
      ctx.projectiles.length = 0;
      ctx.player.x = cx;
      ctx.player.y = cy - 2;
      ctx.player.vx = 0;
      ctx.player.vy = 0;
      ctx.player.dead = false;
      ctx.player.hp = ctx.player.maxHp;
      ctx.player.invuln = 0;
      Object.keys(ctx.player.status).forEach((k) => {
        if (typeof ctx.player.status[k] === 'number') ctx.player.status[k] = 0;
      });
      ctx.camera.snapTo(cx, cy - 2);
      ctx.camera.updateSimBounds(world);
    };

    window.__cb.tick = (n) => {
      for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true });
    };
  }, Cell);

  // ---- 1. A shot crosses a blood pool instead of dying in it. ----
  const throughBlood = await page.evaluate(() => {
    const { ctx, C, arena, tick } = window.__cb;
    const cx = 800;
    const cy = 500;
    arena(cx, cy);
    // A wall of blood between the wizard and where he is shooting.
    for (let x = cx + 18; x <= cx + 26; x++) {
      for (let y = cy - 12; y <= cy - 1; y++) {
        ctx.world.replaceCellAt(ctx.world.idx(x, y), C.Blood, 0xa00c19);
      }
    }
    ctx.projectiles.length = 0;
    ctx.projectiles.push({
      x: cx + 4,
      y: cy - 6,
      vx: 6,
      vy: 0,
      life: 200,
      type: 'bolt',
      dmg: 10,
      hostile: false,
      r: 1,
    });
    let maxX = ctx.projectiles[0].x;
    for (let i = 0; i < 40; i++) {
      tick(1);
      if (ctx.projectiles.length === 0) break;
      maxX = Math.max(maxX, ctx.projectiles[0].x);
    }
    return { maxX, travelled: maxX - (cx + 4), pastPool: maxX > cx + 30 };
  });
  check(
    'a bolt flies through a blood pool',
    throughBlood.pastPool,
    `travelled ${throughBlood.travelled.toFixed(0)} cells, needed >26`,
  );

  // ---- 2. Standing in your own electrified puddle is survivable. ----
  const shock = await page.evaluate(() => {
    const { ctx, C, arena, tick } = window.__cb;
    const cx = 800;
    const cy = 500;
    arena(cx, cy);
    const world = ctx.world;
    // Wet feet in charged water: the WORST case, since wet triples shock.
    for (let x = cx - 10; x <= cx + 10; x++) {
      for (let y = cy - 2; y <= cy; y++) {
        const i = world.idx(x, y);
        world.replaceCellAt(i, C.Water, 0x2369f0);
        world.setChargeAt(i, 200);
      }
    }
    const before = ctx.player.hp;
    tick(60); // one second
    return { before, after: ctx.player.hp, lost: before - ctx.player.hp, dead: ctx.player.dead };
  });
  // At the 9.2 typo this was ~828 dps wet — instant death. Restored to 0.2 it
  // is a real threat you can walk out of.
  check(
    'a second standing in charged water does not kill you',
    !shock.dead && shock.lost < 45,
    `lost ${shock.lost.toFixed(1)} hp of ${shock.before}`,
  );
  check('...but electricity still hurts', shock.lost > 0.5, `lost ${shock.lost.toFixed(1)} hp`);

  // ---- 3. Enemy blows leave room to react. ----
  const melee = await page.evaluate(() => {
    const { ctx, arena, tick } = window.__cb;
    const cx = 800;
    const cy = 500;
    const out = {};
    for (const kind of ['slime', 'bat', 'golem']) {
      arena(cx, cy);
      ctx.state.debugGodMode = false;
      const e = ctx.enemyCtl.spawn(kind, cx + 8, cy - 2);
      if (!e) {
        out[kind] = null;
        continue;
      }
      const start = ctx.player.hp;
      let hits = 0;
      let last = start;
      for (let i = 0; i < 600 && !ctx.player.dead; i++) {
        tick(1);
        if (ctx.player.hp < last - 0.5) {
          hits++;
          last = ctx.player.hp;
        }
      }
      out[kind] = {
        hits,
        lost: start - ctx.player.hp,
        perHit: hits > 0 ? (start - ctx.player.hp) / hits : 0,
        died: ctx.player.dead,
        ticks: 600,
      };
    }
    return out;
  });
  for (const [kind, r] of Object.entries(melee)) {
    if (!r) {
      check(`${kind} spawned`, false, 'spawn returned null');
      continue;
    }
    check(
      `a ${kind} needs more than 6 blows to kill you`,
      r.perHit === 0 || r.perHit <= 100 / 6,
      `${r.perHit.toFixed(1)} dmg/hit over ${r.hits} hits`,
    );
  }
  check(
    'the wizard survives 10 seconds of melee',
    !Object.values(melee).some((r) => r && r.died),
    JSON.stringify(melee),
  );

  // ---- 4. A kill does not drown the floor. ----
  const gore = await page.evaluate(() => {
    const { ctx, C, arena, tick } = window.__cb;
    const cx = 800;
    const cy = 500;
    arena(cx, cy);
    const world = ctx.world;
    const countBlood = () => {
      let n = 0;
      for (let y = cy - 40; y <= cy + 4; y++) {
        for (let x = cx - 80; x <= cx + 80; x++) {
          if (world.inBounds(x, y) && world.types[world.idx(x, y)] === C.Blood) n++;
        }
      }
      return n;
    };
    const e = ctx.enemyCtl.spawn('golem', cx + 20, cy - 2);
    if (!e) return null;
    ctx.enemyCtl.damage(e, 10_000, 0, 0);
    tick(180); // let the spray land and settle
    return { blood: countBlood() };
  });
  check(
    'a golem kill leaves a readable floor',
    gore && gore.blood < 2600,
    gore ? `${gore.blood} blood cells` : 'golem spawn failed',
  );
  check('...but it is still visibly gory', gore && gore.blood > 120, gore ? `${gore.blood} cells` : '');

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
