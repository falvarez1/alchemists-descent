import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
try {
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });
await page.evaluate(() => { const r = document.getElementById('game-hud'); if (r) r.style.opacity = '0'; });

// Carve a tall stone mesa: floor on the left for the weaver, a 70-cell sheer
// wall it must scale, the player perched on top. Only way up is to climb.
const base = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  const fy = 742, wallX = 720, top = fy - 70; // mesa top 70 cells up
  for (let x = 560; x <= 860; x++) for (let y = top - 40; y <= fy + 8; y++) {
    if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
    if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f);                     // ground
    else if (x >= wallX && y >= top) w.replaceCellAt(i, 12, 0x6f6f6f); // the mesa block
    else w.clearCellAt(i);                                            // open air (left + above)
  }
  // tag the subject weaver so every later select grabs THE SAME one (not whichever
  // arena weaver happens to be nearest x=512 after we move this one).
  const e = ctx.enemies.filter((g) => g.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
  e.__probeId = 1;
  for (const o of ctx.enemies) if (o.kind === 'weaver' && o !== e) { o.attackCd = 9999; o.alerted = false; }
  // clear prey so the subject chases the player instead of stopping to feed
  for (const c of ctx.critters.list.slice()) ctx.critters.killAt(ctx, c.x, c.y, 2);
  // float the body so the legs have their natural reach (placing it foot-on-floor
  // cramps the IK into a collapse that reads as permanently unstable).
  e.x = wallX - 70; e.y = fy - 26; e.vx = e.vy = 0; e.weaverClimbT = 0; e.weaverClimbDir = 0;
  e.alerted = false; e.cranky = 0; e.attackCd = 9999; e.patrol = undefined;
  ctx.player.x = wallX + 36; ctx.player.y = top - 2; // on the mesa top
  return { fy, wallX, top };
});

const grab = (file, cx, cy) => page.evaluate(({ cx, cy }) => new Promise((res) => {
  const ctx = window.__game.ctx; ctx.camera.zoomLock = 1; ctx.camera.snapTo(cx, cy);
  requestAnimationFrame(() => {
    const cam = ctx.camera, gl = document.querySelector('#canvas-holder > canvas');
    const sx = gl.width / 575, sy = gl.height / 391;
    const px = (cx - cam.renderX) * sx, py = (cy - cam.renderY) * sy;
    const hw = 70 * sx, hh = 56 * sy, Z = 4;
    const o = document.createElement('canvas'); o.width = Math.round(hw * 2 * Z); o.height = Math.round(hh * 2 * Z);
    const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(gl, px - hw, py - hh, hw * 2, hh * 2, 0, 0, o.width, o.height);
    res(o.toDataURL('image/png'));
  });
}), { cx, cy }).then((d) => writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')));

const sample = () => page.evaluate(() => {
  const ctx = window.__game.ctx;
  const e = ctx.enemies.find((g) => g.__probeId === 1);
  const pdx = Math.round(ctx.player.x - e.x), pdy = Math.round(ctx.player.y - 9 - (e.y - 5));
  const anc = e.weaverAnchorCount ?? 0, pSup = e.weaverPhysicalSupport ?? 0, fallT = e.weaverFallT ?? 0;
  const unstable = pSup < 0.34 || anc < 3 || fallT > 16;
  return { x: Math.round(e.x), y: Math.round(e.y), climbT: e.weaverClimbT ?? 0, climbDir: e.weaverClimbDir ?? 0, grounded: e.grounded === true, vy: +(e.vy ?? 0).toFixed(2), vx: +(e.vx ?? 0).toFixed(2), pdx, pdy, anc, pSup: +pSup.toFixed(2), fallT, unstable, wallR: e.__wallR ?? 0 };
});

const NEUTRALIZE_BALANCE = process.env.NB === '1';
const snapCam = () => page.evaluate((nb) => new Promise((res) => {
  const ctx = window.__game.ctx;
  const e = ctx.enemies.find((g) => g.__probeId === 1);
  if (nb) e.weaverSupportCenterX = e.x; // diagnostic: cancel the balance recentre
  ctx.camera.zoomLock = 1; ctx.camera.snapTo(e.x, e.y - 16); requestAnimationFrame(res);
}), NEUTRALIZE_BALANCE);

// settle on the fresh ground (unalerted) so the legs find their stance, THEN alert.
for (let f = 0; f < 70; f++) await snapCam();
await page.evaluate(() => { const e = window.__game.ctx.enemies.find((g) => g.__probeId === 1); e.alerted = true; e.cranky = 600; e.attackCd = 9999; });
const settled = await sample();
console.log('SETTLED', JSON.stringify(settled));

// keep the player from dying (and reloading the page) once the spider crests
await page.evaluate(() => { const p = window.__game.ctx.player; p.hp = p.maxHp = 99999; });

// run the chase+climb, camera glued to the weaver, tracking how high it gets.
// Stop as soon as it crests near the top — past that it lunges at the player and
// the resulting carnage can navigate the page out from under the probe.
let minY = 99999, maxClimbT = 0, everClimbed = false, mountedTop = false;
let probeError = null;
let last = null;
for (let f = 0; f < 300; f++) {
  try {
    await snapCam();
    const s = await sample();
    last = s;
    if (f % 30 === 0) console.log('f' + f, JSON.stringify(s));
    minY = Math.min(minY, s.y);
    maxClimbT = Math.max(maxClimbT, s.climbT);
    if (s.climbT > 0) everClimbed = true;
    if (s.y <= base.top + 8) mountedTop = true;
    if (f === 70) await grab('verify-out/climb-1-base.png', s.x, s.y);
    if (f === 140) await grab('verify-out/climb-2-mid.png', s.x, s.y);
    if (s.y <= base.top + 10) { await grab('verify-out/climb-3-top.png', s.x, s.y); break; }
  } catch (err) {
    probeError = err;
    console.log('stopped early at f' + f + ':', String(err).split('\n')[0]);
    break;
  }
}

const climbedCells = base.fy - 1 - minY;
const reachedTopLip = mountedTop || minY <= base.top + 10;
console.log('WALL', JSON.stringify(base), 'minY', minY, 'climbedCells', climbedCells, 'maxClimbT', maxClimbT, 'mountedTop', mountedTop, 'reachedTopLip', reachedTopLip, 'last', JSON.stringify(last));
const problems = [];
if (probeError && !reachedTopLip) problems.push(`probe stopped on browser/runtime error before mounting top: ${String(probeError).split('\n')[0]}`);
if (!everClimbed) problems.push('weaver never entered the climb state (weaverClimbT stayed 0)');
if (!(climbedCells > 30)) problems.push(`weaver did not scale the wall (only rose ${climbedCells} cells)`);
if (!reachedTopLip) problems.push(`weaver did not mount the top lip (minY ${minY}, target ${base.top + 10})`);
if (problems.length) {
  console.error('FAIL:\n - ' + problems.join('\n - '));
  process.exitCode = 1;
} else {
  console.log(`PASS — weaver scaled a ${base.fy - base.top}-cell wall (rose ${climbedCells} cells${reachedTopLip ? ', reached the top lip' : ''}).`);
}
} finally {
  await browser.close();
}
