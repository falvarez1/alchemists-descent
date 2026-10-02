// Edda Morrow (Glass Saint, Support) against the REAL engine: Stored Light, Mercy Shard (Z), Rose Window (T).
// Real Z / T / X (drink) key presses, paused deterministic ticks, and each ability's OBSERVABLE effect: the
// armor pool a real drink fills and a real hit drains before health, the damage a real fireball / slime bite
// does with and without the shard, the hp the window heals, and the velocity of hostile shots (slow, fast,
// merely passing, grazing) that enter its radius. Screenshots (verify-out/fighters/edda-*.png) are for LOOKING at.
// Usage: node scripts/verify-fighter-edda.mjs [url]   (default http://localhost:5197/)
import { aimAt, boot, makeChecker, me, press, shot, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5197/';
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: 'edda-morrow' });
const { ARENA } = await page.evaluate(() => ({ ARENA: window.__fp.ARENA }));
const FLOOR = ARENA.floorY;
const GLASS_R = 16; // TUNING.window.glassR

// Listen: every sound cue, every spark burst (with its colours), every callout.
await page.evaluate(() => {
  const c = window.__fp.ctx;
  window.__sfx = [];
  const sfx = c.audio.sfx.bind(c.audio);
  c.audio.sfx = (id, ...rest) => { window.__sfx.push(id); return sfx(id, ...rest); };
  window.__sparks = [];
  if (c.sparks) {
    const burst = c.sparks.burst.bind(c.sparks);
    c.sparks.burst = (x, y, o) => { window.__sparks.push({ x, y, kind: o.kind, count: o.count, colors: o.colors }); return burst(x, y, o); };
  }
  window.__callouts = [];
  c.events.on('combatCallout', (e) => window.__callouts.push(e.text));
});

const keyBlockers = () => page.evaluate(() => {
  const sel = ['#player-settings[open]', '#expedition-entry:not([hidden])', '.app-dialog-root', '.editor-command-menu.open', '.editor-popover.interactive', '#run-launcher.visible', '#minimap-overlay.visible', '#dev-console.open', '#runtime-inspector.open', '#card-offer-overlay.visible', '#pause-overlay.visible', '#help-overlay.visible', '#sanctum-overlay.visible', '#wand-bench.visible', '#run-summary.visible', '#gameover-overlay.visible', '#grimoire-overlay.open', '#story-cinema.show'];
  return { overlays: sel.filter((q) => document.querySelector(q)), focus: document.activeElement?.tagName, hasFocus: document.hasFocus() };
});

const sfxSince = (mark) => page.evaluate((m) => window.__sfx.slice(m), mark);
const sfxMark = () => page.evaluate(() => window.__sfx.length);
const sparksSince = (mark) => page.evaluate((m) => window.__sparks.slice(m), mark);
const sparksMark = () => page.evaluate(() => window.__sparks.length);
const calloutMark = () => page.evaluate(() => window.__callouts.length);
const calloutsSince = (m) => page.evaluate((k) => window.__callouts.slice(k), m);

/** Back to a clean fighter in a sealed box: full hp, no foes, shots, potions or status, an empty flask belt, a freshly equipped kit. */
async function clean() {
  await page.evaluate(async ({ floor, x0, x1 }) => {
    const f = window.__fp, c = f.ctx, p = c.player;
    c.enemies.length = 0;
    c.projectiles.length = 0;
    c.particles.clear();
    c.sparks?.clear();
    if (c.shockwaves) c.shockwaves.length = 0;
    c.rigidBodies.clear();
    c.vineStrands.strands.length = 0; // the level's three hanging ropes cross the arena (and burn when a blast reaches them)
    const rt = c.levels.current;
    if (rt?.pickups) rt.pickups.length = 0;
    f.carve(x0, 600, x1, floor - 1);
    f.wall(x0, floor, x1, floor + 6);
    f.wall(x0 - 4, 590, x0, floor + 6);
    f.wall(x1, 590, x1 + 4, floor + 6);
    f.wall(x0 - 4, 590, x1 + 4, 599);
    c.fighters.equip('edda-morrow');
    await c.fighters.whenReady();
    c.flask.clearSlots();
    Object.assign(p, { hp: 100, maxHp: 100, invuln: 0, staggerT: 0, vx: 0, vy: 0, fx: 0, fy: 0, x: f.ARENA.spawnX, y: floor - 1, grounded: true, dead: false });
    for (const k of ['regen', 'levity', 'stoneskin', 'swift', 'torch', 'burning', 'wet']) p.status[k] = 0;
    for (const k of Object.keys(c.input.keys)) c.input.keys[k] = false;
    f.tick(2);
  }, { floor: FLOOR, x0: ARENA.x0, x1: ARENA.x1 });
}

/** One blow through the real damage path: the health that reached the body. */
const blow = (amount, kx = 0, ky = 0, src = 'probe') => page.evaluate(({ amount, kx, ky, src }) => {
  const c = window.__fp.ctx, p = c.player;
  p.invuln = 0;
  const hp = p.hp;
  c.playerCtl.damage(amount, kx, ky, src);
  return hp - p.hp;
}, { amount, kx, ky, src });

const zoomTo = async (k) => { await page.evaluate((z) => { window.__fp.ctx.camera.zoomLock = z; }, k); await tick(page, 40); };
const armor = () => page.evaluate(() => window.__fp.ctx.fighters.armor);
const flaskCount = () => page.evaluate(() => window.__fp.ctx.flask.state.count);
const kitState = () => page.evaluate(() => {
  const k = window.__fp.ctx.fighters.kit;
  const p = window.__fp.ctx.player;
  const v = k.shardView;
  return { on: v.on, x: v.x, y: v.y, cx: v.cx, cy: v.cy, px: p.x, py: p.y - 9, age: k.shard?.age ?? -1, flash: v.flash, k: v.k, settle: v.settle, win: k.win ? { x: k.win.x, cy: k.win.cy, state: k.win.state, remaining: k.win.remaining, broke: k.win.view.broke, glow: k.win.view.look.glow, crack: k.win.view.look.crack, scale: k.win.view.look.scale, healing: k.win.healing, glints: k.win.view.glints.length } : null };
});
const lightCount = () => page.evaluate(() => (window.__fp.ctx.levels.current.authoredLights ?? []).length);
const drawables = () => page.evaluate(() => window.__fp.ctx.fighters.drawables.length);

// The test arena's teach card and pickup toasts never fade while the world is paused: hide them for the screenshots.
await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '#wave-banner, .wave-banner { display: none !important; }'; document.head.appendChild(st); });
await page.evaluate(() => { window.__fp.ctx.camera.zoomLock = 3.2; });
await tick(page, 60);
await page.waitForTimeout(3000); // the floor's title card fades in real time

/** Hold the real drink key (X) for `ticks`, then let go. */
const drinkFor = async (ticks) => press(page, 'KeyX', ticks);
const fillFlask = (count = 400) => page.evaluate((n) => { const { ctx, Cell } = window.__fp; ctx.flask.setSlot(0, Cell.ElixirLife, n); ctx.flask.selectSlot(0); }, count);

// =================================================================================================
console.log('\nStored Light (passive)');
// =================================================================================================
await clean();
let v = await view(page);
check('the pool is 30 and starts empty', v.armorMax === 30 && v.armor === 0, JSON.stringify({ armor: v.armor, max: v.armorMax }));
check('no meter of its own (the armor bar is the readout)', v.meter === null);

await fillFlask(400);
const c0 = await flaskCount();
const smark = await sfxMark(), spmark = await sparksMark(), cmark = await calloutMark();
const lights0 = await lightCount();
await page.keyboard.down('KeyX');
await tick(page, 3);
const inGlint = { lights: await lightCount() };
await shot(page, 'edda-1-glint');
await tick(page, 37);
await page.keyboard.up('KeyX');
v = await view(page);
const c1 = await flaskCount();
check('holding the real drink key swallows the flask (cells really gone)', c1 < c0 - 40, `${c0} -> ${c1}`);
check('...and a held drink is ONE use: the pool is 12, not 12 x 40', v.armor === 12, String(v.armor));
const sounds = await sfxSince(smark);
const burst = await sparksSince(spmark);
check('...with a gold glint: gold sparks (0xffe9a8 / 0xffc050), a chime, a "+12" line, a warm flash of light', burst.some((b) => b.colors.includes(0xffc050) && b.colors.includes(0xffe9a8)) && sounds.includes('pickup.bell') && (await calloutsSince(cmark)).some((t) => t.includes('+12')) && inGlint.lights > lights0, JSON.stringify({ sounds: [...new Set(sounds)], callouts: await calloutsSince(cmark), lights: [lights0, inGlint.lights] }));
check('...her silhouette is shimmering gold while she carries it (a drawable appears)', (await drawables()) === 1);

// Pressing X again straight away is the same drink (sips under 30 ticks apart); a NEW drink soon after is turned away while the glass rests.
await drinkFor(30);
check('letting go and pressing X again at once is the same drink: still 12', (await armor()) === 12, String(await armor()));
await tick(page, 60);
await drinkFor(20);
check('a new drink 1 s later (the glass is resting, 3 s) earns nothing', (await armor()) === 12, String(await armor()));
await tick(page, 200);
await drinkFor(30);
check('...after the rest it does: 24', (await armor()) === 24, String(await armor()));
await tick(page, 200);
await drinkFor(30);
check('...and the third tops the pool at 30 (a 6-point gain, not 12)', (await armor()) === 30, String(await armor()));
await tick(page, 200);
const sipBefore = await flaskCount();
const cmark2 = await calloutMark();
await drinkFor(30);
check('a full pool takes nothing more (still 30, no glint line), though the flask is still swallowed', (await armor()) === 30 && (await calloutsSince(cmark2)).length === 0 && (await flaskCount()) < sipBefore, JSON.stringify({ a: await armor(), callouts: await calloutsSince(cmark2) }));
await zoomTo(5);
await shot(page, 'edda-2-shimmer');
await zoomTo(3.2);

// The pool absorbs damage before health, and does not come back by itself.
let lost = await blow(10);
check('with 30 stored, a 10-point blow costs no health and the pool drops to 20', Math.abs(lost) < 0.01 && Math.abs((await armor()) - 20) < 0.01, `lost ${lost} armor ${await armor()}`);
await tick(page, 40);
lost = await blow(30);
check('a 30-point blow drains the last 20 and the remaining 10 reaches health', Math.abs(lost - 10) < 0.01 && (await armor()) < 0.01, `lost ${lost} armor ${await armor()}`);
await tick(page, 2);
const brk = await sfxSince(smark);
check('...ringing as it goes (a chime for a blow it took, a crack when it is gone)', brk.filter((s) => s === 'pickup.bell').length >= 3 && brk.includes('mat.shatter'));
await tick(page, 300);
check('it does not regenerate by itself (0 after 5 s)', (await armor()) === 0);
lost = await blow(15);
check('...so the next blow is taken whole', Math.abs(lost - 15) < 0.01, String(lost));

// A potion lifted off the floor is a consumable used too.
await clean();
await page.evaluate(() => {
  const { ctx } = window.__fp, p = ctx.player;
  ctx.levels.current.pickups.push({ kind: 'potion', x: p.x, y: p.y - 8, vx: 0, vy: 0, taken: false, data: { potion: 'vigor' } });
});
await tick(page, 3);
check('a real potion pickup grants +12 too', (await armor()) === 12 && (await page.evaluate(() => window.__fp.ctx.player.status.regen)) > 0, `armor ${await armor()}`);

// Saved with the run (the pool carries across floors).
await clean();
await fillFlask(400);
await drinkFor(10);
const snap = await page.evaluate(() => window.__fp.ctx.fighters.snapshot());
check('the pool is in the run save (armor 12)', snap?.armor === 12, JSON.stringify(snap));
await clean();
await page.evaluate((s) => window.__fp.ctx.fighters.restore(s), snap);
await tick(page, 2);
check('...and a restore puts it back (a floor change keeps it too)', (await armor()) === 12 && (await view(page)).armorMax === 30, String(await armor()));
await page.evaluate(() => window.__fp.ctx.events.emit('levelChanged', { depth: 1, name: 'probe' }));
await tick(page, 2);
check('...across a levelChanged it is still 12 (the kit clears its effects, not her light)', (await armor()) === 12, String(await armor()));

// Other flask verbs are not a use.
await clean();
await fillFlask(400);
await page.keyboard.down('KeyQ');
await tick(page, 20);
await page.keyboard.up('KeyQ');
await page.evaluate(() => { const { ctx } = window.__fp; for (const verb of ['siphon', 'throw']) ctx.events.emit('flaskUsed', { verb, material: 2, amount: 30 }); });
await tick(page, 2);
check('a real pour (Q), a siphon and a throw are not uses: still 0', (await armor()) === 0, String(await armor()));

// She is only Edda while equipped, and the subscription is not doubled.
await clean();
await page.evaluate(() => window.__fp.ctx.fighters.equip(null));
await fillFlask(400);
await drinkFor(10);
check('as the classic Alchemist the same drink grants no armor (the kit is gone and listens to nothing)', (await armor()) === 0 && (await view(page)).armorMax === 0);
await clean();
await page.evaluate(async () => { const f = window.__fp.ctx.fighters; f.equip('edda-morrow'); await f.whenReady(); f.equip('edda-morrow'); await f.whenReady(); window.__fp.tick(2); });
await fillFlask(400);
await drinkFor(10);
check('re-equipped twice, one drink is still +12 (the old listener was torn down)', (await armor()) === 12, String(await armor()));

// =================================================================================================
console.log('\nMercy Shard (Z)');
// =================================================================================================
await clean();
await aimAt(page, 520, FLOOR - 10);
await tick(page, 2);
let bare = await blow(20);
check('without it a 20-point blow costs 20', Math.abs(bare - 20) < 0.01, String(bare));
await tick(page, 40);
const zMark = await sfxMark(), zSparks = await sparksMark();
await press(page, 'KeyZ', 1);
v = await view(page);
check('Z sends the shard: the chip is active and cooling (12 s)', v.tactical.active > 0.95 && v.tactical.ready === false && v.tactical.cooldownSeconds >= 11, JSON.stringify(v.tactical));
check('...a shard of glass is drawn (two drawables: it goes round her, behind and in front), with a sung note and a shower of glass', (await drawables()) === 2 && (await sfxSince(zMark)).includes('spell.vitrify') && (await sparksSince(zSparks)).length > 0, JSON.stringify(await sfxSince(zMark)));
// the flight
const flight = [];
for (let i = 0; i < 80; i++) {
  await tick(page, 1);
  const s = await kitState();
  flight.push({ age: s.age, dx: s.x - s.cx, dy: s.y - s.cy, d: Math.hypot(s.x - s.cx, s.y - s.cy), cx: s.cx, px: s.px });
  if (i === 9) await zoomTo(5);
  if (i === 9) await shot(page, 'edda-3-shard-flight');
  if (i === 9) await zoomTo(3.2);
}
const out = Math.max(...flight.slice(0, 32).map((f) => f.d));
const outAt = flight.findIndex((f) => f.d === out);
console.log('  measured: the shard strays ' + out.toFixed(1) + ' cells (tick ' + outAt + ') and is back in orbit by tick 40 (' + flight[45].d.toFixed(1) + ' cells)');
check('the shard flies out along the aim (right) well past her, and comes back', out > 14 && flight[outAt].dx > 10 && outAt > 5 && outAt < 29, JSON.stringify({ out, outAt }));
check('...and settles into a glowing orbit round her chest (4.5-11 cells, still turning)', flight.slice(40).every((f) => f.d > 3.5 && f.d < 11.5) && Math.abs(flight[70].dx - flight[50].dx) > 1.5, JSON.stringify(flight.slice(40, 80, 8).map((f) => +f.d.toFixed(1))));
await zoomTo(5);
await shot(page, 'edda-4-shard-orbit');
await zoomTo(3.2);

// the reduction, through the real damage path
const warded = await blow(20);
check('with the shard a 20-point blow costs 12 (x0.6)', Math.abs(warded - 12) < 0.01, String(warded));
check('...and the shard flares when it takes it (a chime, a flash)', (await kitState()).flash > 0.3 && (await sfxSince(zMark)).filter((s) => s === 'pickup.bell').length >= 2);
await shot(page, 'edda-5-shard-flare');

// a real fireball, bare and warded
const fireball = () => page.evaluate(async () => {
  const f = window.__fp, c = f.ctx, p = c.player;
  p.invuln = 0;
  const hp0 = p.hp;
  c.projectiles.length = 0;
  const chestY = p.y - 9;
  f.carve(p.x - 40, chestY - 14, p.x + 80, chestY + 8);
  // 5 cells out: inside the 9-cell body test at once, so it lands this tick, deterministically (no flight, no gravity).
  c.projectiles.push({ x: p.x + 5, y: chestY, vx: -2.5, vy: 0, type: 'fireball', life: 300, age: 0, charging: false, hostile: true });
  // The direct blow is what Player.damage was handed and what reached her; what follows (the blast, then the fire it lights) is the sim's.
  const dmg = c.playerCtl.damage.bind(c.playerCtl);
  const blows = [];
  c.playerCtl.damage = (a, kx, ky, src) => { const h = p.hp; dmg(a, kx, ky, src); if (h - p.hp > 0) blows.push({ asked: a, took: +(h - p.hp).toFixed(3) }); };
  for (let i = 0; i < 6; i++) f.tick(1);
  c.playerCtl.damage = dmg;
  return { total: hp0 - p.hp, blows };
});
const fbRuns = async (withShard) => {
  const costs = [];
  for (let i = 0; i < 3; i++) {
    await clean();
    await aimAt(page, 520, FLOOR - 10); await tick(page, 2);
    if (withShard) { await press(page, 'KeyZ', 1); await tick(page, 40); }
    costs.push(await fireball());
  }
  return costs;
};
const fbBare = await fbRuns(false);
const fbWarded = await fbRuns(true);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const fbB = fbBare.map((x) => x.total), fbW = fbWarded.map((x) => x.total);
console.log('  measured: a real hostile fireball costs ' + fbB.map((x) => x.toFixed(2)).join(' / ') + ' bare (blows ' + JSON.stringify(fbBare[0].blows) + '), ' + fbW.map((x) => x.toFixed(2)).join(' / ') + ' with the shard (blows ' + JSON.stringify(fbWarded[0].blows) + '), ratio ' + (mean(fbW) / mean(fbB)).toFixed(2));
check('a real fireball landing on her: its direct blow is x0.6 (11 -> 6.6) with the shard', Math.abs(fbBare[0].blows[0].took - 11) < 0.05 && Math.abs(fbWarded[0].blows[0].took - 6.6) < 0.05, JSON.stringify([fbBare[0].blows, fbWarded[0].blows]));
check('...and the whole fireball (blow plus its blast and the fire it lights, which vary from run to run) costs 0.4-0.65 of its bare cost', mean(fbB) > 8 && mean(fbW) / mean(fbB) > 0.4 && mean(fbW) / mean(fbB) < 0.65, `${fbB} vs ${fbW}`);

// a real slime's real bite
async function firstBite(withShard) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await clean();
    await aimAt(page, 520, FLOOR - 10);
    await tick(page, 2);
    if (withShard) { await press(page, 'KeyZ', 1); await tick(page, 4); }
    await page.evaluate(() => { const e = window.__fp.spawn('slime', 8, { hp: 400 }); e.alerted = true; e.attackCd = 0; });
    for (let i = 0; i < 240; i++) {
      const hp0 = (await me(page)).hp;
      await tick(page, 1);
      const hp1 = (await me(page)).hp;
      if (hp0 - hp1 > 0.5) return hp0 - hp1;
    }
  }
  return null;
}
const biteBare = await firstBite(false);
const biteShard = await firstBite(true);
console.log('  measured: a real slime bite is ' + biteBare?.toFixed(2) + ' bare and ' + biteShard?.toFixed(2) + ' with the shard');
check('a real slime bite is x0.6 under the shard', biteBare !== null && biteShard !== null && Math.abs(biteShard / biteBare - 0.6) < 0.05, `${biteBare} vs ${biteShard}`);

// end, cooldown, refusal
await clean();
await aimAt(page, 520, FLOOR - 10); await tick(page, 2);
await press(page, 'KeyZ', 1);
await tick(page, 100);
v = await view(page);
const refusedBefore = v.tactical.refusedAt;
await press(page, 'KeyZ', 2);
v = await view(page);
check('Z while the shard is out (and cooling) is refused: the chip flashes, no second shard', v.tactical.refusedAt > refusedBefore && (await drawables()) === 2, JSON.stringify(v.tactical));
await tick(page, 150);
let st = await kitState();
check('the shard is still out at 300 ticks and the ward still holds', st.on && Math.abs((await blow(20)) - 12) < 0.01);
await tick(page, 200); // blinking in its last 70, dissolving in the last 24
st = await kitState();
check('after 6 s it dissolves: shard gone, drawable gone, the chip idle, and a blow costs 20 again', st.on === false && (await drawables()) === 0 && (await view(page)).tactical.active === 0 && Math.abs((await blow(20)) - 20) < 0.01, JSON.stringify(st));
v = await view(page);
check('...but the cooldown (12 s) still runs', v.tactical.ready === false && v.tactical.cooldown > 0.2, JSON.stringify(v.tactical));
await tick(page, 400);
check('...and it is ready again after 12 s', (await view(page)).tactical.ready === true);
// A death or a new floor takes it away at once.
await press(page, 'KeyZ', 1);
await tick(page, 20);
await page.evaluate(() => window.__fp.ctx.fighters.reset());
await tick(page, 1);
check('a reset (a death, a new floor) takes the shard and its ward away at once', (await drawables()) === 0 && Math.abs((await blow(20)) - 20) < 0.01);

// =================================================================================================
console.log('\nRose Window (T)');
// =================================================================================================
await clean();
await aimAt(page, 520, FLOOR - 10); await tick(page, 2);
const rm = (await view(page)).ultimate.refusedAt;
await press(page, 'KeyT', 2);
v = await view(page);
check('T with the bar empty is refused and nothing stands', v.ultimate.refusedAt > rm && v.ultimate.active === 0 && (await drawables()) === 0, JSON.stringify(v.ultimate));

await page.evaluate(() => { window.__fp.ctx.fighters.refill(); });
const baseLights = await lightCount();
const tMark = await sfxMark(), tSparks = await sparksMark(), _tCall = await calloutMark();
await press(page, 'KeyT', 1);
v = await view(page);
check('T with the bar full raises the window: active, bar spent, a window drawable', v.ultimate.active > 0.95 && v.ultimate.charge < 0.05 && (await drawables()) === 1, JSON.stringify(v.ultimate));
const raiseSounds = await sfxSince(tMark);
check('...it emits light (an authored light is in the level), a chime and a conjuring, a fountain of coloured glass', (await lightCount()) === baseLights + 1 && raiseSounds.includes('pickup.bell') && raiseSounds.includes('spell.conjure') && (await sparksSince(tSparks)).some((s) => s.colors.length === 8), JSON.stringify({ lights: [baseLights, await lightCount()], raiseSounds }));
let ws = await kitState();
console.log('  measured: the window stands at x ' + ws.win.x + ', centre y ' + ws.win.cy + ' (her feet at ' + (FLOOR - 1) + '): its lowest edge is ' + (ws.win.cy + GLASS_R) + ', the floor surface ' + FLOOR);
check('it stands on the floor at her feet (the glass is 32 across and its lowest edge is the floor surface, same column)', ws.win.x === ARENA.spawnX && ws.win.cy + GLASS_R === FLOOR, JSON.stringify(ws.win));
await tick(page, 6);
await zoomTo(4);
await shot(page, 'edda-6-window-unfolding');
await tick(page, 4);
await zoomTo(5);
await shot(page, 'edda-7-window');
await zoomTo(2.1);
await shot(page, 'edda-8-window-reach');
await zoomTo(3.2);

// healing
await page.evaluate(() => { window.__fp.ctx.player.hp = 40; });
await tick(page, 1);
const h0 = (await me(page)).hp;
await tick(page, 120);
const h1 = (await me(page)).hp;
console.log('  measured: healed ' + (h1 - h0).toFixed(2) + ' hp in 120 ticks (4 hp/s = 8)');
check('standing in it she heals 4 hp a second (8 in two seconds, to within 0.2)', Math.abs(h1 - h0 - 8) < 0.2, `${h0} -> ${h1}`);
// heal at the radius edge and beyond
const healAt = async (dx) => {
  await page.evaluate((d) => { const p = window.__fp.ctx.player; p.x = window.__fp.ARENA.spawnX + d; p.hp = 40; p.vx = 0; }, dx);
  await tick(page, 1);
  const a = (await me(page)).hp;
  await tick(page, 60);
  return (await me(page)).hp - a;
};
const inEdge = await healAt(55), outEdge = await healAt(66), farOut = await healAt(-100);
check('within 60 cells (55 out) she is healed 4 a second', Math.abs(inEdge - 4) < 0.2, String(inEdge));
check('beyond it (66 out, 100 out the other way) she is not', Math.abs(outEdge) < 0.01 && Math.abs(farOut) < 0.01, `${outEdge} ${farOut}`);
await page.evaluate(() => { const p = window.__fp.ctx.player; p.x = window.__fp.ARENA.spawnX; p.hp = 99.9; });
await tick(page, 20);
check('healing is capped at max health (99.9 -> 100, never over)', (await me(page)).hp === 100, String((await me(page)).hp));
const stats = await page.evaluate(() => ({ regen: window.__fp.ctx.player.status.regen }));
check('...with no potion status needed (the window heals through her hp directly)', stats.regen === 0, JSON.stringify(stats));

// refraction: a window lasts 600 ticks, so each group of shots gets a fresh one
console.log('  (hostile shots)');
let lightBase = 0;
async function raiseWindow() {
  await clean();
  lightBase = await lightCount();
  await page.evaluate(() => { window.__fp.ctx.fighters.refill(); });
  await aimAt(page, 520, FLOOR - 10); await tick(page, 2);
  await press(page, 'KeyT', 1);
  return (await kitState()).win;
}
let prism = await raiseWindow();
/** Fire a hostile shot, step tick by tick, and record what the prism did to it. */
const fly = (o, pr = prism) => page.evaluate(({ o, prism }) => {
  const f = window.__fp, c = f.ctx, p = c.player;
  p.invuln = 0; p.hp = 100;
  c.projectiles.length = 0;
  c.particles.clear(); // an earlier shot's embers would light fires in this one's lane
  f.carve(p.x - 90, 600, p.x + 170, f.ARENA.floorY - 1);
  const q = { x: prism.x + o.dx, y: prism.cy + (o.dy ?? 0), vx: o.vx, vy: o.vy ?? 0, type: o.type ?? 'fireball', life: 400, age: o.age ?? 4, charging: false, hostile: o.hostile ?? true };
  c.projectiles.push(q);
  const speed0 = Math.hypot(q.vx, q.vy);
  const rec = { minD: Infinity, speeds: [], turnedAt: -1, gone: -1, vxs: [q.vx], hpLost: 0 };
  for (let i = 0; i < (o.ticks ?? 60); i++) {
    const vx0 = q.vx, vy0 = q.vy;
    f.tick(1);
    if (!c.projectiles.includes(q)) { rec.gone = i; break; }
    const d = Math.hypot(q.x - prism.x, q.y - prism.cy);
    rec.minD = Math.min(rec.minD, d);
    rec.speeds.push(Math.hypot(q.vx, q.vy));
    rec.vxs.push(q.vx);
    // gravity changes vy a little each tick; a turn is a change far bigger than that
    if (rec.turnedAt < 0 && Math.hypot(q.vx - vx0, q.vy - vy0) > 0.5) rec.turnedAt = i;
  }
  rec.hpLost = 100 - p.hp;
  rec.final = { x: q.x - prism.x, y: q.y - prism.cy, vx: q.vx, vy: q.vy };
  rec.alive = c.projectiles.includes(q);
  rec.speed0 = speed0;
  return rec;
}, { o, prism: pr });
/** A fresh arena and a fresh window for every flight: an earlier shot's blast leaves fire in the lane, which a later fireball would explode on. */
const flyFresh = async (o) => { prism = await raiseWindow(); return fly(o, prism); };
const rfMark = await sfxMark();
let r = await flyFresh({ dx: 100, dy: -3, vx: -2.5, ticks: 70 });
console.log('  measured: slow fireball turned at tick ' + r.turnedAt + ', closest approach ' + r.minD.toFixed(1) + ' cells, now flying ' + r.final.vx.toFixed(2) + ',' + r.final.vy.toFixed(2));
check('a slow fireball flying at her is turned at the 60-cell radius (never closer than 58), flies on away, and she takes nothing', r.turnedAt >= 0 && r.minD > 57.5 && r.final.vx > 0.5 && r.hpLost < 0.01, JSON.stringify(r));
check('...it is NOT consumed by the turn: it flew on for 8+ more ticks and ended far outside the radius (at the floor / wall), not at the prism', r.turnedAt >= 0 && (r.gone < 0 || r.gone > r.turnedAt + 8) && Math.hypot(r.final.x, r.final.y) > 59, JSON.stringify({ turnedAt: r.turnedAt, gone: r.gone, final: r.final }));
check('...and its speed is kept (to within gravity)', r.speeds.every((s) => Math.abs(s - r.speed0) < 0.45), JSON.stringify(r.speeds.slice(0, 8)));
check('...with a chime and sparks in the prism\'s colours', (await sfxSince(rfMark)).includes('pickup.bell') && (await page.evaluate(() => window.__sparks.some((s) => s.colors && s.colors.length === 8 && s.count === 12))));
await tick(page, 2);

r = await flyFresh({ dx: 150, dy: -1, vx: -45, age: 12, ticks: 12 });
console.log('  measured: a 45-cells-per-tick shot: closest approach ' + r.minD.toFixed(1) + ', now ' + r.final.vx.toFixed(1) + ',' + r.final.vy.toFixed(1));
check('a 45-cells-per-tick shot is caught at the radius, not tunnelled through: it never gets within 58 cells, is turned away at full speed, and flies on', r.minD > 57.5 && r.final.vx > 5 && Math.abs(Math.hypot(r.final.vx, r.final.vy) - 45) < 1.5 && r.hpLost < 0.01 && Math.hypot(r.final.x, r.final.y) > 59, JSON.stringify(r));
r = await flyFresh({ dx: 150, dy: -38, vx: -3, age: 12, ticks: 90 });
check('a shot merely PASSING by (aimed 38 cells over her head, never going to touch her) is turned too: it enters the radius, so it leaves', r.turnedAt >= 0 && r.minD > 57.5 && r.final.vx > 0.3, JSON.stringify(r));
r = await flyFresh({ dx: -100, dy: -3, vx: 2.5, ticks: 70 });
check('a shot from the LEFT is turned just the same (the prism turns every way)', r.turnedAt >= 0 && r.minD > 57.5 && r.final.vx < -0.5 && r.hpLost < 0.01, JSON.stringify(r));
r = await flyFresh({ dx: 61, dy: -58, vx: -3, ticks: 40 });
check('a grazing shot across the top of the ring is bent out, not left to skim the glass', r.turnedAt >= 0 && r.final.y < -57, JSON.stringify(r));
r = await flyFresh({ dx: 150, dy: 0, vx: -2.5, vy: 0, type: 'frostbolt', ticks: 80 });
check('frostbolts (every hostile kind) are turned too', r.turnedAt >= 0 && r.minD > 57.5 && r.hpLost < 0.01, JSON.stringify(r));
r = await flyFresh({ dx: 100, dy: -3, vx: -3, type: 'bolt', hostile: false, ticks: 25 });
check('her OWN shots are not touched (a friendly bolt flies straight through the radius at the same velocity)', r.turnedAt < 0 && r.vxs.every((x) => Math.abs(x + 3) < 1e-6), JSON.stringify({ turnedAt: r.turnedAt, vxs: r.vxs.slice(0, 5) }));
r = await flyFresh({ dx: 20, dy: -3, vx: -2.5, ticks: 60 });
check('a shot already INSIDE when the prism rises (a mage next door) turns at once and leaves', r.turnedAt >= 0 && r.turnedAt <= 1 && r.final.vx > 0.3 && r.hpLost < 0.01, JSON.stringify(r));
await shot(page, 'edda-9-refracted');
await zoomTo(3);
await page.evaluate((pr) => {
  const f = window.__fp, c = f.ctx;
  c.projectiles.length = 0;
  c.projectiles.push({ x: pr.x + 66, y: pr.cy - 8, vx: -2.5, vy: 0, type: 'fireball', life: 400, age: 4, charging: false, hostile: true });
  c.projectiles.push({ x: pr.x - 66, y: pr.cy + 6, vx: 2.5, vy: -0.2, type: 'fireball', life: 400, age: 4, charging: false, hostile: true });
}, prism);
await tick(page, 4);
await shot(page, 'edda-10-refraction-moment');
await tick(page, 10);
await shot(page, 'edda-11-refraction-after');
await zoomTo(3.2);
await page.evaluate(() => { window.__fp.ctx.projectiles.length = 0; });

// the foes' own aim: a real mage's real shots through the AI would be the best proof; the harness has no mage level, so the shots above are hand-fired at the real Projectiles loop.

// the end of it
await zoomTo(3.2);
await raiseWindow();
await page.evaluate(() => { window.__fp.ctx.player.hp = 100; });
await zoomTo(4); // (the camera eases over 40 ticks, which the window spends too)
ws = await kitState();
const remaining = ws.win.remaining;
await tick(page, remaining - 80);
ws = await kitState();
check('with 80 ticks to go the glass is dimming (glow < 1) and not yet cracked', ws.win.glow < 1 && ws.win.crack === 0 && ws.win.state === 'live', JSON.stringify(ws.win));
await shot(page, 'edda-12-window-dimming');
await tick(page, 68);
ws = await kitState();
check('with 12 to go it is cracked and dim', ws.win.crack > 0.5 && ws.win.glow < 0.6, JSON.stringify(ws.win));
await shot(page, 'edda-13-window-cracked');
const endMark = await sfxMark(), endSparks = await sparksMark();
await tick(page, 10);
ws = await kitState();
check('...with 2 to go it still stands', ws.win && ws.win.state === 'live', JSON.stringify(ws.win));
await tick(page, 1);
ws = await kitState();
const endSounds = await sfxSince(endMark);
check('at the end it SHATTERS: a glass cue, a burst of coloured glass, and the pieces are falling', ws.win?.state === 'breaking' && endSounds.includes('flask.shatter') && (await sparksSince(endSparks)).some((s) => s.count === 70), JSON.stringify({ win: ws.win, endSounds }));
check('the chip is idle (the ultimate is over) and the drawable is still on screen while the pieces fall', (await view(page)).ultimate.active === 0 && (await drawables()) === 1);
await tick(page, 8);
await shot(page, 'edda-14-window-shattering');
await tick(page, 14);
await shot(page, 'edda-15-window-pieces');
await page.evaluate(() => { window.__fp.ctx.player.hp = 50; });
await tick(page, 60);
check('after it breaks the heal is over (hp stays 50 for a second)', (await me(page)).hp === 50 && (await drawables()) === 0, JSON.stringify({ hp: (await me(page)).hp, d: await drawables() }));
check('...the window and its light are gone (the level has the lights it had before)', (await lightCount()) === lightBase, `${lightBase} -> ${await lightCount()}`);
r = await fly({ dx: 50, dy: -3, vx: -2.5, ticks: 60 });
check('...and a hostile shot is no longer turned: it reaches her (and hurts)', r.turnedAt < 0 && r.hpLost > 3, JSON.stringify(r));
await zoomTo(3.2);

// a reset in the middle
await clean();
await page.evaluate(() => { window.__fp.ctx.fighters.refill(); });
await aimAt(page, 520, FLOOR - 10); await tick(page, 2);
const lightsBefore = await lightCount();
await press(page, 'KeyT', 1);
await tick(page, 60);
const mid = (await kitState()).win;
await page.evaluate(() => window.__fp.ctx.fighters.reset());
await tick(page, 2);
check('a reset in the middle (a death, a new floor) takes the window away at once: no drawable, no light, no heal', (await drawables()) === 0 && (await lightCount()) === lightsBefore && (await kitState()).win === null, JSON.stringify({ d: await drawables(), lights: [lightsBefore, await lightCount()] }));
r = await fly({ dx: 100, dy: -3, vx: -2.5, ticks: 70 }, mid);
check('...and a hostile shot through where it stood is no longer turned', r.turnedAt < 0 && r.hpLost > 3, JSON.stringify(r));

// Nothing in the grid: the kit writes no cell at all.
await clean();
/** Every solid and powder in the arena (liquids, gases and fire come and go on their own; only what could seal a route counts). */
const census = () => page.evaluate(async () => {
  const { isGas, isLiquid } = await import('/src/sim/CellType.ts');
  const { ctx, Cell } = window.__fp, w = ctx.world, out = {};
  for (let y = 560; y <= 700; y++) for (let x = 380; x <= 620; x++) { const t = w.types[w.idx(x, y)]; if (t && t !== Cell.Fire && !isGas(t) && !isLiquid(t)) out[t] = (out[t] ?? 0) + 1; }
  return out;
});
await tick(page, 150); // let a previous test's fires and ash burn out
await page.evaluate(() => { const c = window.__fp.ctx; c.particles.clear(); });
const before = await census();
await page.evaluate(() => { window.__fp.ctx.fighters.refill(); });
await aimAt(page, 520, FLOOR - 10);
await press(page, 'KeyZ', 1);
await tick(page, 5);
await press(page, 'KeyT', 1);
await fillFlask(400);
await drinkFor(10);
await tick(page, 700);
const after = await census();
check('across a shard, a window (to its shattering), and a drink the arena\'s cells are exactly as they were (the kit writes no cell: nothing can seal a route)', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));

const blockers = await keyBlockers();
check('no overlay took the keyboard during the run (no tome modal)', blockers.overlays.length === 0, JSON.stringify(blockers));
const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nedda-morrow probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);
