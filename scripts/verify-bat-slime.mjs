// Bat slime weakness: real slime cells gum bat wings, grounding it for about
// seven seconds and disabling its bite until the debuff ends.
// Usage: node scripts/verify-bat-slime.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log('  ok    ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + ' ' + detail);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.enemyCtl, { timeout: 20000 });
await page.waitForTimeout(300);

const r = await page.evaluate(async () => {
  const { Cell } = await import('/src/sim/CellType.ts');
  const { slimeColor, stoneColor } = await import('/src/sim/colors.ts');
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 20; f++) window.__game.tick();

  const w = ctx.world;
  const p = ctx.player;
  const floorY = 690;
  const spawnX = 480;
  const spawnY = 642;

  const clearArena = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
      }
    }
  };
  const fill = (x0, y0, x1, y1, type, colorFn) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!w.inBounds(x, y)) continue;
        w.replaceCellAt(w.idx(x, y), type, colorFn());
      }
    }
  };
  const reset = () => {
    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.fx.hitstop = 0;
    ctx.enemies.length = 0;
    ctx.critters.clear?.();
    p.dead = false;
    p.hp = 100;
    p.invuln = 0;
    p.crawling = false;
    p.climbing = false;
    p.swinging = false;
    p.x = spawnX - 80;
    p.y = floorY - 1;
    p.vx = 0;
    p.vy = 0;
    p.fx = 0;
    p.fy = 0;
    p.grounded = true;
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  };

  reset();
  clearArena(430, 600, 540, 700);
  fill(430, floorY, 540, floorY + 6, Cell.Stone, stoneColor);
  ctx.enemyCtl.spawn('bat', spawnX, spawnY);
  const bat = ctx.enemies[ctx.enemies.length - 1];
  bat.x = spawnX;
  bat.y = spawnY;
  bat.fx = 0;
  bat.fy = 0;
  bat.vx = 0;
  bat.vy = 0;
  bat.sleeping = false;
  bat.alerted = false;
  bat.attackCd = 0;
  bat.slimed = 0;

  fill(spawnX - 4, spawnY - 6, spawnX + 4, spawnY + 1, Cell.Slime, slimeColor);
  window.__game.tick();
  const afterContact = {
    slimed: bat.slimed ?? 0,
    y: bat.y,
    vy: +bat.vy.toFixed(2),
    attackCd: bat.attackCd,
  };
  clearArena(spawnX - 8, spawnY - 9, spawnX + 8, spawnY + 4);

  let everNearFloor = false;
  let minSlimedAfterDrop = 999;
  for (let f = 0; f < 160; f++) {
    window.__game.tick();
    everNearFloor = everNearFloor || bat.y >= floorY - 4;
    minSlimedAfterDrop = Math.min(minSlimedAfterDrop, bat.slimed ?? 0);
  }
  const afterDrop = {
    y: bat.y,
    vy: +bat.vy.toFixed(2),
    grounded: !!bat.grounded,
    slimed: bat.slimed ?? 0,
    windup: bat.windup ?? 0,
    swoop: bat.swoop ?? 0,
  };

  p.hp = 100;
  p.dead = false;
  p.invuln = 0;
  bat.attackCd = 0;
  bat.slimed = 120;
  let minHpWhileSlimed = p.hp;
  for (let f = 0; f < 60; f++) {
    p.x = spawnX;
    p.y = floorY - 1;
    p.invuln = 0;
    bat.x = spawnX;
    bat.y = floorY - 1;
    bat.fx = 0;
    bat.fy = 0;
    bat.vx = 0;
    bat.vy = 0;
    bat.attackCd = 0;
    window.__game.tick();
    minHpWhileSlimed = Math.min(minHpWhileSlimed, p.hp);
  }

  p.hp = 100;
  p.dead = false;
  p.invuln = 0;
  bat.x = spawnX;
  bat.y = floorY - 1;
  bat.fx = 0;
  bat.fy = 0;
  bat.vx = 0;
  bat.vy = 0;
  bat.attackCd = 0;
  bat.slimed = 0;
  window.__game.tick();
  const hpAfterRecoveredContact = p.hp;

  return {
    afterContact,
    afterDrop,
    everNearFloor,
    minSlimedAfterDrop,
    minHpWhileSlimed,
    hpAfterRecoveredContact,
  };
});

console.log('  ' + JSON.stringify(r));
check('slime cells apply a seven-second slimed timer', r.afterContact.slimed >= 415, JSON.stringify(r));
check('slimed bat loses its flight attack state', r.afterContact.vy > 0 && r.afterDrop.windup === 0 && r.afterDrop.swoop === 0, JSON.stringify(r));
check('slimed bat drops to the floor', r.everNearFloor && r.afterDrop.y >= 680, JSON.stringify(r));
check('slimed timer continues after the initial splash', r.afterDrop.slimed > 240 && r.minSlimedAfterDrop > 240, JSON.stringify(r));
check('slimed bat cannot damage overlapping player', r.minHpWhileSlimed === 100, JSON.stringify(r));
check('bat bite returns when slimed timer is gone', r.hpAfterRecoveredContact < 100, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nbat-slime probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
