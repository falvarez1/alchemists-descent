// THE SUMP HOLDS ITS WATER (fix3 regression probe for the Sunken Leviathan).
//
// The pool used to drain itself mid-fight (≈790 → 66 cells in 11 s). Causes,
// all instrumented here: electro-erosion spalled the stone drain plugs (a
// pool's diffuse current bit its own bed; a blast-rung metal casing arced into
// the stone set in it; blood relayed the casing's full current into the water
// uncapped), every spark bolt that struck the pool unmade the ~60 cells its
// blast displaced, a throw that hit the alchemist vanished, and generation
// tunnels had eaten the arena's shores so any water leaving the basin fell away
// for good. This probe fights the Leviathan for 30 s from the shore with REAL
// input (mouse aim + held fire); in the first half its water-throwing moves
// (tail-slam, volley) are cued, in the second half lightning-sized strikes land
// in its pool every 1.5 s; its hp is held so the fight runs — and asserts:
//   - the arena generated its rim: stone shores beside the casing
//   - the pool stays within 10% of its start the whole fight
//   - the drain plugs are intact
//   - the designed solution still works: dig the plugs → the pool drains → BEACHED
// TRACE=1 logs what removed a plug cell (and the charge beside it) on failure.
// Usage: node scripts/verify-leviathan-pool.mjs [url] [seedCsv]
import { launchBrowser } from './browser-launch.mjs';
import { getGameViewSize, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const seeds = (process.argv[3] ?? '1,7').split(',').map(Number);
const FIGHT_MS = 30000;

let pass = 0, fail = 0;
const check = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (ok) pass++;
  else fail++;
};

const browser = await launchBrowser({ headless: true });
try {
  for (const seed of seeds) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'networkidle' });
    await startConsoleTestRun(page, { seed, level: 'd3', loadout: 'fresh', settleMs: 1200 });
    const view = await getGameViewSize(page);

    if (process.env.TRACE) await page.evaluate(() => { window.__traceplugs = true; });
    const setup = await page.evaluate((NOSTRIKE) => {
      const ctx = window.__game.ctx, w = ctx.world, b = ctx.levels.current.boss;
      if (!b || b.kind !== 'leviathan') return { err: 'no leviathan arena' };
      const cx = b.x, cy = b.y - 26;
      const lev = ctx.enemies.find((e) => e.kind === 'leviathan');
      for (let i = ctx.enemies.length - 1; i >= 0; i--) if (ctx.enemies[i] !== lev) ctx.enemies.splice(i, 1);
      ctx.critters?.list?.splice?.(0);
      let shore = 0;
      for (const side of [-1, 1]) for (let dx = 28; dx <= 31; dx++) for (let dy = 17; dy <= 20; dy++) {
        if (w.types[w.idx(cx + side * dx, cy + dy)] === 12) shore++;
      }
      window.__sump = { cx, cy, moves: [] };
      if (window.__traceplugs) {
        const plugIdx = new Set();
        for (const px of [cx - 16, cx, cx + 16]) for (let dx = -1; dx <= 1; dx++) for (const Y of [cy + 33, cy + 34]) plugIdx.add(w.idx(px + dx, Y));
        window.__plugHits = [];
        for (const fn of ['clearCellAt', 'replaceCellAt', 'swap', 'setCell']) {
          const orig = w[fn]?.bind(w);
          if (!orig) continue;
          w[fn] = (...a) => {
            const idxs = fn === 'swap' ? [w.idx(a[0], a[1]), w.idx(a[2], a[3])] : fn === 'setCell' ? [w.idx(a[0], a[1])] : [a[0]];
            for (const i of idxs) {
              if (!(plugIdx.has(i) && w.types[i] === 12)) continue;
              const nb = [i - 1, i + 1, i - w.width, i + w.width].map((j) => `${w.types[j]}:${w.charge[j]}`).join(' ');
              window.__plugHits.push(`${fn} f${ctx.state.frameCount} nb[${nb}] ` + new Error().stack.split('\n')[2].trim().replace(/https?:\/\/[^/]+\//, ''));
            }
            return orig(...a);
          };
        }
      }
      window.__nostrike = NOSTRIKE;
      ctx.events.on('bossMove', (e) => window.__sump.moves.push(e.move));
      ctx.console.exec('god');
      // Stand on the west shore, facing the pool.
      const p = ctx.player;
      p.x = cx - 33; p.y = cy + 16; p.vx = 0; p.vy = 0;
      ctx.camera.snapTo(p.x, p.y);
      if (lev) { lev.alerted = true; lev.hp = lev.maxHp * 0.55; }
      return { cx, cy, shore, lev: !!lev };
    }, !!process.env.NOSTRIKE);
    if (setup.err) { check(false, `seed ${seed}: ${setup.err}`); await page.close(); continue; }
    check(setup.lev, `seed ${seed}: the Leviathan swims in its sump`);
    check(setup.shore >= 28, `seed ${seed}: the arena keeps its stone shores`, `${setup.shore}/32 shore cells`);

    const census = () => page.evaluate(() => {
      const ctx = window.__game.ctx, w = ctx.world, { cx, cy } = window.__sump;
      let water = 0, plugs = 0;
      for (let X = cx - 26; X <= cx + 26; X++) for (let Y = cy + 12; Y <= cy + 32; Y++) if (w.types[w.idx(X, Y)] === 2) water++;
      for (const px of [cx - 16, cx, cx + 16]) for (let dx = -1; dx <= 1; dx++) for (const Y of [cy + 33, cy + 34]) if (w.types[w.idx(px + dx, Y)] === 12) plugs++;
      const lev = ctx.enemies.find((e) => e.kind === 'leviathan');
      return { water, plugs, submerged: lev ? lev.submerged === true : null };
    });
    const c0 = await census();
    const canvas = await page.locator('#canvas-holder > canvas').boundingBox();
    const aimAtBoss = async () => {
      const pt = await page.evaluate((view) => {
        const ctx = window.__game.ctx, lev = ctx.enemies.find((e) => e.kind === 'leviathan');
        if (!lev) return null;
        const z = ctx.camera.zoom;
        return {
          ux: ((lev.x - ctx.camera.renderX) / view.w - 0.5) * z + 0.5,
          uy: ((lev.y - 8 - ctx.camera.renderY) / view.h - 0.5) * z + 0.5,
        };
      }, view);
      if (!pt) return;
      await page.mouse.move(canvas.x + Math.min(0.98, Math.max(0.02, pt.ux)) * canvas.width, canvas.y + Math.min(0.98, Math.max(0.02, pt.uy)) * canvas.height);
    };
    await aimAtBoss();
    if (!process.env.NOFIRE) await page.mouse.down();
    let minWater = c0.water;
    const t0 = Date.now();
    let k = 0;
    let died = false, lastCue = 0;
    while (Date.now() - t0 < FIGHT_MS) {
      await page.waitForTimeout(250);
      // Hold it in phase 2 (thrash) then phase 3 (dive): the fight, not the kill.
      const alive = await page.evaluate((late) => {
        const lev = window.__game.ctx.enemies.find((e) => e.kind === 'leviathan');
        if (!lev) return false;
        lev.hp = Math.max(lev.hp, lev.maxHp * (late ? 0.25 : 0.55));
        lev.alerted = true;
        return true;
      }, Date.now() - t0 > FIGHT_MS / 2);
      if (!alive) { died = true; break; }
      // Its water-throwing moves on cue in the first half (its AI picks them
      // only at certain ranges and phases): the tail-slam and the volley are
      // the pool, and the pool must come back.
      if (Date.now() - t0 < FIGHT_MS / 2 && Date.now() - lastCue > 2500) {
        const cued = await page.evaluate(() => {
          const ctx = window.__game.ctx, lev = ctx.enemies.find((e) => e.kind === 'leviathan');
          if (!lev?.boss || lev.boss.move !== 'lurk' || lev.submerged !== true) return false;
          const seen = window.__sump.moves;
          const move = !seen.includes('thrash') ? 'thrash' : !seen.includes('volley') ? 'volley' : seen.filter((m) => m === 'thrash').length <= seen.filter((m) => m === 'volley').length ? 'thrash' : 'volley';
          lev.boss.move = move; lev.boss.moveT = 0; lev.boss.moveDur = move === 'thrash' ? 40 : 26;
          ctx.events.emit('bossMove', { kind: lev.kind, move, phase: lev.boss.phase, x: lev.x, y: lev.y });
          return true;
        });
        if (cued) lastCue = Date.now();
      }
      await aimAtBoss();
      if (k++ % 6 === 0) {
        // First half: bolts only, so its own moves (lunge, thrash, volley) run;
        // second half: lightning-sized strikes too (Storm-kit worst case).
        const striking = Date.now() - t0 > FIGHT_MS / 2;
        await page.evaluate((striking) => {
          const ctx = window.__game.ctx, w = ctx.world, { cy } = window.__sump;
          const lev = ctx.enemies.find((e) => e.kind === 'leviathan');
          if (!lev) return;
          // A lightning-sized strike on the pool surface above it (Storm kit worst case).
          const x = Math.round(lev.x);
          let y = cy + 10;
          while (y < cy + 33 && w.types[w.idx(x, y)] !== 2) y++;
          if (striking && !window.__nostrike && w.types[w.idx(x, y)] === 2) { ctx.events.emit('cardCast', { x, y }); w.setChargeAt(w.idx(x, y), 70); }
        }, striking);
        const c = await census();
        minWater = Math.min(minWater, c.water);
        if (process.env.DEBUG) console.log('   ', ((Date.now() - t0) / 1000).toFixed(1), JSON.stringify(c), JSON.stringify(await page.evaluate(() => { const ctx = window.__game.ctx, l = ctx.enemies.find((e) => e.kind === 'leviathan'), { cx, cy } = window.__sump; return l ? [Math.round(l.x - cx), Math.round(l.y - cy), l.boss?.move, Math.round(l.hp)] : null; })));
      }
    }
    await page.mouse.up();
    const c1 = await census();
    const moves = await page.evaluate(() => window.__sump.moves);
    minWater = Math.min(minWater, c1.water);
    check(!died, `seed ${seed}: the Leviathan lives through the held fight`);
    check(moves.includes('thrash') && moves.includes('volley'), `seed ${seed}: the fight ran its water-throwing moves`, [...new Set(moves)].join(','));
    check(minWater >= c0.water * 0.9, `seed ${seed}: the pool holds through a 30 s fight`, `water ${c0.water} → min ${minWater} → end ${c1.water}`);
    check(c1.plugs === 18, `seed ${seed}: the drain plugs are intact`, `${c1.plugs}/18`);
    if (c1.plugs !== 18) console.log(await page.evaluate(() => (window.__plugHits ?? []).slice(0, 6).join(' | ')));

    // The designed solution: the player digs the plugs (the Excavate Ray's
    // erode, at each gold-dust tell).
    await page.evaluate(() => {
      const ctx = window.__game.ctx, { cx, cy } = window.__sump;
      for (const px of [cx - 16, cx, cx + 16]) ctx.spells.erodeAt(px, cy + 34, 2);
    });
    let drained = null, beached = false;
    for (let t = 0; t < 60; t++) {
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const lev = window.__game.ctx.enemies.find((e) => e.kind === 'leviathan');
        if (lev) lev.hp = Math.max(lev.hp, lev.maxHp * 0.25); // the probe watches it beach, not die
      });
      drained = await census();
      if (drained.water < 80 && drained.submerged === false) { beached = true; break; }
    }
    check(drained.water < 80, `seed ${seed}: dug plugs drain the basin`, `water ${drained.water}`);
    check(beached, `seed ${seed}: the Leviathan is BEACHED`, beached ? '' : JSON.stringify(await page.evaluate(() => {
      const ctx = window.__game.ctx, l = ctx.enemies.find((e) => e.kind === 'leviathan'), { cx, cy } = window.__sump;
      return l ? { x: Math.round(l.x - cx), y: Math.round(l.y - cy), sub: l.submerged, move: l.boss?.move } : 'gone';
    })));
    for (const e of errors) check(false, `seed ${seed}: page error`, e);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
