// Stage-3 verification: a barrier (tall pillar) stands between the Weaver and a
// SAME-LEVEL alchemist. A Lukki climbs over it (up, crest, down) to reach the prey
// instead of pinning its body against the wall. Tracks whether the weaver crosses to
// the quarry's side of the barrier.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const grab = (file, cx, cy, half = 70, Z = 4) =>
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

  const WIDTH_ARG = Number(process.argv[3] || 18);
  const env = await page.evaluate((wArg) => {
    const ctx = window.__game.ctx,
      w = ctx.world;
    const fy = 742,
      pillarL = 600,
      pillarR = 600 + wArg,
      pillarTop = fy - 52;
    // clear a wide bay, lay a floor, raise one pillar between weaver and prey
    for (let x = 360; x <= 900; x++)
      for (let y = fy - 80; y <= fy + 10; y++) {
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f);
        else if (x >= pillarL && x <= pillarR && y >= pillarTop) w.replaceCellAt(i, 12, 0x6f6f6f);
        else w.clearCellAt(i);
      }
    const e = ctx.enemies
      .filter((g) => g.kind === 'weaver')
      .sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
    e.__probeId = 1;
    for (const o of ctx.enemies) if (o.kind === 'weaver' && o !== e) { o.x = 30; o.alerted = false; o.attackCd = 9999; }
    for (const c of ctx.critters.list.slice()) ctx.critters.killAt(ctx, c.x, c.y, 2);
    // weaver LEFT of the pillar, alchemist RIGHT of it — SAME ground level
    e.x = 540; e.y = fy - 1; e.vx = e.vy = 0; e.alerted = true; e.cranky = 600; e.sleeping = false; e.attackCd = 9999;
    e.weaverClimbT = 0; e.weaverClimbDir = 0; e.patrol = undefined;
    ctx.player.x = pillarR + 80; ctx.player.y = fy - 2; ctx.player.hp = ctx.player.maxHp = 99999;
    return { fy, pillarL, pillarR, pillarTop };
  }, WIDTH_ARG);

  const sample = () =>
    page.evaluate(() => {
      const ctx = window.__game.ctx;
      const e = ctx.enemies.find((g) => g.__probeId === 1);
      return {
        x: Math.round(e.x), y: Math.round(e.y),
        climbT: e.weaverClimbT ?? 0, climbDir: e.weaverClimbDir ?? 0,
        grounded: e.grounded === true, orient: +(e.weaverOrient ?? 0).toFixed(2),
        pdx: Math.round(ctx.player.x - e.x),
        vx: +(e.vx ?? 0).toFixed(2), pSup: +(e.weaverPhysicalSupport ?? 0).toFixed(2), anc: e.weaverAnchorCount ?? 0,
        bal: Math.round((e.weaverSupportCenterX ?? e.x) - e.x), crest: e.weaverCrest ?? 0, cranky: e.cranky ?? 0,
      };
    });

  let minY = 99999, maxX = -1, crossed = false, reached = false, everClimbed = false;
  for (let f = 0; f < 420; f++) {
    await page.evaluate(() => {
      const ctx = window.__game.ctx;
      const e = ctx.enemies.find((g) => g.__probeId === 1);
      e.cranky = 600; ctx.player.hp = ctx.player.maxHp = 99999;
      return new Promise((res) => { ctx.camera.zoomLock = 1; ctx.camera.snapTo(e.x, e.y - 14); requestAnimationFrame(res); });
    });
    const s = await sample();
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x);
    if (s.climbT > 0) everClimbed = true;
    if (s.x > env.pillarR + 4) crossed = true;
    if (Math.abs(s.pdx) < 16) reached = true;
    if (f % 40 === 0) console.log('f' + f, JSON.stringify(s));
    if (f === 120) await grab('verify-out/barrier-1-climb.png', s.x, s.y - 14);
    if (crossed && reached) { await grab('verify-out/barrier-2-reached.png', s.x, s.y - 14); break; }
  }
  const climbedCells = env.fy - 1 - minY;
  console.log('RESULT', JSON.stringify({ minY, climbedCells, maxX, crossed, reached, everClimbed, pillarTop: env.pillarTop }));
  const problems = [];
  if (!everClimbed) problems.push('weaver never entered the climb state on the barrier');
  if (!(climbedCells > 30)) problems.push(`weaver did not scale the barrier (rose only ${climbedCells} cells)`);
  if (!crossed) problems.push(`weaver never crossed to the quarry's side (maxX ${maxX}, pillarR ${env.pillarR})`);
  if (problems.length) {
    console.error('FAIL:\n - ' + problems.join('\n - '));
    process.exitCode = 1;
  } else {
    console.log(`PASS — weaver climbed the ${env.fy - env.pillarTop}-cell barrier and crossed to the quarry's side${reached ? ' and reached it' : ''}.`);
  }
} finally {
  await browser.close();
}
