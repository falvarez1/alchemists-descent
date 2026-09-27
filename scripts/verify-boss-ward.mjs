// The boss ward, live (core/bossWard; QA P0 "the Kiln Colossus dies on its own").
// (1) IDLE: at each seed, stand ~110 cells from the Kiln Colossus, then ~50
//     inside its lair, doing nothing for `idleSecs` in total → its hp must not
//     move and its ceiling tank must stay sealed and full.
// (2) FLOOD: stand on the arena floor and dig the tank's seal with REAL clicks
//     → the water must crack it with at least one THERMAL SHOCK burst.
// Usage: node scripts/verify-boss-ward.mjs [url] [seedCsv] [idleSecs] [floodSeed]
// Needs the dev server (window.__game is DEV-only). God mode keeps the prober
// alive (lava ignores invulnerability); it casts nothing while idle.
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,2,3,4').split(',').map(Number);
const idleSecs = Number(process.argv[4] ?? 60);
const floodSeed = Number(process.argv[5] ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });

async function enterKiln(seed) {
  await startConsoleRun(page, { subcommand: 'test', level: 'd4', seed, settleMs: 300 });
  return page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.state.debugGodMode = true;
    const b = ctx.levels.current.boss;
    const W = ctx.world;
    // world/structures: the tank's seal is 36-37 rows above the boss spawn, 15 wide
    window.__tank = () => {
      let seal = 0, water = 0;
      for (let dx = -7; dx <= 7; dx++) {
        for (const dy of [1, 2]) if (W.types[W.idx(b.x + dx, b.y - 38 + dy)] === 12) seal++;
        for (let dy = -6; dy <= 0; dy++) if (W.types[W.idx(b.x + dx, b.y - 38 + dy)] === 2) water++;
      }
      return { seal, water };
    };
    window.__cracks = 0;
    if (!ctx.__wardHooked) {
      ctx.__wardHooked = true;
      ctx.events.on('combatCallout', ({ text }) => { if (text === 'THERMAL SHOCK') window.__cracks++; });
    }
    const c = ctx.enemies.find((e) => e.kind === 'colossus');
    return { hp: c.hp, maxHp: c.maxHp, tank: window.__tank() };
  });
}

function standNear(r) {
  return page.evaluate((r) => {
    const ctx = window.__game.ctx;
    const b = ctx.enemies.find((e) => e.kind === 'colossus');
    const bl = (x, y) => ctx.physics.cellBlocks(Math.floor(x), Math.floor(y));
    for (const rr of [r, r + 15, r - 15, r + 30]) {
      for (const s of [1, -1]) {
        const sx = Math.round(b.x + s * rr);
        for (let k = 0; k < 120; k++) {
          const sy = Math.round(b.y) + (k % 2 ? -(k + 1) / 2 : k / 2);
          if (!ctx.world.inBounds(sx, sy + 1) || !bl(sx, sy + 1)) continue;
          let ok = true;
          for (let h = 0; h < 22 && ok; h++) for (let dx = -4; dx <= 4; dx++) if (bl(sx + dx, sy - h)) { ok = false; break; }
          if (!ok) continue;
          Object.assign(ctx.player, { x: sx, y: sy, vx: 0, vy: 0 });
          ctx.camera.snapTo(sx, sy);
          return Math.round(Math.hypot(b.x - sx, b.y - sy));
        }
      }
    }
    return null;
  }, r);
}

const colossus = () => page.evaluate(() => {
  const c = window.__game.ctx.enemies.find((e) => e.kind === 'colossus');
  return { hp: c ? c.hp : null, tank: window.__tank(), cracks: window.__cracks };
});

let failures = 0;
for (const seed of seeds) {
  const start = await enterKiln(seed);
  const far = await standNear(110);
  await sleep((idleSecs * 1000) / 3);
  const near = await standNear(50);
  await sleep((idleSecs * 2000) / 3);
  const end = await colossus();
  const ok = start.tank.seal === 30 && start.tank.water === 105 && end.hp === start.maxHp && end.tank.seal === 30;
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'} idle seed=${seed} stood ${far}/${near} cells hp ${start.hp}->${end.hp}/${start.maxHp} tank ${JSON.stringify(start.tank)}->${JSON.stringify(end.tank)}`);
}

if (floodSeed) {
  const start = await enterKiln(floodSeed);
  const stood = await page.evaluate(() => {
    const ctx = window.__game.ctx, b = ctx.levels.current.boss;
    const bl = (x, y) => ctx.physics.cellBlocks(Math.floor(x), Math.floor(y));
    for (const dx of [-22, 22, -28, 28, -16, 16]) {
      const sx = b.x + dx;
      for (let sy = b.y - 20; sy < b.y + 12; sy++) {
        if (!bl(sx, sy + 1) || bl(sx, sy)) continue;
        let ok = true;
        for (let h = 0; h < 20 && ok; h++) for (let q = -4; q <= 4; q++) if (bl(sx + q, sy - h)) { ok = false; break; }
        if (!ok) continue;
        Object.assign(ctx.player, { x: sx, y: sy, vx: 0, vy: 0 });
        ctx.camera.snapTo(sx, sy - 20);
        return true;
      }
    }
    return false;
  });
  await sleep(2500); // the entrance beat
  let clicks = 0;
  for (; clicks < 40 && stood; clicks++) {
    const st = await page.evaluate(() => {
      const ctx = window.__game.ctx, b = ctx.levels.current.boss, cam = ctx.camera;
      const canvas = document.querySelector('#canvas-holder > canvas');
      const rect = canvas.getBoundingClientRect();
      const x = b.x + (Math.random() - 0.5) * 8, y = b.y - 36;
      // world -> client (the compose quad: 640x360 view, zoom about the centre)
      const VW = 640, VH = 360, zoom = cam.zoom;
      const fracX = cam.x - Math.floor(cam.x), fracY = cam.y - Math.floor(cam.y);
      const ndcX = ((x - cam.renderX + 0.5) / VW - 0.5) * 2 * (1 + 4 / VW) * zoom - fracX * (2 / VW) * zoom;
      const ndcY = -((y - cam.renderY + 0.5) / VH - 0.5) * 2 * (1 + 4 / VH) * zoom + fracY * (2 / VH) * zoom;
      return { tank: window.__tank(), cx: rect.left + ((ndcX + 1) / 2) * rect.width, cy: rect.top + ((1 - ndcY) / 2) * rect.height };
    });
    if (st.tank.seal < 10) break;
    await page.mouse.move(st.cx, st.cy);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
    await sleep(420);
  }
  await sleep(7000);
  const end = await colossus();
  const ok = stood && end.cracks >= 1;
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'} flood seed=${floodSeed} dug the seal in ${clicks} clicks; THERMAL SHOCK x${end.cracks}; hp ${start.hp}->${end.hp ?? 'slain'}`);
}

if (pageErrors.length) {
  failures++;
  console.log('page errors:', pageErrors.slice(0, 5));
}
await browser.close();
if (failures) {
  console.error(`BOSS WARD FAILED: ${failures} issue(s)`);
  process.exit(1);
}
console.log('BOSS WARD OK');
