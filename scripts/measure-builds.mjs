// Balance instrument for the choice update: damage and mana of REAL casts.
//
// Every number in docs/FEEL.md §5 "Frames and bargains" comes from this: the real WandSystem.fire, the real
// compiler, the real projectile/explosion code, a target with effectively endless hit points, and a 600-tick
// (10 s) window of held fire per build and scenario. Nothing is modelled: a bargain's price shows up the way a
// player meets it — a wandering aim missing at range, a short life running out, a slow bolt chasing a strafing
// target, a tank running dry.
//
// Usage: node scripts/measure-builds.mjs [url] [--json]   (dev server running; defaults to :5173)
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/';
const asJson = args.includes('--json');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 30000 });
await startConsoleTestRun(page, { loadout: 'fresh', settleMs: 200 });

const BUILDS = [
  // the baselines: what the starter kit does
  { id: 'spark', frame: 'oak', cards: ['spark'] },
  { id: 'heavy+spark', frame: 'oak', cards: ['heavy', 'spark'] },
  { id: 'double+spark+spark', frame: 'bone', cards: ['double', 'spark', 'spark'] },
  { id: 'bomb', frame: 'oak', cards: ['bomb'] },
  { id: 'heavy+bomb', frame: 'oak', cards: ['heavy', 'bomb'] },
  { id: 'frostshard', frame: 'oak', cards: ['frostshard'] },
  { id: 'meteor', frame: 'bone', cards: ['meteor'] },
  // the bargains, on the starter wand
  { id: 'overcharge+spark', frame: 'oak', cards: ['overcharge', 'spark'] },
  { id: 'loosecannon+spark', frame: 'oak', cards: ['loosecannon', 'spark'] },
  { id: 'shortfuse+spark', frame: 'oak', cards: ['shortfuse', 'spark'] },
  { id: 'millstone+spark', frame: 'oak', cards: ['millstone', 'spark'] },
  { id: 'kickback+spark', frame: 'oak', cards: ['kickback', 'spark'] },
  { id: 'overcharge+bomb', frame: 'bone', cards: ['overcharge', 'bomb'] },
  { id: 'millstone+frostshard', frame: 'oak', cards: ['millstone', 'frostshard'] },
  // the frames, carrying the same three builds
  ...['oak', 'bone', 'brass', 'void', 'quill', 'pepperpot', 'mortar', 'samovar'].flatMap((frame) => [
    { id: `[${frame}] spark`, frame, cards: ['spark'] },
    { id: `[${frame}] double+spark+spark`, frame, cards: ['double', 'spark', 'spark'] },
    { id: `[${frame}] meteor`, frame, cards: ['meteor'] },
  ]),
];

const SCENARIOS = [
  { id: 'near', dist: 30, strafe: 0 },
  { id: 'mid', dist: 70, strafe: 0 },
  { id: 'far', dist: 200, strafe: 0 },
  // a target that will not hold still ACROSS the line of fire (a flier, a hopper): 20 cells up and down every ~50 ticks
  { id: 'strafe', dist: 90, strafe: 20 },
  // the price of an explosive build: the alchemist is mortal for this one
  { id: 'self', dist: 70, strafe: 0, mortal: true },
];

const rows = await page.evaluate(async ({ BUILDS, SCENARIOS }) => {
  const ctx = window.__game.ctx;
  const world = ctx.world;
  const clearRect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y));
  };
  clearRect(10, 40, 330, 150);
  const out = [];
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      ctx.state.frameCount++;
      ctx.projectileCtl.update(ctx);
    }
  };
  for (const build of BUILDS) {
    for (const scenario of SCENARIOS) {
      // seat the build
      const w = ctx.wands.wands[0];
      if (w.frame.id !== build.frame) ctx.wands.upgradeFrame(ctx, 0, build.frame);
      w.cards.fill(null);
      build.cards.forEach((c, i) => { w.cards[i] = c; });
      ctx.wands.active = 0;
      ctx.wands.invalidatePrograms();
      const runs = [];
      for (let rep = 0; rep < 3; rep++) {
        ctx.projectiles.length = 0;
        ctx.enemies.length = 0;
        ctx.player.x = 30; ctx.player.y = 120; ctx.player.vx = 0; ctx.player.vy = 0; ctx.player.grounded = true; ctx.player.dead = false;
        ctx.player.hp = ctx.player.maxHp = 1e6; ctx.player.invuln = scenario.mortal ? 0 : 1e6;
        ctx.state.frameCount = 100 + rep * 1000;
        ctx.enemyCtl.spawn('slime', 30 + scenario.dist, 120);
        const e = ctx.enemies[ctx.enemies.length - 1];
        const BIG = 1e7;
        e.hp = e.maxHp = BIG;
        w.mana = w.frame.manaMax; w.cooldown = 0; w.castIndex = 0;
        let damage = 0, burst = 0, spent = 0, groups = 0, minMana = w.mana, kick = 0;
        for (let t = 0; t < 600; t++) {
          const ex = 30 + scenario.dist;
          const ey = (scenario.strafe ? 105 : 120) + scenario.strafe * Math.sin(t / 8);
          e.x = ex; e.y = ey; e.vx = 0; e.vy = 0;
          ctx.player.x = 30; ctx.player.y = 120; ctx.player.vx = 0; ctx.player.vy = 0; ctx.player.grounded = true;
          if (scenario.mortal) ctx.player.invuln = 0;
          // The wand tip depends on the aim (and settles over a few poses): converge, as the live mouse aim does.
          for (let k = 0; k < 4; k++) {
            const tip = ctx.spells.wandTip();
            ctx.player.aimAngle = Math.atan2(e.y - 5 - tip.y, ex - tip.x);
          }
          ctx.input.mouse.x = ex; ctx.input.mouse.y = e.y - 5;
          ctx.player.firing = true; ctx.player.firePressed = false; ctx.player.recharge = 0;
          // The cell sim is not running here, so an explosion's fire and debris would never burn out and would
          // wall the corridor: keep the arena the clean floor a real fight has.
          if (t % 2 === 0) clearRect(20, 90, 320, 130);
          ctx.wands.update(ctx);
          const before = w.mana, idx = w.castIndex, cd = w.cooldown;
          ctx.wands.fire(ctx);
          if (w.cooldown > cd || w.castIndex !== idx) { spent += before - w.mana; groups++; kick += Math.abs(ctx.player.vx); }
          minMana = Math.min(minMana, w.mana);
          step(1);
          damage += BIG - e.hp; if (t < 180) burst += BIG - e.hp; e.hp = BIG;
        }
        runs.push({ damage, burst, spent, groups, minMana, kick, selfHp: scenario.mortal ? 1e6 - ctx.player.hp : 0 });
      }
      const mean = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
      out.push({ build: build.id, scenario: scenario.id, damage: mean('damage'), burst: mean('burst'), spent: mean('spent'), groups: mean('groups'), minMana: mean('minMana'), kick: mean('kick'), selfHp: mean('selfHp') });
    }
  }
  return out;
}, { BUILDS, SCENARIOS });

if (asJson) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const byBuild = new Map();
  for (const r of rows) {
    if (!byBuild.has(r.build)) byBuild.set(r.build, {});
    byBuild.get(r.build)[r.scenario] = r;
  }
  const fmt = (r) => (r ? `${(r.damage / 10).toFixed(0).padStart(5)} dps ${(r.spent > 0 ? r.damage / r.spent : 0).toFixed(1).padStart(5)} /mana` : '');
  const shown = SCENARIOS.filter((x) => !x.mortal);
  console.log('build'.padEnd(26) + shown.map((x) => x.id.padEnd(21)).join('') + 'casts/s spent/s minMana burst3s  kick  selfHP/10s');
  for (const [id, sc] of byBuild) {
    const any = sc.mid;
    console.log(id.padEnd(26) + shown.map((x) => fmt(sc[x.id]).padEnd(21)).join('')
      + `${(any.groups / 10).toFixed(2).padStart(6)} ${(any.spent / 10).toFixed(1).padStart(8)} ${any.minMana.toFixed(0).padStart(7)} ${any.burst.toFixed(0).padStart(7)} ${(any.groups > 0 ? any.kick / any.groups : 0).toFixed(1).padStart(6)} ${(sc.self ? sc.self.selfHp : 0).toFixed(0).padStart(8)}`);
  }
}
if (pageErrors.length) console.log('page errors:', pageErrors);
await browser.close();
