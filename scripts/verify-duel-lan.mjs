import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5180/';
const duo = process.argv.includes('--duo');
const brann = duo || process.argv.includes('--brann');
const out = 'verify-out/duel-lan'; mkdirSync(out, { recursive: true });
const browsers = [await launchBrowser(), await launchBrowser()];
const errors = [], results = {};
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
  await guest.getByRole('combobox', { name: 'LAN Player 2 fighter', exact: true }).selectOption(duo ? 'ilyra-voss' : brann ? 'brann-rook' : 'rusk-emberjaw');
  if (brann) await host.getByRole('combobox', { name: 'LAN Player 1 fighter', exact: true }).selectOption('brann-rook');
  for (const page of pages) await page.locator('#duel-network [data-ready]').click();
  await host.locator('#duel-network [data-start]').click();
  console.log('match requested');
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__game.ctx.duel.playing && window.__game.ctx.arena?.stockMatch?.state === 'fighting', null, { timeout: 60000 })));
  await guest.waitForFunction(() => window.__game.ctx.duel.snapshotCount > 4);
  console.log('host/join and baseline passed');
  await host.screenshot({ path: `${out}/host.png` }); await guest.screenshot({ path: `${out}/guest.png` });
  const positions = page => page.evaluate(() => [0, 1].map(s => { const p = window.__game.ctx.arena.bundle(s).player; return { x: p.x, y: p.y }; }));
  const before = await positions(host);
  await guest.keyboard.down('a');
  await host.waitForFunction(x => window.__game.ctx.arena.bundle(1).player.x < x - 20, before[1].x);
  await guest.keyboard.up('a');
  await host.waitForFunction(() => !window.__game.ctx.arena.bundle(1).input.keys.left);
  await guest.waitForFunction(x => window.__game.ctx.arena.bundle(1).player.x < x - 15, before[1].x);
  results.movement = { before, host: await positions(host), guest: await positions(guest) };
  assert.ok(Math.abs(results.movement.host[0].x - before[0].x) < 1, 'guest cannot move host fighter');
  console.log('remote control passed');
  // Put the fighters in melee range; all attacks still enter through the guest keyboard.
  await host.evaluate(() => {
    const c = window.__game.ctx;
    for (const s of [0, 1]) { const p = c.arena.bundle(s).player; Object.assign(p, { x: 780 + s * 20, y: 639, vx: 0, vy: 0, fx: 0, fy: 0, invuln: 0, facing: s === 0 ? 1 : -1 }); }
  });
  await guest.waitForFunction(() => Math.abs(window.__game.ctx.arena.bundle(1).player.x - 800) < 5);
  await guest.keyboard.press('f');
  await host.waitForFunction(() => window.__game.ctx.arena.stockMatch.fighters[0].volatility > 0);
  await guest.waitForFunction(() => window.__game.ctx.arena.stockMatch.fighters[0].volatility > 0);
  results.damage = await host.evaluate(() => window.__game.ctx.arena.stockMatch.fighters.map(f => f.volatility));
  console.log('melee damage passed');
  if (brann) {
    for (const page of pages) await page.evaluate(() => {
      window.brannAttacks = [];
      window.brannObserver = setInterval(() => {
        const attack = window.__game.ctx.arena.stockAttack(1);
        if (attack.busy) window.brannAttacks.push({ kind: attack.kind, minReach: attack.spec.minReach });
      }, 10);
    });
    await host.waitForFunction(() => !window.__game.ctx.arena.stockAttack(1).busy);
    await host.evaluate(() => {
      const c = window.__game.ctx, s = c.arena.stockStage;
      for (const slot of [0, 1]) Object.assign(c.arena.bundle(slot).player, { x: s.center.x + slot * 100, y: s.main.y - 1, vx: 0, vy: 0, fx: 0, fy: 0, invuln: 0, staggerT: 0, grounded: true });
    });
    await guest.waitForFunction(() => window.__game.ctx.arena.bundle(1).player.grounded);
    await guest.keyboard.down('ShiftLeft'); await guest.keyboard.down('w'); await guest.keyboard.press('f');
    await guest.keyboard.up('w'); await guest.keyboard.up('ShiftLeft');
    for (const page of pages) await page.waitForFunction(() => window.brannAttacks.some(a => a.kind === 'up_smash' && a.minReach < 0));
    await host.waitForFunction(() => !window.__game.ctx.arena.stockAttack(1).busy);
    await host.evaluate(() => {
      const c = window.__game.ctx, p = c.arena.bundle(1).player;
      Object.assign(p, { y: c.arena.stockStage.main.y - 180, vy: 0, vx: 0, grounded: false, facing: 1 });
    });
    await guest.waitForFunction(() => !window.__game.ctx.arena.bundle(1).player.grounded);
    await guest.keyboard.down('w'); await guest.keyboard.press('f'); await guest.keyboard.up('w');
    for (const page of pages) await page.waitForFunction(() => window.brannAttacks.some(a => a.kind === 'up_air' && a.minReach < 0));
    results.brann = await Promise.all(pages.map(page => page.evaluate(() => {
      clearInterval(window.brannObserver);
      return [...new Set(window.brannAttacks.map(a => a.kind))];
    })));
    console.log('Expanded guest heavy and aerial attacks replicated');
  }
  // Test a host terrain mutation and its removal through the binary stream.
  await host.evaluate(() => { const w = window.__game.ctx.world; w.types[400 * w.width + 800] = 13; w.colors[400 * w.width + 800] = 0xc0c0c0; });
  await guest.waitForFunction(() => { const w = window.__game.ctx.world; return w.types[400 * w.width + 800] === 13; });
  await host.evaluate(() => { const w = window.__game.ctx.world; w.types[400 * w.width + 800] = 0; });
  await guest.waitForFunction(() => { const w = window.__game.ctx.world; return w.types[400 * w.width + 800] === 0; });
  console.log('terrain delta passed');
  await guest.keyboard.press('Escape');
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__game.ctx.duel.room.phase === 'paused')));
  if (brann) for (const page of pages) assert.match(await page.locator('.duel-help').textContent(), /double jump/);
  const frozen = await host.evaluate(() => window.__game.ctx.state.frameCount);
  await host.waitForTimeout(300);
  assert.equal(await host.evaluate(() => window.__game.ctx.state.frameCount), frozen);
  await host.locator('#duel-network [data-resume]').click();
  await host.waitForFunction(() => window.__game.ctx.duel.playing);
  console.log('shared pause/resume passed');
  // Exhaust the guest's stocks through real blast-zone exits.
  for (let stock = 3; stock > 0; stock--) {
    await host.waitForFunction(() => window.__game.ctx.arena.stockMatch.fighters[1].respawn === 0);
    await host.evaluate(() => { window.__game.ctx.arena.bundle(1).player.y = 1000; });
    await host.waitForFunction(n => window.__game.ctx.arena.stockMatch.fighters[1].stocks === n, stock - 1);
  }
  await guest.waitForFunction(() => window.__game.ctx.arena.stockMatch.state === 'finished');
  results.winner = await guest.evaluate(() => window.__game.ctx.arena.stockMatch.winner);
  assert.equal(results.winner, 0);
  await host.getByRole('button', { name: 'Rematch', exact: true }).click();
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__game.ctx.duel.room.epoch === 2 && window.__game.ctx.arena.stockMatch?.state === 'fighting')));
  results.rematch = true;
  console.log('ring-out/result/rematch passed');
  // A socket loss must stop the authoritative clock, clear held controls, and resync.
  await guest.evaluate(() => { window.__game.ctx.duel.transport.socket.close(); });
  await host.waitForFunction(() => window.__game.ctx.duel.room.phase === 'paused');
  await host.waitForFunction(() => window.__game.ctx.duel.room.seats.every(s => s.connected), null, { timeout: 15000 });
  assert.equal(await host.evaluate(() => window.__game.ctx.duel.room.phase), 'paused');
  await host.locator('#duel-network [data-resume]').click();
  await guest.waitForFunction(() => window.__game.ctx.duel.playing && !window.__game.ctx.duel.needsBaseline);
  results.reconnect = true;
  console.log('disconnect/reconnect passed');
  results.replicaDoesNotSimulate = await guest.evaluate(() => {
    const g = window.__game, before = g.ctx.state.frameCount; g.advance(10);
    return g.ctx.state.frameCount === before;
  });
  assert.equal(results.replicaDoesNotSimulate, true);
  await host.keyboard.press('Escape');
  await host.locator('#duel-network [data-leave]').click();
  await guest.waitForFunction(() => !window.__game.ctx.duel.active);
  assert.equal(errors.length, 0, errors.join('\n'));
  results.errors = errors;
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  for (const [i, page] of pages.entries()) {
    await page.screenshot({ path: `${out}/failure-${i}.png`, timeout: 5000 }).catch(() => {});
    console.log(`client ${i}`, await page.evaluate(() => { const c = window.__game?.ctx, d = c?.duel; return d && { status: d.status, active: d.active, connected: d.connected, room: d.room, snapshots: d.snapshotCount, fighters: [0, 1].map(s => { const b = c.arena.bundle(s); return b && { x: b.player.x, y: b.player.y, facing: b.player.facing, grounded: b.player.grounded, keys: b.input.keys, attack: c.arena.stockAttack(s), match: c.arena.stockMatch }; }) }; }).catch(() => null));
  }
  console.log('page errors', errors); throw error;
} finally { await Promise.all(browsers.map(b => b.close())); }
