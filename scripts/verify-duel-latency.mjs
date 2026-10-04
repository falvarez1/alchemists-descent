// LAN Duel feel, measured in two browser processes (docs/DUEL-LAN.md "Replication"):
//   - the host's publish rate and capture cost (terrain cells compared, bytes),
//   - the guest's arrival jitter and how evenly both fighters move on its screen while walking,
//   - key-to-screen response on the guest AND on the host, and the guest's input round trip.
// Usage: node scripts/verify-duel-latency.mjs [url] [oneWayDelayMs] [jitterMs]
//   Delay and jitter (uniform 0..jitterMs extra, order preserved like TCP) are injected at the guest's transport.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5180/';
const oneWayDelay = Number(process.argv[3] ?? 0);
const jitter = Number(process.argv[4] ?? 0);
assert.ok(Number.isFinite(oneWayDelay) && oneWayDelay >= 0 && oneWayDelay <= 250, 'Delay must be 0..250 ms');
assert.ok(Number.isFinite(jitter) && jitter >= 0 && jitter <= 250, 'Jitter must be 0..250 ms');
const out = 'verify-out/duel-latency'; mkdirSync(out, { recursive: true });
const browsers = [await launchBrowser(), await launchBrowser()];
const errors = [], results = { oneWayDelay, jitter, response: { guest: [], host: [] } };
const pages = [];
const stat = (values) => {
  const sorted = [...values].sort((a, b) => a - b), n = values.length;
  const pick = (q) => (n ? +sorted[Math.min(n - 1, Math.floor(q * n))].toFixed(2) : null);
  return { n, mean: n ? +(values.reduce((a, b) => a + b, 0) / n).toFixed(2) : null, p50: pick(0.5), p95: pick(0.95), max: n ? +sorted[n - 1].toFixed(2) : null };
};
try {
  for (const browser of browsers) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); pages.push(page);
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(url + '?link=off', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.ctx?.duel);
    await page.locator('[data-entry="duel"]').click();
    await page.getByRole('button', { name: 'Play over LAN', exact: true }).click();
    console.log(`client ${pages.length} lobby loaded`);
  }
  const [host, guest] = pages;
  await host.getByRole('button', { name: 'Host a match', exact: true }).click();
  await host.waitForFunction(() => window.__game.ctx.duel.room?.room);
  const code = await host.evaluate(() => window.__game.ctx.duel.room.room);
  await guest.getByRole('textbox', { name: 'Room code' }).fill(code);
  await guest.getByRole('button', { name: 'Join match', exact: true }).click();
  await guest.waitForFunction(() => window.__game.ctx.duel.slot === 1);
  assert.equal(await guest.getByRole('combobox', { name: 'LAN Player 1 fighter', exact: true }).isDisabled(), true);
  await guest.getByRole('combobox', { name: 'LAN Player 2 fighter', exact: true }).selectOption('rusk-emberjaw');
  for (const page of pages) await page.locator('#duel-network [data-ready]').click();
  await host.locator('#duel-network [data-start]').click();
  console.log('match requested');
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__game.ctx.duel.playing && window.__game.ctx.arena?.stockMatch?.state === 'fighting', null, { timeout: 60000 })));
  await guest.waitForFunction(() => window.__game.ctx.duel.snapshotCount > 4);
  console.log('host/join and baseline passed');
  // Delay this guest's adapter, preserving message order. The authority and game
  // simulation remain untouched; this exercises real input and snapshot delivery.
  await guest.evaluate(([delay, jitter]) => {
    if (!delay && !jitter) return;
    // Each direction is an ordered stream: a late message holds back the ones behind it.
    // One FIFO per direction drained by one timer: separate timers round their delays to whole milliseconds and can
    // swap two messages a fraction of a millisecond apart.
    const lane = () => {
      const queue = []; let last = 0, timer = 0;
      const drain = () => { timer = 0; while (queue.length && queue[0].at <= performance.now()) queue.shift().fn(); if (queue.length) timer = setTimeout(drain, Math.max(0, queue[0].at - performance.now())); };
      return fn => { const at = Math.max(last, performance.now() + delay + Math.random() * jitter); last = at; queue.push({ at, fn }); if (!timer) timer = setTimeout(drain, Math.max(0, at - performance.now())); };
    };
    const up = lane(), down = lane();
    const t = window.__game.ctx.duel.transport, send = t.send.bind(t);
    t.send = data => { up(() => send(data)); return true; };
    const message = t.handlers.onMessage, binary = t.handlers.onBinary;
    t.handlers.onMessage = data => down(() => message(data));
    t.handlers.onBinary = data => down(() => binary(data));
  }, [oneWayDelay, jitter]);
  for (const page of pages) await page.evaluate(() => {
    const g = window.__game, d = g.ctx.duel, r = d.runtime, t = d.transport;
    const m = window.duelPerf = { capture: [], compared: [], bytes: [], baselines: 0, sent: [], arrivals: [], frames: [], own: [], foe: [], lag: [], inputDelay: [] };
    const capture = r.capture.bind(r);
    r.capture = meta => { const at = performance.now(), result = capture(meta); m.capture.push(performance.now() - at); m.compared.push(r.terrain.compared ?? Number.NaN); if (meta.baseline) m.baselines++; return result; };
    const send = t.sendBinary.bind(t); t.sendBinary = bytes => { m.bytes.push(bytes.byteLength); m.sent.push(performance.now()); return send(bytes); };
    if (t.handlers.onBinary) { const binary = t.handlers.onBinary; t.handlers.onBinary = data => { m.arrivals.push(performance.now()); binary(data); }; }
    const slot = d.slot, other = 1 - slot;
    let previous = performance.now();
    // Sampled after the game's own render callback (registered first) has presented this frame.
    const frame = () => {
      if (!d.active) return;
      const now = performance.now(); m.frames.push(now - previous); previous = now;
      m.own.push(g.ctx.arena.bundle(slot).player.x); m.foe.push(g.ctx.arena.bundle(other).player.x);
      if (d.replica && r.playback) { const p = r.playback(); if (p.newest) m.lag.push(p.newest.tick - p.own); m.inputDelay.push(d.inputDelay); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  // Both fighters walk toward each other for 3 s: smoothness is judged on motion, not on a standing pose.
  await Promise.all([host.keyboard.down('KeyD'), guest.keyboard.down('KeyA')]);
  await host.waitForTimeout(3000);
  await Promise.all([host.keyboard.up('KeyD'), guest.keyboard.up('KeyA')]);
  await host.waitForTimeout(9000);
  for (const [i, page] of pages.entries()) {
    const raw = await page.evaluate(() => { const m = window.duelPerf; window.duelPerf = null; return m; });
    const gaps = (times) => times.slice(1).map((t, k) => t - times[k]);
    // Smoothness over the walk (the first 3 s): per-display-frame steps of each fighter's presented position. Only the
    // replica writes presented positions into the player; the host draws its own between ticks (render offsets), so
    // its raw positions step per tick by design and are not reported.
    const walking = (xs, ms) => {
      const end = ms.reduce((n, _, k) => (ms.slice(0, k + 1).reduce((a, b) => a + b, 0) < 3000 ? k + 1 : n), 0);
      const s = xs.slice(Math.floor(end * 0.25), end).map((x, k, a) => (k ? Math.abs(x - a[k - 1]) : 0)).slice(1).filter(v => v < 30);
      const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
      const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, s.length));
      return { stepMean: +mean.toFixed(3), stepCv: +(sd / Math.max(1e-9, mean)).toFixed(3), heldFramesInWalk: s.filter(v => v <= 0.01).length, framesInWalk: s.length };
    };
    results[i ? 'guest' : 'host'] = {
      capture: stat(raw.capture), compared: stat(raw.compared), bytes: stat(raw.bytes), baselines: raw.baselines,
      publishHz: raw.sent.length / 12, sendGap: stat(gaps(raw.sent)),
      arrivalHz: raw.arrivals.length / 12, arrivalGap: stat(gaps(raw.arrivals)),
      frameMs: stat(raw.frames), ownLagTicks: stat(raw.lag), inputDelayMs: stat(raw.inputDelay.filter(v => v > 0)),
      ...(i ? { own: walking(raw.own, raw.frames), foe: walking(raw.foe, raw.frames) } : {}),
    };
  }
  // Key-to-screen: a key press until the pressing player's own fighter moves on THEIR screen.
  for (const [who, page] of [['guest', guest], ['host', host]]) {
    for (let n = 0; n < 16; n++) {
      const ms = await page.evaluate(async code => {
        const g = window.__game, d = g.ctx.duel, player = g.ctx.arena.bundle(d.slot).player, startX = player.x;
        const at = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        try {
          return await new Promise((resolve, reject) => {
            const sample = () => {
              if (Math.abs(player.x - startX) > 0.01) resolve(performance.now() - at);
              else if (performance.now() - at > 2000) reject(new Error('Input did not move the fighter'));
              else requestAnimationFrame(sample);
            }; requestAnimationFrame(sample);
          });
        } finally { window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); }
      }, n % 2 ? 'KeyD' : 'KeyA');
      results.response[who].push(+ms.toFixed(1));
      await page.waitForTimeout(450 + oneWayDelay * 2);
    }
  }
  results.response.guestStat = stat(results.response.guest);
  results.response.hostStat = stat(results.response.host);
  console.log(JSON.stringify(results, null, 2));
  writeFileSync(`${out}/delay-${oneWayDelay}${jitter ? `-jitter-${jitter}` : ''}.json`, JSON.stringify(results, null, 2));
  assert.deepEqual(errors, [], 'No browser errors');
  assert.equal(results.host.baselines, 0, 'No recurring full world transfers during steady play');
  assert.ok(results.host.publishHz > 55, `The host publishes every tick (${results.host.publishHz.toFixed(1)}/s)`);
  assert.ok(results.guest.foe.heldFramesInWalk <= Math.ceil(results.guest.foe.framesInWalk * 0.05), 'The opponent walks without holds on the guest');
  assert.ok(results.guest.own.heldFramesInWalk <= Math.ceil(results.guest.own.framesInWalk * 0.1), 'The guest\'s fighter walks without holds');
  // The guest answers a key one round trip (plus its playback lead) after the host would: judged against the host's own
  // key-to-screen on the same machine, so machine speed and display rate cancel out. Before the playback rework: +61 ms.
  const behind = results.response.guestStat.p50 - results.response.hostStat.p50;
  assert.ok(behind < (oneWayDelay + jitter) * 2 + 50, 'Guest key-to-screen trails the host by ' + behind.toFixed(1) + ' ms: more than the network delay plus 50 ms');
  await host.evaluate(() => window.__game.ctx.duel.leave());
} finally { await Promise.all(browsers.map(b => b.close())); }
