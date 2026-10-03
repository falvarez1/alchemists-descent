import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const out = 'docs/arena/platform-fighter/evidence';
const tagIndex = process.argv.indexOf('--tag'), tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : '';
if (tag && !/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid evidence tag');
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page); await waitForConsoleApi(page);
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('run test --level fighter-duel --world campaign-level');
    c.fighters.equip('ilyra-voss'); await c.fighters.whenReady();
  });
  await page.getByRole('combobox', { name: 'Match rules', exact: true }).selectOption('stocks');
  await page.getByRole('button', { name: 'Add rival', exact: true }).click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(() => { window.__game.ctx.state.paused = true; });
  const bouts = [];
  for (const seed of [11, 29, 43]) {
    const result = await page.evaluate(async seed => {
      const g = window.__game, c = g.ctx, a = c.arena;
      await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
      c.state.worldSeed = seed; a.reset();
      await c.console.exec('arena bot 0 basic 3'); await c.console.exec('arena bot 1 basic 3');
      const history = [[], []], downs = []; let previous = 0;
      const hits = [], casts = []; let worldHits = 0;
      const offHit = c.events.on('fighterHit', hit => { if (hit.attack === 'world') worldHits++; else hits.push({ by: hit.by, victim: hit.victim, attack: hit.attack }); });
      const offCast = c.events.on('cardCast', cast => casts.push(cast.id));
      const movement = [0, 1].map(() => ({ reversals: 0, shortReversals: 0, closeTicks: 0, combatTicks: 0, distance: 0, dir: 0, since: 0, lastMotion: 0 }));
      for (let i = 0; i < 3600 && a.stockMatch.state !== 'finished'; i++) {
        g.tick(false, { forcePaused: true });
        for (const slot of [0, 1]) {
          const b = a.bundle(slot), p = b.player;
          const metric = movement[slot], rival = a.bundle(1 - slot).player;
          if (a.stockMatch.state === 'fighting' && !p.dead && !rival.dead) {
            const distance = Math.hypot(p.x - rival.x, p.y - rival.y); metric.combatTicks++; metric.distance += distance;
            if (distance < 40) metric.closeTicks++;
            const dir = Number(b.input.keys.right) - Number(b.input.keys.left);
            if (p.grounded && p.stunT <= 0 && !a.isActionLocked(slot) && dir) {
              if (dir !== metric.dir) {
                if (metric.dir && i - metric.lastMotion < 8) { metric.reversals++; if (i - metric.since < 12) metric.shortReversals++; }
                metric.dir = dir; metric.since = i;
              }
              metric.lastMotion = i;
            }
          }
          if (i % 4 === 0) {
            history[slot].push({ tick: i, x: p.x, y: p.y, vx: +p.vx.toFixed(2), vy: +p.vy.toFixed(2), fuel: +p.levit.toFixed(1),
              burst: a.canRecover(slot), grounded: p.grounded, stun: p.stunT, volatility: +a.stockMatch.fighters[slot].volatility.toFixed(1),
              keys: { ...b.input.keys } });
            if (history[slot].length > 45) history[slot].shift();
          }
        }
        if (a.bout.downs.length > previous) {
          for (const down of a.bout.downs.slice(previous)) downs.push({ ...down, trace: [...history[down.slot]] });
          previous = a.bout.downs.length;
        }
      }
      offHit(); offCast();
      const status = await c.console.exec('arena status');
      return { seed, state: a.stockMatch.state, remaining: a.stockMatch.remainingTicks, fighters: a.stockMatch.fighters,
        downs, movement, hits, worldHits, casts, stats: status.data.bots.map(bot => bot?.stats),
        final: [0, 1].map(slot => ({x:a.bundle(slot).player.x,y:a.bundle(slot).player.y,stun:a.bundle(slot).player.stunT,bot:status.data.bots[slot]})) };
    }, seed);
    bouts.push(result);
    console.log(JSON.stringify({ seed, state: result.state, downs: result.downs.map(d => ({ slot: d.slot, by: d.by, x: d.x, y: d.y })), stats: result.stats }));
  }
  writeFileSync(`${out}/stock-bots${tag ? `-${tag}` : ''}.json`, JSON.stringify({ bouts, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(bouts.every(b => b.downs.length > 0), 'Each seeded CPU bout produces ring-outs');
} finally { await browser.close(); }
