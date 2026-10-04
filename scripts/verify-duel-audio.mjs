// The Duel sounds like an arcade cabinet and never like the descent (docs/arena/platform-fighter/AUDIO.md, "Duel
// announcer"). Drives the REAL title and lobby with real clicks, then a stock match, and asserts through the
// in-page instruments (ctx.narrator / ctx.audio.duel / ctx.audio.debugSamples debug snapshots; we cannot listen):
//   - no campaign narrator line at any point after the Duel door, even with a floor arrival pending from a
//     campaign session the moment before (the QA bug: "The Bellows. The Works draw breath." over the lobby);
//   - no floor bed and none of the descent's UI cues in the Duel;
//   - "Choose your fighter!" opens the lobby; the name call follows the selection and a fast change cuts it;
//   - the stage, a player's ready, each with its sound;
//   - Three, Two, One and FIGHT on the countdown's real beats (the match's own ticks);
//   - a ring-out's blast and call (Ring out / Self-destruct, Last stock), GAME and the winner's name, Rematch.
//
// Usage (dev server running, HMR off for probes): node scripts/verify-duel-audio.mjs [http://127.0.0.1:5242/]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:5242/';
const out = 'docs/arena/platform-fighter/evidence';
const checks = [], errors = [];
const check = (name, pass, data) => { checks.push({ name, pass: !!pass, data }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${data !== undefined ? `  ${JSON.stringify(data).slice(0, 300)}` : ''}`); assert.ok(pass, name); };
/** A real mouse click at the element's centre (the lobby's arrows animate, so they never count as stable). */
const clickAt = async (locator) => { const box = await locator.boundingBox(); if (!box) throw new Error('not on screen'); await locator.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2); };
const DESCENT_CUES = /^(ui\.(hover|click|back|toast|objective|curtain|pause|resume|open|close|hint)|stinger\.|amb\.)/;

const browser = await launchBrowser({ args: ['--autoplay-policy=no-user-gesture-required'] });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${url}?link=off`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.ctx?.console && window.__game.ctx.audio);

  // Instruments: every narration, match beat, ring-out and sampled sound, timestamped.
  await page.evaluate(() => {
    const c = window.__game.ctx, p = { narration: [], beats: [], resets: [], downs: [], played: [], beds: new Set(), prev: 0 };
    window.probe = p;
    c.events.on('narration', (e) => p.narration.push({ text: e.text, at: performance.now() }));
    c.events.on('stockMatchBeat', (b) => p.beats.push({ ...b, at: performance.now(), frame: c.state.frameCount }));
    c.events.on('arenaReset', () => p.resets.push({ at: performance.now(), frame: c.state.frameCount }));
    // The Duel has the screen from the lobby's first frame (the title's own click on the Duel door is the title's sound).
    c.events.on('versusChanged', () => { if (c.versus?.active && p.lobbyAt === undefined) p.lobbyAt = performance.now(); });
    c.events.on('fighterDown', (d) => p.downs.push({ ...d, at: performance.now() }));
    setInterval(() => {
      const s = c.audio.debugSamples?.();
      if (!s) return;
      const n = Math.min(24, s.played - p.prev);
      p.prev = s.played;
      for (const id of n > 0 ? s.lastPlayed.slice(-n) : []) p.played.push({ id, at: performance.now() });
      p.beds.add(`${performance.now() > (p.duelAt ?? Infinity) ? 'duel' : 'before'}:${s.bed}`);
    }, 50);
  });

  // A campaign session the moment before: its floor arrival is scheduled when the player leaves for the title.
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    const result = await c.console.exec('run new --world campaign');
    if (!result.ok) throw new Error(result.text);
    window.dispatchEvent(new Event('expedition-title-request'));
  });
  await page.locator('[data-entry="duel"]').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.probe.duelAt = performance.now(); });
  await page.locator('[data-entry="duel"]').click();
  await page.locator('#versus-lobby').waitFor({ state: 'visible' });

  const duel = () => page.evaluate(() => window.__game.ctx.audio.duel.debugSnapshot());
  const said = async () => (await duel()).said;
  const waitSaid = (line, timeout = 15000) => page.waitForFunction((line) => window.__game.ctx.audio.duel.debugSnapshot().said.some((s) => s.line === line), line, { timeout });

  await waitSaid('choose', 30000);
  check('the lobby opens with "Choose your fighter!"', true, (await said()).map((s) => s.line));
  await page.waitForFunction(() => window.__game.ctx.audio.debugSamples().packs.arena === 'ready', null, { timeout: 60000 });
  await page.waitForTimeout(2600); // a pending campaign arrival would have fired by now (it did: 1.7 s after the curtain)

  // Fast cycling: three clicks on the arrow, 120 ms apart. Each name is called the moment it is chosen; each cuts the last.
  const next = page.getByRole('button', { name: 'Next fighter for player 1', exact: true });
  const clicks = [];
  for (let i = 0; i < 3; i++) {
    clicks.push(await page.evaluate(() => performance.now()));
    await clickAt(next);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2200);
  const names = (await said()).filter((s) => s.line.startsWith('fighter.'));
  const chosen = await page.evaluate(() => window.__game.ctx.versus.seats[0].fighter);
  check('each name follows its selection', names.length === 3 && names.map((s) => s.line).join() === 'fighter.brann-rook,fighter.sable-fen,fighter.mara-quell' && chosen === 'mara-quell', names.map((s) => s.line));
  check('a name is called within 400 ms of being chosen', names.every((s, i) => s.at - clicks[i] < 400 && s.at >= clicks[i]), names.map((s, i) => Math.round(s.at - clicks[i])));
  check('a fast change cuts the previous call', names[0].cut === true && names[1].cut === true && !names[2].cut && names[2].ended - names[2].at > 600, names.map((s) => ({ cut: !!s.cut, ms: s.ended ? s.ended - s.at : null })));

  await page.locator('[data-stage="kiln"]').click();
  await waitSaid('stage.kiln');
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await waitSaid('ready.1');
  await page.waitForTimeout(400);
  const lobbySounds = (await duel()).sounds.map((s) => s.sfx);
  check('stage and ready land with their cabinet sounds', lobbySounds.includes('duel.stage') && lobbySounds.includes('duel.ready'), lobbySounds);
  const lobbyPlayed = await page.evaluate(() => window.probe.played.filter((p) => p.at > window.probe.lobbyAt + 60).map((p) => p.id));
  check('lobby buttons sound like the cabinet, not the descent', lobbyPlayed.some((id) => id.startsWith('duel.ui.')) && !lobbyPlayed.some((id) => DESCENT_CUES.test(id)), [...new Set(lobbyPlayed)]);

  // The match: the countdown's beats are the match's own ticks.
  await page.locator('#versus-start').click();
  await page.locator('#versus-lobby').waitFor({ state: 'hidden', timeout: 30000 });
  await waitSaid('fight', 30000);
  await page.waitForTimeout(300);
  const count = await page.evaluate(() => {
    const p = window.probe, s = window.__game.ctx.audio.duel.debugSnapshot().said;
    const at = (line) => s.find((x) => x.line === line)?.at;
    const beat = (state, n) => p.beats.find((b) => b.state === state && (n === undefined || b.count === n));
    return {
      lines: s.map((x) => x.line).filter((l) => l.startsWith('count.') || l === 'fight'),
      lagMs: { 'count.3': at('count.3') - beat('countdown', 3).at, 'count.2': at('count.2') - beat('countdown', 2).at, 'count.1': at('count.1') - beat('countdown', 1).at, fight: at('fight') - beat('fighting').at },
      beatTicks: [beat('countdown', 2).frame - beat('countdown', 3).frame, beat('countdown', 1).frame - beat('countdown', 2).frame, beat('fighting').frame - beat('countdown', 1).frame],
    };
  });
  check('Three, Two, One, FIGHT are called in order', count.lines.join() === 'count.3,count.2,count.1,fight', count.lines);
  check('each countdown call lands on its beat (within 250 ms of the tick that changed it)', Object.values(count.lagMs).every((ms) => ms >= 0 && ms < 250), count.lagMs);
  check('the beats are the countdown\'s own ticks (three equal beats)', count.beatTicks.every((t) => Math.abs(t - count.beatTicks[0]) <= 1), count.beatTicks);

  // Ring-outs, driven through the game's own tick: an attributed one, an unforced one, the last.
  await page.evaluate(async () => {
    const c = window.__game.ctx, g = window.__game;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    c.state.paused = true;
    const step = (n) => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    const S = c.arena.stockStage;
    window.ring = {
      step,
      hitAndOut() {
        step(30); // whatever either body was doing when the bots let go has ended
        for (const n of [0, 1]) Object.assign(c.arena.bundle(n).player, { x: S.center.x + (n ? 18 : 0), y: S.main.y - 1, grounded: true, vx: 0, vy: 0, fx: 0, fy: 0, invuln: 0, facing: n ? -1 : 1 });
        c.state.arrivalGraceUntil = 0; c.fx.hitstop = 0;
        const before = c.arena.stockMatch.fighters[1].volatility;
        c.arena.with(0, () => c.arena.requestStockAttack('finisher'));
        step(22);
        this.hit = c.arena.stockMatch.fighters[1].volatility - before;
        Object.assign(c.arena.bundle(1).player, { x: S.zone.right + 60, vx: 0, vy: 0 });
        step(2);
      },
      out() { Object.assign(c.arena.bundle(1).player, { x: S.zone.right + 60, vx: 0, vy: 0, invuln: 0 }); step(2); },
      respawn() { step(200); },
    };
  });
  // FIGHT has the floor until it ends (a ring-out cannot outrank it; none could happen that fast in play).
  await page.waitForFunction(() => window.__game.ctx.audio.duel.debugSnapshot().speaking === null);
  await page.evaluate(() => window.ring.hitAndOut());
  const landed = await page.evaluate(() => window.ring.hit);
  await waitSaid('ring-out', 4000).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.ring.respawn(); window.ring.out(); });
  await page.waitForTimeout(2600);
  await page.evaluate(() => { window.ring.respawn(); window.ring.out(); });
  await waitSaid('wins.mara-quell', 6000).catch(() => {});
  await page.waitForTimeout(400);
  const end = await page.evaluate(() => ({
    downs: window.probe.downs.map((d) => ({ slot: d.slot, by: d.by })),
    lines: window.__game.ctx.audio.duel.debugSnapshot().said.map((s) => s.line),
    sounds: window.__game.ctx.audio.duel.debugSnapshot().sounds.map((s) => s.sfx),
    state: window.__game.ctx.arena.stockMatch.state,
    winner: window.__game.ctx.arena.stockMatch.winner,
  }));
  const after = end.lines.slice(end.lines.indexOf('fight') + 1);
  check('three ring-outs end the match for player 1 (the first after a landed finisher)', end.downs.length === 3 && end.state === 'finished' && end.winner === 0 && landed > 0, { downs: end.downs, landed, lines: end.lines.slice(-8) });
  check('an attributed ring-out is called "Ring out!" with the KO blast', after[0] === 'ring-out' && end.sounds.filter((s) => s === 'duel.ko').length === 3, after);
  check('an unforced one is a self-destruct, and the last stock is called', after[1] === 'self-destruct' && after[2] === 'last-stock', after);
  check('the end calls GAME and the winner\'s name', after.slice(-2).join() === 'game,wins.mara-quell' && end.sounds.includes('duel.game') && end.sounds.includes('duel.results'), after);

  // Rematch: the visible button, then a countdown that opens with "Rematch!".
  await page.evaluate(() => { window.__game.ctx.state.paused = false; });
  await page.locator('.stock-rematch').waitFor({ state: 'visible' });
  await clickAt(page.locator('.stock-rematch'));
  await page.waitForFunction(() => { const l = window.__game.ctx.audio.duel.debugSnapshot().said.map((s) => s.line); return l.slice(l.lastIndexOf('wins.mara-quell') + 1).includes('fight'); }, null, { timeout: 15000 }).catch(() => {});
  const rematch = (await said()).map((s) => s.line);
  const tail = rematch.slice(rematch.lastIndexOf('wins.mara-quell') + 1);
  check('a rematch opens with "Rematch!" and fights again', tail[0] === 'rematch' && tail.includes('fight'), tail);

  // The pause menu pauses like a cabinet, not like the descent's steam valve.
  const pauseFrom = await page.evaluate(() => performance.now());
  await page.keyboard.press('Escape');
  await page.locator('#pause-overlay.visible').waitFor();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const pauseSounds = await page.evaluate((t) => window.probe.played.filter((p) => p.at > t).map((p) => p.id).filter((id) => id.startsWith('duel.ui.') || id.startsWith('ui.')), pauseFrom);
  check('pausing the Duel sounds the cabinet pause and back', pauseSounds.includes('duel.ui.pause') && pauseSounds.includes('duel.ui.back') && !pauseSounds.some((id) => id.startsWith('ui.')), pauseSounds);

  // The descent stayed out the whole time.
  const descent = await page.evaluate(() => {
    const p = window.probe, n = window.__game.ctx.narrator?.debugSnapshot?.();
    return {
      narration: p.narration.filter((x) => x.at >= p.duelAt).map((x) => x.text),
      narratorSpoken: (n?.spoken ?? []).filter((x) => x.at >= p.duelAt).map((x) => x.text),
      before: (n?.spoken ?? []).filter((x) => x.at < p.duelAt).map((x) => x.text),
      played: [...new Set(p.played.filter((x) => x.at > p.lobbyAt + 60).map((x) => x.id))],
      beds: [...p.beds].filter((b) => b.startsWith('duel:')),
    };
  });
  check('no campaign narrator line after the Duel door (arrival, tagline, toasts, callouts)', descent.narration.length === 0 && descent.narratorSpoken.length === 0, descent);
  check('no floor bed and none of the descent\'s cues in the Duel', descent.beds.every((b) => b === 'duel:null') && !descent.played.some((id) => DESCENT_CUES.test(id)), { beds: descent.beds, played: descent.played });
  check('no browser exceptions', errors.length === 0, errors);
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/duel-audio.json`, JSON.stringify({ url, checks, count, end, rematch: tail, descent, errors }, null, 2) + '\n');
} catch (error) {
  console.error(error.message ?? error);
  if (errors.length) console.error(errors);
  process.exitCode = 1;
} finally { await browser.close(); }
