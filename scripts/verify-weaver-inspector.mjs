import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });

const setup = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const cell = { Empty: 0, Fungus: 30, Glowshroom: 33, Moss: 34 };
  const runtime = ctx.levels.current;
  const mushroom = runtime?.inspectionMarkers?.find((marker) => marker.label === 'Mushroom');
  if (!mushroom) return { ok: false, reason: 'missing mushroom inspection marker' };

  const stemX = Math.round((mushroom.x0 + mushroom.x1) / 2);
  const stemY = mushroom.y1 - 1;
  const idx = ctx.world.idx(stemX, stemY);
  const stemType = ctx.world.types[idx];
  const stemBlocks = ctx.physics.cellBlocks(stemX, stemY);
  const bodyFreeAtStem = ctx.physics.entityFree(stemX, stemY, 4, 17);
  const markerCellCount = (() => {
    let n = 0;
    for (let y = mushroom.y0; y <= mushroom.y1; y++) {
      for (let x = mushroom.x0; x <= mushroom.x1; x++) {
        if (!ctx.world.inBounds(x, y)) continue;
        const t = ctx.world.types[ctx.world.idx(x, y)];
        if (t === cell.Fungus || t === cell.Glowshroom || t === cell.Moss) n++;
      }
    }
    return n;
  })();

  let crate = ctx.rigidBodies.bodies.find((body) => body.shape.kind === 'box' && body.material === 'wood');
  if (!crate) {
    crate = ctx.rigidBodies.spawn({ kind: 'box', halfW: 4, halfH: 4 }, 520, 700, {
      material: 'wood',
      friction: 0.65,
      restitution: 0.12,
    });
  }

  ctx.camera.snapTo((stemX + crate.x) / 2, Math.min(stemY, crate.y) - 40);
  return {
    ok: true,
    stemX,
    stemY,
    stemType,
    stemBlocks,
    bodyFreeAtStem,
    markerCellCount,
    mushroomX: stemX,
    mushroomY: Math.round((mushroom.y0 + mushroom.y1) / 2),
    crateX: crate.x,
    crateY: crate.y,
  };
});

const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

check(setup.ok, setup.reason ?? 'setup failed');
if (setup.ok) {
  check(!setup.stemBlocks, `mushroom stem blocks entities (type=${setup.stemType})`);
  check(setup.bodyFreeAtStem, 'player-sized body cannot occupy mushroom stem cells');
  check(setup.markerCellCount > 0, 'mushroom marker does not cover any growth cells');

  await page.evaluate(({ x, y }) => {
    window.__game.ctx.input.mouse.x = x;
    window.__game.ctx.input.mouse.y = y;
  }, { x: setup.crateX, y: setup.crateY });
  await page.keyboard.press('i');
  await page.waitForTimeout(90);
  const crateText = await page.$eval('#cell-inspector', (el) => el.textContent ?? '');
  check(/Entity:\s+Wood Crate/.test(crateText), `crate inspector did not name the rigid body: ${JSON.stringify(crateText)}`);

  await page.evaluate(({ x, y }) => {
    window.__game.ctx.input.mouse.x = x;
    window.__game.ctx.input.mouse.y = y;
  }, { x: setup.mushroomX, y: setup.mushroomY });
  await page.waitForTimeout(90);
  const mushroomText = await page.$eval('#cell-inspector', (el) => el.textContent ?? '');
  check(/Prefab:\s+Mushroom/.test(mushroomText), `mushroom inspector did not name the authored marker: ${JSON.stringify(mushroomText)}`);

  console.log('SETUP:', JSON.stringify(setup));
  console.log('CRATE INSPECTOR:', JSON.stringify(crateText.split('\n').slice(0, 5)));
  console.log('MUSHROOM INSPECTOR:', JSON.stringify(mushroomText.split('\n').slice(0, 5)));
}

if (pageErrors.length) problems.push('pageErrors: ' + pageErrors.join('; '));
await browser.close();

if (problems.length) {
  console.error('\nFAIL:\n - ' + problems.join('\n - '));
  process.exit(1);
}

console.log('\nPASS — Weaver arena mushrooms are non-colliding and the I inspector names objects.');
