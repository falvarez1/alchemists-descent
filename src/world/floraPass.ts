import { HEIGHT, WIDTH } from '@/config/constants';
import { Rng as RngCtor } from '@/core/rng';
import type { Rng } from '@/core/rng';
import type { BiomeId, Pickup, PrefabEnemy, RegionGraph, RuntimeInspectionMarker } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { blocksEntity, Cell, isLiquid, isSolid } from '@/sim/CellType';
import { crystalColor, EMPTY_COLOR, glowshroomColor, lavaColor, packRGB, waterColor } from '@/sim/colors';
import { holdsUp, LEAF_LITTER, LEAF_REACH, SEED_GLOW_HELD, SEED_THIRSTY_HELD, SEED_THIRSTY_LOOSE } from '@/sim/elements/flora';
import type { World } from '@/sim/World';
import { type CarveAvoid, connectToCaves, type PlacementLedger } from '@/world/connect';
import { plantFlora, type FloraFloor, type FloraSpecies, type PlantOptions, type PlantResult } from '@/world/floraKit';

/* ============================================================
 * THE FLORA PASS — floors 2–4 (floor 1 is hand-planted in worksFlora).
 *
 * Runs late in generateLevel on its OWN forked stream (hashSeed 'flora'), so
 * every earlier placement is byte-identical per seed. Two jobs:
 *
 *  1. PUZZLE ROOMS, carved into solid rock and joined to the main path with
 *     connectToCaves (the findability guarantee), each with a reward and a
 *     real-cell verb: fell a tree across a chasm (a lava moat on the Kiln),
 *     water a thirsty seed to grow a root ladder to a high shelf, burn a
 *     bramble thicket out of an alcove mouth. Every one is optional treasure
 *     and fail-open (levitation, climbing, digging still work).
 *  2. DRESSING: the floor's own plants on real ground — giant mushrooms, root
 *     columns and hanging roots in the Rot Gardens; mangroves, reeds, kelp
 *     and lily pads in the Cisterns; ember-bark and fire-lilies in the Kiln.
 *     Plants write only into open cells, so they can never seal a route (and
 *     living wood is walk-past anyway).
 * ============================================================ */

export type FloraPuzzleKind = 'timber-bridge' | 'lava-bridge' | 'root-ladder' | 'thicket';

export interface FloraPuzzle {
  kind: FloraPuzzleKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  reward: { x: number; y: number };
  /** The plant (or seed bed) the puzzle turns on. */
  focus: { x: number; y: number };
}

export interface FloraPassResult {
  plants: number;
  puzzles: FloraPuzzle[];
  pickups: Pickup[];
  enemies: PrefabEnemy[];
  markers: RuntimeInspectionMarker[];
  /** Run after the LAST generation pass: the gauge-rescue tunnels clear every
   *  cell but metal along their path, and through an open puzzle hall the only
   *  thing left to clear is the puzzle itself (a tree, a cistern). This puts
   *  back what the tunnels took, writing only into open cells, then removes
   *  any stand a tunnel left hanging in the air. */
  repair: () => void;
}

export interface FloraPassContext {
  spawn: { x: number; y: number };
  wellX: number;
  pickups: readonly Pickup[];
  graph: RegionGraph;
  fits?: Uint8Array;
  /** Sealed features the rooms' connectors route around (world/connect sealedFootprints). */
  avoid?: readonly CarveAvoid[];
}

const FLOOR_OF: Partial<Record<BiomeId, FloraFloor>> = {
  fungal: 'rot', flooded: 'cistern', volcanic: 'kiln', earthen: 'bellows',
  // wave 3: the second doors
  frozen: 'cold', crystal: 'glass',
};

/** Rock the carvers may cut into (never bedrock metal, never a liquid body). */
function rock(t: number): boolean {
  return t === Cell.Wall || t === Cell.Stone || t === Cell.RawOre || t === Cell.Coal;
}

function setCell(world: World, x: number, y: number, t: Cell, color: number, life = 0): void {
  if (x < 2 || y < 2 || x >= WIDTH - 2 || y >= HEIGHT - 8) return;
  const i = world.idx(x, y);
  if (world.types[i] === Cell.Metal) return;
  world.types[i] = t;
  world.colors[i] = color;
  world.life[i] = life;
  world.charge[i] = 0;
  world.activity.touchIndex(i);
}

function carve(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setCell(world, x, y, Cell.Empty, EMPTY_COLOR);
}

function fill(world: World, x0: number, y0: number, x1: number, y1: number, t: Cell, color: () => number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setCell(world, x, y, t, color());
}

const ROCK_COLOR = (): number => packRGB(62, 58, 60);

/**
 * A rectangle of (mostly) solid rock for a puzzle room, clear of every
 * reservation and of the arrival. Criteria degrade progressively (rock share,
 * then distance from spawn) rather than silently giving up.
 */
function findRockSite(world: World, rng: Rng, w: number, h: number, ledger: PlacementLedger, pc: FloraPassContext,
  taken: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>, liquidRim = true): { x0: number; y0: number } | null {
  // The last two tiers drop the liquid margin around the room (the Kiln is
  // veined with lava everywhere); a site taken there is sealed by sealRim.
  const tiers = [{ share: 0.92, far: 140, margin: 8 }, { share: 0.85, far: 110, margin: 8 }, { share: 0.75, far: 90, margin: 8 },
    { share: 0.62, far: 80, margin: 8 }, { share: 0.5, far: 70, margin: 8 }, { share: 0.55, far: 70, margin: 0 }, { share: 0.42, far: 60, margin: 0 }];
  for (const tier of tiers) {
    // a room that must stay dry (a seed bed) never takes a site beside liquid
    if (tier.margin === 0 && !liquidRim) break;
    for (let attempt = 0; attempt < 260; attempt++) {
      const x0 = 24 + Math.floor(rng.next() * (WIDTH - w - 48));
      const y0 = 70 + Math.floor(rng.next() * (HEIGHT - h - 140));
      const x1 = x0 + w, y1 = y0 + h;
      if (ledger.intersects(x0 - 10, y0 - 10, x1 + 10, y1 + 10)) continue;
      if (Math.abs((x0 + x1) / 2 - pc.spawn.x) < tier.far + w / 2 && Math.abs((y0 + y1) / 2 - pc.spawn.y) < tier.far + h / 2) continue;
      if (Math.abs((x0 + x1) / 2 - pc.wellX) < w / 2 + 40) continue;
      if (taken.some((r) => x0 - 24 < r.x1 && x1 + 24 > r.x0 && y0 - 24 < r.y1 && y1 + 24 > r.y0)) continue;
      if (pc.pickups.some((p) => p.x > x0 - 16 && p.x < x1 + 16 && p.y > y0 - 16 && p.y < y1 + 16)) continue;
      let solid = 0, n = 0, metal = 0;
      for (let y = y0; y <= y1; y += 3) for (let x = x0; x <= x1; x += 3) {
        const t = world.types[world.idx(x, y)];
        n++;
        if (rock(t)) solid++;
        if (t === Cell.Metal) metal++;
      }
      if (metal > 0) continue;
      if (solid / n < tier.share) continue;
      // no lava veins or water tables in or around the walls: a carved room
      // must not flood (with fire, or with the Cisterns)
      let hot = false;
      const m = tier.margin;
      for (let y = y0 - m; y <= y1 + m && !hot; y += 2) for (let x = x0 - m; x <= x1 + m; x += 2) {
        if (!world.inBounds(x, y)) continue;
        const t = world.types[world.idx(x, y)];
        if (t === Cell.Lava || t === Cell.Fire || isLiquid(t)) { hot = true; break; }
      }
      if (!hot) {
        sealRim(world, x0, y0, x1, y1);
        return { x0, y0 };
      }
    }
  }
  return null;
}

/** Any liquid or flame in a room's six-cell rock rim becomes rock: the walls
 *  a carve leaves standing must hold (a lava vein would pour in). */
function sealRim(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0 - 2; y <= y1 + 2; y++) for (let x = x0 - 2; x <= x1 + 2; x++) {
    if (!world.inBounds(x, y)) continue;
    const t = world.types[world.idx(x, y)];
    if (isLiquid(t) || t === Cell.Fire || t === Cell.Ember) setCell(world, x, y, Cell.Wall, ROCK_COLOR());
  }
}

/** A small lamp and a glint: light is information (the reward reads from afar).
 *  The cold and glass floors light theirs with a cluster of crystal instead. */
function lamp(world: World, x: number, y: number, floor?: FloraFloor): void {
  const cold = floor === 'cold' || floor === 'glass';
  const t = cold ? Cell.Crystal : Cell.Glowshroom;
  const c = cold ? crystalColor : glowshroomColor;
  for (let dx = -1; dx <= 1; dx++) setCell(world, x + dx, y, t, c());
  setCell(world, x, y - 1, t, c());
}

/* ------------------------------ puzzle rooms ------------------------------ */

/** Each pass result's repair list (filled by the puzzle builders). */
const repairSinks = new WeakMap<FloraPassResult, Array<() => void>>();
function onRepair(out: FloraPassResult, fn: () => void): void {
  repairSinks.get(out)?.push(fn);
}

function countIn(world: World, x0: number, y0: number, x1: number, y1: number, t: Cell): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world.inBounds(x, y) && world.types[world.idx(x, y)] === t) n++;
  return n;
}

/** True if everything above a plant's felling line hangs free of load-bearing
 *  ground (cut there and it falls). */
function standsOnFootOnly(world: World, plant: PlantResult): boolean {
  for (let y = plant.y0 - 1; y <= plant.cutY - 1; y++) {
    for (let x = plant.x0 - 1; x <= plant.x1 + 1; x++) {
      if (!world.inBounds(x, y) || world.types[world.idx(x, y)] !== Cell.Trunk) continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
        const t = world.types[world.idx(x + dx, y + dy)];
        if (blocksEntity(t) && t !== Cell.Trunk) return false;
      }
    }
  }
  return true;
}

/** Remove a plant's cells (a failed fit). */
function clearPlant(world: World, plant: PlantResult): void {
  for (let y = plant.y0 - 1; y <= plant.y1 + 1; y++) for (let x = plant.x0 - 1; x <= plant.x1 + 1; x++) {
    if (!world.inBounds(x, y)) continue;
    const t = world.types[world.idx(x, y)];
    if (t === Cell.Trunk || t === Cell.Leaf || t === Cell.Seed) setCell(world, x, y, Cell.Empty, EMPTY_COLOR);
  }
}

/**
 * The last word after every carve: a stand the late passes left hanging in
 * the air (a rescue tunnel through the ground under its foot) is removed with
 * its crown and pods, rather than dropped on the player's arrival. Support is
 * the runtime's rule (holdsUp: anchored ground; powder only from underneath).
 */
export function dropStrandedStands(world: World): number {
  const W = world.width, H = world.height, types = world.types;
  const seen = new Uint8Array(types.length);
  const queue: number[] = [];
  let dropped = 0;
  for (let s = 0; s < types.length; s++) {
    if (types[s] !== Cell.Trunk || seen[s]) continue;
    queue.length = 0;
    queue.push(s);
    seen[s] = 1;
    let supported = false, x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h], y = (i / W) | 0, x = i - y * W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (!supported && (holdsUp(world, x, y + 1, true) || holdsUp(world, x - 1, y, false)
        || holdsUp(world, x + 1, y, false) || holdsUp(world, x, y - 1, false))) supported = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = nx + ny * W;
        if (!seen[ni] && types[ni] === Cell.Trunk) { seen[ni] = 1; queue.push(ni); }
      }
    }
    if (supported) continue;
    dropped++;
    for (const i of queue) world.clearCellAt(i);
    const r = LEAF_REACH + 2;
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y1 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x1 + r); x++) {
        const i = x + y * W, t = types[i], life = world.life[i];
        if ((t === Cell.Leaf && life < 0 && life !== LEAF_LITTER) || (t === Cell.Seed && (life === SEED_GLOW_HELD || life === SEED_THIRSTY_HELD))) {
          world.clearCellAt(i);
        }
      }
    }
  }
  return dropped;
}

/** A few small plants on a puzzle room's floor, so it belongs to the floor. */
function dressRoom(world: World, rng: Rng, floor: FloraFloor, xa: number, xb: number, footY: number): void {
  if (xb - xa < 8) return;
  const n = 1 + rng.int(3);
  for (let k = 0; k < n; k++) {
    const x = xa + Math.floor(rng.next() * (xb - xa));
    const species: FloraSpecies = floor === 'kiln' ? (rng.next() < 0.6 ? 'firelily' : 'grasstuft')
      : floor === 'cold' ? (rng.next() < 0.7 ? 'frostfern' : 'grasstuft')
      : floor === 'glass' ? (rng.next() < 0.55 ? 'prismflower' : 'glassreed')
      : rng.next() < 0.5 ? 'fernbed' : 'grasstuft';
    if (world.types[world.idx(x, footY)] !== Cell.Empty || !blocksEntity(world.types[world.idx(x, footY + 1)])) continue;
    plantFlora(world, species, x, footY, rng, { floor });
  }
}

function timberBridge(world: World, rng: Rng, floor: FloraFloor, ledger: PlacementLedger, pc: FloraPassContext,
  taken: FloraPuzzle[], out: FloraPassResult, lava: boolean): void {
  let W = 156, H = 112;
  let site = findRockSite(world, rng, W, H, ledger, pc, taken);
  if (!site) { W = 132; H = 100; site = findRockSite(world, rng, W, H, ledger, pc, taken); }
  if (!site) return;
  const { x0, y0 } = site;
  const x1 = x0 + W, y1 = y0 + H;
  const floorY = y1 - 28; // the ledges' walking surface is floorY (solid); open above
  const chasmL = x0 + Math.round(W * 0.37), chasmR = chasmL + Math.round(W * 0.22) + rng.int(5);
  // The hall above both ledges (tall enough for a tree to stand and to fall).
  carve(world, x0 + 6, y0 + 6, x1 - 6, floorY - 1);
  // Rounded shoulders, so it reads as a cave and not a box.
  for (let k = 0; k < 10; k++) {
    fill(world, x0 + 6, y0 + 6 + k, x0 + 6 + (10 - k), y0 + 6 + k, Cell.Wall, ROCK_COLOR);
    fill(world, x1 - 6 - (10 - k), y0 + 6 + k, x1 - 6, y0 + 6 + k, Cell.Wall, ROCK_COLOR);
  }
  // Build the structure rather than trust the rock: at the relaxed site tiers
  // the ground under a carved room can be hollow cave. Two ledges, a lined pit.
  const pitBottom = floorY + 22;
  fill(world, x0 + 6, floorY, x1 - 6, floorY + 5, Cell.Wall, ROCK_COLOR);
  fill(world, chasmL - 3, floorY, chasmR + 3, pitBottom + 4, Cell.Wall, ROCK_COLOR);
  // The chasm: a deep cut between the ledges. On the Kiln it is a lava moat.
  carve(world, chasmL, floorY, chasmR, pitBottom);
  if (lava) {
    for (let y = floorY + 9; y <= pitBottom; y++) for (let x = chasmL; x <= chasmR; x++) setCell(world, x, y, Cell.Lava, lavaColor());
  } else if (floor === 'cistern') {
    for (let y = floorY + 8; y <= pitBottom; y++) for (let x = chasmL; x <= chasmR; x++) setCell(world, x, y, Cell.Water, waterColor());
  }
  // The reward niche on the far side, lit.
  const nx = x1 - 20;
  carve(world, nx - 6, floorY - 16, x1 - 4, floorY - 1);
  lamp(world, x1 - 6, floorY - 1, floor);
  const reward = { x: nx, y: floorY - 2 };
  out.pickups.push(floor === 'kiln' || floor === 'rot' ? makePickup('chest', reward.x, reward.y, { amount: 60 }) : makePickup('tome', reward.x, reward.y));
  // The tree on the near ledge, a few cells from the lip: cut it from behind and it spans the gap.
  const species: FloraSpecies = floor === 'rot' ? 'mushroom' : floor === 'cistern' ? 'mangrove' : floor === 'kiln' ? 'emberbark'
    : floor === 'cold' ? 'snowbirch' : floor === 'glass' ? 'glasswillow' : 'birch';
  const treeX = chasmL - 7;
  const span = chasmR - treeX + 14;
  const hall = floorY - (y0 + 6);
  // Crown clearance: a cap or crown touching the ceiling would hold the stand
  // up (honestly — it is wedged), so the tree is sized to stand free and then
  // PROVEN to hang from its foot alone; a wedged one is regrown shorter.
  const crown = species === 'mushroom' ? 16 : species === 'mangrove' ? 26 : 12;
  let height = Math.min(hall - crown - 6, Math.max(span, species === 'mushroom' ? 44 : 50));
  let plant: PlantResult | null = null;
  for (let tries = 0; tries < 4; tries++) {
    plant = plantFlora(world, species, treeX, floorY - 1, rng, { height, lean: 0.02, maxReachRight: 5 });
    if (!plant || standsOnFootOnly(world, plant)) break;
    clearPlant(world, plant);
    plant = null;
    height -= 8;
  }
  // The gap is fitted to the tree that actually grew: what stands above its
  // felling line must reach the far lip with room to rest on it.
  let chasmEnd = chasmR;
  if (plant) {
    const reach = plant.cutY - plant.topY;
    const fits = treeX + reach - 7;
    if (fits < chasmEnd && fits - chasmL >= 14) {
      fill(world, fits + 1, floorY, chasmEnd, pitBottom + 4, Cell.Wall, ROCK_COLOR);
      chasmEnd = fits;
    }
  }
  lamp(world, treeX - 12, floorY - 1, floor);
  dressRoom(world, rng, floor, x0 + 10, chasmL - 16, floorY - 1);
  dressRoom(world, rng, floor, chasmR + 4, nx - 10, floorY - 1);
  if (plant) {
    const planted = plant.trunk, box = { x0: plant.x0, y0: plant.y0, x1: plant.x1, y1: plant.y1 };
    const regrowHeight = height, salt = Math.floor(rng.next() * 0x7fffffff);
    onRepair(out, () => {
      if (countIn(world, box.x0, box.y0, box.x1, box.y1, Cell.Trunk) >= planted * 0.7) return;
      // a rescue tunnel went through the tree: clear what is left of it, grow it again
      for (let y = box.y0 - 1; y <= box.y1 + 1; y++) for (let x = box.x0 - 1; x <= box.x1 + 1; x++) {
        if (!world.inBounds(x, y)) continue;
        const t = world.types[world.idx(x, y)];
        if (t === Cell.Trunk || t === Cell.Leaf || t === Cell.Seed) setCell(world, x, y, Cell.Empty, EMPTY_COLOR);
      }
      const regrow = new RngCtor(salt);
      for (let h = regrowHeight, tries = 0; tries < 4; tries++, h -= 8) {
        const again = plantFlora(world, species, treeX, floorY - 1, regrow, { height: h, lean: 0.02, maxReachRight: 5 });
        if (!again || standsOnFootOnly(world, again)) break;
        clearPlant(world, again);
      }
    });
  }
  // Entrance: the near wall at ledge height, joined to the main path.
  const ex = x0 + 8, ey = floorY - 10;
  carve(world, x0, floorY - 22, x0 + 8, floorY - 1);
  connectToCaves(world, rng, pc.graph, ex - 6, ey, 12, pc.fits, undefined, pc.avoid);
  const puzzle: FloraPuzzle = { kind: lava ? 'lava-bridge' : 'timber-bridge', x0, y0, x1, y1, reward, focus: { x: treeX, y: plant?.cutY ?? floorY - 4 } };
  taken.push(puzzle);
  ledger.reserve(x0 - 4, y0 - 4, x1 + 4, y1 + 4, 'flora-' + puzzle.kind);
  out.puzzles.push(puzzle);
  out.markers.push({ kind: 'landmark', label: lava ? 'Lava bridge' : 'Timber bridge', x0, y0, x1, y1,
    detail: `fell the ${species} across the ${lava ? 'moat' : 'chasm'} (${plant?.trunk ?? 0} wood, height ${height}, hall ${hall})` });
  if (plant) out.plants++;
}

function rootLadder(world: World, rng: Rng, floor: FloraFloor, ledger: PlacementLedger, pc: FloraPassContext,
  taken: FloraPuzzle[], out: FloraPassResult): void {
  const W = 84;
  let H = 124;
  let site = findRockSite(world, rng, W, H, ledger, pc, taken, false);
  if (!site) { H = 112; site = findRockSite(world, rng, W, H, ledger, pc, taken, false); }
  if (!site) return;
  const { x0, y0 } = site;
  const x1 = x0 + W, y1 = y0 + H;
  const floorY = y0 + H - 14;
  carve(world, x0 + 6, y0 + 6, x1 - 6, floorY - 1);
  fill(world, x0 + 6, floorY, x1 - 6, floorY + 5, Cell.Wall, ROCK_COLOR);
  // The high shelf off the right wall, with its niche and lamp.
  const shelfY = floorY - (H >= 124 ? 58 : 54);
  const shelfL = x1 - 30;
  fill(world, shelfL, shelfY, x1 - 6, shelfY + 3, Cell.Wall, ROCK_COLOR);
  carve(world, x1 - 6, shelfY - 18, x1 + 2, shelfY - 1);
  lamp(world, x1 - 2, shelfY - 1, floor);
  const reward = { x: x1 - 12, y: shelfY - 2 };
  out.pickups.push(makePickup(floor === 'kiln' ? 'chest' : 'tome', reward.x, reward.y, floor === 'kiln' ? { amount: 70 } : {}));
  // The seed bed: a shallow cup of dark soil with thirsty seeds in it, under the shelf's lip.
  const bedX = shelfL - 7;
  // the cup is sunk into the floor (its rim flush with it), so a pour pools over the seeds
  carve(world, bedX - 4, floorY, bedX + 4, floorY + 1);
  for (let x = bedX - 4; x <= bedX + 4; x++) setCell(world, x, floorY + 2, Cell.Wall, packRGB(64, 50, 38));
  for (let x = bedX - 2; x <= bedX + 2; x++) setCell(world, x, floorY + 1, Cell.Seed, packRGB(176 + rng.int(20), 126 + rng.int(14), 54), SEED_THIRSTY_LOOSE);
  // Water beside it, sealed in a stone cistern on the near wall by a wooden
  // bung over a spout: burn or dig the bung and the pour runs down into the
  // sunk bed (or bring water in the flask). The cistern stands wholly to the
  // left of the bed, so no stalk can climb into it.
  const bx1 = bedX - 6, bx0 = Math.max(x0 + 7, bx1 - 14), by1 = floorY - 30, by0 = by1 - 7;
  fill(world, bx0 - 1, by0 - 1, bx1 + 1, by1 + 1, Cell.Stone, () => packRGB(96, 92, 88));
  // bracketed to the near wall, so it reads as masonry and not a floating box
  if (bx0 - 1 > x0 + 6) fill(world, x0 + 6, by1 - 1, bx0 - 1, by1 + 1, Cell.Stone, () => packRGB(88, 84, 80));
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) setCell(world, x, y, Cell.Water, waterColor());
  for (let x = bx1 - 2; x <= bx1; x++) setCell(world, x, by1 + 1, Cell.Wood, packRGB(118, 88, 54));
  // A low stone curb just beyond where the pour lands turns the spill toward
  // the cup instead of out through the door (a 2-cell step for the wizard).
  fill(world, bx1 - 5, floorY - 2, bx1 - 4, floorY - 1, Cell.Wall, ROCK_COLOR);
  dressRoom(world, rng, floor, x0 + 10, bedX - 14, floorY - 1);
  onRepair(out, () => {
    // the sealed cistern: re-seal and refill it if a tunnel opened it
    if (countIn(world, bx0, by0, bx1, by1, Cell.Water) < (bx1 - bx0 + 1) * (by1 - by0 + 1) * 0.6) {
      fill(world, bx0 - 1, by0 - 1, bx1 + 1, by1 + 1, Cell.Stone, () => packRGB(96, 92, 88));
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) setCell(world, x, y, Cell.Water, waterColor());
      for (let x = bx1 - 2; x <= bx1; x++) setCell(world, x, by1 + 1, Cell.Wood, packRGB(118, 88, 54));
    }
    // the seed bed
    if (countIn(world, bedX - 4, floorY, bedX + 4, floorY + 1, Cell.Seed) < 3) {
      for (let x = bedX - 2; x <= bedX + 2; x++) {
        const i = world.idx(x, floorY + 1);
        if (world.types[i] === Cell.Empty) setCell(world, x, floorY + 1, Cell.Seed, packRGB(182, 132, 56), SEED_THIRSTY_LOOSE);
      }
    }
  });
  // Entrance: the left wall at floor height.
  carve(world, x0, floorY - 22, x0 + 8, floorY - 1);
  connectToCaves(world, rng, pc.graph, x0 - 6, floorY - 10, 12, pc.fits, undefined, pc.avoid);
  // the bed's lamp stands past the cup (under the pour it would split the spill)
  lamp(world, bedX + 8, floorY - 1, floor);
  const puzzle: FloraPuzzle = { kind: 'root-ladder', x0, y0, x1, y1, reward, focus: { x: bedX, y: floorY + 1 } };
  taken.push(puzzle);
  ledger.reserve(x0 - 4, y0 - 4, x1 + 4, y1 + 4, 'flora-root-ladder');
  out.puzzles.push(puzzle);
  out.markers.push({ kind: 'landmark', label: 'Root ladder', x0, y0, x1, y1, detail: 'water the thirsty seeds; climb the ladder they grow' });
}

function thicket(world: World, rng: Rng, floor: FloraFloor, ledger: PlacementLedger, pc: FloraPassContext,
  taken: FloraPuzzle[], out: FloraPassResult): void {
  const W = 64, H = 44;
  const site = findRockSite(world, rng, W, H, ledger, pc, taken);
  if (!site) return;
  const { x0, y0 } = site;
  const x1 = x0 + W, y1 = y0 + H;
  const floorY = y1 - 8;
  // The alcove (reward inside) and its mouth (the thicket), the mouth facing left.
  carve(world, x0 + 26, y0 + 8, x1 - 8, floorY - 1);
  carve(world, x0 + 6, floorY - 24, x0 + 26, floorY - 1);
  fill(world, x0 + 4, floorY, x1 - 6, floorY + 4, Cell.Wall, ROCK_COLOR);
  lamp(world, x1 - 12, floorY - 1, floor);
  const reward = { x: x1 - 20, y: floorY - 2 };
  out.pickups.push(makePickup('goldpile', reward.x, reward.y, { amount: floor === 'kiln' ? 90 : floor === 'cistern' ? 75 : 60 }));
  // Brambles: a woven lattice of real Wood (it walls the mouth) laced with leaves (it catches).
  const bramble = floor === 'kiln' ? packRGB(52, 40, 34) : floor === 'rot' ? packRGB(92, 70, 52)
    : floor === 'cold' ? packRGB(96, 102, 110) : floor === 'glass' ? packRGB(100, 92, 118) : packRGB(78, 70, 50);
  const leafA = floor === 'kiln' ? packRGB(140, 76, 46) : floor === 'rot' ? packRGB(138, 132, 78)
    : floor === 'cold' ? packRGB(154, 180, 186) : floor === 'glass' ? packRGB(170, 180, 216) : packRGB(92, 130, 82);
  for (let y = floorY - 24; y <= floorY - 1; y++) {
    for (let x = x0 + 10; x <= x0 + 24; x++) {
      const weave = ((x + y) % 5 === 0) || ((x - y + 40) % 6 === 0) || rng.next() < 0.18;
      if (weave) setCell(world, x, y, Cell.Wood, bramble);
      else if (rng.next() < 0.75) setCell(world, x, y, Cell.Leaf, leafA, -2);
    }
  }
  carve(world, x0, floorY - 22, x0 + 8, floorY - 1);
  connectToCaves(world, rng, pc.graph, x0 - 6, floorY - 10, 12, pc.fits, undefined, pc.avoid);
  const puzzle: FloraPuzzle = { kind: 'thicket', x0, y0, x1, y1, reward, focus: { x: x0 + 17, y: floorY - 12 } };
  taken.push(puzzle);
  ledger.reserve(x0 - 4, y0 - 4, x1 + 4, y1 + 4, 'flora-thicket');
  out.puzzles.push(puzzle);
  out.markers.push({ kind: 'landmark', label: 'Bramble thicket', x0, y0, x1, y1, detail: 'burn (or dig) the brambles out of the alcove mouth' });
}

/* -------------------------------- dressing -------------------------------- */

interface Spot { x: number; y: number }

/** Heat a flammable plant must keep clear of (it would be burning at arrival). */
function nearHeat(world: World, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) {
    if (!world.inBounds(x + dx, y + dy)) continue;
    const t = world.types[world.idx(x + dx, y + dy)];
    if (t === Cell.Lava || t === Cell.Fire || t === Cell.Ember) return true;
  }
  return false;
}

/** Firm ground five cells wide under a foot: static rock, never a powder
 *  (sand slides, a coal seam burns out from under a Kiln fire-lily) or metal. */
function firmFooting(world: World, x: number, y: number): boolean {
  for (let dx = -2; dx <= 2; dx++) {
    const t = world.types[world.idx(x + dx, y + 1)];
    if (!blocksEntity(t) || !isSolid(t) || t === Cell.Metal) return false;
  }
  return true;
}

/** Open cells straight up from (x, y), capped. */
function openAbove(world: World, x: number, y: number, cap: number): number {
  let h = 0;
  while (h < cap && world.inBounds(x, y - h) && world.types[world.idx(x, y - h)] === Cell.Empty) h++;
  return h;
}

/** Open cells straight down from (x, y), capped. */
function openBelow(world: World, x: number, y: number, cap: number): number {
  let h = 0;
  while (h < cap && world.inBounds(x, y + h) && world.types[world.idx(x, y + h)] === Cell.Empty) h++;
  return h;
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = list[i]; list[i] = list[j]; list[j] = t;
  }
  return list;
}

/** Budgets per floor: big stands, small plants, hanging growth. */
const BUDGET: Record<Exclude<FloraFloor, 'bellows'>, { big: number; small: number; hang: number }> = {
  rot: { big: 18, small: 90, hang: 26 },
  cistern: { big: 14, small: 70, hang: 16 },
  // Kiln 14/46 -> 18/72 (fix3): its flora was sparse; the ground allows more
  // (the heat, footing and clearance tests still decide every stand).
  kiln: { big: 18, small: 72, hang: 0 },
  // wave 3. The Cold Store's cold rooms hold a few birches; frost-fern and
  // grass under them; roots do not hang in the cold. The Galleries grow glass.
  cold: { big: 14, small: 70, hang: 0 },
  glass: { big: 12, small: 80, hang: 0 },
};

function dress(world: World, rng: Rng, floor: Exclude<FloraFloor, 'bellows'>, ledger: PlacementLedger, pc: FloraPassContext, out: FloraPassResult): void {
  const W = world.width, H = world.height, types = world.types;
  const placed: Array<Spot & { r: number }> = [];
  const clearOf = (x: number, y: number, r: number, up = r * 2): boolean => {
    if (Math.abs(x - pc.spawn.x) < 56 && Math.abs(y - pc.spawn.y) < 56) return false;
    if (Math.abs(x - pc.wellX) < 34) return false;
    if (ledger.intersects(x - r, y - up, x + r, y + 2)) return false;
    if (pc.pickups.some((p) => Math.abs(p.x - x) < r + 6 && Math.abs(p.y - y) < r + 12)) return false;
    return !placed.some((p) => Math.abs(p.x - x) < p.r + r && Math.abs(p.y - y) < Math.max(p.r, r) * 2);
  };
  const grow = (species: FloraSpecies, x: number, y: number, r: number, opts: PlantOptions = {}): PlantResult | null => {
    const plant = plantFlora(world, species, x, y, rng, { floor, ...opts });
    if (plant) { placed.push({ x, y, r }); out.plants++; }
    return plant;
  };
  // Every floor surface (every 3rd column), walked in a shuffled order.
  const floors: Spot[] = [];
  const ceilings: Spot[] = [];
  const surfaces: Spot[] = [];
  for (let x = 20; x < W - 20; x += 3) {
    for (let y = 30; y < H - 14; y++) {
      const t = types[x + y * W];
      if (t === Cell.Empty) {
        const below = types[x + (y + 1) * W], above = types[x + (y - 1) * W];
        if (rock(below) && above === Cell.Empty) floors.push({ x, y });
        if (rock(above) && below === Cell.Empty && types[x + (y + 2) * W] === Cell.Empty) ceilings.push({ x, y });
      } else if ((t === Cell.Water || t === Cell.Brine) && types[x + (y - 1) * W] === Cell.Empty) surfaces.push({ x, y });
    }
  }
  shuffle(floors, rng); shuffle(ceilings, rng); shuffle(surfaces, rng);
  const budget = BUDGET[floor];
  let big = 0, small = 0, hang = 0;
  // Big stands first (they need the room), then everything small around them.
  for (const { x, y } of floors) {
    if (big >= budget.big) break;
    if (!firmFooting(world, x, y)) continue;
    const h = openAbove(world, x, y, 96);
    if (h < 44) continue;
    if (floor !== 'cistern' && nearHeat(world, x, y - 12, 28)) continue;
    const sideRoom = openAbove(world, x - 10, y - Math.floor(h * 0.5), 20) + openAbove(world, x + 10, y - Math.floor(h * 0.5), 20);
    if (sideRoom < 16) continue; // never wedged in a slot
    if (floor === 'rot') {
      const height = Math.min(54, h - 16);
      if (height < 26 || !clearOf(x, y, 22, height)) continue;
      if (grow('mushroom', x, y, 22, { height, pods: big % 4 === 1 ? 'thirsty' : null })) big++;
    } else if (floor === 'cold' || floor === 'glass') {
      const height = Math.min(floor === 'cold' ? 64 : 54, h - 12);
      if (height < 30 || !clearOf(x, y, 18, height)) continue;
      if (grow(floor === 'cold' ? 'snowbirch' : 'glasswillow', x, y, 18, { height, pods: big % 5 === 2 ? 'thirsty' : null })) big++;
    } else if (floor === 'cistern') {
      const height = Math.min(44, h - 26);
      if (height < 22 || !clearOf(x, y, 22, height + 12)) continue;
      if (grow('mangrove', x, y, 22, { height, pods: big % 4 === 2 ? 'thirsty' : null })) big++;
    } else {
      const height = Math.min(52, h - 8);
      if (height < 26 || !clearOf(x, y, 18, height)) continue;
      if (grow('emberbark', x, y, 18, { height })) big++;
    }
  }
  // Root columns: floor to ceiling where a pillar of 30-100 cells stands free.
  if (floor === 'rot') {
    let rc = 0;
    for (const { x, y } of floors) {
      if (rc >= 5) break;
      const h = openAbove(world, x, y, 110);
      if (h < 30 || h >= 110 || !firmFooting(world, x, y) || !rock(types[x + (y - h) * W])) continue;
      if (!clearOf(x, y, 16, h)) continue;
      if (grow('rootcolumn', x, y, 16, { ceilY: y - h + 1 })) rc++;
    }
  }
  // Small plants on the ground: fern beds, grass, saplings, fire-lilies.
  for (const { x, y } of floors) {
    if (small >= budget.small) break;
    if (!firmFooting(world, x, y)) continue;
    const h = openAbove(world, x, y, 40);
    if (h < 12) continue;
    const r = rng.next();
    let species: FloraSpecies;
    if (floor === 'kiln') {
      if (nearHeat(world, x, y - 4, 14)) continue;
      species = r < 0.65 ? 'firelily' : r < 0.88 ? 'grasstuft' : 'sapling'; // 0.55/0.85 before fix3: more lilies
    } else if (floor === 'cold') {
      species = r < 0.55 ? 'frostfern' : r < 0.85 ? 'grasstuft' : 'sapling';
    } else if (floor === 'glass') {
      species = r < 0.45 ? 'prismflower' : r < 0.85 ? 'glassreed' : 'sapling';
    } else {
      species = r < 0.45 ? 'fernbed' : r < 0.85 ? 'grasstuft' : 'sapling';
    }
    if (species === 'sapling' && h < 26) species = 'grasstuft';
    const rad = species === 'sapling' ? 9 : 5;
    if (!clearOf(x, y, rad, 10)) continue;
    if (grow(species, x, y, rad, species === 'sapling' ? { height: Math.min(18, h - 6) } : {})) small++;
  }
  // Hanging growth under ceilings.
  for (const { x, y } of ceilings) {
    if (hang >= budget.hang) break;
    const depth = openBelow(world, x, y, 60);
    if (depth < 30) continue;
    if (!clearOf(x, y + 30, 7, 30)) continue;
    if (grow('hangingroot', x, y, 7, { height: Math.min(depth - 16, 14 + rng.int(26)) })) hang++;
  }
  // The Cold Store's still water and brine: ice-lilies on the surface.
  if (floor === 'cold') {
    let lily = 0;
    for (const { x, y } of surfaces) {
      if (lily >= 22) break;
      if (!clearOf(x, y, 6, 4)) continue;
      let ok = true;
      for (let dx = 0; dx < 10 && ok; dx++) {
        const s = types[x + dx + y * W];
        ok = (s === Cell.Water || s === Cell.Brine) && types[x + dx + (y - 1) * W] === Cell.Empty;
      }
      if (ok && grow('icelily', x, y - 1, 6)) lily++;
    }
  }
  // The Cisterns' water: lily pads on still surfaces, kelp in the deep, reeds on the banks.
  if (floor === 'cistern') {
    let lily = 0, kelp = 0, reeds = 0;
    for (const { x, y } of surfaces) {
      if (lily >= 26 && kelp >= 16 && reeds >= 18) break;
      let bed = y;
      while (bed < H - 10 && isLiquid(types[bed * W + x])) bed++;
      const depth = bed - y;
      if (types[x + bed * W] === Cell.Metal) continue;
      let bank = false;
      for (let dx = -4; dx <= 4 && !bank; dx++) if (rock(types[x + dx + y * W]) || rock(types[x + dx + (y - 1) * W])) bank = true;
      if (reeds < 18 && bank && depth <= 10 && clearOf(x, y, 7, 20) && openAbove(world, x, y - 1, 24) >= 20) {
        if (grow('reeds', x, bed - 1, 7)) { reeds++; continue; }
      }
      if (lily < 26 && depth >= 3 && clearOf(x, y, 6, 4)) {
        let ok = true;
        for (let dx = 0; dx < 10 && ok; dx++) ok = types[x + dx + y * W] === Cell.Water && types[x + dx + (y - 1) * W] === Cell.Empty;
        if (ok && grow('lilypad', x, y - 1, 6)) { lily++; continue; }
      }
      if (kelp < 16 && depth >= 14 && clearOf(x, bed, 5, depth)) {
        if (grow('kelp', x, bed - 1, 5, { height: Math.min(depth - 4, 12 + rng.int(18)) })) { kelp++; continue; }
      }
    }
  }
}

/**
 * The floor's flora: puzzle rooms first (they reserve their ground), then the
 * dressing around the rest of the level. `rng` must be this pass's own fork.
 */
export function applyFloraPass(world: World, rng: Rng, biome: BiomeId, ledger: PlacementLedger, pc: FloraPassContext): FloraPassResult {
  const repairs: Array<() => void> = [];
  const out: FloraPassResult = { plants: 0, puzzles: [], pickups: [], enemies: [], markers: [], repair: () => {
    for (const r of repairs) r();
    dropStrandedStands(world);
  } };
  repairSinks.set(out, repairs);
  const floor = FLOOR_OF[biome];
  if (!floor || floor === 'bellows') return out;
  const taken: FloraPuzzle[] = [];
  if (floor === 'kiln') {
    timberBridge(world, rng, floor, ledger, pc, taken, out, true);
    thicket(world, rng, floor, ledger, pc, taken, out);
    rootLadder(world, rng, floor, ledger, pc, taken, out);
  } else {
    timberBridge(world, rng, floor, ledger, pc, taken, out, false);
    rootLadder(world, rng, floor, ledger, pc, taken, out);
    thicket(world, rng, floor, ledger, pc, taken, out);
  }
  dress(world, rng, floor, ledger, pc, out);
  return out;
}
