// Runtime verification of the alchemist's bargains (Sanctum boons that change how the
// world is met): Rime Soles (a pool is a road), Sexton's Grip (the wand's hold on the
// fallen costs half), Insulated Boots (current bites a quarter as hard), and the Sanctum
// draft + pause-menu readback in a real run. Long Fuse / Velvet Hood / Warm Blood are pure
// rules with unit tests (tests/boons.test.ts, tests/alchemy-kills.test.ts).
// Usage (dev server running): node scripts/verify-boons.mjs [url]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleTestRun, waitForOpeningEnd } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out/boons';
mkdirSync(outDir, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' ' + detail : '')); }
};

const browser = await launchBrowser();
const consoleErrors = [];
const pageErrors = [];
const watch = (page) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
};

// The arena: a stone shelf (surface row 462) with a pool sunk into it, water level with the ground.
//   stone  x 300..430, y 462..480     pool  x 340..380, y 462..470 (walled by the shelf itself)
const ARENA = { x0: 300, x1: 430, floor: 462, poolX0: 340, poolX1: 380, poolY1: 470 };
const ALL_OLD_BOONS = ['might', 'vampirism', 'featherweight', 'manafont', 'swiftfoot', 'ironhide', 'flameward', 'toxinward', 'goldmagnet'];

const world = await browser.newPage({ viewport: { width: 1440, height: 810 } });
watch(world);

async function buildArena(perks, hp = 100) {
  return world.evaluate(async ({ A, perks, hp }) => {
    const { Cell } = await import('/src/sim/CellType.ts');
    const { stoneColor, waterColor } = await import('/src/sim/colors.ts');
    const ctx = window.__game.ctx;
    const w = ctx.world;
    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.state.arrivalGraceUntil = 0;
    ctx.fx.hitstop = 0;
    ctx.enemies.length = 0;
    ctx.rigidBodies.clear();
    ctx.particles.clear();
    w.clear();
    w.simBounds.x0 = A.x0 - 30;
    w.simBounds.y0 = A.floor - 90;
    w.simBounds.x1 = A.x1 + 30;
    w.simBounds.y1 = A.floor + 30;
    for (let y = A.floor; y <= A.floor + 18; y++) for (let x = A.x0; x <= A.x1; x++) w.replaceCellAt(w.idx(x, y), Cell.Stone, stoneColor());
    for (let y = A.floor; y <= A.poolY1; y++) for (let x = A.poolX0; x <= A.poolX1; x++) w.replaceCellAt(w.idx(x, y), Cell.Water, waterColor());
    const p = ctx.player;
    p.dead = false;
    p.hp = hp;
    p.maxHp = 100;
    p.vx = 0;
    p.vy = 0;
    p.x = A.x0 + 30;
    p.y = A.floor - 1;
    p.invuln = 0;
    p.perks = {};
    for (const perk of perks) p.perks[perk] = true;
    ctx.camera.x = p.x - 200;
    ctx.camera.y = p.y - 150;
    return { x: p.x, y: p.y };
  }, { A: ARENA, perks, hp });
}

const playerState = () => world.evaluate(() => {
  const p = window.__game.ctx.player;
  return { x: p.x, y: p.y, hp: p.hp, inLiquid: p.inLiquid, dead: p.dead };
});

/** Hold D for `ms`, sampling the alchemist as fast as the page answers; returns the trace. */
async function walkRight(ms) {
  const trace = [];
  await world.keyboard.down('KeyD');
  const t0 = Date.now();
  while (Date.now() - t0 < ms) trace.push(await playerState());
  await world.keyboard.up('KeyD');
  trace.push(await playerState());
  return trace;
}

try {
  await world.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(world, { level: 'physics-test', world: 'campaign-level', seed: 31, settleMs: 300 });

  // ---- Rime Soles: cross the pool on foot -------------------------------------------------
  await buildArena(['rimesoles']);
  await world.waitForTimeout(400);
  const soles = await walkRight(2600);
  const over = soles.filter((s) => s.x > ARENA.poolX0 + 3 && s.x < ARENA.poolX1 - 3);
  check('Rime Soles: the alchemist walks out over the pool', over.length >= 3, `samples over the pool: ${over.length} of ${soles.length}`);
  check('Rime Soles: never swims (stays on the skin, feet at the shelf line)', over.every((s) => !s.inLiquid && s.y <= ARENA.floor - 1 + 1.5), JSON.stringify(over.slice(0, 3)));
  check('Rime Soles: the far shore is reached', soles.some((s) => s.x > ARENA.poolX1 + 3), `max x ${Math.max(...soles.map((s) => s.x))}`);
  const road = await world.evaluate(async ({ A }) => {
    const { Cell } = await import('/src/sim/CellType.ts');
    const w = window.__game.ctx.world;
    let ice = 0;
    let deep = 0;
    for (let x = A.poolX0; x <= A.poolX1; x++) {
      if (w.types[w.idx(x, A.floor)] === Cell.Ice) ice++;
      if (w.types[w.idx(x, A.floor + 3)] === Cell.Water) deep++;
    }
    return { ice, deep, width: A.poolX1 - A.poolX0 + 1 };
  }, { A: ARENA });
  check('Rime Soles: the road is real ice cells laid on the surface', road.ice >= 20, JSON.stringify(road));
  check('Rime Soles: only a skin — the pool beneath is still water', road.deep >= road.width - 2, JSON.stringify(road));
  await world.evaluate(() => {
    // The arena's title card never fades (a real floor's does): clear it, and frame the crossing.
    const banner = document.getElementById('wave-banner');
    if (banner) banner.style.display = 'none';
    const ctx = window.__game.ctx;
    ctx.camera.zoomLock = 3;
  });
  await world.waitForTimeout(300);
  await world.screenshot({ path: `${outDir}/rime-soles.png` });

  // Control: the same walk without the boon is a swim.
  await buildArena([]);
  await world.waitForTimeout(400);
  const swim = await walkRight(2600);
  check('control: without the boon the pool is waded or swum', swim.some((s) => s.inLiquid || s.y > ARENA.floor), JSON.stringify(swim[swim.length - 1]));

  // ---- Sexton's Grip: the same lift and hold, for half the mana -----------------------------
  const gripRun = async (perks) => {
    await buildArena(perks);
    const setup = await world.evaluate(async () => {
      const { clearCorpses, corpses } = await import('/src/creatures/corpses.ts');
      const { emptySample, sampleBody } = await import('/src/creatures/corpseBody.ts');
      const ctx = window.__game.ctx;
      clearCorpses();
      const e = ctx.enemyCtl.spawn('spitter', ctx.player.x + 40, ctx.player.y);
      ctx.enemyCtl.kill(e, 0.5, -0.5);
      for (let f = 0; f < 120; f++) window.__game.tick();
      const c = corpses()[0];
      if (!c) return { ok: false };
      const s = sampleBody(c.e, emptySample());
      ctx.input.mouse.x = s.x;
      ctx.input.mouse.y = s.y;
      const wand = ctx.wands.wands[ctx.wands.active];
      wand.mana = wand.frame.manaMax;
      return { ok: true, mana: wand.mana };
    });
    if (!setup.ok) return { ok: false };
    await world.keyboard.press('KeyE'); // a REAL press: E on the fallen under the cursor lifts it
    return world.evaluate(async () => {
      // The grip is state on the corpse itself (a second import of the verb would be a second instance).
      const { corpses } = await import('/src/creatures/corpses.ts');
      const ctx = window.__game.ctx;
      const wand = ctx.wands.wands[ctx.wands.active];
      const held = () => corpses().some((c) => c.grip !== null && c.grip !== undefined);
      const lifted = held();
      const afterGrab = wand.mana;
      // Hold it up for a second and a half of fixed steps (the cursor stays on the body).
      for (let f = 0; f < 90; f++) window.__game.tick();
      return { ok: true, held: lifted, stillHeld: held(), grab: wand.frame.manaMax - afterGrab, total: wand.frame.manaMax - wand.mana };
    });
  };
  const plainGrip = await gripRun([]);
  const sexton = await gripRun(['stronggrip']);
  check('Sexton’s Grip: a real E press lifts the fallen (control and boon)', plainGrip.held && sexton.held, JSON.stringify({ plainGrip, sexton }));
  check('Sexton’s Grip: the grab costs about half', sexton.grab < plainGrip.grab * 0.6, JSON.stringify({ plain: plainGrip.grab, sexton: sexton.grab }));
  check('Sexton’s Grip: holding it aloft costs less than the unboosted grip', sexton.total < plainGrip.total * 0.85, JSON.stringify({ plain: plainGrip.total, sexton: sexton.total }));

  // ---- Insulated Boots ---------------------------------------------------------------------
  const shockRun = async (perks) => {
    await buildArena(perks, 100);
    return world.evaluate(async ({ A }) => {
      const ctx = window.__game.ctx;
      const w = ctx.world;
      const p = ctx.player;
      // Stand in the pool (water to the chest) and keep the water live.
      p.x = (A.poolX0 + A.poolX1) / 2;
      p.y = A.poolY1 - 1;
      p.hp = 100;
      const wet = [];
      for (let y = A.floor; y <= A.poolY1; y++) for (let x = A.poolX0; x <= A.poolX1; x++) wet.push(w.idx(x, y));
      for (let f = 0; f < 80; f++) {
        for (const i of wet) w.setChargeAt(i, 60);
        p.hp = Math.max(p.hp, 1);
        window.__game.tick();
      }
      return { hp: p.hp, dead: p.dead };
    }, { A: ARENA });
  };
  const shocked = await shockRun([]);
  const insulated = await shockRun(['grounded']);
  const lostPlain = 100 - shocked.hp;
  const lostGround = 100 - insulated.hp;
  check('Insulated Boots: a charged pool bites the unshod (control)', lostPlain > 3, `lost ${lostPlain.toFixed(1)} hp`);
  check('Insulated Boots: and a quarter as hard when grounded', lostGround < lostPlain * 0.5, `lost ${lostGround.toFixed(1)} vs ${lostPlain.toFixed(1)} hp`);
} catch (error) {
  fail++;
  console.log('  FAIL  arena part crashed: ' + (error && error.stack ? error.stack : error));
}
await world.close();

// ---- The Sanctum draft and the pause-menu readback, in a REAL run (a fresh browser profile) --
const real = await browser.newPage({ viewport: { width: 1440, height: 810 } });
watch(real);
try {
  await real.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await real.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 30000 });
  await real.locator('#expedition-entry [data-entry="begin"]').click();
  await waitForOpeningEnd(real);
  await real.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play' && window.__game.ctx.run?.active, null, { timeout: 30000 });

  // Let the arrival's story beats (the lift, the Docent's first line) finish before the Sanctum sits over them.
  await real.waitForTimeout(9000);
  // The draft: three cards, all drawn from the pool, laid out inside their frames.
  await real.evaluate((owned) => {
    const ctx = window.__game.ctx;
    // Own the older boons so the draft can only show Vitality and the new bargains.
    for (const id of owned) ctx.player.perks[id] = true;
    ctx.sanctum.open(ctx, () => undefined);
  }, ALL_OLD_BOONS);
  await real.locator('#perk-row .perk-card').first().waitFor({ state: 'visible', timeout: 5000 });
  const draft = await real.evaluate(() => [...document.querySelectorAll('#perk-row .perk-card')].map((card) => {
    const name = card.querySelector('.pk-name')?.textContent ?? '';
    const desc = card.querySelector('.pk-desc')?.textContent ?? '';
    const r = card.getBoundingClientRect();
    return { name, desc, w: r.width, h: r.height, overflow: card.scrollWidth > card.clientWidth + 1 || card.scrollHeight > card.clientHeight + 1 };
  }));
  const PERK_BY_NAME = { 'Sexton’s Grip': 'stronggrip', 'Rime Soles': 'rimesoles', 'Long Fuse': 'longfuse', 'Velvet Hood': 'velvethood', 'Insulated Boots': 'grounded', 'Warm Blood': 'warmblood' };
  check('Sanctum offers three boons', draft.length === 3, JSON.stringify(draft.map((d) => d.name)));
  check('the draft is drawn from Vitality and the new bargains', draft.every((d) => d.name === 'Vitality' || d.name in PERK_BY_NAME), JSON.stringify(draft.map((d) => d.name)));
  check('no boon card overflows its frame', draft.every((d) => !d.overflow), JSON.stringify(draft));
  await real.screenshot({ path: `${outDir}/sanctum-draft.png` });

  // Strike a bargain with a REAL click, then read it back in the pause menu.
  const picked = draft.find((d) => d.name in PERK_BY_NAME) ?? draft[0];
  await real.locator('#perk-row .perk-card', { hasText: picked.name }).first().click();
  const owned = await real.evaluate(() => Object.keys(window.__game.ctx.player.perks));
  check('choosing a card sets the boon', picked.name === 'Vitality' || owned.includes(PERK_BY_NAME[picked.name]), `${picked.name}: ${owned}`);
  // Descend is armed once a boon AND (where the stair forks) a door are chosen; the callback above declines the trip.
  const doors = real.locator('#sanctum-overlay .sanc-door');
  if ((await doors.count()) > 0) await doors.first().click();
  await real.locator('#descend-btn:not([disabled])').click();
  await real.waitForFunction(() => !document.getElementById('sanctum-overlay')?.classList.contains('visible'), null, { timeout: 5000 });
  await real.evaluate((old) => {
    const ctx = window.__game.ctx;
    for (const id of old) delete ctx.player.perks[id];
    ctx.player.perks.rimesoles = true;
  }, ALL_OLD_BOONS);
  await real.waitForTimeout(300);
  await real.keyboard.press('Escape');
  await real.locator('#pause-overlay').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  const stats = await real.evaluate(() => document.getElementById('pause-stats')?.textContent ?? '');
  check('the pause menu lists the boons you have taken', /Boons/.test(stats) && /Rime Soles/.test(stats), stats.slice(0, 240));
  await real.screenshot({ path: `${outDir}/pause-boons.png` });

  // The ledger: leave the descent and read what the summary says about the bargains struck.
  await real.keyboard.press('Escape');
  await real.evaluate(() => { const ctx = window.__game.ctx; ctx.run.abandon(ctx); });
  await real.locator('#run-summary:not([hidden])').waitFor({ state: 'visible', timeout: 8000 });
  await real.waitForTimeout(1500);
  const ledger = await real.evaluate(() => ({
    boons: document.querySelector('#run-summary .rs-boons')?.textContent ?? '',
    hidden: document.querySelector('#run-summary .rs-boons')?.hidden ?? true,
    share: document.querySelector('#run-summary .rs-share')?.textContent ?? '',
  }));
  const struck = [picked.name === 'Vitality' ? null : picked.name, 'Rime Soles'].filter(Boolean);
  check('the ledger names the bargains struck', !ledger.hidden && struck.every((name) => ledger.boons.includes(name)), JSON.stringify(ledger));
  check('and the share line carries them', struck.every((name) => ledger.share.includes(name)) && /with /.test(ledger.share), JSON.stringify(ledger));
  await real.screenshot({ path: `${outDir}/ledger-boons.png` });
} catch (error) {
  fail++;
  console.log('  FAIL  real-run part crashed: ' + (error && error.stack ? error.stack : error));
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
console.log(`\nverify-boons: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
