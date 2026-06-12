// One-off worldgen diagnostic: generate a depth on a seed, BFS from spawn,
// and print a downsampled ASCII map (# wall, . open-unreached, + reached,
// S spawn, P portal) plus reach stats. Usage:
//   node scripts/diag-biome.mjs [depth] [seed] [url]
import { chromium } from 'playwright-core';

const depth = process.argv[2] ?? 'd2';
const seed = Number(process.argv[3] ?? 5);
const url = process.argv[4] ?? 'http://localhost:5173/';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const out = await page.evaluate(
  async ({ SEED, ID }) => {
    localStorage.removeItem('noita-expedition');
    const ctx = window.__game.ctx;
    ctx.state.worldSeed = SEED;
    const { reachableMask } = await import('/src/world/validate.ts');
    document.getElementById('mode-play-btn').click();
    await new Promise((r) => setTimeout(r, 1800));
    if (ID !== 'd1') {
      ctx.levels.leaveLevel();
      ctx.levels.enterLevel(ctx, ID);
      await new Promise((r) => setTimeout(r, 350));
    }
    const rt = ctx.levels.current;
    const w = rt.world;
    const W = w.width, H = w.height;
    const seen = reachableMask(rt);
    const { blocksEntity } = await import('/src/sim/CellType.ts');
    let open = 0, reached = 0, floorOpen = 0, floorReached = 0;
    const floorBand = H - 52;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = x + y * W;
        if (blocksEntity(w.types[i])) continue;
        open++;
        if (seen[i]) reached++;
        if (y >= floorBand) {
          floorOpen++;
          if (seen[i]) floorReached++;
        }
      }
    }
    // 1:16 ASCII map
    const SX = 16, SY = 16;
    const rows = [];
    for (let gy = 0; gy < Math.floor(H / SY); gy++) {
      let row = '';
      for (let gx = 0; gx < Math.floor(W / SX); gx++) {
        let openN = 0, reachN = 0;
        for (let dy = 0; dy < SY; dy += 4) {
          for (let dx = 0; dx < SX; dx += 4) {
            const x = gx * SX + dx, y = gy * SY + dy;
            const i = x + y * W;
            if (!blocksEntity(w.types[i])) {
              openN++;
              if (seen[i]) reachN++;
            }
          }
        }
        row += openN === 0 ? '#' : reachN > 0 ? '+' : '.';
      }
      rows.push(row);
    }
    const mark = (x, y, ch) => {
      const gy = Math.floor(y / SY), gx = Math.floor(x / SX);
      if (rows[gy]) rows[gy] = rows[gy].slice(0, gx) + ch + rows[gy].slice(gx + 1);
    };
    mark(rt.spawn.x, rt.spawn.y, 'S');
    if (rt.portal) mark(rt.portal.x, rt.portal.y, 'P');
    if (rt.exit) mark(rt.exit.x, rt.exit.sealY, 'X');
    return {
      spawn: rt.spawn, portal: rt.portal, exit: rt.exit,
      open, reached, floorOpen, floorReached,
      map: rows.join('\n'),
    };
  },
  { SEED: seed, ID: depth },
);

console.log(`spawn ${JSON.stringify(out.spawn)} portal ${JSON.stringify(out.portal)} exit ${JSON.stringify(out.exit)}`);
console.log(`open ${out.open} reached ${out.reached} (${((100 * out.reached) / out.open).toFixed(1)}%)`);
console.log(`floor strip: open ${out.floorOpen} reached ${out.floorReached}`);
console.log(out.map);
await browser.close();
