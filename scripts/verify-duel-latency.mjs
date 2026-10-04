import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5180/';
const oneWayDelay = Number(process.argv[3] ?? 0);
assert.ok(Number.isFinite(oneWayDelay) && oneWayDelay >= 0 && oneWayDelay <= 250, 'Delay must be 0..250 ms');
const out = 'verify-out/duel-latency'; mkdirSync(out, { recursive: true });
const browsers = [await launchBrowser(), await launchBrowser()];
const errors = [], results = { oneWayDelay, responseMs: [] };
const pages = [];
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
  await guest.evaluate(delay => {
    if (!delay) return;
    const t = window.__game.ctx.duel.transport, send = t.send.bind(t);
    t.send = data => { setTimeout(() => send(data), delay); return true; };
    const message = t.handlers.onMessage, binary = t.handlers.onBinary;
    t.handlers.onMessage = data => setTimeout(() => message(data), delay);
    t.handlers.onBinary = data => setTimeout(() => binary(data), delay);
  }, oneWayDelay);
  for (const page of pages) await page.evaluate(() => {
    const g = window.__game, d = g.ctx.duel, r = d.runtime, t = d.transport;
    const metrics = window.duelPerf = { capture: [], receive: [], bytes: [], baselines: [], frames: [], rtt: [], effects: [], cells: [] };
    const capture = r.capture.bind(r); r.capture = meta => { const at = performance.now(), result = capture(meta); metrics.capture.push(performance.now() - at); metrics.effects.push(result.snapshot.fighters.reduce((n, f) => n + f.effects.reduce((m, e) => m + e.pixels.length / 6, 0), 0)); metrics.cells.push(result.cells.idxs.length); if (meta.baseline) metrics.baselines.push(performance.now()); return result; };
    const receive = r.receive.bind(r); r.receive = (...args) => { const at = performance.now(), result = receive(...args); metrics.receive.push(performance.now() - at); return result; };
    const send = t.sendBinary.bind(t); t.sendBinary = bytes => { metrics.bytes.push(bytes.byteLength); return send(bytes); };
    let previous = performance.now(), sample = 0;
    const frame = () => { if (!d.active) return; const now = performance.now(); metrics.frames.push(now - previous); previous = now; if (now - sample > 250) { metrics.rtt.push(d.latency); sample = now; } requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  });
  await host.waitForTimeout(12000);
  for (const [i, page] of pages.entries()) results[i ? 'guest' : 'host'] = await page.evaluate(() => {
    const out = {}; for (const [key, values] of Object.entries(window.duelPerf)) { const sorted = [...values].sort((a,b) => a-b); out[key] = { n: values.length, mean: values.reduce((a,b)=>a+b,0)/Math.max(1,values.length), p50: sorted[Math.floor(sorted.length*.5)], p95: sorted[Math.floor(sorted.length*.95)], max: sorted.at(-1) }; } return out;
  });
  for (let n = 0; n < 8; n++) {
    const response = await guest.evaluate(async code => {
      const g = window.__game, d = g.ctx.duel;
      const player = g.ctx.arena.bundle(1).player, startX = player.x;
      const at = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      try {
        return await new Promise((resolve, reject) => {
          const sample = () => {
            if (Math.abs(player.x - startX) > 0.01) {
              // Read after the normal render callback has presented this frame.
              const authority = d.runtime.latest.fighters[1].player;
              if (Math.abs(player.x - authority.x) > 0.001) reject(new Error('Local fighter is still buffered behind authority'));
              else resolve(performance.now() - at);
            } else if (performance.now() - at > 2000) reject(new Error('Input did not move the guest'));
            else requestAnimationFrame(sample);
          }; requestAnimationFrame(sample);
        });
      } finally { window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); }
    }, n % 2 ? 'KeyD' : 'KeyA');
    results.responseMs.push(response);
    await guest.waitForTimeout(450 + oneWayDelay * 2);
  }
  assert.deepEqual(errors, [], 'No browser errors');
  assert.equal(results.host.baselines.n, 0, 'No recurring full world transfers during steady play');
  assert.ok(results.responseMs.every(ms => ms < oneWayDelay * 2 + 250), 'Input response exceeds network delay plus 250 ms');
  console.log(JSON.stringify(results, null, 2));
  writeFileSync(`${out}/delay-${oneWayDelay}.json`, JSON.stringify(results, null, 2));
  await host.evaluate(() => window.__game.ctx.duel.leave());
} finally { await Promise.all(browsers.map(b => b.close())); }
