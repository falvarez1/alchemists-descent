import { Cell, blocksEntity, isGas, isSoftGrowth, isSolid } from '@/sim/CellType';
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import { holdsUp, leafAttachedLife } from '@/sim/elements/flora';
import type { World } from '@/sim/World';

/**
 * FATHER THORNE's maths and planners (docs/fighters/father-thorne.md): pure functions of a grid, no Ctx.
 *
 *  - Rooted Camouflage: the state machine (still for a while, near cover, then a slow ramp).
 *  - Ironvine: a surface walker that follows the ground / a wall / a ceiling along the aim, and the column of
 *    thorny Vines cells 2-3 deep it lays on the way.
 *  - Overgrowth: a plan for a radius-70 zone of roots (Trunk, hung from ceilings and up walls), Moss and Leaf
 *    ground cover and hanging Vines.
 *
 * EVERY cell a plan names is soft growth (Vines, Moss, Leaf, Trunk): none of them blocks a body (`blocksEntity`
 * is false), so nothing here can seal a route, and every plan writes only into open cells (air or gas). Roots
 * are only planned where the flora's felling rule (`game/Flora`: a Trunk stand with no contact with anchored
 * rock is felled into solid Wood) will find them supported.
 */

export const TUNING = {
  camo: {
    id: 'rooted-camouflage',
    /** |vx| below this, grounded, for `stillTicks`: she is still. */
    stillSpeed: 0.2,
    stillTicks: 60,
    /** Once still and near cover, concealment climbs 0 -> max over this many ticks. */
    rampTicks: 180,
    max: 0.6,
    /** The cover box: this many cells either side of her body centre, and the cells of natural cover that count. */
    box: 10,
    need: 6,
    /** How often the cover is re-counted (ticks). */
    every: 6,
    /** Cover lost while she stays still: the ramp falls this fast (it only drops to 0 at once when she MOVES). */
    lostDecay: 6,
  },
  vine: {
    id: 'ironvine',
    cooldown: 720,
    /** Reach along the aim, cells. */
    range: 60,
    /** Path cells the growth front covers per tick. */
    speed: 3,
    depthMin: 2,
    depthMax: 3,
    /** Fewest cells worth casting (and the shortest surface run). */
    minPath: 6,
    minCells: 12,
    /** How far from her feet the first surface may be. */
    startReach: 12,
    /** A foe in or on the vines: slowed to this, refreshed for this many ticks, every `every` ticks. */
    slow: 0.5,
    slowTicks: 14,
    every: 6,
    scratch: 1,
    scratchEvery: 12,
    /** The first foe caught is marked (and shown through walls) this long. */
    markTicks: 480,
    /** The first cell crumbles `lifeTicks` after the cast, the last `spread` later: about 25 s. */
    lifeTicks: 1440,
    spread: 120,
    /** A cell browns for this many ticks before it crumbles. */
    fadeTicks: 90,
    /** A cell the sim carried away (a lifted tendril) is still withered if it comes back within this. */
    owedTicks: 3600,
  },
  over: {
    id: 'overgrowth',
    duration: 720,
    radius: 70,
    /** The wave of growth crosses the zone in this many ticks. */
    growTicks: 50,
    /** Foes inside: slowed to this. Her: concealment this. */
    slow: 0.6,
    slowTicks: 14,
    every: 6,
    conceal: 0.7,
    /** Everything withers over the `witherSpread` ticks after the effect ends (browning for `fadeTicks` first). */
    witherSpread: 150,
    fadeTicks: 90,
    floorCover: 0.8,
    wallCover: 0.5,
    ceilCover: 0.3,
    mossShare: 0.6,
    leafStack: 0.35,
    /** A hanging root stops `gapMin..gapMax` cells above whatever is below it; `reach` of them go all the way down to that gap (up to `reachMax` long), so some always hang low enough to jump to. */
    roots: { max: 14, tries: 160, lenMin: 18, lenMax: 44, gapMin: 4, gapMax: 10, reach: 0.35, reachMax: 64, spacingX: 8, spacingY: 14 },
    wallRoots: { max: 9, tries: 120, lenMin: 14, lenMax: 30, spacing: 12 },
    vines: { max: 18, tries: 160, lenMin: 5, lenMax: 18, spacingX: 4 },
    /** A zone with fewer planned cells than this is refused (nothing to grow on). */
    minCells: 40,
    maxCells: 2600,
  },
};

type Grid = Pick<World, 'width' | 'height' | 'types'>;
export type SkipFn = (x: number, y: number) => boolean;
export type Rand = () => number;

const SQ = Math.SQRT2;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------------- noise and colour

export function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1: patches, not salt. */
export function vnoise(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Mix two packed colours. */
export function mixRgb(a: number, b: number, k: number): number {
  const t = clamp(k, 0, 1);
  return packRGB(
    Math.round(unpackR(a) + (unpackR(b) - unpackR(a)) * t),
    Math.round(unpackG(a) + (unpackG(b) - unpackG(a)) * t),
    Math.round(unpackB(a) + (unpackB(b) - unpackB(a)) * t),
  );
}

export const DRY = packRGB(118, 96, 58);
export const vineBase = (u: number): number => packRGB(Math.round(24 + u * 16), Math.round(88 + u * 30), Math.round(60 + u * 18));
export const vineThorn = (u: number): number => packRGB(Math.round(168 + u * 30), Math.round(184 + u * 24), Math.round(164 + u * 20));
const barkColor = (u: number, k = 1): number => packRGB(Math.round((74 + u * 14) * k), Math.round((58 + u * 12) * k), Math.round((44 + u * 10) * k));
const barkTip = (u: number): number => packRGB(Math.round(142 + u * 16), Math.round(120 + u * 14), Math.round(88 + u * 12));
const mossRgb = (u: number): number => packRGB(Math.round(34 + u * 22), Math.round(92 + u * 44), Math.round(40 + u * 20));
const leafRgb = (u: number): number => packRGB(Math.round(62 + u * 38), Math.round(116 + u * 46), Math.round(52 + u * 28));
const hangVine = (u: number): number => packRGB(Math.round(35 + u * 15), Math.round(150 + u * 25), Math.round(55 + u * 15));

// ---------------------------------------------------------------------------------------------------- reading the grid

export function isOpen(g: Grid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return false;
  const t = g.types[x + y * g.width];
  return t === Cell.Empty || isGas(t);
}

/** A body cannot enter it: rock, wall, wood, metal, packed powder. Soft growth is not hard. */
export function isHard(g: Grid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return false;
  return blocksEntity(g.types[x + y * g.width]);
}

/**
 * Rock a growth can really hold on to: a load-bearing solid (stone, wall, wood, metal, ice, glass, crystal, ore),
 * not loose powder and not soft growth. The sim detaches a Vines cluster, and drops a Leaf, that touches nothing
 * of the kind (entities/VineStrands, sim/elements/flora), so sand, snow and gold are not a surface for it.
 */
export function isAnchor(g: Grid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return false;
  const t = g.types[x + y * g.width];
  return isSolid(t) && !isSoftGrowth(t);
}

/** Open air with something it can hold on to against one of its four sides: a place growth can stand. */
export function isSurface(g: Grid, x: number, y: number): boolean {
  return isOpen(g, x, y) && (isAnchor(g, x, y + 1) || isAnchor(g, x, y - 1) || isAnchor(g, x - 1, y) || isAnchor(g, x + 1, y));
}

// ---------------------------------------------------------------------------------------------------- Rooted Camouflage

const COVER = new Uint8Array(256);
for (const t of [Cell.Moss, Cell.Leaf, Cell.Trunk, Cell.Vines, Cell.Fungus, Cell.Glowshroom]) COVER[t] = 1;

/** Cells of natural cover (Moss, Leaf, Trunk, Vines, Fungus, Glowshroom) in the box about (cx, cy). */
export function coverCells(g: Grid, cx: number, cy: number, rx: number, ry: number): number {
  const x0 = Math.max(0, Math.round(cx) - rx), x1 = Math.min(g.width - 1, Math.round(cx) + rx);
  const y0 = Math.max(0, Math.round(cy) - ry), y1 = Math.min(g.height - 1, Math.round(cy) + ry);
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * g.width;
    for (let x = x0; x <= x1; x++) n += COVER[g.types[row + x]];
  }
  return n;
}

/**
 * The passive's clock: still for `stillTicks` (grounded, |vx| under `stillSpeed`), near cover, and then the
 * concealment climbs linearly 0 -> max over `rampTicks`. A move zeroes everything at once; cover lost while
 * she stays still lets the ramp fall (a leaf burned away should not leave her hidden).
 */
export class Camouflage {
  still = 0;
  ramp = 0;

  /** One tick. `moving`: she is not standing still this tick. `covered`: enough cover within the box. */
  step(moving: boolean, covered: boolean, T = TUNING.camo): number {
    if (moving) {
      this.still = 0;
      this.ramp = 0;
      return 0;
    }
    if (this.still < T.stillTicks) this.still++;
    if (!covered) this.ramp = Math.max(0, this.ramp - T.lostDecay);
    else if (this.still >= T.stillTicks && this.ramp < T.rampTicks) this.ramp++;
    return this.value(T);
  }

  /** 0 .. max. */
  value(T = TUNING.camo): number {
    return T.max * clamp(this.ramp / T.rampTicks, 0, 1);
  }

  /** 0..1 how far the ramp has come (the HUD meter, the leaf motes). */
  progress(T = TUNING.camo): number {
    return clamp(this.ramp / T.rampTicks, 0, 1);
  }

  reset(): void {
    this.still = 0;
    this.ramp = 0;
  }
}

/** True when the fighter is standing still this tick: grounded, slow, and nothing carrying her. */
export function isStill(grounded: boolean, vx: number, busy: boolean, T = TUNING.camo): boolean {
  return grounded && !busy && Math.abs(vx) < T.stillSpeed;
}

// ---------------------------------------------------------------------------------------------------- the surface walker

const DIRS8: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ], [1, -1, SQ], [-1, 1, SQ], [-1, -1, SQ],
];

export interface PathCell { x: number; y: number }

/**
 * The nearest surface to (px, py) within `reach`: open air with something hard against it. Ties go toward the
 * aim, so a fighter at the foot of a wall aiming along the floor starts on the floor.
 */
export function findSurfaceStart(g: Grid, px: number, py: number, aimX: number, aimY: number, reach: number): PathCell | null {
  let best: PathCell | null = null;
  let bestCost = Infinity;
  const bx = Math.round(px), by = Math.round(py);
  for (let dy = -6; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = bx + dx, y = by + dy;
      if (!isSurface(g, x, y)) continue;
      const cost = Math.hypot(dx, dy) - 0.25 * (dx * aimX + dy * aimY);
      if (cost < bestCost) { bestCost = cost; best = { x, y }; }
    }
  }
  return best;
}

/**
 * Walk the surface from (sx, sy) along the unit aim (ax, ay): each step goes to the open neighbour that still
 * has something hard against it and carries furthest along the aim, preferring to keep its heading. A floor,
 * a slope, the foot of a wall (when the aim climbs), a ceiling are one code path. It ends at `range` cells of
 * progress along the aim, at a dead end, or when no neighbour carries forward (the aim runs into a wall it
 * cannot climb). Never revisits a cell, so it always ends.
 */
export function walkSurface(g: Grid, sx: number, sy: number, ax: number, ay: number, range: number, minFwd = 0.2): PathCell[] {
  const path: PathCell[] = [{ x: sx, y: sy }];
  const seen = new Set<number>([sx + sy * g.width]);
  let x = sx, y = sy, hx = ax, hy = ay;
  const maxSteps = Math.ceil(range * 2.5);
  for (let step = 0; step < maxSteps; step++) {
    let bx = 0, by = 0, bs = -Infinity;
    for (const [dx, dy, len] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (seen.has(nx + ny * g.width)) continue;
      if (!isSurface(g, nx, ny)) continue;
      const ux = dx / len, uy = dy / len;
      const fwd = ux * ax + uy * ay;
      if (fwd < minFwd) continue;
      if ((nx - sx) * ax + (ny - sy) * ay > range) continue;
      const score = fwd * 2 + (ux * hx + uy * hy) * 0.6 - (len > 1 ? 0.04 : 0);
      if (score > bs) { bs = score; bx = nx; by = ny; }
    }
    if (bs === -Infinity) break;
    const ux = (bx - x), uy = (by - y);
    const n = Math.hypot(ux, uy) || 1;
    hx = hx * 0.6 + (ux / n) * 0.4;
    hy = hy * 0.6 + (uy / n) * 0.4;
    const hn = Math.hypot(hx, hy) || 1;
    hx /= hn; hy /= hn;
    x = bx; y = by;
    seen.add(x + y * g.width);
    path.push({ x, y });
  }
  return path;
}

/** The unit normal of the surface at (x, y): away from the rock that touches it (0,0 in a one-cell slot). */
export function surfaceNormal(g: Grid, x: number, y: number): { x: number; y: number } {
  let nx = 0, ny = 0;
  if (isAnchor(g, x, y + 1)) ny -= 1;
  if (isAnchor(g, x, y - 1)) ny += 1;
  if (isAnchor(g, x + 1, y)) nx -= 1;
  if (isAnchor(g, x - 1, y)) nx += 1;
  const n = Math.hypot(nx, ny);
  return n === 0 ? { x: 0, y: 0 } : { x: nx / n, y: ny / n };
}

// ---------------------------------------------------------------------------------------------------- Ironvine

export interface VineCell {
  x: number;
  y: number;
  /** Index along the walked path, and how far out from the surface (0 = on it). */
  k: number;
  depth: number;
  thorn: boolean;
  /** Ticks after the cast it appears, and 0..1 where it sits in the wither order (0 first). */
  at: number;
  order: number;
  color: number;
}

export interface VinePlan {
  path: PathCell[];
  cells: VineCell[];
}

/**
 * Plan an Ironvine cast from the fighter's feet (fx, fy) along the aim. `skip(x, y)` names cells that hold a
 * body (hers, a foe's, a crate): no vine is laid there, and none above a column whose base was skipped. Returns
 * a reason string when it cannot be cast: no surface in reach, or too short a run to be worth it.
 */
export function planIronvine(g: Grid, fx: number, fy: number, aimX: number, aimY: number, rand: Rand, skip: SkipFn, T = TUNING.vine): VinePlan | string {
  const n = Math.hypot(aimX, aimY) || 1;
  const ax = aimX / n, ay = aimY / n;
  const start = findSurfaceStart(g, fx, fy, ax, ay, T.startReach);
  if (!start) return 'NOTHING TO GROW ON';
  const path = walkSurface(g, start.x, start.y, ax, ay, T.range);
  if (path.length < T.minPath) return 'NO ROOM TO GROW';
  const cells: VineCell[] = [];
  const seen = new Set<number>();
  const last = Math.max(1, path.length - 1);
  for (let k = 0; k < path.length; k++) {
    const { x, y } = path[k];
    if (skip(x, y) || !isOpen(g, x, y)) continue; // the column's base must stand, or nothing above it does
    const norm = surfaceNormal(g, x, y);
    const depth = rand() < 0.5 ? T.depthMin : T.depthMax;
    const order = clamp((1 - k / last) * 0.85 + rand() * 0.15, 0, 0.999);
    for (let j = 0; j < depth; j++) {
      const px = j === 0 ? x : x + Math.round(norm.x * j);
      const py = j === 0 ? y : y + Math.round(norm.y * j);
      if (j > 0 && (px === x && py === y)) break; // a one-cell slot has no outward
      if (!isOpen(g, px, py) || skip(px, py)) break;
      const key = px + py * g.width;
      if (seen.has(key)) continue;
      seen.add(key);
      const thorn = j === depth - 1 && j > 0 && rand() < 0.5;
      const u = rand();
      cells.push({ x: px, y: py, k, depth: j, thorn, at: Math.floor(k / T.speed) + j, order, color: thorn ? vineThorn(u) : vineBase(u) });
    }
  }
  if (cells.length < T.minCells) return 'NO ROOM TO GROW';
  cells.sort((a, b) => a.at - b.at);
  return { path, cells };
}

// ---------------------------------------------------------------------------------------------------- wither

/** The frame a cell crumbles: the base lifetime plus its place in the wither order. */
export function witherDie(born: number, base: number, spread: number, order: number): number {
  return born + base + Math.floor(spread * clamp(order, 0, 1));
}

/** 0 healthy, 1 browning, 2 dry, 3 crumbled. */
export function witherStage(now: number, die: number, fade: number): 0 | 1 | 2 | 3 {
  if (now >= die) return 3;
  if (now >= die - fade * 0.5) return 2;
  if (now >= die - fade) return 1;
  return 0;
}

export const STAGE_DRY = [0, 0.5, 0.92] as const;

// ---------------------------------------------------------------------------------------------------- Overgrowth

export interface GrowCell {
  x: number;
  y: number;
  cell: number;
  life: number;
  color: number;
  /** Ticks after the cast it appears. */
  at: number;
  /** 0..1, where it sits in the wither order (0 first: tips first). */
  order: number;
  /** A climbable root cell (the fighter's hand-holds). */
  root: boolean;
}

/** True when a Trunk stand of these cells touches anchored rock somewhere: the felling rule (game/Flora.floodStand). */
function touchesAnchor(g: World, cells: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [x, y] of cells) {
    if (holdsUp(g, x, y - 1, false) || holdsUp(g, x - 1, y, false) || holdsUp(g, x + 1, y, false) || holdsUp(g, x, y + 1, true)) return true;
  }
  return false;
}

/** Split `cells` into 8-connected groups. */
function components(cells: ReadonlyArray<readonly [number, number]>): Array<Array<readonly [number, number]>> {
  const at = new Map<number, number>();
  cells.forEach(([x, y], i) => at.set(x * 100003 + y, i));
  const seen = new Uint8Array(cells.length);
  const out: Array<Array<readonly [number, number]>> = [];
  for (let i = 0; i < cells.length; i++) {
    if (seen[i]) continue;
    const comp: Array<readonly [number, number]> = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      const [x, y] = cells[c];
      comp.push(cells[c]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = at.get((x + dx) * 100003 + (y + dy));
          if (j !== undefined && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/**
 * Make every Trunk stand held at every moment: while it grows and while it withers.
 *
 * The flora fells a Trunk stand with no contact with anchored rock into a solid log. Roots that overlap, or a limb that
 * crosses another root, can appear (or go) in an order that leaves a fragment cut off for a tick. So, once the whole
 * plan is known:
 *  - a root cell may only appear once a neighbour that is itself held has appeared: `at` becomes the smallest
 *    bottleneck over the paths to a cell that touches the rock (a least fixed point, so nothing is delayed needlessly);
 *  - and it must go before it loses its last way back to the rock: `order` becomes the widest bottleneck over the same
 *    paths (a cell never outlives the path that holds it).
 * Equal times happen in one call (a whole tick's cells are written, or cleared, together), so a tick is the unit.
 */
export function settleSupport(g: World, trunk: GrowCell[]): void {
  const n = trunk.length;
  if (n === 0) return;
  const at = new Map<number, number>();
  trunk.forEach((c, i) => at.set(c.x * 100003 + c.y, i));
  const nbr: number[][] = trunk.map((c) => {
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const j = at.get((c.x + dx) * 100003 + (c.y + dy));
      if (j !== undefined) out.push(j);
    }
    return out;
  });
  const held = trunk.map((c) => touchesAnchor(g, [[c.x, c.y]]));
  // appearance: least fixed point of t(c) = max(at(c), min over neighbours t), held cells standing on their own
  const t = trunk.map((c, i) => (held[i] ? c.at : Infinity));
  for (let changed = true, guard = 0; changed && guard < n + 2; guard++) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (held[i]) continue;
      let best = Infinity;
      for (const j of nbr[i]) if (t[j] < best) best = t[j];
      const v = Math.max(trunk[i].at, best);
      if (v < t[i]) { t[i] = v; changed = true; }
    }
  }
  // withering: greatest fixed point of L(c) = min(order(c), max over neighbours L), held cells standing on their own
  const L = trunk.map((c, i) => (held[i] ? c.order : -Infinity));
  for (let changed = true, guard = 0; changed && guard < n + 2; guard++) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (held[i]) continue;
      let best = -Infinity;
      for (const j of nbr[i]) if (L[j] > best) best = L[j];
      const v = Math.min(trunk[i].order, best);
      if (v > L[i]) { L[i] = v; changed = true; }
    }
  }
  trunk.forEach((c, i) => {
    if (Number.isFinite(t[i])) c.at = t[i];
    if (Number.isFinite(L[i])) c.order = L[i];
  });
}

/**
 * Plan the Overgrowth around (cx, cy): roots hung from ceilings and clinging up walls (Trunk), hanging Vines,
 * Moss and Leaf over the floors and walls, each cell timed so the growth sweeps outward and roots lengthen
 * downward. `skip` names cells that hold a body. Cells are in order of appearance.
 *
 * Fail-open by construction: every cell is soft growth written into open air, so no route can be sealed; roots
 * whose Trunk stand would touch no anchored rock (the flora would fell them into solid Wood) are dropped.
 */
export function planOvergrowth(g: World, cx: number, cy: number, rand: Rand, skip: SkipFn, T = TUNING.over): GrowCell[] {
  const R = T.radius, R2 = R * R, W = g.width;
  const out = new Map<number, GrowCell>();
  const wave = (x: number, y: number): number => Math.round(T.growTicks * Math.min(1, Math.hypot(x - cx, y - cy) / R));
  const put = (x: number, y: number, cell: number, life: number, color: number, at: number, order: number, root = false): boolean => {
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > R2 || !isOpen(g, x, y) || skip(x, y)) return false;
    const k = x + y * W;
    if (out.has(k)) return false;
    out.set(k, { x, y, cell, life, color, at, order, root });
    return true;
  };

  // ---- survey: the open cells that touch something hard, by which side
  const floors: number[] = [], ceils: number[] = [], walls: number[] = [];
  const x0 = Math.max(3, Math.floor(cx - R)), x1 = Math.min(g.width - 4, Math.ceil(cx + R));
  const y0 = Math.max(3, Math.floor(cy - R)), y1 = Math.min(g.height - 4, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > R2 || !isOpen(g, x, y)) continue;
      if (isAnchor(g, x, y + 1)) floors.push(x, y);
      else if (isAnchor(g, x, y - 1)) ceils.push(x, y);
      else if (isAnchor(g, x - 1, y) || isAnchor(g, x + 1, y)) walls.push(x, y);
    }
  }
  const pick = (list: number[]): [number, number] | null => {
    if (list.length === 0) return null;
    const i = Math.floor(rand() * (list.length / 2)) * 2;
    return [list[i], list[i + 1]];
  };

  // ---- roots hung from ceilings (Trunk): a tapering, swaying column with a few side limbs
  const anchors: Array<[number, number]> = [];
  const farFrom = (x: number, y: number, dx: number, dy: number): boolean => anchors.every(([ax, ay]) => Math.abs(ax - x) >= dx || Math.abs(ay - y) >= dy);
  let roots = 0;
  for (let tries = 0; tries < T.roots.tries && roots < T.roots.max; tries++) {
    const site = pick(ceils);
    if (!site) break;
    const [x, y] = site;
    if (!farFrom(x, y, T.roots.spacingX, T.roots.spacingY)) continue;
    if (!holdsUp(g, x, y - 1, false)) continue; // hung from something that really holds
    let free = 0;
    while (free < T.roots.reachMax + T.roots.gapMax + 1 && isOpen(g, x, y + free)) free++;
    const gap = T.roots.gapMin + Math.floor(rand() * (T.roots.gapMax - T.roots.gapMin + 1));
    const reaches = rand() < T.roots.reach;
    let len = reaches ? Math.min(free - gap, T.roots.reachMax) : Math.min(T.roots.lenMin + Math.floor(rand() * (T.roots.lenMax - T.roots.lenMin + 1)), free - gap);
    // the tip stays inside the zone (a root cut off by its edge would look chopped)
    while (len >= 8 && (x - cx) * (x - cx) + (y + len + 3 - cy) * (y + len + 3 - cy) > R2) len--;
    if (len < 8) continue;
    const base = wave(x, y), phase = rand() * 6.28;
    // One jitter for the whole root, so that down it the wither order only falls: the tip goes first, and the stand is
    // never left with a lower part cut off from the ceiling (the flora would fell it into a solid log).
    const rootJitter = rand() * 0.1;
    const mine: Array<[number, number]> = [];
    const keys: number[] = [];
    const lay = (px: number, py: number, color: number, at: number, order: number): void => {
      if (put(px, py, Cell.Trunk, -1, color, at, order, true)) { mine.push([px, py]); keys.push(px + py * W); }
    };
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const sway = Math.round(Math.sin(i * 0.11 + phase) * (1 + t * 2) * Math.min(1, i / 4));
      const width = t < 0.3 ? 3 : t < 0.7 ? 2 : 1;
      const at = base + Math.floor(i * 0.6);
      const order = clamp((1 - t) * 0.9 + rootJitter, 0, 0.999);
      for (let k = 0; k < width; k++) {
        lay(x + sway + k - (width >> 1), y + i, t > 0.9 ? barkTip(rand()) : barkColor(rand(), k === 0 ? 0.82 : 1), at, order);
      }
      if (i > 6 && i % 9 === 0 && rand() < 0.7) {
        const side = rand() < 0.5 ? -1 : 1;
        let lx = x + sway + side, ly = y + i;
        const ang = Math.PI / 2 + side * (0.6 + rand() * 0.4);
        const limb = 3 + Math.floor(rand() * 6);
        for (let s = 0; s < limb; s++) {
          lay(Math.round(lx), Math.round(ly), barkColor(rand()), at + s, clamp(order * 0.8, 0, 0.999));
          lx += Math.cos(ang + s * side * 0.06) * 1.05;
          ly += Math.sin(ang + s * side * 0.06) * 1.05;
        }
      }
    }
    // A stand that touches no anchored rock would be felled: drop what is not held.
    for (const comp of components(mine)) {
      if (touchesAnchor(g, comp)) continue;
      for (const [px, py] of comp) out.delete(px + py * W);
    }
    if (mine.length > 0 && keys.some((k) => out.has(k))) { roots++; anchors.push([x, y]); }
  }

  // ---- roots clinging up walls (Trunk): walked along the face, two (sometimes three) cells thick
  let wallRoots = 0;
  const wallAnchors: Array<[number, number]> = [];
  for (let tries = 0; tries < T.wallRoots.tries && wallRoots < T.wallRoots.max; tries++) {
    const site = pick(walls);
    if (!site) break;
    const [x, y] = site;
    if (wallAnchors.some(([ax, ay]) => Math.abs(ax - x) < T.wallRoots.spacing && Math.abs(ay - y) < 24)) continue;
    const len = T.wallRoots.lenMin + Math.floor(rand() * (T.wallRoots.lenMax - T.wallRoots.lenMin + 1));
    const up = walkSurface(g, x, y, 0, -1, Math.ceil(len * 0.65));
    const down = walkSurface(g, x, y, 0, 1, Math.ceil(len * 0.35));
    const path = [...down.slice(1).reverse(), ...up]; // bottom to top
    if (path.length < 8) continue;
    const base = wave(x, y);
    const mine: Array<[number, number]> = [];
    const keys: number[] = [];
    path.forEach(({ x: px, y: py }, k) => {
      const norm = surfaceNormal(g, px, py);
      const t = k / Math.max(1, path.length - 1);
      const order = clamp((1 - t) * 0.9 + rand() * 0.1, 0, 0.999);
      const thick = rand() < 0.3 ? 3 : 2;
      for (let j = 0; j < thick; j++) {
        const qx = j === 0 ? px : px + Math.round(norm.x * j), qy = j === 0 ? py : py + Math.round(norm.y * j);
        if (j > 0 && qx === px && qy === py) break;
        const color = t > 0.92 ? barkTip(rand()) : barkColor(rand(), j === 0 ? 0.82 : 1);
        if (put(qx, qy, Cell.Trunk, -1, color, base + Math.floor(k * 0.6), order, true)) { mine.push([qx, qy]); keys.push(qx + qy * W); }
      }
    });
    for (const comp of components(mine)) {
      if (touchesAnchor(g, comp)) continue;
      for (const [px, py] of comp) out.delete(px + py * W);
    }
    if (keys.some((k) => out.has(k))) { wallRoots++; wallAnchors.push([x, y]); }
  }

  // ---- hanging Vines from ceilings
  const hung: number[] = [];
  let vines = 0;
  for (let tries = 0; tries < T.vines.tries && vines < T.vines.max; tries++) {
    const site = pick(ceils);
    if (!site) break;
    const [x, y] = site;
    if (hung.some((hx) => Math.abs(hx - x) < T.vines.spacingX)) continue;
    if (!isAnchor(g, x, y - 1)) continue;
    const len = T.vines.lenMin + Math.floor(rand() * (T.vines.lenMax - T.vines.lenMin + 1));
    const wide = rand() < 0.25;
    const base = wave(x, y);
    const jitter = rand() * 0.1; // one per vine, so that down a vine the order only falls: its tip goes first and nothing is cut above a loose end
    let wrote = 0;
    for (let i = 0; i < len; i++) {
      const order = clamp((1 - i / len) * 0.9 + jitter, 0, 0.999);
      // The whole vine appears in one tick: the sim lifts a hanging cluster of 4+ cells into a swaying strand (VineStrands)
      // and a cell added under a lifted one has nothing above it and would be dropped as a loose end of its own.
      const at = base;
      if (!put(x, y + i, Cell.Vines, -1, hangVine(rand()), at, order)) break;
      wrote++;
      if (wide && i < len - 3) put(x + 1, y + i, Cell.Vines, -1, hangVine(rand()), at, order);
    }
    if (wrote > 0) { vines++; hung.push(x); }
  }

  // ---- ground cover: Moss and Leaf over the floors and walls, in patches; a little Moss under ceilings
  const cover = (list: number[], density: number, leafOk: boolean): void => {
    for (let i = 0; i < list.length; i += 2) {
      const x = list[i], y = list[i + 1];
      const p = density * (0.35 + 1.15 * vnoise(x * 0.09, y * 0.09));
      if (rand() >= p) continue;
      const at = wave(x, y) + Math.floor(rand() * 6);
      const order = rand();
      if (leafOk && rand() >= T.mossShare) {
        if (put(x, y, Cell.Leaf, leafAttachedLife(0), leafRgb(rand()), at, order) && hash2(x, y) < T.leafStack) {
          // a fern: a leaf or two stacked on the one that rests on the ground (each held by the one under it)
          const h = 1 + (hash2(y, x) < 0.4 ? 1 : 0);
          for (let s = 1; s <= h; s++) {
            if (!put(x, y - s, Cell.Leaf, leafAttachedLife(s), leafRgb(rand()), at + s * 2, order)) break;
          }
        }
      } else put(x, y, Cell.Moss, -1, mossRgb(rand()), at, order);
    }
  };
  cover(floors, T.floorCover, true);
  cover(walls, T.wallCover, true);
  cover(ceils, T.ceilCover, false);

  settleSupport(g, [...out.values()].filter((c) => c.cell === Cell.Trunk));

  const cells = [...out.values()];
  if (cells.length > T.maxCells) {
    // Over budget: the cover goes first (roots and vines are the point of it).
    const keep = cells.filter((c) => c.root || c.cell === Cell.Vines);
    const soft = cells.filter((c) => !c.root && c.cell !== Cell.Vines);
    return [...keep, ...soft.slice(0, Math.max(0, T.maxCells - keep.length))].sort((a, b) => a.at - b.at);
  }
  return cells.sort((a, b) => a.at - b.at);
}
