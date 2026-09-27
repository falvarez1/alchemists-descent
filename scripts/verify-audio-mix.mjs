// Runtime probe for the audio mix (WS-F "Sound & weight"). We cannot listen in a
// headless browser, so the mix is instrumented instead: the engine's
// debugSnapshot() exposes bus/master gains, the limiter and a trace of the last
// voices (bus, pan, gain, muffle), and debugRenderOffline() renders a burst
// through a copy of the real master chain to measure the output peak.
//
// Usage (dev server running): node scripts/verify-audio-mix.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
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
const requests = [];
page.on('request', (r) => requests.push(r.url()));

const clickReal = async (selector, fx = 0.5) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no visible ${selector}`);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height / 2);
};
const snap = () => page.evaluate(() => window.__game.ctx.audio.debugSnapshot());
const boot = async () => {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.ctx && document.body.classList.contains('entry-active'), null, { timeout: 60000 });
};

try {
  // Start from default preferences once; later reloads must see what was saved.
  await context.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('audio-probe-started')) { localStorage.removeItem('ad-player-preferences-v1'); sessionStorage.setItem('audio-probe-started', '1'); }
    } catch { /* storage blocked: defaults */ }
  });
  await boot();

  // ---- Lazy workshop: nothing stamped behind the entry screen. ----
  const behindEntry = await page.evaluate(() => {
    const t = window.__game.ctx.world.types;
    let n = 0;
    for (let i = 0; i < t.length; i += 7) if (t[i] !== 0) n++;
    return n;
  });
  check('the Sandbox workshop is not built behind the entry screen', behindEntry === 0, `${behindEntry} sampled solid cells`);

  // ---- Settings: volume sliders, no Trickshot tuning sliders. ----
  await clickReal('#expedition-entry [data-entry="settings"]');
  await page.waitForSelector('#player-settings[open]');
  const form = await page.evaluate(() => ({
    volume: ['master', 'effects', 'ambience'].map((c) => document.querySelector(`#player-settings [name="volume-${c}"]`)?.value),
    tuning: ['timeScale', 'durationMs', 'chainWindowMs', 'assistDegrees', 'impactPauseMs'].filter((n) => document.querySelector(`#player-settings [name="${n}"]`)),
    trickToggle: Boolean(document.querySelector('#player-settings [name="trickshotEnabled"]')),
  }));
  check('Master / Effects / Ambience sliders exist with sane defaults', form.volume.join(',') === '80,100,80', form.volume.join(','));
  check('Trickshot tuning sliders are gone from player settings', form.tuning.length === 0, form.tuning.join(',') || 'none');
  check('the Trickshot on/off switch remains', form.trickToggle);

  // Real clicks on the slider tracks: master to ~25 %, effects to ~50 %, ambience to ~0.
  await clickReal('#player-settings [name="volume-master"]', 0.25);
  await clickReal('#player-settings [name="volume-effects"]', 0.5);
  await page.locator('#player-settings [name="volume-ambience"]').focus();
  await page.keyboard.press('Home');
  // Sound on every bus so each gain node is processing, then let the 30 ms glides settle.
  await page.evaluate(() => {
    const a = window.__game.ctx.audio;
    for (let i = 0; i < 4; i++) setTimeout(() => { a.tone(300, 300, 0.2, 'sine', 0.01); a.stinger('shutter'); a.bubble(); }, i * 120);
  });
  await page.waitForTimeout(600);
  const s1 = await snap();
  const expectMaster = (s1.volumes.master) ** 2;
  check('the slider interaction created the audio graph', s1.buses !== null && s1.master !== null);
  check('master slider drives the master gain', Math.abs(s1.master - expectMaster) < 0.01 && s1.volumes.master > 0.18 && s1.volumes.master < 0.32,
    `slider ${s1.volumes.master.toFixed(2)} -> gain ${s1.master.toFixed(3)}`);
  check('effects slider drives the fx / voices / ui buses', Math.abs(s1.buses.fx - s1.volumes.effects ** 2) < 0.01 && s1.buses.ui < s1.buses.fx && s1.volumes.effects > 0.4 && s1.volumes.effects < 0.6,
    `fx ${s1.buses.fx.toFixed(3)} voices ${s1.buses.voices.toFixed(3)} ui ${s1.buses.ui.toFixed(3)}`);
  check('ambience slider drives only the ambience bus', s1.buses.ambience < 0.001 && s1.volumes.ambience === 0, `ambience ${s1.buses.ambience.toFixed(3)}`);
  const settled = ['fx', 'ui', 'ambience', 'master'].every((k) => Math.abs(s1.nodeGains[k] - (k === 'master' ? s1.master : s1.buses[k])) < 0.01);
  check('the live gain nodes reached the slider targets', settled, JSON.stringify(Object.fromEntries(Object.entries(s1.nodeGains).map(([k, v]) => [k, +v.toFixed(3)]))));
  check('the limiter is in the master chain', s1.limiter && s1.limiter.threshold <= -1 && s1.limiter.ratio >= 12 && s1.chain.join('>').includes('glue>makeup>limiter>clipper>master'),
    s1.chain.join('>'));
  await page.keyboard.press('Escape');

  // ---- Persist across reload. ----
  await boot();
  const s2 = await snap();
  const sliders = await page.evaluate(() => ['master', 'effects', 'ambience'].map((c) => Number(document.querySelector(`#player-settings [name="volume-${c}"]`)?.value)));
  check('volumes persist across a reload (engine + sliders)',
    Math.abs(s2.volumes.master - s1.volumes.master) < 0.011 && Math.abs(s2.volumes.effects - s1.volumes.effects) < 0.011 && s2.volumes.ambience === s1.volumes.ambience
    && sliders[0] === Math.round(s1.volumes.master * 100),
    `${JSON.stringify(s2.volumes)} sliders ${sliders.join(',')}`);

  // Restore defaults for the rest of the probe (a real click on the settings is not needed here).
  await page.evaluate(() => { localStorage.removeItem('ad-player-preferences-v1'); });
  await boot();

  // ---- Positional: pan and gain move with the source. ----
  const placed = await page.evaluate(() => {
    const audio = window.__game.ctx.audio;
    audio.ensure();
    const { x: lx, y: ly } = audio.debugSnapshot().listener;
    const rows = [];
    for (const dx of [-340, -160, -40, 0, 40, 160, 340, 440]) {
      const before = audio.debugSnapshot().sunk;
      audio.tone(440, 440, 0.05, 'sine', 0.2, lx + dx, ly);
      const after = audio.debugSnapshot();
      const last = after.trace[after.trace.length - 1];
      const played = after.sunk > before;
      rows.push({ dx, played, pan: played ? last.pan : null, gain: played ? last.gain : null, muffleHz: played ? last.muffleHz : null });
    }
    // A voice below the listener: vertical distance counts heavier.
    audio.tone(440, 440, 0.05, 'sine', 0.2, lx, ly + 160);
    const below = audio.debugSnapshot().trace.at(-1);
    audio.tone(440, 440, 0.05, 'sine', 0.2, lx + 160, ly);
    const beside = audio.debugSnapshot().trace.at(-1);
    return { rows, below, beside, lx, ly };
  });
  const byDx = Object.fromEntries(placed.rows.map((r) => [r.dx, r]));
  check('a sound at the listener is centred at full gain', byDx[0].pan === 0 && byDx[0].gain === 1, JSON.stringify(byDx[0]));
  check('pan follows the source left and right',
    byDx[-340].pan < byDx[-160].pan && byDx[-160].pan < byDx[-40].pan && byDx[-40].pan < 0 && byDx[40].pan > 0 && byDx[160].pan < byDx[340].pan,
    placed.rows.map((r) => `${r.dx}:${r.pan?.toFixed(2)}`).join(' '));
  check('gain falls with distance and the far side is muffled',
    byDx[40].gain === 1 && byDx[160].gain < 1 && byDx[340].gain < byDx[160].gain && byDx[340].muffleHz > 0 && byDx[40].muffleHz === 0,
    placed.rows.map((r) => `${r.dx}:${r.gain?.toFixed(2)}/${r.muffleHz}`).join(' '));
  check('every in-range position played; beyond range (440 cells) it is silent', placed.rows.every((r) => r.played === (r.dx !== 440)),
    placed.rows.map((r) => `${r.dx}:${r.played ? 'on' : 'off'}`).join(' '));
  check('vertical distance attenuates harder than horizontal', placed.below.gain < placed.beside.gain, `below ${placed.below.gain.toFixed(2)} beside ${placed.beside.gain.toFixed(2)}`);

  // Explosions carry position through the real call path (sim/explosion.ts).
  const boomTrace = await page.evaluate(() => {
    const { ctx } = window.__game;
    const { x: lx, y: ly } = ctx.audio.debugSnapshot().listener;
    ctx.audio.boom(12, lx + 250, ly);
    return ctx.audio.debugSnapshot().trace.slice(-4);
  });
  check('an explosion is placed: panned right, attenuated, on the fx bus',
    boomTrace.length > 0 && boomTrace.every((t) => t.bus === 'fx' && t.pan > 0.3 && t.gain < 1), JSON.stringify(boomTrace[0]));

  // ---- No harsh clipping when many things explode at once. ----
  const stress = await page.evaluate(async () => {
    const audio = window.__game.ctx.audio;
    const wall = () => {
      for (let i = 0; i < 40; i++) { audio.noiseBurst(0.6, 500, 0.6); audio.tone(95, 28, 0.5, 'sine', 0.55); audio.noiseBurst(0.05, 2400, 0.2, true); }
    };
    const single = () => { audio.noiseBurst(0.6, 500, 0.6); audio.tone(95, 28, 0.5, 'sine', 0.55); };
    return { wall: await audio.debugRenderOffline(1.2, wall), single: await audio.debugRenderOffline(1.2, single) };
  });
  check('forty simultaneous blasts stay under full scale (limiter + soft clip)', stress.wall.peak < 1, `peak ${stress.wall.peak.toFixed(3)}, one blast peak ${stress.single.peak.toFixed(3)}`);
  check('a single blast is still punchy (not squashed to nothing)', stress.single.peak > 0.2, `peak ${stress.single.peak.toFixed(3)}`);

  // ---- Stingers fire on the shared events. ----
  const stingers = await page.evaluate(async () => {
    const { ctx } = window.__game;
    const before = ctx.audio.debugSnapshot().stingers.length;
    ctx.events.emit('alchemyKill', { kind: 'weaver', cause: 'shorted', x: 0, y: 0, chain: 1, bonusGold: 0 });
    ctx.events.emit('alchemyKill', { kind: 'weaver', cause: 'burned', x: 0, y: 0, chain: 4, bonusGold: 0 });
    ctx.events.emit('phialsChanged', { phials: 3, max: 3, reason: 'start' });
    ctx.events.emit('phialsChanged', { phials: 2, max: 3, reason: 'death' });
    ctx.events.emit('phialsChanged', { phials: 3, max: 3, reason: 'refuge' });
    const base = { seed: 1, daily: null, kit: 'spark', floor: 4, floorName: 'x', floorsTotal: 4, timeMs: 1, kills: 0, alchemicalKills: 0, bestChain: 0, deaths: 0, gold: 0, cardsFound: 0, epitaph: '' };
    ctx.events.emit('runEnded', { ...base, outcome: 'victory' });
    ctx.events.emit('runEnded', { ...base, outcome: 'fallen' });
    ctx.events.emit('clipSaved', { url: 'blob:x', filename: 'x.gif', bytes: 1, frames: 1, durationMs: 1 });
    const snapNow = ctx.audio.debugSnapshot();
    const levels = {};
    for (const kind of ['alchemy', 'phialCrack', 'phialFill', 'victory', 'fallen', 'shutter']) {
      levels[kind] = await ctx.audio.debugRenderOffline(3.2, () => ctx.audio.stinger(kind, { chain: 5, cause: 'burned' }));
    }
    return { fired: snapNow.stingers.slice(before), uiVoices: snapNow.trace.filter((t) => t.bus === 'ui').length, levels };
  });
  check('stingers fire on alchemyKill / phialsChanged / runEnded / clipSaved',
    stingers.fired.join(',') === 'alchemy,alchemy,phialCrack,phialFill,victory,fallen,shutter', stingers.fired.join(','));
  check('stingers play on the UI bus', stingers.uiVoices > 0, `${stingers.uiVoices} ui voices in trace`);
  const levelText = Object.entries(stingers.levels).map(([k, v]) => `${k} ${v.peak.toFixed(2)}`).join(', ');
  check('every stinger is audible and none clips', Object.values(stingers.levels).every((v) => v.peak > 0.02 && v.peak < 1), levelText);

  // ---- A run starts cleanly; the Grimoire art loads lazily as WebP. ----
  const grimoireBefore = requests.filter((u) => u.includes('grimoire-open-straight')).length;
  await clickReal('#expedition-entry [data-entry="begin"]');
  await page.waitForFunction(() => {
    const ctx = window.__game?.ctx;
    return ctx?.state?.mode === 'play' && ctx.levels?.current != null && !ctx.levels?.transitioning;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const playListener = await snap();
  const cam = await page.evaluate(() => { const c = window.__game.ctx.camera; return { x: c.x + 320, y: c.y + 180 }; });
  check('in play the listener sits at the camera centre',
    Math.abs(playListener.listener.x - cam.x) < 40 && Math.abs(playListener.listener.y - cam.y) < 40, `${JSON.stringify(playListener.listener)} vs ${JSON.stringify(cam)}`);
  check('the Grimoire art is not fetched before the book opens', grimoireBefore === 0, `${grimoireBefore} requests`);
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => document.querySelector('#grimoire-overlay.open .grimoire-img')?.complete === true
    && document.querySelector('#grimoire-overlay .grimoire-img').naturalWidth > 0, null, { timeout: 15000 });
  const grimoireReqs = requests.filter((u) => u.includes('grimoire-open-straight'));
  check('opening the Grimoire loads its WebP art once', grimoireReqs.length === 1 && grimoireReqs[0].includes('.webp'), grimoireReqs.join(' '));
  await page.keyboard.press('KeyJ');
  check('no console errors across boot, settings, reloads and a run', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  fail++;
  console.error(error);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
