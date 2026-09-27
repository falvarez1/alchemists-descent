// Light wave perf A/B (docs/FEEL.md §10): the same Undertow scene — eight
// creatures, a sweeping beam — stepped with designed darkness ON and OFF in
// alternating blocks (ABAB…, same page, same GPU), timing the light build,
// the whole compose, and the creature update per tick.
// Usage: node scripts/perf-light.mjs [url] [--blocks 6] [--ticks 240]
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const BLOCKS = Number(opt('blocks', '6'));
const TICKS = Number(opt('ticks', '240'));

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(url);
await waitForConsoleApi(page);
await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
await waitForRunReady(page);
await page.waitForTimeout(2500);

const setup = await page.evaluate(() => {
  const game = window.__game, ctx = game.ctx, rt = ctx.levels.current;
  ctx.state.debugGodMode = true; ctx.player.hp = ctx.player.maxHp = 99999;
  for (let i = ctx.enemies.length - 1; i >= 0; i--) { const e = ctx.enemies[i]; if (e.y > 850 && e.x < 960) ctx.enemies.splice(i, 1); }
  const px = 520;
  const spawn = (k, x, y) => ctx.enemyCtl.spawn(k, x, y);
  for (const [k, dx, y] of [['weaver', 90, 1006], ['weaver', -80, 1006], ['bat', 40, 930], ['bat', 70, 925], ['bat', -40, 935],
    ['slime', 130, 1006], ['rootloper', -130, 1006], ['spitter', 170, 1006]]) spawn(k, px + dx, y);
  window.__lightZones = rt.darkZones;
  const light = game.composer.light;
  const origBuild = light.build.bind(light);
  const t = { build: 0, builds: 0 };
  light.build = (c) => { const s = performance.now(); origBuild(c); t.build += performance.now() - s; t.builds++; };
  window.__lightT = t;
  const enemyCtl = ctx.enemyCtl, origUpd = enemyCtl.update.bind(enemyCtl);
  const e = { ms: 0 };
  enemyCtl.update = (c) => { const s = performance.now(); origUpd(c); e.ms += performance.now() - s; };
  window.__enemyT = e;
  const comp = game.composer, origCompose = comp.compose.bind(comp);
  const cT = { ms: 0, n: 0 };
  comp.compose = (c, a) => { const s = performance.now(); origCompose(c, a); cT.ms += performance.now() - s; cT.n++; };
  window.__composeT = cT;
  return { px, enemies: ctx.enemies.filter((q) => q.y > 850 && q.x < 960).length, zones: rt.darkZones?.length ?? 0 };
});
console.log('setup', setup);

async function block(dark) {
  return page.evaluate(({ dark, TICKS, px }) => {
    const game = window.__game, ctx = game.ctx, rt = ctx.levels.current;
    rt.darkZones = dark ? window.__lightZones : [];
    const t = window.__lightT, e = window.__enemyT, c = window.__composeT;
    // warm-up (rebake / JIT) outside the measurement
    for (let k = 0; k < 20; k++) { ctx.player.x = px; ctx.input.mouse.x = px + 100; ctx.input.mouse.y = 980; game.tick(true, { forcePaused: true }); }
    t.build = 0; t.builds = 0; e.ms = 0; c.ms = 0; c.n = 0;
    const s0 = performance.now();
    for (let k = 0; k < TICKS; k++) {
      ctx.player.x = px; ctx.player.vx = 0;
      const a = Math.sin(k * 0.05) * 1.3; // the beam sweeps the room
      ctx.input.mouse.x = px + Math.cos(a) * 140; ctx.input.mouse.y = 999 + Math.sin(a) * 90 - 40;
      game.tick(true, { forcePaused: true });
    }
    const total = performance.now() - s0;
    return { dark, perTick: total / TICKS, build: t.build / Math.max(1, t.builds), buildPerTick: t.build / TICKS, enemies: e.ms / TICKS, compose: c.ms / Math.max(1, c.n) };
  }, { dark, TICKS, px: setup.px });
}

const rows = [];
for (let b = 0; b < BLOCKS; b++) rows.push(await block(b % 2 === 0));
const avg = (dark, key) => { const r = rows.filter((x) => x.dark === dark); return r.reduce((s, x) => s + x[key], 0) / r.length; };
const out = {};
for (const key of ['perTick', 'compose', 'buildPerTick', 'build', 'enemies']) {
  out[key] = { dark: +avg(true, key).toFixed(3), lit: +avg(false, key).toFixed(3), delta: +(avg(true, key) - avg(false, key)).toFixed(3) };
}
console.log(JSON.stringify({ blocks: rows.map((r) => ({ dark: r.dark, perTick: +r.perTick.toFixed(2), compose: +r.compose.toFixed(2), enemies: +r.enemies.toFixed(3) })), summary: out }, null, 1));
await browser.close();
