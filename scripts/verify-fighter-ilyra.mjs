// Ilyra Voss (docs/fighters/ilyra-voss.md) against the REAL engine: Volatile Mixture, Flash Crucible (Z) and
// Phoenix Draft (T). Real key presses for Z / T / F and a real mouse for the wand; paused, deterministic ticks;
// every assertion reads the grid, a foe's hp / status / position, the player, or the HUD view, not a flag.
//
//   node scripts/verify-fighter-ilyra.mjs [url]        (dev server running; default http://localhost:5173/)
//   SHOTS=0 to skip the screenshots (verify-out/fighters/ilyra-*.png, upscaled crops of each ability).
import { ARENA, boot, makeChecker, me, shot, view } from './fighter-probe.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS !== '0';
// Other windows (other engineers' probes) can steal focus mid-run: that clears the game's held keys and can un-pause it.
// So every tick re-asserts the pause, and a held key is re-sent each tick (a repeat keydown is harmless).
const tick = (pg, n = 1) => pg.evaluate((k) => { window.__fp.ctx.state.paused = true; window.__fp.tick(k); }, Math.max(1, n));
async function press(pg, code, ticks = 1) {
  await pg.keyboard.down(code);
  await tick(pg, ticks);
  await pg.keyboard.up(code);
}
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: 'ilyra-voss', hp: 100 });

// ----------------------------------------------------------------------------- page-side instruments
await page.addStyleTag({ content: '#wave-banner, .title-card { display: none !important; }' });
await page.evaluate(async () => {
  const { VIEW_W, VIEW_H } = await import('/src/config/constants.ts');
  const c = window.__fp.ctx;
  const il = (window.__il = { sfx: [], dmg: [], callouts: [], casts: [], VIEW_W, VIEW_H });
  const sfx = c.audio.sfx.bind(c.audio);
  c.audio.sfx = (id, x, y, o) => { il.sfx.push({ id, x, y, t: c.state.frameCount }); return sfx(id, x, y, o); };
  const dmg = c.enemyCtl.damage.bind(c.enemyCtl);
  c.enemyCtl.damage = (e, amount, kx, ky, source) => {
    il.dmg.push({ kind: e.kind, amount: +amount.toFixed(3), source: source ?? 'direct', t: c.state.frameCount, melee: c.fighters.recentMelee });
    return dmg(e, amount, kx, ky, source);
  };
  c.events.on('combatCallout', (e) => il.callouts.push({ text: e.text, t: c.state.frameCount }));
  c.events.on('cardCast', (e) => il.casts.push({ id: e.id, t: c.state.frameCount }));
  document.addEventListener('keydown', () => {}); // (keeps the page focused for real key events)
});
const clearLogs = () => page.evaluate(() => { const il = window.__il; il.sfx.length = il.dmg.length = il.callouts.length = il.casts.length = 0; });
const logs = () => page.evaluate(() => ({ sfx: window.__il.sfx.slice(), dmg: window.__il.dmg.slice(), callouts: window.__il.callouts.slice(), casts: window.__il.casts.slice() }));
const now = () => page.evaluate(() => window.__fp.ctx.state.frameCount);

/** Back to a clean arena: no foes, no flames, the alchemist at her mark, a fresh Ilyra (cooldowns, charge, kit state). */
async function reset({ hp = 100, x = ARENA.spawnX } = {}) {
  await page.keyboard.up('KeyD').catch(() => {});
  await page.mouse.up().catch(() => {});
  await page.evaluate(({ ARENA, hp, x }) => {
    const { ctx, Cell } = window.__fp;
    const w = ctx.world, p = ctx.player;
    ctx.enemies.length = 0;
    for (let yy = ARENA.top - 5; yy < ARENA.floorY; yy++) for (let xx = ARENA.x0 - 60; xx <= ARENA.x1 + 60; xx++) {
      if (!w.inBounds(xx, yy)) continue;
      const t = w.types[w.idx(xx, yy)];
      if (t === Cell.Fire || t === Cell.Ember || t === Cell.Smoke || t === Cell.Steam || t === Cell.Blood || t === Cell.Slime || t === Cell.Ash) w.clearCellAt(w.idx(xx, yy));
    }
    ctx.projectiles.length = 0;
    Object.assign(p, { dead: false, hp, maxHp: hp, invuln: 0, x, y: ARENA.floorY - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, climbing: false, firing: false, firePressed: false, lastDamageSource: null });
    p.status.burning = p.status.oiled = p.status.wet = p.status.frozen = p.status.electrified = 0;
    p.staggerT = 0;
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
    for (const wd of ctx.wands.wands) { wd.cooldown = 0; wd.mana = wd.frame.manaMax; wd.castIndex = 0; }
    ctx.fighters.equip('ilyra-voss');
  }, { ARENA, hp, x });
  await page.evaluate(() => window.__fp.ctx.fighters.whenReady());
  await tick(page, 2);
  await clearLogs();
}

// ----------------------------------------------------------------------------- aiming with a REAL mouse
/** World -> client pixels (the inverse of InputManager.getMouseGridCoords) and the canvas scale. */
const toClient = (wx, wy) => page.evaluate(({ wx, wy }) => {
  const c = window.__fp.ctx, { VIEW_W, VIEW_H } = window.__il;
  const cv = document.querySelector('#canvas-holder > canvas'), r = cv.getBoundingClientRect();
  const zoom = c.camera.zoom, fx = c.camera.x - Math.floor(c.camera.x), fy = c.camera.y - Math.floor(c.camera.y);
  const sx = (1 + 4 / VIEW_W) * zoom, sy = (1 + 4 / VIEW_H) * zoom;
  const ox = -fx * (2 / VIEW_W) * zoom, oy = fy * (2 / VIEW_H) * zoom;
  const texU = (wx - c.camera.renderX) / VIEW_W, texV = (wy - c.camera.renderY) / VIEW_H;
  const ndcX = ox + (texU - 0.5) * 2 * sx, ndcY = oy + (1 - 2 * texV) * sy;
  return { x: r.left + ((ndcX + 1) / 2) * r.width, y: r.top + ((1 - ndcY) / 2) * r.height, pxPerCell: (r.width / VIEW_W) * sx };
}, { wx, wy });
/** Move the real pointer so the game's own mouse-to-world conversion lands on (wx, wy). */
async function aimMouse(wx, wy) {
  for (let i = 0; i < 3; i++) {
    const p = await toClient(wx, wy);
    await page.mouse.move(p.x, p.y);
    const got = await page.evaluate(() => ({ x: window.__fp.ctx.input.mouse.x, y: window.__fp.ctx.input.mouse.y }));
    if (Math.abs(got.x - wx) <= 1 && Math.abs(got.y - wy) <= 1) return got;
  }
  return page.evaluate(() => ({ x: window.__fp.ctx.input.mouse.x, y: window.__fp.ctx.input.mouse.y }));
}
/** Aim the real pointer at a spot relative to her (flat along the floor by default): the pointer, not the harness's aimAt, is what the game follows once it has moved. */
const aimFlat = async (dx = 250, dy = -9) => { const p = await me(page); return aimMouse(p.x + dx, p.y + dy); };

// ----------------------------------------------------------------------------- looking at it
mkdirSync('verify-out/fighters', { recursive: true });
/** An upscaled crop around a world point (the canvas is ~3 px a cell: a 1:1 screenshot cannot judge a 3-cell vial). */
async function look(name, wx, wy, hw = 70, hh = 42, mag = 4) {
  if (!SHOTS) return;
  const p = await toClient(wx, wy);
  const w = hw * 2 * p.pxPerCell, h = hh * 2 * p.pxPerCell;
  const buf = await page.screenshot({ clip: { x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h / 2), width: w, height: h } });
  const path = `verify-out/fighters/ilyra-${name}.png`;
  // Nearest-neighbour upscale so single cells stay crisp (sharp is already used by other probes; fall back to the 1:1 crop).
  try {
    const { default: sharp } = await import('sharp');
    await sharp(buf).resize({ width: Math.round(w * mag), kernel: 'nearest' }).toFile(path);
  } catch { writeFileSync(path, buf); }
}

// ----------------------------------------------------------------------------- the arena helpers
const E = (fn, arg) => page.evaluate(fn, arg);
const foes = () => E(() => window.__fp.ctx.enemies.map((e) => ({ kind: e.kind, x: e.x, y: e.y, hp: +e.hp.toFixed(2), burning: e.status.burning, vx: +e.vx.toFixed(2), kvx: +(e.knockVx ?? 0).toFixed(2), knockT: e.knockT ?? 0 })));
const spawnFoe = (kind, dx, hp = 400, extra = {}) => E(({ kind, dx, hp, extra }) => { const e = window.__fp.spawn(kind, dx, { hp, ...extra }); return { x: e.x, y: e.y }; }, { kind, dx, hp, extra });
const meter = async () => (await view(page)).meter;
const cells = (typeName, x0, y0, x1, y1) => E(({ typeName, x0, y0, x1, y1 }) => window.__fp.count(window.__fp.Cell[typeName], x0, y0, x1, y1), { typeName, x0, y0, x1, y1 });
const lights = () => E(() => window.__fp.ctx.levels.current?.authoredLights?.length ?? 0);
const FLOOR = ARENA.floorY;
// ONLY=crucible,mixture,phoenix runs just those sections (a quicker loop while tuning).
const want = (name) => !process.env.ONLY || process.env.ONLY.split(',').includes(name);

/** Snapshot the grid around (x, y), to prove afterwards that nothing solid was carved. */
const snap = (x, y, r) => E(({ x, y, r }) => {
  const w = window.__fp.ctx.world, out = [];
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) out.push(w.inBounds(xx, yy) ? w.types[w.idx(xx, yy)] : 255);
  return out;
}, { x, y, r });
// Terrain the burst must never remove: rock, metal, glass, crystal. (Wood and Ice may legitimately burn or melt in the flames it lights: that is the grid at work, not carving.)
const SOLIDS = new Set([3, 12, 13, 31, 29]); // Wall, Stone, Metal, Glass, Crystal

// ============================================================================= 0. the fighter is equipped
await tick(page, 90); // let the camera settle on the arena
let v = await view(page);
check('equipped: Ilyra Voss, her two abilities named, the tactical ready', v.id === 'ilyra-voss' && v.tactical.name === 'Flash Crucible' && v.ultimate.name === 'Phoenix Draft' && v.tactical.ready === true);
check('no mixture on the chip before she has hit anything', (await meter()) === null);

// ============================================================================= 1. FLASH CRUCIBLE (Z)
console.log('\n-- Flash Crucible (Z)');
if (want('crucible')) {
  // 1a. Where a flat throw lands (the vial arcs like the flask's bottle).
  await reset();
  await aimFlat();
  await tick(page, 2);
  const t0 = await now();
  await page.keyboard.down('KeyZ');
  await tick(page, 1);
  await page.keyboard.up('KeyZ');
  if ((await view(page)).tactical.ready) console.log('   (diagnostic: the first Z press did not register)', JSON.stringify(await E(() => { const c = window.__fp.ctx, p = c.player; return { active: document.activeElement?.tagName + '#' + document.activeElement?.id, hidden: document.hidden, hasFocus: document.hasFocus(), paused: c.state.paused, mode: c.state.mode, rooted: [p.recharge, p.pullT, p.chill?.shell], dead: p.dead, refused: c.fighters.view.tactical.refusedAt, frame: c.state.frameCount, blockers: [...document.querySelectorAll('#player-settings[open], #expedition-entry:not([hidden]), .app-dialog-root, #run-launcher.visible, #minimap-overlay.visible, #dev-console.open, #card-offer-overlay.visible, #pause-overlay.visible, #help-overlay.visible, #sanctum-overlay.visible, #wand-bench.visible, #run-summary.visible, #gameover-overlay.visible, #grimoire-overlay.open, #story-cinema.show')].map((n) => n.id || n.className) }; })));
  check('Z throws the vial: cooldown spent (9 s), chip not ready', (await view(page)).tactical.ready === false && (await view(page)).tactical.cooldownSeconds === 9);
  check('the throw sounds (flask.throw) and the vial is drawn while it flies', (await logs()).sfx.some((s) => s.id === 'flask.throw') && (await E(() => window.__fp.ctx.fighters.drawables.length)) >= 1);
  await tick(page, 3);
  await look('vial-flight', ...(await E(() => [window.__fp.ctx.player.x + 25, window.__fp.ctx.player.y - 10])), 50, 30, 5);
  let burst = null;
  for (let i = 0; i < 60 && !burst; i++) { await tick(page, 1); burst = (await logs()).sfx.find((s) => s.id === 'flask.shatter') ?? null; }
  check('the vial bursts at the first solid (the floor), not at the end of the fuse', burst !== null && burst.t - t0 < 40, JSON.stringify(burst));
  check('...in open air just above the floor', burst !== null && burst.y >= FLOOR - 4 && burst.y <= FLOOR, `y ${burst?.y}`);
  const landX = burst.x;

  // 1b. A real burst: three foes, one under the burst, one inside the radius, one outside.
  await reset();
  await aimFlat();
  const px = (await me(page)).x;
  const A = await spawnFoe('slime', landX - px, 100);
  const B = await spawnFoe('slime', landX - px + 24, 100);
  const C = await spawnFoe('slime', landX - px + 48, 100);
  const D = await spawnFoe('slime', landX - px - 70, 100); // behind the burst, far outside
  await tick(page, 2);
  const before = await snap(landX, FLOOR - 6, 36);
  const nLights = await lights();
  const hpBefore = (await me(page)).hp;
  const charge0 = (await view(page)).ultimate.charge;
  await clearLogs();
  await press(page, 'KeyZ', 1);
  const usedAt = (await view(page)).tactical.usedAt;
  let hit = null;
  const pinned = [A.x, B.x, C.x, D.x];
  for (let i = 0; i < 60 && !hit; i++) {
    // (the foes hold still while the vial is in the air, so where it bursts does not depend on a hop)
    await E(({ xs }) => window.__fp.ctx.enemies.forEach((e, k) => { e.x = xs[k]; e.y = window.__fp.ARENA.floorY - 1; e.vx = 0; e.vy = 0; }), { xs: pinned });
    await tick(page, 1);
    hit = (await logs()).sfx.find((s) => s.id === 'flask.shatter') ?? null;
  }
  check('the burst sounds (glass, a small boom, a flare)', hit !== null && (await logs()).sfx.some((s) => s.id === 'boom.small') && (await logs()).sfx.some((s) => s.id === 'spell.flame.ignite'));
  check('a warm flash light is placed in the level for the burst', (await lights()) === nLights + 1, `${nLights} -> ${await lights()}`);
  if (SHOTS) await shot(page, 'ilyra-1to1-burst');
  await look('burst-0', hit.x, hit.y - 6, 60, 36, 5);
  const dmg14 = (await logs()).dmg.filter((d) => d.amount === 14);
  check('every foe inside 30 cells took exactly 14 (the two nearest)', dmg14.length === 2 || dmg14.length === 3, JSON.stringify(dmg14.map((d) => d.kind)) + ' x' + dmg14.length);
  check('the foe 48 cells out is untouched by the blast itself', (await logs()).dmg.filter((d) => d.amount === 14).length < 4);
  await tick(page, 2);
  await look('burst-3', hit.x, hit.y - 6, 60, 36, 5);
  await tick(page, 3);
  await look('burst-6', hit.x, hit.y - 6, 60, 36, 5);
  const xs0 = [A.x, B.x, C.x, D.x];
  let peakB = 0, knockSeen = 0;
  for (let i = 0; i < 14; i++) {
    await tick(page, 1);
    const fb = (await foes())[1];
    if (fb) { peakB = Math.max(peakB, fb.x - xs0[1]); knockSeen = Math.max(knockSeen, fb.kvx); }
  }
  const f1 = await foes();
  check('foes were thrown OUTWARD (the one right of the burst was knocked right)', peakB >= 3, `B peak +${peakB} cells`);
  check('the foe far outside the radius took no blow from it', f1[3].hp === 100, JSON.stringify(f1[3]));
  const hpFoes = f1.map((f) => f.hp);
  check('foes inside lost at least 14 hp, the outsider none', hpFoes[0] <= 86 && hpFoes[1] <= 86 && hpFoes[3] === 100, JSON.stringify(hpFoes));
  check('she took NO damage from her own vial', (await me(page)).hp === hpBefore);
  check('damaging foes charges the ultimate bar', (await view(page)).ultimate.charge > charge0 + 0.03, `${charge0} -> ${(await view(page)).ultimate.charge}`);
  const aft = await snap(landX, FLOOR - 6, 36);
  let carved = 0, planted = 0;
  const changed = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== aft[i]) { if (SOLIDS.has(before[i])) { carved++; changed.push(before[i] + '->' + aft[i]); } if (aft[i] === 5 || aft[i] === 20) planted++; }
  }
  check('the burst carved NO terrain (no rock, metal or glass cell changed)', carved === 0, `${carved} solid cells changed: ${changed.slice(0, 6).join(",")}`);
  check('it scattered real Fire / Ember cells into the air', (await cells('Fire', landX - 30, FLOOR - 20, landX + 30, FLOOR)) + (await cells('Ember', landX - 30, FLOOR - 20, landX + 30, FLOOR)) >= 3, `${planted} planted`);
  await tick(page, 70);
  check('the flash light is gone again (nothing left behind in the level)', (await lights()) === nLights, `${await lights()} vs ${nLights}`);
  // The cooldown, as a player meets it.
  const throwsBefore = (await logs()).sfx.filter((s) => s.id === 'flask.throw').length;
  const refusedBefore = (await view(page)).tactical.refusedAt;
  await press(page, 'KeyZ', 2);
  check('Z while cooling down is refused (the chip flinches) and throws nothing', (await view(page)).tactical.refusedAt > refusedBefore && (await logs()).sfx.filter((s) => s.id === 'flask.throw').length === throwsBefore);
  await tick(page, 400);
  let coolReady = false;
  for (let i = 0; i < 200 && !coolReady; i++) { await tick(page, 1); coolReady = (await view(page)).tactical.ready; }
  const cooled = (await now()) - usedAt;
  check('the cooldown runs out after exactly 9 s (540 ticks)', coolReady && Math.abs(cooled - 540) <= 1, `ready after ${cooled} ticks`);

  // 1c. Her own shove: a wall close ahead.
  await reset();
  await E(() => { const { ARENA } = window.__fp; window.__fp.wall(ARENA.spawnX + 20, ARENA.top, ARENA.spawnX + 30, ARENA.floorY - 1); });
  await aimFlat();
  await tick(page, 2);
  const x0 = (await me(page)).x;
  const hp0 = (await me(page)).hp;
  await clearLogs();
  await press(page, 'KeyZ', 1);
  let wallBurst = null;
  for (let i = 0; i < 30 && !wallBurst; i++) { await tick(page, 1); wallBurst = (await logs()).sfx.find((s) => s.id === 'flask.shatter') ?? null; }
  await tick(page, 1); // (the burst lands late in the tick: the glide takes the body on the next one)
  const m1 = await me(page);
  check('a vial thrown at a wall close ahead bursts against it (first solid)', wallBurst !== null && wallBurst.x >= ARENA.spawnX + 8 && wallBurst.x <= ARENA.spawnX + 20, JSON.stringify(wallBurst));
  check('the burst SHOVES HER outward (back, away from the wall)', m1.vx < -1.2, `vx ${m1.vx}`);
  await look('burst-wall', ARENA.spawnX + 8, FLOOR - 12, 60, 36, 5);
  const owned = await E(() => window.__fp.ctx.fighters.ownsMovement);
  let flameOnBody = 0, peakUp = 0;
  for (let i = 0; i < 14; i++) {
    await tick(page, 1);
    flameOnBody += await E(() => { const { ctx, Cell } = window.__fp, w = ctx.world, p = ctx.player; let n = 0; for (let yy = p.y - 17; yy <= p.y; yy++) for (let xx = p.x - 4; xx <= p.x + 4; xx++) { const t = w.types[w.idx(xx, yy)]; if (t === Cell.Fire || t === Cell.Ember) n++; } return n; });
    peakUp = Math.max(peakUp, FLOOR - 1 - (await me(page)).y);
  }
  check('...she is CARRIED clear (a body-owning glide: ~10 cells back, arcing up and over)', owned === true && (await me(page)).x < x0 - 8 && peakUp >= 2, `${x0} -> ${(await me(page)).x}, peak ${peakUp} up, owned ${owned}`);
  check('and it did not hurt her', (await me(page)).hp === hp0);
  check('no flame was scattered onto her own body (no Fire / Ember cell ever touched it)', flameOnBody === 0, `${flameOnBody} cell-ticks of flame on her`);
  await E(() => { const { ARENA } = window.__fp; for (let y = ARENA.top; y < ARENA.floorY; y++) for (let x = ARENA.spawnX + 20; x <= ARENA.spawnX + 30; x++) window.__fp.ctx.world.clearCellAt(window.__fp.ctx.world.idx(x, y)); });

  // 1d. The fuse: straight up an open shaft, nothing to hit.
  await reset();
  await E(() => { const { ARENA } = window.__fp; window.__fp.carve(ARENA.spawnX - 12, 380, ARENA.spawnX + 12, ARENA.top); });
  await aimFlat(0, -150);
  await tick(page, 2);
  await clearLogs();
  const tt = await now();
  await press(page, 'KeyZ', 1);
  let fuse = null;
  for (let i = 0; i < 70 && !fuse; i++) { await tick(page, 1); fuse = (await logs()).sfx.find((s) => s.id === 'flask.shatter') ?? null; }
  check('with nothing to hit it bursts on its fuse (40 ticks)', fuse !== null && fuse.t - tt >= 39 && fuse.t - tt <= 41, `fused after ${fuse ? fuse.t - tt : '-'} ticks`);
  check('...high above the floor, in the air', fuse !== null && fuse.y < FLOOR - 60, `y ${fuse?.y}`);
  check('...and out of reach of her own shove: she is not moved', Math.abs((await me(page)).vx) < 0.3);

  // 1e. A foe in the line of flight is hit on contact, not flown through.
  await reset();
  await aimFlat();
  const F = await spawnFoe('slime', 40, 100);
  await tick(page, 2);
  await clearLogs();
  await now();
  await press(page, 'KeyZ', 1);
  let contact = null;
  for (let i = 0; i < 30 && !contact; i++) { await tick(page, 1); contact = (await logs()).sfx.find((s) => s.id === 'flask.shatter') ?? null; }
  check('a vial that meets a foe bursts ON it (within 8 cells of its body)', contact !== null && Math.abs(contact.x - F.x) <= 8, JSON.stringify(contact) + ' foe ' + F.x);
  check('...so the foe took the 14', (await logs()).dmg.some((d) => d.amount === 14 && d.kind === 'slime'));
}

// ============================================================================= 2. VOLATILE MIXTURE
console.log('\n-- Volatile Mixture (passive)');
const aimAtFoe = async () => { const f = (await foes())[0]; return aimMouse(f.x, f.y - 5); };
/** Put the (first) foe `dx` cells from her, on her floor, cold and still, with no flames about it. */
const placeFoe = (dx, { dy = 0 } = {}) => E(({ dx, dy }) => {
  const { ctx, Cell } = window.__fp, w = ctx.world, e = ctx.enemies[0], p = ctx.player;
  e.x = Math.round(p.x + dx); e.y = p.y + dy; e.vx = 0; e.vy = 0; e.knockT = 0; e.knockVx = 0; e.status.burning = 0; e.hp = e.maxHp;
  // (flames, smoke and gore left by the last blow would stop the next bolt before it reaches the foe)
  const junk = new Set([Cell.Fire, Cell.Ember, Cell.Smoke, Cell.Steam, Cell.Blood, Cell.Slime, Cell.Ash]);
  for (let yy = window.__fp.ARENA.top; yy < window.__fp.ARENA.floorY; yy++) for (let xx = window.__fp.ARENA.x0; xx <= window.__fp.ARENA.x1; xx++) {
    if (w.inBounds(xx, yy) && junk.has(w.types[w.idx(xx, yy)])) w.clearCellAt(w.idx(xx, yy));
  }
}, { dx, dy });
/** Hold the real wand (mouse down) until `done(logs)` is true or `maxTicks` pass. */
async function holdWandUntil(done, maxTicks = 90, atDone = async () => null) {
  await clearLogs();
  await page.mouse.down();
  let l = await logs();
  for (let i = 0; i < maxTicks && !done(l); i++) {
    await page.mouse.down(); // (re-sent: a focus change elsewhere would release the button)
    await E(() => { for (const e of window.__fp.ctx.enemies) { if (e.kind === 'slime') { e.y = window.__fp.ARENA.floorY - 1; e.vy = 0; } else if (e.kind === 'imp') { e.y = window.__fp.ctx.player.y - 3; e.vy = 0; } } }); // (a slime mid-hop, or an imp on the wing, would let the bolt pass it by)
    await tick(page, 1);
    l = await logs();
  }
  const snap = await atDone(); // read the world on the very tick the condition came true
  await page.mouse.up();
  await tick(page, 2);
  return { ok: done(l), l, snap };
}
const sparkHit = (l) => l.dmg.some((d) => d.source === 'direct' && !d.melee && d.amount >= 0.5);
// The foe is pinned a kick's length away for the three ticks the key is down (a hopping slime would otherwise dodge the cone).
const kickFoe = async (dy = 0) => {
  await tick(page, 24); // (the previous kick has a 22-tick cooldown)
  const pin = () => E(({ dy }) => { const e = window.__fp.ctx.enemies[0], p = window.__fp.ctx.player; if (e) { e.x = Math.round(p.x + 16); e.y = p.y + dy; e.vx = 0; e.vy = 0; e.knockT = 0; } }, { dy });
  await pin();
  const at = await E(() => ({ x: window.__fp.ctx.player.x + 16, y: window.__fp.ctx.player.y - 5 }));
  await aimMouse(at.x, at.y + (dy || 0));
  await clearLogs();
  await page.keyboard.down('KeyF');
  for (let i = 0; i < 3; i++) { await pin(); await tick(page, 1); }
  await page.keyboard.up('KeyF');
  const l = await logs();
  return l.dmg.find((d) => d.melee) ?? null;
};
const dbg = async (label) => { if (process.env.DEBUG_ILYRA) console.log('   [dbg]', label, JSON.stringify(await meter()), JSON.stringify((await logs()).dmg.slice(-3))); };
const stage = async (dx = 70, hp = 900) => { await reset({ hp: 1000 }); await spawnFoe('slime', dx, hp); await tick(page, 2); await aimAtFoe(); };
if (want('mixture')) {
  await stage();
  const s1 = await holdWandUntil(sparkHit);
  if (!s1.ok) console.log('   (diagnostic)', JSON.stringify(await E(() => { const c = window.__fp.ctx, p = c.player, e = c.enemies[0]; return { mouse: { ...c.input.mouse }, aim: p.aimAngle, p: { x: p.x, y: p.y, dead: p.dead, firing: p.firing }, foe: e && { x: e.x, y: e.y }, cam: { x: c.camera.x, y: c.camera.y, rx: c.camera.renderX }, casts: window.__il.casts.length, wcd: c.wands.wands[0].cooldown, mana: c.wands.wands[0].mana, impacts: window.__il.sfx.filter((q) => q.id === 'spell.spark.impact').map((q) => [Math.round(q.x), Math.round(q.y)]), line: (() => { const w = c.world, out = []; for (let y = 676; y <= 689; y += 3) for (let x = 441; x < 520; x++) { const t = w.types[w.idx(x, y)]; if (t) out.push([x, y, t]); } return out.slice(0, 12); })() }; })));
  check('a real spark bolt (the wand, mouse held) hurts the foe', s1.ok);
  const m = await meter();
  check('one weapon opens the mixture window on the chip (no prime yet)', m !== null && m.label === 'MIXTURE' && m.value > 200, JSON.stringify(m));

  // A second weapon: kick it.
  await placeFoe(18);
  await tick(page, 2);
  await aimAtFoe();
  const k1 = await kickFoe();
  check('a real kick (F) lands on the foe', k1 !== null, JSON.stringify(k1));
  const mp = await meter();
  check('spark then kick: the chip reads SCORCH PRIMED', mp !== null && mp.label === 'SCORCH PRIMED' && mp.value > 280, JSON.stringify(mp));
  check('...and no Scorch has struck yet (the prime is a promise, not a burn)', (await logs()).dmg.every((d) => d.amount !== 6) && (await logs()).callouts.length === 0);
  await look('primed', ...(await E(() => [window.__fp.ctx.player.x + 6, window.__fp.ctx.player.y - 12])), 40, 26, 6);

  // The next hit: Scorch.
  await placeFoe(70);
  await tick(page, 2);
  await aimAtFoe();
  const sc = await holdWandUntil((l) => l.callouts.some((c) => c.text === 'SCORCH') || l.callouts.some((c) => c.text === 'FLARE'), 120, async () => {
    const f = (await foes())[0];
    return { burning: f?.burning ?? -1, fire: f ? await cells('Fire', f.x - 24, f.y - 28, f.x + 24, f.y + 2) : 0 };
  });
  const burnAt = sc.snap?.burning ?? -1;
  if (!sc.ok) console.log('   (diagnostic)', JSON.stringify({ foe: (await foes())[0], meter: await meter(), l: sc.l }));
  check('the next hit lands the 6-damage flare', sc.l.dmg.some((d) => d.amount === 6 && d.source === 'direct'));
  check('...and sets the foe alight: burning status >= 120 ticks when it lands (the engine status sample takes 2 the same tick; it was cold before)', burnAt >= 110, `burning ${burnAt}`);
  check('...with real Fire cells licking its body at the strike (the grid explains the flames)', (sc.snap?.fire ?? 0) >= 1, `${sc.snap?.fire} Fire cells`);
  check('the callout says SCORCH and the pyre cue sounds', sc.l.callouts.some((c) => c.text === 'SCORCH') && sc.l.sfx.some((s) => s.id === 'spell.crit.pyre'));
  check('the prime is spent: the chip clears', (await meter()) === null || (await meter()).label !== 'SCORCH PRIMED');
  const fx = (await foes())[0];
  await look('scorch', fx.x, fx.y - 6, 40, 26, 6);
  const hp1 = (await foes())[0].hp;
  let shed = 0;
  for (let i = 0; i < 9; i++) { await tick(page, 5); shed = Math.max(shed, await cells('Fire', fx.x - 24, fx.y - 28, fx.x + 24, fx.y + 2)); }
  const hp2 = (await foes())[0].hp;
  check('the burning is real: the foe keeps losing hp with no blow landing', hp2 < hp1 - 2, `${hp1} -> ${hp2}`);
  check('...and its status is still burning most of a second later', (await foes())[0].burning > 0, JSON.stringify((await foes())[0]));
  check('...the flames about it are cells that exist in the grid', shed >= 1, `${shed}`);
  await look('scorch-burning', fx.x, fx.y - 6, 40, 26, 6);

  // Negative: the same weapon twice never primes.
  await stage();
  await holdWandUntil(sparkHit);
  await tick(page, 40);
  await E(() => { for (const w of window.__fp.ctx.wands.wands) w.cooldown = 0; });
  await placeFoe(70);
  await aimAtFoe();
  const again = await holdWandUntil(sparkHit);
  check('spark then spark: the same weapon twice does NOT prime (chip stays MIXTURE, no flare)', again.ok && (await meter())?.label !== 'SCORCH PRIMED' && !again.l.dmg.some((d) => d.amount === 6), JSON.stringify(await meter()));

  // Negative: two weapons, but more than 4 s apart.
  await stage();
  await holdWandUntil(sparkHit);
  await tick(page, 260); // 4.3 s
  await placeFoe(18);
  await tick(page, 2);
  await aimAtFoe();
  const kLate = await kickFoe();
  check('spark, wait past 4 s, then kick: the kick lands but there is no prime', kLate !== null && (await meter())?.label !== 'SCORCH PRIMED', JSON.stringify(await meter()));

  // The crucible is a weapon of its own: vial then kick primes her too.
  await reset({ hp: 1000 });
  await aimFlat();
  const G = await spawnFoe('slime', 50, 900);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  for (let i = 0; i < 30; i++) { await E(({ gx }) => { const e = window.__fp.ctx.enemies[0]; if (e) { e.x = gx; e.y = window.__fp.ARENA.floorY - 1; e.vx = 0; e.vy = 0; } }, { gx: G.x }); await tick(page, 1); }
  check('(the vial burst on the foe)', (await logs()).dmg.some((d) => d.amount === 14));
  await placeFoe(18);
  await tick(page, 2);
  await aimAtFoe();
  await kickFoe();
  check('vial (her own crucible) then kick: primed', (await meter())?.label === 'SCORCH PRIMED', JSON.stringify(await meter()));

  // A primed vial scorches everything it catches (one blast = one hit).
  await stage();
  await holdWandUntil(sparkHit);
  await dbg('vial-test spark');
  await placeFoe(18);
  await tick(page, 2);
  await aimAtFoe();
  await kickFoe();
  await dbg('vial-test kick');
  const primedForVial = (await meter())?.label === 'SCORCH PRIMED';
  // ...then two foes under the blast (the first one stays where it is struck; a second joins it).
  await spawnFoe('slime', 66, 900);
  await E(() => { const { ctx } = window.__fp; const p = ctx.player; ctx.enemies.forEach((e, i) => { e.x = Math.round(p.x + 52 + i * 10); e.y = p.y; e.vx = 0; e.knockT = 0; e.status.burning = 0; e.hp = e.maxHp = 900; }); });
  await aimFlat();
  await tick(page, 1);
  await clearLogs();
  await press(page, 'KeyZ', 1);
  for (let i = 0; i < 25; i++) await tick(page, 1);
  const lv = await logs();
  const burning = (await foes()).filter((f) => f.burning >= 60).length;
  check('a PRIMED vial is one hit that scorches every foe it catches', primedForVial && lv.callouts.filter((c) => c.text === 'SCORCH').length === 2 && burning === 2, JSON.stringify({ primedForVial, callouts: lv.callouts, burning, dmg: lv.dmg.slice(0, 6) }));
  check('...and spends the prime once', (await meter())?.label !== 'SCORCH PRIMED');

  // A fire-proof foe takes the flare only.
  await reset({ hp: 1000 });
  await spawnFoe('imp', 18, 900, { y: FLOOR - 4 });
  await tick(page, 2);
  await placeFoe(18, { dy: -3 });
  await aimAtFoe();
  const impKick = await kickFoe(-3);
  await placeFoe(70, { dy: -3 });
  await tick(page, 2);
  await aimAtFoe();
  const impSpark = await holdWandUntil(sparkHit);
  const primedImp = (await meter())?.label === 'SCORCH PRIMED';
  if (!primedImp) console.log('   (diagnostic)', JSON.stringify({ impKick, impSpark: impSpark.ok, meter: await meter(), foe: (await foes())[0] }));
  await placeFoe(60, { dy: -3 });
  await tick(page, 2);
  await aimAtFoe();
  const fl = await holdWandUntil((l) => l.callouts.some((c) => c.text === 'FLARE' || c.text === 'SCORCH'), 120);
  const imp = (await foes())[0];
  check('kick + spark primes her against an imp too', primedImp);
  check('an imp (fire-proof) takes the 6-damage flare, called FLARE...', fl.l.dmg.some((d) => d.amount === 6) && fl.l.callouts.some((c) => c.text === 'FLARE'), JSON.stringify(fl.l.callouts));
  check('...but never catches fire (burning status stays 0)', imp && imp.burning === 0, JSON.stringify(imp));
}

// ============================================================================= 3. PHOENIX DRAFT (T)
console.log('\n-- Phoenix Draft (T)');
/** Count real wand casts over `ticks` with the mouse held, mana topped up and every bolt deleted the tick it is cast (so nothing blasts the arena). */
async function shotsOver(ticks) {
  await aimFlat(150, -30);
  await clearLogs();
  await page.mouse.down();
  for (let i = 0; i < ticks; i += 5) {
    await page.mouse.down();
    await E(() => { const { ctx } = window.__fp; window.__fp.ctx.state.paused = true; for (let k = 0; k < 5; k++) { for (const w of ctx.wands.wands) w.mana = w.frame.manaMax; window.__fp.tick(1); ctx.projectiles.length = 0; } });
  }
  await page.mouse.up();
  await tick(page, 1);
  return (await logs()).casts.filter((c) => c.id === 'spark').length;
}
const runRight = async (ticks = 40) => {
  await E(() => { const p = window.__fp.ctx.player; Object.assign(p, { x: window.__fp.ARENA.x0 + 12, vx: 0, vy: 0, facing: 1 }); });
  await tick(page, 2);
  const a = (await me(page)).x;
  let top = 0;
  for (let i = 0; i < ticks; i++) { await page.keyboard.down('KeyD'); await tick(page, 1); top = Math.max(top, Math.abs((await me(page)).vx)); }
  await page.keyboard.up('KeyD');
  return { dist: (await me(page)).x - a, top };
};
const burnTest = async () => {
  await E(() => { const p = window.__fp.ctx.player; p.hp = p.maxHp = 100; p.invuln = 0; p.x = window.__fp.ARENA.spawnX; p.vx = 0; p.status.burning = 0; });
  await tick(page, 2);
  const hp = (await me(page)).hp;
  let burningSeen = 0;
  for (let i = 0; i < 8; i++) {
    await E(() => { const { ctx, Cell } = window.__fp, w = ctx.world, p = ctx.player; for (let yy = p.y - 7; yy <= p.y; yy++) for (let xx = p.x - 5; xx <= p.x + 5; xx++) { if (w.inBounds(xx, yy) && w.types[w.idx(xx, yy)] === 0) { w.replaceCellAt(w.idx(xx, yy), Cell.Fire, 0xff6600); w.life[w.idx(xx, yy)] = 60; } } });
    await tick(page, 1);
    burningSeen = Math.max(burningSeen, (await me(page)).status.burning);
  }
  return { lost: hp - (await me(page)).hp, burningSeen };
};
if (want('phoenix')) {
  await reset();
  const baseLights = await lights();
  await press(page, 'KeyT', 2);
  v = await view(page);
  check('T with the bar not full is refused (chip flinches, nothing starts)', v.ultimate.active === 0 && v.ultimate.refusedAt > 0 && (await E(() => window.__fp.ctx.fighters.moveScale())) === 1);

  const baseShots = await shotsOver(300);
  const baseRun = await runRight(40);
  await E(() => { for (const w of window.__fp.ctx.wands.wands) w.cooldown = 0; });

  // ---- the first draught: cast rate and fire-proofing
  await E(() => window.__fp.ctx.fighters.refill());
  await clearLogs();
  await press(page, 'KeyT', 1);
  v = await view(page);
  check('T with a full bar starts the draught (active, bar spent)', v.ultimate.active > 0.95 && v.ultimate.charge === 0, JSON.stringify(v.ultimate));
  check('the kindling sounds and a golden light follows her (one more light in the level)', (await logs()).sfx.some((s) => s.id === 'spell.emberstorm') && (await lights()) === baseLights + 1, `${baseLights} -> ${await lights()}`);
  check('speed x1.25 is live on the engine (moveScale)', Math.abs((await E(() => window.__fp.ctx.fighters.moveScale())) - 1.25) < 1e-9);
  await E(() => { const p = window.__fp.ctx.player; p.x = window.__fp.ARENA.spawnX; p.vx = 0; });
  await tick(page, 2);
  await look('phoenix-start', ...(await E(() => [window.__fp.ctx.player.x, window.__fp.ctx.player.y - 10])), 45, 30, 5);
  await tick(page, 4);
  await look('phoenix-glow', ...(await E(() => [window.__fp.ctx.player.x, window.__fp.ctx.player.y - 10])), 30, 20, 8);
  const boostedShots = await shotsOver(300);
  check(`faster reloads: the REAL cast rate doubles (${baseShots} shots -> ${boostedShots} over 300 ticks)`, baseShots >= 6 && boostedShots / baseShots >= 1.8 && boostedShots / baseShots <= 2.3, `${baseShots} -> ${boostedShots}`);
  const fireIn = await burnTest();
  check('fire-proof: standing in flames costs her nothing and she never stays alight', fireIn.lost < 0.01 && fireIn.burningSeen === 0, JSON.stringify(fireIn));
  await look('phoenix-fireproof', ...(await E(() => [window.__fp.ctx.player.x, window.__fp.ctx.player.y - 10])), 35, 24, 6);

  // ---- it ends on its own clock; everything it did is undone
  await tick(page, 200);
  v = await view(page);
  check('the draught ends on its own clock (480 ticks): chip idle', v.ultimate.active === 0, JSON.stringify(v.ultimate));
  check('...speed back to normal and the follow-light is gone', (await E(() => window.__fp.ctx.fighters.moveScale())) === 1 && (await lights()) === baseLights, `${await lights()} vs ${baseLights}`);
  await tick(page, 100); // the flames the fire test lit burn out
  const afterBurn = await burnTest();
  check('...and fire hurts her again (the immunity really was the draught)', afterBurn.lost > 0.5, JSON.stringify(afterBurn));
  await reset(); // (she may have burned right down: a fresh start for the cast-rate count)
  const afterShots = await shotsOver(300);
  check(`...and the cast rate is back to normal (${afterShots} shots vs ${baseShots} before)`, afterShots >= baseShots - 1 && afterShots <= baseShots + 1, `${afterShots} vs ${baseShots}`);

  // ---- a second draught: the run
  await reset();
  await E(() => window.__fp.ctx.fighters.refill());
  await press(page, 'KeyT', 1);
  await E(() => { const p = window.__fp.ctx.player; Object.assign(p, { x: window.__fp.ARENA.x0 + 12, vx: 0, vy: 0, facing: 1 }); });
  await tick(page, 2);
  const startX = (await me(page)).x;
  await clearLogs();
  let maxSpeed = 0;
  const samples = [], vxs = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.down('KeyD');
    await tick(page, 1);
    const m = await me(page);
    maxSpeed = Math.max(maxSpeed, Math.abs(m.vx));
    vxs.push(m.vx);
    if (i % 8 === 7) samples.push(await E(({ x0, x1 }) => { const { ctx, Cell } = window.__fp, w = ctx.world; let f = 0, e = 0, maxX = -1; for (let yy = window.__fp.ARENA.floorY - 4; yy < window.__fp.ARENA.floorY; yy++) for (let xx = x0; xx <= x1; xx++) { const t = w.types[w.idx(xx, yy)]; if (t === Cell.Fire) { f++; maxX = Math.max(maxX, xx); } if (t === Cell.Ember) { e++; maxX = Math.max(maxX, xx); } } return { f, e, maxX, px: ctx.player.x }; }, { x0: ARENA.x0, x1: ARENA.x1 }));
    if (i === 26) {
      // Four slimes step into the fresh flames behind her (each starts 6 cells short of a flame column and walks in a cell a tick); a fifth stands well ahead, clear of them.
      await E(() => {
        const { ctx, Cell, ARENA } = window.__fp, w = ctx.world, p = ctx.player, cols = [];
        for (let xx = ARENA.x0; xx < p.x - 4; xx++) { for (let yy = ARENA.floorY - 12; yy < ARENA.floorY; yy++) if (w.types[w.idx(xx, yy)] === Cell.Fire) { cols.push(xx); break; } }
        window.__walk = { t: 0, targets: [] };
        for (const d of [10, 18, 26, 34]) {
          const goal = cols.length ? cols.reduce((a, b) => (Math.abs(b - (p.x - d)) < Math.abs(a - (p.x - d)) ? b : a)) : Math.round(p.x - d);
          const e = window.__fp.spawn('slime', 0, { hp: 400 });
          e.x = goal - 6; e.y = ARENA.floorY - 1; e.status.burning = 0; e.vx = 0;
          window.__walk.targets.push(goal);
        }
        const c = window.__fp.spawn('slime', 0, { hp: 400 });
        c.x = ARENA.x1 - 45; c.y = ARENA.floorY - 1; c.status.burning = 0;
      });
    }
    if (i > 26) await E(() => { const wk = window.__walk; wk.t++; window.__fp.ctx.enemies.forEach((e, k) => { e.vx = 0; e.vy = 0; e.y = window.__fp.ARENA.floorY - 1; if (k < 4 && wk.t <= 6) e.x += 1; if (k === 4) e.x = window.__fp.ARENA.x1 - 45; }); });
    if (i === 24 && SHOTS) await shot(page, 'ilyra-1to1-phoenix');
    if (i === 24) await look('phoenix-trail', ...(await E(() => [window.__fp.ctx.player.x - 25, window.__fp.ctx.player.y - 10])), 60, 34, 5);
  }
  const boostedRun = (await me(page)).x - startX;
  await page.keyboard.up('KeyD');
  check(`run speed x1.25: top speed ${baseRun.top.toFixed(2)} -> ${maxSpeed.toFixed(2)} cells/tick (${baseRun.dist} -> ${boostedRun} cells in 40 ticks)`, maxSpeed / baseRun.top >= 1.2 && maxSpeed / baseRun.top <= 1.3 && boostedRun / baseRun.dist >= 1.1, `${JSON.stringify(baseRun)} -> ${boostedRun}; vx ${vxs.join(",")}`);
  check('she moves faster than 1.5 cells/tick while running', maxSpeed > 1.5, `max vx ${maxSpeed}`);
  check('the trail is REAL Fire cells in the grid, laid where she ran', samples.some((s) => s.f >= 6), JSON.stringify(samples));
  check('...BEHIND her (never ahead of her feet)', samples.every((s) => s.maxX < 0 || s.maxX <= s.px + 1), JSON.stringify(samples));
  check('...with a few real Embers glowing among them', (await cells('Ember', ARENA.x0, FLOOR - 6, ARENA.x1, FLOOR)) >= 1);
  await look('phoenix-trail-2', ...(await E(() => [window.__fp.ctx.player.x - 25, window.__fp.ctx.player.y - 10])), 60, 34, 5);

  // The trail burns a foe that walks into it (four slimes stepped into the flames at tick 26, above; the run carried on).
  const fireXs = await E(() => { const { ctx, Cell, ARENA } = window.__fp, w = ctx.world, xs = []; for (let xx = ARENA.x0; xx <= ARENA.x1; xx++) { for (let yy = ARENA.floorY - 12; yy < ARENA.floorY; yy++) if (w.types[w.idx(xx, yy)] === Cell.Fire) { xs.push(xx); break; } } return xs; });
  check('there was fire on the ground to walk into', fireXs.length >= 4, JSON.stringify(fireXs));
  for (let i = 0; i < 14; i++) {
    await E(() => { window.__fp.ctx.enemies.forEach((e, k) => { e.vx = 0; e.vy = 0; e.y = window.__fp.ARENA.floorY - 1; if (k === 4) e.x = window.__fp.ARENA.x1 - 45; }); });
    await tick(page, 1);
    if (i === 2) await look('phoenix-trail-burn', (await foes())[1]?.x ?? 440, FLOOR - 8, 40, 26, 6);
  }
  const fw = await foes();
  const hurt = fw.slice(0, 4).filter((f) => f.hp < 400 - 3).length;
  const burnt = fw.slice(0, 4).filter((f) => f.burning > 0).length;
  // The flames' damage is the proof (each foe lost 10-25 of its 400 hp from Fire cells alone, with no blow landing); catching fire on top
  // of that is the engine's own percentage roll (3% a flame cell a sample), so it is reported, not demanded.
  check('foes that walk into the trail are burned by it: ' + hurt + ' of 4 lost hp to the flames (' + burnt + ' of 4 also caught fire)', hurt >= 3 && (await logs()).dmg.every((d) => d.kind !== 'slime' || d.source !== 'direct'), JSON.stringify(fw.map((f) => [f.hp, f.burning])));
  check('...while a foe that never touched it is unhurt and cold', fw[4].hp === 400 && fw[4].burning === 0, JSON.stringify(fw[4]));

  // Bounded: the trail burns itself out; only a few coals stay.
  await tick(page, 480);
  await E(() => { window.__fp.ctx.enemies.length = 0; });
  await tick(page, 160);
  check('the trail burns itself out: no Fire cells remain', (await cells('Fire', ARENA.x0, FLOOR - 24, ARENA.x1, FLOOR)) === 0, `${await cells('Fire', ARENA.x0, FLOOR - 24, ARENA.x1, FLOOR)} left`);
  check('...and only a handful of coals (<= 14) stay', (await cells('Ember', ARENA.x0, FLOOR - 24, ARENA.x1, FLOOR)) <= 14);

  // ---- a third draught, cut short (a death, a new floor): everything the kit placed goes.
  await reset();
  await E(() => window.__fp.ctx.fighters.refill());
  await press(page, 'KeyT', 1);
  await runRight(30);
  check('(mid-draught: the light and the drawables are live)', (await lights()) === baseLights + 1 && (await E(() => window.__fp.ctx.fighters.drawables.length)) >= 1);
  await E(() => window.__fp.ctx.fighters.reset());
  check('a reset mid-draught stops it at once: speed, fire-proofing, light, drawables', (await E(() => window.__fp.ctx.fighters.moveScale())) === 1 && (await E(() => window.__fp.ctx.fighters.drawables.length)) === 0 && (await lights()) === baseLights, `${await lights()} vs ${baseLights}`);
}

// ============================================================================= the classic Alchemist is untouched
await reset();
await E(() => window.__fp.ctx.fighters.equip(null));
await tick(page, 3);
await press(page, 'KeyZ', 2);
v = await view(page);
check('with no fighter equipped nothing changes (no abilities, no kit)', v.id === null && v.tactical.ready === false);

const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nilyra probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);
