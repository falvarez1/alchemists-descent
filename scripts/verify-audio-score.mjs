// Runtime probe for the score and the narrator (audio/MusicDirector,
// audio/Narrator). Headless, so nothing is listened to: the director and the
// narrator are instrumented instead (debugSnapshot), network traffic is
// recorded, and gains are sampled over time.
//
// Usage (dev server running): node scripts/verify-audio-score.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ args: ['--autoplay-policy=user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1400, height: 880 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !isBenignDevConsoleError(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const audioRequests = [];
let transferred = 0;
page.on('requestfinished', async (req) => {
  const u = req.url();
  if (/\/audio\/(music|voice)\//.test(u)) audioRequests.push({ url: u.replace(/^.*\/audio\//, 'audio/'), at: Date.now() });
  try { const s = await req.sizes(); transferred += s.responseBodySize + s.responseHeadersSize; } catch { /* aborted */ }
});

const music = () => page.evaluate(() => window.__game.ctx.music.debugSnapshot());
const narrator = () => page.evaluate(() => window.__game.ctx.narrator.debugSnapshot());
const engine = () => page.evaluate(() => window.__game.ctx.audio.debugSnapshot());
const waitFor = async (fn, ms = 8000, step = 150) => {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); }
};
const cueIs = (id, ms) => waitFor(async () => (await music()).cue === id, ms);
const spokenIncludes = async (re) => (await narrator()).spoken.filter((s) => re.test(s.text));
const clickReal = async (selector, fx = 0.5, fy = 0.5) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no visible ${selector}`);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
};

try {
  await context.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('score-probe-started')) {
        localStorage.removeItem('ad-player-preferences-v1');
        sessionStorage.setItem('score-probe-started', '1');
      }
    } catch { /* storage blocked */ }
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.ctx?.music && document.body.classList.contains('entry-active'), null, { timeout: 60000 });
  await sleep(2500);

  console.log('\n-- before the first gesture');
  const before = await music();
  check('no music before the first gesture', before.cue === null && before.gestured === false && before.voices.length === 0);
  check('no score or narration fetched before the first gesture', audioRequests.length === 0, audioRequests.map((r) => r.url).join(', '));
  const firstLoad = transferred;
  const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  console.log(`     first-load transfer ${(firstLoad / 1048576).toFixed(2)} MB; JS heap ${(heap0 / 1048576).toFixed(1)} MB`);

  console.log('\n-- the title');
  await clickReal('#expedition-title');
  check('the first gesture starts the title theme', Boolean(await cueIs('title', 4000)));
  const rise = [];
  for (let i = 0; i < 26; i++) { const s = await music(); const v = s.voices.find((x) => x.id === 'title'); rise.push(v ? Number(v.gain.toFixed(3)) : null); await sleep(200); }
  const risen = rise.filter((g) => g !== null && g > 0);
  check('the title fades in (equal-power ramp up)', risen.length > 5 && risen.at(-1) > 0.85 && risen.every((g, i) => i === 0 || g >= risen[i - 1] - 1e-3), rise.join(' '));
  check('only the title cue was fetched (plus the tagline clip)', audioRequests.filter((r) => /\/music\//.test(r.url)).every((r) => /music\/title\.mp3/.test(r.url)), audioRequests.map((r) => r.url).join(', '));
  const tagline = await waitFor(() => spokenIncludes(/^Something is alive/).then((a) => a.length > 0), 7000);
  check('the narrator reads the tagline after the theme opens', Boolean(tagline));
  const talk = await waitFor(async () => { const e = await engine(); return e.talk?.active ? e.talk : null; }, 2000, 60);
  check('narration ducks the score and the bed', Boolean(talk) && talk.music < 0.95, talk ? `music ${talk.music.toFixed(2)} ambience ${talk.ambience.toFixed(2)}` : 'no duck seen');
  const released = await waitFor(async () => { const e = await engine(); return !e.talk.active && e.talk.music > 0.97 ? e.talk : null; }, 14000, 200);
  check('the duck releases after the line', Boolean(released));

  console.log('\n-- settings');
  await clickReal('#expedition-entry [data-entry="settings"]');
  await page.waitForSelector('#player-settings[open]');
  const hasSliders = await page.evaluate(() => ['music', 'voice'].every((c) => document.querySelector(`#player-settings [name="volume-${c}"]`)) && Boolean(document.querySelector('#player-settings [name="narration"]')));
  check('Music and Voice sliders and a Narration switch exist', hasSliders);
  await clickReal('#player-settings [name="volume-music"]', 0.25);
  await clickReal('#player-settings [name="volume-voice"]', 0.6);
  await clickReal('#player-settings [name="narration"]');
  const set = await page.evaluate(() => ({ vol: window.__game.ctx.audio.debugSnapshot().volumes, narr: window.__game.ctx.narrator.enabled, music: window.__game.ctx.audio.debugSnapshot().buses.music }));
  check('the Music slider applies live', Math.abs(set.vol.music - 0.25) < 0.06, `music ${set.vol.music}, bus ${set.music.toFixed(3)}`);
  check('the Voice slider applies live', Math.abs(set.vol.voice - 0.6) < 0.06, `voice ${set.vol.voice}`);
  check('Narration switches off', set.narr === false);
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ctx?.music && document.body.classList.contains('entry-active'), null, { timeout: 60000 });
  const kept = await page.evaluate(() => ({ vol: window.__game.ctx.audio.volume('music'), voice: window.__game.ctx.audio.volume('voice'), narr: window.__game.ctx.narrator.enabled }));
  check('volumes and the Narration switch persist across a reload', Math.abs(kept.vol - 0.25) < 0.06 && Math.abs(kept.voice - 0.6) < 0.06 && kept.narr === false, JSON.stringify(kept));
  // Back to defaults for the rest of the probe.
  await page.evaluate(() => localStorage.removeItem('ad-player-preferences-v1'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ctx?.music && document.body.classList.contains('entry-active'), null, { timeout: 60000 });
  audioRequests.length = 0;

  console.log('\n-- the Bellows');
  await clickReal('#expedition-entry [data-entry="begin"]');
  await page.waitForFunction(() => window.__game.ctx.state.mode === 'play' && !document.body.classList.contains('entry-active'), null, { timeout: 60000 });
  check('a run on floor 1 plays the Bellows', Boolean(await cueIs('bellows', 8000)), (await music()).cue);
  await page.evaluate(() => { window.__game.ctx.state.debugGodMode = true; });
  const arrival = await waitFor(() => spokenIncludes(/^The Bellows\. /).then((a) => a.length > 0), 9000);
  check('the narrator reads the Bellows arrival after the title card', Boolean(arrival));
  const arrivalAt = (await spokenIncludes(/^The Bellows\. /))[0]?.at;

  console.log('\n-- hunted');
  const spawned = await page.evaluate(() => {
    const ctx = window.__game.ctx, p = ctx.player;
    const out = [];
    for (const dx of [-26, 30, 44]) { const e = ctx.enemyCtl.spawn('weaver', p.x + dx, p.y - 2); if (e) out.push(e); }
    return out.length;
  });
  // Pin the spawned creatures' attention the way their perception would, so the probe does not depend on line of sight.
  const pin = setInterval(() => page.evaluate(() => {
    const ctx = window.__game.ctx;
    for (const e of ctx.enemies) if (e.kind === 'weaver' && e.mind) { e.alerted = true; e.mind.intent = 'hunt'; e.mind.visible = true; e.x = Math.max(e.x, 0); }
  }).catch(() => undefined), 120);
  const tStart = Date.now();
  const tense = await cueIs('bellows-tension', 6000);
  check('a creature hunting nearby raises the hunted layer', Boolean(tense), `spawned ${spawned}, after ${Date.now() - tStart} ms`);
  const xf = [];
  for (let i = 0; i < 14; i++) {
    const s = await music();
    const a = s.voices.find((v) => v.id === 'bellows' && v.stopping), b = s.voices.find((v) => v.id === 'bellows-tension');
    if (a && b) xf.push([a.gain, b.gain]);
    await sleep(120);
  }
  const power = xf.map(([a, b]) => (a / 0.82) ** 2 + b ** 2);
  check('calm crossfades into hunted without a dip (equal power)', xf.length >= 3 && power.every((p) => p > 0.85 && p < 1.15),
    xf.length ? xf.map(([a, b]) => `${a.toFixed(2)}/${b.toFixed(2)}`).join(' ') : JSON.stringify(await music()).slice(0, 900));
  clearInterval(pin);
  await page.evaluate(() => { const ctx = window.__game.ctx; for (const e of [...ctx.enemies]) if (e.kind === 'weaver') ctx.enemyCtl.kill(e, 0, 0); });
  const calmAgain = await cueIs('bellows', 14000);
  check('the hunted layer holds through a breath, then returns to calm', Boolean(calmAgain));
  const resumed = (await music()).voices.find((v) => v.id === 'bellows' && !v.stopping);
  check('calm resumes where it left off, not from the top', resumed && resumed.offset > 3 && resumed.time >= resumed.offset - 0.5,
    resumed ? `offset ${resumed.offset.toFixed(1)} s, now ${resumed.time.toFixed(1)} s` : 'no voice');

  console.log('\n-- a loop wraps');
  const seek = await page.evaluate(() => {
    // Jump the playing calm cue to just before its measured way out (score.generated.ts tailSec).
    const director = window.__game.ctx.music;
    const v = director.voices.find((x) => !x.stopping && x.track.id === 'bellows');
    if (!v) return null;
    v.el.currentTime = v.el.duration - v.track.tailSec - 5 - 0.1;
    return { to: v.el.currentTime, head: v.track.headSec };
  });
  const wrapped = await waitFor(async () => {
    const s = await music();
    const incoming = s.voices.find((v) => v.id === 'bellows' && !v.stopping && v.offset === seek?.head);
    const outgoing = s.voices.find((v) => v.id === 'bellows' && v.stopping);
    return incoming && outgoing && incoming.gain > 0.05 && outgoing.gain < 0.8 ? { incoming, outgoing } : null;
  }, 4000, 150);
  check('a loop crossfades its tail into its head', Boolean(seek) && Boolean(wrapped),
    wrapped ? `head ${wrapped.incoming.offset}s in at ${wrapped.incoming.gain.toFixed(2)}, tail out at ${wrapped.outgoing.gain.toFixed(2)}` : JSON.stringify(seek));
  await waitFor(async () => (await music()).voices.length === 1, 8000);

  console.log('\n-- a boss');
  await page.evaluate(() => { const ctx = window.__game.ctx, p = ctx.player; const e = ctx.enemyCtl.spawn('leviathan', p.x + 60, p.y - 4); if (e) e.alerted = true; });
  check('an engaged boss takes the Leviathan theme', Boolean(await cueIs('boss-leviathan', 4000)));
  const beat = await waitFor(() => spokenIncludes(/^The Sunken Leviathan/).then((a) => a.length > 0), 5000);
  const caption = await page.evaluate(() => document.querySelector('#narration-caption.show')?.textContent ?? '');
  check('the narrator names the boss, captioned (no text on screen says it)', Boolean(beat) && /Leviathan/.test(caption), caption);
  await page.evaluate(() => { const ctx = window.__game.ctx; for (const e of [...ctx.enemies]) if (e.kind === 'leviathan') ctx.enemyCtl.kill(e, 0, 0); });
  check('a slain boss releases its theme at once', Boolean(await cueIs('bellows', 6000)));

  console.log('\n-- the Tea Engine');
  await page.evaluate(() => window.__game.ctx.events.emit('contraptionView', { visible: true, title: 'Percussive maintenance', detail: 'The heavy pendulum swings free and introduces itself to a boulder.', stage: 4, stalled: false, fault: null }));
  check('the engine running plays its cue', Boolean(await cueIs('tea-engine', 4000)));
  await page.evaluate(() => window.__game.ctx.events.emit('contraptionView', { visible: false, title: '', detail: '', stage: 4, stalled: false, fault: null }));
  check('leaving the engine returns to the floor', Boolean(await cueIs('bellows', 5000)));

  console.log('\n-- manners');
  await waitFor(async () => { const n = await narrator(); return n.speaking === null && n.cooldownMs === 0; }, 15000, 250);
  await page.evaluate(() => window.__game.ctx.events.emit('toast', { text: 'THE SUMP FALLS STILL' }));
  const during = await waitFor(async () => { const n = await narrator(); return n.speaking ? n : null; }, 3000, 50);
  // A low line while one speaks is not said at all.
  await page.evaluate(() => window.__game.ctx.events.emit('objectiveChanged', { text: 'Bring down the Kiln Colossus.' }));
  const after = await waitFor(async () => { const n = await narrator(); return n.speaking === null ? n : null; }, 8000, 100);
  check('nothing talks over a line', Boolean(during) && (await spokenIncludes(/Kiln Colossus/)).length === 0);
  check('a cooldown follows a line', Boolean(after) && after.cooldownMs > 4000, `cooldown ${after?.cooldownMs} ms`);
  await page.evaluate(() => window.__game.ctx.events.emit('objectiveChanged', { text: 'Drain the Sunken Leviathan.' }));
  await sleep(600);
  check('a low line inside the cooldown is dropped', (await spokenIncludes(/Drain the Sunken/)).length === 0);
  await sleep(Math.max(0, (after?.cooldownMs ?? 0) + 300));
  await page.evaluate(() => window.__game.ctx.events.emit('toast', { text: 'THE SUMP FALLS STILL' }));
  await sleep(600);
  check('the same words are never said twice a session', (await spokenIncludes(/sump/i)).length === 1);
  const arrivals = (await spokenIncludes(/^The Bellows\. /)).length;
  check('the arrival was read exactly once', arrivals === 1 && arrivalAt > 0);

  console.log('\n-- the Sanctum');
  await page.evaluate(() => window.__game.ctx.sanctum.open(window.__game.ctx, () => undefined));
  check('the Sanctum plays its rest', Boolean(await cueIs('sanctum', 5000)));
  // The Sanctum stays open, so its line waits out any cooldown rather than being lost.
  const below = await waitFor(() => spokenIncludes(/^The gut\./).then((a) => a.length > 0), 12000);
  check('the narrator reads the look below', Boolean(below));
  await page.evaluate(() => window.__game.ctx.sanctum.close());
  check('closing the Sanctum returns to the floor', Boolean(await cueIs('bellows', 5000)));

  console.log('\n-- hidden tab');
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  const hidden = await waitFor(() => page.evaluate(() => document.hidden), 3000);
  if (hidden) {
    const h = await waitFor(async () => { const s = await music(); return s.hidden && s.voices.every((v) => v.paused) ? s : null; }, 4000);
    check('a hidden tab fades out and pauses the score', Boolean(h));
    await page.bringToFront();
    const back = await waitFor(async () => { const s = await music(); return !s.hidden && s.voices.some((v) => !v.paused) ? s : null; }, 4000);
    check('showing the tab resumes it', Boolean(back));
  } else {
    // Headless keeps background tabs visible: drive the same code path through the document's own event.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const h = await waitFor(async () => { const s = await music(); return s.hidden && s.voices.every((v) => v.paused) && s.master < 0.01 ? s : null; }, 4000);
    check('a hidden tab fades out and pauses the score (visibilitychange)', Boolean(h), h ? '' : JSON.stringify(await music()).slice(0, 400));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    const back = await waitFor(async () => { const s = await music(); return !s.hidden && s.voices.some((v) => !v.paused) ? s : null; }, 4000);
    check('showing the tab resumes it', Boolean(back));
  }
  await other.close();

  console.log('\n-- a fall that ends the run');
  const died = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    ctx.state.debugGodMode = false;
    if (ctx.run?.state) ctx.run.state.phials = 0;
    ctx.playerCtl.kill('lava');
    await new Promise((r) => setTimeout(r, 400));
    return { over: ctx.run?.over, dead: ctx.player.dead, master: ctx.music.debugSnapshot().masterTarget };
  });
  check('the final death ends the run', died.over === true && died.dead === true, JSON.stringify(died));
  check('the fallen verdict plays', Boolean(await cueIs('fallen', 5000)));
  const deathLine = await waitFor(() => spokenIncludes(/^You melted\./).then((a) => a.length > 0), 12000);
  check('the narrator reads the death title and its cause', Boolean(deathLine));
  const ledgerBtn = await waitFor(() => page.evaluate(() => document.getElementById('ledger-btn')?.checkVisibility() === true), 15000);
  if (ledgerBtn) {
    await clickReal('#ledger-btn');
    const headline = await waitFor(() => spokenIncludes(/^You fell in the Bellows\./).then((a) => a.length > 0), 8000);
    check('the ledger headline is read', Boolean(headline));
    const underLedger = await waitFor(async () => { const s = await music(); return s.cue === 'title' && s.masterTarget < 0.7 ? s : null; }, 30000, 400);
    check('the theme returns softly under the ledger after the verdict', Boolean(underLedger));

    console.log('\n-- victory');
    await clickReal('#run-summary [data-rs="again"]');
    await page.waitForFunction(() => window.__game.ctx.state.mode === 'play' && !document.querySelector('#run-summary:not([hidden])'), null, { timeout: 60000 });
    await cueIs('bellows', 8000);
    await page.evaluate(() => window.__game.ctx.events.emit('runComplete', { gold: 0 }));
    const silentFirst = await waitFor(async () => (await music()).cue === null, 1500, 100);
    check('the floor clears before the verdict', Boolean(silentFirst));
    check('victory plays its verdict', Boolean(await cueIs('victory', 5000)));
    const kilnQuiet = await waitFor(() => spokenIncludes(/^The Kiln is quiet\./).then((a) => a.length > 0), 9000);
    check('the narrator reads "The Kiln is quiet."', Boolean(kilnQuiet));

    console.log('\n-- the Workshop');
    await page.waitForSelector('#run-summary [data-rs="title"]', { state: 'visible', timeout: 15000 });
    await clickReal('#run-summary [data-rs="title"]');
    check('the entrance brings the theme back', Boolean(await cueIs('title', 8000)));
    await page.waitForSelector('#expedition-entry [data-entry="workshop"]', { state: 'visible', timeout: 10000 });
    await clickReal('#expedition-entry [data-entry="workshop"]');
    check('the material sandbox plays the Workshop cue', Boolean(await cueIs('workshop', 8000)));
    const note = await waitFor(async () => {
      const said = await spokenIncludes(/^The material sandbox/);
      const cap = await page.evaluate(() => document.querySelector('#narration-caption.show')?.textContent ?? '');
      return said.length > 0 && /sandbox/.test(cap) ? cap : null;
    }, 14000, 200);
    check('its note is read, and captioned (it is not on screen in the Workshop)', Boolean(note), note ?? JSON.stringify((await narrator()).spoken.slice(-4)) + ' cooldown ' + (await narrator()).cooldownMs);
  } else check('the death screen offers the ledger', false);

  console.log('\n-- memory and traffic');
  const snap = await music();
  const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const fetched = [...new Set(audioRequests.map((r) => r.url))];
  check('never more than a crossfade\'s worth of voices alive', snap.voices.length <= 3, `${snap.voices.length}`);
  console.log(`     JS heap ${(heap1 / 1048576).toFixed(1)} MB (was ${(heap0 / 1048576).toFixed(1)}); fetched ${fetched.length} audio files after the gesture`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  fail++;
  console.error('probe crashed:', error);
} finally {
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
