// Runtime probe for the Weaver enemy and its dedicated test playground. Starts
// a real test-mode run in the authored lair, then verifies sleeping, feeding,
// thread writing, IK leg state, and nonblank rendering.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const CELL = Object.freeze({
  Empty: 0,
  Stone: 12,
  Ash: 32,
  Vines: 15,
  Slime: 19,
  Fungus: 30,
  Glowshroom: 33,
  Moss: 34,
});

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
  page.evaluate((cell) => {
    const world = window.__game.ctx.world;
    let vines = 0;
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === cell.Vines) vines++;
    return vines;
  }, CELL);

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

  const initial = await page.evaluate((cell) => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const weavers = ctx.enemies.filter((e) => e.kind === 'weaver');
    let vines = 0;
    let growth = 0;
    let airborneCombatVines = 0;
    for (let i = 0; i < world.types.length; i++) {
      const t = world.types[i];
      if (t === cell.Vines) vines++;
      if (t === cell.Vines || t === cell.Fungus || t === cell.Glowshroom || t === cell.Moss) growth++;
    }
    for (let y = 620; y <= 730; y++) {
      for (let x = 470; x <= 1390; x++) {
        if (world.inBounds(x, y) && world.types[world.idx(x, y)] === cell.Vines) airborneCombatVines++;
      }
    }
    const webStrands = ctx.vineStrands.strands.filter((s) => s.web === true);
    return {
      level: ctx.levels.current?.def?.id ?? null,
      weavers: weavers.length,
      sleeping: weavers.filter((e) => e.sleeping).length,
      critters: ctx.critters.list.length,
      wakeProps: ctx.rigidBodies.bodies.filter((b) => b.x >= 150 && b.x <= 215 && b.y >= 720).length,
      vines,
      growth,
      airborneCombatVines,
      webStrands: webStrands.length,
      denWebs: webStrands.filter((s) => s.denWeb === true).length,
    };
  }, CELL);
  console.log('initial:', JSON.stringify(initial));
  if (initial.level !== 'weaver-test') throw new Error(`Expected weaver-test, got ${initial.level}`);
  if (initial.weavers < 4) throw new Error(`Expected at least 4 Weavers, got ${initial.weavers}`);
  if (initial.sleeping < 1) throw new Error('Expected a sleeping Weaver in the lair');
  if (initial.critters < 5) throw new Error(`Expected seeded prey critters, got ${initial.critters}`);
  if (initial.wakeProps < 2) throw new Error(`Expected two authored wake props, got ${initial.wakeProps}`);
  if (initial.vines < 80 || initial.growth < 200) {
    throw new Error(`Expected webbed fungal arena, got vines=${initial.vines} growth=${initial.growth}`);
  }
  if (initial.airborneCombatVines > 5) {
    throw new Error(`Expected combat-lane web dressing to be live strands, got ${initial.airborneCombatVines} airborne Vine cells`);
  }
  if (initial.webStrands < 1 || initial.denWebs < 1) {
    throw new Error(`Expected live Weaver den web strand, got webs=${initial.webStrands} denWebs=${initial.denWebs}`);
  }

  const gaitSetup = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const gaiter = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
    if (!gaiter) throw new Error('No gait-lane Weaver');
    // Test the gait STANCE deterministically: an ALERTED weaver with a nearby
    // player can't drop into a prey feed-crouch (feeding needs !alerted OR a far
    // player), so it walks at full height regardless of stray moths. Clear prey
    // too, belt-and-suspenders.
    gaiter.alerted = true;
    gaiter.sleeping = false;
    for (const cr of ctx.critters.list.slice()) ctx.critters.remove(cr);
    gaiter.weaverFeedT = 0;
    gaiter.patrol = [
      [512, 742],
      [900, 741],
    ];
    gaiter.patrolIdx = 1;
    gaiter.attackCd = 600; // don't let an attack interrupt the walk
    ctx.player.x = gaiter.x - 70; // within 130px keeps feeding disabled; it chases/strafes (walks)
    ctx.player.y = 741;
    ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
    ctx.camera.snapTo(gaiter.x + 120, gaiter.y - 100);
    return { x: gaiter.x, y: gaiter.y };
  });
  await page.waitForTimeout(1200);
  const gaitResult = await page.evaluate((setup) => {
    const gaiter = window.__game.ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    return {
      x: gaiter?.x ?? setup.x,
      y: gaiter?.y ?? setup.y,
      legs: gaiter?.weaverLegs?.length ?? 0,
      smoothedLegs: gaiter?.weaverLegs?.filter((leg) => Number.isFinite(leg.smoothTx) && Number.isFinite(leg.smoothTy)).length ?? 0,
      bodyLift: gaiter?.weaverBodyLift ?? 0,
      visualSupport: gaiter?.weaverVisualSupport ?? 0,
      visualPlanted: gaiter?.weaverVisualPlanted ?? 0,
      alerted: gaiter?.alerted === true,
      support: gaiter?.weaverSupport ?? 0,
    };
  }, gaitSetup);
  console.log('gait:', JSON.stringify({ setup: gaitSetup, result: gaitResult }));
  if (gaitResult.legs !== 8) throw new Error(`Gait Weaver did not render 8 legs, got ${gaitResult.legs}`);
  if (gaitResult.smoothedLegs !== 8 || gaitResult.bodyLift < 9) {
    throw new Error(`Gait Weaver did not keep smoothed high-stance leg state: ${JSON.stringify(gaitResult)}`);
  }
  if (gaitResult.visualSupport < 0.35 || gaitResult.visualPlanted < 3) {
    throw new Error(`Gait Weaver did not keep enough stable visual leg support: ${JSON.stringify(gaitResult)}`);
  }
  if (Math.abs(gaitResult.x - gaitSetup.x) < 4) {
    throw new Error(`Gait Weaver did not patrol the uneven lane: start=${gaitSetup.x} end=${gaitResult.x}`);
  }

  const unstableSetup = await page.evaluate(
    ({ setup, cell }) => {
      const ctx = window.__game.ctx;
      const world = ctx.world;
      const gaiter = ctx.enemies
        .filter((e) => e.kind === 'weaver')
        .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
      if (!gaiter) throw new Error('No Weaver available for unsupported-footing probe');
      const cx = Math.round(gaiter.x);
      const cy = Math.round(gaiter.y);
      const holeHalfW = 64;
      for (let y = cy - 24; y <= cy + 34; y++) {
        for (let x = cx - 92; x <= cx + 92; x++) {
          if (!world.inBounds(x, y)) continue;
          const i = world.idx(x, y);
          const dx = x - cx;
          if (Math.abs(dx) <= holeHalfW) {
            world.clearCellAt(i);
          } else if (y >= cy + 1 && y <= cy + 8) {
            world.replaceCellAt(i, cell.Stone, 0x777777);
          } else if ((Math.abs(dx) === holeHalfW + 2 || Math.abs(dx) === holeHalfW + 3) && y >= cy - 8 && y <= cy + 12) {
            world.replaceCellAt(i, cell.Stone, 0x777777);
          } else if (y < cy + 1) {
            world.clearCellAt(i);
          }
        }
      }
      let vinesBefore = 0;
      for (let i = 0; i < world.types.length; i++) if (world.types[i] === cell.Vines) vinesBefore++;
      gaiter.sleeping = false;
      gaiter.alerted = true;
      gaiter.cranky = 0;
      gaiter.attackCd = 220;
      gaiter.weaverSupport = 0;
      gaiter.weaverPhysicalSupport = 0;
      gaiter.weaverAnchorCount = 0;
      gaiter.weaverFallT = 0;
      gaiter.weaverTilt = 0;
      gaiter.weaverLegs = undefined;
      gaiter.recoil = 0;
      gaiter.webPulse = 0;
      gaiter.vx = 0.8;
      gaiter.vy = 0;
      gaiter.timer = 33;
      ctx.player.x = gaiter.x + 240;
      ctx.player.y = gaiter.y;
      ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
      return { x: gaiter.x, y: gaiter.y, vinesBefore };
    },
    { setup: gaitSetup, cell: CELL },
  );
  await page.waitForTimeout(420);
  const unstableResult = await page.evaluate(
    ({ setup, cell }) => {
      const ctx = window.__game.ctx;
      const world = ctx.world;
      const gaiter = ctx.enemies
        .filter((e) => e.kind === 'weaver')
        .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
      let vines = 0;
      for (let i = 0; i < world.types.length; i++) if (world.types[i] === cell.Vines) vines++;
      const legs = gaiter?.weaverLegs ?? [];
      const plantedLegs = legs.filter((leg) => leg.planted === true).length;
      const failedLegs = legs.filter((leg) => leg.planted !== true || (leg.failT ?? 0) > 0).length;
      const wallContacts = legs.filter((leg) => leg.surface === 'leftWall' || leg.surface === 'rightWall').length;
      const maxStrain = legs.reduce((max, leg) => Math.max(max, leg.strain ?? 0), 0);
      return {
        recoil: gaiter?.recoil ?? 0,
        webPulse: gaiter?.webPulse ?? 0,
        attackCd: gaiter?.attackCd ?? 0,
        support: gaiter?.weaverSupport ?? 1,
        physicalSupport: gaiter?.weaverPhysicalSupport ?? 1,
        anchorCount: gaiter?.weaverAnchorCount ?? 8,
        visualSupport: gaiter?.weaverVisualSupport ?? 1,
        visualPlanted: gaiter?.weaverVisualPlanted ?? 8,
        fallT: gaiter?.weaverFallT ?? 0,
        tilt: gaiter?.weaverTilt ?? 0,
        y: gaiter?.y ?? setup.y,
        vy: gaiter?.vy ?? 0,
        plantedLegs,
        failedLegs,
        wallContacts,
        maxStrain,
        newVines: vines - setup.vinesBefore,
      };
    },
    { setup: unstableSetup, cell: CELL },
  );
  console.log('cut-floor-footing:', JSON.stringify({ setup: unstableSetup, result: unstableResult }));
  if (unstableResult.webPulse <= 0 || unstableResult.attackCd < 18) {
    throw new Error(`Cut-floor Weaver did not suppress attacks/stumble visibly: ${JSON.stringify(unstableResult)}`);
  }
  if (unstableResult.fallT < 4 || unstableResult.physicalSupport > 0.55) {
    throw new Error(`Cut-floor Weaver did not enter unsupported body state: ${JSON.stringify(unstableResult)}`);
  }
  if (unstableResult.visualSupport > 0.4 || unstableResult.visualPlanted > 4) {
    throw new Error(`Cut-floor Weaver still reported too many visual leg contacts: ${JSON.stringify(unstableResult)}`);
  }
  if (unstableResult.failedLegs < 1 || unstableResult.maxStrain < 0.7) {
    throw new Error(`Cut-floor Weaver legs did not show failed/strained contact search: ${JSON.stringify(unstableResult)}`);
  }
  if (unstableResult.wallContacts < 1 && unstableResult.plantedLegs > 6) {
    throw new Error(`Cut-floor Weaver stayed calm instead of spreading to side footholds: ${JSON.stringify(unstableResult)}`);
  }

  const feedSetup = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const feeder = ctx.enemies
      .filter((e) => e.kind === 'weaver' && !e.sleeping)
      .sort((a, b) => Math.abs(a.x - 1028) - Math.abs(b.x - 1028))[0];
    if (!feeder) throw new Error('No feeder Weaver');
    ctx.camera.snapTo(feeder.x, feeder.y - 90);
    // Feeding now happens only when the weaver is UNAWARE of the alchemist — an alerted
    // weaver commits to the hunt and won't break off to snack. Park the player at the
    // far-left spawn: well out of the feeder's ~300px sense AND clear of the sleeper at
    // x~350 (don't wake it within 82px, or the later sleep scenarios find no sleeper).
    ctx.player.x = 150;
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

  const sleepSetup = await page.evaluate((cell) => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const sleeper = ctx.enemies.find((e) => e.kind === 'weaver' && e.sleeping);
    if (!sleeper) throw new Error('No sleeping Weaver');
    sleeper.sleeping = true;
    sleeper.alerted = false;
    sleeper.cranky = 0;
    sleeper.webPulse = 0;
    sleeper.attackCd = 80;
    ctx.camera.snapTo(sleeper.x, sleeper.y - 90);
    ctx.player.x = sleeper.x - 220;
    ctx.player.y = sleeper.y;
    ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
    ctx.fx.screenShake = 0;
    const critter = ctx.critters.spawn('fly', sleeper.x + 48, sleeper.y - 8);
    ctx.vineStrands.addHanging(sleeper.x, sleeper.y - 58, 72);
    const strand = ctx.vineStrands.strands[ctx.vineStrands.strands.length - 1];
    const node = strand?.nodes?.[Math.min(8, (strand?.nodes?.length ?? 1) - 1)];
    const nodeBefore =
      node && Number.isFinite(node.px) && Number.isFinite(node.py) ? { px: node.px, py: node.py } : null;
    for (let y = Math.floor(sleeper.y) - 24; y <= Math.floor(sleeper.y) - 4; y++) {
      for (let x = Math.floor(sleeper.x) - 8; x <= Math.floor(sleeper.x) + 34; x++) {
        if (!world.inBounds(x, y)) continue;
        world.clearCellAt(world.idx(x, y));
      }
    }
    let vinesBefore = 0;
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === cell.Vines) vinesBefore++;
    const websBefore = ctx.vineStrands.strands.filter((s) => s.web === true).length;
    ctx.events.emit('groundImpact', { x: sleeper.x + 24, y: sleeper.y - 8, radius: 28, strength: 1 });
    let vinesAfter = 0;
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === cell.Vines) vinesAfter++;
    const websAfter = ctx.vineStrands.strands.filter((s) => s.web === true).length;
    const scatterSpeed = Math.hypot(critter.vx, critter.vy);
    const vineImpulse =
      node && nodeBefore && Number.isFinite(node.px) && Number.isFinite(node.py)
        ? Math.abs(node.px - nodeBefore.px) + Math.abs(node.py - nodeBefore.py)
        : 0;
    return {
      x: sleeper.x,
      y: sleeper.y,
      webPulse: sleeper.webPulse ?? 0,
      newVines: vinesAfter - vinesBefore,
      newWebs: websAfter - websBefore,
      scatterSpeed,
      startle: critter.startle ?? 0,
      screenShake: ctx.fx.screenShake,
      vineImpulse,
    };
  }, CELL);
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
  if (sleepSetup.webPulse <= 0) throw new Error('Ground-impact disturbance did not set Weaver webPulse');
  if (sleepSetup.newVines < 1 && sleepSetup.newWebs < 1) {
    throw new Error(
      `Ground-impact disturbance did not write sparse web anchors or live strands, got vines=${sleepSetup.newVines} webs=${sleepSetup.newWebs}`,
    );
  }
  if (sleepSetup.scatterSpeed <= 0.25 || sleepSetup.startle <= 0) {
    throw new Error(`Ground-impact disturbance did not scatter nearby critter: ${JSON.stringify(sleepSetup)}`);
  }
  if (sleepSetup.vineImpulse <= 0) {
    throw new Error(`Ground-impact disturbance did not impulse nearby hanging vine: ${JSON.stringify(sleepSetup)}`);
  }
  if (sleepSetup.screenShake <= 0) throw new Error('Ground-impact disturbance did not shake the screen');
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
    sleeper.webPulse = 0;
    sleeper.attackCd = 80;
    ctx.player.x = sleeper.x - 220;
    ctx.player.y = sleeper.y;
    ctx.fx.screenShake = 0;
    ctx.events.emit('structureStrike', { x: sleeper.x + 18, y: sleeper.y - 8, radius: 6 });
    return {
      sleeping: sleeper.sleeping === true,
      alerted: sleeper.alerted === true,
      cranky: sleeper.cranky ?? 0,
      webPulse: sleeper.webPulse ?? 0,
      screenShake: ctx.fx.screenShake,
      attackCd: sleeper.attackCd,
    };
  }, sleepSetup);
  console.log('sleep-structure-strike:', JSON.stringify(strikeResult));
  if (strikeResult.webPulse <= 0) throw new Error('Structure-strike disturbance did not set Weaver webPulse');
  if (strikeResult.screenShake <= 0) throw new Error('Structure-strike disturbance did not shake the screen');
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

  const supportSetup = await page.evaluate((cell) => {
    const ctx = window.__game.ctx;
    const sentinel = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - 1260) - Math.abs(b.x - 1260))[0];
    if (!sentinel) throw new Error('No support-test Weaver');
    for (const e of ctx.enemies) {
      if (e !== sentinel && e.kind === 'weaver') {
        e.attackCd = Math.max(e.attackCd ?? 0, 240);
        e.blink = 0;
        e.windup = 0;
      }
    }
    const world = ctx.world;
    const cx = Math.floor(sentinel.x);
    const cy = Math.floor(sentinel.y);
    for (let y = cy - 18; y <= cy + 5; y++) {
      for (let x = cx - 74; x <= cx + 74; x++) {
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y);
        const t = world.types[i];
        if (
          t === cell.Vines ||
          t === cell.Fungus ||
          t === cell.Moss ||
          t === cell.Slime ||
          t === cell.Glowshroom
        ) {
          world.clearCellAt(i);
        }
      }
    }
    let localVinesBefore = 0;
    for (let y = cy - 18; y <= cy + 8; y++) {
      for (let x = cx - 80; x <= cx + 80; x++) {
        if (world.inBounds(x, y) && world.types[world.idx(x, y)] === cell.Vines) localVinesBefore++;
      }
    }
    ctx.camera.snapTo(sentinel.x + 100, sentinel.y - 95);
    ctx.player.x = sentinel.x - 260;
    ctx.player.y = sentinel.y;
    ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
    sentinel.alerted = true;
    sentinel.sleeping = false;
    sentinel.attackCd = 80;
    sentinel.blink = 0;
    sentinel.windup = 0;
    sentinel.cranky = 180;
    sentinel.webPulse = 0;
    sentinel.weaverSupport = 0;
    sentinel.grounded = true;
    sentinel.vx = 0;
    sentinel.vy = 0;
    return { x: sentinel.x, y: sentinel.y, localVinesBefore };
  }, CELL);
  await page.waitForTimeout(900);
  const supportResult = await page.evaluate(
    ({ setup, cell }) => {
      const ctx = window.__game.ctx;
      const world = ctx.world;
      const sentinel = ctx.enemies
        .filter((e) => e.kind === 'weaver')
        .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
      const cx = Math.floor(setup.x);
      const cy = Math.floor(setup.y);
      let localVines = 0;
      for (let y = cy - 18; y <= cy + 8; y++) {
        for (let x = cx - 80; x <= cx + 80; x++) {
          if (world.inBounds(x, y) && world.types[world.idx(x, y)] === cell.Vines) localVines++;
        }
      }
      return {
        sentinel: sentinel
          ? {
              x: sentinel.x,
              y: sentinel.y,
              blink: sentinel.blink,
              windup: sentinel.windup ?? 0,
              support: sentinel.weaverSupport ?? 0,
              webPulse: sentinel.webPulse ?? 0,
              recoil: sentinel.recoil ?? 0,
              attackCd: sentinel.attackCd ?? 0,
            }
          : null,
        localVines,
        newLocalVines: localVines - setup.localVinesBefore,
      };
    },
    { setup: supportSetup, cell: CELL },
  );
  console.log('support-loss:', JSON.stringify({ setup: supportSetup, result: supportResult }));
  if (!supportResult.sentinel) throw new Error('Support-test Weaver missing');
  if (supportResult.newLocalVines < 1) {
    throw new Error(`Support recovery did not write foot-trail vines, got ${supportResult.newLocalVines}`);
  }
  if (supportResult.newLocalVines > 80) {
    throw new Error(`Support recovery wrote too many local vines, got ${supportResult.newLocalVines}`);
  }
  if (supportResult.sentinel.windup > 0 || supportResult.sentinel.blink > 0) {
    throw new Error(`Unstable Weaver started an attack: ${JSON.stringify(supportResult.sentinel)}`);
  }

  const vinesBeforeThread = await countVines();
  const threadSetup = await page.evaluate((cell) => {
    const ctx = window.__game.ctx;
    const sentinel = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - 1260) - Math.abs(b.x - 1260))[0];
    if (!sentinel) throw new Error('No thread-test Weaver');
    const world = ctx.world;
    const foot = Math.floor(sentinel.y);
    for (let y = foot - 1; y <= foot + 2; y++) {
      for (let x = Math.floor(sentinel.x) - 72; x <= Math.floor(sentinel.x) + 72; x += 2) {
        if (!world.inBounds(x, y)) continue;
        world.replaceCellAt(world.idx(x, y), cell.Moss, 0x4f8a45);
      }
    }
    const playerX = Math.floor(sentinel.x - 154);
    const playerY = Math.floor(sentinel.y - 58);
    for (let x = playerX - 8; x <= playerX + 8; x++) {
      if (world.inBounds(x, playerY + 1)) world.replaceCellAt(world.idx(x, playerY + 1), cell.Stone, 0x777777);
    }
    ctx.camera.snapTo(sentinel.x - 35, sentinel.y - 120);
    ctx.player.x = playerX;
    ctx.player.y = playerY;
    ctx.player.hp = ctx.player.maxHp;
    ctx.player.dead = false;
    ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
    sentinel.alerted = true;
    sentinel.sleeping = false;
    sentinel.attackCd = 0;
    sentinel.blink = 0;
    sentinel.windup = 0;
    sentinel.cranky = 0;
    sentinel.webPulse = 0;
    sentinel.weaverSupport = 1;
    sentinel.weaverPhysicalSupport = 1;
    sentinel.weaverAnchorCount = 8;
    sentinel.weaverFallT = 0;
    sentinel.grounded = true;
    sentinel.vx = 0;
    sentinel.vy = 0;
    return {
      x: sentinel.x,
      y: sentinel.y,
      websBefore: ctx.vineStrands.strands.filter((s) => s.web === true).length,
    };
  }, CELL);
  await page.waitForTimeout(240);
  const threadTelegraph = await page.evaluate((setup) => {
    const sentinel = window.__game.ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    return { blink: sentinel?.blink ?? 0, windup: sentinel?.windup ?? 0 };
  }, threadSetup);
  await page.waitForTimeout(1050);
  const threadResult = await page.evaluate(
    ({ setup, vinesBefore, cell }) => {
      const ctx = window.__game.ctx;
      const world = ctx.world;
      const sentinel = ctx.enemies
        .filter((e) => e.kind === 'weaver')
        .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
      let vines = 0;
      for (let i = 0; i < world.types.length; i++) if (world.types[i] === cell.Vines) vines++;
      const webStrands = ctx.vineStrands.strands.filter((s) => s.web === true);
      const web = webStrands[webStrands.length - 1] ?? null;
      const mid = web?.nodes?.[Math.floor(web.nodes.length / 2)] ?? null;
      const first = web?.nodes?.[0] ?? null;
      const last = web?.nodes?.[Math.max(0, (web?.nodes?.length ?? 1) - 1)] ?? null;
      return {
        sentinel: sentinel
          ? {
              x: sentinel.x,
              y: sentinel.y,
              blink: sentinel.blink,
              windup: sentinel.windup ?? 0,
              attackCd: sentinel.attackCd ?? 0,
              legs: sentinel.weaverLegs?.length ?? 0,
              support: sentinel.weaverSupport ?? 0,
            }
          : null,
        vines,
        newVines: vines - vinesBefore,
        webCount: webStrands.length,
        newWebs: webStrands.length - setup.websBefore,
        web: web
          ? {
              nodes: web.nodes.length,
              segments: web.segments.length,
              freeWeb: web.freeWeb === true,
              ashOnExpire: web.ashOnExpire === true,
              midX: mid?.x ?? null,
              midY: mid?.y ?? null,
              firstX: first?.x ?? null,
              firstY: first?.y ?? null,
              lastX: last?.x ?? null,
              lastY: last?.y ?? null,
            }
          : null,
      };
    },
    { setup: threadSetup, vinesBefore: vinesBeforeThread, cell: CELL },
  );
  await page.waitForTimeout(300);
  const threadMotion = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const webStrands = ctx.vineStrands.strands.filter((s) => s.web === true);
    const web = webStrands[webStrands.length - 1] ?? null;
    const mid = web?.nodes?.[Math.floor(web.nodes.length / 2)] ?? null;
    return mid ? { midX: mid.x, midY: mid.y } : null;
  });
  const threadMove =
    threadResult.web && threadMotion
      ? Math.hypot(threadMotion.midX - threadResult.web.midX, threadMotion.midY - threadResult.web.midY)
      : 0;
  const threadExpiry = await page.evaluate(async (cell) => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const webStrands = ctx.vineStrands.strands.filter((s) => s.web === true && s.freeWeb === true);
    const web = webStrands[webStrands.length - 1] ?? null;
    if (!web) return { found: false };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of web.nodes) {
      minX = Math.min(minX, Math.floor(node.x) - 8);
      minY = Math.min(minY, Math.floor(node.y) - 8);
      maxX = Math.max(maxX, Math.floor(node.x) + 8);
      maxY = Math.max(maxY, Math.floor(node.y) + 8);
    }
    minX = Math.max(0, minX);
    minY = Math.max(0, minY);
    maxX = Math.min(world.width - 1, maxX);
    maxY = Math.min(world.height - 1, maxY);
    const countAsh = () => {
      let ash = 0;
      let blockingAsh = 0;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const i = world.idx(x, y);
          if (world.types[i] !== cell.Ash) continue;
          ash++;
          if (ctx.physics.cellBlocks(x, y)) blockingAsh++;
        }
      }
      return { ash, blockingAsh };
    };
    const before = countAsh();
    web.maxAge = Math.min(web.maxAge ?? web.age + 2, web.age + 2);
    await new Promise((resolve) => {
      let frames = 0;
      const tick = () => {
        frames++;
        if (frames >= 8) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const after = countAsh();
    return {
      found: true,
      before,
      after,
      deltaAsh: after.ash - before.ash,
      deltaBlockingAsh: after.blockingAsh - before.blockingAsh,
      remainingFreeWebs: ctx.vineStrands.strands.filter((s) => s.web === true && s.freeWeb === true).length,
    };
  }, CELL);
  console.log(
    'thread-spit:',
    JSON.stringify({ setup: threadSetup, telegraph: threadTelegraph, result: threadResult, motion: threadMotion, threadMove, expiry: threadExpiry }),
  );
  if (!threadResult.sentinel) throw new Error('Thread-test Weaver missing');
  if (threadTelegraph.blink <= 0 || threadTelegraph.windup > 0) {
    throw new Error(`Mid-range Weaver did not naturally choose Thread Spit: ${JSON.stringify(threadTelegraph)}`);
  }
  if (threadResult.newWebs < 1 || !threadResult.web) {
    throw new Error(`Expected natural Thread Spit to add a live web strand, got ${JSON.stringify(threadResult)}`);
  }
  if (threadResult.web.freeWeb !== true || threadResult.web.ashOnExpire !== true) {
    throw new Error(`Thread Spit web should be an unpinned launched strand that expires to Ash: ${JSON.stringify(threadResult.web)}`);
  }
  if (threadResult.web.nodes < 9 || threadResult.web.segments < threadResult.web.nodes - 1) {
    throw new Error(`Thread Spit web does not have enough Verlet structure: ${JSON.stringify(threadResult.web)}`);
  }
  if (threadResult.newVines > 140) {
    throw new Error(`Thread Spit likely painted a static vine line instead of a live strand, vine delta=${threadResult.newVines}`);
  }
  // A live free-Verlet web keeps a little residual jitter (gravity + constraints)
  // even as it settles onto terrain; a static painted vine line is dead-still at 0.
  // The structure checks above already prove it's a real strand, so this only needs
  // to catch the static-line case — keep the floor low so a settled web isn't flaky.
  if (threadMove <= 0.005) {
    throw new Error(`Thread Spit web did not keep moving as live Verlet cloth, movement=${threadMove}`);
  }
  if (!threadExpiry.found || threadExpiry.remainingFreeWebs >= threadResult.webCount) {
    throw new Error(`Thread Spit web did not expire during residue check: ${JSON.stringify(threadExpiry)}`);
  }
  if (threadExpiry.deltaAsh > 9 || threadExpiry.deltaBlockingAsh > 0) {
    throw new Error(`Thread Spit expiry should shed only sparse nonblocking Ash, or no Ash when unsafe: ${JSON.stringify(threadExpiry)}`);
  }

  const needleSetup = await page.evaluate(({ setup, cell }) => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const sentinel = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    if (!sentinel) throw new Error('No needle-test Weaver');
    const foot = Math.floor(sentinel.y);
    for (let y = foot - 1; y <= foot + 2; y++) {
      for (let x = Math.floor(sentinel.x) - 72; x <= Math.floor(sentinel.x) + 72; x += 2) {
        if (!world.inBounds(x, y)) continue;
        world.replaceCellAt(world.idx(x, y), cell.Moss, 0x4f8a45);
      }
    }
    ctx.camera.snapTo(sentinel.x, sentinel.y - 95);
    ctx.player.x = sentinel.x - 58;
    ctx.player.y = sentinel.y;
    ctx.player.hp = ctx.player.maxHp;
    ctx.player.dead = false;
    ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
    sentinel.alerted = true;
    sentinel.sleeping = false;
    sentinel.attackCd = 0;
    sentinel.blink = 0;
    sentinel.windup = 0;
    sentinel.needleX = undefined;
    sentinel.needleY = undefined;
    sentinel.weaverSupport = 1;
    sentinel.weaverPhysicalSupport = 1;
    sentinel.weaverAnchorCount = 8;
    sentinel.weaverFallT = 0;
    sentinel.grounded = true;
    sentinel.timer = 5;
    sentinel.vx = 0;
    sentinel.vy = 0;
    return { x: sentinel.x, y: sentinel.y, hpBefore: ctx.player.hp };
  }, { setup: threadSetup, cell: CELL });
  await page.waitForTimeout(180);
  const needleTelegraph = await page.evaluate((setup) => {
    const sentinel = window.__game.ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    return {
      windup: sentinel?.windup ?? 0,
      blink: sentinel?.blink ?? 0,
      needleX: sentinel?.needleX ?? null,
      needleY: sentinel?.needleY ?? null,
    };
  }, needleSetup);
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${outDir}/weaver-runtime.png` });

  const result = await page.evaluate((setup) => {
    const ctx = window.__game.ctx;
    const sentinel = ctx.enemies
      .filter((e) => e.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - setup.x) - Math.abs(b.x - setup.x))[0];
    return {
      sentinel: sentinel
        ? {
            hp: sentinel.hp,
            x: sentinel.x,
            y: sentinel.y,
            blink: sentinel.blink,
            windup: sentinel.windup ?? 0,
            attackCd: sentinel.attackCd ?? 0,
            legs: sentinel.weaverLegs?.length ?? 0,
            support: sentinel.weaverSupport ?? 0,
            needleX: sentinel.needleX ?? null,
            needleY: sentinel.needleY ?? null,
          }
        : null,
      playerHp: ctx.player.hp,
      playerHpBefore: setup.hpBefore,
      enemies: ctx.enemies.length,
    };
  }, needleSetup);
  const pixels = await samplePixels();
  console.log('needle-step:', JSON.stringify({ setup: needleSetup, telegraph: needleTelegraph, result }));
  console.log('pixels:', JSON.stringify(pixels));
  if (!result.sentinel) throw new Error('Needle-test Weaver missing after runtime wait');
  if (result.sentinel.legs !== 8) throw new Error(`Expected 8 IK legs, got ${result.sentinel.legs}`);
  if (needleTelegraph.windup <= 0 || needleTelegraph.blink > 0 || needleTelegraph.needleX === null) {
    throw new Error(`Close-range Weaver did not naturally choose Needle Step: ${JSON.stringify(needleTelegraph)}`);
  }
  if (result.playerHp >= result.playerHpBefore) {
    throw new Error(`Needle Step did not damage the player: before=${result.playerHpBefore} after=${result.playerHp}`);
  }
  if (result.sentinel.needleX !== null || result.sentinel.needleY !== null) {
    throw new Error(`Needle Step target was not cleared after strike: ${JSON.stringify(result.sentinel)}`);
  }
  if (pixels.error || pixels.nonBlackPct < 1 || pixels.avg < 2) {
    throw new Error(`Canvas appears blank: ${JSON.stringify(pixels)}`);
  }
  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Runtime errors: console=${consoleErrors.length} page=${pageErrors.length}`);
  }
} finally {
  await browser.close();
}
