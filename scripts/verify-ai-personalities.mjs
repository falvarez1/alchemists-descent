// Controlled mirror encounters using the existing seeded, paused-step fight harness.
// Six personalities x four difficulties x two seeds/sides = 48 encounters, capped at 30 simulated seconds.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://127.0.0.1:5194/';
const profiles = ['berserker', 'duelist', 'ranger', 'assassin', 'guardian', 'trickster'];
const levels = process.argv.includes('--quick') ? [3] : [1, 3, 4, 5];
const seeds = [411, 912];
const check = makeChecker();
const rows = [], errors = [];
mkdirSync('verify-out/ai-personalities', { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(String(error)));
  const fresh = async () => {
    await page.goto(`${url}?link=off`, { waitUntil: 'networkidle', timeout: 60000 });
    await leaveTitleIfShown(page); await waitForConsoleApi(page);
    await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-duel --world campaign-level'); });
    await page.waitForFunction(() => window.__fight && window.__game.ctx.levels.current?.def.id === 'fighter-duel', null, { timeout: 40000 });
    await page.waitForTimeout(1000);
  };
  const run = async (personality, level, seed) => page.evaluate(async spec => {
    const result = await window.__fight.run(spec);
    const { jsonl: _log, ...small } = result;
    return small;
  }, { a: { id: 'mara-quell', brain: 'basic', personality, level }, b: { id: 'mara-quell', brain: 'basic', personality: 'duelist', level: 3 },
    seed, swapSpawns: seed === seeds[1], maxTicks: 1800, runId: 'ai-personality-regression' });
  for (const personality of profiles) {
    await fresh();
    for (const level of levels) for (const seed of seeds) {
      const result = await run(personality, level, seed);
      const stats = result.bots.map(b => b?.stats ?? {});
      const row = { personality, level, seed, ...result };
      rows.push(row);
      console.log(JSON.stringify({ personality, level, seed, ticks: result.ticks, reason: result.reason,
        distance: Math.round(stats[0].distanceTotal / stats[0].combatTicks), attacks: stats.map(s => s.attacks ?? 0),
        idle: stats.map(s => s.idleMax), stuck: stats.map(s => s.stuck), ms: Math.round(result.ms) }));
      check.check(`${personality}/${level}/${seed}: both fight, no prolonged idle or self KO`,
        stats.every(s => s.attacks > 0 && s.idleMax < 300 && !(s.selfKos > 0)));
    }
  }
  const summary = profiles.map(personality => {
    const selected = rows.filter(r => r.personality === personality);
    const stats = selected.map(r => r.bots[0].stats);
    const total = key => stats.reduce((n, s) => n + (s[key] ?? 0), 0);
    return { personality, encounters: selected.length, meanDistance: total('distanceTotal') / total('combatTicks'),
      pressureShare: total('pressureTicks') / total('combatTicks'), attacks: total('attacks'), defenses: total('defensiveChoices'),
      stuck: total('stuck'), targetSwitches: total('targetSwitches'), selfKos: total('selfKos') };
  });
  check.check('ranger holds greater average spacing than berserker', summary[2].meanDistance > summary[0].meanDistance + 10);
  check.check('berserker maintains more pressure than duelist', summary[0].pressureShare > summary[1].pressureShare);
  await fresh();
  const again = await run('berserker', levels[0], seeds[0]);
  const first = rows[0];
  check.check('seed replay preserves outcome and both bot diagnostics', JSON.stringify([again.hp, again.ticks, again.bots]) === JSON.stringify([first.hp, first.ticks, first.bots]));
  check.check('no page errors', errors.length === 0);
  console.log(JSON.stringify({ summary }, null, 2));
  writeFileSync('verify-out/ai-personalities/measured.json', JSON.stringify({ conditions: { fighter: 'mara-quell', opponent: 'mara-quell/duelist/normal', profiles, levels, seeds, cap: 1800 }, rows, summary, errors }, null, 2));
} finally { await browser.close(); }
console.log(`AI personalities: ${check.pass} passed, ${check.fail} failed`);
process.exitCode = check.fail ? 1 : 0;
