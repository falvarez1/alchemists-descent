// Shared harness for the fighter probes (docs/FIGHTERS.md). One way to do the things every fighter
// probe does, so a kit is verified the same way as the next: boot a carved test arena in the real game,
// equip a fighter, spawn foes, press Z / T with REAL key events, step ticks, read the HUD view, shoot.
//
//   import { boot, tick, press, view, spawn, state, shot, makeChecker } from './fighter-probe.mjs';
//   const { page, finish } = await boot(url, { fighter: 'ilyra-voss' });
//
// The world starts PAUSED and you step it with `tick` (the game's own tick, forced), so every assertion is
// deterministic. The renderer keeps drawing the paused frame, so `shot` shows exactly where you stopped.
// `live(page)` hands the world back to the real-time loop; `still(page)` pauses it again.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

export const ARENA = { x0: 380, x1: 620, floorY: 690, top: 600, spawnX: 440 };

/** A pass/fail counter with the repo's probe output style. */
export function makeChecker() {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) { pass++; console.log('  ok    ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); }
  };
  return { check, get pass() { return pass; }, get fail() { return fail; } };
}

/**
 * Launch, boot the game, start a test run in `physics-test`, carve a stone-floored arena (ARENA) and
 * stand the alchemist in it. Returns { browser, page, errors, finish() }. `finish()` closes the browser
 * and returns the number of page errors.
 */
export async function boot(url = 'http://localhost:5173/', opts = {}) {
  const { fighter = null, viewport = { width: 1400, height: 860 }, hp = 100 } = opts;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle', timeout: 40000 });
  await leaveTitleIfShown(page);
  await waitForConsoleApi(page);
  await page.waitForFunction(() => window.__game?.ctx?.enemyCtl, { timeout: 20000 });
  await page.evaluate(async ({ ARENA, fighter, hp }) => {
    const { Cell } = await import('/src/sim/CellType.ts');
    const { stoneColor } = await import('/src/sim/colors.ts');
    const ctx = window.__game.ctx;
    await ctx.console.exec('run test --level physics-test --world campaign-level');
    for (let f = 0; f < 20; f++) window.__game.tick();
    const w = ctx.world, p = ctx.player;
    for (let y = ARENA.top; y <= ARENA.floorY + 10; y++) for (let x = ARENA.x0; x <= ARENA.x1; x++) if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
    for (let y = ARENA.floorY; y <= ARENA.floorY + 6; y++) for (let x = ARENA.x0; x <= ARENA.x1; x++) w.replaceCellAt(w.idx(x, y), Cell.Stone, stoneColor());
    ctx.state.mode = 'play';
    ctx.state.paused = false;
    // A floor's first seconds are an arrival grace in which nothing damages the alchemist.
    ctx.state.arrivalGraceUntil = 0;
    ctx.fx.hitstop = 0;
    ctx.enemies.length = 0;
    ctx.critters.clear?.();
    Object.assign(p, { dead: false, hp, maxHp: hp, invuln: 0, crawling: false, climbing: false, swinging: false, x: ARENA.spawnX, y: ARENA.floorY - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true });
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
    ctx.fighters.equip(fighter);
    await ctx.fighters.whenReady(); // the kit loads on demand, one small chunk
    window.__game.tick();
    // Hold the real-time loop still and step by hand: the probe, not the clock, decides when a tick happens.
    ctx.state.paused = true;
    window.__fp = {
      Cell,
      ARENA,
      ctx,
      tick: (n = 1) => { for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true }); },
      /** Spawn a foe on the floor `dx` cells from the alchemist (negative = behind); awake and unaggressive until told otherwise. */
      spawn: (kind, dx, opts = {}) => {
        const x = Math.round(p.x + dx), y = opts.y ?? ARENA.floorY - 1;
        ctx.enemyCtl.spawn(kind, x, y);
        const e = ctx.enemies[ctx.enemies.length - 1];
        Object.assign(e, { x, y, fx: 0, fy: 0, vx: 0, vy: 0, sleeping: false, alerted: false });
        if (opts.hp) { e.hp = e.maxHp = opts.hp; }
        return e;
      },
      /** Solid blocks for cover / walls in the arena (stone). */
      wall: (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), Cell.Stone, stoneColor()); },
      carve: (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y)); },
      count: (type, x0, y0, x1, y1) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y) && w.types[w.idx(x, y)] === type) n++; return n; },
      view: () => JSON.parse(JSON.stringify(ctx.fighters.view)),
      me: () => ({ x: p.x, y: p.y, vx: +p.vx.toFixed(2), vy: +p.vy.toFixed(2), hp: +p.hp.toFixed(1), facing: p.facing, grounded: p.grounded, invuln: p.invuln, status: { ...p.status } }),
      /** Aim at a world point: the mouse is the aim, so set the aim angle the way the input layer does. */
      aimAt: (wx, wy) => { ctx.input.mouse.x = wx; ctx.input.mouse.y = wy; p.aimAngle = Math.atan2(wy - (p.y - 9), wx - p.x); },
    };
  }, { ARENA, fighter, hp });
  return {
    browser, page, errors,
    async finish() { await browser.close(); return errors.length; },
  };
}

/** Step `n` ticks of the game. */
export const tick = (page, n = 1) => page.evaluate((k) => window.__fp.tick(k), n);

/** A REAL key press (keydown + keyup through the page's input layer), then `ticks` of game. */
export async function press(page, code, ticks = 1) {
  await page.keyboard.down(code);
  await page.evaluate((k) => window.__fp.tick(k), Math.max(1, ticks));
  await page.keyboard.up(code);
}

/** Hold a movement key for `ticks`, ticking in between. */
export async function hold(page, code, ticks) {
  await page.keyboard.down(code);
  await page.evaluate((k) => window.__fp.tick(k), ticks);
  await page.keyboard.up(code);
}

export const view = (page) => page.evaluate(() => window.__fp.view());
export const me = (page) => page.evaluate(() => window.__fp.me());
export const spawn = (page, kind, dx, opts) => page.evaluate(({ kind, dx, opts }) => { const e = window.__fp.spawn(kind, dx, opts); return { x: e.x, y: e.y, hp: e.hp }; }, { kind, dx, opts });

/** The harness starts paused (you step with `tick`); `live` hands the world back to the real-time loop, `hold` re-pauses it. */
export const live = (page) => page.evaluate(() => { window.__fp.ctx.state.paused = false; });
export const still = (page) => page.evaluate(() => { window.__fp.ctx.state.paused = true; });
export const aimAt = (page, wx, wy) => page.evaluate(({ wx, wy }) => window.__fp.aimAt(wx, wy), { wx, wy });

/** Screenshot the canvas area to verify-out/fighters/<name>.png. */
export async function shot(page, name) {
  mkdirSync('verify-out/fighters', { recursive: true });
  const path = `verify-out/fighters/${name}.png`;
  await page.screenshot({ path });
  return path;
}
