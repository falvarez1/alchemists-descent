// The kick's wind gust blows enemies back (mass-scaled): a slime is NUDGED away,
// a bat is HURLED hard enough to smash into a wall — gibbing and painting blood
// onto the stone. Usage: node scripts/verify-kick-enemies.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + ' ' + d); } };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.player, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 20; f++) window.__game.tick();
  const w = ctx.world;
  const p = ctx.player;
  const STONE = 12;

  const clearArena = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.clearCellAt(w.idx(x, y));
  };
  const wall = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = w.idx(x, y); w.types[i] = STONE; w.colors[i] = 0x777777; }
  };
  const kick = () => { ctx.playerCtl.kickCooldownT = 0; p.aimAngle = 0; ctx.playerCtl.kick(ctx); };
  const spawnAt = (kind, x, y) => {
    ctx.enemyCtl.spawn(kind, x, y);
    const e = ctx.enemies[ctx.enemies.length - 1];
    e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.fx = 0; e.fy = 0; e.sleeping = false; e.knockT = 0;
    return e;
  };

  const reset = () => {
    ctx.state.mode = 'play'; ctx.state.paused = false; ctx.fx.hitstop = 0;
    ctx.enemies.length = 0;
    p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false;
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  };

  // ---- BAT: hurled into a wall → gibbed + wall painted -----------------------
  reset();
  clearArena(300, 630, 380, 680);
  wall(360, 628, 366, 682);          // a thick stone wall to the RIGHT
  p.x = 320; p.y = 670; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; p.grounded = true;
  const bat = spawnAt('bat', 336, 658);
  const batBefore = { x: bat.x, hp: bat.hp };
  const ovBefore = w.colorOverrides.size;
  // sanity: the wall is real stone and the physics oracle sees it as solid
  const wallSolid = w.types[w.idx(363, 656)] === STONE && !ctx.physics.entityFree(357, 658, 3, 5);
  kick();
  const batLaunched = (bat.knockT ?? 0) > 0 || Math.abs(bat.knockVx ?? 0) > 2;
  let batMaxX = bat.x;
  let batAlive = true;
  for (let f = 0; f < 24; f++) {
    window.__game.tick();
    if (ctx.enemies.includes(bat)) batMaxX = Math.max(batMaxX, bat.x);
    else { batAlive = false; break; }
  }
  // count blood-tinted wall cells (red-dominant override) in the wall column
  let bloodied = 0;
  for (let y = 628; y <= 682; y++) for (let x = 356; x <= 366; x++) {
    const i = w.idx(x, y);
    if (w.types[i] !== STONE) continue;
    const c = w.colors[i], rr = (c >> 16) & 255, gg = (c >> 8) & 255, bb = c & 255;
    if (rr > gg + 25 && rr > bb + 25) bloodied++;
  }
  const ovAfter = w.colorOverrides.size;

  // ---- SLIME: nudged away from the wizard, but survives -----------------------
  reset();
  clearArena(300, 630, 420, 690);
  wall(300, 686, 420, 690);          // a floor to stand on
  p.x = 330; p.y = 685; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; p.grounded = true;
  const slime = spawnAt('slime', 345, 685);
  const slimeBefore = { x: slime.x, hp: slime.hp };
  kick();
  const slimeLaunched = (slime.knockT ?? 0) > 0;
  for (let f = 0; f < 30; f++) window.__game.tick();
  const slimeAlive = ctx.enemies.includes(slime);
  const slimeMovedAway = slime.x - slimeBefore.x;

  return {
    wallSolid,
    batBefore, batLaunched, batMaxX, batAlive, batHp: bat.hp,
    bloodied, ovBefore, ovAfter,
    slimeBefore, slimeLaunched, slimeAlive, slimeMovedAway, slimeHp: slime.hp,
  };
});

console.log('  ' + JSON.stringify(r));
check('test wall is solid stone (probe sanity)', r.wallSolid, JSON.stringify(r));
check('bat is launched by the gust (ballistic knock state)', r.batLaunched, JSON.stringify(r));
check('bat travels toward the wall (+x) before impact', r.batMaxX > r.batBefore.x + 6, JSON.stringify(r));
check('bat is gibbed on the wall slam (removed)', !r.batAlive, JSON.stringify(r));
check('the slam paints blood onto the wall (stained stone cells)', r.bloodied > 3 && r.ovAfter > r.ovBefore, JSON.stringify(r));
check('slime is nudged/launched away from the wizard (+x)', r.slimeMovedAway > 2, JSON.stringify(r));
check('slime SURVIVES the nudge (not gibbed)', r.slimeAlive && r.slimeHp > 0, JSON.stringify(r));
check('no page errors', r && errs.length === 0, errs.join(' | '));

console.log(`\nkick-enemies probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
