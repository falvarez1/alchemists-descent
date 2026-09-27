// Chain-body stretch probe: a live Stone Maw (and a beached Rillback) hunts a
// god-mode alchemist through a thick stone wall, chewing a tunnel and dropping
// its sand spoil behind it; later it is killed and its remains watched. Every
// tick measures each spine link. A link past 1.6x its rest length is the
// "neck stretched into a long glowing bar" bug.
// Usage: node scripts/probe-chain-stretch.mjs [url] [--kinds stonemaw,rillback] [--ticks 2400]
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const kinds = opt('kinds', 'stonemaw,rillback').split(',');
const ticks = Number(opt('ticks', '2400'));
const layouts = opt('layouts', 'wall,sandfall,pit').split(',');
const browser = await launchBrowser();
const errors = [];
let failures = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await waitForConsoleApi(page);
  await execConsoleCommand(page, 'run test --level physics-test --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page); await page.waitForTimeout(3200);
  for (const kind of kinds) for (const layout of layouts) {
    const r = await page.evaluate(({ kind, layout, ticks }) => {
      const game = window.__game, ctx = game.ctx, w = ctx.world, p = ctx.player;
      ctx.enemies.length = 0;
      if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0;
      const cx = 800, floor = 520;
      const set = (x, y, t) => { if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), t, t === 12 ? 0x565d63 : t === 1 ? 0xc2a060 : 0); };
      for (let y = floor - 150; y <= floor + 90; y++) for (let x = cx - 200; x <= cx + 200; x++) {
        const shell = x < cx - 194 || x > cx + 194 || y < floor - 146 || y > floor;
        set(x, y, shell ? 12 : 0);
      }
      if (layout === 'wall') for (let y = floor - 146; y <= floor; y++) for (let x = cx + 20; x <= cx + 90; x++) set(x, y, 12);
      if (layout === 'sandfall') {
        for (let y = floor - 146; y <= floor; y++) for (let x = cx + 20; x <= cx + 90; x++) set(x, y, 12);
        for (let y = floor - 60; y <= floor - 40; y++) for (let x = cx - 60; x <= cx + 10; x++) set(x, y, 1);
      }
      if (layout === 'pit') for (let y = floor - 30; y <= floor + 40; y++) for (let x = cx - 40; x <= cx + 40; x++) {
        if (y > floor && Math.hypot((x - cx) / 1.4, y - floor) < 26) set(x, y, 0);
      }
      p.x = layout === 'pit' ? cx + 150 : cx + 150; p.y = floor; p.hp = p.maxHp = 99999; ctx.state.debugGodMode = true;
      const e = ctx.enemyCtl.spawn(kind, layout === 'pit' ? cx - 20 : cx - 40, layout === 'pit' ? floor + 20 : floor);
      if (!e) return { error: 'spawn failed' };
      e.sleeping = false;
      ctx.state.paused = true;
      const tick = () => game.tick(false, { forcePaused: true });
      let taut = 0; const tautLog = [];
      let maxLive = 0, maxDead = 0, whenLive = '', whenDead = '', over = 0, dead = false;
      const spacing = () => e.body?.spacing ?? 4;
      for (let t = 0; t < ticks; t++) {
        if (!dead && t === Math.floor(ticks * 0.7) && ctx.enemies.includes(e)) { ctx.enemyCtl.kill(e, 3, -2); dead = true; }
        if (layout === 'sandfall' && t === 300) for (let y = floor - 60; y <= floor - 40; y++) for (let x = cx - 60; x <= cx + 10; x++) if (w.types[w.idx(x, y)] === 0) set(x, y, 1);
        tick();
        const nodes = e.body?.nodes;
        if (!nodes) continue;
        let m = 0, li = 0;
        for (let i = 1; i < nodes.length; i++) {
          const d = Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
          if (d > m) { m = d; li = i; }
        }
        if (m > spacing() * 1.6) over++;
        if (m > spacing() * 1.3) { taut++; if (tautLog.length < 6) tautLog.push(`t${t} l${li}=${m.toFixed(1)} wet${(e.rillWet ?? 0).toFixed(2)} ${nodes.map(n => n.x.toFixed(0) + ',' + n.y.toFixed(0)).join(' ')}`); }
        if (dead) { if (m > maxDead) { maxDead = m; whenDead = `t${t} link${li}`; } }
        else if (m > maxLive) { maxLive = m; whenLive = `t${t} link${li} head(${nodes[0].x.toFixed(0)},${nodes[0].y.toFixed(0)}) e(${e.x},${e.y})`; }
      }
      ctx.state.paused = false;
      return { maxLive: +maxLive.toFixed(1), whenLive, maxDead: +maxDead.toFixed(1), whenDead, overTicks: over, taut, tautLog, spacing: spacing(), ex: e.x, ey: e.y, px: p.x };
    }, { kind, layout, ticks });
    const bad = r.error || r.maxLive > r.spacing * 1.6 || r.maxDead > r.spacing * 1.6;
    if (bad) failures++;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${kind.padEnd(9)} ${layout.padEnd(9)} ${JSON.stringify(r)}`);
  }
} finally { await browser.close(); }
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
console.log(failures ? `${failures} failing run(s)` : 'every spine held its length');
process.exitCode = failures ? 1 : 0;
