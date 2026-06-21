// Verifies the DEBUG FREEZE + DRAG case the report calls out: a weaver whose AI is
// NOT running (no climb state) still rotates to a surface its legs can grip, purely
// from the leg-grip PCA. Pins the body (AI suppressed) beside a wall / under a
// ceiling each frame and reads back e.weaverOrient.
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const DEG = (r) => Math.round((r * 180) / Math.PI);

const pin = (n, fn) =>
  page.evaluate(
    ({ n, fn }) =>
      new Promise((res) => {
        const ctx = window.__game.ctx;
        const e = ctx.enemies.find((g) => g.__probeId === 1);
        let k = 0;
        const tick = () => {
          new Function('ctx', 'e', fn)(ctx, e); // re-pin each frame (simulates a held drag)
          ctx.camera.zoomLock = 1;
          ctx.camera.snapTo(e.x, e.y - 10);
          if (++k >= n) return res();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { n, fn },
  );
const readOrient = () =>
  page.evaluate(() => {
    const e = window.__game.ctx.enemies.find((g) => g.__probeId === 1);
    return {
      orient: e.weaverOrient ?? 0,
      vp: e.weaverVisualPlanted ?? 0,
      grounded: e.grounded === true,
      climbT: e.weaverClimbT ?? 0,
    };
  });

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, {
    level: 'weaver-test',
    world: 'campaign-level',
    seed: 1,
    settleMs: 400,
  });
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const e = ctx.enemies
      .filter((g) => g.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
    e.__probeId = 1;
    for (const o of ctx.enemies) if (o.kind === 'weaver' && o !== e) o.x = 30;
    for (const c of ctx.critters.list.slice())
      ctx.critters.killAt(ctx, c.x, c.y, 2);
  });

  // WALL: a sheer wall on the weaver's right; body held in open air just left of it,
  // AI idle (unalerted, no climb). Legs should grip the wall -> body rotates ~+90.
  await page.evaluate(() => {
    const ctx = window.__game.ctx,
      w = ctx.world;
    const wallX = 560;
    for (let x = 360; x <= 700; x++)
      for (let y = 640; y <= 760; y++) {
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        if (x >= wallX) w.replaceCellAt(i, 12, 0x6f6f6f);
        else w.clearCellAt(i);
      }
    const e = ctx.enemies.find((g) => g.__probeId === 1);
    e.x = wallX - 11;
    e.y = 700;
    e.alerted = false;
    e.sleeping = false;
    e.attackCd = 9999;
    e.weaverClimbT = 0;
    e.weaverClimbDir = 0;
  });
  await pin(
    70,
    'e.x=549; e.y=700; e.vx=0; e.vy=0; e.grounded=false; e.alerted=false; e.weaverClimbT=0; e.weaverClimbDir=0;',
  );
  const wall = await readOrient();
  console.log('DRAG-WALL   ', JSON.stringify(wall), 'deg=', DEG(wall.orient));

  // CEILING: a slab above; body held just beneath it. Legs grip up -> rotate ~180.
  await page.evaluate(() => {
    const ctx = window.__game.ctx,
      w = ctx.world;
    const cy = 680;
    for (let x = 360; x <= 700; x++)
      for (let y = cy - 12; y <= cy; y++)
        if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), 12, 0x6f6f6f);
    for (let x = 360; x <= 700; x++)
      for (let y = cy + 1; y <= cy + 90; y++)
        if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
    const e = ctx.enemies.find((g) => g.__probeId === 1);
    e.x = 520;
    e.y = cy + 13;
    e.alerted = false;
    e.sleeping = false;
    e.weaverClimbT = 0;
    e.weaverClimbDir = 0;
  });
  await pin(
    70,
    'e.x=520; e.y=693; e.vx=0; e.vy=0; e.grounded=false; e.alerted=false; e.weaverClimbT=0; e.weaverClimbDir=0;',
  );
  const ceil = await readOrient();
  console.log('DRAG-CEILING', JSON.stringify(ceil), 'deg=', DEG(ceil.orient));

  const problems = [];
  if (!(wall.orient > 0.9 && wall.orient < 2.2))
    problems.push(
      `dragged body did not rotate onto the wall (orient ${DEG(wall.orient)} deg, planted ${wall.vp}, climbT ${wall.climbT})`,
    );
  if (Math.abs(Math.abs(ceil.orient) - Math.PI) > 0.7)
    problems.push(
      `dragged body did not flip under the ceiling (orient ${DEG(ceil.orient)} deg, planted ${ceil.vp})`,
    );
  if (problems.length) {
    console.error('FAIL:\n - ' + problems.join('\n - '));
    process.exitCode = 1;
  } else
    console.log(
      'PASS — a frozen/dragged weaver rotates onto a wall and under a ceiling from leg-grip alone (no AI climb state).',
    );
} finally {
  await browser.close();
}
