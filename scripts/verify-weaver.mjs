// Runtime probe for the Weaver enemy and its dedicated test playground. Starts
// a real test-mode run in the authored lair, then verifies sleeping, feeding,
// thread writing, IK leg state, and nonblank rendering.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

const samplePixels = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const glCanvas = document.querySelector('#canvas-holder > canvas');
          if (!glCanvas) return resolve({ error: 'no canvas' });
          const c2 = document.createElement('canvas');
          c2.width = glCanvas.width;
          c2.height = glCanvas.height;
          const g = c2.getContext('2d');
          g.drawImage(glCanvas, 0, 0);
          const d = g.getImageData(0, 0, c2.width, c2.height).data;
          let nonBlack = 0;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) {
            const v = d[i] + d[i + 1] + d[i + 2];
            sum += v;
            if (v > 30) nonBlack++;
          }
          const total = d.length / 4;
          resolve({
            w: c2.width,
            h: c2.height,
            nonBlackPct: (nonBlack / total) * 100,
            avg: sum / total / 3,
          });
        });
      }),
  );

const countVines = () =>
  page.evaluate(() => {
    const world = window.__game.ctx.world;
    let vines = 0;
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === 15) vines++;
    return vines;
  });

try {
  console.log('navigating to', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx?.world && window.__game?.ctx?.enemyCtl, null, {
    timeout: 30000,
  });

  await startConsoleTestRun(page, {
    level: 'weaver-test',
    world: 'campaign-level',
    seed: 1,
    settleMs: 500,
  });

  const initial = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const weavers = ctx.enemies.filter((e) => e.kind === 'weaver');
    let vines = 0;
    let growth = 0;
    for (let i = 0; i < world.types.length; i++) {
      const t = world.types[i];
      if (t === 15) vines++;
      if (t === 15 || t === 30 || t === 33 || t === 34) growth++;
    }
    return {
      level: ctx.levels.current?.def?.id ?? null,
      weavers: weavers.length,
      sleeping: weavers.filter((e) => e.sleeping).length,
      critters: ctx.critters.list.length,
      vines,
      growth,
    };
  });
  console.log('initial:', JSON.stringify(initial));
  if (initial.level !== 'weaver-test') throw new Error(`Expected weaver-test, got ${initial.level}`);
  if (initial.weavers < 3) throw new Error(`Expected at least 3 Weavers, got ${initial.weavers}`);
  if (initial.sleeping < 1) throw new Error('Expected a sleeping Weaver in the lair');
  if (initial.critters < 6) throw new Error(`Expected seeded prey critters, got ${initial.critters}`);
  if (initial.vines < 80 || initial.growth < 200) {
    throw new Error(`Expected webbed fungal arena, got vines=${initial.vines} growth=${initial.growth}`);
  }

  const feedSetup = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const feeder = ctx.enemies
      .filter((e) => e.kind === 'weaver' && !e.sleeping)
      .sort((a, b) => Math.abs(a.x - 1028) - Math.abs(b.x - 1028))[0];
    if (!feeder) throw new Error('No feeder Weaver');
    ctx.camera.snapTo(feeder.x, feeder.y - 90);
    ctx.player.x = feeder.x - 180;
    ctx.player.y = feeder.y;
    ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
    feeder.alerted = false;
    feeder.attackCd = 120;
    feeder.hp = Math.max(1, feeder.maxHp - 56);
    ctx.critters.spawn('moth', feeder.x + 4, feeder.y - 8);
    return {
      x: feeder.x,
      y: feeder.y,
      hpBefore: feeder.hp,
      crittersAfterSpawn: ctx.critters.list.length,
    };
  });
  await page.waitForTimeout(650);
  const feedResult = await page.evaluate((setup) => {
    const ctx = window.__game.ctx;
    const feeder = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    return {
      hp: feeder?.hp ?? 0,
      recoil: feeder?.recoil ?? 0,
      critters: ctx.critters.list.length,
    };
  }, feedSetup);
  console.log('feeding:', JSON.stringify({ setup: feedSetup, result: feedResult }));
  if (feedResult.hp <= feedSetup.hpBefore) {
    throw new Error(`Feeder did not heal from prey: before=${feedSetup.hpBefore} after=${feedResult.hp}`);
  }

  const sleepSetup = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const sleeper = ctx.enemies.find((e) => e.kind === 'weaver' && e.sleeping);
    if (!sleeper) throw new Error('No sleeping Weaver');
    sleeper.sleeping = true;
    sleeper.alerted = false;
    sleeper.cranky = 0;
    sleeper.attackCd = 80;
    ctx.camera.snapTo(sleeper.x, sleeper.y - 90);
    ctx.player.x = sleeper.x - 220;
    ctx.player.y = sleeper.y;
    ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
    ctx.events.emit('groundImpact', { x: sleeper.x + 24, y: sleeper.y - 8, radius: 28, strength: 1 });
    return { x: sleeper.x, y: sleeper.y };
  });
  await page.waitForTimeout(350);
  const sleepResult = await page.evaluate((setup) => {
    const sleeper = window.__game.ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    return {
      sleeping: sleeper?.sleeping === true,
      alerted: sleeper?.alerted === true,
      cranky: sleeper?.cranky ?? 0,
      windup: sleeper?.windup ?? 0,
    };
  }, sleepSetup);
  console.log('sleep-ground-impact:', JSON.stringify({ setup: sleepSetup, result: sleepResult }));
  if (sleepResult.sleeping || !sleepResult.alerted || sleepResult.cranky <= 0) {
    throw new Error('Sleeping Weaver did not wake cranky from nearby ground impact');
  }

  const strikeResult = await page.evaluate((setup) => {
    const ctx = window.__game.ctx;
    const sleeper = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    sleeper.sleeping = true;
    sleeper.alerted = false;
    sleeper.cranky = 0;
    sleeper.attackCd = 80;
    ctx.player.x = sleeper.x - 220;
    ctx.player.y = sleeper.y;
    ctx.events.emit('structureStrike', { x: sleeper.x + 18, y: sleeper.y - 8, radius: 6 });
    return {
      sleeping: sleeper.sleeping === true,
      alerted: sleeper.alerted === true,
      cranky: sleeper.cranky ?? 0,
      attackCd: sleeper.attackCd,
    };
  }, sleepSetup);
  console.log('sleep-structure-strike:', JSON.stringify(strikeResult));
  if (strikeResult.sleeping || !strikeResult.alerted || strikeResult.cranky <= 0) {
    throw new Error('Sleeping Weaver did not wake cranky from nearby structure strike');
  }

  const bodyImpactSetup = await page.evaluate((setup) => {
    const ctx = window.__game.ctx;
    const sleeper = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    sleeper.sleeping = true;
    sleeper.alerted = false;
    sleeper.cranky = 0;
    sleeper.attackCd = 80;
    ctx.player.x = sleeper.x - 220;
    ctx.player.y = sleeper.y;
    ctx.rigidBodies.clear();
    ctx.rigidBodies.spawn(
      { kind: 'box', halfW: 4, halfH: 4 },
      sleeper.x + 58,
      sleeper.y - 94,
      { material: 'stone', restitution: 0, friction: 0.8, vy: 4 },
    );
    return { x: sleeper.x, y: sleeper.y, bodies: ctx.rigidBodies.bodies.length };
  }, sleepSetup);
  await page.waitForTimeout(1200);
  const bodyImpactResult = await page.evaluate((setup) => {
    const ctx = window.__game.ctx;
    const sleeper = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    return {
      sleeping: sleeper?.sleeping === true,
      alerted: sleeper?.alerted === true,
      cranky: sleeper?.cranky ?? 0,
      bodies: ctx.rigidBodies.bodies.length,
    };
  }, bodyImpactSetup);
  console.log('sleep-body-impact:', JSON.stringify({ setup: bodyImpactSetup, result: bodyImpactResult }));
  if (bodyImpactResult.sleeping || !bodyImpactResult.alerted || bodyImpactResult.cranky <= 0) {
    throw new Error('Sleeping Weaver did not wake cranky from nearby rigid-body impact');
  }

  const vinesBeforeAttack = await countVines();
  const attackSetup = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const sentinel = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => b.x - a.x)[0];
    if (!sentinel) throw new Error('No attack-lane Weaver');
    ctx.camera.snapTo(sentinel.x, sentinel.y - 95);
    ctx.player.x = sentinel.x - 74;
    ctx.player.y = sentinel.y;
    ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
    sentinel.alerted = true;
    sentinel.sleeping = false;
    sentinel.attackCd = 0;
    sentinel.blink = 5;
    sentinel.weaverSupport = 1;
    return { x: sentinel.x, y: sentinel.y };
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${outDir}/weaver-runtime.png` });

  const result = await page.evaluate(
    ({ attackSetup, vinesBeforeAttack }) => {
      const ctx = window.__game.ctx;
      const world = ctx.world;
      const sentinel = ctx.enemies
        .filter((e) => e.kind === 'weaver')
        .sort((a, b) => Math.abs(a.x - attackSetup.x) - Math.abs(b.x - attackSetup.x))[0];
      let vines = 0;
      for (let i = 0; i < world.types.length; i++) if (world.types[i] === 15) vines++;
      return {
        sentinel: sentinel
          ? {
              hp: sentinel.hp,
              x: sentinel.x,
              y: sentinel.y,
              blink: sentinel.blink,
              windup: sentinel.windup ?? 0,
              legs: sentinel.weaverLegs?.length ?? 0,
              support: sentinel.weaverSupport ?? 0,
            }
          : null,
        vines,
        newVines: vines - vinesBeforeAttack,
        enemies: ctx.enemies.length,
      };
    },
    { attackSetup, vinesBeforeAttack },
  );
  const pixels = await samplePixels();
  console.log('result:', JSON.stringify(result));
  console.log('pixels:', JSON.stringify(pixels));
  if (!result.sentinel) throw new Error('Attack-lane Weaver missing after runtime wait');
  if (result.sentinel.legs !== 8) throw new Error(`Expected 8 IK legs, got ${result.sentinel.legs}`);
  if (result.newVines < 6) throw new Error(`Expected thread spit to add vines, got ${result.newVines}`);
  if (pixels.error || pixels.nonBlackPct < 1 || pixels.avg < 2) {
    throw new Error(`Canvas appears blank: ${JSON.stringify(pixels)}`);
  }
  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Runtime errors: console=${consoleErrors.length} page=${pageErrors.length}`);
  }
} finally {
  await browser.close();
}
