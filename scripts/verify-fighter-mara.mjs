// Mara Quell (the Bell Witch) against the REAL engine: docs/FIGHTERS.md "04 Mara Quell", docs/fighters/mara-quell.md.
//   Keen Resonance  foes that walk / climb / land within 200 cells and out of her sight leave a violet ripple at
//                   their feet every 14 ticks (the drawable is run against a recording surface: the pixels it
//                   WOULD draw are the evidence), nearer brighter, a foe in plain sight leaves none.
//   Resonance Bell  Z hangs a bell on the open spot nearest the aim (<= 70 cells); two at most; it rings when a
//                   waking foe is within 70 cells, revealing every foe within 100 for 4 s; deaf for 6 s; lives
//                   30 s; falls when its terrain is dug away; is never saved and is cleared with the fighter.
//   Dead Chime      T sends a 150-cell wave over ~20 ticks: foes it reaches are slowed x0.45 for 6 s, casters
//                   stunned 3 s, hostile shots removed; a foe at 100 is slowed and one at 200 is not; nothing
//                   that could block progression (mechanisms, bosses, eggs) is touched.
// REAL Z / T key presses, paused deterministic ticks (scripts/fighter-probe.mjs). Screenshots go to
// verify-out/fighters/mara-*.png. Usage: node scripts/verify-fighter-mara.mjs [url]
import { mkdirSync, writeFileSync } from 'node:fs';
import { aimAt, boot, makeChecker, me, press, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const tally = makeChecker();
const check = tally.check;
const section = (name) => console.log(`\n== ${name}`);
const note = (text) => console.log('  note  ' + text);
const { page, finish } = await boot(url, { fighter: 'mara-quell', hp: 5000 });

// ----------------------------------------------------------------------------------------------- harness
await page.evaluate(() => {
  const ctx = window.__fp.ctx;
  const sfx = [];
  const orig = ctx.audio.sfx.bind(ctx.audio);
  ctx.audio.sfx = (id, x, y, o) => { sfx.push({ id, x, y, o, f: ctx.state.frameCount }); return orig(id, x, y, o); };
  window.__sfx = sfx;
  const dr = (tag) => ctx.fighters.drawables.find((d) => d.tag === tag);
  const recorder = (step = 0.5) => {
    const px = [];
    const put = (x, y, r, g, b) => { px.push([x, y, r, g, b]); };
    return { px, out: { pixelStep: step, addFinePx: put, addPx: put, setFinePx: put, setPx: put } };
  };
  const pin = [];
  window.__foes = [];
  const baseTick = window.__fp.tick;
  // Every tick the probe takes holds the pinned foes where they were put (a foe at a KNOWN distance).
  window.__fp.tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const p of pin) { p.e.x = p.x; p.e.y = p.y; p.e.vx = 0; p.e.vy = 0; p.e.fx = 0; p.e.fy = 0; }
      baseTick(1);
    }
  };
  window.__m = {
    dr,
    pin,
    draw: (tag, step) => { const d = dr(tag); if (!d) return null; const s = recorder(step); d.draw(s.out, { sample: () => ({ r: 1, g: 1, b: 1 }) }, ctx); return s.px; },
    state: (tag) => dr(tag)?.state ?? null,
    reset: () => {
      pin.length = 0;
      window.__foes = [];
      ctx.enemies.length = 0;
      ctx.projectiles.length = 0;
      ctx.fighters.reset();
      sfx.length = 0;
      const f = window.__fp, w = ctx.world, A = f.ARENA;
      for (let y = A.top - 10; y <= A.floorY - 1; y++) for (let x = A.x0 - 10; x <= A.x1 + 10; x++) if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
      for (let y = A.floorY; y <= A.floorY + 6; y++) for (let x = A.x0 - 10; x <= A.x1 + 10; x++) if (w.inBounds(x, y) && w.types[w.idx(x, y)] === 0) w.replaceCellAt(w.idx(x, y), f.Cell.Stone, 0x707078);
      const p = ctx.player;
      Object.assign(p, { dead: false, hp: 5000, maxHp: 5000, invuln: 0, crawling: false, x: A.spawnX, y: A.floorY - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, facing: 1 });
      p.aimAngle = 0;
      window.__fp.tick(1); // so the kit has put its drawables back before anything reads them
      sfx.length = 0;
    },
  };
});
const evalM = (fn, arg) => page.evaluate(fn, arg);
const reset = () => evalM(() => window.__m.reset());
const sfxLog = () => evalM(() => window.__sfx.slice());
// Foes held at known distances should not also hunt her (a bomber fusing, a mage throwing): she is unseen for the scenario.
const hide = () => evalM(() => window.__fp.ctx.fighters.setMod('probe-hidden', 1e7, { concealment: 0.95 }));
const clearSfx = () => evalM(() => { window.__sfx.length = 0; });
const nowF = () => evalM(() => window.__fp.ctx.state.frameCount);
// Foes are held by reference (a bomber may blow itself up, an egg clutch may hatch: indexes would shift under us).
const spawnFoe = (kind, dx, opts = {}) => evalM(({ kind, dx, opts }) => {
  const e = window.__fp.spawn(kind, dx, opts);
  return window.__foes.push(e) - 1;
}, { kind, dx, opts });
const foeInfo = (i) => evalM((i) => {
  const e = window.__foes[i];
  const f = window.__fp.ctx.fighters;
  if (!e || !window.__fp.ctx.enemies.includes(e)) return null;
  return { x: e.x, y: e.y, hp: e.hp, knockT: e.knockT ?? 0, slow: f.enemySlow(e), revealed: f.isRevealed(e), sleeping: e.sleeping === true };
}, i);
const pinFoe = (i, x, y) => evalM(({ i, x, y }) => { const e = window.__foes[i]; window.__m.pin.push({ e, x: x ?? e.x, y: y ?? e.y }); }, { i, x, y });
const foeDo = (i, fn) => evalM(({ i, src }) => { const e = window.__foes[i]; return new Function('e', 'ctx', src)(e, window.__fp.ctx); }, { i, src: fn });
const ripState = () => evalM(() => {
  const s = window.__m.state('mara.ripples');
  return s ? { births: s.births, list: s.list.map((r) => ({ x: r.x, y: r.y, born: r.born, power: r.power, big: r.big })) } : { births: 0, list: [] };
});
const bellList = () => evalM(() => {
  const s = window.__m.state('mara.bells');
  return s ? s.bells.map((b) => ({ id: b.id, mode: b.mode, x: b.x, y: b.y, cx: b.cx, cy: b.cy, top: b.top, side: b.side, born: b.born, expires: b.expires, rungAt: b.rungAt, retiredAt: b.retiredAt })) : [];
});
const bellCount = () => evalM(() => window.__m.state('mara.bells')?.count() ?? 0);

/** A zoomed look at a patch of the real frame (the harness pauses the world, so the frame is held). */
async function shotAt(name, wx, wy, hw = 90, hh = 55, zoom = 4) {
  mkdirSync('verify-out/fighters', { recursive: true });
  const c = await evalM(() => ({ x: window.__fp.ctx.camera.renderX ?? window.__fp.ctx.camera.x, y: window.__fp.ctx.camera.renderY ?? window.__fp.ctx.camera.y }));
  const S = 1400 / 640;
  const clip = { x: Math.max(0, (wx - hw - c.x) * S), y: Math.max(0, 36 + (wy - hh - c.y) * S), width: Math.min(1400, hw * 2 * S), height: hh * 2 * S };
  const path = `verify-out/fighters/${name}.png`;
  const buf = await page.screenshot({ clip });
  const b64 = await evalM(async ({ b64, z }) => {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
    const cv = document.createElement('canvas'); cv.width = img.width * z; cv.height = img.height * z;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png').split(',')[1];
  }, { b64: buf.toString('base64'), z: zoom });
  writeFileSync(path, Buffer.from(b64, 'base64'));
  return path;
}
async function shotFull(name) {
  mkdirSync('verify-out/fighters', { recursive: true });
  await page.screenshot({ path: `verify-out/fighters/${name}.png` });
}

// ============================================================================================ KEEN RESONANCE
section('Keen Resonance');
await reset();
await evalM(() => { window.__fp.wall(500, 600, 504, 689); });
const g1 = await spawnFoe('golem', 90);
await foeDo(g1, 'e.patrol = [[e.x - 25, e.y], [e.x + 25, e.y]]; e.patrolIdx = 0;');
await tick(page, 20); // lets it settle onto its beat
const b0 = (await ripState()).births;
await tick(page, 70);
let st = await ripState();
const made = st.births - b0;
check('a walking foe behind rock leaves a ripple about every 14 ticks (70 ticks: 4-6)', made >= 4 && made <= 6, `made ${made}`);
note(`${made} ripples in 70 ticks`);
const g1x = await foeInfo(g1);
check('the ripples are at its feet (on the floor, along its beat)', st.list.length > 0 && st.list.every((r) => r.y === 689 && r.x >= g1x.x - 32 && r.x <= g1x.x + 32), JSON.stringify(st.list.slice(0, 2)));
const gaps = st.list.slice(1).map((r, i) => r.born - st.list[i].born);
check('...spaced 14 ticks apart', gaps.length >= 2 && gaps.every((d) => d >= 13 && d <= 16), JSON.stringify(gaps));
let px = await evalM(() => window.__m.draw('mara.ripples'));
check('the drawable puts violet pixels on the frame, through the rock', px && px.length > 200, `px ${px?.length}`);
if (px && px.length) {
  const peak = px.reduce((m, p) => (p[2] + p[3] + p[4] > m[2] + m[3] + m[4] ? p : m), px[0]);
  check('...violet: blue strongest, red above green', peak[4] > peak[2] && peak[2] > peak[3], JSON.stringify(peak));
  const xs = px.map((p) => p[0]), ys = px.map((p) => p[1]);
  check('...all around the foe\'s feet (the floor row, within its beat)', Math.min(...ys) >= 689 - 8 && Math.max(...ys) <= 689 + 8 && Math.min(...xs) >= g1x.x - 55 && Math.max(...xs) <= g1x.x + 55);
}
check('purely deterministic: the same frame draws the same pixels twice', JSON.stringify(await evalM(() => window.__m.draw('mara.ripples'))) === JSON.stringify(px));
const pings = (await sfxLog()).filter((s) => s.id === 'pickup.bell' && s.o?.pitch === 14);
check('one faint ping when the stranger first starts to move (quiet)', pings.length === 1 && pings[0].o.gain < 0.3, JSON.stringify(pings.map((p) => p.o)));
await shotFull('mara-ripples-full');
await shotAt('mara-ripples', g1x.x, 689 - 22, 70, 40);

// a foe in plain sight leaves nothing: remove the wall, count births
await evalM(() => { window.__fp.carve(500, 600, 504, 689); });
await tick(page, 4);
const b1 = (await ripState()).births;
await tick(page, 70);
const b2 = (await ripState()).births;
check('no wall: a foe she can SEE leaves no ripple (nothing to feel)', b2 === b1, `births ${b1} -> ${b2}`);

// range: 200 cells (the player moves left so one foe is at ~165 and one at ~215)
await reset();
await evalM(() => { const f = window.__fp; f.wall(500, 600, 504, 689); Object.assign(f.ctx.player, { x: 395 }); });
const near = await spawnFoe('golem', 165);
const far = await spawnFoe('golem', 215);
for (const i of [near, far]) await foeDo(i, 'e.patrol = [[e.x - 10, e.y], [e.x + 10, e.y]]; e.patrolIdx = 0;');
await tick(page, 100);
st = await ripState();
const nearX = (await foeInfo(near)).x, farX = (await foeInfo(far)).x;
check('within 200 cells it is felt (the foe at 165)', st.births > 0 && st.list.some((r) => Math.abs(r.x - nearX) < 20), JSON.stringify(st.list.slice(0, 3)));
check('beyond 200 cells it is not (the foe at 215 leaves none)', !st.list.some((r) => Math.abs(r.x - farX) < 20) && st.births > 0, `far x ${farX}`);

// nearer = brighter, and a landing is a ripple of its own (two foes dropped at the same moment)
await reset();
await evalM(() => { const f = window.__fp; f.wall(500, 600, 504, 689); Object.assign(f.ctx.player, { x: 395 }); });
const dn = await spawnFoe('golem', 125, { y: 656 });
const df = await spawnFoe('golem', 195, { y: 656 });
await tick(page, 2);
let landed = null;
for (let i = 0; i < 40 && !landed; i++) {
  await tick(page, 1);
  const s = (await ripState()).list.filter((r) => r.big);
  if (s.length >= 2) landed = s;
}
check('a foe that lands behind rock leaves a (wider) ripple', landed !== null && landed.length >= 2, JSON.stringify(landed));
if (landed) {
  const nx = (await foeInfo(dn)).x, fx = (await foeInfo(df)).x;
  const rn = landed.find((r) => Math.abs(r.x - nx) < 8), rf = landed.find((r) => Math.abs(r.x - fx) < 8);
  check('nearer is brighter: the foe at 125 has more power than the one at 195', rn && rf && rn.power > rf.power + 0.1, `${rn?.power} vs ${rf?.power}`);
  px = await evalM(() => window.__m.draw('mara.ripples'));
  const peakNear = Math.max(...px.filter((p) => Math.abs(p[0] - nx) < 24).map((p) => p[2] + p[3] + p[4]));
  const peakFar = Math.max(...px.filter((p) => Math.abs(p[0] - fx) < 24).map((p) => p[2] + p[3] + p[4]));
  check('...and it is DRAWN brighter (peak pixel)', peakNear > peakFar * 1.15, `${peakNear.toFixed(2)} vs ${peakFar.toFixed(2)}`);
  note(`landing ripples: power ${rn.power.toFixed(2)} (125 cells) vs ${rf.power.toFixed(2)} (195 cells); peak drawn pixel ${peakNear.toFixed(2)} vs ${peakFar.toFixed(2)}`);
}

// fliers and foes standing still make none
await reset();
await evalM(() => { window.__fp.wall(500, 600, 504, 689); });
const fl0 = (await ripState()).births;
await spawnFoe('bat', 120, { y: 640 });
await spawnFoe('wisp', 140, { y: 640 });
await tick(page, 80);
check('fliers (a bat, a wisp) walk nowhere: no ripples', (await ripState()).births === fl0, `births ${fl0} -> ${(await ripState()).births}`);
await reset();
await evalM(() => { window.__fp.wall(500, 600, 504, 689); });
const st0 = (await ripState()).births;
const still = await spawnFoe('golem', 90);
await pinFoe(still);
await tick(page, 80);
check('a foe that stands still makes none', (await ripState()).births === st0, `births ${st0} -> ${(await ripState()).births}`);

// ================================================================================================ RESONANCE BELL
section('Resonance Bell');
await reset();
await aimAt(page, 480, 689);
await tick(page, 2);
check('before Z: no bell, the meter reads 0 of 2', (await view(page)).meter?.value === 0 && (await view(page)).meter?.max === 2);
await clearSfx();
await press(page, 'KeyZ', 1);
await tick(page, 1);
const bs1 = await bellList();
check('Z hangs one bell', bs1.length === 1, JSON.stringify([bs1, await view(page), await me(page), await sfxLog()]).slice(0, 900));
const bell1 = bs1[0];
check('...on the open spot nearest the aim (a post on the floor, the bell at the aim\'s column)', bell1 && bell1.mode === 'post' && Math.abs(bell1.cx - 480) <= 3 && bell1.y === 689, JSON.stringify(bell1));
check('...standing on real stone (the cell under its foot is solid)', await evalM((b) => window.__fp.ctx.world.types[window.__fp.ctx.world.idx(b.x, b.y + 1)] === window.__fp.Cell.Stone, bell1));
check('...within 70 cells of her', bell1 && Math.hypot(bell1.cx - 440, bell1.cy - 680) <= 70);
let v = await view(page);
check('the cooldown is 14 s and the chip shows it', v.tactical.cooldownSeconds === 14 && v.tactical.ready === false, JSON.stringify(v.tactical));
check('the meter shows 1 bell out', v.meter.value === 1);
const placeSfx = (await sfxLog()).filter((s) => ['mech.latch', 'pickup.bell'].includes(s.id) && Math.abs(s.x - bell1.cx) < 2);
check('a bracket latches and a small bell sounds, at the bell', placeSfx.some((s) => s.id === 'mech.latch') && placeSfx.some((s) => s.id === 'pickup.bell'), JSON.stringify(placeSfx.map((s) => s.id)));
check('the bell is drawn (brass and iron pixels)', (await evalM(() => window.__m.draw('mara.bells')?.length ?? 0)) > 150);
await tick(page, 30);
await shotAt('mara-bell-placed', bell1.cx - 3, bell1.y - 12, 55, 32);

// refused while cooling
const refBefore = (await view(page)).tactical.refusedAt;
await press(page, 'KeyZ', 1);
await tick(page, 2);
v = await view(page);
check('Z while cooling is refused (chip flourish), no second bell', v.tactical.refusedAt > refBefore && (await bellCount()) === 1);

// the cooldown really runs out in 14 s (840 ticks after the press)
const usedAt = (await view(page)).tactical.usedAt;
await tick(page, usedAt + 838 - (await nowF()));
check('just under 14 s on, the tactical is still cooling', (await view(page)).tactical.ready === false);
await tick(page, 4);
check('14 s after the press it is ready again', (await view(page)).tactical.ready === true);

// two at most: the third retires the oldest
await aimAt(page, 500, 689);
await press(page, 'KeyZ', 1);
await tick(page, 1);
check('a second bell hangs (two out)', (await bellCount()) === 2 && (await view(page)).meter.value === 2);
await evalM(() => window.__fp.ctx.fighters.refill());
await aimAt(page, 470, 689);
await clearSfx();
await press(page, 'KeyZ', 1);
await tick(page, 1);
const bs3 = await bellList();
check('the third retires the OLDEST (two stand, the first is on its way out)', bs3.filter((b) => b.retiredAt < 0).length === 2 && bs3.find((b) => b.id === bell1.id)?.retiredAt >= 0, JSON.stringify(bs3.map((b) => [b.id, b.retiredAt])));
check('...with a low note as it is let go', (await sfxLog()).some((s) => s.id === 'pickup.bell' && s.o?.pitch === -7));
await tick(page, 40);
check('...and it is gone once it has faded (the meter still 2)', (await bellList()).length === 2 && (await view(page)).meter.value === 2);

// reach: a far cursor is held to 70 cells
await reset();
await aimAt(page, 900, 689);
await press(page, 'KeyZ', 1);
await tick(page, 1);
const far70 = await bellList();
check('aiming far away hangs the bell within 70 cells of her', far70.length === 1 && Math.hypot(far70[0].cx - 440, far70[0].cy - 680) <= 70.01, JSON.stringify(far70));

// the ring: foes at known distances (pinned), a bell with a known centre
await reset();
await hide();
await aimAt(page, 470, 689);
await press(page, 'KeyZ', 1);
await tick(page, 30);
const B = (await bellList())[0];
const mk = async (kind, dx, extra = {}) => { const i = await spawnFoe(kind, 0, { y: 689, ...extra }); await foeDo(i, 'e.x = ' + Math.round(B.cx + dx) + ';'); await pinFoe(i); return i; };
const f90 = await mk('slime', 90), f120 = await mk('slime', 120), fs80 = await mk('slime', -80);
await foeDo(fs80, 'e.sleeping = true;');
await tick(page, 40);
check('nothing within 70 cells (a foe at 90, one at 120, a sleeper at 80): it does not ring', (await bellList())[0].rungAt < 0, `rungAt ${(await bellList())[0].rungAt}`);
const f60 = await mk('slime', 60);
await clearSfx();
const lightsBefore = await evalM(() => window.__fp.ctx.levels.current.authoredLights.length);
await tick(page, 2);
const rung1 = (await bellList())[0].rungAt;
check('a waking foe within 70 cells rings it', rung1 > 0, `rungAt ${rung1}`);
const revs = await Promise.all([f60, f90, f120, fs80].map(foeInfo));
check('every foe within 100 cells is revealed (the ones at 60, 90, and the sleeper at 80)', revs[0].revealed && revs[1].revealed && revs[3].revealed, JSON.stringify(revs.map((r) => r.revealed)));
check('...the one at 120 is not', revs[2].revealed === false);
const ringSfx = (await sfxLog()).filter((s) => s.id === 'pickup.bell' && Math.abs(s.x - B.cx) < 2 && s.o?.gain >= 0.9);
check('the bell rings at its own position (pickup.bell)', ringSfx.length >= 1, JSON.stringify(ringSfx));
check('...with the gong under it (world.gong)', (await sfxLog()).some((s) => s.id === 'world.gong' && Math.abs(s.x - B.cx) < 2));
check('...and a ring of light is set (an authored light added)', (await evalM(() => window.__fp.ctx.levels.current.authoredLights.length)) > lightsBefore);
const ringPx = await evalM(() => window.__m.draw('mara.rings'));
check('the ring pulse is drawn', ringPx && ringPx.length > 40, `px ${ringPx?.length}`);
await tick(page, 6);
await shotFull('mara-bell-ring-full');
await shotAt('mara-bell-ring', B.cx, B.cy - 5, 130, 70, 3);
// the reveal is 4 s
await tick(page, 200);
check('the reveal lasts 4 s: still shown at 3.5 s', (await foeInfo(f60)).revealed === true);
await tick(page, 45);
check('...gone just after 4 s', (await foeInfo(f60)).revealed === false);
check('the ring of light is gone again (nothing left in the level)', (await evalM(() => window.__fp.ctx.levels.current.authoredLights.length)) === lightsBefore);
// deaf for 6 s
const rung1b = (await bellList())[0].rungAt;
await tick(page, 100);
check('deaf after ringing: the foe still at 60 does not ring it again for 6 s', (await bellList())[0].rungAt === rung1b);
await tick(page, 11);
const rung2 = (await bellList())[0].rungAt;
check('it listens again after 6 s (rings a second time, 360 ticks after the first)', rung2 - rung1b >= 358 && rung2 - rung1b <= 364, `gap ${rung2 - rung1b}`);

// a bell lives 30 s
await reset();
await aimAt(page, 470, 689);
await press(page, 'KeyZ', 1);
await tick(page, 1);
const born = (await bellList())[0].born;
await tick(page, born + 1790 - (await nowF()));
check('at 29.8 s the bell still hangs', (await bellCount()) === 1);
await clearSfx();
await tick(page, 14);
check('past 30 s it is let go (a low note) and fades', (await bellCount()) === 0 && (await sfxLog()).some((s) => s.id === 'pickup.bell' && s.o?.pitch === -7));
await tick(page, 40);
check('...and nothing of it is left (no bell, no drawable)', (await bellList()).length === 0 && (await evalM(() => window.__m.dr('mara.bells') === undefined)));

// a bell hangs from real terrain: dig the floor out from under it
await reset();
await aimAt(page, 470, 689);
await press(page, 'KeyZ', 1);
await tick(page, 2);
const bb = (await bellList())[0];
await evalM((b) => { window.__fp.carve(b.x - 1, b.y + 1, b.x + 1, b.y + 3); }, bb);
await clearSfx();
await tick(page, 12);
check('dig the floor from under the post and the bell comes down (clatter)', (await bellCount()) === 0 && (await sfxLog()).some((s) => s.id === 'body.impact.metal'));

// hung from a ceiling: aim into a slab
await reset();
await evalM(() => { window.__fp.wall(430, 640, 540, 645); });
await aimAt(page, 480, 652);
await press(page, 'KeyZ', 1);
await tick(page, 30);
const hb = (await bellList())[0];
check('aimed at a ceiling it hangs from it on a chain', hb && hb.mode === 'hang' && hb.y === 646 && Math.abs(hb.cx - 480) <= 4, JSON.stringify(hb));
await shotAt('mara-bell-hung', hb?.cx ?? 480, 660, 40, 30);

// never saved, cleared with the fighter
const snap = await evalM(() => JSON.stringify(window.__fp.ctx.fighters.snapshot()));
check('a bell is never written into the run save (the kit saves nothing of it)', !/bell/i.test(snap) && Object.keys(JSON.parse(snap).kit).length === 0, snap);

// no room: sealed in a crawl pocket 9 high
await reset();
await evalM(() => {
  const f = window.__fp;
  f.wall(395, 600, 485, 680);
  f.wall(394, 600, 394, 689);
  f.wall(486, 600, 486, 689);
  Object.assign(f.ctx.player, { x: 440, y: 689, crawling: true });
});
await aimAt(page, 470, 685);
const rf0 = (await view(page)).tactical.refusedAt;
await clearSfx();
await press(page, 'KeyZ', 1);
await tick(page, 2);
v = await view(page);
check('no room (a sealed crawl pocket): Z is refused', v.tactical.refusedAt > rf0 && (await bellCount()) === 0);
check('...nothing is spent: the tactical is still ready', v.tactical.ready === true && v.tactical.cooldownSeconds === 0);
check('...and a dull fizzle tells her so', (await sfxLog()).some((s) => s.id === 'tk.fizzle'));

// ================================================================================================== DEAD CHIME
section('Dead Chime');
await reset();
await hide();
await evalM(() => { Object.assign(window.__fp.ctx.player, { x: 385 }); });
await tick(page, 2);
const rfu = (await view(page)).ultimate.refusedAt;
await press(page, 'KeyT', 1);
await tick(page, 2);
check('T with the bar not full is refused (chip flourish, nothing cast)', (await view(page)).ultimate.refusedAt > rfu && (await evalM(() => window.__m.state('mara.chime') === null)));

// foes at known distances along the floor (the player at x 385; distances are from her chest)
async function mk2(kind, dx, extra = {}) { const i = await spawnFoe(kind, dx, extra); await pinFoe(i); return i; }
const foes = {};
foes.g60 = await mk2('golem', 60);
foes.s100 = await mk2('slime', 100);
foes.b80 = await mk2('bomber', 80);
foes.sp120 = await mk2('spitter', 120);
foes.m140 = await mk2('mage', 140);
foes.g165 = await mk2('golem', 165);
foes.g200 = await mk2('golem', 200);
foes.w30 = await mk2('wisp', 30, { y: 660 });
const names = Object.keys(foes);
const allFoes = async () => Object.fromEntries(await Promise.all(names.map(async (n) => [n, await foeInfo(foes[n])])));
const mechOf = () => evalM(() => JSON.stringify(window.__fp.ctx.levels.current.mechanisms.map((m) => ({ id: m.id, kind: m.kind, state: m.state, pressed: m.pressed ?? null, open: m.open ?? null }))));
const mechBefore = await mechOf();
await evalM(() => {
  const c = window.__fp.ctx, p = c.player;
  // High above the foes (a hovering fireball would set them alight): at 35 degrees up from her chest, d cells away.
  const shot = (d, hostile = true) => c.projectiles.push({ x: p.x + d * Math.cos(0.61), y: p.y - 9 - d * Math.sin(0.61), vx: 0, vy: 0, type: hostile ? 'fireball' : 'bomb', life: 9999, age: 0, charging: false, hostile });
  for (const d of [40, 105, 145, 175]) shot(d);
  c.projectiles.push({ x: p.x + 20, y: 560, vx: 0, vy: 0, type: 'bomb', life: 9999, age: 0, charging: false, hostile: false }); // a friendly shot well above everything
  c.fighters.refill();
});
const hostileLeft = () => evalM(() => window.__fp.ctx.projectiles.filter((q) => q.hostile).map((q) => Math.round(Math.hypot(q.x - 385, q.y - 680) / 5) * 5).sort((a, b) => a - b));
check('(setup) four hostile shots out, at 40, 105, 145 and 175 cells', (await hostileLeft()).length === 4);
await tick(page, 1);
check('the bar is full: Dead Chime is ready', (await view(page)).ultimate.ready === true);
await clearSfx();
await press(page, 'KeyT', 1);
const castF = await evalM(() => window.__m.state('mara.chime').wave.born); // the frame the wave was born on
const toOffset = async (n) => { const d = castF + n - (await nowF()); if (d > 0) await tick(page, d); };
v = await view(page);
check('T casts it: the bar is spent and the chip shows the effect running', v.ultimate.charge === 0 && v.ultimate.active > 0.9 && v.ultimate.ready === false, JSON.stringify(v.ultimate));
let cur = await allFoes();
check('the wave starts at her chest: after one tick it has reached nothing yet', names.every((n) => cur[n].slow === 1) && (await hostileLeft()).length === 4);
const chimeSfx = await sfxLog();
check('a gong and a bell sound at her', chimeSfx.some((s) => s.id === 'world.gong') && chimeSfx.some((s) => s.id === 'pickup.bell'));
await shotFull('mara-chime-wave-start');

const shoulder = { x: 385, y: 680 };
const radiusOf = (pxs) => { // the radius carrying the most light
  const bins = new Map();
  for (const p of pxs) { const r = Math.round(Math.hypot(p[0] - shoulder.x, p[1] - shoulder.y)); bins.set(r, (bins.get(r) ?? 0) + p[2] + p[3] + p[4]); }
  let best = 0, bv = -1;
  for (const [r, s] of bins) if (s > bv) { bv = s; best = r; }
  return best;
};
const expectR = (elapsed) => 150 * (1 - Math.pow(1 - Math.min(1, (elapsed + 1) / 20), 1.7));
await toOffset(5);
cur = await allFoes();
check('tick 5 (wave at ~' + expectR(5).toFixed(0) + '): the golem at 60 is slowed, the foe at 100 is not yet', cur.g60.slow === 0.45 && cur.s100.slow === 1, JSON.stringify([cur.g60.slow, cur.s100.slow]));
check('...the shot at 40 is gone, the ones at 105, 145 and 175 are not', JSON.stringify(await hostileLeft()) === JSON.stringify([105, 145, 175]), JSON.stringify(await hostileLeft()));
const px5 = await evalM(() => window.__m.draw('mara.chime', 0.5));
const r5 = radiusOf(px5.filter((p) => Math.hypot(p[0] - shoulder.x, p[1] - shoulder.y) > 12));
check('the ring is DRAWN at the wave\'s radius (tick 5: ' + expectR(5).toFixed(0) + ' cells)', Math.abs(r5 - expectR(5)) <= 4, `drawn ${r5}`);
note(`ring drawn at ${r5} cells at tick 5 (the wave: ${expectR(5).toFixed(1)})`);
await shotFull('mara-chime-wave-early');
await toOffset(10);
cur = await allFoes();
check('tick 10 (wave at ~' + expectR(10).toFixed(0) + '): the foe at 100 is slowed x0.45, so is the bomber at 80', cur.s100.slow === 0.45 && cur.b80.slow === 0.45, JSON.stringify([cur.s100.slow, cur.b80.slow]));
check('...the foe at 140 is not yet', cur.m140.slow === 1 && cur.sp120.slow === 1);
check('...the shot at 105 is gone, 145 and 175 remain', JSON.stringify(await hostileLeft()) === JSON.stringify([145, 175]), JSON.stringify(await hostileLeft()));
const px10 = await evalM(() => window.__m.draw('mara.chime', 0.5));
const onRock = await evalM((pxs) => { const w = window.__fp.ctx.world; let n = 0; for (const p of pxs) { const x = Math.floor(p[0]), y = Math.floor(p[1]); if (w.inBounds(x, y) && w.types[w.idx(x, y)] === window.__fp.Cell.Stone) n++; } return n; }, px10);
check('the ring is drawn THROUGH ROCK (pixels land on the stone floor)', onRock > 40, `on stone ${onRock}`);
check('...and it has moved out with the wave (tick 10: ' + expectR(10).toFixed(0) + ')', Math.abs(radiusOf(px10.filter((p) => Math.hypot(p[0] - shoulder.x, p[1] - shoulder.y) > 12)) - expectR(10)) <= 4);
await shotFull('mara-chime-wave-mid');
await toOffset(24);
cur = await allFoes();
check('a foe at 100 cells is slowed x0.45', cur.s100.slow === 0.45);
check('...one at 140 is too (the wave reached it)', cur.m140.slow === 0.45 && cur.sp120.slow === 0.45);
check('...one at 165 is NOT (past its 150)', cur.g165.slow === 1);
check('...and one at 200 is not', cur.g200.slow === 1);
check('casters and machines are stunned (the bomber, the spitter, the mage, the wisp are held)', ['b80', 'sp120', 'm140', 'w30'].every((n) => cur[n].knockT > 0), JSON.stringify(['b80', 'sp120', 'm140', 'w30'].map((n) => cur[n].knockT)));
check('...the others are slowed but not stunned (a golem, a slime)', cur.g60.knockT === 0 && cur.s100.knockT === 0);
const shotsEnd = JSON.stringify([await hostileLeft(), await evalM(() => window.__fp.ctx.projectiles.map((q) => [q.type, q.hostile, Math.round(q.x), Math.round(q.y)]))]);
check('hostile shots in the ring are gone (40, 105, 145); the one at 175 remains, and so does the friendly one', (await hostileLeft()).length === 1 && Math.abs((await hostileLeft())[0] - 175) <= 8 && (await evalM(() => window.__fp.ctx.projectiles.filter((q) => !q.hostile).length)) === 1, shotsEnd);
check('a shot rung out of the air gives a small bell (pickup.bell, high, at the shot)', (await sfxLog()).some((s) => s.id === 'pickup.bell' && s.o?.pitch >= 13 && s.o?.pitch <= 16));
check('no mechanism is touched (every lever, plate and door exactly as it was)', (await mechOf()) === mechBefore);
// (the shots left in the air would fall and burst among the foes the rest of this scenario times: take them out)
await evalM(() => { window.__fp.ctx.projectiles.length = 0; });
const waveInfo = await evalM(() => { const s = window.__m.state('mara.chime'); return { tolled: s.tolled.length }; });
check('the foes it reached carry its mark (a violet toll under each of the six: golem, slime, bomber, spitter, mage, wisp)', waveInfo.tolled === 6, JSON.stringify(waveInfo));
const tollPx = await evalM(() => window.__m.draw('mara.chime', 0.5));
check('...and it is drawn', tollPx.length > 300, `px ${tollPx.length}`);
await shotFull('mara-chime-tolled-full');
await shotAt('mara-chime-tolled', 385 + 100, 689 - 14, 70, 40);
await toOffset(170);
cur = await allFoes();
// (a stun is the knock state re-pinned each tick, so read it over a few ticks: a single read can land between the pin and the foe's own update)
const held = {};
for (let k = 0; k < 4; k++) { const c = await allFoes(); for (const n of ['b80', 'sp120', 'm140']) held[n] = Math.max(held[n] ?? 0, c[n].knockT); await tick(page, 1); }
check('2.8 s on: the casters are still held, the slowed still slowed', ['b80', 'sp120', 'm140'].every((n) => held[n] > 0) && cur.g60.slow === 0.45, JSON.stringify({ held, g60: cur.g60 }));
await toOffset(200);
cur = await allFoes();
check('3.3 s on: the casters are free again (stun 3 s), the slow runs on', ['b80', 'sp120', 'm140', 'w30'].every((n) => cur[n].knockT === 0) && cur.g60.slow === 0.45 && cur.m140.slow === 0.45);
await toOffset(355);
cur = await allFoes();
check('at ~5.9 s the slow is still on', cur.g60?.slow === 0.45 && cur.s100?.slow === 0.45, JSON.stringify([cur.g60, cur.s100]));
await toOffset(378);
cur = await allFoes();
check('a little past 6 s the slow has lapsed on every foe', names.every((n) => cur[n] === null || cur[n].slow === 1), JSON.stringify(names.map((n) => cur[n]?.slow)));
check('the effect is over: the chip is idle and its marks are gone', (await view(page)).ultimate.active === 0 && (await evalM(() => window.__m.dr('mara.chime') === undefined)));
check('...a low note closes it', (await sfxLog()).some((s) => s.id === 'pickup.bell' && s.o?.pitch === -9));

// bosses and an egg clutch: neither slowed nor stunned (what a gate asks of the player is not hers to change)
await reset();
await hide();
await evalM(() => { Object.assign(window.__fp.ctx.player, { x: 385 }); });
const boss = await mk2('colossus', 90);
const eggs = await mk2('eggs', 50);
const ctrl = await mk2('golem', 70);
await evalM(() => window.__fp.ctx.fighters.refill());
await press(page, 'KeyT', 1);
await tick(page, 24);
const bi = await foeInfo(boss), ei = await foeInfo(eggs), ci = await foeInfo(ctrl);
check('(control) a golem in the same ring IS slowed', ci && ci.slow === 0.45, JSON.stringify(ci));
check('a boss in the ring is neither slowed nor stunned (its phases are its own)', bi && bi.slow === 1 && bi.knockT === 0, JSON.stringify(bi));
check('an egg clutch in the ring is left alone too', ei && ei.slow === 1 && ei.knockT === 0, JSON.stringify(ei));

// the slow is a real slow: two identical patrols, one rung and one not
await reset();
await hide();
await evalM(() => { Object.assign(window.__fp.ctx.player, { x: 385 }); window.__fp.wall(480, 600, 484, 689); });
const lane = async (dx) => { const i = await spawnFoe('golem', dx); await foeDo(i, 'e.patrol = [[e.x - 20, e.y], [e.x + 20, e.y]]; e.patrolIdx = 0;'); return i; };
const slowedGolem = await lane(70), freeGolem = await lane(205);
await tick(page, 30);
const travel = async (i, n) => { let d = 0, last = (await foeInfo(i)).x; for (let k = 0; k < n; k++) { await tick(page, 1); const x = (await foeInfo(i)).x; d += Math.abs(x - last); last = x; } return d; };
const before = await travel(slowedGolem, 90);
await evalM(() => window.__fp.ctx.fighters.refill());
await press(page, 'KeyT', 1);
await tick(page, 22);
const dSlow = await travel(slowedGolem, 120), dFree = await travel(freeGolem, 120);
check('a rung golem walks a fraction of the way an unrung one does in the same time', dSlow < dFree * 0.7, `slowed ${dSlow} vs free ${dFree} (it covered ${before} in 90 before)`);
note(`a patrolling golem covered ${dSlow} cells in 120 ticks rung, ${dFree} unrung (ratio ${(dSlow / dFree).toFixed(2)}); ${before} cells in 90 ticks before the cast`);

// ====================================================================================== floor change, death
section('A floor change, a death');
await reset();
await aimAt(page, 480, 689);
await press(page, 'KeyZ', 1);
await tick(page, 30);
check('(a bell hangs)', (await bellCount()) === 1);
const lightsLeft0 = await evalM(() => window.__fp.ctx.levels.current.authoredLights.length);
await evalM(() => window.__fp.ctx.events.emit('levelChanged', { depth: 1, name: 'probe' }));
await tick(page, 1);
check('a floor change clears the bells (and their drawables)', (await bellList()).length === 0 && (await evalM(() => window.__m.dr('mara.bells') === undefined)));
check('...the passive keeps listening on the new floor (its drawable is back)', await evalM(() => window.__m.dr('mara.ripples') !== undefined));
check('...and nothing of hers is left in the level\'s lights', (await evalM(() => window.__fp.ctx.levels.current.authoredLights.length)) <= lightsLeft0);
await evalM(() => { window.__fp.ctx.fighters.refill(); });
await evalM(() => { window.__fp.ctx.events.emit('playerRespawned', undefined); });
await tick(page, 1);
check('a respawn gives a fresh start (bar emptied, tactical ready)', (await view(page)).ultimate.charge < 0.01 && (await view(page)).tactical.ready === true);

// a draw call is cheap (a no-op surface: the wave at full size)
await reset();
await evalM(() => { window.__fp.ctx.fighters.refill(); });
await press(page, 'KeyT', 1);
await tick(page, 14);
const ms = await evalM(() => {
  const ctx = window.__fp.ctx, d = window.__m.dr('mara.chime');
  let n = 0;
  const put = () => { n++; };
  const out = { pixelStep: 0.5, addFinePx: put, addPx: put, setFinePx: put, setPx: put };
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) d.draw(out, { sample: () => ({ r: 1, g: 1, b: 1 }) }, ctx);
  return { per: (performance.now() - t0) / 20, n: n / 20 };
});
check('the wave\'s draw is cheap (' + ms.per.toFixed(2) + ' ms for ' + Math.round(ms.n) + ' fine pixels, no-op surface)', ms.per < 4, JSON.stringify(ms));
note(`wave draw ${ms.per.toFixed(2)} ms, ${Math.round(ms.n)} fine pixels, recording surface`);

// a crawler's ground covered: the slow is TIME (the foe takes its update on 45% of ticks), so a weaver covers ~45% of the ground.
// It is forced to flee along the whole floor so it crawls flat out (deterministic in the AI, but a weaver sometimes spends its first moments settling: a pair that did not get going is retried).
const weaverSpeed = async (cast) => {
  await reset();
  await hide();
  await evalM(() => { Object.assign(window.__fp.ctx.player, { x: 385 }); });
  const w = await spawnFoe('weaver', 15);
  await foeDo(w, 'e.alerted = true; window.__flee = () => { e.fleeT = 999; e.fleeDir = 1; };');
  await evalM(() => window.__fp.ctx.fighters.refill());
  if (cast) { await press(page, 'KeyT', 1); await tick(page, 22); } else await tick(page, 23);
  return evalM(() => { const x0 = window.__foes[0].x; for (let k = 0; k < 60; k++) { window.__flee(); window.__fp.tick(1); } return +(Math.abs(window.__foes[0].x - x0) / 60).toFixed(3); });
};
let wFree = 0, wRung = 0;
for (let attempt = 0; attempt < 4 && !(wFree > 0.8 && wRung > 0.2); attempt++) { wFree = await weaverSpeed(false); wRung = await weaverSpeed(true); }
check('a weaver\'s crawl is slowed too (it covers ~x0.45 of the ground: time, not its locomotion speed)', wFree > 0.8 && wRung <= wFree * 0.6 && wRung >= wFree * 0.3, `free ${wFree}, rung ${wRung}`);
note(`a fleeing weaver crawls at ${wFree} cells/tick, ${wRung} after the chime (ratio ${(wRung / wFree).toFixed(2)})`);

// ======================================================================================== the classic Alchemist
section('Untouched');
await reset();
await evalM(() => { window.__fp.ctx.fighters.equip(null); });
await tick(page, 4);
await press(page, 'KeyZ', 2);
await press(page, 'KeyT', 2);
check('no fighter: no drawables, nothing happens on Z or T', (await evalM(() => window.__fp.ctx.fighters.drawables.length)) === 0 && (await view(page)).id === null);

const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nMara Quell probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);
