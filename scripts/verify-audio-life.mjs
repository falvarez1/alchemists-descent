// Runtime probe for the wave-2 sound: the light wave (lantern hood, the deep
// dark, eyeshine, photocells, lumen blooms), the organisms, the rebuilt
// bosses' moves, and the score's hooks (a boss phase dip, the dark thinning a
// floor's calm cue). We cannot listen headless, so the sampled layer is
// instrumented: every check asserts the cue that actually played (the
// engine's lastPlayed ring), that it was a sample and not the procedural
// fallback, where it was placed (the voice trace's bus and pan), and which
// sustained loops are alive.
//
// Two layers:
//   1. Every announced moment (events.ts: lanternHooded, darkZoneEntered,
//      eyeshineCaught, lightDevice, organism, bossMove) is emitted at a point
//      to the listener's right and must play its own cue there.
//   2. The real systems: the L key hoods the lantern; spawned snapjaws,
//      puffers, isopods, fish and moths live their lives into their cues; a
//      photocell charges under the beam; on the Kiln the Colossus stomps (its
//      shockwaves rumble as loops), roars into new phases (the music dips) and
//      dies the long way; in the Cisterns the Leviathan thrashes and surges;
//      each floor loads its organisms' packs.
//
// Usage (dev server running): node scripts/verify-audio-life.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5210/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await launchBrowser({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1400, height: 880 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !isBenignDevConsoleError(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const waitFor = async (fn, arg, timeout = 30000) => {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 150 }); return true; } catch { return false; }
};
const samples = () => page.evaluate(() => window.__game.ctx.audio.debugSamples());

/** Record every cue the engine starts (the ring of 24 can roll over during a busy check). */
async function hookPlays() {
  await page.evaluate(() => {
    const a = window.__game.ctx.audio;
    if (window.__plays) return;
    window.__plays = [];
    const orig = a.debugSamples.bind(a);
    let seen = 0;
    window.__pollPlays = () => {
      const s = orig();
      const fresh = s.played - seen;
      if (fresh > 0) window.__plays.push(...s.lastPlayed.slice(-Math.min(fresh, s.lastPlayed.length)));
      seen = s.played;
    };
    window.__playTimer = setInterval(window.__pollPlays, 30);
  });
}
const plays = () => page.evaluate(() => { window.__pollPlays(); return [...window.__plays]; });
const clearPlays = () => page.evaluate(() => { window.__pollPlays(); window.__plays.length = 0; });
async function heard(ids, timeout = 4000) {
  const want = Array.isArray(ids) ? ids : [ids];
  const ok = await waitFor((w) => { window.__pollPlays(); return w.every((id) => window.__plays.includes(id)); }, want, timeout);
  return { ok, got: (await plays()).slice(-8) };
}

/** Find an open standing spot near (x, y) with `head` cells of headroom; move the alchemist and the camera there. */
const standAt = (x, y, head = 26) => page.evaluate(({ x, y, head }) => {
  const ctx = window.__game.ctx;
  const bl = (X, Y) => ctx.physics.cellBlocks(Math.floor(X), Math.floor(Y));
  for (let r = 0; r < 160; r += 4) {
    for (const s of [1, -1]) {
      const sx = Math.round(x + s * r);
      for (let k = 0; k < 160; k++) {
        const sy = Math.round(y) + (k % 2 ? -(k + 1) / 2 : k / 2);
        if (!ctx.world.inBounds(sx, sy + 1) || !bl(sx, sy + 1)) continue;
        let ok = true;
        for (let h = 0; h < head && ok; h++) for (let dx = -12; dx <= 12; dx++) if (bl(sx + dx, sy - h)) { ok = false; break; }
        if (!ok) continue;
        // a flat floor either side (organisms root on it)
        let flat = true;
        for (let dx = -12; dx <= 12; dx++) if (!bl(sx + dx, sy + 1)) { flat = false; break; }
        if (!flat) continue;
        Object.assign(ctx.player, { x: sx, y: sy, vx: 0, vy: 0 });
        ctx.camera.snapTo(sx, sy);
        return { x: sx, y: sy };
      }
    }
  }
  return null;
}, { x, y, head });

try {
  await context.addInitScript(() => { try { localStorage.clear(); } catch { /* blocked */ } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.ctx && document.body.classList.contains('entry-active'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  // The first gesture: begin a run (a real click, so the audio context is allowed to run).
  const begin = await page.locator('#expedition-entry [data-entry="begin"]').first().boundingBox();
  await page.mouse.click(begin.x + begin.width / 2, begin.y + begin.height / 2);
  await page.waitForFunction(() => window.__game.ctx.state.mode === 'play' && window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning, null, { timeout: 60000 });
  const packs = ['ui', 'player', 'spells', 'world', 'creature-bat', 'creature-colossus', 'creature-leviathan',
    'org-snapjaw', 'org-puffer', 'org-glowworm', 'org-leech', 'org-isopod', 'org-emberbeetle', 'org-ashmoth'];
  await page.evaluate((p) => window.__game.ctx.audio.requestPacks(p), packs);
  const loaded = await waitFor((p) => p.every((k) => window.__game.ctx.audio.debugSamples().packs[k] === 'ready'), packs, 60000);
  check('the new packs load and decode (organisms, bosses, bats, light in the core)', loaded, JSON.stringify((await samples()).packs));
  await hookPlays();

  // ------------------------------------------------ 1. announced moments
  const moments = [
    ['lanternHooded', { hooded: true }, ['light.lantern.hood'], 'fx', false],
    ['lanternHooded', { hooded: false }, ['light.lantern.unhood'], 'fx', false],
    ['darkZoneEntered', { darkness: 0.9 }, ['light.dark'], 'ambience', false],
    ['eyeshineCaught', { kind: 'bat' }, ['light.eyeshine'], 'fx', true],
    ['lightDevice', { kind: 'photocell' }, ['light.photocell.latch'], 'fx', true],
    ['lightDevice', { kind: 'bloom-open' }, ['light.bloom.open'], 'fx', true],
    ['lightDevice', { kind: 'bloom-furl' }, ['light.bloom.furl'], 'fx', true],
    ['organism', { kind: 'snapjaw', action: 'snap' }, ['organism.snapjaw.snap'], 'voices', true],
    ['organism', { kind: 'snapjaw', action: 'eat' }, ['organism.snapjaw.gulp'], 'voices', true],
    ['organism', { kind: 'puffer', action: 'swell' }, ['organism.puffer.swell'], 'voices', true],
    ['organism', { kind: 'puffer', action: 'burst' }, ['organism.puffer.burst'], 'voices', true],
    ['organism', { kind: 'glowworm', action: 'lower' }, ['organism.glowworm.lower'], 'ambience', true],
    ['organism', { kind: 'glowworm', action: 'retract' }, ['organism.glowworm.retract'], 'voices', true],
    ['organism', { kind: 'glowworm', action: 'snare' }, ['organism.glowworm.snare'], 'ambience', true],
    ['organism', { kind: 'leech', action: 'latch' }, ['organism.leech.latch'], 'voices', true],
    ['organism', { kind: 'leech', action: 'eat' }, ['organism.leech.drink'], 'voices', true],
    ['organism', { kind: 'leech', action: 'shed' }, ['organism.leech.shed'], 'voices', true],
    ['organism', { kind: 'isopod', action: 'curl' }, ['organism.isopod.curl'], 'voices', true],
    ['organism', { kind: 'ashmoth', action: 'flare' }, ['organism.ashmoth.flare'], 'ambience', true],
    ['organism', { kind: 'fish', action: 'scatter' }, ['organism.fish.scatter'], 'ambience', true],
    ['organism', { kind: 'bat', action: 'scatter' }, ['creature.bat.scatter'], 'voices', true],
    ['organism', { kind: 'imp', action: 'eat' }, ['organism.ashmoth.flare'], 'ambience', true],
    ['bossMove', { kind: 'colossus', move: 'slam', phase: 1 }, ['creature.colossus.heave'], 'voices', true],
    ['bossMove', { kind: 'colossus', move: 'throw', phase: 1 }, ['creature.colossus.scoop'], 'voices', true],
    ['bossMove', { kind: 'colossus', move: 'vent', phase: 2 }, ['creature.colossus.vent.tell'], 'voices', true],
    ['bossMove', { kind: 'colossus', move: 'roar', phase: 2 }, ['creature.colossus.roar'], 'voices', true],
    ['bossMove', { kind: 'colossus', move: 'quench', phase: 2 }, ['creature.colossus.kneel'], 'voices', true],
    ['bossMove', { kind: 'colossus', move: 'dying', phase: 3 }, ['creature.colossus.death.crack'], 'voices', true],
    ['bossMove', { kind: 'leviathan', move: 'lunge', phase: 1 }, ['creature.leviathan.dim', 'creature.leviathan.windup'], 'voices', true],
    ['bossMove', { kind: 'leviathan', move: 'thrash', phase: 2 }, ['creature.leviathan.windup'], 'voices', true],
    ['bossMove', { kind: 'leviathan', move: 'dive', phase: 3 }, ['creature.leviathan.dive', 'creature.leviathan.dim'], 'voices', true],
  ];
  const results = await page.evaluate(async (list) => {
    const { ctx } = window.__game;
    const a = ctx.audio;
    const out = [];
    for (const [event, payload, ids, bus, placed] of list) {
      const { x: lx, y: ly } = a.debugSnapshot().listener;
      const before = a.debugSamples();
      const sunk = a.debugSnapshot().sunk;
      ctx.events.emit(event, { ...payload, x: lx + 140, y: ly + (event === 'bossMove' ? 10 : 0) });
      // Read at once: a cue's voice is started (and traced) inside the emit, even a
      // delayed layer (its start time is scheduled), so nothing else can slip in.
      const after = a.debugSamples();
      const snap = a.debugSnapshot();
      const fresh = after.lastPlayed.slice(-Math.max(1, after.played - before.played));
      const traces = snap.trace.slice(-Math.max(1, snap.sunk - sunk));
      await new Promise((r) => setTimeout(r, 420)); // let it ring out past the cue's cooldown
      out.push({
        event, payload, ids, fresh,
        ok: ids.every((id) => fresh.includes(id)),
        fellBack: after.fellBack - before.fellBack,
        bus: traces.map((t) => t.bus),
        pan: traces.map((t) => +t.pan.toFixed(2)),
        wantBus: bus, placed,
      });
      await new Promise((r) => setTimeout(r, 260)); // clear each cue's cooldown before the next
    }
    return out;
  }, moments);
  for (const r of results) {
    const where = r.placed ? r.pan.some((p) => p > 0.1) : r.pan.every((p) => Math.abs(p) < 0.05);
    const onBus = r.bus.includes(r.wantBus);
    check(`${r.event} ${JSON.stringify(r.payload)} → ${r.ids.join(' + ')} (${r.wantBus}${r.placed ? ', panned right' : ', centred'})`,
      r.ok && r.fellBack === 0 && where && onBus, `played ${r.fresh.join(',')}; bus ${r.bus.join(',')}; pan ${r.pan.join(',')}; fallback ${r.fellBack}`);
  }
  const quiet = await page.evaluate(async () => {
    const { ctx } = window.__game;
    const before = ctx.audio.debugSamples().played;
    ctx.events.emit('lanternHooded', { hooded: true, x: 0, y: 0, quiet: true });
    ctx.events.emit('organism', { kind: 'isopod', action: 'scavenge', x: 0, y: 0 });
    ctx.events.emit('bossMove', { kind: 'colossus', move: 'march', phase: 1, x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 200));
    return ctx.audio.debugSamples().played - before;
  });
  check('housekeeping and unvoiced moments stay silent (a quiet hood, a scavenge, a march)', quiet === 0, `${quiet} played`);

  // A crowd does not machine-gun: 18 isopods curl in one gust.
  const crowd = await page.evaluate(async () => {
    const { ctx } = window.__game;
    const { x: lx, y: ly } = ctx.audio.debugSnapshot().listener;
    await new Promise((r) => setTimeout(r, 400));
    const b = ctx.audio.debugSamples();
    for (let i = 0; i < 18; i++) ctx.events.emit('organism', { kind: 'isopod', action: 'curl', x: lx + 60 + i * 3, y: ly });
    const a = ctx.audio.debugSamples();
    return { played: a.played - b.played, dropped: a.dropped - b.dropped };
  });
  check('eighteen isopods curling in one gust play once (the cue cooldown folds the crowd)', crowd.played === 1 && crowd.dropped >= 17, JSON.stringify(crowd));

  // ------------------------------------------------ 2. the real systems
  // The lantern's hood, by the real key.
  await clearPlays();
  await page.keyboard.press('KeyL');
  let h = await heard('light.lantern.hood');
  check('L hoods the lantern: the brass hood drops (light.lantern.hood)', h.ok, h.got.join(','));
  await page.waitForTimeout(250);
  await page.keyboard.press('KeyL');
  h = await heard('light.lantern.unhood');
  check('L again flips the hood open (light.lantern.unhood)', h.ok, h.got.join(','));

  // Organisms on the real floor, beside the alchemist.
  const spot = await page.evaluate(() => ({ x: window.__game.ctx.player.x, y: window.__game.ctx.player.y }));
  const stand = await standAt(spot.x, spot.y);
  check('found open floor beside the alchemist for the organism checks', Boolean(stand), JSON.stringify(stand));
  if (stand) {
    await page.evaluate(() => { window.__game.ctx.state.debugGodMode = true; });
    await clearPlays();
    // A snapjaw rooted out of the alchemist's reach, and a wall-walking isopod wandering into it.
    const jx = stand.x + 40;
    const jawFloor = await page.evaluate((x) => {
      const { ctx } = window.__game;
      const bl = (X, Y) => ctx.physics.cellBlocks(X, Y);
      const y0 = Math.floor(ctx.player.y);
      for (let dy = -12; dy <= 12; dy++) if (!bl(x, y0 + dy) && bl(x, y0 + dy + 1) && !bl(x + 2, y0 + dy) && bl(x + 2, y0 + dy + 1)) return y0 + dy;
      return null;
    }, jx);
    if (jawFloor !== null) {
      await page.evaluate(({ x, y }) => {
        const { ctx } = window.__game;
        const c = ctx.critters.spawn('snapjaw', x, y);
        Object.assign(c, { anchorX: x, anchorY: y, nx: 0, ny: -1, reach: 6, state: 0, stateT: 0, extent: 1, hp: 32, id: 'probe-snapjaw' });
        const bug = ctx.critters.spawn('isopod', x + 2, y);
        Object.assign(bug, { anchorX: x + 2, anchorY: y, nx: 0, ny: -1, state: 0, stateT: 0, id: 'probe-isopod-prey' });
      }, { x: jx, y: jawFloor });
    }
    h = await heard(['organism.snapjaw.tell', 'organism.snapjaw.snap', 'organism.snapjaw.gulp'], 6000);
    check('a snapjaw warns (tell), snaps and swallows an isopod', jawFloor !== null && h.ok, `floor ${jawFloor}; ${h.got.join(',')}`);
    h = await heard('organism.snapjaw.chew', 4000);
    check('...and digests it, quietly (organism.snapjaw.chew)', h.ok, h.got.join(','));

    // A puffer that ripens, then a gust bursts it.
    await clearPlays();
    await page.evaluate(({ x, y }) => {
      const { ctx } = window.__game;
      const c = ctx.critters.spawn('puffer', x - 16, y);
      Object.assign(c, { anchorX: x - 16, anchorY: y, nx: 0, ny: -1, state: 0, stateT: 0, extent: 0.399, id: 'probe-puffer' });
    }, stand);
    h = await heard('organism.puffer.swell', 3000);
    check('a puffer pulling tight creaks (organism.puffer.swell)', h.ok, h.got.join(','));
    await page.evaluate(({ x, y }) => window.__game.ctx.critters.scatter(x - 16, y - 3, 12, 1), stand);
    h = await heard('organism.puffer.burst', 2000);
    check('a gust bursts it (organism.puffer.burst)', h.ok, h.got.join(','));

    // An isopod on the floor curls under a gust and bounces as a ball.
    await clearPlays();
    await page.evaluate(({ x, y }) => {
      const { ctx } = window.__game;
      const c = ctx.critters.spawn('isopod', x + 6, y);
      Object.assign(c, { anchorX: x + 6, anchorY: y, nx: 0, ny: -1, state: 0, stateT: 0, id: 'probe-isopod' });
    }, stand);
    await page.waitForTimeout(200);
    await page.evaluate(({ x, y }) => window.__game.ctx.critters.scatter(x + 4, y + 2, 14, 2.5), stand);
    h = await heard('organism.isopod.curl', 2000);
    check('an isopod curls into a ball (organism.isopod.curl)', h.ok, h.got.join(','));

    // Moths circling the lantern: the swarm flutters as a loop.
    const moth = await page.evaluate(async () => {
      const { ctx } = window.__game;
      const p = ctx.player;
      const tipX = p.x + Math.cos(p.aimAngle) * 9, tipY = p.y - 9 + Math.sin(p.aimAngle) * 9;
      for (let i = 0; i < 6; i++) ctx.critters.spawn('moth', tipX + (i % 3) * 3 - 3, tipY - 2 + Math.floor(i / 3) * 3);
      for (let t = 0; t < 20; t++) {
        await new Promise((r) => setTimeout(r, 100));
        if (ctx.audio.debugSamples().loops.includes('organism.moth.swarm.loop')) return true;
      }
      return ctx.audio.debugSamples().loops;
    });
    check('moths circling the lantern sustain the swarm flutter (organism.moth.swarm.loop)', moth === true, JSON.stringify(moth));

    // A pool in a metal cup beside him, a school of fish in it: they bolt as he comes close.
    await clearPlays();
    const pool = await page.evaluate(({ x, y }) => {
      const { ctx } = window.__game;
      const w = ctx.world;
      const x0 = x + 30, x1 = x + 60, y0 = y - 16, y1 = y - 4;
      for (let X = x0; X <= x1; X++) for (let Y = y0; Y <= y1; Y++) {
        if (!w.inBounds(X, Y)) continue;
        const edge = X === x0 || X === x1 || Y === y1;
        w.types[w.idx(X, Y)] = edge ? 13 : 2;
      }
      for (let i = 0; i < 4; i++) ctx.critters.spawn('fish', x0 + 6 + i * 4, y1 - 4);
      return { x0, y1 };
    }, stand);
    await page.waitForTimeout(400);
    await page.evaluate(({ x0, y1 }) => { const p = window.__game.ctx.player; p.x = x0 - 6; p.y = y1 + 3; }, pool);
    h = await heard('organism.fish.scatter', 3000);
    check('a school bolts from the alchemist as he comes close (organism.fish.scatter)', h.ok, h.got.join(','));

    // A photocell under a (forced) beam: it hums while it fills, then latches.
    const cell = await page.evaluate(() => {
      const rt = window.__game.ctx.levels.current;
      const m = rt.mechanisms.find((k) => k.sensorType === 'light' && k.state !== 1);
      return m ? { id: m.id, x: m.x, y: m.y } : null;
    });
    if (cell) {
      await standAt(cell.x, cell.y, 22);
      await clearPlays();
      const hum = await page.evaluate(async (id) => {
        const { ctx } = window.__game;
        const q = ctx.lightQuery;
        const orig = q.wandLight;
        q.wandLight = () => 1;
        let during = false;
        for (let t = 0; t < 60; t++) {
          await new Promise((r) => setTimeout(r, 100));
          if (ctx.audio.debugSamples().loops.includes(`photocell#${id}`)) during = true;
          const m = ctx.levels.current.mechanisms.find((k) => k.id === id);
          if (m && m.state >= 1 && during) break;
        }
        q.wandLight = orig;
        return during;
      }, cell.id);
      h = await heard('light.photocell.latch', 3000);
      check('a photocell under the beam hums as it fills (its sustained loop), then latches', hum && h.ok, `hum ${hum}; ${h.got.join(',')}`);
    } else console.log('      (no unlatched photocell on this floor — the latch is covered by the event check)');
  }

  // ------------------------------------------------ the Kiln: the Colossus's fight and its long death
  await startConsoleRun(page, { subcommand: 'test', level: 'd4', seed: 1, settleMs: 400 });
  await hookPlays();
  const kilnPacks = await waitFor(() => {
    const s = window.__game.ctx.audio.debugSamples();
    return s.packs['creature-colossus'] === 'ready' && s.packs['org-emberbeetle'] === 'ready' && s.packs['org-ashmoth'] === 'ready';
  }, null, 40000);
  check('the Kiln loads its organisms with it (org-emberbeetle, org-ashmoth) and the Colossus pack', kilnPacks,
    Object.keys((await samples()).packs).filter((p) => /org-|creature-colossus/.test(p)).join(','));
  const boss = await page.evaluate(() => { const c = window.__game.ctx.enemies.find((e) => e.kind === 'colossus'); return c ? { x: c.x, y: c.y } : null; });
  if (boss) {
    await standAt(boss.x - 70, boss.y, 26);
    // In the sim window now: its brain wakes on its next tick.
    await waitFor(() => Boolean(window.__game.ctx.enemies.find((e) => e.kind === 'colossus')?.boss), null, 5000);
    await page.evaluate(() => {
      const { ctx } = window.__game;
      ctx.state.debugGodMode = true;
      const c = ctx.enemies.find((e) => e.kind === 'colossus');
      c.alerted = true;
      c.boss.engaged = true;
      c.boss.engagedAt = ctx.state.frameCount;
    });
    await waitFor(() => window.__game.ctx.music?.debugSnapshot().cue === 'boss-colossus', null, 8000);
    // The stomp: force the committed move, let its clock fire it.
    await clearPlays();
    const stomp = await page.evaluate(async () => {
      const { ctx } = window.__game;
      const c = ctx.enemies.find((e) => e.kind === 'colossus');
      Object.assign(c.boss, { move: 'stomp', moveT: 0, moveDur: 66 });
      let waveLoop = false;
      for (let t = 0; t < 30; t++) {
        await new Promise((r) => setTimeout(r, 80));
        if (ctx.audio.debugSamples().loops.some((k) => k.startsWith('creature.colossus.wave.loop#'))) waveLoop = true;
      }
      return waveLoop;
    });
    h = await heard('creature.colossus.stomp', 1000);
    check('the Colossus stomps (creature.colossus.stomp) and its shockwaves rumble as they run (wave loops)', h.ok && stomp, `waves ${stomp}; ${h.got.join(',')}`);
    // Phase two, then three: a roar each time, the plates burst off, and the score holds its breath under it.
    await clearPlays();
    const dip = await page.evaluate(async () => {
      const { ctx } = window.__game;
      const c = ctx.enemies.find((e) => e.kind === 'colossus');
      Object.assign(c.boss, { move: 'march', moveT: 0 });
      c.hp = c.maxHp * 0.6;
      let low = 1, seen = null;
      for (let t = 0; t < 12; t++) {
        await new Promise((r) => setTimeout(r, 100));
        const m = ctx.music?.debugSnapshot();
        if (m) { low = Math.min(low, m.masterTarget); if (m.sincePhaseMs !== null) seen = m.sincePhaseMs; }
      }
      return { low, seen, cue: ctx.music?.debugSnapshot().cue };
    });
    h = await heard('creature.colossus.roar', 2000);
    check('phase two: the Colossus roars (creature.colossus.roar) and the score dips under it', h.ok && dip.low < 0.5 && dip.seen !== null, `${JSON.stringify(dip)}; ${h.got.join(',')}`);
    await page.waitForTimeout(1600);
    await clearPlays();
    await page.evaluate(() => {
      const c = window.__game.ctx.enemies.find((e) => e.kind === 'colossus');
      Object.assign(c.boss, { move: 'march', moveT: 0 });
      c.hp = c.maxHp * 0.3;
    });
    h = await heard(['creature.colossus.roar', 'creature.colossus.plates'], 3000);
    check('phase three: another roar, and the armour bursts off its back (creature.colossus.plates)', h.ok, h.got.join(','));
    // The long death: the groan, the overload roar, the rubble.
    await page.waitForTimeout(1600);
    await clearPlays();
    await page.evaluate(() => {
      const { ctx } = window.__game;
      const c = ctx.enemies.find((e) => e.kind === 'colossus');
      Object.assign(c.boss, { move: 'march', moveT: 0 });
      ctx.enemyCtl.damage(c, c.hp + 100, 0, 0, 'direct');
    });
    h = await heard('creature.colossus.death.crack', 2000);
    check('a killing blow: it sinks groaning (creature.colossus.death.crack)', h.ok, h.got.join(','));
    h = await heard(['creature.colossus.death', 'creature.colossus.death.rubble'], 6000);
    check('...roars its last as the core overloads, and comes down as rubble (death, death.rubble)', h.ok, h.got.join(','));
  } else check('the Kiln has its Colossus', false);

  // ------------------------------------------------ the Cisterns: the Leviathan, and the dark thinning the score
  await startConsoleRun(page, { subcommand: 'test', level: 'd3', seed: 1, settleMs: 400 });
  await hookPlays();
  const cisternPacks = await waitFor(() => {
    const s = window.__game.ctx.audio.debugSamples();
    return ['creature-leviathan', 'org-leech', 'org-glowworm', 'org-isopod'].every((p) => s.packs[p] === 'ready');
  }, null, 40000);
  check('the Cisterns load their organisms (org-leech, org-glowworm, org-isopod) and the Leviathan pack', cisternPacks,
    Object.keys((await samples()).packs).filter((p) => /org-|creature-leviathan/.test(p)).join(','));
  const lev = await page.evaluate(() => { const c = window.__game.ctx.enemies.find((e) => e.kind === 'leviathan'); return c ? { x: c.x, y: c.y } : null; });
  if (lev) {
    await standAt(lev.x, lev.y - 30, 24);
    await page.evaluate(() => {
      const { ctx } = window.__game;
      ctx.state.debugGodMode = true;
      ctx.enemies.find((e) => e.kind === 'leviathan').alerted = true;
    });
    await page.waitForTimeout(300);
    await clearPlays();
    const moved = await page.evaluate(async () => {
      const { ctx } = window.__game;
      const c = ctx.enemies.find((e) => e.kind === 'leviathan');
      if (!c.boss || c.submerged !== true) return { sub: c.submerged, boss: Boolean(c.boss) };
      Object.assign(c.boss, { move: 'thrash', moveT: 17, moveDur: 40 });
      await new Promise((r) => setTimeout(r, 400));
      Object.assign(c.boss, { move: 'dive', moveT: 33, moveDur: 70 });
      await new Promise((r) => setTimeout(r, 400));
      return { sub: true, boss: true };
    });
    h = await heard(['creature.leviathan.thrash', 'creature.leviathan.surge'], 2500);
    check('the Leviathan throws its pool with its tail (thrash) and surges from below (surge)', h.ok, `${JSON.stringify(moved)}; ${h.got.join(',')}`);
  } else check('the Cisterns have their Leviathan', false);

  // ------------------------------------------------ the Rot Gardens: its organisms, and the deep dark
  await startConsoleRun(page, { subcommand: 'test', level: 'd2', seed: 1, settleMs: 400 });
  await hookPlays();
  const rotPacks = await waitFor(() => {
    const s = window.__game.ctx.audio.debugSamples();
    return ['org-snapjaw', 'org-puffer', 'org-isopod', 'org-glowworm'].every((p) => s.packs[p] === 'ready');
  }, null, 40000);
  check('the Rot Gardens load their organisms (org-snapjaw, org-puffer, org-isopod, org-glowworm)', rotPacks,
    Object.keys((await samples()).packs).filter((p) => p.startsWith('org-')).join(','));
  await page.waitForTimeout(1500);
  // The deep dark (forced under the alchemist): the hush, and the floor's calm cue thins.
  await clearPlays();
  const dark = await page.evaluate(async () => {
    const { ctx } = window.__game;
    const q = ctx.lightQuery;
    const orig = q.darkness;
    q.darkness = () => 0.95;
    let target = null, cue = null, dark = false;
    for (let t = 0; t < 30; t++) {
      await new Promise((r) => setTimeout(r, 100));
      const m = ctx.music?.debugSnapshot();
      if (m) { target = m.masterTarget; cue = m.cue; dark = m.dark; }
      if (dark && cue && !cue.startsWith('boss') && !cue.endsWith('-tension') && target < 0.7) break;
    }
    q.darkness = orig;
    return { target, cue, dark };
  });
  h = await heard('light.dark', 2000);
  const calmCue = dark.cue && !String(dark.cue).startsWith('boss') && !String(dark.cue).endsWith('-tension');
  check('stepping into the deep dark: the hush (light.dark)', h.ok, h.got.join(','));
  check('...and the floor\'s calm cue thins in the dark (music master → 0.62)', dark.dark && (!calmCue || dark.target < 0.7), JSON.stringify(dark));

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  fail++;
  console.error(error);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
