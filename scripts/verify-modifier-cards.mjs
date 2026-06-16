// Focused Phase 4 modifier-card probe.
// Usage: node scripts/verify-modifier-cards.mjs [url]  (dev server running)
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await startConsoleTestRun(page, { loadout: 'review', settleMs: 100 });

const result = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const world = ctx.world;
  const action = {
    card: 'spark',
    speedMul: 1,
    dmgMul: 1,
    spreadAdd: 0,
    infused: false,
    waterTrail: 6,
    oilTrail: 0,
    electricCharge: false,
    critWet: true,
    shortHoming: false,
    bounces: 0,
    triggered: null,
  };
  const clearRect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y));
      }
    }
  };
  const runProjectiles = (frames) => {
    for (let i = 0; i < frames; i++) {
      ctx.state.frameCount++;
      ctx.projectileCtl.update(ctx);
    }
  };
  clearRect(80, 70, 170, 115);
  ctx.projectiles.length = 0;
  ctx.enemies.length = 0;
  ctx.player.x = 20;
  ctx.player.y = 80;
  ctx.state.frameCount = 2;

  ctx.wands.castActionAt(ctx, { ...action, critWet: false }, 120, 92, 0);
  const trailProjectile = ctx.projectiles[ctx.projectiles.length - 1];
  trailProjectile.x = 120;
  trailProjectile.y = 92;
  trailProjectile.vx = 2;
  trailProjectile.vy = 0;
  runProjectiles(8);
  let waterCells = 0;
  for (let y = 70; y <= 115; y++) {
    for (let x = 80; x <= 170; x++) {
      if (world.inBounds(x, y) && world.types[world.idx(x, y)] === 2) waterCells++;
    }
  }

  clearRect(80, 120, 170, 165);
  ctx.projectiles.length = 0;
  ctx.enemies.length = 0;
  ctx.state.frameCount = 2;
  ctx.wands.castActionAt(ctx, { ...action, waterTrail: 0, oilTrail: 4, critWet: false }, 120, 142, 0);
  const oilProjectile = ctx.projectiles[ctx.projectiles.length - 1];
  oilProjectile.x = 120;
  oilProjectile.y = 142;
  oilProjectile.vx = 2;
  oilProjectile.vy = 0;
  runProjectiles(8);
  let oilCells = 0;
  for (let y = 120; y <= 165; y++) {
    for (let x = 80; x <= 170; x++) {
      if (world.inBounds(x, y) && world.types[world.idx(x, y)] === 6) oilCells++;
    }
  }

  clearRect(110, 170, 150, 205);
  ctx.projectiles.length = 0;
  ctx.enemies.length = 0;
  const conductorIdx = world.idx(122, 188);
  world.types[conductorIdx] = 2;
  world.charge[conductorIdx] = 0;
  ctx.state.frameCount = 3;
  ctx.wands.castActionAt(ctx, { ...action, waterTrail: 0, electricCharge: true, critWet: false }, 120, 188, 0);
  const electricProjectile = ctx.projectiles[ctx.projectiles.length - 1];
  electricProjectile.x = 120;
  electricProjectile.y = 188;
  electricProjectile.vx = 2;
  electricProjectile.vy = 0;
  runProjectiles(1);
  const conductorCharge = world.charge[conductorIdx];

  clearRect(190, 140, 250, 185);
  ctx.projectiles.length = 0;
  ctx.enemies.length = 0;
  ctx.enemyCtl.spawn('slime', 225, 165);
  const electricEnemy = ctx.enemies[ctx.enemies.length - 1];
  electricEnemy.hp = 100;
  electricEnemy.maxHp = 100;
  ctx.wands.castActionAt(ctx, { ...action, waterTrail: 0, electricCharge: true, critWet: false }, electricEnemy.x - 10, electricEnemy.y - 5, 0);
  const electricHitProjectile = ctx.projectiles[ctx.projectiles.length - 1];
  electricHitProjectile.x = electricEnemy.x - 1;
  electricHitProjectile.y = electricEnemy.y - 5;
  electricHitProjectile.vx = 1;
  electricHitProjectile.vy = 0;
  runProjectiles(1);
  const electricStatus = electricEnemy.status.electrified ?? 0;

  clearRect(95, 210, 190, 260);
  ctx.projectiles.length = 0;
  ctx.enemies.length = 0;
  ctx.enemyCtl.spawn('slime', 165, 245);
  ctx.state.frameCount = 3;
  ctx.wands.castActionAt(ctx, { ...action, waterTrail: 0, critWet: false, shortHoming: true }, 120, 225, 0);
  const homingProjectile = ctx.projectiles[ctx.projectiles.length - 1];
  homingProjectile.x = 120;
  homingProjectile.y = 225;
  homingProjectile.vx = 2;
  homingProjectile.vy = 0;
  homingProjectile.age = 4;
  runProjectiles(1);
  const homingVy = homingProjectile.vy;

  const hit = (wet) => {
    clearRect(190, 80, 250, 125);
    ctx.projectiles.length = 0;
    ctx.enemies.length = 0;
    ctx.enemyCtl.spawn('slime', 225, 105);
    const enemy = ctx.enemies[ctx.enemies.length - 1];
    enemy.hp = 100;
    enemy.maxHp = 100;
    enemy.status.wet = wet ? 60 : 0;
    ctx.wands.castActionAt(ctx, action, enemy.x - 10, enemy.y - 5, 0);
    const projectile = ctx.projectiles[ctx.projectiles.length - 1];
    projectile.x = enemy.x - 1;
    projectile.y = enemy.y - 5;
    projectile.vx = 1;
    projectile.vy = 0;
    runProjectiles(1);
    return 100 - enemy.hp;
  };

  const dryDamage = hit(false);
  const wetDamage = hit(true);
  return {
    reviewCards: ctx.wands.wands[0].cards,
    waterCells,
    oilCells,
    conductorCharge,
    electricStatus,
    homingVy,
    dryDamage,
    wetDamage,
  };
});

check(
  'Review loadout exposes review-only Phase 4 primer cards',
    result.reviewCards[0] === 'watertrail' &&
    result.reviewCards[1] === 'electriccharge' &&
    result.reviewCards[2] === 'critwet' &&
    result.reviewCards[3] === 'shorthoming' &&
    result.reviewCards[4] === 'spark',
  JSON.stringify(result),
);
check('Water Trail deposits real water within its budget', result.waterCells > 0 && result.waterCells <= 6, JSON.stringify(result));
check('Oil Wick deposits real oil within its budget', result.oilCells > 0 && result.oilCells <= 4, JSON.stringify(result));
check('Electric Charge energizes conductor cells', result.conductorCharge > 0, JSON.stringify(result));
check('Electric Charge electrifies hit enemies', result.electricStatus > 0, JSON.stringify(result));
check('Short Homing bends projectile velocity toward a target', result.homingVy > 0, JSON.stringify(result));
check('Critical on Wet outperforms dry crit-marked Spark', result.wetDamage > result.dryDamage * 1.5, JSON.stringify(result));
check('No page errors', pageErrors.length === 0, pageErrors.join('\n'));

await browser.close();

console.log(`\nverify-modifier-cards: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
