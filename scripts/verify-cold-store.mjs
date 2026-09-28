// THE COLD STORE's chemistry and set pieces, live in the real game (d2b):
//  - the Frozen Fall: break the store-tank's seal, the fresh water falls and
//    FLOATS on the brine lake, nitrogen freezes that layer into an ice bridge
//    a body can stand on, and the brine beneath eats the bridge back;
//  - the Ice Vault: the coal brazier lit against the ice wall melts it; the
//    brine cistern's plug broken lets the salt eat it;
//  - brine never freezes (nitrogen poured on it leaves it brine).
//   node scripts/verify-cold-store.mjs [--seed=7] [--url=http://localhost:5173/]
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const url = opt('url', 'http://localhost:5173/');
const seed = Number(opt('seed', '7'));

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await startConsoleTestRun(page, { level: 'd2b', seed, settleMs: 800 });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const pieces = await page.evaluate(() => (window.__game.ctx.levels.current.placedPrefabs ?? []).filter((p) => p.id.startsWith('cold-')));
check(pieces.some((p) => p.id === 'cold-frozen-fall'), `the Frozen Fall is placed (${pieces.map((p) => p.id).join(', ')})`);
check(pieces.some((p) => p.id === 'cold-ice-vault'), 'the Ice Vault is placed');

// Both set pieces are joined to the caves the player walks.
const reach = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const findability = window.__game.debugFindability?.(rt) ?? null;
  return findability;
});
void reach;

const fall = pieces.find((p) => p.id === 'cold-frozen-fall');
if (fall) {
  const r = await page.evaluate(async (P) => {
    const game = window.__game, ctx = game.ctx, w = ctx.world;
    const C = { Empty: 0, Water: 2, Ice: 10, Stone: 12, Metal: 13, Nitrogen: 16, Brine: 42 };
    const spec = { w: P.x1 - P.x0 + 1, h: P.y1 - P.y0 + 1 };
    const floorY = P.y0 + spec.h - 14;
    const lakeL = P.x0 + 44, lakeR = P.x1 - 44, surface = floorY + 6, mouth = P.y0 + 10;
    const tankX = Math.floor((lakeL + lakeR) / 2);
    ctx.state.debugGodMode = true;
    ctx.state.paused = false;
    ctx.player.x = P.x0 + 26; ctx.player.y = floorY - 1; ctx.player.vx = 0; ctx.player.vy = 0;
    const count = (x0, y0, x1, y1, t) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.types[w.idx(x, y)] === t) n++; return n; };
    const brine0 = count(lakeL, surface, lakeR, floorY + 22, C.Brine);
    const tankWater = count(tankX - 21, mouth - 12, tankX + 21, mouth - 1, C.Water);
    // The player breaks the seal (a dig through the two stone rows).
    for (let y = mouth; y <= mouth + 1; y++) for (let x = tankX - 6; x <= tankX + 6; x++) w.clearCellAt(w.idx(x, y));
    w.activity.invalidateAll();
    for (let k = 0; k < 900; k++) { ctx.state.paused = false; game.tick(false); }
    // Fresh water now floats in a layer over the brine.
    let freshTop = 0;
    for (let x = lakeL + 4; x <= lakeR - 4; x += 2) {
      for (let y = floorY; y <= floorY + 22; y++) {
        const t = w.types[w.idx(x, y)];
        if (t === C.Empty) continue;
        if (t === C.Water) freshTop++;
        break;
      }
    }
    const columns = Math.floor((lakeR - lakeL - 8) / 2) + 1;
    const water = count(lakeL, floorY - 4, lakeR, floorY + 22, C.Water);
    // Freeze it: liquid nitrogen poured along the surface.
    for (let x = lakeL + 2; x <= lakeR - 2; x += 3) {
      for (let y = floorY - 6; y <= floorY + 22; y++) {
        if (w.types[w.idx(x, y)] === C.Empty && w.types[w.idx(x, y + 1)] === C.Water) { w.replaceCellAt(w.idx(x, y), C.Nitrogen, 0xd2f5ff); break; }
      }
    }
    w.activity.invalidateAll();
    for (let k = 0; k < 120; k++) { ctx.state.paused = false; game.tick(false); }
    const ice1 = count(lakeL, floorY - 4, lakeR, floorY + 22, C.Ice);
    // A body can stand on the bridge's middle.
    let standY = -1;
    const mid = Math.floor((lakeL + lakeR) / 2);
    for (let y = floorY - 6; y <= floorY + 22; y++) if (w.types[w.idx(mid, y)] === C.Ice) { standY = y - 1; break; }
    const standable = standY > 0 && ctx.physics.entityFree(mid, standY, 4, 17);
    // Brine under it eats it back.
    for (let k = 0; k < 2400; k++) { ctx.state.paused = false; game.tick(false); }
    const ice2 = count(lakeL, floorY - 4, lakeR, floorY + 22, C.Ice);
    const brine2 = count(lakeL, surface - 6, lakeR, floorY + 22, C.Brine);
    return { brine0, brine2, tankWater, freshTop, columns, water, ice1, ice2, standable, standY };
  }, fall);
  console.log(JSON.stringify(r));
  check(r.tankWater > 200, `the store-tank holds fresh water (${r.tankWater} cells)`);
  check(r.freshTop > r.columns * 0.5, `the fallen water floats on the brine (${r.freshTop}/${r.columns} columns topped with water)`);
  check(r.ice1 > 60, `nitrogen freezes the fresh layer into a bridge (${r.ice1} ice)`);
  check(r.standable, `a body can stand on the bridge (y ${r.standY})`);
  check(r.ice2 < r.ice1 * 0.8, `the brine eats the bridge from below (${r.ice1} -> ${r.ice2})`);
  check(r.brine2 > r.brine0 * 0.8, `the brine never froze (${r.brine0} -> ${r.brine2})`);
}

const vault = pieces.find((p) => p.id === 'cold-ice-vault');
if (vault) {
  const r = await page.evaluate(async (P) => {
    const game = window.__game, ctx = game.ctx, w = ctx.world;
    const C = { Empty: 0, Ice: 10, Coal: 28, Stone: 12, Brine: 42 };
    const spec = { w: P.x1 - P.x0 + 1, h: P.y1 - P.y0 + 1 };
    const x1 = P.x0 + spec.w - 1, floorY = P.y0 + spec.h - 12;
    const vx0 = x1 - 44, vy0 = floorY - 26, vy1 = floorY - 1, wallX0 = vx0 - 10;
    const bx0 = vx0 - 12, bx1 = vx0 + 1, by1 = vy0 - 3;
    ctx.state.debugGodMode = true;
    ctx.player.x = P.x0 + 26; ctx.player.y = floorY - 1; ctx.player.vx = 0; ctx.player.vy = 0;
    const iceIn = () => { let n = 0; for (let y = vy0; y <= vy1; y++) for (let x = wallX0; x < vx0; x++) if (w.types[w.idx(x, y)] === C.Ice) n++; return n; };
    const ice0 = iceIn();
    const f0 = ctx.state.frameCount, paused = ctx.state.paused;
    ctx.state.paused = false;
    // Heat: light the coal brazier banked against the wall.
    let lit = 0;
    for (let y = floorY - 4; y <= floorY - 1; y++) for (let x = wallX0 - 12; x < wallX0; x++) {
      const i = w.idx(x, y);
      if (w.types[i] === C.Coal) { w.life[i] = 300; lit++; }
    }
    w.activity.invalidateAll();
    for (let k = 0; k < 1800; k++) { ctx.state.paused = false; game.tick(false); }
    const ice1 = iceIn();
    // Salt: break the cistern's plug and let the brine run down the wall.
    for (let y = by1; y <= by1 + 1; y++) for (let x = bx0; x <= bx1; x++) w.clearCellAt(w.idx(x, y));
    w.activity.invalidateAll();
    for (let k = 0; k < 2400; k++) { ctx.state.paused = false; game.tick(false); }
    const ice2 = iceIn();
    return { ice0, lit, ice1, ice2, paused, ticks: ctx.state.frameCount - f0 };
  }, vault);
  console.log(JSON.stringify(r));
  check(r.ice0 >= 200, `the vault is walled in ice (${r.ice0} cells)`);
  check(r.lit > 5 && r.ice1 < r.ice0, `the lit brazier melts the wall (${r.ice0} -> ${r.ice1})`);
  check(r.ice2 < r.ice1 * 0.85, `the brine eats the wall through (${r.ice1} -> ${r.ice2})`);
}

check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
