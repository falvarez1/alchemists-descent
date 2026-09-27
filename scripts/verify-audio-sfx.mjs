// Runtime probe for the sampled sound layer (audio/SfxEngine.ts). We cannot
// listen headless, so the layer is instrumented: SampleBank counters, the
// engine's voice trace (bus / pan / gain / muffle), sustained loops, the
// ambience bed, and offline renders of the real master chain.
//
// Checks: no audio is fetched before the first gesture; the core packs decode
// after it; each floor's bed and creature packs load when the floor does (and
// the next floor's at the Sanctum); every AudioApi preset plays a sample, not
// the procedural fallback; positional routing survives; voice limits steal
// instead of stacking; a wall of sampled blasts does not clip; loops sustain
// and fade; UI hover/click/pause sound; decoded-buffer memory is reported.
//
// Usage (dev server running): node scripts/verify-audio-sfx.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5210/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;

const browser = await launchBrowser({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1400, height: 880 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !isBenignDevConsoleError(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const audioRequests = [];
let bytesBeforeGesture = 0;
let gestured = false;
// Real audio fetches only: in dev, the manifest's `?url` imports are tiny JS
// modules (`x.mp3?import&url&no-inline`) that carry a URL string, not audio;
// the file itself is then fetched as `x.mp3?no-inline` (production: a hashed x-<hash>.mp3).
page.on('request', (r) => { if (/\.mp3(\?no-inline)?$/.test(r.url())) audioRequests.push({ url: r.url(), afterGesture: gestured }); });
page.on('response', async (r) => {
  if (gestured) return;
  try { const len = Number(r.headers()['content-length'] ?? 0); bytesBeforeGesture += len; } catch { /* ignore */ }
});

const clickReal = async (selector, fx = 0.5) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no visible ${selector}`);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height / 2);
};
const samples = () => page.evaluate(() => window.__game.ctx.audio.debugSamples());
const waitFor = async (fn, arg, timeout = 30000) => {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 250 }); return true; } catch { return false; }
};

try {
  await context.addInitScript(() => { try { localStorage.clear(); } catch { /* blocked */ } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.ctx && document.body.classList.contains('entry-active'), null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  // ---- Nothing before the first gesture. ----
  const before = await samples();
  check('no audio file is requested before the first gesture', audioRequests.length === 0, `${audioRequests.length} requests`);
  check('the sample bank has not started before the first gesture', before.started === false && before.decodedBytes === 0);

  // ---- First gesture: begin a run. ----
  gestured = true;
  await clickReal('#expedition-entry [data-entry="begin"]');
  await page.waitForFunction(() => {
    const ctx = window.__game?.ctx;
    return ctx?.state?.mode === 'play' && ctx.levels?.current != null && !ctx.levels?.transitioning;
  }, null, { timeout: 60000 });
  const coreReady = await waitFor(() => {
    const s = window.__game.ctx.audio.debugSamples();
    return ['ui', 'player', 'spells', 'world'].every((p) => s.packs[p] === 'ready');
  });
  let s = await samples();
  check('the core packs (ui, player, spells, world) decode after the gesture', coreReady, JSON.stringify(s.packs));
  check('no file failed to fetch or decode', s.filesFailed === 0, `${s.filesDecoded} decoded, ${s.filesFailed} failed`);
  const firstAudio = audioRequests.find((r) => r.afterGesture);
  check('audio is fetched only after interaction', audioRequests.every((r) => r.afterGesture) && Boolean(firstAudio), `${audioRequests.length} requests, all after the gesture`);
  console.log(`      transfer before the gesture: ${mb(bytesBeforeGesture)} (no audio); core decoded: ${mb(s.decodedBytes)} PCM from ${mb(s.bytesFetched)} MP3`);

  // ---- Floor 1: its bed, the Tea Engine and its creatures. ----
  const d1 = await waitFor(() => {
    const s = window.__game.ctx.audio.debugSamples();
    return s.packs['amb-d1'] === 'ready' && s.packs.tea === 'ready' && s.bed === 'amb.bellows';
  });
  s = await samples();
  check('floor 1 loads its bed (the Bellows) and the Bell & Tea Engine, and the bed plays', d1, `bed ${s.bed}; ${Object.keys(s.packs).join(',')}`);
  const d1Creatures = Object.keys(s.packs).filter((p) => p.startsWith('creature-'));
  check('floor 1 loads the packs of the creatures living there', d1Creatures.length > 0, d1Creatures.join(','));
  const d1Flora = await waitFor(() => window.__game.ctx.audio.debugSamples().packs.flora === 'ready');
  s = await samples();
  check("floor 1 loads the plants' pack (flora)", d1Flora, Object.keys(s.packs).join(','));
  console.log(`      decoded PCM on floor 1 (core, bed, Tea Engine, creatures, plants): ${mb(s.decodedBytes)}`);

  // ---- Every AudioApi preset plays a sample (not the procedural fallback). ----
  // (Creature presets need their kind's pack: load them all for this check.)
  await page.evaluate(() => window.__game.ctx.audio.requestPacks(['creature-bat', 'creature-weaver', 'creature-rillback', 'creature-rootloper', 'creature-stonemaw']));
  await waitFor(() => ['creature-bat', 'creature-weaver', 'creature-rillback', 'creature-rootloper', 'creature-stonemaw']
    .every((p) => window.__game.ctx.audio.debugSamples().packs[p] === 'ready'));
  const presets = await page.evaluate(async () => {
    const { ctx } = window.__game;
    const a = ctx.audio;
    const { x: lx, y: ly } = a.debugSnapshot().listener;
    const calls = [
      () => a.boom(3, lx, ly), () => a.boom(9, lx, ly), () => a.boom(20, lx, ly), () => a.zap(lx, ly), () => a.lightning(lx, ly),
      () => a.hollowKnock(lx, ly), () => a.bubble(lx, ly), () => a.shatter(lx, ly), () => a.pickup(), () => a.chest(), () => a.keyJingle(),
      () => a.portalWhoosh(), () => a.learn(), () => a.drinkPotion(), () => a.lever(), () => a.doorGrind(lx, ly), () => a.brazier(lx, ly),
      () => a.sizzle(lx, ly), () => a.steam(lx, ly), () => a.groan(lx, ly), () => a.chirp(lx, ly), () => a.skitter(lx, ly), () => a.drip(lx, ly),
      () => a.dryFire(), () => a.wandSwap(), () => a.sputter(), () => a.heartbeat(), () => a.cardPick(), () => a.cardSlot(),
      () => a.footstep('stone'), () => a.footstep('soft'), () => a.footstep('wet'), () => a.footstep('wood'), () => a.crawlShuffle(),
      () => a.crampedBump(), () => a.landThud(0.3), () => a.landThud(1), () => a.splash(0.3, lx, ly), () => a.splash(1, lx, ly), () => a.alert(),
      () => a.gong(), () => a.coin(3), () => a.hurt(), () => a.jump(), () => a.squelch(lx, ly), () => a.flame(lx, ly), () => a.implode(lx, ly),
      () => a.finisherWhip(), () => a.shellCrack(), () => a.chitin(1), () => a.chirr(0.3, 1, 0.07), () => a.slither(1), () => a.creak(1),
      () => a.grind(1), () => a.squeak(), () => a.hop(1), () => a.deathCry('weaver'), () => a.deathCry('rillback'),
      () => a.stinger('alchemy', { chain: 3, cause: 'burned', x: lx }), () => a.stinger('phialCrack'), () => a.stinger('shutter'),
      () => a.worldSound('stone', lx, ly), () => a.worldSound('metal', lx, ly),
    ];
    const results = [];
    for (let i = 0; i < calls.length; i++) {
      const b = a.debugSamples();
      calls[i]();
      const after = a.debugSamples();
      results.push({ i, sampled: after.played > b.played || after.dropped > b.dropped, fellBack: after.fellBack > b.fellBack, last: after.lastPlayed.at(-1) });
      await new Promise((r) => setTimeout(r, 70));
    }
    return results;
  });
  const fellBack = presets.filter((r) => r.fellBack || !r.sampled);
  check(`every AudioApi preset plays a sample (${presets.length} presets exercised)`, fellBack.length === 0, fellBack.map((r) => `#${r.i}`).join(' '));

  // ---- Positional routing survives the sampled layer. ----
  const placed = await page.evaluate(() => {
    const a = window.__game.ctx.audio;
    const { x: lx, y: ly } = a.debugSnapshot().listener;
    const out = {};
    a.sfx('boom.medium', lx + 250, ly);
    out.right = a.debugSnapshot().trace.at(-1);
    a.sfx('mat.zap', lx - 200, ly);
    out.left = a.debugSnapshot().trace.at(-1);
    const n = a.debugSnapshot().sunk;
    a.sfx('mat.shatter', lx + 2000, ly);
    out.farPlayed = a.debugSnapshot().sunk > n;
    a.at(lx + 120, ly, () => a.creature('weaver', 'alert'));
    out.creature = a.debugSnapshot().trace.at(-1);
    return out;
  });
  check('a sampled blast to the right pans right, attenuates and sits on the fx bus',
    placed.right.bus === 'fx' && placed.right.pan > 0.3 && placed.right.gain < 1, JSON.stringify(placed.right));
  check('a sampled zap to the left pans left', placed.left.pan < -0.2, JSON.stringify(placed.left));
  check('a sound beyond its range is silent', placed.farPlayed === false);
  check('a creature voice placed with at() lands on the voices bus, panned', placed.creature.bus === 'voices' && placed.creature.pan > 0.1, JSON.stringify(placed.creature));

  // ---- Voice limits steal instead of stacking. ----
  const storm = await page.evaluate(async () => {
    const a = window.__game.ctx.audio;
    const { x: lx, y: ly } = a.debugSnapshot().listener;
    const ids = ['boom.small', 'boom.medium', 'mat.zap', 'mat.shatter', 'mat.steam', 'mat.ignite', 'mat.squelch',
      'mat.splash.small', 'mat.splash.big', 'mat.hollow', 'body.impact.wood', 'body.impact.stone', 'body.impact.metal', 'body.smash.wood',
      'body.smash.stone', 'body.bash', 'creature.hit', 'creature.gib', 'spell.spark.impact', 'spell.ice.impact', 'spell.freeze',
      'spell.conjure', 'spell.vitrify', 'spell.crit.wet', 'spell.crit.shatter', 'spell.crit.pyre', 'spell.charge.electric',
      'spell.charge.frost', 'spell.lightning', 'spell.blackhole.implode', 'mech.lever', 'mech.door', 'mech.groan', 'mech.plate',
      'mech.scale', 'mech.latch', 'mech.counterweight', 'mech.plug', 'mech.dispenser', 'creature.dodge', 'critter.chirp',
      'critter.skitter', 'mat.drip', 'mat.bubble', 'mat.sizzle', 'world.waystone', 'player.jump', 'player.kick', 'player.slam',
      'player.land.hard'];
    const b = a.debugSamples();
    for (const id of ids) a.sfx(id, lx + 20, ly);
    // The explosion is the loudest-ranked cue: it must still find a voice in a full pool.
    const bb = a.debugSamples();
    a.sfx('boom.large', lx - 30, ly);
    const after = a.debugSamples();
    return { cues: ids.length, active: after.activeVoices, stolen: after.stolen - b.stolen, dropped: after.dropped - b.dropped,
      explosionGotAVoice: after.played > bb.played };
  });
  check('fifty-one distinct cues at once never exceed the 40-voice pool; low ranks are stolen, a blast still plays',
    storm.active <= 40 && storm.stolen > 0 && storm.explosionGotAVoice, JSON.stringify(storm));

  // ---- A wall of sampled blasts does not clip; one is still punchy. ----
  const renders = await page.evaluate(async () => {
    const a = window.__game.ctx.audio;
    const wall = await a.debugRenderOffline(2.5, () => { for (let i = 0; i < 40; i++) { a.sfx('boom.large'); a.sfx('boom.medium'); } });
    const single = await a.debugRenderOffline(2.5, () => a.sfx('boom.medium'));
    const step = await a.debugRenderOffline(0.8, () => a.sfx('player.step.stone'));
    const click = await a.debugRenderOffline(0.6, () => a.sfx('ui.click'));
    const spark = await a.debugRenderOffline(0.8, () => a.sfx('spell.spark.cast'));
    return { wall, single, step, click, spark };
  });
  check('eighty sampled blasts at once stay under full scale', renders.wall.peak < 1, `peak ${renders.wall.peak.toFixed(3)}`);
  check('a single sampled blast is punchy', renders.single.peak > 0.2, `peak ${renders.single.peak.toFixed(3)}`);
  check('the mix is layered: blast > spark > footstep, UI quiet',
    renders.single.rms > renders.spark.rms && renders.spark.rms > renders.step.rms && renders.click.peak < renders.single.peak,
    Object.entries(renders).map(([k, v]) => `${k} pk ${v.peak.toFixed(2)} rms ${v.rms.toFixed(3)}`).join(' | '));

  // ---- Loops sustain while called and fade when the calls stop. ----
  const loop = await page.evaluate(async () => {
    const a = window.__game.ctx.audio;
    const { x: lx, y: ly } = a.debugSnapshot().listener;
    for (let i = 0; i < 8; i++) { a.sfx('mat.lava.loop', lx + 100, ly, { gain: 1 }); await new Promise((r) => setTimeout(r, 120)); }
    const during = a.debugSamples().loops.includes('mat.lava.loop');
    await new Promise((r) => setTimeout(r, 1400));
    const after = a.debugSamples().loops.includes('mat.lava.loop');
    return { during, after };
  });
  check('a material loop sustains while refreshed and fades once the calls stop', loop.during && !loop.after, JSON.stringify(loop));

  // ---- Real-world sounds from the running game: the scanner hears the materials on screen. ----
  const scanned = await page.evaluate(async () => {
    const { ctx } = window.__game;
    const w = ctx.world;
    const cx = Math.floor(ctx.camera.x + 320), cy = Math.floor(ctx.camera.y + 200);
    // A cup of lava in metal on screen (contained so it cannot run).
    for (let x = cx - 12; x <= cx + 12; x++) for (let y = cy; y <= cy + 10; y++) {
      const edge = x === cx - 12 || x === cx + 12 || y === cy + 10;
      if (w.inBounds(x, y)) w.types[w.idx(x, y)] = edge ? 13 : 11;
    }
    await new Promise((r) => setTimeout(r, 1500));
    return ctx.audio.debugSamples().loops;
  });
  check('lava placed on screen is heard: the material scanner sustains the lava loop', scanned.includes('mat.lava.loop'), scanned.join(','));

  // ---- UI: hover and click on a real button, pause and resume. ----
  await page.keyboard.press('Escape');
  const paused = await waitFor(() => document.getElementById('pause-overlay')?.classList.contains('visible'), null, 5000);
  await page.waitForTimeout(250);
  let recent = (await samples()).lastPlayed;
  check('opening the pause menu closes a steam valve (ui.pause)', paused && recent.includes('ui.pause'), recent.slice(-4).join(','));
  const resume = await page.locator('#pause-resume').boundingBox();
  if (resume) {
    await page.mouse.move(resume.x + 5, resume.y + resume.height / 2);
    await page.waitForTimeout(150);
    await page.mouse.move(resume.x + resume.width / 2, resume.y + resume.height / 2);
    await page.waitForTimeout(150);
    recent = (await samples()).lastPlayed;
    check('hovering a menu button ticks (ui.hover)', recent.includes('ui.hover'), recent.slice(-4).join(','));
    await page.mouse.click(resume.x + resume.width / 2, resume.y + resume.height / 2);
    await page.waitForTimeout(300);
    recent = (await samples()).lastPlayed;
    check('clicking Resume clicks and reopens the valve (ui.click + ui.resume)', recent.includes('ui.click') && recent.includes('ui.resume'), recent.slice(-5).join(','));
  } else check('the pause menu has a Resume button', false);

  // ---- Floors 2–4: each loads its own bed and roster; the Sanctum prefetches the next. ----
  let peakDecoded = (await samples()).decodedBytes;
  for (const [id, bed, boss] of [['d2', 'amb.rot', null], ['d3', 'amb.cisterns', 'creature-leviathan'], ['d4', 'amb.kiln', 'creature-colossus']]) {
    const prevId = await page.evaluate(() => window.__game.ctx.levels.current.def.id);
    // Sanctum prefetch: open the between-floors Sanctum on the floor above.
    const prefetched = await page.evaluate(async ({ next }) => {
      const { ctx } = window.__game;
      if (!ctx.levels.current?.def.nextLevelId) return null;
      const open = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ctx.sanctum), 'isOpen');
      Object.defineProperty(ctx.sanctum, 'isOpen', { configurable: true, get: () => true });
      await new Promise((r) => setTimeout(r, 1200));
      const packs = ctx.audio.debugSamples().packs;
      delete ctx.sanctum.isOpen;
      void open;
      return { packs, next };
    }, { next: id });
    if (prefetched) {
      const wantBed = { d2: 'amb-d2', d3: 'amb-d3', d4: 'amb-d4' }[id];
      check(`at the Sanctum on ${prevId}, the next floor (${id}) is prefetched`, Boolean(prefetched.packs[wantBed]), Object.keys(prefetched.packs).join(','));
    }
    await page.evaluate((next) => {
      const { ctx } = window.__game;
      ctx.levels.leaveLevel();
      ctx.levels.enterLevel(ctx, next);
    }, id);
    const ok = await waitFor(({ bed, boss }) => {
      const s = window.__game.ctx.audio.debugSamples();
      const bedPack = { 'amb.rot': 'amb-d2', 'amb.cisterns': 'amb-d3', 'amb.kiln': 'amb-d4' }[bed];
      return s.bed === bed && s.packs[bedPack] === 'ready' && (!boss || s.packs[boss] === 'ready');
    }, { bed, boss }, 40000);
    s = await samples();
    peakDecoded = Math.max(peakDecoded, s.decodedBytes);
    const creatures = Object.entries(s.packs).filter(([p, st]) => p.startsWith('creature-') && st === 'ready').map(([p]) => p.slice(9));
    check(`${id}: the ${bed} bed crossfades in and its creatures load${boss ? ` (with ${boss.slice(9)})` : ''}`, ok, `bed ${s.bed}; creatures ${creatures.join(',')}`);
  }
  s = await samples();
  check('no file failed to fetch or decode across four floors', s.filesFailed === 0, `${s.filesDecoded} decoded`);
  const rates = await page.evaluate(() => {
    const bank = window.__game.ctx.audio.bank;
    return { click: bank.get('ui.click')?.[0]?.sampleRate, step: bank.get('player.step.stone')?.[0]?.sampleRate, bed: bank.get('amb.kiln')?.[0]?.sampleRate };
  });
  check('buffers decode at their family rate (UI 44.1 kHz, bodies 32 kHz, beds 24 kHz)', rates.click === 44100 && rates.step === 32000 && rates.bed === 24000, JSON.stringify(rates));
  console.log(`      decoded PCM held after touring all four floors: ${mb(s.decodedBytes)} (fetched ${mb(s.bytesFetched)} of MP3)`);
  // Steady state: 30 s later the floors left behind are released.
  await page.waitForTimeout(32000);
  s = await samples();
  const held = Object.keys(s.packs);
  check('packs of floors left behind are released (core + this floor stay)', !held.includes('amb-d1') && !held.includes('tea') && held.includes('amb-d4') && held.includes('ui'),
    held.join(','));
  console.log(`      decoded PCM in steady state on floor 4: ${mb(s.decodedBytes)}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  fail++;
  console.error(error);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
