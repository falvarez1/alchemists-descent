import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp, hash2, valueNoise } from '@/core/math';
import type { Rng } from '@/core/rng';
import type { RegionGraph } from '@/core/types';
import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';
import { graphSpawn } from '@/world/regions';

/**
 * Shared carve/connect primitives for post-generation placement passes
 * (landmark structures, authored prefabs). Extracted verbatim from the
 * placeStructures closures so every pass guarantees the same thing: carved
 * content JOINS the cave network, and bedrock Metal is never breached.
 */

/** Elliptical hollow; Metal (bedrock, vault shells, well casing) survives. */
export function carvePocket(
  world: World,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
      const X = cx + dx,
        Y = cy + dy;
      if (X < 2 || X >= WIDTH - 2 || Y < 2 || Y >= HEIGHT - 8) continue;
      const i = world.idx(X, Y);
      if (world.types[i] !== Cell.Metal) {
        world.types[i] = Cell.Empty;
        world.activity.touchIndex(i);
        world.colors[i] = 0x08080c;
      }
    }
  }
}

/**
 * Rectangular hollow; Metal survives, same bounds guard as carvePocket.
 * A RECT (not an ellipse) is the standing-room primitive: a disc of radius r
 * guarantees a 9x17 clear box only at its exact center, but a 15x20 rect
 * guarantees fitting feet across its whole middle — the gauge-rescue pass
 * carves one above a cut-off lock so the wizard provably has somewhere to
 * STAND inside the validator's check window.
 */
export function carveRect(
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let Y = y0; Y <= y1; Y++) {
    for (let X = x0; X <= x1; X++) {
      if (X < 2 || X >= WIDTH - 2 || Y < 2 || Y >= HEIGHT - 8) continue;
      const i = world.idx(X, Y);
      if (world.types[i] !== Cell.Metal) {
        world.types[i] = Cell.Empty;
        world.activity.touchIndex(i);
        world.colors[i] = 0x08080c;
      }
    }
  }
}

/* ============================================================
 * ORGANIC CONNECTORS (GEN 62) — the end of the starburst
 * ============================================================
 * Every connector targeted the centroid of the nearest main-path region. A level's network is
 * one giant region (its spawn and exit share it), so its centroid is one hub point and every
 * limb of the level aimed at it: ten or more straight 24-wide spokes from one hub (the d2, d2b
 * and d3 blueprints). With the switch on (a campaign floor: GenDef.organicTunnels) a connector
 * instead ends at the nearest body-fit cell the spawn can walk to, leaves its line in a slow
 * wander (perpendicular, tapering to nothing at both ends), and swells now and then (a few cells
 * of breathing room, an occasional bead chamber). No rng draws are added: the wander is value
 * noise on the endpoints' hash, so the stream every later stage shares is unchanged. A connector
 * with a radius under ten is a deliberately narrow (dig-gated) one and stays exactly as it was.
 */
let organicTunnels = false;

/** Turn the organic connector style on or off (generateLevel sets it from the floor's budget and clears it). */
export function setOrganicTunnels(on: boolean): void {
  organicTunnels = on;
}

interface ReachCache {
  /** Every 4th walkable body-fit cell (index), the candidate ends of a connector. */
  pts: Int32Array;
}
const reachCache = new WeakMap<RegionGraph, ReachCache | null>();

/** Spawn-reachable body-fit cells for this graph's moment of the world (computed once per graph). */
function reachFor(graph: RegionGraph, fits: Uint8Array): ReachCache | null {
  const hit = reachCache.get(graph);
  if (hit !== undefined) return hit;
  const W = WIDTH, H = HEIGHT;
  let seed = -1;
  // The walk starts at the body-fit cell nearest the spawn the graph was extracted for (a region
  // holds narrow runs no body fits through, so "a fit cell in the spawn's region" could be in a
  // cave the spawn can never walk to).
  const sp = graphSpawn(graph);
  if (sp) {
    const sx = Math.floor(sp.x), sy = Math.floor(sp.y);
    for (let r = 0; r <= 60 && seed < 0; r++) {
      for (let dy = -r; dy <= r && seed < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = sx + dx, y = sy + dy;
          if (x > 1 && y > 1 && x < W - 1 && y < H - 1 && fits[x + y * W]) { seed = x + y * W; break; }
        }
      }
    }
  }
  if (seed < 0) {
    reachCache.set(graph, null);
    return null;
  }
  const seen = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  seen[seed] = 1;
  q[qt++] = seed;
  const bottom = (H - 1) * W;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % W;
    if (x + 1 < W - 1 && !seen[i + 1] && fits[i + 1]) { seen[i + 1] = 1; q[qt++] = i + 1; }
    if (x - 1 >= 1 && !seen[i - 1] && fits[i - 1]) { seen[i - 1] = 1; q[qt++] = i - 1; }
    if (i + W < bottom && !seen[i + W] && fits[i + W]) { seen[i + W] = 1; q[qt++] = i + W; }
    if (i - W >= W && !seen[i - W] && fits[i - W]) { seen[i - W] = 1; q[qt++] = i - W; }
  }
  const pts: number[] = [];
  for (let y = 30; y < H - 12; y += 4) for (let x = 12; x < W - 12; x += 4) if (seen[x + y * W]) pts.push(x + y * W);
  const cache = { pts: Int32Array.from(pts) };
  reachCache.set(graph, cache);
  return cache;
}

/**
 * REACHABILITY GUARANTEE: every carved structure must join the cave network.
 * Winds a tunnel from a structure's mouth to the nearest sizable open
 * region's centroid (Metal is never breached, so vault shells and water
 * tanks survive their own approach tunnels).
 *
 * `radius` defaults to 12: the player's collision box is 9x17 and EVERY
 * cell of it must be clear — an axis-aligned 9x17 box needs a circle of
 * radius >= 9.62 just to EXIST inside it, and the walk's jitter plus
 * diagonal runs eat the rest of the margin (radius 9 fragments into
 * disconnected fit-islands; the legacy radius-4 crawl stranded the player
 * outside his own checkpoints). Pass a smaller radius only for connections
 * that are deliberately dig-gated.
 *
 * Returns the carve-step centers in walk order (first = nearest the mouth),
 * so callers can reseal part of the tunnel (sealed prefab anchors).
 */
export function connectToCaves(
  world: World,
  rng: Rng,
  graph: RegionGraph,
  fromX: number,
  fromY: number,
  radius = 12,
  fits?: Uint8Array,
  sweep?: { halfW: number; up: number; down: number },
  avoid: readonly CarveAvoid[] = [],
): Array<[number, number]> {
  const steps: Array<[number, number]> = [];
  // A connector that leaves a SEALED room (a lair's mouth, a puzzle room's) keeps the old hub target and walk:
  // the room's organ is planned round them (tests/encounter-lairs-sealed).
  const fromSealedRoom = avoid.some((r) => inRect(r, fromX, fromY));
  if (organicTunnels && fits && radius >= 10 && !fromSealedRoom) {
    const reach = reachFor(graph, fits);
    if (reach && reach.pts.length > 0) {
      let bi = -1, bd = Infinity;
      for (let k = 0; k < reach.pts.length; k++) {
        const i = reach.pts[k];
        const x = i % WIDTH, y = (i / WIDTH) | 0;
        const d = (x - fromX) * (x - fromX) + (y - fromY) * (y - fromY);
        if (d >= bd || inFootprint(avoid, x, y)) continue;
        bd = d;
        bi = i;
      }
      if (bi >= 0) return tunnelTo(world, rng, fromX, fromY, bi % WIDTH, (bi / WIDTH) | 0, radius, sweep, 26, avoid);
    }
  }
  // A sealed feature is never the TARGET either: its open interior (a lair's
  // cave, a light room) is often the nearest main-path region, and a tunnel
  // aimed into it is a tunnel through it. With nothing to avoid this is a no-op.
  const sealed = (x: number, y: number): boolean => inFootprint(avoid, x, y);
  // Target the nearest MAIN-PATH region: those form the spawn<->exit artery,
  // so the tunnel provably joins the network the player actually walks.
  // (Nearest "open area" is not enough — isolated pockets are open too.)
  let best: { cx: number; cy: number } | null = null;
  let bestD = Infinity;
  for (const onlyMain of [true, false]) {
    for (const reg of graph.regions) {
      if (onlyMain && !reg.onMainPath) continue;
      if (!onlyMain && reg.area < 60) continue;
      if (sealed(reg.cx, reg.cy)) continue;
      const d = (reg.cx - fromX) * (reg.cx - fromX) + (reg.cy - fromY) * (reg.cy - fromY);
      if (d < bestD) {
        bestD = d;
        best = { cx: reg.cx, cy: reg.cy };
      }
    }
    if (best) break;
  }
  if (!best) return steps;
  let tx = Math.floor(best.cx),
    ty = Math.floor(best.cy);
  // The centroid of a sprawling region can sit in rock OR in a box-thin
  // appendix the player cannot occupy. With a fits mask, resolve to the
  // nearest WIZARD-FIT cell — the tunnel then provably joins the network
  // where the player can actually BE.
  if (fits) {
    let fx = -1,
      fy = -1;
    outerF: for (let r = 0; r <= 90; r += 2) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const X = Math.floor(tx + Math.cos(ang) * r),
          Y = Math.floor(ty + Math.sin(ang) * r);
        if (X > 1 && Y > 1 && X < WIDTH - 1 && Y < HEIGHT - 1 && fits[X + Y * WIDTH] && !sealed(X, Y)) {
          fx = X;
          fy = Y;
          break outerF;
        }
      }
    }
    if (fx >= 0) {
      tx = fx;
      ty = fy;
    }
  }
  if (world.inBounds(tx, ty) && world.types[world.idx(tx, ty)] !== Cell.Empty) {
    outer: for (let r = 2; r <= 50; r += 2) {
      for (const [ddx, ddy] of [
        [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
      ]) {
        const X = tx + ddx * r,
          Y = ty + ddy * r;
        if (world.inBounds(X, Y) && world.types[world.idx(X, Y)] === Cell.Empty && !sealed(X, Y)) {
          tx = X;
          ty = Y;
          break outer;
        }
      }
    }
  }
  return tunnelTo(world, rng, fromX, fromY, tx, ty, radius, sweep, 26, avoid, organicTunnels && !fromSealedRoom);
}

/** The raw tunnel walk: jittered march from (fromX, fromY) to an EXPLICIT
 *  target, carving radius-sized pockets each step (Metal survives).
 *
 *  `sweep` additionally drags a rect along the path — a GAUGE-GUARANTEED
 *  gallery. A disc chain only promises 9x17 clearance exactly on its
 *  centerline, so a thin Metal survivor (a latch pedestal) or a rock spire
 *  one row above disc reach silently severs the fits corridor. A swept rect
 *  with a flat ceiling `up` rows above the centerline lets the wizard step
 *  OVER bumps the carve must spare: feet on a 1-tall Metal pedestal still
 *  have 17 clear rows overhead. Used by the gauge-rescue pass; ordinary
 *  connectors stay disc-carved for the organic look. */
export function tunnelTo(
  world: World,
  rng: Rng,
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
  radius: number,
  sweep?: { halfW: number; up: number; down: number },
  // Lower bound on carved rows. Defaults to 26 (the old hardcoded clamp) so
  // every existing caller is byte-identical; the gauge-rescue pass passes a
  // lower value when its target sits above row 26, which the hardcoded clamp
  // would otherwise pull DOWN — producing a tunnel that never reaches it.
  minY = 26,
  // Sealed features to walk AROUND (see CarveAvoid). A footprint holding the
  // tunnel's own start or target is its destination, not an obstacle, and is
  // ignored. Empty (the default): the walk is exactly the old one.
  avoid: readonly CarveAvoid[] = [],
  // Organic style for THIS call (default: the module switch). A connector that leaves a sealed room
  // (a lair's mouth) passes false: the room's organ (a seam, a pool) was planned round the old walk.
  organicStyle: boolean = organicTunnels,
): Array<[number, number]> {
  let steps: Array<[number, number]> = [];
  let x = fromX,
    y = fromY,
    guard = 0;
  while ((Math.abs(x - tx) > 3 || Math.abs(y - ty) > 3) && guard < 900) {
    guard++;
    x += Math.sign(tx - x) * (rng.next() < 0.8 ? 1 : 0) + Math.floor((rng.next() - 0.5) * 2);
    y += Math.sign(ty - y) * (rng.next() < 0.8 ? 1 : 0);
    x = Math.floor(clamp(x, radius + 2, WIDTH - radius - 3));
    y = Math.floor(clamp(y, minY, HEIGHT - 12));
    steps.push([x, y]);
  }
  // The walk never reads the world, so planning it whole and carving after is
  // byte-identical to carving step by step — and lets a sealed feature on the
  // line be seen before a single cell of it is cut. A walk that would bite one
  // is replaced by the cheapest route around it (the rng draws above are spent
  // either way, so every later draw on this stream is unchanged).
  const rooms = avoid.filter((r) => !inRect(r, fromX, fromY) && !inRect(r, tx, ty));
  // An organic tunnel wanders and swells: the walk is judged as it will be CARVED (centres shifted,
  // radius at its largest), or it would bite a sealed feature the plain line cleared.
  const organic = organicStyle && radius >= 10 && steps.length > 6;
  const widest = organic ? radius + Math.floor(radius * 0.4) : radius;
  if (organic) steps = wanderSteps(steps, fromX, fromY, tx, ty, radius, minY, sweep !== undefined);
  let detoured = false;
  if (rooms.length > 0 && steps.some(([sx, sy]) => rooms.some((r) => footprintHits(r, sx, sy, widest, sweep)))) {
    const around = detourSteps(world, fromX, fromY, tx, ty, widest, sweep, minY, rooms);
    if (around) {
      steps = around;
      detoured = true;
    }
  }
  steps.forEach(([sx, sy], n) => {
    // (the first and last steps keep the caller's radius: a mouth opens exactly as it always did,
    // beside a lair's seam or a fixture's footing it was planned around)
    const r = organic && !detoured && n >= 14 && n < steps.length - 10 ? swell(n, fromX, fromY, tx, ty, radius) : radius;
    carvePocket(world, sx, sy, r, r);
    if (sweep) {
      carveRect(world, sx - sweep.halfW, sy - sweep.up, sx + sweep.halfW, sy + sweep.down);
    }
  });
  return steps;
}

/**
 * The walk's centres shifted sideways by a slow noise that tapers to nothing at both ends (so the
 * tunnel still starts and ends exactly where the caller asked). Amplitude: up to 10 cells on a
 * long run, 6 for a swept gallery (its rect follows the wandering centre), none on a short one.
 */
function wanderSteps(
  steps: Array<[number, number]>,
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
  radius: number,
  minY: number,
  swept: boolean,
): Array<[number, number]> {
  const len = Math.hypot(tx - fromX, ty - fromY);
  if (len < 40) return steps;
  const amp = Math.min(swept ? 6 : 10, len * 0.09);
  const px = -(ty - fromY) / len, py = (tx - fromX) / len;
  const seed = hash2(fromX, fromY, (tx * 73 + ty * 131) | 0) * 1e5;
  const n = steps.length;
  return steps.map(([sx, sy], i) => {
    const t = i / (n - 1);
    const w = (valueNoise(i, 7, 0.05, seed) * 2 - 1) * amp * Math.sin(Math.PI * t) ** 0.8;
    return [
      Math.floor(clamp(sx + px * w, radius + 2, WIDTH - radius - 3)),
      Math.floor(clamp(sy + py * w, minY, HEIGHT - 12)),
    ] as [number, number];
  });
}

/** A step's carve radius: the caller's, swelled by up to a quarter, with the odd bead chamber (radius + 40%) a few steps long. */
function swell(i: number, fromX: number, fromY: number, tx: number, ty: number, radius: number): number {
  const seed = hash2(fromX, fromY, (tx * 37 + ty * 91) | 0) * 1e5;
  const breathe = Math.floor(valueNoise(i, 3, 0.07, seed) * radius * 0.25);
  const bead = valueNoise(i, 11, 0.03, seed) > 0.86 ? Math.floor(radius * 0.4) : 0;
  return radius + Math.max(breathe, bead);
}

/* ============================================================
 * Sealed footprints — what a late tunnel walks around
 * ============================================================ */

/**
 * A placement whose cells ARE the feature: an encounter lair's sealed pool and
 * planted habitat, the Leviathan's sump, a light-puzzle room of designed black.
 * The connector walk is a jittered straight line that cuts everything but
 * Metal, and the passes that run AFTER such a feature exists (light puzzles,
 * flora rooms, the gauge rescue) walked straight through it: a flora-room
 * connector on d3 seed 3 took the Rillback lair's whole pool (577 liquid cells
 * down to 3). Inclusive cell rect.
 */
export interface CarveAvoid {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Ledger labels of sealed features (the light-puzzle intrusion guard shares it). */
export const SEALED_LABEL = /^(encounter-lair|sump|light-|cold-|glass-|warden-|footing-)/; // + the second doors' rooms and guardian halls, and every fixture's footing (world/fixtureFooting)

/** The sealed footprints reserved so far: what every later tunnel routes around. */
export function sealedFootprints(ledger: PlacementLedger): CarveAvoid[] {
  return ledger
    .rects()
    .filter((r) => SEALED_LABEL.test(r.label))
    .map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
}

function inRect(r: CarveAvoid, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/**
 * Is (x, y) inside any of these footprints? A caller choosing where a tunnel
 * should END asks this first: a tunnel is never kept out of the footprint it
 * ends in (that room is its destination), so a join target picked inside a
 * sealed feature's open interior — a lair's cave is a perfectly good
 * main-path floor — hands the walk a licence to cut straight through it (a
 * story nook's connector took the west wall and floor of d2 seed 10's grove).
 */
export function inFootprint(rects: readonly CarveAvoid[], x: number, y: number): boolean {
  return rects.some((r) => inRect(r, x, y));
}

/** Half-extents of one carve step: its disc, plus the swept gallery if any. */
function carveExtent(radius: number, sweep?: { halfW: number; up: number; down: number }): { hx: number; up: number; down: number } {
  return {
    hx: Math.max(radius, sweep?.halfW ?? 0),
    up: Math.max(radius, sweep?.up ?? 0),
    down: Math.max(radius, sweep?.down ?? 0),
  };
}

/** Does a walk step's carve reach into `r`? (Bounding box: a little conservative at the disc's corners.) */
function footprintHits(
  r: CarveAvoid,
  x: number,
  y: number,
  radius: number,
  sweep?: { halfW: number; up: number; down: number },
): boolean {
  const e = carveExtent(radius, sweep);
  return x + e.hx >= r.x0 && x - e.hx <= r.x1 && y + e.down >= r.y0 && y - e.up <= r.y1;
}

/** Detour grid pitch: carve centres 4 apart overlap a radius-12 disc almost exactly (scallop < 0.1 cell). */
const DETOUR_PITCH = 4;
/** Cost per sealed-footprint cell a node's carve would cover. A node inside a
 *  lair costs hundreds of steps, so the route goes round; never infinite. */
const DETOUR_ROOM_COST = 1;
/** Cost per sampled Metal cell under a node's disc: the carve spares Metal, so
 *  a route through a casing (the exit well, a vault shell) would not connect. */
const DETOUR_METAL_COST = 3;

/**
 * The cheapest carve route from (fromX, fromY) to (tx, ty) on a DETOUR_PITCH
 * grid of carve centres: the generation-time twin of world/repairRoute. Each
 * step costs its length (1 or sqrt 2 grid units); a node also pays
 * DETOUR_ROOM_COST per cell of a sealed footprint its carve would cover and
 * DETOUR_METAL_COST per sampled Metal cell under its disc. A sealed room is
 * expensive, never forbidden (fail-open): when it truly is the only way, the
 * thinnest cut is taken. Returns carve centres in walk order, start and target
 * included, clamped to the same rows/columns the walk may carve; null only if
 * the grid is degenerate.
 */
function detourSteps(
  world: World,
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
  radius: number,
  sweep: { halfW: number; up: number; down: number } | undefined,
  minY: number,
  rooms: readonly CarveAvoid[],
): Array<[number, number]> | null {
  const P = DETOUR_PITCH;
  const xMin = radius + 2,
    xMax = WIDTH - radius - 3,
    yMin = minY,
    yMax = HEIGHT - 12;
  if (xMax < xMin || yMax < yMin) return null;
  const cols = Math.floor((xMax - xMin) / P) + 1,
    rows = Math.floor((yMax - yMin) / P) + 1,
    count = cols * rows;
  const { hx, up, down } = carveExtent(radius, sweep);
  const types = world.types,
    W = world.width;
  const nodeCost = new Float32Array(count).fill(-1);
  const costOf = (id: number): number => {
    const cached = nodeCost[id];
    if (cached >= 0) return cached;
    const x = xMin + (id % cols) * P,
      y = yMin + Math.floor(id / cols) * P;
    let cost = 0;
    for (const r of rooms) {
      const ox = Math.min(x + hx, r.x1) - Math.max(x - hx, r.x0) + 1;
      const oy = Math.min(y + down, r.y1) - Math.max(y - up, r.y0) + 1;
      if (ox > 0 && oy > 0) cost += ox * oy * DETOUR_ROOM_COST;
    }
    for (let dy = -radius; dy <= radius; dy += 3) {
      const Y = y + dy;
      if (Y < 0 || Y >= world.height) continue;
      for (let dx = -radius; dx <= radius; dx += 3) {
        const X = x + dx;
        if (X < 0 || X >= W || dx * dx + dy * dy > radius * radius) continue;
        if (types[X + Y * W] === Cell.Metal) cost += DETOUR_METAL_COST;
      }
    }
    nodeCost[id] = cost;
    return cost;
  };
  const colOf = (x: number): number => Math.max(0, Math.min(cols - 1, Math.round((x - xMin) / P)));
  const rowOf = (y: number): number => Math.max(0, Math.min(rows - 1, Math.round((y - yMin) / P)));
  const sx = Math.floor(clamp(fromX, xMin, xMax)),
    sy = Math.floor(clamp(fromY, yMin, yMax));
  const gx = Math.floor(clamp(tx, xMin, xMax)),
    gy = Math.floor(clamp(ty, yMin, yMax));
  const start = colOf(sx) + rowOf(sy) * cols;
  const gc = colOf(gx),
    gr = rowOf(gy);
  // Octile distance to the goal's 3x3 neighbourhood: admissible (steps cost >= their length).
  const heuristic = (id: number): number => {
    const dc = Math.max(0, Math.abs((id % cols) - gc) - 1);
    const dr = Math.max(0, Math.abs(Math.floor(id / cols) - gr) - 1);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
  };
  const scores = new Float64Array(count).fill(Infinity);
  const parents = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const heapIds: number[] = [],
    heapScores: number[] = [];
  const push = (id: number, score: number): void => {
    let at = heapIds.length;
    heapIds.push(id);
    heapScores.push(score);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (heapScores[parent] <= score) break;
      heapIds[at] = heapIds[parent];
      heapScores[at] = heapScores[parent];
      at = parent;
    }
    heapIds[at] = id;
    heapScores[at] = score;
  };
  const pop = (): number => {
    const result = heapIds[0];
    const id = heapIds.pop()!,
      score = heapScores.pop()!;
    if (heapIds.length === 0) return result;
    let at = 0;
    while (at * 2 + 1 < heapIds.length) {
      let child = at * 2 + 1;
      if (child + 1 < heapIds.length && heapScores[child + 1] < heapScores[child]) child++;
      if (heapScores[child] >= score) break;
      heapIds[at] = heapIds[child];
      heapScores[at] = heapScores[child];
      at = child;
    }
    heapIds[at] = id;
    heapScores[at] = score;
    return result;
  };
  scores[start] = 0;
  push(start, heuristic(start));
  while (heapIds.length > 0) {
    const id = pop();
    if (closed[id]) continue;
    closed[id] = 1;
    const c = id % cols,
      r = Math.floor(id / cols);
    if (Math.abs(c - gc) <= 1 && Math.abs(r - gr) <= 1) {
      const nodes: number[] = [];
      for (let at = id; at >= 0; at = parents[at]) nodes.push(at);
      nodes.reverse();
      // The walk leaves from the true start, not from the grid node it snapped
      // to: that node (up to half a pitch off) is never charged, and carving it
      // could clip a footprint right beside the mouth (a stonemaw's own seam).
      const out: Array<[number, number]> = [[sx, sy]];
      for (const n of nodes.slice(1)) out.push([xMin + (n % cols) * P, yMin + Math.floor(n / cols) * P]);
      out.push([gx, gy]);
      return out;
    }
    for (let dr = -1; dr <= 1; dr++) {
      const nr = r + dr;
      if (nr < 0 || nr >= rows) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc;
        if ((dc === 0 && dr === 0) || nc < 0 || nc >= cols) continue;
        const next = nc + nr * cols;
        if (closed[next]) continue;
        const score = scores[id] + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1) + costOf(next);
        if (score >= scores[next]) continue;
        scores[next] = score;
        parents[next] = id;
        push(next, score + heuristic(next));
      }
    }
  }
  return null;
}

/* ============================================================
 * Placement ledger — reserved ground the placement passes respect
 * ============================================================ */

export interface ReservedRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
}

/**
 * Axis-aligned reservation registry threaded through the placement passes:
 * prefabs reserve their footprints; spawn / exit-well / waystones /
 * onboarding zones are pre-reserved so prefabs keep clear of them; secrets
 * and landmark structures reject candidate sites on reserved ground.
 * An EMPTY ledger is inert — every guard is a no-op, so the pre-prefab
 * pipeline behaves byte-identically when nothing reserves anything.
 */
export class PlacementLedger {
  private list: ReservedRect[] = [];

  reserve(x0: number, y0: number, x1: number, y1: number, label: string): void {
    this.list.push({
      x0: Math.min(x0, x1),
      y0: Math.min(y0, y1),
      x1: Math.max(x0, x1),
      y1: Math.max(y0, y1),
      label,
    });
  }

  intersects(x0: number, y0: number, x1: number, y1: number): boolean {
    const a0 = Math.min(x0, x1),
      a1 = Math.max(x0, x1),
      b0 = Math.min(y0, y1),
      b1 = Math.max(y0, y1);
    for (const r of this.list) {
      if (a0 <= r.x1 && a1 >= r.x0 && b0 <= r.y1 && b1 >= r.y0) return true;
    }
    return false;
  }

  rects(): ReadonlyArray<ReservedRect> {
    return this.list;
  }
}
