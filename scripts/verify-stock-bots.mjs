import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const out = 'docs/arena/platform-fighter/evidence';
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
      const { brainForSlot } = await import('/src/arena/ai/driver.ts');
      await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
      c.state.worldSeed = seed; a.reset();
      await c.console.exec('arena bot 0 basic 3'); await c.console.exec('arena bot 1 basic 3');
      const history = [[], []], downs = []; let previous = 0;
      for (let i = 0; i < 3600 && a.stockMatch.state !== 'finished'; i++) {
        g.tick(false, { forcePaused: true });
        for (const slot of [0, 1]) {
          const b = a.bundle(slot), p = b.player, brain = brainForSlot(c, slot);
          if (i % 4 === 0) {
            history[slot].push({ tick: i, x: p.x, y: p.y, vx: +p.vx.toFixed(2), vy: +p.vy.toFixed(2), fuel: +p.levit.toFixed(1),
              burst: a.canRecover(slot), grounded: p.grounded, stun: p.stunT, volatility: +a.stockMatch.fighters[slot].volatility.toFixed(1),
              intent: brain?.status.intent, rule: brain?.status.rule, keys: { ...b.input.keys } });
            if (history[slot].length > 45) history[slot].shift();
          }
        }
        if (a.bout.downs.length > previous) {
          for (const down of a.bout.downs.slice(previous)) downs.push({ ...down, trace: [...history[down.slot]] });
          previous = a.bout.downs.length;
        }
      }
      return { seed, state: a.stockMatch.state, remaining: a.stockMatch.remainingTicks, fighters: a.stockMatch.fighters,
        downs, stats: [0, 1].map(slot => brainForSlot(c, slot)?.status.stats) };
    }, seed);
    bouts.push(result);
    console.log(JSON.stringify({ seed, state: result.state, downs: result.downs.map(d => ({ slot: d.slot, by: d.by, x: d.x, y: d.y })), stats: result.stats }));
  }
  writeFileSync(`${out}/stock-bots.json`, JSON.stringify({ bouts, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(bouts.every(b => b.downs.length > 0), 'Each seeded CPU bout produces ring-outs');
} finally { await browser.close(); }
