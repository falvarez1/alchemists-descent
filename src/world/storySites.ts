import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type { AuthoredLight, RegionGraph } from '@/core/types';
import type { LevelStorySites, StoryCampSite, StoryPipeSite, StoryValveSite } from '@/core/story';
import { blocksEntity, Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';
import { carveRect, inFootprint, sealedFootprints, tunnelTo, type PlacementLedger } from '@/world/connect';
import { wizardMask } from '@/world/validate';

/**
 * STORY SITES (wave 3 WS-S): where a floor's story happens.
 *
 * - SPEAKING-PIPES: brass voice-pipes drawn on the back wall above a standable
 *   floor on the main route (near the arrival and the waystones). They are
 *   presentation — the Docent's voice, not a mechanism — so they write no
 *   cells; the site only has to be a floor the player walks over.
 * - PELL'S CAMP: a lit nook carved off the main path (a short connector joins
 *   it to the route, so it is findable and never on the way).
 * - THE RESONANT VALVE: another nook, farther off, whose flat floor is the
 *   echo's stage.
 *
 * Generated floors place all three here on their own forked RNG stream (the
 * caller's `rng`), after the other placement passes, respecting the ledger.
 * Floor 1 is hand-built (world/worksStory).
 */

/** The alchemist's box: 9 wide (±4), 17 tall (entities/physics). */
const HALF_W = 4;
const BODY_H = 17;

/** Can a player stand with his feet on row `y` at column `x` (a 9x17 box clear, solid underfoot)? */
export function standable(world: Pick<World, 'width' | 'height' | 'types'>, x: number, y: number): boolean {
  const W = world.width;
  if (x - HALF_W < 1 || x + HALF_W >= W - 1 || y - BODY_H < 1 || y + 1 >= world.height - 1) return false;
  let support = 0;
  for (let dx = -HALF_W; dx <= HALF_W; dx++) if (blocksEntity(world.types[x + dx + (y + 1) * W])) support++;
  if (support < 5) return false;
  for (let dy = 0; dy < BODY_H; dy++) {
    const row = (y - dy) * W;
    for (let dx = -HALF_W; dx <= HALF_W; dx++) if (blocksEntity(world.types[x + dx + row])) return false;
  }
  return true;
}

/** The standable floor nearest (ax, ay) inside a window, or null. Ties prefer the anchor's row. */
export function findFloorNear(
  world: Pick<World, 'width' | 'height' | 'types'>,
  ax: number,
  ay: number,
  rx: number,
  up: number,
  down: number,
  accept: (x: number, y: number) => boolean = () => true,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let x = Math.max(8, Math.round(ax - rx)); x <= Math.min(world.width - 9, Math.round(ax + rx)); x += 2) {
    for (let y = Math.max(20, Math.round(ay - up)); y <= Math.min(world.height - 10, Math.round(ay + down)); y++) {
      const score = Math.abs(x - ax) + Math.abs(y - ay) * 0.6;
      if (score >= bestScore) continue;
      if (!standable(world, x, y) || !accept(x, y)) continue;
      best = { x, y };
      bestScore = score;
    }
  }
  return best;
}

/** Where a pipe over (x, floorY) comes down from: the first rock above its horn, or a long run into the dark. */
export function pipeTop(world: Pick<World, 'width' | 'height' | 'types'>, x: number, floorY: number): number {
  for (let y = floorY - BODY_H - 6; y > Math.max(8, floorY - 170); y--) {
    if (blocksEntity(world.types[x + y * world.width])) return y + 1;
  }
  return Math.max(8, floorY - 170);
}

export function makePipe(world: Pick<World, 'width' | 'height' | 'types'>, id: string, x: number, floorY: number): StoryPipeSite {
  return { id, x, floorY, top: pipeTop(world, x, floorY) };
}

/* ---------------- nooks ---------------- */

interface NookSpec {
  /** Interior width and height (cells). */
  w: number;
  h: number;
  /** Preferred distance band from the spawn (cells). */
  near: number;
  far: number;
  label: string;
}

interface Nook {
  x0: number;
  x1: number;
  /** Feet row on the nook's floor. */
  floorY: number;
  /** The side the connector leaves from (the route is that way). */
  mouth: -1 | 1;
}

function mainPathAt(graph: RegionGraph, x: number, y: number): boolean {
  const gx = Math.floor(x / graph.scale), gy = Math.floor(y / graph.scale);
  if (gx < 0 || gy < 0 || gx >= graph.w || gy >= graph.h) return false;
  const id = graph.labels[gx + gy * graph.w];
  return id >= 0 && graph.regions[id]?.onMainPath === true;
}

/** Share of blocking cells in a rect (sampled every other cell). */
function solidity(world: World, x0: number, y0: number, x1: number, y1: number): number {
  let solid = 0, total = 0;
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    total++;
    const t = world.types[x + y * WIDTH];
    if (blocksEntity(t) && t !== Cell.Metal) solid++;
    else if (t === Cell.Metal) return 0; // never carve into a casing, a vault, a machine
  }
  return total ? solid / total : 0;
}

/**
 * A nook in solid rock beside the main path: sampled candidates, scored by how
 * solid their footprint is, how short their connector would be (a main-path
 * standable floor within reach along the nook's floor row) and how well their
 * distance from the spawn fits the band. Carved as a flat-floored room with a
 * swept connector to that floor.
 */
function carveNook(world: World, rng: Rng, ledger: PlacementLedger, reach: Uint8Array,
  spawn: { x: number; y: number }, avoid: ReadonlyArray<{ x: number; y: number; r: number }>, spec: NookSpec): Nook | null {
  let best: (Nook & { score: number; tx: number; ty: number }) | null = null;
  // Sealed features (a lair, the sump, a light or second-door room): the
  // connector walks around them, and its route floor is never one inside them.
  const sealed = sealedFootprints(ledger);
  for (let attempt = 0; attempt < 480; attempt++) {
    const cx = Math.floor(rng.range(90, WIDTH - 90));
    const floorY = Math.floor(rng.range(150, HEIGHT - 130));
    const x0 = cx - (spec.w >> 1), x1 = x0 + spec.w - 1, y0 = floorY - spec.h + 1;
    if (x0 < 20 || x1 > WIDTH - 20 || y0 < 30) continue;
    const d = Math.hypot(cx - spawn.x, floorY - spawn.y);
    if (d < spec.near * 0.6) continue;
    if (avoid.some(a => Math.hypot(cx - a.x, floorY - a.y) < a.r)) continue;
    if (ledger.intersects(x0 - 10, y0 - 8, x1 + 10, floorY + 6)) continue;
    if (solidity(world, x0 - 3, y0 - 3, x1 + 3, floorY + 4) < 0.78) continue;
    // The route beside it: a main-path standable floor within 90 cells along the nook's floor row.
    let target: { x: number; y: number; mouth: -1 | 1; dist: number } | null = null;
    for (const mouth of [-1, 1] as const) {
      for (let step = 6; step <= 90; step += 3) {
        const x = mouth < 0 ? x0 - step : x1 + step;
        if (x < 12 || x > WIDTH - 12) break;
        for (let dy = -22; dy <= 22; dy += 2) {
          const y = floorY + dy;
          if (y < 30 || y > HEIGHT - 12) continue;
          // A floor the player can already reach from the arrival (the wizard's own BFS),
          // outside every sealed feature: a tunnel is never kept out of the room it
          // ends in, so a route floor inside a lair let the connector cut the lair
          // (d2 seed 10: through the grove's west wall and floor).
          if (reach[x + y * WIDTH] !== 1 || !standable(world, x, y) || inFootprint(sealed, x, y)) continue;
          if (!target || step < target.dist) target = { x, y, mouth, dist: step };
          break;
        }
        if (target && target.mouth === mouth) break;
      }
    }
    if (!target) continue;
    const band = d < spec.near ? (spec.near - d) / 60 : d > spec.far ? (d - spec.far) / 60 : 0;
    const score = target.dist / 30 + band + rng.next() * 0.3;
    if (!best || score < best.score) best = { x0, x1, floorY, mouth: target.mouth, score, tx: target.x, ty: target.y };
  }
  if (!best) return null;
  const { x0, x1, floorY } = best;
  // The room, a flat stone floor and a low lintel at each end.
  carveRect(world, x0, floorY - spec.h + 1, x1, floorY);
  for (let x = x0 - 2; x <= x1 + 2; x++) for (let y = floorY + 1; y <= floorY + 3; y++) {
    const i = x + y * WIDTH;
    if (world.types[i] !== Cell.Metal) { world.types[i] = Cell.Stone; world.colors[i] = packRGB(70 + ((x * 7 + y * 3) % 9), 64, 58); }
  }
  // The connector: a swept gallery from the nook's mouth to the route's floor (gauge-guaranteed).
  // Like every late tunnel it walks AROUND sealed features (a lair's pool, the sump, light and
  // second-door rooms).
  const mx = best.mouth < 0 ? x0 + 4 : x1 - 4;
  tunnelTo(world, rng, mx, floorY - 9, best.tx, best.ty - 9, 10, { halfW: 6, up: 10, down: 8 }, 26, sealed);
  ledger.reserve(x0 - 6, floorY - spec.h - 4, x1 + 6, floorY + 4, spec.label);
  return { x0, x1, floorY, mouth: best.mouth };
}

/**
 * When the rock offers no nook: a quiet, reachable floor with a flat run and
 * headroom, preferring ground off the main path (a pocket beside the route).
 */
function quietFloor(world: World, rng: Rng, graph: RegionGraph, reach: Uint8Array, spawn: { x: number; y: number },
  avoid: ReadonlyArray<{ x: number; y: number; r: number }>, near: number, far: number): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  const jitter = rng.int(8);
  for (let x = 60 + jitter; x < WIDTH - 60; x += 8) {
    for (let y = 80; y < HEIGHT - 60; y++) {
      const i = x + y * WIDTH;
      // Feet rows only: reachable, with rock underfoot.
      if (reach[i] !== 1 || reach[i + WIDTH] === 1 || !standable(world, x, y)) continue;
      if (avoid.some(a => Math.hypot(x - a.x, y - a.y) < a.r)) continue;
      // A flat run either side: the camp's props need somewhere to stand.
      let flat = 0;
      for (let dx = -24; dx <= 24; dx += 4) if (standable(world, x + dx, y)) flat++;
      if (flat < 9) continue;
      const d = Math.hypot(x - spawn.x, y - spawn.y);
      const band = d < near ? (near - d) / 60 : d > far ? (d - far) / 60 : 0;
      const score = band + (mainPathAt(graph, x, y - 8) ? 1.5 : 0) + rng.next() * 0.3;
      if (!best || score < best.score) best = { x, y, score };
    }
  }
  return best;
}

/* ---------------- a generated floor ---------------- */

export interface StorySiteAnchors {
  spawn: { x: number; y: number };
  waystones: ReadonlyArray<{ x: number; y: number }>;
  /** Places a pipe should keep clear of (the cauldron, the portal, a boss arena...). */
  avoid: ReadonlyArray<{ x: number; y: number; r: number }>;
}

export interface PlacedStorySites {
  sites: LevelStorySites;
  lights: AuthoredLight[];
}

const lamp = (x: number, y: number, r: number, g: number, b: number, intensity: number, radius: number, flicker: number): AuthoredLight => ({
  x, y, r, g, b, intensity, radius, bloom: 0.1, flicker, flickerPhase: (x * 31 + y * 17) % 600, falloff: 'soft', occluded: true,
});

/** Pell's lantern on its pole (warm, a little unsteady). Cold camps get an ember's glow. */
export function campLight(camp: StoryCampSite, lit: boolean): AuthoredLight {
  const x = camp.x + camp.facing * 9, y = camp.floorY - 24;
  return lit ? lamp(x, y, 1, 0.66, 0.32, 1.05, 132, 0.07) : lamp(camp.x, camp.floorY - 4, 1, 0.42, 0.18, 0.22, 46, 0.2);
}

/** The resonant valve's faint green-glass shimmer. */
export function valveLight(valve: StoryValveSite): AuthoredLight {
  return lamp(valve.x, valve.floorY - 18, 0.46, 0.92, 0.84, 0.34, 86, 0.16);
}

/**
 * Place a generated floor's story: up to three pipes (near the arrival, then
 * each waystone), Pell's camp and the resonant valve. `campLit` is false on
 * the floor Pell has gone ahead from (the Kiln).
 */
export function placeStorySites(
  world: World,
  rng: Rng,
  graph: RegionGraph,
  ledger: PlacementLedger,
  anchors: StorySiteAnchors,
  campLit: boolean,
): PlacedStorySites {
  const lights: AuthoredLight[] = [];
  const avoid = anchors.avoid;
  // Where the player can actually be, from the arrival (9x17, levitation covers vertical runs).
  // A nook's connector ends on one of these floors, so the camp and the valve are findable by
  // construction rather than by the rescue passes.
  const reach = wizardMask({ world, spawn: anchors.spawn });
  // Pell's camp: mid-floor (a stop on the way, not at the door).
  const campNook = carveNook(world, rng, ledger, reach, anchors.spawn, avoid, { w: 92, h: 38, near: 220, far: 620, label: 'story-camp' });
  let camp: StoryCampSite | null = null;
  if (campNook) {
    // Pell stands a third of the way in from the mouth, facing it (he hears you coming).
    const x = campNook.mouth > 0 ? campNook.x1 - 30 : campNook.x0 + 30;
    camp = { x, floorY: campNook.floorY, facing: campNook.mouth, x0: campNook.x0, x1: campNook.x1 };
  } else {
    const q = quietFloor(world, rng, graph, reach, anchors.spawn, avoid, 220, 620);
    if (q) camp = { x: q.x, floorY: q.y, facing: q.x < anchors.spawn.x ? 1 : -1, x0: q.x - 34, x1: q.x + 34 };
  }
  if (camp) lights.push(campLight(camp, campLit));
  // The resonant valve: farther off, clear of the camp.
  const valveAvoid = camp ? [...avoid, { x: camp.x, y: camp.floorY, r: 260 }] : avoid;
  const valveNook = carveNook(world, rng, ledger, reach, anchors.spawn, valveAvoid, { w: 128, h: 44, near: 300, far: 900, label: 'story-valve' });
  let valve: StoryValveSite | null = null;
  if (valveNook) {
    // The wheel on the far wall (away from the mouth); the stage fills the rest.
    const wheelX = valveNook.mouth > 0 ? valveNook.x0 + 12 : valveNook.x1 - 12;
    const stageX = Math.round((valveNook.x0 + valveNook.x1) / 2) + valveNook.mouth * 6;
    valve = { x: wheelX, floorY: valveNook.floorY, stageX, stageHalfW: Math.floor((valveNook.x1 - valveNook.x0) / 2) - 8 };
  } else {
    const q = quietFloor(world, rng, graph, reach, anchors.spawn, valveAvoid, 300, 900);
    if (q) valve = { x: q.x - 30, floorY: q.y, stageX: q.x + 6, stageHalfW: 34 };
  }
  if (valve) lights.push(valveLight(valve));
  // Pipes: one near the arrival, one near each waystone; spaced apart, on the main route.
  const pipes: StoryPipeSite[] = [];
  const clear = (x: number, y: number): boolean =>
    reach[x + y * WIDTH] === 1 && mainPathAt(graph, x, y - 8) &&
    !avoid.some(a => Math.hypot(x - a.x, y - a.y) < a.r) &&
    anchors.waystones.every(w => Math.abs(x - w.x) > 24 || Math.abs(y - w.y) > 30) &&
    pipes.every(p => Math.hypot(x - p.x, y - p.floorY) > 150) &&
    (!camp || Math.hypot(x - camp.x, y - camp.floorY) > 120) &&
    (!valve || Math.hypot(x - valve.stageX, y - valve.floorY) > 120);
  const spots = [anchors.spawn, ...anchors.waystones];
  for (const a of spots) {
    if (pipes.length >= 3) break;
    // Near the anchor but not on it: the arrival gets its breath first.
    const found = findFloorNear(world, a.x, a.y, 130, 60, 70, (x, y) => Math.hypot(x - a.x, y - a.y) >= 36 && clear(x, y));
    if (found) pipes.push(makePipe(world, `p${pipes.length}`, found.x, found.y));
  }
  return { sites: { pipes, camp, valve, flue: null }, lights };
}
