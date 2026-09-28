// Corpse-rest probe: kills creatures in hand-carved situations (thick floor,
// thin shelves, a crater bowl, a knock into a wall, a fall from height, an
// explosion) and follows the remains tick by tick through the real game tick.
// Fails when a corpse ends inside rock or below the floor it was standing on,
// or when a chain body's link stretches past its rest length.
// Usage: node scripts/probe-corpse-rest.mjs [url] [--kinds weaver,stonemaw,rillback] [--ticks 480]
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const kinds = opt('kinds', 'weaver,stonemaw,rillback').split(',');
const ticks = Number(opt('ticks', '480'));
const browser = await launchBrowser();
const errors = [];
let failures = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await waitForConsoleApi(page);
  await execConsoleCommand(page, 'run test --level physics-test --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page); await page.waitForTimeout(3200);
  const only = opt('only', '');
  const scenarios = [
    { name: 'thick floor, sideways blow', floor: 'thick', kx: 3, ky: -2 },
    { name: 'thick floor, hard downward blast', floor: 'thick', kx: 7, ky: 6 },
    { name: 'thin 2-cell shelf, downward blow', floor: 'thin2', kx: 1, ky: 5 },
    { name: 'thin 1-cell plank, dropped from height', floor: 'thin1', kx: 0, ky: 0, drop: 40 },
    { name: 'crater bowl, knocked in', floor: 'bowl', kx: -4, ky: -1 },
    { name: 'knocked into a wall', floor: 'wall', kx: 9, ky: 0 },
    { name: 'explosion beside it', floor: 'thick', explode: true },
  ];
  for (const kind of kinds) for (const sc of scenarios.filter(x => !only || x.name.includes(only))) {
    const r = await page.evaluate(({ kind, sc, ticks }) => {
      const game = window.__game, ctx = game.ctx, w = ctx.world, p = ctx.player;
      ctx.enemies.length = 0;
      if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0;
      const cx = 800, floor = 520;
      const set = (x, y, t) => { if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), t, t === 12 ? 0x565d63 : t === 13 ? 0x8a8f96 : 0); };
      for (let y = floor - 150; y <= floor + 90; y++) for (let x = cx - 160; x <= cx + 160; x++) set(x, y, 0);
      // Outer shell, then the scenario's ground.
      for (let y = floor - 150; y <= floor + 90; y++) for (let x = cx - 160; x <= cx + 160; x++) {
        if (x < cx - 154 || x > cx + 154 || y < floor - 146 || y > floor + 84) set(x, y, 12);
      }
      let surface = floor;
      if (sc.floor === 'thick' || sc.floor === 'wall') for (let y = floor + 1; y <= floor + 84; y++) for (let x = cx - 154; x <= cx + 154; x++) set(x, y, 12);
      if (sc.floor === 'wall') for (let y = floor - 146; y <= floor; y++) for (let x = cx + 12; x <= cx + 40; x++) set(x, y, 12);
      if (sc.floor === 'thin2') for (let y = floor + 1; y <= floor + 2; y++) for (let x = cx - 154; x <= cx + 154; x++) set(x, y, 12);
      if (sc.floor === 'thin1') for (let x = cx - 154; x <= cx + 154; x++) set(x, floor + 1, 13);
      if (sc.floor === 'bowl') {
        for (let y = floor + 1; y <= floor + 84; y++) for (let x = cx - 154; x <= cx + 154; x++) set(x, y, 12);
        for (let y = floor - 30; y <= floor + 30; y++) for (let x = cx - 60; x <= cx + 60; x++) {
          if (Math.hypot((x - (cx - 20)) / 1.6, y - floor + 4) < 26 && y > floor - 30) set(x, y, 0);
        }
      }
      p.x = cx - 140; p.y = floor; p.hp = p.maxHp = 9999; ctx.state.debugGodMode = true;
      const spawnY = sc.drop ? floor - sc.drop : floor;
      const e = ctx.enemyCtl.spawn(kind, cx, spawnY);
      if (!e) return { error: 'spawn failed' };
      e.sleeping = false;
      ctx.state.paused = true;
      const tick = () => game.tick(false, { forcePaused: true });
      for (let i = 0; i < (sc.drop ? 2 : 90); i++) tick();
      const solid = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); if (!w.inBounds(ix, iy)) return true; const t = w.types[w.idx(ix, iy)]; return t === 12 || t === 13 || t === 3; };
      // The weaver's drawn silhouette (creatures/weaverAnatomy WEAVER_SILHOUETTE), inset 1 cell.
      const SIL = [[-8.6, 2.4, 8.6, 6.6], [2.6, 0.8, 6.2, 4.6], [9.2, 1.2, 3.8, 3.3]];
      const buried = () => {
        const loco = e.weaverLoco;
        if (loco) {
          let n = 0; const tx = -loco.ny * loco.face, ty = loco.nx * loco.face;
          for (const [ca, co, ra, ro] of SIL) for (let k = 0; k < 24; k++) {
            const a = k / 24 * Math.PI * 2, al = ca + Math.cos(a) * (ra - 1), ou = co + Math.sin(a) * (ro - 1);
            if (solid(loco.px + tx * al + loco.nx * ou, loco.py + ty * al + loco.ny * ou)) n++;
          }
          return n;
        }
        return (e.body?.nodes ?? []).filter(nd => solid(nd.x, nd.y)).length;
      };
      if (sc.explode) {
        ctx.explosions.trigger(e.x + 14, e.y - 6, 18, {});
        if (ctx.enemies.includes(e)) ctx.enemyCtl.kill(e, -4, -3);
      } else if (ctx.enemies.includes(e)) ctx.enemyCtl.kill(e, sc.kx, sc.ky);
      const startX = e.x, startY = e.y; window.__insideLog = [];
      let insideTicks = 0, maxStretch = 0, worst = '';
      for (let t = 0; t < ticks; t++) {
        tick();
        if (buried() > 0) {
          insideTicks++;
          if (e.body && (window.__insideLog ??= []).length < 12) window.__insideLog.push(`t${t}:` + e.body.nodes.map((nd, i) => solid(nd.x, nd.y) ? `n${i}(${nd.x.toFixed(1)},${nd.y.toFixed(1)} r${nd.radius.toFixed(1)} prev ${nd.previousX.toFixed(1)},${nd.previousY.toFixed(1)})` : '').filter(Boolean).join(' '));
        }
        const nodes = e.body?.nodes;
        if (nodes) for (let i = 1; i < nodes.length; i++) {
          const d = Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
          if (d > maxStretch) { maxStretch = d; worst = `t${t} link${i}`; }
        }
      }
      ctx.state.paused = false;
      const loco = e.weaverLoco;
      const bx = loco ? loco.px : e.x, by = loco ? loco.py : e.y - 4;
      return { startX, startY, endX: +bx.toFixed(1), endY: +by.toFixed(1), eY: e.y, surface, insideTicks, endInside: buried() > 0,
        rolled: e.weaverLoco ? +e.weaverLoco.ny.toFixed(2) : undefined,
        log: window.__insideLog, nodes: e.body && buried() > 0 ? e.body.nodes.map(nd => `${nd.x.toFixed(1)},${nd.y.toFixed(1)}${solid(nd.x, nd.y) ? '#' : ''}`).join(' ') : undefined,
        maxStretch: +maxStretch.toFixed(1), worst, spacing: e.body?.spacing };
    }, { kind, sc, ticks });
    // Remains resting on an intact floor must end at (not under) its surface.
    const below = !sc.explode && sc.floor !== 'bowl' && r.eY > r.surface + 2;
    const stretched = r.spacing && r.maxStretch > r.spacing * 1.6;
    // Death gore (a Stone Maw sheds stone) can land on a node for a few ticks; it must work free.
    const bad = r.error || r.endInside || r.insideTicks > 30 || below || stretched;
    if (bad) failures++;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${kind.padEnd(9)} ${sc.name.padEnd(38)} ${JSON.stringify(r)}`);
  }
} finally { await browser.close(); }
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
console.log(failures ? `${failures} failing scenario(s)` : 'all scenarios rest cleanly');
process.exitCode = failures ? 1 : 0;
