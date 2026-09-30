import { HEIGHT, WIDTH } from '@/config/constants';
import type { LavaLakeBudget } from '@/config/gen';
import { valueNoise } from '@/core/math';
import { makePickup } from '@/core/pickupDefs';
import type { Rng } from '@/core/rng';
import type { Pickup } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { lavaColor, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import { type CarveAvoid, type PlacementLedger, tunnelTo } from '@/world/connect';
import { fitWalks, reachedNear } from '@/world/fitWalks';
import { clearLooseStock } from '@/world/looseStock';
import { computeFits, wizardMask } from '@/world/validate';

/**
 * LAVA LAKES (GEN 62, the Kiln Heart): the volcanic floor's molten lakes.
 *
 * Two kinds, both CONTAINED by construction, both placed LAST on a forked
 * stream so no earlier placement moves, both gated on a per-biome budget
 * (config/gen.ts `lavaLakes`; a biome without one never reaches this file):
 *
 * - MAGMA HALLS: a wide chamber carved into thick rock (every cell of it and of
 *   a margin round it is solid), its lower part filled with lava, its upper
 *   part open air. One mouth joins it to the walkable network by a tunnel that
 *   leaves ABOVE the lava line onto a stone shelf, with a gold lure on the
 *   shelf's end. After the tunnel is carved, any open cell beside the lava at
 *   or below the surface is plugged with stone (a carve can never open a leak).
 * - BASIN LAKES: the exact set of open cells a natural pit holds below one level
 *   line, found by a flood whose line rises a row at a time until the next row
 *   would spill past a limit (area, a protected place, a flammable neighbour).
 *
 * Lava is passable to the route validators (a levitating wizard crosses it), so
 * the pass keeps the promise itself: no lake within a body's reach of a walk from
 * the spawn to a place the player must stand, and a last check with the lakes as
 * rock drops any that still cost a route (fail-open).
 */

/** A place the player must be able to stand: lakes keep clear of it and of the walk to it. */
export interface LakeTarget {
  x: number;
  y: number;
  /** Clear radius around the point itself. */
  protect: number;
}

export interface LavaLake {
  kind: 'hall' | 'basin';
  cells: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  surfaceY: number;
}

export interface LavaLakeResult {
  lakes: LavaLake[];
  cells: number;
  /** Lakes taken back because they cost a route (should stay 0). */
  dropped: number;
  /** The gold lures on the halls' shelves. */
  pickups: Pickup[];
  /** Why candidates failed (tuning aid, read by the lab). */
  debug: Record<string, number>;
}

/** Soft growth the lava simply replaces (and that is cleared from its shore). */
const CLEARABLE = new Uint8Array(256);
for (const t of [Cell.Vines, Cell.Fungus, Cell.Glowshroom, Cell.Moss, Cell.Grass, Cell.Leaf, Cell.Seed]) CLEARABLE[t] = 1;

/** Things lava must never touch (they ignite, boil, freeze, detonate or vitrify). */
const DANGER = new Uint8Array(256);
for (const t of [
  Cell.Water, Cell.Oil, Cell.Gunpowder, Cell.Wood, Cell.Trunk, Cell.Fire, Cell.Ember, Cell.Acid, Cell.Toxic, Cell.Nitrogen,
  Cell.Ice, Cell.Snow, Cell.Healium, Cell.Blood, Cell.Slime, Cell.Steam, Cell.MarshGas, Cell.Brine, Cell.Teleportium,
]) DANGER[t] = 1;

/** What may line a lake: static rock and built material. Anything else (a powder, an open cell) beside the lava is fused to stone. */
const STATIC = new Uint8Array(256);
for (const t of [Cell.Wall, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.RawOre, Cell.Mirror, Cell.Lava]) STATIC[t] = 1;

/** Ground a hall may be carved from: solid rock, no vault shell, no soft growth. */
const ROCK = new Uint8Array(256);
for (const t of [Cell.Wall, Cell.Stone, Cell.Gold, Cell.Coal, Cell.RawOre, Cell.Crystal]) ROCK[t] = 1;

const N4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function markDisc(mask: Uint8Array, cx: number, cy: number, r: number): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    const Y = cy + dy;
    if (Y < 0 || Y >= HEIGHT) continue;
    for (let dx = -r; dx <= r; dx++) {
      const X = cx + dx;
      if (X < 0 || X >= WIDTH || dx * dx + dy * dy > r2) continue;
      mask[X + Y * WIDTH] = 1;
    }
  }
}

function nearMask(mask: Uint8Array, x: number, y: number, r: number): boolean {
  x = Math.floor(x);
  y = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy;
      if (X > 0 && Y > 0 && X < WIDTH - 1 && Y < HEIGHT - 1 && mask[X + Y * WIDTH]) return true;
    }
  }
  return false;
}

/**
 * FUSE THE RIM: every cell within two of a lake's lava, at or below its surface, that is
 * not static rock (an open cell, or a powder: gold, coal and sand pockets sit in the rock
 * as loose grains and fall the moment the cell under them is gone) becomes stone. The
 * first probe lost a hall through a one-cell gold floor over a cave: the grains fell,
 * the lava followed down a shaft one cell wide.
 */
function fuseRim(world: World, list: readonly number[], surfaceY: number): number {
  const types = world.types;
  let fused = 0;
  for (const i of list) {
    const x = i % WIDTH, y = (i / WIDTH) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      const Y = y + dy;
      if (Y < surfaceY || Y >= HEIGHT - 1) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const X = x + dx;
        if (X < 1 || X >= WIDTH - 1) continue;
        const j = X + Y * WIDTH;
        if (STATIC[types[j]]) continue;
        types[j] = Cell.Stone;
        world.colors[j] = stoneColor();
        world.life[j] = 0;
        world.charge[j] = 0;
        world.activity.touchIndex(j);
        fused++;
      }
    }
  }
  return fused;
}

export function placeLavaLakes(
  world: World,
  rng: Rng,
  ledger: PlacementLedger,
  spawn: { x: number; y: number },
  targets: readonly LakeTarget[],
  budget: LavaLakeBudget,
): LavaLakeResult {
  const W = WIDTH, H = HEIGHT;
  const types = world.types;
  const floorBand = H - 52;
  const result: LavaLakeResult = { lakes: [], cells: 0, dropped: 0, pickups: [], debug: {} };
  const why = (k: string): null => { result.debug[k] = (result.debug[k] ?? 0) + 1; return null; };

  // ---- Forbidden ground: reserved rects, every protected place, and the walk to each of them ----
  // `hard`: places nothing may be carved or flooded over. `forbid` adds the walks
  // to every place, which only matter to lakes that sit in open air (a hall is
  // carved from rock and joins the network by its own tunnel).
  const hard = new Uint8Array(W * H);
  for (const r of ledger.rects()) {
    for (let y = Math.max(0, r.y0 - 8); y <= Math.min(H - 1, r.y1 + 8); y++) {
      hard.fill(1, Math.max(0, r.x0 - 8) + y * W, Math.min(W - 1, r.x1 + 8) + y * W + 1);
    }
  }
  markDisc(hard, Math.floor(spawn.x), Math.floor(spawn.y), 70);
  for (const t of targets) markDisc(hard, Math.floor(t.x), Math.floor(t.y), t.protect);
  const forbid = hard.slice();
  const fitsBefore = computeFits(world);
  const walks = fitWalks(fitsBefore, Math.floor(spawn.x), Math.floor(spawn.y));
  if (walks) {
    for (const t of targets) {
      let c = reachedNear(walks, t.x, t.y);
      let n = 0;
      while (c >= 0 && walks.prev[c] >= 0) {
        if (n++ % 3 === 0) markDisc(forbid, c % W, ((c / W) | 0) - 8, 13);
        c = walks.prev[c];
      }
    }
  }
  const claimed = new Uint8Array(W * H);
  const claimRect = (x0: number, y0: number, x1: number, y1: number, pad: number): void => {
    for (let y = Math.max(0, y0 - pad); y <= Math.min(H - 1, y1 + pad); y++) {
      claimed.fill(1, Math.max(0, x0 - pad) + y * W, Math.min(W - 1, x1 + pad) + y * W + 1);
    }
  };
  const lakeCells: number[][] = [];
  const hallRects: CarveAvoid[] = [];
  const reserved: CarveAvoid[] = ledger.rects().map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));

  // ---- MAGMA HALLS ----
  if (budget.halls > 0 && walks) {
    // A hall may take solid rock, and open air that no walk to a place crosses (a dead
    // tunnel it swallows); prefix sums of what it may NOT, so a site's box is cheap to judge.
    const hallGround = (i: number): boolean => {
      const t = types[i];
      if (hard[i] || t === Cell.Metal || t === Cell.Water || t === Cell.Brine || t === Cell.Acid) return false;
      return t !== Cell.Empty || forbid[i] === 0;
    };
    // ...and the ring round it may hold nothing the lava could set off
    const ringGround = (i: number): boolean => !DANGER[types[i]] || CLEARABLE[types[i]] === 1;
    const stride = W + 1;
    const bad = new Uint32Array(stride * (H + 1));
    for (let y = 0; y < H; y++) {
      let run = 0;
      for (let x = 0; x < W; x++) {
        const i = x + y * W;
        if (!hallGround(i)) run++;
        bad[x + 1 + (y + 1) * stride] = bad[x + 1 + y * stride] + run;
      }
    }
    const badIn = (x0: number, y0: number, x1: number, y1: number): number => {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
      return bad[x1 + 1 + (y1 + 1) * stride] - bad[x0 + (y1 + 1) * stride] - bad[x1 + 1 + y0 * stride] + bad[x0 + y0 * stride];
    };
    // the walkable network, thinned: where a hall's mouth tunnel may end
    const net: number[] = [];
    for (let y = 40; y < floorBand; y += 6) {
      for (let x = 20; x < W - 20; x += 6) if (walks.dist[x + y * W] >= 0) net.push(x + y * W);
    }
    let placed = 0;
    // A floor with little clean rock delivers a few small lakes: when the first pass leaves the budget under
    // half filled, a second pass tries the halls again at 62% of their size (same forked stream).
    for (const scale of [1, 0.62]) {
      if (scale < 1 && (result.cells >= budget.targetCells * 0.5 || placed >= budget.halls)) break;
      const sites: Array<{ cx: number; cy: number; rx: number; ry: number; score: number }> = [];
      const yLo = Math.floor(H * budget.yFracMin);
      for (let cy = yLo + 30; cy < floorBand - 50; cy += 14) {
        for (let cx = 60; cx < W - 60; cx += 14) {
          const rx = Math.floor((budget.hallRx[0] + rng.int(budget.hallRx[1] - budget.hallRx[0] + 1)) * scale);
          const ry = Math.floor((budget.hallRy[0] + rng.int(budget.hallRy[1] - budget.hallRy[0] + 1)) * scale);
          sites.push({ cx, cy, rx, ry, score: cy * 0.5 + rng.next() * 420 });
        }
      }
      sites.sort((a, b) => b.score - a.score);
      const seedN = rng.int(1 << 20);
      for (const s of sites) {
        if (placed >= budget.halls || result.cells >= budget.targetCells) break;
        const { cx, cy, rx, ry } = s;
        const ex = Math.ceil(rx * 1.18) + 5, ey = Math.ceil(ry * 1.18) + 5;
        if (cx - ex < 10 || cx + ex > W - 10 || cy - ey < 40 || cy + ey > floorBand - 6) continue;
        if (hallRects.some((r) => cx + ex + 10 >= r.x0 && cx - ex - 10 <= r.x1 && cy + ey + 10 >= r.y0 && cy - ey - 10 <= r.y1)) continue;
        // the box is mostly clean rock (cheap), then the ellipse itself is clean (exact)
        const badBox = badIn(cx - ex, cy - ey, cx + ex, cy + ey);
        { const f = badBox / (4 * ex * ey); const k = f < 0.05 ? 'box<5' : f < 0.125 ? 'box<12' : f < 0.25 ? 'box<25' : f < 0.4 ? 'box<40' : 'box>=40'; result.debug[k] = (result.debug[k] ?? 0) + 1; }
        if (badBox > ex * ey * 0.5) { why('hallBox'); continue; }
        let clean = true;
        for (let y = cy - ey; y <= cy + ey && clean; y++) {
          for (let x = cx - ex; x <= cx + ex; x++) {
            const dx = (x - cx) / ex, dy = (y - cy) / ey;
            if (dx * dx + dy * dy > 1) continue;
            const i = x + y * W;
            if (!hallGround(i) || claimed[i]) { clean = false; break; }
            const inner = ((x - cx) / (rx * 1.18)) ** 2 + ((y - cy) / (ry * 1.18)) ** 2;
            if (inner > 1 && !ringGround(i)) { clean = false; break; }
          }
        }
        if (!clean) { why('hallDirty'); continue; }
        // the surface: a little below the hall's middle, so the lake is the lower lens
        const surface = Math.floor(cy + ry * 0.2);
        const halfAt = (y: number): number => rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
        // the mouth: the walkable cell nearest the hall, on the side it lies
        let best = -1, bestD = 1e9;
        for (const i of net) {
          const nx = i % W, ny = (i / W) | 0;
          const ddx = Math.max(0, Math.abs(nx - cx) - rx * 1.1), ddy = Math.max(0, Math.abs(ny - cy) - ry * 1.1);
          const d = Math.hypot(ddx, ddy);
          if (d < 14 || ny > surface + 30 || d >= bestD) continue;
          bestD = d;
          best = i;
        }
        if (best < 0 || bestD > 150) { why('hallFar'); continue; }
        const fx = best % W, fy = (best / W) | 0;
        const side = fx >= cx ? 1 : -1;

        // carve the hall (a wobbled ellipse) and fill its lower lens with lava
        const cells: number[] = [];
        for (let y = cy - Math.ceil(ry * 1.2); y <= cy + Math.ceil(ry * 1.2); y++) {
          for (let x = cx - Math.ceil(rx * 1.2); x <= cx + Math.ceil(rx * 1.2); x++) {
            const dx = (x - cx) / rx, dy = (y - cy) / ry;
            const lim = 1 + (valueNoise(x, y, 0.07, seedN) - 0.5) * 0.3;
            if (dx * dx + dy * dy > lim * lim) continue;
            const i = x + y * W;
            if (y >= surface) {
              types[i] = Cell.Lava;
              world.colors[i] = lavaColor();
              cells.push(i);
            } else {
              types[i] = Cell.Empty;
              world.colors[i] = 0x08080c;
            }
            world.life[i] = 0;
            world.charge[i] = 0;
            world.activity.touchIndex(i);
          }
        }
        // the shelf the mouth opens onto: stone at the lava line, reaching into the hall
        const mouthY = surface - 14;
        const edgeX = Math.floor(cx + side * (halfAt(mouthY) - 3));
        const shelfX0 = side > 0 ? edgeX - 20 : edgeX;
        const shelfX1 = side > 0 ? edgeX : edgeX + 20;
        for (let x = shelfX0; x <= shelfX1; x++) {
          for (let y = surface - 1; y <= surface + 2; y++) {
            const i = x + y * W;
            if (types[i] === Cell.Empty || types[i] === Cell.Lava) {
              types[i] = Cell.Stone;
              world.colors[i] = stoneColor();
              world.activity.touchIndex(i);
            }
          }
        }
        // the tunnel from the shelf to the network, leaving above the lava
        // (it walks round EVERY reserved room, the Kiln's flue and arena included: their ledger
        // labels are not 'sealed' ones, and the first tunnel cut the flue's ledges)
        const avoid: CarveAvoid[] = [...reserved, ...hallRects];
        tunnelTo(world, rng, edgeX - side * 2, mouthY, fx, fy, 12, undefined, 26, avoid);
        // nothing open may touch the lava beside or below its surface: plug any leak with stone
        const plugs = fuseRim(world, cells, surface);
        if (plugs > 0) result.debug.fused = (result.debug.fused ?? 0) + plugs;
        const x0 = cx - Math.ceil(rx * 1.2), x1 = cx + Math.ceil(rx * 1.2);
        const y0 = cy - Math.ceil(ry * 1.2), y1 = cy + Math.ceil(ry * 1.2);
        hallRects.push({ x0, y0, x1, y1 });
        claimRect(x0, y0, x1, y1, 10);
        lakeCells.push(cells);
        result.lakes.push({ kind: 'hall', cells: cells.length, x0, y0, x1, y1, surfaceY: surface });
        result.cells += cells.length;
        // the lure on the shelf's end, over the lava
        const lureX = side > 0 ? shelfX0 + 2 : shelfX1 - 2;
        result.pickups.push(makePickup('goldpile', lureX, surface - 3, { amount: 14 }));
        placed++;
      }
    }
  }

  // ---- BASIN LAKES ----
  // Flammable, freezing or explosive neighbours: a lake keeps two cells off them.
  const dangerNear = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!DANGER[types[i]]) continue;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      const Y = y + dy;
      if (Y < 0 || Y >= H) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const X = x + dx;
        if (X >= 0 && X < W) dangerNear[X + Y * W] = 1;
      }
    }
  }
  // Candidate seeds: natural cave floors below the budget's line, in a seeded shuffle.
  const yMin = Math.floor(H * budget.yFracMin);
  const seeds: number[] = [];
  for (let x = 12; x < W - 12; x += 4) {
    for (let y = yMin; y < floorBand - 8; y++) {
      const t = types[x + y * W];
      if ((t === Cell.Empty || CLEARABLE[t]) && types[x + (y + 1) * W] === Cell.Wall) seeds.push(x + y * W);
    }
  }
  for (let i = seeds.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = seeds[i];
    seeds[i] = seeds[j];
    seeds[j] = t;
  }

  const stamp = new Int32Array(W * H);
  let epoch = 0;
  const cells: number[] = [];
  const passable = (t: number): boolean => t === Cell.Empty || CLEARABLE[t] === 1;

  const tryLake = (seed: number): LavaLake | null => {
    const sx = seed % W, sy = (seed / W) | 0;
    if (sx < 2 || sx >= W - 2 || forbid[seed] || claimed[seed] || dangerNear[seed]) return why(forbid[seed] ? 'seedForbid' : claimed[seed] ? 'seedClaimed' : 'seedDanger');
    epoch++;
    cells.length = 0;
    stamp[seed] = epoch;
    cells.push(seed);
    let bottomY = sy;
    /** Flood the queue from `start` over open cells at rows >= level; false when a limit is hit. */
    const run = (level: number, start: number): boolean => {
      let head = start;
      while (head < cells.length) {
        const i = cells[head++];
        if (forbid[i] || claimed[i] || dangerNear[i] || cells.length > budget.maxCells) return false;
        const x = i % W, y = (i / W) | 0;
        if (y > bottomY) bottomY = y;
        for (const [dx, dy] of N4) {
          const X = x + dx, Y = y + dy;
          if (X < 2 || X >= W - 2 || Y < level || Y >= floorBand) continue;
          const j = X + Y * W;
          if (stamp[j] === epoch || !passable(types[j])) continue;
          stamp[j] = epoch;
          cells.push(j);
        }
      }
      return true;
    };
    if (!run(sy, 0)) return why('initFlood');
    let okLen = cells.length;
    let okTop = sy;
    let okBottom = bottomY;
    let topRow = cells.filter((i) => ((i / W) | 0) === sy);
    const limit = Math.max(yMin - 40, sy - budget.maxRise);
    for (let level = sy - 1; level >= limit; level--) {
      const start = cells.length;
      // The next line up: each open cell directly over the row below (sideways joins follow in the flood).
      for (const i of topRow) {
        const j = i - W;
        if (stamp[j] !== epoch && passable(types[j])) {
          stamp[j] = epoch;
          cells.push(j);
        }
      }
      if (cells.length === start) break;
      if (!run(level, start)) break;
      okLen = cells.length;
      okTop = level;
      okBottom = bottomY;
      topRow = cells.slice(start).filter((i) => ((i / W) | 0) === level);
    }
    cells.length = okLen;
    if (cells.length < budget.minCells) return why('small');
    if (okBottom - okTop < budget.minDepth) return why('shallow');
    let x0 = W, x1 = 0;
    for (const i of cells) {
      const x = i % W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    lakeCells.push(cells.slice());
    return { kind: 'basin', cells: cells.length, x0, y0: okTop, x1, y1: okBottom, surfaceY: okTop };
  };

  const basinLakes: number[][] = [];
  let attempts = 0;
  for (const seed of seeds) {
    if (result.cells >= budget.targetCells || result.lakes.length >= budget.maxLakes || attempts > 900) break;
    if (claimed[seed]) continue;
    attempts++;
    const lake = tryLake(seed);
    if (!lake) continue;
    const list = lakeCells[lakeCells.length - 1];
    basinLakes.push(list);
    // Keep lakes apart: a margin of five cells around each is claimed.
    for (const i of list) {
      const x = i % W, y = (i / W) | 0;
      for (let dy = -5; dy <= 5; dy++) {
        const Y = y + dy;
        if (Y < 0 || Y >= H) continue;
        for (let dx = -5; dx <= 5; dx++) {
          const X = x + dx;
          if (X >= 0 && X < W) claimed[X + Y * W] = 1;
        }
      }
    }
    result.lakes.push(lake);
    result.cells += lake.cells;
  }

  // ---- Commit the basins: lava over the pit, soft growth cleared off the shore, the rim fused ----
  for (const list of basinLakes) {
    for (const i of list) {
      types[i] = Cell.Lava;
      world.colors[i] = lavaColor();
      world.life[i] = 0;
      world.charge[i] = 0;
      world.activity.touchIndex(i);
    }
    for (const i of list) {
      const x = i % W, y = (i / W) | 0;
      for (let dy = -3; dy <= 3; dy++) {
        const Y = y + dy;
        if (Y < 1 || Y >= H - 1) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const X = x + dx;
          if (X < 1 || X >= W - 1) continue;
          const j = X + Y * W;
          const t = types[j];
          if (CLEARABLE[t]) {
            types[j] = Cell.Empty;
            world.colors[j] = 0x08080c;
            world.activity.touchIndex(j);
          }
        }
      }
    }
  }

  for (const [n, list] of basinLakes.entries()) {
    const meta = result.lakes.filter((l) => l.kind === 'basin')[n];
    const fused = fuseRim(world, list, meta.surfaceY);
    if (fused > 0) result.debug.fused = (result.debug.fused ?? 0) + fused;
  }

  // ---- Nothing loose above a lake: a seed pocket of oil or gunpowder hangs unsupported in the open
  //      cave and falls in on the sim's first tick (the first probe: a pocket fell into a hall, the
  //      blast took the rim and the lake ran down the tunnel). Every loose mass that touches open
  //      air within reach of a lake (40 cells aside, 100 above) is cleared, unless it is placed
  //      ground of something else (a reserved room's own stock) ----
  if (result.lakes.length > 0) {
    const windows = result.lakes.map((lake) => ({
      x0: lake.x0 - 40, x1: lake.x1 + 40, y0: lake.y0 - 100, y1: Math.min(floorBand, lake.y1 + 10),
    }));
    const purged = clearLooseStock(world, windows, (x, y) => hard[x + y * W] === 1, Infinity);
    if (purged > 0) result.debug.purged = purged;
  }

  // ---- Last check, lakes as rock: nothing the player could reach may become unreachable ----
  if (result.lakes.length > 0) {
    const pre = wizardMask({ world, spawn });
    const dry = new Uint8Array(types);
    for (const list of lakeCells) for (const i of list) dry[i] = Cell.Wall;
    const post = wizardMask({ world: { width: W, height: H, types: dry }, spawn });
    const extra = result.pickups.map((p) => ({ x: p.x, y: p.y, protect: 0 }));
    const cut = [...targets, ...extra].filter((t) => nearMask(pre, t.x, t.y - 2, 8) && !nearMask(post, t.x, t.y - 2, 8));
    if (cut.length > 0) {
      // fail-open: take back every lake within reach of a cut place
      const keepMeta: LavaLake[] = [];
      result.lakes.forEach((meta, n) => {
        const near = cut.some((t) => t.x >= meta.x0 - 60 && t.x <= meta.x1 + 60 && t.y >= meta.y0 - 60 && t.y <= meta.y1 + 60);
        if (near) {
          for (const i of lakeCells[n]) {
            types[i] = Cell.Empty;
            world.colors[i] = 0x08080c;
            world.activity.touchIndex(i);
          }
          result.dropped++;
        } else keepMeta.push(meta);
      });
      result.lakes = keepMeta;
      result.cells = keepMeta.reduce((s, l) => s + l.cells, 0);
    }
  }
  return result;
}
