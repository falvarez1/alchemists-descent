import type { BiomeId, Critter, CritterKind, LevelDef } from '@/core/types';
import type { Rng } from '@/core/rng';
import type { World } from '@/sim/World';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import { GLOW, PUFF, SNAP, CRAWL, LEECH } from './types';

/**
 * Worldgen for ambient life (WS-N). Each campaign floor below the Bellows gets
 * a finite resident population — the same individuals all run, saved with the
 * level's `fauna` — placed from its own forked RNG stream so no other pass
 * moves. Organisms sit near the paths the alchemist actually walks (the
 * reachability mask), never within sight of the spawn, and never on each
 * other. Placement writes NO cells: findability is untouched.
 */

type Recipe = Partial<Record<CritterKind, number>>;

/** Per-biome census (upper bounds; placement may find fewer). */
export const FLOOR_FAUNA: Partial<Record<BiomeId, Recipe>> = {
  // THE ROT GARDENS: gut flora. Ambush plants, gas bladders, wall-walkers,
  // lantern moths for the bats, fireflies, a few beetles and pool fish.
  fungal: { snapjaw: 12, puffer: 18, isopod: 18, glowworm: 6, moth: 10, firefly: 10, beetle: 6, fish: 8 },
  // THE DROWNED CISTERNS: schools in every pool, glow-worms fishing from the
  // vaults, leeches in the shallows.
  flooded: { fish: 26, glowworm: 16, leech: 14, moth: 6, firefly: 8, isopod: 6 },
  // THE KILN HEART: coal-grazing ember beetles on the walls, ash moths over the lava.
  volcanic: { emberbeetle: 16, ashmoth: 16, moth: 2 },
  // THE COLD STORE (wave 3): frost mites on the ice, snow moths round the
  // rime crystals, brine skaters on the gutters and sumps.
  frozen: { frostmite: 18, snowmoth: 16, brineskater: 14 },
  // THE GLASS GALLERIES (wave 3): glass beetles on the faceted walls, prism
  // moths after the light, lens mites grinding what glass they find.
  crystal: { glassbeetle: 16, prismmoth: 18, lensmite: 12, moth: 2 },
};

/** Organisms keep this far from the spawn (cells) — never on the player. */
export const SPAWN_CLEAR = 90;

interface Placer {
  world: World;
  rng: Rng;
  reach: Uint8Array | null;
  spawn: { x: number; y: number };
  taken: Array<{ x: number; y: number; r: number }>;
}

function empty(w: World, x: number, y: number): boolean {
  return w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Empty;
}
function wall(w: World, x: number, y: number): boolean {
  return !w.inBounds(x, y) || blocksEntity(w.types[w.idx(x, y)]);
}
function water(w: World, x: number, y: number): boolean {
  return w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Water;
}

/** Near a place the alchemist can stand (sampled on a 3-cell lattice). */
function nearPath(p: Placer, x: number, y: number, r: number): boolean {
  if (!p.reach) return true;
  const W = p.world.width, H = p.world.height;
  for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) {
    const X = x + dx, Y = y + dy;
    if (X > 0 && Y > 0 && X < W && Y < H && p.reach[X + Y * W]) return true;
  }
  return false;
}

function free(p: Placer, x: number, y: number, r: number): boolean {
  if (Math.hypot(x - p.spawn.x, y - p.spawn.y) < SPAWN_CLEAR) return false;
  for (const t of p.taken) if (Math.hypot(t.x - x, t.y - y) < Math.max(r, t.r)) return false;
  return true;
}

function openRun(w: World, x: number, y: number, dx: number, dy: number, n: number): number {
  let k = 0;
  while (k < n && empty(w, x + dx * (k + 1), y + dy * (k + 1))) k++;
  return k;
}

function critter(kind: CritterKind, id: string, x: number, y: number, rng: Rng, extra: Partial<Critter> = {}): Critter {
  return {
    kind, id, x, y, vx: 0, vy: 0, phase: rng.next() * Math.PI * 2, gasp: 0,
    facing: rng.next() < 0.5 ? -1 : 1, homeX: x, homeY: y, energy: 1, ...extra,
  };
}

/** Find a spot: `test` returns the organism (or null) for a candidate cell. */
function scatterKind(
  p: Placer, count: number, spacing: number, attempts: number,
  test: (x: number, y: number) => Critter | null, out: Critter[],
): void {
  const w = p.world;
  let placed = 0;
  for (let a = 0; a < attempts && placed < count; a++) {
    const x = 12 + p.rng.int(w.width - 24), y = 16 + p.rng.int(w.height - 40);
    if (!free(p, x, y, spacing)) continue;
    const c = test(x, y);
    if (!c) continue;
    out.push(c);
    p.taken.push({ x, y, r: spacing });
    placed++;
  }
}

export function placeOrganisms(
  world: World, def: LevelDef, spawn: { x: number; y: number }, reach: Uint8Array | null, rng: Rng,
): Critter[] | null {
  const recipe = FLOOR_FAUNA[def.biome];
  if (!recipe) return null;
  const p: Placer = { world, rng, reach, spawn, taken: [] };
  const out: Critter[] = [];
  const w = world;
  let n = 0;
  const id = (kind: CritterKind): string => `${def.id}-${kind}-${n++}`;
  const A = 5000;

  // SNAPJAWS: rooted on floors (and some jutting from walls), room to lunge.
  scatterKind(p, recipe.snapjaw ?? 0, 16, A, (x, y) => {
    if (!empty(w, x, y)) return null;
    const floor = wall(w, x, y + 1) && openRun(w, x, y, 0, -1, 12) >= 11 && empty(w, x - 3, y) && empty(w, x + 3, y);
    const side = floor ? 0 : wall(w, x - 1, y) ? 1 : wall(w, x + 1, y) ? -1 : 0;
    if (!floor && (side === 0 || openRun(w, x, y, side, 0, 12) < 11 || !empty(w, x, y - 4) || !empty(w, x, y + 4))) return null;
    if (!nearPath(p, x, y - 4, 9)) return null;
    const nx = side, ny = floor ? -1 : 0;
    return critter('snapjaw', id('snapjaw'), x, y, rng, {
      anchorX: x, anchorY: y, nx, ny, state: SNAP.OPEN, stateT: 0, extent: 1, reach: 5.5 + rng.next() * 2, hp: 32,
    });
  }, out);

  // PUFFERS: on floors, walls and hanging from ceilings; clusters read as colonies.
  scatterKind(p, recipe.puffer ?? 0, 9, A, (x, y) => {
    if (!empty(w, x, y)) return null;
    let nx = 0, ny = 0;
    if (wall(w, x, y + 1)) ny = -1; else if (wall(w, x, y - 1)) ny = 1; else if (wall(w, x - 1, y)) nx = 1; else if (wall(w, x + 1, y)) nx = -1;
    else return null;
    for (let k = 1; k <= 5; k++) if (!empty(w, x + nx * k, y + ny * k)) return null;
    if (!nearPath(p, x, y, 12)) return null;
    return critter('puffer', id('puffer'), x, y, rng, {
      anchorX: x, anchorY: y, nx, ny, state: PUFF.GROW, stateT: 0, extent: 0.35 + rng.next() * 0.65,
    });
  }, out);

  // GLOW-WORMS: ceilings over a real drop, thread length fitted to the room.
  scatterKind(p, recipe.glowworm ?? 0, 10, A, (x, y) => {
    if (!empty(w, x, y) || !wall(w, x, y - 1)) return null;
    const drop = openRun(w, x, y, 0, 1, 40);
    if (drop < 12) return null;
    if (!nearPath(p, x, y + Math.min(drop, 24), 14)) return null;
    const reach = Math.min(drop - 5, 10 + rng.int(16));
    return critter('glowworm', id('glowworm'), x, y, rng, {
      anchorX: x, anchorY: y, state: GLOW.FISH, stateT: 0, extent: reach * rng.next(), reach,
    });
  }, out);

  // WALL CRAWLERS: any open cell touching rock; ember beetles like coal and heat,
  // frost mites ice and snow, glass beetles and lens mites glass and crystal.
  for (const kind of ['isopod', 'emberbeetle', 'frostmite', 'glassbeetle', 'lensmite'] as const) {
    scatterKind(p, recipe[kind] ?? 0, 7, A, (x, y) => {
      if (!empty(w, x, y)) return null;
      let nx = 0, ny = 0;
      if (wall(w, x, y + 1)) ny = -1; else if (wall(w, x - 1, y)) nx = 1; else if (wall(w, x + 1, y)) nx = -1; else if (wall(w, x, y - 1)) ny = 1;
      else return null;
      if (!nearPath(p, x, y, 16)) return null;
      if (kind === 'emberbeetle') {
        let warm = false;
        for (let k = 0; k < 16 && !warm; k++) {
          const t = w.inBounds(x + ((k * 7) % 13) - 6, y + ((k * 5) % 11) - 5) ? w.types[w.idx(x + ((k * 7) % 13) - 6, y + ((k * 5) % 11) - 5)] : 0;
          warm = t === Cell.Coal || t === Cell.Lava || t === Cell.Ember || t === Cell.Ash;
        }
        if (!warm && rng.next() < 0.7) return null;
      }
      if (kind === 'frostmite' || kind === 'glassbeetle' || kind === 'lensmite') {
        const want: readonly number[] = kind === 'frostmite' ? [Cell.Ice, Cell.Snow] : [Cell.Glass, Cell.Crystal, Cell.Mirror];
        let near = false;
        for (let k = 0; k < 16 && !near; k++) {
          const X = x + ((k * 7) % 13) - 6, Y = y + ((k * 5) % 11) - 5;
          near = w.inBounds(X, Y) && want.includes(w.types[w.idx(X, Y)]);
        }
        if (!near && rng.next() < 0.6) return null;
      }
      return critter(kind, id(kind), x + 0.5, y + 0.5, rng, { anchorX: x, anchorY: y, nx, ny, state: CRAWL.WALK, stateT: 0 });
    }, out);
  }

  // LEECHES: pool floors.
  scatterKind(p, recipe.leech ?? 0, 10, A, (x, y) => {
    if (!water(w, x, y) || !water(w, x, y - 2) || !nearPath(p, x, y, 20)) return null;
    return critter('leech', id('leech'), x, y, rng, { state: LEECH.SWIM, stateT: 0 });
  }, out);

  // FISH: schools of four to six in water deep enough to school in.
  const schools = Math.ceil((recipe.fish ?? 0) / 5);
  let fishLeft = recipe.fish ?? 0;
  scatterKind(p, schools, 30, A, (x, y) => {
    if (!water(w, x, y) || !water(w, x, y + 2) || !water(w, x + 4, y) || !water(w, x - 4, y)) return null;
    const size = Math.min(fishLeft, 4 + rng.int(3));
    if (size <= 0) return null;
    let first: Critter | null = null;
    for (let k = 0; k < size; k++) {
      const fx = x + rng.int(9) - 4, fy = y + rng.int(5) - 2;
      if (!water(w, fx, fy)) continue;
      const f = critter('fish', id('fish'), fx, fy, rng);
      if (!first) first = f; else out.push(f);
      fishLeft--;
    }
    return first;
  }, out);

  // FLIERS: moths and fireflies in open air; ash moths where the lava glows;
  // the second doors' snow moths and prism moths anywhere open.
  for (const kind of ['moth', 'firefly', 'ashmoth', 'snowmoth', 'prismmoth'] as const) {
    scatterKind(p, recipe[kind] ?? 0, 12, A, (x, y) => {
      if (!empty(w, x, y) || openRun(w, x, y, 0, 1, 4) < 3 || openRun(w, x, y, 0, -1, 4) < 3) return null;
      if (kind === 'ashmoth') {
        let hot = false;
        for (let k = 0; k < 24 && !hot; k++) {
          const X = x + ((k * 11) % 41) - 20, Y = y + ((k * 7) % 31) - 4;
          if (w.inBounds(X, Y)) { const t = w.types[w.idx(X, Y)]; hot = t === Cell.Lava || t === Cell.Fire; }
        }
        if (!hot) return null;
      }
      if (!nearPath(p, x, y, 18)) return null;
      return critter(kind, id(kind), x, y, rng);
    }, out);
  }

  // BRINE SKATERS: on the surface film of brine (or still water), with room above.
  scatterKind(p, recipe.brineskater ?? 0, 10, A, (x, y) => {
    if (!empty(w, x, y) || !w.inBounds(x, y + 1)) return null;
    const below = w.types[w.idx(x, y + 1)];
    if (below !== Cell.Brine && below !== Cell.Water) return null;
    if (openRun(w, x, y, 0, -1, 6) < 5 || !nearPath(p, x, y, 20)) return null;
    return critter('brineskater', id('brineskater'), x + 0.5, y + 0.5, rng);
  }, out);

  // BEETLES: grazers on the floor.
  scatterKind(p, recipe.beetle ?? 0, 12, A, (x, y) => {
    if (!empty(w, x, y) || !wall(w, x, y + 1) || isLiquid(w.types[w.idx(x, y + 1)]) || !nearPath(p, x, y, 10)) return null;
    return critter('beetle', id('beetle'), x, y, rng);
  }, out);

  return out;
}
