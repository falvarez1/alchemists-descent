// Brann Rook (Iron Pilgrim, Bulwark) against the REAL engine: Pressure Vessel, Boiler Guard (Z), Redline (T).
// Real Z / T / D key presses, paused deterministic ticks, and each ability's OBSERVABLE effect: the hp that
// reaches the body, Steam cells in the grid, a foe's hp, the player's velocity, the HUD view, an eaten shot.
// Screenshots (verify-out/fighters/brann-*.png) are for LOOKING at.
// Usage: node scripts/verify-fighter-brann.mjs [url]   (default http://localhost:5193/)
import { aimAt, boot, hold, makeChecker, me, press, shot, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5193/';
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: 'brann-rook' });
const { ARENA } = await page.evaluate(() => ({ ARENA: window.__fp.ARENA }));
const FLOOR = ARENA.floorY;

// Listen: every sound cue the kit asks for, every spark burst, every cell count we ask about.
await page.evaluate(() => {
  const c = window.__fp.ctx;
  window.__sfx = [];
  const sfx = c.audio.sfx.bind(c.audio);
  c.audio.sfx = (id, ...rest) => { window.__sfx.push(id); return sfx(id, ...rest); };
  window.__sparks = [];
  if (c.sparks) {
    const burst = c.sparks.burst.bind(c.sparks);
    c.sparks.burst = (x, y, o) => { window.__sparks.push({ x, y, kind: o.kind, count: o.count }); return burst(x, y, o); };
  }
});

/** What would make the input layer ignore a key (an overlay that owns the keyboard, a focused field). Printed when a press is lost. */
const keyBlockers = () => page.evaluate(() => {
  const sel = ['#player-settings[open]', '#expedition-entry:not([hidden])', '.app-dialog-root', '.editor-command-menu.open', '.editor-popover.interactive', '#run-launcher.visible', '#minimap-overlay.visible', '#dev-console.open', '#runtime-inspector.open', '#card-offer-overlay.visible', '#pause-overlay.visible', '#help-overlay.visible', '#sanctum-overlay.visible', '#wand-bench.visible', '#run-summary.visible', '#gameover-overlay.visible', '#grimoire-overlay.open', '#story-cinema.show'];
  return { overlays: sel.filter((q) => document.querySelector(q)), focus: document.activeElement?.tagName, hasFocus: document.hasFocus() };
});

const sfxSince = (mark) => page.evaluate((m) => window.__sfx.slice(m), mark);
const sfxMark = () => page.evaluate(() => window.__sfx.length);
const sparksSince = (mark) => page.evaluate((m) => window.__sparks.slice(m), mark);
const sparksMark = () => page.evaluate(() => window.__sparks.length);

/** Back to a clean fighter: full hp, no foes or shots, floor intact, a freshly equipped kit (no plate, no Redline, no Pressure). */
async function clean() {
  await page.evaluate(async ({ floor, x0, x1 }) => {
    const f = window.__fp, c = f.ctx, p = c.player;
    c.enemies.length = 0;
    c.projectiles.length = 0;
    // A sealed box: the level beside it drips lava and sand and rolls crates into an open arena.
    c.rigidBodies.clear();
    // The test level's spell tomes lie in the arena: a walk onto one opens the card-offer modal, which owns the keyboard.
    const rt = c.levels.current;
    if (rt?.pickups) rt.pickups.length = 0;
    f.carve(x0, 600, x1, floor - 1);
    f.wall(x0, floor, x1, floor + 6);
    f.wall(x0 - 4, 590, x0, floor + 6);
    f.wall(x1, 590, x1 + 4, floor + 6);
    f.wall(x0 - 4, 590, x1 + 4, 599);
    c.fighters.equip('brann-rook');
    await c.fighters.whenReady();
    Object.assign(p, { hp: 100, invuln: 0, staggerT: 0, vx: 0, vy: 0, fx: 0, fy: 0, x: f.ARENA.spawnX, y: floor - 1, grounded: true, dead: false });
    for (const k of Object.keys(c.input.keys)) c.input.keys[k] = false;
    f.tick(2); // the system re-bases its hp reading on a tick
  }, { floor: FLOOR, x0: ARENA.x0, x1: ARENA.x1 });
}

/** One blow through the real damage path: returns the health that reached the body. */
const blow = (amount, kx = 0, ky = 0, src = 'probe') => page.evaluate(({ amount, kx, ky, src }) => {
  const c = window.__fp.ctx, p = c.player;
  p.invuln = 0;
  const hp = p.hp;
  c.playerCtl.damage(amount, kx, ky, src);
  return hp - p.hp;
}, { amount, kx, ky, src });

const steam = () => page.evaluate(() => window.__fp.count(window.__fp.Cell.Steam, 380, 560, 620, 700));
/** Frame the camera tighter or looser for a screenshot (it eases over ~30 ticks; the plate and steam are tick-driven, so settle first). */
const zoomTo = async (k) => { await page.evaluate((z) => { window.__fp.ctx.camera.zoomLock = z; }, k); await tick(page, 36); };
const aimRight = () => aimAt(page, 520, FLOOR - 10);
const aimLeft = () => aimAt(page, 360, FLOOR - 10);

// The test arena's teach card and pickup toasts never fade while the world is paused: hide them for the screenshots.
await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '#wave-banner, .wave-banner { display: none !important; }'; document.head.appendChild(st); });
// A zoomed camera for the screenshots (the world is paused, so this only frames it).
await page.evaluate(() => { window.__fp.ctx.camera.zoomLock = 3.2; });
await tick(page, 60);
await page.waitForTimeout(3000); // the floor's title card fades in real time

// =================================================================================================
console.log('\nPressure Vessel (passive)');
// =================================================================================================
let v = await view(page);
check('the HUD meter reads Pressure 0..100', v.meter?.label === 'Pressure' && v.meter.max === 100 && v.meter.value === 0, JSON.stringify(v.meter));

let lost = await blow(12);
await tick(page, 1);
v = await view(page);
check('a 12-point blow is 12 health lost and fills 30 Pressure (2.5 per point)', Math.abs(lost - 12) < 0.01 && v.meter.value > 29.5 && v.meter.value <= 30, `lost ${lost} meter ${v.meter.value}`);
const before = v.meter.value;
lost = await blow(4);
await tick(page, 1);
v = await view(page);
check('a 4-point blow is under the threshold and fills nothing', v.meter.value < before, `${before} -> ${v.meter.value}`);
await tick(page, 120);
v = await view(page);
check('it bleeds about 2 a second (two seconds took ~4 off)', before - v.meter.value > 3.2 && before - v.meter.value < 5, `${before} -> ${v.meter.value}`);

// Fill it: two heavy blows from ~26 reach 100. (A heal and a blow in one tick net out for the system, so re-base on a tick.)
await page.evaluate(() => { window.__fp.ctx.player.hp = 100; });
await tick(page, 1);
check('no Steam yet and no held footing', (await steam()) === 0 && !(await page.evaluate(() => window.__fp.ctx.fighters.staggerResist)));
await blow(16); await tick(page, 1);
v = await view(page);
check('a 16-point blow adds 40 (the per-blow cap) and does not vent yet', v.meter.value > 60 && v.meter.value < 100, String(v.meter.value));
const sMark = await sfxMark();
const sparkMark = await sparksMark();
await blow(16); await tick(page, 1);
v = await view(page);
const puffCells = await steam();
console.log('  measured: vent puff ' + puffCells + ' Steam cells');
check('at 100 it vents: a real puff of Steam cells is in the grid', puffCells > 40, `${puffCells} cells`);
const lifeOk = await page.evaluate(() => {
  const { ctx, Cell } = window.__fp, w = ctx.world;
  let withLife = 0, total = 0;
  for (let y = 560; y <= 700; y++) for (let x = 380; x <= 620; x++) { const i = w.idx(x, y); if (w.types[i] === Cell.Steam) { total++; if (w.life[i] > 0) withLife++; } }
  return { withLife, total };
});
check('...every Steam cell carries a life (they do not vanish at once)', lifeOk.total > 0 && lifeOk.withLife === lifeOk.total, JSON.stringify(lifeOk));
check('...the vessel resets to 0', v.meter.value === 0, String(v.meter.value));
check('...she holds her footing (stagger resistance up)', await page.evaluate(() => window.__fp.ctx.fighters.staggerResist));
const sounds = await sfxSince(sMark);
check('...with a hiss and a cue, and sparks', sounds.includes('mat.steam') && (await sparksSince(sparkMark)).length > 0, JSON.stringify(sounds));
await shot(page, 'brann-1-vent');

const knock = await page.evaluate(() => {
  const c = window.__fp.ctx, p = c.player;
  p.vx = 0; p.invuln = 0; p.staggerT = 0;
  c.playerCtl.applyImpulse(7, -3);
  const afterImpulse = p.vx;
  p.invuln = 0; p.hp = 100;
  c.playerCtl.damage(10, 6, -3, 'probe');
  return { afterImpulse, vx: p.vx, staggerT: p.staggerT };
});
check('...a big knock does not move her and does not stagger her', Math.abs(knock.afterImpulse) < 0.01 && Math.abs(knock.vx) < 0.01 && knock.staggerT === 0, JSON.stringify(knock));
await page.evaluate(() => { window.__fp.ctx.player.hp = 100; });
await tick(page, 1);
await blow(16); await tick(page, 1);
v = await view(page);
check('...and during it the vessel does not fill again (no chained vents)', v.meter.value === 0, String(v.meter.value));
await tick(page, 245);
check('the held footing ends after 4 s', !(await page.evaluate(() => window.__fp.ctx.fighters.staggerResist)));
const knock2 = await page.evaluate(() => {
  const c = window.__fp.ctx, p = c.player;
  p.vx = 0; p.invuln = 0;
  c.playerCtl.applyImpulse(7, -3);
  return p.vx;
});
check('...and a knock moves her again', knock2 > 6, String(knock2));

// Saved with the run.
await clean();
await blow(16); await tick(page, 1);
const snap = await page.evaluate(() => window.__fp.ctx.fighters.snapshot());
check('Pressure is in the run save (kit.pressure ~ 40)', snap.kit.pressure > 39 && snap.kit.pressure <= 40, JSON.stringify(snap.kit));
await clean();
await page.evaluate((s) => window.__fp.ctx.fighters.restore(s), snap);
v = await view(page);
check('...and a restore puts it back', v.meter.value > 39, String(v.meter.value));

// =================================================================================================
console.log('\nBoiler Guard (Z)');
// =================================================================================================
await clean();
await aimRight();
await tick(page, 2);
const moveFree = async () => {
  await page.evaluate((x) => { Object.assign(window.__fp.ctx.player, { x, vx: 0, vy: 0, facing: 1 }); }, ARENA.spawnX);
  await tick(page, 2);
  const a = (await me(page)).x;
  await hold(page, 'KeyD', 45);
  const b = (await me(page)).x;
  return b - a;
};
const freeRun = await moveFree();

await clean();
await aimRight();
await tick(page, 2);
await press(page, 'KeyZ', 1);
await tick(page, 10);
v = await view(page);
const rootedState = await page.evaluate(() => { const p = window.__fp.ctx.player; return { recharge: p.recharge, pullT: p.pullT, shell: p.chill?.shell, mode: window.__fp.ctx.state.mode, paused: window.__fp.ctx.state.paused, frame: window.__fp.ctx.state.frameCount, dead: p.dead, status: p.status }; });
check('Z raises the plate: the chip is active and cooling (10 s)', v.tactical.active > 0.9 && v.tactical.ready === false && v.tactical.cooldownSeconds >= 9, JSON.stringify({ t: v.tactical, rootedState, blockers: await keyBlockers() }));
const dr = await page.evaluate(() => window.__fp.ctx.fighters.drawables.length);
check('the plate is a drawable', dr === 1, String(dr));
check('she walks at x0.75 while it is up', await page.evaluate(() => window.__fp.ctx.fighters.moveScale()) === 0.75);
await page.evaluate((x) => { Object.assign(window.__fp.ctx.player, { x, vx: 0, vy: 0 }); }, ARENA.spawnX);
await tick(page, 2);
const a0 = (await me(page)).x;
await hold(page, 'KeyD', 45);
const guardedRun = (await me(page)).x - a0;
console.log('  measured: free run ' + freeRun + ' cells, guarded ' + guardedRun + ' cells in 45 ticks (ratio ' + (guardedRun / freeRun).toFixed(2) + ')');
check('...and a held D carries her ~75% as far', guardedRun / freeRun > 0.65 && guardedRun / freeRun < 0.86, `free ${freeRun} guarded ${guardedRun} ratio ${(guardedRun / freeRun).toFixed(2)}`);
await page.evaluate((x) => { Object.assign(window.__fp.ctx.player, { x, vx: 0, vy: 0 }); }, ARENA.spawnX);
await aimRight();
await tick(page, 2);
await zoomTo(5);
await shot(page, 'brann-2-plate-up');
await zoomTo(3.2);

// -- the frontal reduction through the real damage path
console.log('  (blows through Player.damage)');
await page.evaluate(() => { window.__fp.spawn('slime', 10); });
lost = await blow(20, -3.6, -2.8, 'slime-bite');
check('a foe in front, the engine\'s own inverted slime knock: 20 -> 10', Math.abs(lost - 10) < 0.01, String(lost));
await page.evaluate(() => { window.__fp.ctx.enemies.length = 0; window.__fp.spawn('slime', -10); });
lost = await blow(20, 3.6, -2.8, 'slime-bite');
check('the same blow from a foe BEHIND her: full 20', Math.abs(lost - 20) < 0.01, String(lost));
await page.evaluate(() => { window.__fp.ctx.enemies.length = 0; });
lost = await blow(20, -2.4, -1.8, 'explosion');
check('a blast from the front (pushes her left): 20 -> 10', Math.abs(lost - 10) < 0.01, String(lost));
lost = await blow(20, 2.4, -1.8, 'explosion');
check('a blast from behind: full 20', Math.abs(lost - 20) < 0.01, String(lost));
lost = await blow(20, 0, 0, 'burning');
check('a hazard tick has no front: full 20', Math.abs(lost - 20) < 0.01, String(lost));
await page.evaluate(() => { const e = window.__fp.spawn('slime', 2); e.y -= 28; });
lost = await blow(20, 1, -1, 'bat-bite');
check('a foe above her, outside the +-65 degree arc: full 20', Math.abs(lost - 20) < 0.01, String(lost));
await page.evaluate(() => { window.__fp.ctx.enemies.length = 0; });

// -- a real foe's real bite, plate up vs down vs turned away
console.log('  (a real slime biting)');
async function firstBite(setup) {
  // The real AI decides when to bite (it has to notice her first): give it up to three fresh slimes.
  for (let attempt = 0; attempt < 3; attempt++) {
    await clean();
    await aimAt(page, setup.aimX, FLOOR - 10);
    await tick(page, 2);
    if (setup.plate) await press(page, 'KeyZ', 1);
    await page.evaluate(() => {
      const e = window.__fp.spawn('slime', 8, { hp: 400 });
      e.alerted = true; e.attackCd = 0;
    });
    for (let i = 0; i < 240; i++) {
      const hp0 = (await me(page)).hp;
      await tick(page, 1);
      const hp1 = (await me(page)).hp;
      if (hp0 - hp1 > 0.5) return hp0 - hp1;
    }
    const diag = await page.evaluate(() => { const e = window.__fp.ctx.enemies[0], p = window.__fp.ctx.player; return e ? { x: e.x, y: e.y, px: p.x, hp: e.hp, alerted: e.alerted, sleeping: e.sleeping, intent: e.mind?.intent, visible: e.mind?.visible, cd: e.attackCd } : null; });
    console.log('  (no bite in 240 ticks, attempt ' + (attempt + 1) + ': ' + JSON.stringify(diag) + ')');
  }
  return null;
}
const noop = { aimX: 520, plate: false };
const biteBare = await firstBite(noop);
const biteGuard = await firstBite({ ...noop, plate: true });
const biteAway = await firstBite({ aimX: 360, plate: true });
console.log('  measured: slime bite bare ' + biteBare?.toFixed(2) + ', plate toward ' + biteGuard?.toFixed(2) + ', plate away ' + biteAway?.toFixed(2));
check('a slime bites a bare Brann for its full damage', biteBare !== null && biteBare >= 5, String(biteBare));
check('the same bite with the plate raised toward it is halved', biteGuard !== null && biteBare !== null && Math.abs(biteGuard - biteBare / 2) < 0.8, `bare ${biteBare} guarded ${biteGuard}`);
check('the plate turned away from it does nothing', biteAway !== null && biteBare !== null && Math.abs(biteAway - biteBare) < 0.8, `bare ${biteBare} away ${biteAway}`);

// -- shots
console.log('  (hostile shots)');
await clean();
await aimRight();
await tick(page, 2);
await press(page, 'KeyZ', 1);
await tick(page, 10);
const shotCase = async (opts) => page.evaluate(async (o) => {
  const f = window.__fp, c = f.ctx, p = c.player;
  p.invuln = 0; p.hp = 100;
  c.projectiles.length = 0;
  const chestY = p.y - 9;
  f.carve(p.x - 90, chestY - 10, p.x + 160, chestY + 8); // nothing the sim has dripped into the lane
  c.projectiles.push({ x: p.x + o.dx, y: chestY + (o.dy ?? 0), vx: o.vx, vy: o.vy ?? 0, type: 'fireball', life: 300, age: o.age ?? 0, charging: false, hostile: true });
  const q = c.projectiles[0];
  let lastX = q.x, lastY = q.y, gone = -1;
  const startCells = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const t = c.world.types[c.world.idx(Math.floor(q.x) + dx - 3, Math.floor(q.y) + dy)]; if (t) startCells.push([dx - 3, dy, t]); }
  for (let i = 0; i < (o.ticks ?? 40); i++) {
    f.tick(1);
    if (!c.projectiles.includes(q)) { gone = i; break; }
    lastX = q.x; lastY = q.y;
  }
  const census = {};
  for (let y = chestY - 14; y <= chestY + 8; y++) for (let x = p.x - 40; x <= p.x + 100; x++) { const t = c.world.types[c.world.idx(x, y)]; if (t) census[t] = (census[t] || 0) + 1; }
  return { gone, lastX: lastX - p.x, lastY: lastY - chestY, hpLost: 100 - p.hp, left: c.projectiles.filter((s) => s.hostile).length, census, status: p.status.electrified, startCells: startCells.slice(0, 12), bodies: c.rigidBodies.bodies.length, pos: [p.x, p.y] };
}, opts);
const sm = await sfxMark();
const spm = await sparksMark();
// (A fireball falls: 0.02/tick^2. Aimed 3 cells high from 60 out it arrives level, as a mage's lead would.)
let r = await shotCase({ dx: 60, dy: -3, vx: -2.5 });
check('a fireball flying at her face is eaten at the plate (>= 12 cells out), and she takes nothing', r.gone >= 0 && r.left === 0 && r.hpLost < 0.01 && r.lastX >= 11 && r.lastX <= 17.5, JSON.stringify(r));
const clangSounds = await sfxSince(sm), clangSparks = await sparksSince(spm);
check('...with a clang and a fan of sparks', clangSounds.includes('body.impact.metal') && clangSparks.length > 0, JSON.stringify({ clangSounds, clangSparks, r }));
await page.evaluate((x) => { Object.assign(window.__fp.ctx.player, { x, vx: 0 }); }, ARENA.spawnX);
r = await shotCase({ dx: 120, dy: -1, vx: -45, age: 12 });
check('a 45-cells-per-tick shot is eaten too, with no damage', r.gone >= 0 && r.left === 0 && r.hpLost < 0.01, JSON.stringify(r));
// The system's own question, asked directly of a shot that has ALREADY STRIDDEN PAST the plate this tick:
// the point test would miss it (it ended 25 cells behind her); the path test does not.
const stride = await page.evaluate(() => {
  const c = window.__fp.ctx, p = c.player;
  const chestY = p.y - 9;
  const shotAt = (x, vx, age = 12) => ({ x, y: chestY, vx, vy: 0, type: 'fireball', life: 100, age, charging: false, hostile: true });
  return {
    strided: c.fighters.interceptProjectile(shotAt(p.x - 25, -60)),
    pointOnly: c.fighters.interceptProjectile(shotAt(p.x - 25, 0)),
    behind: c.fighters.interceptProjectile(shotAt(p.x - 8, 3)),
    overhead: c.fighters.interceptProjectile({ ...shotAt(p.x + 1, 0), y: chestY - 11, vy: 4 }),
  };
});
check('a shot that strode 60 cells across her in one tick is caught by its PATH (a point test would miss it)', stride.strided === true && stride.pointOnly === false, JSON.stringify(stride));
check('...but not one from behind, or one dropping onto her head (outside the arc)', stride.behind === false && stride.overhead === false, JSON.stringify(stride));
await shot(page, 'brann-3-clang');
// And one the plate does NOT cover really hits her: from behind.
await page.evaluate((x) => { Object.assign(window.__fp.ctx.player, { x, vx: 0 }); }, ARENA.spawnX);
await clean();
await aimRight();
await tick(page, 2);
await press(page, 'KeyZ', 1);
await tick(page, 10);
r = await shotCase({ dx: -60, dy: -3, vx: 2.5, ticks: 60 });
check('a fireball from BEHIND her is not eaten by the plate (it ends on her side of the plate, and she is hurt)', r.gone >= 0 && r.lastX < 0 && r.hpLost > 0, JSON.stringify(r));
await page.evaluate(({ f, x0, x1 }) => { window.__fp.wall(x0, f, x1, f + 6); }, { f: FLOOR, x0: ARENA.x0, x1: ARENA.x1 });

// -- Z again, the cooldown, the clock
console.log('  (toggle, cooldown, expiry)');
await clean();
await aimRight();
await tick(page, 2);
await press(page, 'KeyZ', 1);
await tick(page, 30);
v = await view(page);
const cdBefore = v.tactical.cooldown, refusedBefore = v.tactical.refusedAt;
check('the plate is up at tick 30', v.tactical.active > 0.8 && (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 1);
await press(page, 'KeyZ', 2);
v = await view(page);
check('Z again lowers it at once (drawable gone, speed back, chip not active)', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0 && (await page.evaluate(() => window.__fp.ctx.fighters.moveScale())) === 1 && v.tactical.active === 0, JSON.stringify(v.tactical));
check('...the cooldown was NOT refunded (still cooling, no shorter than it was)', v.tactical.ready === false && v.tactical.cooldown <= cdBefore && v.tactical.cooldown > cdBefore - 0.02, `${cdBefore} -> ${v.tactical.cooldown}`);
check('...and it was consumed, not refused', v.tactical.refusedAt === refusedBefore, `${refusedBefore} -> ${v.tactical.refusedAt}`);
await press(page, 'KeyZ', 2);
v = await view(page);
check('Z while it is merely cooling is refused (no plate, the chip flashes)', v.tactical.refusedAt > refusedBefore && (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0, JSON.stringify(v.tactical));
await tick(page, 600);
check('after the 10 s cooldown it is ready again', (await view(page)).tactical.ready === true);
await press(page, 'KeyZ', 1);
await tick(page, 200);
check('left alone it is still up at 200 ticks', (await view(page)).tactical.active > 0 && (await page.evaluate(() => window.__fp.ctx.fighters.moveScale())) === 0.75);
await tick(page, 14);
v = await view(page);
check('...and drops by itself at 210 (speed back, drawable gone)', v.tactical.active === 0 && (await page.evaluate(() => window.__fp.ctx.fighters.moveScale())) === 1 && (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0, JSON.stringify(v.tactical));

// -- the plate and the vessel together: heat on the brass
await clean();
await aimRight();
await tick(page, 2);
await blow(16); await tick(page, 1);
await blow(8); await tick(page, 1);
await press(page, 'KeyZ', 1);
await tick(page, 14);
await zoomTo(5);
await shot(page, 'brann-4-plate-hot');
await zoomTo(3.2);

// =================================================================================================
console.log('\nRedline (T)');
// =================================================================================================
await clean();
await aimRight();
await tick(page, 2);
let rm = (await view(page)).ultimate.refusedAt;
await press(page, 'KeyT', 2);
v = await view(page);
check('T with the bar empty is refused and nothing starts', v.ultimate.refusedAt > rm && v.ultimate.active === 0, JSON.stringify(v.ultimate));

await page.evaluate(() => { window.__fp.ctx.fighters.refill(); });
// Foes: one near enough to scald, one out of reach. Fireproof-free slimes with plenty of hp.
await page.evaluate(() => { const f = window.__fp; f.spawn('slime', 11, { hp: 900 }); f.spawn('slime', 60, { hp: 900 }); });
const lightsBefore = await page.evaluate(() => (window.__fp.ctx.levels.current.authoredLights ?? []).length);
const steamBefore = await steam();
const ultMark = await sfxMark();
await press(page, 'KeyT', 1);
v = await view(page);
check('T with the bar full starts Redline (active, bar spent)', v.ultimate.active > 0.9 && v.ultimate.charge < 0.05, JSON.stringify(v.ultimate));
const steamNow = await steam();
console.log('  measured: Redline ignition ' + (steamNow - steamBefore) + ' Steam cells');
check('it vents real Steam cells around her', steamNow - steamBefore > 40, `${steamBefore} -> ${steamNow}`);
check('her light flares (a red light was added to the level)', (await page.evaluate(() => (window.__fp.ctx.levels.current.authoredLights ?? []).length)) === lightsBefore + 1);
check('...with the cues', (await sfxSince(ultMark)).includes('mat.steam'));
await tick(page, 20);
await shot(page, 'brann-5-redline');

// damage x0.5
lost = await blow(20, 0, 0, 'probe');
check('damage taken is halved (20 -> 10)', Math.abs(lost - 10) < 0.01, String(lost));
// no knockback at all
const redKnock = await page.evaluate(() => {
  const c = window.__fp.ctx, p = c.player;
  p.vx = 0; p.vy = 0; p.invuln = 0; p.staggerT = 0; p.hp = 100;
  c.playerCtl.applyImpulse(9, -5);
  const afterImpulse = { vx: p.vx, vy: p.vy };
  c.playerCtl.damage(18, 8, -4, 'probe');
  return { afterImpulse, vx: p.vx, vy: p.vy, staggerT: p.staggerT };
});
check('a huge knock moves her not at all, and does not stagger her', Math.abs(redKnock.afterImpulse.vx) < 0.01 && Math.abs(redKnock.afterImpulse.vy) < 0.01 && Math.abs(redKnock.vx) < 0.01 && Math.abs(redKnock.vy) < 0.01 && redKnock.staggerT === 0, JSON.stringify(redKnock));
// an explosion shoves her too: through the real explosion path
const blast = await page.evaluate(() => {
  const c = window.__fp.ctx, p = c.player;
  p.vx = 0; p.vy = 0; p.invuln = 0; p.staggerT = 0; p.hp = 100;
  c.explosions.trigger(p.x - 12, p.y - 6, 9, { playerDamageSource: 'probe-blast' });
  return { vx: p.vx, vy: p.vy, hpLost: 100 - p.hp };
});
check('a real explosion beside her damages her (halved) and shoves her not', Math.abs(blast.vx) < 0.01 && blast.hpLost > 0, JSON.stringify(blast));
await clean();

// the scald, sampled tick by tick: a 3-point drop every 15 ticks on the near foe, none on the far one
await page.evaluate(() => { const f = window.__fp; f.ctx.fighters.refill(); f.spawn('slime', 11, { hp: 900 }); f.spawn('slime', 150, { hp: 900 }); });
await press(page, 'KeyT', 1);
const scaldLog = [];
for (let i = 0; i < 62; i++) {
  // Hold the near foe where it stands (a scalded slime hops about the arena): this measures the cadence, not the AI.
  const hp = await page.evaluate(() => { const c = window.__fp.ctx, p = c.player, e = c.enemies[0]; Object.assign(e, { x: p.x + 11, y: window.__fp.ARENA.floorY - 1, vx: 0, vy: 0, knockT: 0 }); return c.enemies.map((q) => q.hp); });
  await tick(page, 1);
  const hp2 = await page.evaluate(() => window.__fp.ctx.enemies.map((e) => e.hp));
  scaldLog.push([hp[0] - hp2[0], hp[1] - hp2[1]]);
}
const bigNear = scaldLog.map((d, i) => [i, d[0]]).filter(([, d]) => d >= 2.4).map(([i]) => i);
const farTotal = scaldLog.reduce((s, d) => s + d[1], 0);
console.log('  measured: scald ticks ' + bigNear.join(',') + '; far foe lost ' + farTotal.toFixed(2));
check('the near foe takes a 3-point scald every 15 ticks', bigNear.length >= 4 && bigNear.slice(1).every((t, i) => Math.abs(t - bigNear[i] - 15) <= 1), `at ticks ${bigNear.join(',')}`);
check('...a foe beyond 16 cells is not scalded', farTotal < 0.5, `far lost ${farTotal.toFixed(2)}`);
await shot(page, 'brann-6-scald');
await tick(page, 6);

// it ends on its own clock
await tick(page, 480);
v = await view(page);
const after = await page.evaluate(() => ({ stag: window.__fp.ctx.fighters.staggerResist, lights: (window.__fp.ctx.levels.current.authoredLights ?? []).length }));
check('Redline ends after 480 ticks: the chip is idle, no held footing, her light is gone', v.ultimate.active === 0 && after.stag === false && after.lights === lightsBefore, JSON.stringify({ u: v.ultimate.active, ...after, lightsBefore }));
lost = await blow(20, 0, 0, 'probe');
check('...and she takes full damage again', Math.abs(lost - 20) < 0.01, String(lost));
await shot(page, 'brann-7-after');

const blockers = await keyBlockers();
check('no overlay took the keyboard during the run (no tome modal)', blockers.overlays.length === 0, JSON.stringify(blockers));
const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nbrann-rook probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);
