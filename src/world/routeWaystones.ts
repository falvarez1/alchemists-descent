import { HEIGHT, WIDTH } from '@/config/constants';
import type { Waystone } from '@/core/types';
import { blocksEntity, Cell, isLiquid, isSoftGrowth, isSolid } from '@/sim/CellType';
import { EMPTY_COLOR, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { PlacementLedger } from '@/world/connect';
import { fitWalks, type FitWalks, walkTo } from '@/world/fitWalks';
import { type Fill, type Group, holdRoutes, reserveFooting, waystoneFooting } from '@/world/fixtureFooting';
import { computeFits, wizardMask } from '@/world/validate';

/**
 * WAYSTONES ON THE ROUTE (GEN 62). The checkpoints stood at 33% and 66% of the world's WIDTH, which
 * the route ignores: on the reviewed d3 seeds both sat in the first tenth of the walk (100-350 cells
 * off it) and none covered the key's leg or the way to the exit. The route does not exist when the
 * bowls are first stamped (the skeleton's tunnels are narrower than a body and the connectors that
 * join the spawn to the exit are carved later: d2 seed 7's body-fit walk from the spawn is 51 steps
 * long then), so this runs after the LAST carve: each of the two generated bowls is moved to a
 * standing site near a fraction (35%, 70%) of the body-fit walk from the spawn to the cave nearest
 * the exit, and one more bowl is lit beside the key's vault, so a death at either end is a short
 * walk back. A bowl already on the route at its stop stays; one with no site near its stop stays
 * where it was (fail-open: a checkpoint is never lost).
 */

/** The body-fit walk from the spawn to the reached cell nearest the exit, as cell indices (null when it is too short to divide). */
export function routePath(walks: FitWalks, exit: { x: number; y: number }): number[] | null {
  const W = WIDTH;
  let best = -1, bestD = Infinity;
  for (let y = 40; y < HEIGHT - 20; y += 4) {
    for (let x = 20; x < W - 20; x += 4) {
      const i = x + y * W;
      if (walks.dist[i] < 0) continue;
      const d = (x - exit.x) * (x - exit.x) + (y - exit.y) * (y - exit.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  if (best < 0) return null;
  const path = walkTo(walks, best);
  return path.length < 160 ? null : path;
}

/** Points at these fractions (0..1) of the walk. */
export function routeAnchors(
  walks: FitWalks,
  exit: { x: number; y: number },
  fractions: readonly number[],
): Array<{ x: number; y: number }> | null {
  const path = routePath(walks, exit);
  if (!path) return null;
  return fractions.map((f) => {
    const c = path[Math.floor((path.length - 1) * f)];
    return { x: c % WIDTH, y: (c / WIDTH) | 0 };
  });
}

/** A bowl's base row, pillars and pouring room, exactly as the first stamp lays them (CaveGenerator step 4). */
export function stampWaystoneBowl(world: World, cx: number, baseY: number, log?: Fill[]): Waystone {
  const set = (x: number, y: number, t: Cell, c: number): void => {
    if (x < 2 || x >= WIDTH - 2 || y < 2 || y >= HEIGHT - 8) return;
    const i = world.idx(x, y);
    log?.push([i, world.types[i], world.colors[i]]);
    world.types[i] = t;
    world.colors[i] = c;
    world.life[i] = 0;
    world.charge[i] = 0;
    world.activity.touchIndex(i);
  };
  for (let dx = -3; dx <= 3; dx++) set(cx + dx, baseY, Cell.Stone, stoneColor());
  for (let t = 1; t <= 2; t++) {
    set(cx - 3, baseY - t, Cell.Stone, stoneColor());
    set(cx + 3, baseY - t, Cell.Stone, stoneColor());
  }
  for (let dy = 1; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, baseY - dy, Cell.Empty, EMPTY_COLOR);
  for (let dy = 3; dy <= 5; dy++) for (let dx = -3; dx <= 3; dx++) set(cx + dx, baseY - dy, Cell.Empty, EMPTY_COLOR);
  return { x: cx, y: baseY - 1, lit: false };
}

/** Take a bowl's stone back out (its base row and pillars): the room it opened stays. */
function unstampWaystoneBowl(world: World, ws: Waystone, log: Fill[]): void {
  const baseY = Math.floor(ws.y) + 1, cx = Math.floor(ws.x);
  const clear = (x: number, y: number): void => {
    if (x < 2 || x >= WIDTH - 2 || y < 2 || y >= HEIGHT - 8) return;
    const i = world.idx(x, y);
    if (world.types[i] !== Cell.Stone) return;
    log.push([i, world.types[i], world.colors[i]]);
    world.types[i] = Cell.Empty;
    world.colors[i] = EMPTY_COLOR;
    world.activity.touchIndex(i);
  };
  for (let dx = -3; dx <= 3; dx++) clear(cx + dx, baseY);
  for (let t = 1; t <= 2; t++) {
    clear(cx - 3, baseY - t);
    clear(cx + 3, baseY - t);
  }
}

/** Rigid ground a body stands on: a solid material that is not soft growth (moss, grass, vines, a trunk: bodies pass through those). */
const isFloor = (t: number): boolean => isSolid(t) && !isSoftGrowth(t);

/**
 * Ground under the 7-wide base: the three middle columns stand on rigid ground (rock, stone, metal,
 * ice, wood, crystal...) within three rows, with only soft growth (a moss crown the footing pass replaces
 * with stone) between; the outer four may drop up to eight rows before theirs (the footing pass pours a
 * plinth under an undercut column). Not a ledge's end, a dune the stock pass would clear, or a bare drop.
 */
function floored(world: World, x: number, y: number): boolean {
  for (let dx = -3; dx <= 3; dx++) {
    const centre = Math.abs(dx) <= 1;
    let ok = false;
    for (let k = 1; k <= (centre ? 3 : 9); k++) {
      const t = world.types[x + dx + (y + k) * WIDTH];
      if (isFloor(t)) { ok = true; break; }
      if (!isSoftGrowth(t) && (centre || t !== Cell.Empty)) break;
    }
    if (!ok) return false;
  }
  return true;
}

/**
 * The nearest standing site to (tx, ty) for a bowl: open air (or soft growth, which the stamp clears) with a
 * a solid floor under its whole base and a 7 x 6 room over it that holds no rock and no liquid (the stamp opens that room, so it must not cut
 * one), off every reserved room, and on the walk (a body-fit cell within 10 cells).
 */
export function bowlSiteNear(
  world: World,
  ledger: PlacementLedger,
  walks: FitWalks,
  tx: number,
  ty: number,
  apart: ReadonlyArray<{ x: number; y: number }> = [],
  radiusX = 70,
  radiusY = 45,
): { cx: number; baseY: number } | null {
  const W = WIDTH;
  let best: { cx: number; baseY: number; d: number } | null = null;
  for (let y = Math.max(40, ty - radiusY); y <= Math.min(HEIGHT - 30, ty + radiusY); y++) {
    for (let x = Math.max(14, tx - radiusX); x <= Math.min(W - 15, tx + radiusX); x++) {
      const d = Math.abs(x - tx) + Math.abs(y - ty) * 1.4;
      if (best && d >= best.d) continue;
      const i = x + y * W;
      if (world.types[i] !== Cell.Empty && !isSoftGrowth(world.types[i])) continue;
      if (!floored(world, x, y)) continue;
      let room = true;
      for (let yy = y - 5; yy <= y && room; yy++) {
        for (let xx = x - 3; xx <= x + 3; xx++) {
          const t = world.types[xx + yy * W];
          if (blocksEntity(t) || isLiquid(t)) { room = false; break; }
        }
      }
      if (!room) continue;
      // headroom for the body over the raised base and pillars: 20 open rows, so the bowl never narrows the way
      let tall = true;
      for (let yy = y - 19; yy < y - 5 && tall; yy++) {
        for (let xx = x - 4; xx <= x + 4; xx++) if (blocksEntity(world.types[xx + yy * W])) { tall = false; break; }
      }
      if (!tall) continue;
      if (apart.some((a) => Math.abs(a.x - x) < 60 && Math.abs(a.y - y) < 60)) continue;
      if (ledger.intersects(x - 8, y - 8, x + 8, y + 2)) continue;
      let walkable = false;
      for (let dy = -10; dy <= 2 && !walkable; dy += 2) {
        for (let dx = -10; dx <= 10; dx += 2) if (walks.dist[x + dx + (y + dy) * W] >= 0) { walkable = true; break; }
      }
      if (!walkable) continue;
      best = { cx: x, baseY: y, d };
    }
  }
  return best ? { cx: best.cx, baseY: best.baseY } : null;
}

/**
 * A brazier site beside the key: 10-34 cells either side of it, a floor and a room as bowlSiteNear asks,
 * inside the spawn-reachable wizard mask. Nearest to the key wins.
 */
export function keyBrazierSite(
  world: World,
  reach: Uint8Array,
  key: { x: number; y: number },
  ledger?: PlacementLedger,
): { cx: number; baseY: number } | null {
  const W = WIDTH;
  const kx = Math.floor(key.x), ky = Math.floor(key.y);
  let best: { cx: number; baseY: number; d: number } | null = null;
  for (let dx = -34; dx <= 34; dx++) {
    if (Math.abs(dx) < 10) continue;
    const cx = kx + dx;
    if (cx < 12 || cx >= W - 12) continue;
    for (let y = ky - 4; y <= ky + 10; y++) {
      if (world.types[cx + y * W] !== Cell.Empty && !isSoftGrowth(world.types[cx + y * W])) continue;
      if (!floored(world, cx, y)) continue;
      let room = true;
      for (let yy = y - 5; yy <= y && room; yy++) {
        for (let xx = cx - 3; xx <= cx + 3; xx++) {
          const t = world.types[xx + yy * W];
          if (blocksEntity(t) || isLiquid(t)) { room = false; break; }
        }
      }
      if (!room || !reach[cx + (y - 2) * W]) continue;
      if (ledger?.intersects(cx - 8, y - 8, cx + 8, y + 2)) continue;
      const d = Math.abs(dx) + Math.abs(y - ky);
      if (!best || d < best.d) best = { cx, baseY: y, d };
      break;
    }
  }
  return best ? { cx: best.cx, baseY: best.baseY } : null;
}

export interface RouteWaystoneReport {
  /** Generated bowls moved to their stop. */
  moved: number;
  /** Bowls already near their stop. */
  kept: number;
  /** The key's brazier was placed. */
  brazier: boolean;
}

/**
 * Run the pass on the finished grid: the first two `bowls` (the generated ones; a prefab's waystone keeps
 * its authored cells and is not among them) go to 35% and 70% of the walk, and a bowl is lit beside the
 * key. `waystones` and `bowls` are mutated in place (a moved bowl keeps its object); the new brazier is
 * pushed on both. Reserves every site it takes in the ledger.
 */
export function placeRouteWaystones(input: {
  world: World;
  ledger: PlacementLedger;
  spawn: { x: number; y: number };
  exit: { x: number; y: number };
  bowls: Waystone[];
  waystones: Waystone[];
  key: { x: number; y: number } | null;
}): RouteWaystoneReport {
  const { world, ledger, spawn, exit, bowls, waystones, key } = input;
  const report: RouteWaystoneReport = { moved: 0, kept: 0, brazier: false };
  const walks = fitWalks(computeFits(world), Math.floor(spawn.x), Math.floor(spawn.y));
  if (!walks) return report;
  // Every change is a group that can be taken back whole if it costs the alchemist standing room (holdRoutes).
  const groups: Group[] = [];
  const path = routePath(walks, exit);
  if (path) {
    for (const [n, f] of [0.35, 0.7].entries()) {
      if (n >= bowls.length) break;
      const ws = bowls[n];
      const at = Math.floor((path.length - 1) * f);
      // already at its stop: within 45 cells of it
      if (Math.hypot(ws.x - (path[at] % WIDTH), ws.y - ((path[at] / WIDTH) | 0)) < 45) {
        report.kept++;
        continue;
      }
      // The nearest standing site ALONG the route to the stop (up to 400 steps either way), so a bowl is
      // never more than a few cells off the walk (a stop in a shaft has no floor: the next tunnel will).
      const apart = waystones.filter((o) => o !== ws);
      let site: { cx: number; baseY: number } | null = null;
      for (let k = 0; k <= 400 && !site; k += 4) {
        for (const at2 of k === 0 ? [at] : [at + k, at - k]) {
          if (at2 < 0 || at2 >= path.length) continue;
          site = bowlSiteNear(world, ledger, walks, path[at2] % WIDTH, (path[at2] / WIDTH) | 0, apart, 18, 34);
          if (site) break;
        }
      }
      if (!site) continue;
      const fills: Fill[] = [];
      const was = { x: ws.x, y: ws.y };
      unstampWaystoneBowl(world, ws, fills);
      const made = stampWaystoneBowl(world, site.cx, site.baseY, fills);
      ws.x = made.x;
      ws.y = made.y;
      groups.push({ what: 'bowl', fills, undo: (): void => { ws.x = was.x; ws.y = was.y; } });
      report.moved++;
    }
  }
  if (key) {
    const site = keyBrazierSite(world, wizardMask({ world, spawn }), key, ledger);
    if (site && !waystones.some((o) => Math.hypot(o.x - site.cx, o.y - (site.baseY - 1)) < 50)) {
      const fills: Fill[] = [];
      const made = stampWaystoneBowl(world, site.cx, site.baseY, fills);
      waystones.push(made);
      bowls.push(made);
      groups.push({ what: 'key brazier', fills, undo: (): void => { waystones.splice(waystones.indexOf(made), 1); bowls.splice(bowls.indexOf(made), 1); } });
      report.brazier = true;
    }
  }
  // ...and any group whose stone cut a way is taken back (the bowl stays where it was: fail-open)
  for (const g of holdRoutes(world, groups, spawn)) {
    g.undo?.();
    if (g.what === 'bowl') report.moved--;
    else report.brazier = false;
  }
  for (const ws of waystones) {
    ledger.reserve(ws.x - 12, ws.y - 12, ws.x + 12, ws.y + 12, 'waystone');
    reserveFooting(ledger, waystoneFooting(ws), 'waystone');
  }
  return report;
}
