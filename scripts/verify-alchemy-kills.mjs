// Alchemical kills, end to end in the real game: fodder killed by a spark bolt
// (direct: no callout — including full-hp slimes that die crackling or alight
// from the bolt's own blast on dry stone), oil + spark fire (FLAMBÉED, also when
// the bolt strikes the oiled slime itself), water + electricity
// (SHORTED), a kick into lava (RENDERED), a gunpowder blast (DETONATED, chained),
// flooding (DROWNED) and a steam bath (STEEPED). Asserts the `alchemyKill`
// event's cause and chain, real Gold cells in the grid, the callout DOM, and
// saves a screenshot of each callout for a human to look at.
//
// Usage: node scripts/verify-alchemy-kills.mjs [url] [--out dir]
// (dev server running; headless Edge via playwright-core)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : 'screenshots/alchemy-kills';
mkdirSync(outDir, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log('  ok    ' + name + (detail ? '  ' + detail : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + name + ' ' + detail);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ctx?.console?.exec, null, { timeout: 30000 });

await page.evaluate(async () => {
  localStorage.removeItem('noita-expedition');
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level --cards spark');
  for (let i = 0; i < 20; i++) window.__game.tick();
  window.__ak = [];
  ctx.events.on('alchemyKill', (info) => window.__ak.push({ ...info, frame: ctx.state.frameCount }));
  // Probe helpers live on window so each scenario stays short.
  const W = ctx.world;
  const FLOOR = 690;
  window.__arena = {
    FLOOR,
    still: [],
    holdAt: null,
    rect(x0, y0, x1, y1, type, color = 0x808080) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!W.inBounds(x, y)) continue;
        const i = W.idx(x, y);
        if (type === 0) W.clearCellAt(i);
        else W.replaceCellAt(i, type, color);
      }
    },
    reset() {
      ctx.enemies.length = 0;
      ctx.projectiles.length = 0;
      // Park the arena's own machinery: its coils answer blasts with real current.
      if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0;
      // ...and its loose pickups: a tome underfoot opens a card offer, which pauses the world.
      if (ctx.levels.current) ctx.levels.current.pickups.length = 0;
      ctx.state.paused = false;
      ctx.critters.clear?.();
      ctx.state.debugGodMode = false;
      ctx.fx.hitstop = 0;
      const p = ctx.player;
      Object.assign(p, { dead: false, hp: p.maxHp, invuln: 99999, vx: 0, vy: 0, fx: 0, fy: 0, crawling: false, climbing: false, swinging: false });
      for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
      ctx.player.firing = false;
      for (const w of ctx.wands.wands) { w.mana = w.frame.manaMax; w.cooldown = 0; }
      ctx.alchemy.resetChain?.();
      // A clean hall on a stone floor (stone does not conduct, so a spark's
      // charge cannot short a bystander), walled in metal at both ends.
      this.rect(260, 560, 900, FLOOR - 1, 0);
      this.rect(260, FLOOR, 900, FLOOR + 6, 12, 0x77736c);
      this.rect(254, 560, 259, FLOOR + 6, 13, 0x6f7479);
      this.rect(901, 560, 906, FLOOR + 6, 13, 0x6f7479);
      for (let y = 560; y <= FLOOR + 6; y++) for (let x = 254; x <= 906; x++) if (W.inBounds(x, y)) W.setChargeAt(W.idx(x, y), 0);
      p.x = 420; p.y = FLOOR - 1;
      this.holdAt = null;
      this.still = [];
      window.__ak.length = 0;
    },
    spawn(kind, x, y = FLOOR - 1, hp) {
      const e = ctx.enemyCtl.spawn(kind, x, y, { exact: true });
      if (!e) return null;
      e.alerted = false;
      e.attackCd = 9999;
      if (hp) { e.hp = hp; e.maxHp = Math.max(e.maxHp, hp); }
      return e;
    },
    tick(n, hold = true) {
      const p = ctx.player;
      for (let f = 0; f < n; f++) {
        if (hold) { p.x = this.holdAt?.x ?? 420; p.y = this.holdAt?.y ?? FLOOR - 1; p.vx = 0; p.vy = 0; }
        // Slimes held still: their hop windup keys off timer % 50 / % 130, so a
        // timer parked at 1 never gathers (no teleporting, physics untouched).
        for (const e of this.still) if (ctx.enemies.includes(e)) { e.timer = 1; e.windup = 0; }
        window.__game.tick();
      }
    },
    aim(x, y) { ctx.input.mouse.x = x; ctx.input.mouse.y = y; },
    cast(x, y) {
      this.aim(x, y);
      this.tick(1);
      ctx.player.firing = true; ctx.player.firePressed = true;
      this.tick(1);
      ctx.player.firing = false;
    },
    callouts() { return [...document.querySelectorAll('#callout-layer .callout')].map((c) => c.textContent); },
    goldCells(x0, y0, x1, y1) {
      let n = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (W.inBounds(x, y) && W.types[W.idx(x, y)] === 17) n++;
      return n;
    },
  };
});

async function shoot(name, live = []) {
  // Callouts animate in real time: let the page run ~260 ms, then capture. The
  // DOM check also accepts the words the scenario saw live at the kill (slow
  // headless ticks can outlast a callout's 1.2 s life before the screenshot).
  await page.waitForTimeout(260);
  const path = join(outDir, name + '.png');
  await page.screenshot({ path });
  const dom = await page.evaluate(() => [...document.querySelectorAll('#callout-layer .callout')].map((c) => c.textContent));
  return { path, dom: [...new Set([...live, ...dom])] };
}

// (a) SPARK: a direct kill is the wand's, not the world's.
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx;
    A.reset();
    // Low enough that the first bolt kills outright: a spark that leaves a slime
    // BURNING to death is (rightly) FLAMBÉED, which is scenario (b)'s business.
    const slime = A.spawn('slime', 520, A.FLOOR - 1, 12);
    let casts = 0, hitstops = 0;
    for (let k = 0; k < 20 && ctx.enemies.includes(slime); k++) {
      A.cast(slime.x, slime.y - 4); casts++;
      for (let f = 0; f < 24; f++) { A.tick(1); if (ctx.fx.hitstop > 0) hitstops++; }
    }
    return { dead: !ctx.enemies.includes(slime), casts, hitstops, ak: window.__ak.slice(), live: A.callouts() };
  });
  check('(a) spark bolts kill a slime', r.dead, `${r.casts} casts, hitstop on ${r.hitstops} ticks`);
  check('(a) a direct spark kill is not alchemical', r.ak.length === 0, JSON.stringify(r.ak));
}

// (a2) PLAIN SPARK ON DRY STONE, full-hp slimes: the bolt's own blast leaves
// flame and live air on the body it was cast at, so the slime often dies
// crackling or alight a few ticks after the last bolt. That is still the
// spell's kill: no callout, no bonus (QA: 5 of 8 were SHORTED/FLAMBÉED).
{
  const reps = 8;
  const rows = [];
  let live = [];
  for (let rep = 0; rep < reps; rep++) {
    const r = await page.evaluate((rep) => {
      const A = window.__arena, ctx = window.__game.ctx;
      A.reset();
      const slime = A.spawn('slime', 500 + (rep % 4) * 20, A.FLOOR - 1);
      let casts = 0, lingering = 0;
      for (let k = 0; k < 30 && ctx.enemies.includes(slime); k++) {
        A.cast(slime.x, slime.y - 4); casts++;
        for (let f = 0; f < 40 && ctx.enemies.includes(slime); f++) {
          const hadStatus = slime.status.electrified > 0 || slime.status.burning > 0;
          A.tick(1);
          if (!ctx.enemies.includes(slime) && hadStatus) lingering++;
        }
      }
      return { dead: !ctx.enemies.includes(slime), casts, lingering, ak: window.__ak.map((a) => a.cause), live: A.callouts() };
    }, rep);
    rows.push(r);
    live = r.live;
  }
  const killed = rows.filter((r) => r.dead).length;
  const credited = rows.filter((r) => r.ak.length > 0);
  check('(a2) plain sparks kill full-hp slimes on dry stone', killed === reps, `${killed}/${reps}; ${rows.filter((r) => r.lingering).length} died with the bolt's status still on them`);
  check('(a2) none of those spell kills is alchemical', credited.length === 0, JSON.stringify(credited.map((r) => r.ak)));
  const s = await shoot('a2-plain-spark-no-callout', live);
  check('(a2) no callout on screen after a plain spark kill', s.dom.length === 0, JSON.stringify(s.dom) + ' ' + s.path);
}

// (b2) SPARK STRAIGHT INTO AN OILED SLIME: the zap and the oil fire land together;
// the fire has the world's fuel, so it is FLAMBÉED — never SHORTED.
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    A.rect(500, F - 34, 503, F - 1, 13, 0x6f7479);
    A.rect(580, F - 34, 583, F - 1, 13, 0x6f7479);
    A.rect(504, F - 3, 579, F - 1, 6, 0x3b3222);
    const slime = A.spawn('slime', 548, F - 4, 60);
    A.still.push(slime);
    for (let f = 0; f < 10; f++) A.tick(1);
    A.cast(slime.x, slime.y - 4);
    let t = 0;
    while (t < 900 && ctx.enemies.includes(slime)) { A.tick(10); t += 10; }
    return { dead: !ctx.enemies.includes(slime), t, ak: window.__ak.slice() };
  });
  check('(b2) the oiled slime dies', r.dead, `after ${r.t} ticks`);
  check('(b2) cause burned (FLAMBÉED), not shorted', r.ak.length === 1 && r.ak[0].cause === 'burned', JSON.stringify(r.ak));
}

// (b) OIL + SPARK: the bolt lights the slick, the fire does the killing.
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    // A metal trough of oil the slime sits in; the spark lands in the oil beside it.
    A.rect(500, F - 34, 503, F - 1, 13, 0x6f7479);
    A.rect(580, F - 34, 583, F - 1, 13, 0x6f7479);
    A.rect(504, F - 3, 579, F - 1, 6, 0x3b3222);
    const slime = A.spawn('slime', 548, F - 4, 60);
    A.still.push(slime); // it sits in the slick instead of hopping out of the trough
    for (let f = 0; f < 10; f++) A.tick(1);
    A.cast(566, F - 3);
    let t = 0;
    const fire = () => { let n = 0; for (let y = F - 30; y < F; y++) for (let x = 504; x < 580; x++) if (ctx.world.types[ctx.world.idx(x, y)] === 5) n++; return n; };
    while (t < 900 && ctx.enemies.includes(slime)) {
      A.tick(10); t += 10;
      // A bolt that caught the slime instead of the slick gets a second try.
      if (t === 60 && fire() === 0) A.cast(572, F - 2);
    }
    return { dead: !ctx.enemies.includes(slime), t, ak: window.__ak.slice(), live: A.callouts() };
  });
  check('(b) oil fire kills the slime', r.dead, `after ${r.t} ticks`);
  check('(b) cause burned, chain 1', r.ak.length === 1 && r.ak[0].cause === 'burned' && r.ak[0].chain === 1, JSON.stringify(r.ak));
  const s = await shoot('b-flambeed', r.live);
  check('(b) callout FLAMBÉED rendered', s.dom.some((t) => t.includes('FLAMBÉED')), JSON.stringify(s.dom) + ' ' + s.path);
}

// (c) WATER + ELECTRICITY: spark into a pool, the pool shorts the slime.
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    A.rect(560, F - 34, 563, F - 1, 13, 0x6f7479);
    A.rect(660, F - 34, 663, F - 1, 13, 0x6f7479);
    A.rect(564, F - 5, 659, F - 1, 2, 0x2a6fb0);
    // The alchemist sparks the pool from a stone ledge above it, well clear of the water.
    A.rect(574, F - 44, 596, F - 42, 12, 0x77736c);
    A.holdAt = { x: 585, y: F - 45 };
    ctx.player.x = 585; ctx.player.y = F - 45;
    const slime = A.spawn('slime', 620, F - 1, 24);
    A.still.push(slime); // it stays in the pool instead of hopping onto the ledge
    for (let f = 0; f < 20; f++) A.tick(1);
    let t = 0, casts = 0;
    const trace = [];
    while (t < 1200 && ctx.enemies.includes(slime)) {
      if (t % 90 === 0) trace.push([t, Math.round(slime.x), Math.round(slime.y), +slime.hp.toFixed(1), slime.status.electrified, ctx.projectiles.length]);
      // Spark the pool a dozen cells short of the slime: the current reaches it
      // through the water (charge fades each hop, so the strike must be near).
      // Each bolt blasts a crater, so the pool is topped back up first.
      if (t % 90 === 0) {
        for (let y = F - 5; y < F; y++) for (let x = 564; x <= 659; x++) {
          const i = ctx.world.idx(x, y);
          if (ctx.world.types[i] === 0) ctx.world.replaceCellAt(i, 2, 0x2a6fb0);
        }
        // ~15 cells short: past the bolt's own blast (9.6 cells), inside the current's reach.
        A.cast(Math.max(566, slime.x - 15), F - 3); casts++;
        const wd = ctx.wands.wands[ctx.wands.active];
        trace.push(['cast', ctx.projectiles.map((q) => q.type + '@' + Math.round(q.x)).join(' '), Math.round(wd.mana), wd.cooldown, !!ctx.player.fireBlockedUntilRelease, ctx.state.paused, Math.round(ctx.player.x)]);
      }
      A.tick(10); t += 10;
    }
    const gold = A.goldCells(540, F - 60, 700, F);
    return { dead: !ctx.enemies.includes(slime), t, casts, ak: window.__ak.slice(), gold, hp: ctx.player.hp, live: A.callouts(), trace };
  });
  check('(c) the shorted pool kills the slime', r.dead, `after ${r.t} ticks, ${r.casts} casts` + (r.dead ? '' : ' trace ' + JSON.stringify(r.trace)));
  check('(c) cause shorted', r.ak.length === 1 && r.ak[0].cause === 'shorted', JSON.stringify(r.ak));
  const s = await shoot('c-shorted', r.live);
  check('(c) callout SHORTED rendered', s.dom.some((t) => t.includes('SHORTED')), JSON.stringify(s.dom) + ' ' + s.path);
}

// (d) KICK INTO LAVA: the boot launches, the lava renders.
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    // A lava pit sunk into the floor just past the slime.
    A.rect(446, F, 506, F + 5, 11, 0xff5a1a);
    const slime = A.spawn('slime', 434, F - 1, 60);
    A.aim(470, F - 8);
    A.tick(1);
    ctx.playerCtl.kick(ctx);
    let t = 0;
    while (t < 400 && ctx.enemies.includes(slime)) { A.tick(5); t += 5; }
    return { dead: !ctx.enemies.includes(slime), t, ak: window.__ak.slice(), live: A.callouts() };
  });
  check('(d) a slime kicked into a lava pit dies', r.dead, `after ${r.t} ticks`);
  check('(d) cause rendered', r.ak.length === 1 && r.ak[0].cause === 'rendered', JSON.stringify(r.ak));
  const s = await shoot('d-rendered', r.live);
  check('(d) callout RENDERED rendered', s.dom.some((t) => t.includes('RENDERED')), JSON.stringify(s.dom) + ' ' + s.path);
}

// (d2) KICK INTO A WALL: a bat hurled into rock is IMPALED (the wall-slam gib).
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    A.rect(470, F - 30, 476, F - 1, 12, 0x77736c);
    const bat = A.spawn('bat', 434, F - 6);
    bat.sleeping = false;
    A.aim(470, F - 6);
    A.tick(1);
    ctx.playerCtl.kick(ctx);
    let t = 0;
    while (t < 200 && ctx.enemies.includes(bat)) { A.tick(2); t += 2; }
    return { dead: !ctx.enemies.includes(bat), t, ak: window.__ak.slice(), live: A.callouts() };
  });
  check('(d2) a bat kicked into rock dies', r.dead, `after ${r.t} ticks`);
  check('(d2) cause impaled', r.ak.length === 1 && r.ak[0].cause === 'impaled', JSON.stringify(r.ak));
  const s = await shoot('d2-impaled', r.live);
  check('(d2) callout IMPALED rendered', s.dom.some((t) => t.includes('IMPALED')), JSON.stringify(s.dom));
}

// (e) GUNPOWDER: one spark, one packed charge, a chain of three.
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    // The huddle sits just past a packed charge; the spark lands on the charge's
    // near face, so no slime stands in the bolt's path.
    const foes = [A.spawn('slime', 582, F - 1, 30), A.spawn('slime', 598, F - 1, 30), A.spawn('slime', 614, F - 1, 30)];
    A.still.push(...foes); // the huddle stays huddled
    A.rect(556, F - 6, 578, F - 1, 8, 0x383838);
    for (let f = 0; f < 4; f++) A.tick(1);
    A.cast(557, F - 4);
    let t = 0, fuseLit = false;
    // Stop soon after the blast so the callouts are still up for the screenshot.
    let firstKill = -1;
    while (t < 300 && foes.some((e) => ctx.enemies.includes(e))) {
      A.tick(5); t += 5;
      // If the bolt's own blast scattered the charge into a loose fuse, the
      // alchemist lights the packed remainder by hand (still his doing).
      if (t === 40 && window.__ak.length === 0) {
        fuseLit = true;
        for (let y = F - 6; y < F; y++) for (let x = 556; x <= 578; x++) {
          const i = ctx.world.idx(x, y);
          if (ctx.world.types[i] === 0) ctx.world.replaceCellAt(i, 8, 0x383838);
        }
        ctx.world.replaceCellAt(ctx.world.idx(555, F - 1), 5, 0xff8a2a);
      }
      if (firstKill < 0 && window.__ak.length > 0) firstKill = t;
      if (firstKill >= 0 && t - firstKill > 40) break;
    }
    return { dead: foes.filter((e) => !ctx.enemies.includes(e)).length, t, fuseLit, ak: window.__ak.slice(), live: A.callouts() };
  });
  check('(e) the gunpowder charge kills the huddle', r.dead >= 2, `${r.dead} dead after ${r.t} ticks${r.fuseLit ? ' (fuse relit by hand)' : ''}`);
  // The bolt's own flash can light the nearest slime first (FLAMBÉED); the charge does the rest.
  check('(e) causes detonated', r.ak.filter((k) => k.cause === 'detonated').length >= 2, JSON.stringify(r.ak.map((k) => [k.cause, k.chain])));
  check('(e) the chain counts up', r.ak.map((k) => k.chain).join(',').startsWith('1,2'), JSON.stringify(r.ak.map((k) => k.chain)));
  const s = await shoot('e-detonated-chain', r.live);
  check('(e) chain callouts render with a ×badge', s.dom.some((t) => t.includes('×')), JSON.stringify(s.dom) + ' ' + s.path);
}

// (f) FLOOD: a slime held under water drowns.
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    A.rect(560, F - 30, 563, F - 1, 13, 0x6f7479);
    A.rect(600, F - 30, 603, F - 1, 13, 0x6f7479);
    A.rect(564, F - 24, 599, F - 1, 2, 0x2a6fb0);
    const slime = A.spawn('slime', 582, F - 1, 40);
    let t = 0;
    while (t < 1500 && ctx.enemies.includes(slime)) { A.tick(10); t += 10; }
    return { dead: !ctx.enemies.includes(slime), t, ak: window.__ak.slice(), live: A.callouts() };
  });
  check('(f) the slime drowns', r.dead, `after ${r.t} ticks`);
  check('(f) cause drowned', r.ak.length === 1 && r.ak[0].cause === 'drowned', JSON.stringify(r.ak));
  const s = await shoot('f-drowned', r.live);
  check('(f) callout DROWNED rendered', s.dom.some((t) => t.includes('DROWNED')), JSON.stringify(s.dom));
}

// (g) STEAM: a slime shut in a steam box is steeped (the Works' exhale, bottled).
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    A.rect(560, F - 14, 603, F - 11, 13, 0x6f7479);
    A.rect(560, F - 14, 563, F - 1, 13, 0x6f7479);
    A.rect(600, F - 14, 603, F - 1, 13, 0x6f7479);
    const slime = A.spawn('slime', 582, F - 1, 30);
    let t = 0;
    while (t < 900 && ctx.enemies.includes(slime)) {
      // Keep the box topped up with live steam (it rises and condenses).
      for (let y = F - 10; y < F; y++) for (let x = 564; x < 600; x++) {
        const i = ctx.world.idx(x, y);
        const c = ctx.world.types[i];
        if (c === 0 || c === 2) { ctx.world.replaceCellAt(i, 9, 0xc8d0d4); ctx.world.life[i] = 200; }
      }
      A.tick(4); t += 4;
    }
    return { dead: !ctx.enemies.includes(slime), t, ak: window.__ak.slice(), live: A.callouts() };
  });
  check('(g) steam kills the slime', r.dead, `after ${r.t} ticks`);
  check('(g) cause steeped', r.ak.length === 1 && r.ak[0].cause === 'steeped', JSON.stringify(r.ak));
  const s = await shoot('g-steeped', r.live);
  check('(g) callout STEEPED rendered', s.dom.some((t) => t.includes('STEEPED')), JSON.stringify(s.dom));
}

// Payout: bonus gold becomes REAL Gold cells, mana and a sip of life.
{
  const r = await page.evaluate(() => {
    const A = window.__arena, ctx = window.__game.ctx, F = A.FLOOR;
    A.reset();
    const wand = ctx.wands.wands[ctx.wands.active];
    wand.mana = 0;
    ctx.player.hp = 50;
    const before = A.goldCells(270, F - 120, 890, F);
    // A weaver 200 cells off: close enough to be the alchemist's doing, far
    // enough that the harvester field does not vacuum the pile at once.
    const weaver = A.spawn('weaver', 620, F - 1, 5);
    ctx.alchemy.noteHit(weaver, 'burned');
    ctx.enemyCtl.kill(weaver, 0, 0);
    const info = window.__ak[0];
    const mana = wand.mana;
    const hp = ctx.player.hp;
    for (let f = 0; f < 150; f++) { ctx.player.x = 420; ctx.player.y = F - 1; window.__game.tick(); }
    const gold = A.goldCells(270, F - 120, 890, F) - before;
    return { info, gold, mana, manaMax: wand.frame.manaMax, hp };
  });
  check('payout: the kill is announced', !!r.info, JSON.stringify(r.info));
  // Every grain lands as a real cell (Particles never deletes gold in flight).
  check('payout: bonus gold settles as real Gold cells, every grain', !!r.info && r.gold * 10 === r.info.bonusGold, `${r.gold} cells for ${r.info?.bonusGold} oz`);
  check('payout: the wand drinks mana', r.mana >= r.manaMax * 0.3, `${r.mana.toFixed(1)}/${r.manaMax}`);
  check('payout: a sip of life', r.hp >= 53, `hp ${r.hp}`);
  const s = await shoot('payout-gold', r.live);
  console.log('        payout screenshot ' + s.path);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (errs.length) console.log('page errors:', errs.slice(0, 5));
await browser.close();
process.exit(fail > 0 || errs.length > 0 ? 1 : 0);
