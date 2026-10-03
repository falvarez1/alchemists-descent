// Real media elements and WebAudio signal, including a native loop wrap.
// This is technical playback verification, not a claim of human listening approval.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
const browser = await launchBrowser({ args: ['--autoplay-policy=user-gesture-required'] });
const checks = [], errors = [], requests = [];
const check = (name, pass, data) => { assert.ok(pass, name); checks.push({ name, data }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (/\/music\/arena\//.test(r.url())) requests.push({ url: r.url(), status: r.status() }); });
  await page.addInitScript(() => {
    window.probeAudio = [];
    const NativeAudio = window.Audio;
    window.Audio = function(...args) { const el = new NativeAudio(...args); window.probeAudio.push(el); return el; };
    window.Audio.prototype = NativeAudio.prototype;
  });
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5217/') + '?link=off', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.ctx?.music);
  check('no music download before gesture', requests.length === 0);
  const snapshot = () => page.evaluate(() => window.__game.ctx.music.debugSnapshot());
  const cue = async id => { await page.waitForFunction(id => { const s = window.__game.ctx.music.debugSnapshot(); return s.cue === id && s.voices.some(v => v.id === id && v.started && !v.paused); }, id, { timeout: 20000 }); return snapshot(); };
  await page.locator('[data-entry="duel"]').click();
  check('Duel lobby starts the new select cue', (await cue('arena-lobby')).cue === 'arena-lobby');
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await page.locator('#versus-start').click();
  await page.locator('#versus-lobby').waitFor({ state: 'hidden' });
  check('visible match launch starts battle music', (await cue('arena-battle')).cue === 'arena-battle');
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    const ac = c.audio.streamContext();
    window.probeAnalyser = ac.createAnalyser(); window.probeAnalyser.fftSize = 2048;
    c.music.master.connect(window.probeAnalyser);
  });
  await page.waitForTimeout(1500);
  const rms = await page.evaluate(() => { const data = new Float32Array(window.probeAnalyser.fftSize); window.probeAnalyser.getFloatTimeDomainData(data); return Math.sqrt(data.reduce((sum, x) => sum + x*x, 0) / data.length); });
  check('decoded battle audio produces a nonzero WebAudio signal', rms > 0.002, rms);
  await page.evaluate(() => { const c = window.__game.ctx; c.player.dead = true; c.events.emit('playerDied', { depth: 0, level: 'fighter-duel', gold: 0, cause: 'rival' }); c.music.update(); });
  const dead = await snapshot();
  check('individual stock death keeps battle cue and full master target', dead.cue === 'arena-battle' && dead.masterTarget === 1, dead.masterTarget);
  await page.evaluate(async () => { const c = window.__game.ctx; c.player.dead = false; c.events.emit('playerDeathCleared'); const { createPlayerChill } = await import('/src/entities/chill.ts'); c.player.chill = { ...createPlayerChill(), musicRate: 0.8, musicCutoff: 1100 }; });
  await page.waitForTimeout(150);
  check('fighter chill cannot detune competitive music', (await snapshot()).tape.rate === 1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.ctx.music.debugSnapshot().masterTarget === 0.6);
  check('pause ducks battle music', (await snapshot()).masterTarget === 0.6);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.ctx.music.debugSnapshot().masterTarget === 1);
  await page.evaluate(() => { const el = window.probeAudio.findLast(el => el.src.includes('arena-battle.mp3')); el.currentTime = el.duration - 0.3; });
  await page.waitForTimeout(850);
  const loop = await page.evaluate(() => { const el = window.probeAudio.findLast(el => el.src.includes('arena-battle.mp3')); return { time: el.currentTime, loop: el.loop, paused: el.paused, ready: el.readyState, elements: window.probeAudio.filter(el => el.src.includes('arena-battle.mp3')).length }; });
  check('native authored loop wraps without a second simultaneous battle voice', loop.loop && !loop.paused && loop.time < 2 && loop.elements === 1, loop);
  await page.evaluate(() => {
    const g = window.__game, c = g.ctx; c.state.paused = true;
    c.arena.stockMatch.fighters[1].stocks = 1;
    const p = c.arena.bundle(1).player; p.x = 1390; p.y = 600;
    for (let i = 0; i < 5; i++) g.tick(false, { forcePaused: true });
    c.music.update();
  });
  check('match result starts the new fanfare', (await cue('arena-results')).cue === 'arena-results');
  await page.evaluate(() => { const el = window.probeAudio.findLast(el => el.src.includes('arena-results.mp3')); el.currentTime = el.duration - 0.2; });
  check('completed fanfare yields to rematch lobby groove', (await cue('arena-lobby')).cue === 'arena-lobby');
  await page.evaluate(() => { window.__game.ctx.versus.rematch(); window.__game.ctx.state.paused = false; });
  check('rematch restarts battle at the opening', (await cue('arena-battle')).voices.some(v => v.id === 'arena-battle' && v.offset === 0 && !v.stopping));
  await page.keyboard.press('Escape'); await page.locator('#pause-title-btn').click();
  check('leaving versus restores title cue', (await cue('title')).cue === 'title');
  await page.evaluate(async () => { const c = window.__game.ctx; await c.console.exec('run test --level fighter-test --world campaign-level'); });
  check('solo Arena also uses battle music', (await cue('arena-battle')).cue === 'arena-battle');
  await page.evaluate(async () => { const c = window.__game.ctx; await c.console.exec('run test --level d1 --world campaign-level'); });
  check('campaign restores its own score', (await cue('bellows')).cue === 'bellows');
  check('all new music responses succeed', requests.length >= 3 && requests.every(r => r.status === 200 || r.status === 206), requests);
  if (errors.length) console.log(JSON.stringify(errors));
  check('no browser exceptions', errors.length === 0, errors);
  writeFileSync('docs/arena/platform-fighter/evidence/arena-music.json', JSON.stringify({ checks, errors, requests }, null, 2));
} finally { await browser.close(); }
