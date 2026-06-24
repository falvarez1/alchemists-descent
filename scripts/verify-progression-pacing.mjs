// Runtime probe for early pacing: D1 should start deliberately slower, later
// depths should approach the old baseline, and mobility upgrades should be a
// visible way to outgrow the slow start.
// Usage: node scripts/verify-progression-pacing.mjs [url]
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') pageErrors.push(msg.text());
});
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });

async function startLevel(levelId) {
  await startConsoleTestRun(page, {
    levelId,
    worldSource: 'campaign-level',
    seed: 11,
    loadout: 'fresh',
    settleMs: 200,
  });
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.state.paused = false;
    ctx.state.difficulty = 3;
    ctx.fx.hitstop = 0;
    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
  });
}

async function measureRun(levelId, setupSource = '') {
  await startLevel(levelId);
  return page.evaluate((setupSource) => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const p = ctx.player;
    w.clear();
    w.simBounds.x0 = 0;
    w.simBounds.y0 = 0;
    w.simBounds.x1 = w.width - 1;
    w.simBounds.y1 = w.height - 1;
    for (let x = 180; x <= 900; x++) {
      for (let y = 700; y <= 708; y++) {
        const i = w.idx(x, y);
        w.types[i] = 12;
        w.colors[i] = 0x777777;
      }
    }
    p.x = 260;
    p.y = 699;
    p.fx = 0;
    p.fy = 0;
    p.vx = 0;
    p.vy = 0;
    p.hp = p.maxHp;
    p.dead = false;
    p.inLiquid = false;
    p.crawling = false;
    p.climbing = false;
    p.diveT = 0;
    p.status.swift = 0;
    p.status.levity = 0;
    p.perks.swiftfoot = false;
    p.perks.featherweight = false;
    p.maxLevit = 100;
    p.levit = 100;
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
    if (setupSource.length > 0) new Function('ctx', setupSource)(ctx);
    ctx.camera.snapTo(p.x, p.y - 20);
    for (let f = 0; f < 8; f++) window.__game.tick();
    ctx.input.keys.right = true;
    let peak = 0;
    for (let f = 0; f < 72; f++) {
      window.__game.tick();
      peak = Math.max(peak, Math.abs(p.vx));
    }
    ctx.input.keys.right = false;
    return {
      levelId: ctx.levels.current.def.id,
      depth: ctx.levels.current.def.depth,
      vx: +peak.toFixed(2),
      x: p.x,
    };
  }, setupSource);
}

async function measureEnemyStep(levelId) {
  await startLevel(levelId);
  return page.evaluate(() => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    w.clear();
    w.simBounds.x0 = 0;
    w.simBounds.y0 = 0;
    w.simBounds.x1 = w.width - 1;
    w.simBounds.y1 = w.height - 1;
    for (let x = 200; x <= 900; x++) {
      for (let y = 700; y <= 708; y++) {
        const i = w.idx(x, y);
        w.types[i] = 12;
        w.colors[i] = 0x777777;
      }
    }
    ctx.player.dead = true;
    ctx.enemies.length = 0;
    ctx.enemyCtl.spawn('mage', 520, 690);
    const e = ctx.enemies[0];
    e.x = 520;
    e.y = 699;
    e.fx = 0;
    e.fy = 0;
    e.vx = 1;
    e.vy = 0;
    e.attackCd = 9999;
    e.timer = 1;
    const before = e.x + e.fx;
    ctx.enemyCtl.update(ctx);
    const after = e.x + e.fx;
    ctx.player.dead = false;
    return {
      levelId: ctx.levels.current.def.id,
      depth: ctx.levels.current.def.depth,
      dx: +(after - before).toFixed(3),
      x: e.x,
      fx: +e.fx.toFixed(3),
    };
  });
}

const d1Run = await measureRun('d1');
const d5Run = await measureRun('d5');
const d1SwiftRun = await measureRun('d1', `
  ctx.player.status.swift = 600;
  ctx.player.perks.swiftfoot = true;
`);
const d1Enemy = await measureEnemyStep('d1');
const d6Enemy = await measureEnemyStep('d6');

console.log(`  ..    player run vx: D1=${d1Run.vx}, D5=${d5Run.vx}, D1+mobility=${d1SwiftRun.vx}`);
console.log(`  ..    enemy integration dx: D1=${d1Enemy.dx}, D6=${d6Enemy.dx}`);

check('D1 baseline player run is slowed for onboarding', d1Run.vx >= 1.75 && d1Run.vx <= 2.05, JSON.stringify(d1Run));
check('later depth player run returns near baseline', d5Run.vx >= 2.45 && d5Run.vx <= 2.75, JSON.stringify(d5Run));
check('mobility upgrades visibly outrun D1 baseline', d1SwiftRun.vx >= d1Run.vx * 1.45 && d1SwiftRun.vx <= 3.7, JSON.stringify({ d1Run, d1SwiftRun }));
check('D1 enemy movement integrates slower', d1Enemy.dx >= 0.22 && d1Enemy.dx <= 0.28, JSON.stringify(d1Enemy));
check('later depth enemy movement returns to its per-kind baseline', d6Enemy.dx >= 0.43 && d6Enemy.dx <= 0.47, JSON.stringify(d6Enemy));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nprogression pacing probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
