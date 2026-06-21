// Stage-1 verification: does the Weaver body ROTATE to match the surface its legs
// grip? Reads back e.weaverOrient (radians: 0 floor, +pi/2 wall-right, -pi/2 wall-
// left, +-pi ceiling) in three scenarios and grabs a zoomed screenshot of each.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const DEG = (r) => Math.round((r * 180) / Math.PI);

const grab = (file, cx, cy, half = 44, Z = 5) =>
  page
    .evaluate(
      ({ cx, cy, half, Z }) =>
        new Promise((res) => {
          const ctx = window.__game.ctx;
          ctx.camera.zoomLock = 1;
          ctx.camera.snapTo(cx, cy);
          requestAnimationFrame(() => {
            const cam = ctx.camera,
              gl = document.querySelector('#canvas-holder > canvas');
            const sx = gl.width / 575,
              sy = gl.height / 391;
            const px = (cx - cam.renderX) * sx,
              py = (cy - cam.renderY) * sy;
            const hw = half * sx,
              hh = half * sy;
            const o = document.createElement('canvas');
            o.width = Math.round(hw * 2 * Z);
            o.height = Math.round(hh * 2 * Z);
            const g = o.getContext('2d');
            g.imageSmoothingEnabled = false;
            g.drawImage(gl, px - hw, py - hh, hw * 2, hh * 2, 0, 0, o.width, o.height);
            res(o.toDataURL('image/png'));
          });
        }),
      { cx, cy, half, Z },
    )
    .then((d) => writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')));

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });
  await page.evaluate(() => {
    const r = document.getElementById('game-hud');
    if (r) r.style.opacity = '0';
  });

  // ---- pick a subject weaver, silence the rest, clear prey ----
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const e = ctx.enemies
      .filter((g) => g.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
    e.__probeId = 1;
    for (const o of ctx.enemies) if (o.kind === 'weaver' && o !== e) { o.attackCd = 9999; o.alerted = false; o.x = 30; }
    for (const c of ctx.critters.list.slice()) ctx.critters.killAt(ctx, c.x, c.y, 2);
    ctx.player.hp = ctx.player.maxHp = 99999;
  });

  const readOrient = () =>
    page.evaluate(() => {
      const e = window.__game.ctx.enemies.find((g) => g.__probeId === 1);
      return { orient: e.weaverOrient ?? 0, x: Math.round(e.x), y: Math.round(e.y), grounded: e.grounded === true, climbT: e.weaverClimbT ?? 0, climbDir: e.weaverClimbDir ?? 0, vp: e.weaverVisualPlanted ?? 0 };
    });
  const settle = (n, fn) =>
    page.evaluate(
      ({ n, fn }) =>
        new Promise((res) => {
          const ctx = window.__game.ctx;
          const e = ctx.enemies.find((g) => g.__probeId === 1);
          let k = 0;
          const tick = () => {
            if (fn) new Function('ctx', 'e', fn)(ctx, e);
            ctx.camera.zoomLock = 1;
            ctx.camera.snapTo(e.x, e.y - 12);
            if (++k >= n) return res();
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { n, fn },
    );

  // =================== 1) FLOOR ===================
  await page.evaluate(() => {
    const ctx = window.__game.ctx,
      w = ctx.world;
    const fy = 742;
    for (let x = 380; x <= 660; x++)
      for (let y = fy; y <= fy + 10; y++) {
        if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), 12, 0x6f6f6f);
      }
    for (let x = 380; x <= 660; x++)
      for (let y = fy - 60; y < fy; y++) {
        if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
      }
    const e = ctx.enemies.find((g) => g.__probeId === 1);
    e.x = 520; e.y = fy - 1; e.vx = e.vy = 0; e.alerted = false; e.sleeping = false; e.attackCd = 9999;
    e.weaverClimbT = 0; e.weaverClimbDir = 0;
  });
  await settle(70);
  const floor = await readOrient();
  await grab('verify-out/orient-1-floor.png', floor.x, floor.y - 12);
  console.log('FLOOR  ', JSON.stringify(floor), 'deg=', DEG(floor.orient));

  // =================== 2) WALL (real climb, proven setup) ===================
  const base = await page.evaluate(() => {
    const ctx = window.__game.ctx,
      w = ctx.world;
    const fy = 742,
      wallX = 720,
      top = fy - 70;
    for (let x = 560; x <= 860; x++)
      for (let y = top - 40; y <= fy + 8; y++) {
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f);
        else if (x >= wallX && y >= top) w.replaceCellAt(i, 12, 0x6f6f6f);
        else w.clearCellAt(i);
      }
    const e = ctx.enemies.find((g) => g.__probeId === 1);
    // start it RIGHT beside the wall face (body right edge clears x=wallX-1) and part
    // way up, so the climb engages within a few frames instead of after a long walk.
    e.x = wallX - 10; e.y = top + 24; e.vx = e.vy = 0; e.weaverClimbT = 0; e.weaverClimbDir = 0;
    e.alerted = true; e.cranky = 600; e.attackCd = 9999;
    ctx.player.x = wallX + 36; ctx.player.y = top - 2;
    return { fy, wallX, top };
  });
  // run the chase+climb; capture the FIRST frame it is latched mid-face (climbT>0,
  // still below the lip) so we read the body squared onto the wall, not the crest.
  let wallSample = null;
  for (let f = 0; f < 160; f++) {
    await page.evaluate(() => {
      const ctx = window.__game.ctx;
      const e = ctx.enemies.find((g) => g.__probeId === 1);
      e.cranky = 600;
      ctx.player.hp = ctx.player.maxHp = 99999;
      return new Promise((res) => {
        ctx.camera.zoomLock = 1;
        ctx.camera.snapTo(e.x, e.y - 12);
        requestAnimationFrame(res);
      });
    });
    const s = await readOrient();
    if (s.climbT > 12) {
      wallSample = s;
      break;
    }
  }
  wallSample = wallSample || (await readOrient());
  await grab('verify-out/orient-2-wall.png', wallSample.x, wallSample.y - 12);
  console.log('WALL   ', JSON.stringify(wallSample), 'deg=', DEG(wallSample.orient));

  // =================== 3) CEILING (legs grip the underside) ===================
  await page.evaluate(() => {
    const ctx = window.__game.ctx,
      w = ctx.world;
    const cy = 700; // ceiling underside row
    for (let x = 380; x <= 660; x++)
      for (let y = cy - 12; y <= cy; y++) {
        if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), 12, 0x6f6f6f);
      }
    for (let x = 380; x <= 660; x++)
      for (let y = cy + 1; y <= cy + 80; y++) {
        if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
      }
    const e = ctx.enemies.find((g) => g.__probeId === 1);
    e.x = 520; e.y = cy + 14; e.vx = e.vy = 0; e.alerted = false; e.sleeping = false; e.attackCd = 9999;
    e.grounded = true; // not "lifted" -> legs search for grip (incl. ceiling) instead of dangling
    e.weaverClimbT = 0; e.weaverClimbDir = 0;
  });
  // pin the body under the ceiling each frame (no ceiling locomotion yet — this is a
  // pure render-orientation check that legs gripping ABOVE flip the body upside-down).
  await settle(70, 'e.vy=0; e.y=714; e.grounded=true; e.alerted=false; e.weaverClimbT=0; e.weaverClimbDir=0;');
  const ceil = await readOrient();
  await grab('verify-out/orient-3-ceiling.png', ceil.x, ceil.y - 4);
  console.log('CEILING', JSON.stringify(ceil), 'deg=', DEG(ceil.orient));

  // ---- verdict ----
  const problems = [];
  if (Math.abs(floor.orient) > 0.3) problems.push(`floor not upright (orient ${DEG(floor.orient)} deg)`);
  if (!(wallSample.orient > 1.0 && wallSample.orient < 2.1)) problems.push(`wall body not rotated ~+90 (orient ${DEG(wallSample.orient)} deg, climbT ${wallSample.climbT})`);
  if (Math.abs(Math.abs(ceil.orient) - Math.PI) > 0.7) problems.push(`ceiling body not flipped ~180 (orient ${DEG(ceil.orient)} deg, planted ${ceil.vp})`);
  if (problems.length) {
    console.error('FAIL:\n - ' + problems.join('\n - '));
    process.exitCode = 1;
  } else {
    console.log('PASS — body orients to floor (0), wall (~90), ceiling (~180).');
  }
} finally {
  await browser.close();
}
