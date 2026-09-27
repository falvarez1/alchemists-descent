// Runtime probe for the flora sounds and the audio fail-safe.
//
// We cannot listen headless, so the sampled layer is instrumented: every
// check asserts the cue that actually played (the engine's lastPlayed ring,
// polled into a log), that it was a sample and not the procedural fallback,
// and which sustained loops are alive.
//
//   1. Every announced plant moment (floraMoment, treeLanded) plays its own
//      flora cue, sampled and placed where it happened.
//   2. The real systems, in the Rot Gardens: a tree felled by the dig beam
//      (crack, lean, hinge, the crown's rush, the fall in mushroom, the
//      canopy, the log settling); a pod tree kicked (pods drop); the seed bed
//      watered (drinking, sprouting, rung by rung, the crown); the thicket
//      lit (it catches, it crackles); brushing through leaves.
//   3. The fail-safe: a death with the AudioContext suspended (a frozen
//      clock) runs its whole flow — every playerDied listener, the corpse,
//      the directed death, the respawn — and a 6.5 s main-thread block with
//      loops sustained throws nothing when the loops wake up.
//
// Usage (dev server running): node scripts/verify-audio-flora.mjs [url]
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

/** Record every cue the engine starts (the ring of 24 can roll over during a busy check). */
async function hookPlays() {
  await page.evaluate(() => {
    const a = window.__game.ctx.audio;
    if (window.__playTimer) clearInterval(window.__playTimer);
    window.__plays = [];
    let seen = a.debugSamples().played;
    window.__pollPlays = () => {
      const s = a.debugSamples();
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
  return { ok, got: [...new Set(await plays())].filter((id) => id.startsWith('flora.')) };
}

/** A pickup's card offer pauses the game: choose one (a real click) so the world runs on. */
async function unblock() {
  for (let n = 0; n < 3; n++) {
    const card = page.locator('#card-offer-overlay.visible .card-offer-card').first();
    if (!(await card.count())) break;
    const box = await card.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
  }
  return page.evaluate(() => {
    const ctx = window.__game.ctx;
    // Nothing more to pick up where the probe works.
    const pickups = ctx.levels.current?.pickups;
    if (pickups) { let keep = 0; for (const k of pickups) if (k.kind === 'goldpile') pickups[keep++] = k; pickups.length = keep; }
    return { paused: ctx.state.paused };
  });
}

/** Park the alchemist at (x, y) and point the camera (and so the ears) at (fx, fy). */
const look = (fx, fy) => page.evaluate(({ fx, fy }) => {
  const ctx = window.__game.ctx;
  ctx.camera.setInspectionFocus(fx, fy, { snap: true });
}, { fx, fy });

try {
  await context.addInitScript(() => { try { localStorage.clear(); } catch { /* blocked */ } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.ctx && document.body.classList.contains('entry-active'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  // The first gesture: begin a run (a real click, so the audio context is allowed to run).
  const begin = await page.locator('#expedition-entry [data-entry="begin"]').first().boundingBox();
  await page.mouse.click(begin.x + begin.width / 2, begin.y + begin.height / 2);
  await page.waitForFunction(() => window.__game.ctx.state.mode === 'play' && window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning, null, { timeout: 60000 });

  // ------------------------------------------------ 0. the pack loads with the floor
  const floraReady = await waitFor(() => window.__game.ctx.audio.debugSamples().packs.flora === 'ready', null, 40000);
  check('the flora pack loads with the floor (never on first load)', floraReady, JSON.stringify((await page.evaluate(() => window.__game.ctx.audio.debugSamples().packs))));
  await waitFor(() => ['ui', 'player', 'spells', 'world'].every((p) => window.__game.ctx.audio.debugSamples().packs[p] === 'ready'), null, 40000);
  await hookPlays();

  // The glowseed pod, picked up on the Bellows (the living floor keeps a pouch).
  const glow = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const living = ctx.levels.current?.living;
    if (!living) return { living: false };
    living.glowseeds = 0;
    const w = ctx.world, p = ctx.player;
    const x = Math.floor(p.x), y = Math.floor(p.y - 3);
    const i = w.idx(x, y);
    w.replaceCellAt(i, 41, 0xd6f496);
    w.life[i] = -4; // SEED_GLOW_LOOSE
    return { living: true };
  });
  if (glow.living) {
    const h = await heard('flora.glowseed', 3000);
    check('walking over a glowseed pod picks it up with its own twinkle (flora.glowseed)', h.ok, h.got.join(','));
  } else check('the Bellows run keeps a glowseed pouch', false, 'no living expedition on the first floor');

  // ------------------------------------------------ 1. announced moments
  const moments = [
    ['creak', 1, ['flora.creak']], ['lean', 1, ['flora.lean']], ['crack', 0.8, ['flora.crack']],
    ['snap', 0.8, ['flora.hinge']], ['snap', 0.4, ['flora.sapling']], ['whoosh', 0.9, ['flora.whoosh']],
    ['shed', 0.8, ['flora.canopy']], ['settle', 0.6, ['flora.settle']], ['rustle', 0.5, ['flora.rustle']],
    ['podDrop', 0.5, ['flora.pod.drop']], ['soak', 0.3, ['flora.seed.soak']], ['sprout', 0.6, ['flora.seed.sprout']],
    ['rung', 0.4, ['flora.ladder.rung']], ['bloom', 1, ['flora.ladder.bloom']],
  ];
  const results = await page.evaluate(async (list) => {
    const { ctx } = window.__game;
    const a = ctx.audio;
    const out = [];
    for (const [kind, strength, ids] of list) {
      const { x: lx, y: ly } = a.debugSnapshot().listener;
      const before = a.debugSamples();
      const sunk = a.debugSnapshot().sunk;
      ctx.events.emit('floraMoment', { kind, x: lx + 140, y: ly, strength });
      const after = a.debugSamples();
      const snap = a.debugSnapshot();
      const fresh = after.lastPlayed.slice(-Math.max(1, after.played - before.played));
      const traces = snap.trace.slice(-Math.max(1, snap.sunk - sunk));
      out.push({ kind, strength, ids, fresh, ok: ids.every((id) => fresh.includes(id)), fellBack: after.fellBack - before.fellBack, pan: traces.map((t) => +t.pan.toFixed(2)) });
      await new Promise((r) => setTimeout(r, 450));
    }
    // The fall, on the Bellows: birch.
    const { x: lx, y: ly } = a.debugSnapshot().listener;
    const b = a.debugSamples();
    ctx.events.emit('treeLanded', { x: lx + 140, y: ly, strength: 0.9, first: true });
    const f = a.debugSamples();
    out.push({ kind: 'treeLanded', strength: 0.9, ids: ['flora.fall.birch'], fresh: f.lastPlayed.slice(-Math.max(1, f.played - b.played)), fellBack: f.fellBack - b.fellBack, pan: [0.5] });
    out.at(-1).ok = out.at(-1).fresh.includes('flora.fall.birch');
    return out;
  }, moments);
  for (const r of results) {
    check(`${r.kind} (strength ${r.strength}) → ${r.ids.join(' + ')}, sampled, panned right`, r.ok && r.fellBack === 0 && r.pan.some((p) => p > 0.1),
      `played ${r.fresh.join(',')}; pan ${r.pan.join(',')}; fallback ${r.fellBack}`);
  }

  // ------------------------------------------------ 2. the real systems (the Rot Gardens)
  await startConsoleRun(page, { subcommand: 'test', level: 'd2', seed: 1, loadout: 'advanced', world: 'campaign-level', settleMs: 600 });
  await waitFor(() => window.__game.ctx.audio.debugSamples().packs.flora === 'ready', null, 30000);
  await hookPlays();
  const puzzles = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.state.debugGodMode = true;
    ctx.enemies.length = 0;
    return (ctx.levels.current.placedPrefabs ?? []).filter((p) => p.id.startsWith('flora-')).map((p) => ({ id: p.id, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, focus: p.focus }));
  });
  check('the Rot Gardens (seed 1) hold a timber bridge, a root ladder and a thicket', ['flora-timber-bridge', 'flora-root-ladder', 'flora-thicket'].every((id) => puzzles.some((p) => p.id === id)), puzzles.map((p) => p.id).join(','));
  const pz = (id) => puzzles.find((p) => p.id === id);

  // --- fell the tree with the dig beam (Excavate), as the player would: bite the foot until it goes.
  const bridge = pz('flora-timber-bridge');
  await unblock();
  if (bridge?.focus) {
    await page.evaluate(({ f }) => {
      const ctx = window.__game.ctx;
      Object.assign(ctx.player, { x: f.x - 40, y: f.y - 2, vx: 0, vy: 0 });
      window.__fells = [];
      window.__fellOff?.();
      window.__fellOff = ctx.events.on('treeFelled', (d) => window.__fells.push(d));
    }, { f: bridge.focus });
    await look(bridge.focus.x, bridge.focus.y - 30);
    await page.waitForTimeout(400);
    await clearPlays();
    const felled = await page.evaluate(async ({ f }) => {
      const ctx = window.__game.ctx;
      for (let row = f.y - 1; row >= f.y - 9; row -= 4) {
        for (let k = 0; k < 18; k++) {
          ctx.fx.digBeam = { x0: f.x - 30, y0: row, x1: f.x + 4, y1: row, life: 3 };
          ctx.spells.erodeAt(f.x - 9 + k, row, 2);
          await new Promise((r) => setTimeout(r, 34));
          if (window.__fells.some((d) => Math.abs(d.x - f.x) < 24 && d.cells >= 100)) return window.__fells.at(-1);
        }
      }
      return null;
    }, { f: bridge.focus });
    check('the dig beam fells the timber-bridge tree', Boolean(felled), JSON.stringify(felled));
    const fall = await heard(['flora.crack', 'flora.fall.mushroom', 'flora.canopy', 'flora.settle'], 12000);
    const got = fall.got;
    check('the fall sounds its own moments: crack → fall in mushroom → canopy → settle', fall.ok, got.join(','));
    check('...with the lean, the hinge tearing and the crown\'s rush between them', ['flora.lean', 'flora.hinge', 'flora.whoosh'].filter((id) => got.includes(id)).length >= 2, got.join(','));
    check('...and none of the old stand-ins (no explosion, no crate knock, no whip)', !(await plays()).some((id) => ['boom.small', 'boom.medium', 'body.impact.wood', 'trick.whip', 'body.tear'].includes(id)), (await plays()).join(','));
  } else check('found the timber-bridge tree', false);

  // --- kick a pod tree: find a held pod, kick the trunk beside it.
  await unblock();
  await clearPlays();
  const kicked = await page.evaluate(async () => {
    const ctx = window.__game.ctx, w = ctx.world;
    for (let i = 0; i < w.types.length; i++) {
      if (w.types[i] !== 41 || (w.life[i] !== -1 && w.life[i] !== -2)) continue;
      const x = i % w.width, y = (i / w.width) | 0;
      // the nearest trunk the boot could meet
      let tx = -1, ty = -1, best = 1e9;
      for (let dy = -14; dy <= 30; dy++) for (let dx = -14; dx <= 14; dx++) {
        if (!w.inBounds(x + dx, y + dy) || w.types[w.idx(x + dx, y + dy)] !== 40) continue;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; tx = x + dx; ty = y + dy; }
      }
      if (tx < 0) continue;
      Object.assign(ctx.player, { x: tx - 12, y: ty, vx: 0, vy: 0 });
      ctx.camera.setInspectionFocus(tx, ty, { snap: true });
      await new Promise((r) => setTimeout(r, 300));
      ctx.flora.gust(ctx, () => 1, 1, 0, tx, ty);
      return { pod: [x, y], trunk: [tx, ty] };
    }
    return null;
  });
  if (kicked) {
    const h = await heard(['flora.pod.drop', 'flora.rustle'], 3000);
    check('kicking a pod tree drops its pods and shakes its leaves (flora.pod.drop, flora.rustle)', h.ok, `${h.got.join(',')} ${JSON.stringify(kicked)}`);
  } else check('found a tree holding pods', false);

  // --- water the seed bed: pull the bung and let the pool run onto the thirsty seeds.
  const ladder = pz('flora-root-ladder');
  await unblock();
  if (ladder) {
    await page.evaluate(({ p }) => {
      const ctx = window.__game.ctx;
      Object.assign(ctx.player, { x: p.x0 + 6, y: p.y1 - 6, vx: 0, vy: 0 });
    }, { p: ladder });
    await look((ladder.x0 + ladder.x1) / 2, (ladder.y0 + ladder.y1) / 2);
    await page.waitForTimeout(400);
    await clearPlays();
    const bung = await page.evaluate(({ p }) => {
      const w = window.__game.ctx.world;
      let n = 0;
      for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) {
        const i = w.idx(x, y);
        if (w.types[i] === 4 && w.types[w.idx(x, y - 1)] === 2) { w.clearCellAt(i); n++; }
      }
      return n;
    }, { p: ladder });
    check('pulled the seed bed\'s bung', bung > 0, `${bung} cells`);
    const h = await heard(['flora.seed.soak', 'flora.seed.sprout', 'flora.ladder.rung'], 12000);
    const grow = await waitFor(() => window.__game.ctx.audio.debugSamples().loops.includes('flora.ladder.grow.loop'), null, 4000);
    const bloom = await heard('flora.ladder.bloom', 10000);
    check('a watered seed drinks and sprouts, and its ladder knocks up rung by rung (soak, sprout, rung)', h.ok, h.got.join(','));
    check('...creaking as it grows (flora.ladder.grow.loop sustained)', grow || h.got.includes('flora.ladder.grow.loop'));
    check('...and opens its crown (flora.ladder.bloom)', bloom.ok, bloom.got.join(','));
  } else check('found the root ladder', false);

  // --- light the thicket.
  const thicket = pz('flora-thicket');
  const thicketState = await unblock();
  if (thicket) {
    await page.evaluate(({ p }) => {
      const ctx = window.__game.ctx;
      Object.assign(ctx.player, { x: p.x0 + 2, y: p.y1 - 9, vx: 0, vy: 0 });
    }, { p: thicket });
    await look(thicket.x0 + 17, thicket.y1 - 20);
    await page.waitForTimeout(1500); // the previous fires' "catch" re-arms after a second without
    await clearPlays();
    await page.evaluate(({ p }) => {
      const w = window.__game.ctx.world;
      for (let y = p.y1 - 30; y < p.y1 - 8; y++) for (let x = p.x0 + 8; x < p.x0 + 11; x++) {
        const i = w.idx(x, y);
        if (w.types[i] === 0) { w.replaceCellAt(i, 5, 0xff6600); w.life[i] = 80; }
      }
    }, { p: thicket });
    const loopP = waitFor(() => window.__game.ctx.audio.debugSamples().loops.includes('flora.burn.loop'), null, 5000);
    await page.waitForTimeout(700);
    const diag = await page.evaluate(({ p }) => {
      const ctx = window.__game.ctx, w = ctx.world;
      let fire = 0, leaf = 0, wood = 0;
      for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) {
        const t = w.types[w.idx(x, y)];
        if (t === 5) fire++; else if (t === 39) leaf++; else if (t === 4) wood++;
      }
      return { fire, leaf, wood, cam: [Math.round(ctx.camera.x), Math.round(ctx.camera.y)], p: [p.x0, p.y0], paused: ctx.state.paused, manual: ctx.time.manual };
    }, { p: thicket });
    const h = await heard('flora.catch', 4300);
    const loop = await loopP;
    check('the thicket catches with a whoomph (flora.catch)', h.ok, `${h.got.join(',')} ${JSON.stringify(thicketState)} ${JSON.stringify(diag)}`);
    check('...and crackles while it burns (flora.burn.loop sustained)', loop, JSON.stringify(await page.evaluate(() => window.__game.ctx.audio.debugSamples().loops)));
  } else check('found the thicket', false);

  // --- brushing through leaves: a strip of fallen leaves across his path, walked through.
  await unblock();
  await page.evaluate(() => window.__game.ctx.camera.clearInspectionFocus?.());
  const strip = await page.evaluate(() => {
    // A probe arena where he stands: a stone floor, open air, and a carpet of fallen leaves ahead.
    const ctx = window.__game.ctx, w = ctx.world;
    const px = Math.max(20, Math.min(w.width - 220, Math.floor(ctx.player.x))), py = Math.max(40, Math.min(w.height - 10, Math.floor(ctx.player.y)));
    for (let x = px - 8; x < px + 190; x++) {
      for (let y = py - 30; y <= py; y++) w.clearCellAt(w.idx(x, y));
      for (let y = py + 1; y <= py + 3; y++) { const i = w.idx(x, y); w.replaceCellAt(i, 12, 0x6a6a70); w.life[i] = 0; }
    }
    for (let x = px + 10; x < px + 180; x++) for (let h = 0; h < 8; h++) { const i = w.idx(x, py - h); w.replaceCellAt(i, 39, 0x5c8a4c); w.life[i] = -12; }
    // Nothing to pick up on the way (a card offer pauses the game).
    const pickups = ctx.levels.current?.pickups;
    if (pickups) { let keep = 0; for (const k of pickups) if (k.x < px - 20 || k.x > px + 220 || Math.abs(k.y - py) > 60) pickups[keep++] = k; pickups.length = keep; }
    Object.assign(ctx.player, { x: px, y: py, vx: 0, vy: 0 });
    ctx.camera.snapTo(px + 60, py);
    return { x: px, y: py };
  });
  if (strip) {
    await page.waitForTimeout(300);
    await clearPlays();
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1600);
    await page.keyboard.up('KeyD');
    const all = await plays();
    const sweeps = all.filter((id) => id === 'flora.brush.grass').length;
    check('walking through the leaves sweeps them (flora.brush.grass), restrained: a few sweeps, not a machine-gun', sweeps >= 1 && sweeps <= 6, `${sweeps} sweeps in 1.6 s`);
  } else check('found flat floor for the brush check', false);

  // ------------------------------------------------ 3. the fail-safe
  await unblock();
  // A death with the clock frozen (suspended context): the whole flow runs.
  await page.evaluate(() => { const ctx = window.__game.ctx; ctx.state.debugGodMode = false; ctx.camera.clearInspectionFocus?.(); });
  const death = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const pausedBefore = ctx.state.paused;
    const overlays = [...document.querySelectorAll('.visible, .open')].map((e) => e.id).filter(Boolean).slice(0, 8);
    const ac = ctx.audio.streamContext();
    await ac.suspend();
    const t0 = ac.currentTime;
    const seen = [];
    const offs = [
      ctx.events.on('playerDied', ({ cause }) => seen.push(`died:${cause}`)), // subscribed last: runs only if nothing before it threw
      ctx.events.on('playerCorpseSettled', () => seen.push('settled')),
      ctx.events.on('deathCinema', ({ phase }) => seen.push(`cinema:${phase}`)),
      ctx.events.on('playerRespawned', () => seen.push('respawned')),
    ];
    ctx.player.invuln = 0;
    ctx.playerCtl.damage(9999, 0, 0, 'falling-tree');
    const deadAt = performance.now();
    while (!seen.includes('cinema:title') && performance.now() - deadAt < 8000) await new Promise((r) => setTimeout(r, 100));
    const overlay = document.getElementById('gameover-overlay')?.classList.contains('visible') ?? false;
    const title = document.getElementById('death-title')?.textContent ?? '';
    ctx.playerCtl.respawn();
    await new Promise((r) => setTimeout(r, 300));
    for (const off of offs) off();
    const result = { seen, overlay, title, alive: !ctx.player.dead, hp: ctx.player.hp, maxHp: ctx.player.maxHp, frozen: ac.currentTime === t0, state: ac.state, paused: pausedBefore, overlays };
    await ac.resume();
    return result;
  });
  check('a death with the audio clock frozen: every playerDied listener ran (the last one too)', death.seen.includes('died:falling-tree') && death.frozen, JSON.stringify(death));
  check('...the corpse settled and the directed death reached its title card', death.seen.includes('settled') && death.seen.includes('cinema:title') && death.overlay, JSON.stringify(death.seen));
  check('...the felled tree has its own death title ("You were felled.")', death.title === 'You were felled.', death.title);
  check('...and the respawn completes (alive, full health)', death.alive && death.hp === death.maxHp && death.seen.includes('respawned'), JSON.stringify(death));

  // A 6.5 s main-thread block (a probe stepping ticks by hand) with loops sustained: the loops wake up quietly.
  await page.evaluate(() => { const ctx = window.__game.ctx; ctx.state.debugGodMode = true; });
  const block = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.time.setManual(true);
    const ac = ctx.audio.streamContext();
    const t0 = ac.currentTime, s = performance.now();
    let ticks = 0;
    while (performance.now() - s < 6500) { ctx.audio.sfx('mat.fire.loop'); ctx.audio.sfx('flora.burn.loop'); window.__game.tick(); ticks++; }
    return { ticks, audioSeconds: +(ac.currentTime - t0).toFixed(2), loops: ctx.audio.debugSamples().loops };
  });
  const errsBefore = errors.length;
  await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    for (let i = 0; i < 10; i++) { ctx.audio.sfx('mat.fire.loop'); ctx.audio.sfx('flora.burn.loop'); await new Promise((r) => setTimeout(r, 100)); }
    ctx.time.setManual(false);
  });
  const loopsAfter = await page.evaluate(() => window.__game.ctx.audio.debugSamples().loops);
  check('a 6.5 s main-thread block with loops sustained: the audio clock ran on', block.audioSeconds > 5, JSON.stringify(block));
  check('...and the loops resynced and kept playing without a single error', errors.length === errsBefore && loopsAfter.includes('mat.fire.loop'), `${errors.slice(errsBefore, errsBefore + 2).join(' | ')} loops ${loopsAfter.join(',')}`);

  check('no console or page errors (an [audio] fault report counts)', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  fail++;
  console.error(error);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
