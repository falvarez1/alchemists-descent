import type { Rng } from '@/core/rng';
import { blocksEntity, Cell, isGas, isLiquid } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { anchoredSupport, LEAF_LITTER, LEAF_REACH, leafAnchor, leafAttachedLife, SEED_GLOW_HELD, SEED_THIRSTY_HELD } from '@/sim/elements/flora';
import type { World } from '@/sim/World';

/* ============================================================
 * THE FLORA KIT — per-floor plants, grown as real cells.
 *
 * Every plant here is material the simulation owns: trunks, stems, fronds,
 * caps and roots are Cell.Trunk (living wood: walk-past, smoulders, fells);
 * foliage is Cell.Leaf (holds on within reach of wood, burns fast, floats);
 * pods are held Cell.Seed. Palettes are restrained on purpose — wet slate,
 * chalk and worn copper on the Bellows, bruised umber in the Rot Gardens,
 * drowned olive in the Cisterns, char and ember in the Kiln.
 *
 * Species:
 *   floor 1  birch (pale cave-birch), treefern (glowseed pods), fernbed, sapling
 *   floor 2  mushroom (stem + cap), rootcolumn, hangingroot, fernbed, sapling
 *   floor 3  mangrove (prop-root arches), reeds, kelp, lilypad
 *   floor 4  emberbark (charred, ember-fissured), firelily
 *   any      grasstuft (tall leaf-blade grass)
 * ============================================================ */

export type FloraSpecies =
  | 'birch' | 'treefern' | 'sapling' | 'fernbed' | 'grasstuft'
  | 'mushroom' | 'rootcolumn' | 'hangingroot'
  | 'mangrove' | 'reeds' | 'kelp' | 'lilypad'
  | 'emberbark' | 'firelily';

export type FloraFloor = 'bellows' | 'rot' | 'cistern' | 'kiln';

export const FLORA_SPECIES: readonly FloraSpecies[] = [
  'birch', 'treefern', 'sapling', 'fernbed', 'grasstuft', 'mushroom', 'rootcolumn', 'hangingroot',
  'mangrove', 'reeds', 'kelp', 'lilypad', 'emberbark', 'firelily',
];

export interface PlantOptions {
  /** Override the species' natural height. */
  height?: number;
  /** Pods hung in the crown (held Seed). */
  pods?: 'glow' | 'thirsty' | null;
  /** Floor palette for the shared species (sapling, fernbed, grasstuft). */
  floor?: FloraFloor;
  /** Ceiling row for floor-to-ceiling species (rootcolumn). */
  ceilY?: number;
  /** Lean of the trunk (cells of x per cell of height, ±). */
  lean?: number;
}

export interface PlantResult {
  species: FloraSpecies;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  trunk: number;
  leaves: number;
  seeds: number;
  /** The trunk foot (where a cut fells it), for puzzles. */
  footX: number;
  footY: number;
  /** Top of the trunk. */
  topY: number;
  /** The felling line: cut clean through the wood at this row and everything
   *  above it comes down (above a mangrove's prop roots, a flare's root). */
  cutY: number;
}

type RGB = readonly [number, number, number];

function mix(a: RGB, b: RGB, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return packRGB(Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k));
}

function jitter(c: RGB, rng: Rng, amt: number, mul = 1): number {
  const j = (rng.next() - 0.5) * 2 * amt;
  return packRGB(
    Math.max(0, Math.min(255, Math.round((c[0] + j) * mul))),
    Math.max(0, Math.min(255, Math.round((c[1] + j) * mul))),
    Math.max(0, Math.min(255, Math.round((c[2] + j * 0.8) * mul))),
  );
}

/** Cells a plant may grow into at generation: air and ground cover. */
function openForGrowth(t: number): boolean {
  return t === Cell.Empty || isGas(t) || t === Cell.Grass || t === Cell.Moss || t === Cell.Ash;
}

/**
 * The planting context: writes only into open cells, remembers what it wrote,
 * settles leaf attachment (BFS distance to wood/rock) at the end so a crown
 * starts life correctly held on — and drops any leaf that could not be.
 */
class Planter {
  trunk = 0;
  /** Every living-wood cell written (for the support audit). */
  readonly woodCells: number[] = [];
  /** Every leaf and seed written (cleared with an unsupported stand). */
  readonly softCells: number[] = [];
  /** Leaves still to settle (placed fresh, life 0). */
  leaves: number[] = [];
  /** Every leaf written (fresh or pre-settled). */
  leafCount = 0;
  seeds = 0;
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  constructor(readonly world: World, readonly rng: Rng, readonly allowWater = false) {
    this.salt = Math.floor(rng.next() * 0x7fffffff);
  }

  private can(x: number, y: number, over = false): number {
    const w = this.world;
    if (x < 2 || y < 2 || x >= w.width - 2 || y >= w.height - 8) return -1;
    const i = w.idx(x, y);
    const t = w.types[i];
    if (openForGrowth(t) || (this.allowWater && t === Cell.Water) || (over && t === Cell.Leaf)) return i;
    return -1;
  }

  private note(x: number, y: number): void {
    if (x < this.x0) this.x0 = x; if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y; if (y > this.y1) this.y1 = y;
  }

  wood(x: number, y: number, color: number): boolean {
    x = Math.round(x); y = Math.round(y);
    const i = this.can(x, y, true);
    if (i < 0) return false;
    this.world.replaceCellAt(i, Cell.Trunk, color);
    this.world.life[i] = -1;
    this.trunk++;
    this.woodCells.push(i);
    this.note(x, y);
    return true;
  }

  leaf(x: number, y: number, color: number, life = 0): boolean {
    x = Math.round(x); y = Math.round(y);
    const i = this.can(x, y);
    if (i < 0) return false;
    this.world.replaceCellAt(i, Cell.Leaf, color);
    this.world.life[i] = life;
    this.leafCount++;
    this.softCells.push(i);
    if (life === 0) this.leaves.push(i);
    this.note(x, y);
    return true;
  }

  seed(x: number, y: number, color: number, life: number): boolean {
    x = Math.round(x); y = Math.round(y);
    const i = this.can(x, y);
    if (i < 0) return false;
    this.world.replaceCellAt(i, Cell.Seed, color);
    this.world.life[i] = life;
    this.seeds++;
    this.softCells.push(i);
    this.note(x, y);
    return true;
  }

  /** Per-plant salt for the coherent leaf noise. */
  readonly salt: number;

  /**
   * A leaf mass: an ellipse whose edge is broken by coherent noise into clumps
   * and gaps (never per-cell static), lit from above — a pale sunlit crown,
   * mid-tone body, a dark underside, and a few bright flecks on the top edge.
   */
  blob(cx: number, cy: number, rx: number, ry: number, density: number, light: RGB, dark: RGB, deep?: RGB): void {
    const rng = this.rng;
    const salt = this.salt + Math.floor(rng.next() * 997);
    const shadow = deep ?? [Math.round(dark[0] * 0.72), Math.round(dark[1] * 0.72), Math.round(dark[2] * 0.76)] as RGB;
    for (let dy = -ry - 1; dy <= ry + 1; dy++) {
      for (let dx = -rx - 1; dx <= rx + 1; dx++) {
        const x = cx + dx, y = cy + dy;
        const d = (dx * dx) / (rx * rx + 0.01) + (dy * dy) / (ry * ry + 0.01);
        // clumped edge: coarse noise pushes the outline in and out
        const n = valueNoise(x, y, 3, salt);
        const fine = valueNoise(x, y, 1.6, salt + 31);
        if (d > 0.72 + n * 0.5) continue;
        if (fine > density + (1 - d) * 0.35) continue; // gaps, more of them near the rim
        const k = (dy + ry) / (2 * ry + 0.01);
        const lit = 0.5 - (dx / (rx + 1)) * 0.25 - (dy / (ry + 1)) * 0.75; // upper-left catches the light
        let c: number;
        if (lit > 0.62 && n > 0.45) c = mix(light, [Math.min(255, light[0] + 36), Math.min(255, light[1] + 30), Math.min(255, light[2] + 18)], rng.next() * 0.6);
        else if (k > 0.72 || lit < 0.05) c = mix(dark, shadow, 0.3 + rng.next() * 0.5);
        else c = mix(light, dark, 0.35 + k * 0.5 + (n - 0.5) * 0.3);
        this.leaf(x, y, c);
      }
    }
  }

  /** Leaves hold on only within LEAF_REACH of wood or rock: BFS the distances.
   *  Returns how many had nothing to hold (they are not grown). */
  settleLeaves(): number {
    const w = this.world;
    const dist = new Map<number, number>();
    const queue: number[] = [];
    for (const i of this.leaves) {
      if (w.types[i] !== Cell.Leaf) continue;
      const y = (i / w.width) | 0, x = i - y * w.width;
      let anchored = false;
      for (let dy = -1; dy <= 1 && !anchored; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && w.inBounds(x + dx, y + dy) && leafAnchor(w.types[w.idx(x + dx, y + dy)])) { anchored = true; break; }
      }
      if (anchored) { dist.set(i, 0); queue.push(i); }
    }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h], d = dist.get(i) ?? 0;
      if (d >= LEAF_REACH) continue;
      const y = (i / w.width) | 0, x = i - y * w.width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!(dx || dy) || !w.inBounds(x + dx, y + dy)) continue;
        const ni = w.idx(x + dx, y + dy);
        if (w.types[ni] !== Cell.Leaf || dist.has(ni) || w.life[ni] !== 0) continue;
        dist.set(ni, d + 1);
        queue.push(ni);
      }
    }
    let dropped = 0;
    for (const i of this.leaves) {
      if (w.types[i] !== Cell.Leaf) continue;
      const d = dist.get(i);
      if (d === undefined) { w.clearCellAt(i); dropped++; }
      else w.life[i] = leafAttachedLife(d);
    }
    return dropped;
  }

  /**
   * Every piece of living wood must be ONE stand with the foot: a twig that
   * missed its trunk by a rounding step would be felled the moment the sim saw
   * it. Stray pieces are joined to the nearest reached wood (a short graft
   * through open air), or pruned when nothing is near.
   */
  joinWood(): void {
    const w = this.world;
    if (this.x1 < this.x0) return;
    const x0 = Math.max(1, this.x0 - 2), y0 = Math.max(1, this.y0 - 2), x1 = Math.min(w.width - 2, this.x1 + 2), y1 = Math.min(w.height - 2, this.y1 + 2);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const comp = new Int32Array(bw * bh).fill(-1);
    const at = (x: number, y: number): number => (x - x0) + (y - y0) * bw;
    const wood = (x: number, y: number): boolean => x >= x0 && y >= y0 && x <= x1 && y <= y1 && w.types[w.idx(x, y)] === Cell.Trunk;
    // Label every piece of wood (8-connected); the largest piece is the stand.
    const pieces: Array<Array<[number, number]>> = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!wood(x, y) || comp[at(x, y)] >= 0) continue;
      const id = pieces.length;
      const cells: Array<[number, number]> = [[x, y]];
      comp[at(x, y)] = id;
      for (let h = 0; h < cells.length; h++) {
        const [cx, cy] = cells[h];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (!wood(nx, ny) || comp[at(nx, ny)] >= 0) continue;
          comp[at(nx, ny)] = id;
          cells.push([nx, ny]);
        }
      }
      pieces.push(cells);
    }
    if (pieces.length <= 1) return;
    let main = 0;
    for (let k = 1; k < pieces.length; k++) if (pieces[k].length > pieces[main].length) main = k;
    // Graft each smaller piece onto the stand (a short line through open air)
    // or, with nothing within reach, prune it.
    for (let k = 0; k < pieces.length; k++) {
      if (k === main) continue;
      let best = Infinity, fx = 0, fy = 0, tx = 0, ty = 0;
      for (const [px, py] of pieces[k]) {
        for (let y = Math.max(y0, py - 4); y <= Math.min(y1, py + 4); y++) for (let x = Math.max(x0, px - 4); x <= Math.min(x1, px + 4); x++) {
          if (comp[at(x, y)] !== main) continue;
          const d = Math.hypot(x - px, y - py);
          if (d < best) { best = d; fx = px; fy = py; tx = x; ty = y; }
        }
      }
      if (best < Infinity) {
        const n = Math.ceil(best), c = w.colors[w.idx(fx, fy)];
        for (let s2 = 1; s2 < n; s2++) this.wood(fx + ((tx - fx) * s2) / n, fy + ((ty - fy) * s2) / n, c);
        for (const [px, py] of pieces[k]) comp[at(px, py)] = main;
      } else {
        for (const [px, py] of pieces[k]) { w.clearCellAt(w.idx(px, py)); this.trunk--; }
      }
    }
  }

  /**
   * The support audit: every separate stand of wood this plant grew must touch
   * anchored ground, or the simulation would fell it the moment it looked (a
   * reed stem that missed its own bed, a kelp frond over a hole). Unsupported
   * stands are not grown; their leaves and pods go with them.
   */
  pruneUnsupported(): void {
    const w = this.world, W = w.width;
    const seen = new Set<number>();
    let pruned = false;
    for (const start of this.woodCells) {
      if (seen.has(start) || w.types[start] !== Cell.Trunk) continue;
      const comp = [start];
      seen.add(start);
      let supported = false;
      for (let h = 0; h < comp.length; h++) {
        const i = comp[h], y = (i / W) | 0, x = i - y * W;
        if (!supported) for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) if (anchoredSupport(w, x + dx, y + dy)) { supported = true; break; }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const ni = i + dx + dy * W;
          if (seen.has(ni) || w.types[ni] !== Cell.Trunk) continue;
          seen.add(ni);
          comp.push(ni);
        }
      }
      if (supported) continue;
      for (const i of comp) { w.clearCellAt(i); this.trunk--; }
      pruned = true;
    }
    if (!pruned) return;
    // leaves and pods left holding nothing are dropped with it (settleLeaves
    // handles fresh leaves; pre-settled pads and pods are checked here)
    for (const i of this.softCells) {
      const t = w.types[i];
      if (t !== Cell.Seed) continue;
      const y = (i / W) | 0, x = i - y * W;
      let held = false;
      for (let dy = -1; dy <= 1 && !held; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nt = w.types[w.idx(x + dx, y + dy)];
        if (nt === Cell.Trunk || nt === Cell.Leaf) { held = true; break; }
      }
      if (!held) { w.clearCellAt(i); this.seeds--; }
    }
  }

  result(species: FloraSpecies, footX: number, footY: number, topY: number, cutY = footY - 3): PlantResult | null {
    if (species !== 'reeds' && species !== 'firelily' && species !== 'rootcolumn') this.joinWood();
    this.pruneUnsupported();
    const dropped = this.settleLeaves();
    const leaves = this.leafCount - dropped;
    if (this.trunk === 0 && leaves <= 0) return null;
    return {
      species, x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1, trunk: this.trunk,
      leaves, seeds: this.seeds, footX, footY, topY, cutY,
    };
  }
}

/** Deterministic bilinear value noise in [0, 1) on a `scale`-cell lattice. */
export function valueNoise(x: number, y: number, scale: number, salt: number): number {
  const fx = x / scale, fy = y / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash01(ix, iy, salt), b = hash01(ix + 1, iy, salt), c = hash01(ix, iy + 1, salt), d = hash01(ix + 1, iy + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function hash01(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* --------------------------------- palettes --------------------------------- */

const BIRCH_BARK: RGB = [190, 186, 170];
const BIRCH_MARK: RGB = [58, 54, 52];
const BIRCH_LEAF_LIGHT: RGB = [158, 176, 104];
const BIRCH_LEAF_DARK: RGB = [70, 98, 66];
const BIRCH_LEAF_DEEP: RGB = [40, 62, 50];
const FERN_TRUNK: RGB = [78, 58, 42];
const FERN_RACHIS: RGB = [74, 88, 50];
const FERN_LIGHT: RGB = [104, 150, 78];
const FERN_DARK: RGB = [50, 92, 58];
const GLOWSEED: RGB = [206, 240, 140];
const THIRSTY: RGB = [178, 128, 56];

const FLOOR_LEAF: Record<FloraFloor, { light: RGB; dark: RGB; bark: RGB }> = {
  bellows: { light: [128, 156, 96], dark: [60, 92, 66], bark: [150, 138, 116] },
  rot: { light: [150, 142, 84], dark: [78, 84, 52], bark: [106, 80, 60] },
  cistern: { light: [96, 138, 90], dark: [44, 82, 62], bark: [88, 78, 58] },
  kiln: { light: [150, 84, 52], dark: [84, 44, 34], bark: [48, 38, 34] },
};

/* --------------------------------- helpers --------------------------------- */

/** The foot row of a standing plant: first open cell above solid ground at x. */
export function groundAt(world: World, x: number, fromY: number, maxY: number): number {
  for (let y = Math.max(2, fromY); y < Math.min(world.height - 8, maxY); y++) {
    if (openForGrowth(world.types[world.idx(x, y)]) && blocksEntity(world.types[world.idx(x, y + 1)])) return y;
  }
  return -1;
}

function podCluster(p: Planter, x: number, y: number, kind: 'glow' | 'thirsty'): void {
  const color = kind === 'glow' ? GLOWSEED : THIRSTY;
  const life = kind === 'glow' ? SEED_GLOW_HELD : SEED_THIRSTY_HELD;
  // A pod: a hanging teardrop of three to five seeds.
  p.seed(x, y, jitter(color, p.rng, 10), life);
  p.seed(x + 1, y, jitter(color, p.rng, 10), life);
  p.seed(x, y + 1, jitter(color, p.rng, 10, 0.92), life);
  if (p.rng.next() < 0.7) p.seed(x + 1, y + 1, jitter(color, p.rng, 10, 0.9), life);
  if (p.rng.next() < 0.5) p.seed(x, y + 2, jitter(color, p.rng, 10, 0.85), life);
}

/** Hang pods under the lowest leaves of a crown box. */
function hangPods(p: Planter, x0: number, x1: number, yTop: number, yBot: number, kind: 'glow' | 'thirsty', count: number): void {
  const w = p.world;
  for (let n = 0, tries = 0; n < count && tries < 60; tries++) {
    const x = x0 + Math.floor(p.rng.next() * Math.max(1, x1 - x0));
    for (let y = yBot; y >= yTop; y--) {
      if (!w.inBounds(x, y + 1)) break;
      const t = w.types[w.idx(x, y)];
      if ((t === Cell.Leaf || t === Cell.Trunk) && w.types[w.idx(x, y + 1)] === Cell.Empty && w.types[w.idx(x + 1, y + 1)] === Cell.Empty) {
        podCluster(p, x, y + 1, kind);
        n++;
        break;
      }
    }
  }
}

/** A 1-cell woody line (branch, rachis, root) from (x, y) along a heading that curls. */
function limb(p: Planter, x: number, y: number, heading: number, length: number, curl: number, color: (t: number) => number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let px = x, py = y, a = heading;
  for (let s = 0; s < length; s++) {
    px += Math.cos(a); py += Math.sin(a);
    a += curl;
    p.wood(px, py, color(s / length));
    pts.push([px, py]);
  }
  return pts;
}

/* --------------------------------- species --------------------------------- */

function birch(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const H = o.height ?? 50 + rng.int(22);
  const w = H >= 56 ? 4 : 3;
  const phase = rng.next() * 6.28, amp = 0.8 + rng.next() * 1.6, lean = o.lean ?? (rng.next() - 0.5) * 0.08;
  const spine: Array<[number, number]> = [];
  for (let i = 0; i < H; i++) {
    const t = i / H;
    const cx = x + Math.round(Math.sin(t * 2.4 + phase) * amp * t + lean * i);
    const width = i === 0 ? w + 4 : i === 1 ? w + 2 : t > 0.93 ? 1 : t > 0.8 ? Math.max(2, w - 1) : w;
    const left = cx - Math.floor(width / 2);
    const markRow = rng.next() < 0.18;
    const markAt = left + rng.int(Math.max(1, width));
    for (let dx = 0; dx < width; dx++) {
      const edge = dx === 0 ? 0.8 : dx === width - 1 ? 0.9 : 1;
      let c = jitter(BIRCH_BARK, rng, 9, edge);
      if (markRow && (dx === markAt - left || dx === markAt - left + 1) && i > 2) c = jitter(BIRCH_MARK, rng, 8);
      if (i < 2) c = jitter([112, 102, 84], rng, 8, edge); // soil-stained foot
      p.wood(left + dx, y - i, c);
    }
    spine.push([cx, y - i]);
  }
  const top = spine[spine.length - 1];
  // Branches: thin, upswept, alternating, each forking once; the crown is a
  // cloud of leaf masses around their tips (drawn after the wood, so the
  // branches show through the gaps).
  const nb = 6 + rng.int(4);
  let side = rng.next() < 0.5 ? -1 : 1;
  const branchColor = (): number => jitter([156, 148, 132], rng, 10);
  const tips: Array<[number, number, number]> = [];
  for (let b = 0; b < nb; b++) {
    const i0 = Math.min(H - 3, Math.floor(H * (0.4 + 0.55 * b / nb)) + rng.int(3));
    const [sx, sy] = spine[i0];
    const len = Math.max(5, Math.round((8 + rng.int(10)) * (1.2 - i0 / H)));
    const ang = -Math.PI / 2 + side * (0.6 + rng.next() * 0.5);
    const pts = limb(p, sx + side * Math.ceil(w / 2), sy, ang, len, -side * 0.035, branchColor);
    const [tx, ty] = pts[pts.length - 1] ?? [sx, sy];
    tips.push([tx, ty, side]);
    if (pts.length > 5 && rng.next() < 0.7) {
      const [fx, fy] = pts[Math.floor(pts.length * 0.55)];
      const twig = limb(p, fx, fy, ang - side * 0.7, 3 + rng.int(4), 0, branchColor);
      const [ux, uy] = twig[twig.length - 1] ?? [fx, fy];
      tips.push([ux, uy, -side]);
    }
    side = rng.next() < 0.8 ? -side : side;
  }
  for (const [tx, ty, sd] of tips) {
    p.blob(tx + sd, ty - 1, 5 + rng.int(4), 3 + rng.int(3), 0.86, BIRCH_LEAF_LIGHT, BIRCH_LEAF_DARK, BIRCH_LEAF_DEEP);
  }
  p.blob(top[0], top[1] - 3, 8 + rng.int(4), 6 + rng.int(3), 0.86, BIRCH_LEAF_LIGHT, BIRCH_LEAF_DARK, BIRCH_LEAF_DEEP);
  if (o.pods) hangPods(p, top[0] - 10, top[0] + 10, top[1] - 6, top[1] + Math.floor(H * 0.35), o.pods, 2);
  return p.result('birch', x, y, top[1]);
}

function treefern(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const H = o.height ?? 20 + rng.int(14);
  let cx = x;
  for (let i = 0; i < H; i++) {
    if (i > 3 && rng.next() < 0.12) cx += rng.next() < 0.5 ? -1 : 1;
    const width = i === 0 ? 5 : 3;
    const left = cx - Math.floor(width / 2);
    for (let dx = 0; dx < width; dx++) {
      // shaggy fibre: dark stripes, pale leaf scars
      const scar = (i % 4 === 1 && dx === 1 && rng.next() < 0.5);
      const c = scar ? jitter([128, 104, 74], rng, 8) : jitter(FERN_TRUNK, rng, 10, dx === 0 ? 0.78 : 1);
      p.wood(left + dx, y - i, c);
    }
  }
  const tx = cx, ty = y - H + 1;
  // Fronds fan from the crown: woody rachis, leaflets both sides, drooping tips.
  const count = 7 + rng.int(4);
  for (let f = 0; f < count; f++) {
    const spread = (f / (count - 1)) * 2 - 1; // -1..1
    const heading = -Math.PI / 2 + spread * 1.55 + (rng.next() - 0.5) * 0.2;
    const L = 11 + rng.int(8) - Math.round(Math.abs(spread) * 2);
    const curl = Math.sign(spread || 1) * (0.045 + rng.next() * 0.03);
    let px = tx, py = ty, a = heading;
    for (let s = 0; s < L; s++) {
      px += Math.cos(a); py += Math.sin(a);
      a += curl;
      p.wood(px, py, jitter(FERN_RACHIS, rng, 8));
      if (s % 2 === 1 && s < L - 1) {
        const pl = Math.max(1, Math.round((1 - s / L) * 4 + 1));
        const nx = -Math.sin(a), ny = Math.cos(a);
        for (const sgn of [-1, 1]) for (let k = 1; k <= pl; k++) {
          p.leaf(px + nx * k * sgn + Math.cos(a) * k * 0.4, py + ny * k * sgn + Math.sin(a) * k * 0.4,
            mix(FERN_LIGHT, FERN_DARK, (sgn > 0 ? 0.55 : 0.1) + rng.next() * 0.3));
        }
      }
    }
  }
  // A young crozier uncurling at the heart of the crown.
  for (let k = 0; k < 5; k++) p.leaf(tx + Math.round(Math.cos(k * 1.2) * 1.5), ty - 2 - Math.round(Math.sin(k * 1.2) * 1.5), mix(FERN_LIGHT, [150, 180, 110], 0.5));
  if (o.pods !== null) hangPods(p, tx - 8, tx + 8, ty - 2, ty + 5, o.pods ?? 'glow', 2 + rng.int(2));
  return p.result('treefern', x, y, ty);
}

function sapling(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const pal = FLOOR_LEAF[o.floor ?? 'bellows'];
  const H = o.height ?? 11 + rng.int(9);
  const w = rng.next() < 0.4 ? 2 : 1;
  let cx = x;
  for (let i = 0; i < H; i++) {
    if (i > 2 && rng.next() < 0.15) cx += rng.next() < 0.5 ? -1 : 1;
    for (let dx = 0; dx < (i === 0 ? w + 1 : w); dx++) p.wood(cx + dx - (i === 0 ? 1 : 0), y - i, jitter(pal.bark, rng, 10));
  }
  p.blob(cx, y - H - 1, 3 + rng.int(2), 2 + rng.int(2), 0.85, pal.light, pal.dark);
  if (o.pods) hangPods(p, cx - 3, cx + 3, y - H - 2, y - H + 3, o.pods, 1);
  return p.result('sapling', x, y, y - H);
}

function fernbed(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const pal = FLOOR_LEAF[o.floor ?? 'bellows'];
  const n = 3 + rng.int(4);
  for (let f = 0; f < n; f++) {
    const bx = x + rng.int(9) - 4;
    const heading = -Math.PI / 2 + (rng.next() - 0.5) * 2.2;
    const L = 4 + rng.int(5);
    const curl = (heading < -Math.PI / 2 ? -1 : 1) * 0.12;
    let px = bx, py = y, a = heading;
    for (let s = 0; s < L; s++) {
      px += Math.cos(a); py += Math.sin(a); a += curl;
      p.leaf(px, py, mix(pal.light, pal.dark, 0.2 + rng.next() * 0.35));
      if (s > 0 && s % 2 === 0) p.leaf(px - Math.sin(a), py + Math.cos(a), mix(pal.light, pal.dark, 0.55 + rng.next() * 0.3));
    }
  }
  return p.result('fernbed', x, y, y - 8);
}

function grasstuft(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const pal = FLOOR_LEAF[o.floor ?? 'bellows'];
  const n = 3 + rng.int(5);
  for (let b = 0; b < n; b++) {
    const bx = x + rng.int(7) - 3;
    const h = 3 + rng.int(5);
    const bend = (rng.next() - 0.5) * 0.5;
    for (let s = 0; s < h; s++) p.leaf(bx + Math.round(bend * s * s * 0.25), y - s, mix(pal.light, pal.dark, 0.25 + (1 - s / h) * 0.45 + rng.next() * 0.15));
  }
  return p.result('grasstuft', x, y, y - 7);
}

function mushroom(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const H = o.height ?? 26 + rng.int(22);
  const sw = 2 + (rng.next() < 0.5 ? 1 : 0);
  const capR = 11 + rng.int(8) + (sw - 2) * 2;
  const capH = 7 + rng.int(4);
  const caps: RGB[] = [[156, 82, 54], [118, 86, 124], [168, 124, 70], [132, 104, 88]];
  const cap = caps[rng.int(caps.length)];
  const stem: RGB = [200 + rng.int(12), 190 + rng.int(10), 174 + rng.int(12)];
  const lean = o.lean ?? (rng.next() - 0.5) * 0.1;
  const ringAt = Math.floor(H * (0.66 + rng.next() * 0.1));
  let topX = x;
  for (let i = 0; i < H; i++) {
    const cx = x + Math.round(lean * i + Math.sin(i * 0.09 + x) * 0.6);
    const half = sw + (i < 2 ? 2 : i < 5 ? 1 : 0) + (i === ringAt || i === ringAt + 1 ? 1 : 0);
    for (let dx = -half; dx <= half; dx++) {
      const streak = ((dx + cx) * 7 + i) % 5 === 0 ? 0.9 : 1;
      const edge = Math.abs(dx) === half ? 0.82 : 1;
      const ring = i === ringAt || i === ringAt + 1 ? 0.86 : 1;
      p.wood(cx + dx, y - i, jitter(stem, rng, 6, streak * edge * ring));
    }
    topX = cx;
  }
  const capBase = y - H + 1;
  // Gills: a dark, finely striped band under the cap.
  for (let dx = -capR + 2; dx <= capR - 2; dx++) {
    for (let g = 0; g < 2; g++) {
      const c = (dx & 1) === 0 ? jitter([92, 72, 66], rng, 6) : jitter([122, 100, 88], rng, 6);
      p.wood(topX + dx, capBase - g, c);
    }
  }
  // The cap: a dome, paler toward the crown, with chalky spots.
  for (let dx = -capR; dx <= capR; dx++) {
    const prof = Math.sqrt(Math.max(0, 1 - (dx / (capR + 0.5)) ** 2));
    const th = Math.max(1, Math.round(capH * prof));
    for (let k = 0; k < th; k++) {
      const yy = capBase - 2 - k;
      const t = k / Math.max(1, capH);
      p.wood(topX + dx, yy, mix([cap[0] * 0.7, cap[1] * 0.7, cap[2] * 0.7], [Math.min(255, cap[0] * 1.2), Math.min(255, cap[1] * 1.15), Math.min(255, cap[2] * 1.1)], t * 0.9 + rng.next() * 0.1));
    }
  }
  const spots = 4 + rng.int(4);
  for (let s = 0; s < spots; s++) {
    const dx = Math.round((rng.next() * 2 - 1) * (capR - 3));
    const prof = Math.sqrt(Math.max(0, 1 - (dx / (capR + 0.5)) ** 2));
    const yy = capBase - 2 - Math.max(0, Math.round(capH * prof) - 1 - rng.int(2));
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
      const ix = topX + dx + ox, iy = yy + oy;
      const w = p.world;
      if (!w.inBounds(ix, iy) || w.types[w.idx(ix, iy)] !== Cell.Trunk) continue;
      w.colors[w.idx(ix, iy)] = jitter([224, 212, 190], rng, 8);
    }
  }
  if (o.pods) hangPods(p, topX - capR + 2, topX + capR - 2, capBase - 1, capBase + 1, o.pods, 2);
  return p.result('mushroom', x, y, capBase - 2 - capH, y - 5);
}

function rootcolumn(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const ceil = o.ceilY ?? y - 60;
  const span = y - ceil;
  if (span < 12) return null;
  const w = 4 + rng.int(5);
  const phase = rng.next() * 6.28, amp = 1.5 + rng.next() * 2.5, freq = 0.06 + rng.next() * 0.05;
  const bark: RGB = [84, 62, 46];
  for (let i = 0; i <= span; i++) {
    const cx = x + Math.round(Math.sin(i * freq + phase) * amp);
    const flare = i < 3 || i > span - 3 ? 2 : 0;
    const half = Math.floor(w / 2) + flare;
    for (let dx = -half; dx <= half; dx++) {
      const twist = Math.sin((dx + i * 0.7) * 1.3) > 0.4 ? 0.82 : 1;
      p.wood(cx + dx, y - i, jitter(bark, rng, 10, twist * (Math.abs(dx) === half ? 0.8 : 1)));
    }
  }
  // Tendrils spread over floor and ceiling.
  for (const [ay, dirY] of [[y, 0], [ceil, 0]] as const) {
    void dirY;
    for (let k = 0; k < 3 + rng.int(3); k++) {
      const side = rng.next() < 0.5 ? -1 : 1;
      limb(p, x + side * (w / 2), ay + (ay === y ? 0 : 1), side < 0 ? Math.PI + (rng.next() - 0.5) * 0.3 : (rng.next() - 0.5) * 0.3, 5 + rng.int(9), (rng.next() - 0.5) * 0.08,
        () => jitter([98, 76, 56], rng, 10));
    }
  }
  return p.result('rootcolumn', x, y, ceil);
}

function hangingroot(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  // (x, y) is the first open cell under a ceiling; the root hangs down.
  const rng = p.rng;
  const L = o.height ?? 14 + rng.int(26);
  const phase = rng.next() * 6.28;
  let lastX = x;
  for (let i = 0; i < L; i++) {
    const t = i / L;
    const cx = x + Math.round(Math.sin(i * 0.11 + phase) * (1 + t * 2));
    const width = t < 0.3 ? 3 : t < 0.7 ? 2 : 1;
    for (let dx = 0; dx < width; dx++) {
      const c = t > 0.9 ? jitter([150, 128, 96], rng, 8) : jitter([74, 58, 44], rng, 9, dx === 0 ? 0.82 : 1);
      if (!p.wood(cx + dx - Math.floor(width / 2), y + i, c) && dx === 0) { lastX = cx; return p.result('hangingroot', x, y, y); }
    }
    lastX = cx;
    if (i > 6 && i % 9 === 0 && rng.next() < 0.7) {
      const side = rng.next() < 0.5 ? -1 : 1;
      limb(p, cx + side, y + i, Math.PI / 2 + side * (0.6 + rng.next() * 0.4), 3 + rng.int(6), side * 0.06, () => jitter([88, 70, 52], rng, 8));
    }
  }
  void lastX;
  return p.result('hangingroot', x, y, y);
}

function mangrove(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  // (x, y): open cell above the bed (the bed may be under water).
  const rng = p.rng;
  const bark: RGB = [86, 74, 54];
  const propH = 8 + rng.int(7);
  const H = o.height ?? 26 + rng.int(18);
  const w = 3 + rng.int(2);
  const baseY = y - propH;
  // Trunk above the prop roots.
  let cx = x;
  const spine: Array<[number, number]> = [];
  for (let i = 0; i < H; i++) {
    if (i > 4 && rng.next() < 0.1) cx += rng.next() < 0.5 ? -1 : 1;
    const width = i / H > 0.85 ? w - 1 : w;
    for (let dx = 0; dx < width; dx++) p.wood(cx + dx - Math.floor(width / 2), baseY - i, jitter(bark, rng, 9, dx === 0 ? 0.8 : 1));
    spine.push([cx, baseY - i]);
  }
  // Prop roots: arches from the trunk down to the bed on both sides.
  const legs = 3 + rng.int(3);
  for (let k = 0; k < legs; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const reach = 5 + rng.int(9);
    const sy = baseY - rng.int(5);
    const ex = x + side * reach, ey = y;
    const mx = x + side * reach * 0.55, my = sy - 3 - rng.int(4);
    const steps = 28;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * mx + t * t * ex;
      const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ey;
      p.wood(px, py, jitter([96, 82, 60], rng, 8));
      if (t > 0.6 && reach > 9) p.wood(px + side, py, jitter([80, 68, 50], rng, 8));
    }
    // and on down into its own footing (a leg ending over a hole would dangle)
    const w = p.world;
    for (let d = 1; d <= 12; d++) {
      if (!w.inBounds(ex, ey + d) || blocksEntity(w.types[w.idx(ex, ey + d)])) break;
      p.wood(ex, ey + d, jitter([80, 68, 50], rng, 8));
    }
  }
  const top = spine[spine.length - 1];
  const light: RGB = [88, 132, 84], dark: RGB = [40, 76, 56];
  p.blob(top[0], top[1] - 2, 9 + rng.int(4), 6 + rng.int(2), 0.86, light, dark);
  for (let b = 0; b < 3; b++) {
    const [sx, sy] = spine[Math.floor(H * (0.55 + b * 0.15))] ?? top;
    const side = b % 2 === 0 ? -1 : 1;
    const pts = limb(p, sx + side, sy, -Math.PI / 2 + side * 0.9, 6 + rng.int(5), -side * 0.04, () => jitter(bark, rng, 8));
    const [bx, by] = pts[pts.length - 1] ?? [sx, sy];
    p.blob(bx + side * 2, by - 1, 6 + rng.int(3), 4 + rng.int(2), 0.84, light, dark);
  }
  if (o.pods) hangPods(p, top[0] - 12, top[0] + 12, top[1] - 4, top[1] + 10, o.pods, 2);
  return p.result('mangrove', x, y, top[1], baseY - 3);
}

function reeds(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const n = 4 + rng.int(6);
  const w = p.world;
  for (let s = 0; s < n; s++) {
    const sx = x + s * 2 - n + rng.int(2);
    // each stem stands on ITS OWN bed (the bottom is never flat)
    let base = y - 3;
    while (base < y + 14 && w.inBounds(sx, base + 1) && !blocksEntity(w.types[w.idx(sx, base + 1)])) base++;
    if (!w.inBounds(sx, base + 1) || !blocksEntity(w.types[w.idx(sx, base + 1)])) continue;
    const h = (o.height ?? 8 + rng.int(13)) + (base - y);
    const bend = (rng.next() - 0.5) * 0.12;
    let top = base;
    for (let i = 0; i < h; i++) {
      const px = sx + Math.round(bend * i * i * 0.1);
      p.wood(px, base - i, jitter([112, 120, 70], rng, 10, i < 3 ? 0.8 : 1));
      top = base - i;
    }
    if (rng.next() < 0.55) {
      // a cattail head
      const px = sx + Math.round(bend * h * h * 0.1);
      for (let k = 1; k <= 4; k++) p.wood(px, top - k, jitter([96, 64, 40], rng, 8));
      p.wood(px, top - 5, jitter([140, 130, 90], rng, 8));
    }
    if (rng.next() < 0.6) {
      const side = rng.next() < 0.5 ? -1 : 1;
      for (let k = 1; k <= 3 + rng.int(3); k++) p.leaf(sx + side * k, base - Math.floor(h * 0.4) - k, mix([126, 146, 84], [70, 96, 60], rng.next()));
    }
  }
  return p.result('reeds', x, y, y - 20);
}

function kelp(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  // (x, y): a water cell just above the bed; grows up through the water.
  const rng = p.rng;
  const H = o.height ?? 12 + rng.int(18);
  const phase = rng.next() * 6.28;
  const w = p.world;
  const x0 = x + Math.round(Math.sin(phase) * 1.4);
  let base = y - 2;
  while (base < y + 10 && w.inBounds(x0, base + 1) && !blocksEntity(w.types[w.idx(x0, base + 1)])) base++;
  y = base;
  for (let i = 0; i < H; i++) {
    const px = x + Math.round(Math.sin(i * 0.35 + phase) * 1.4);
    if (!p.wood(px, y - i, jitter([56, 86, 60], rng, 8))) break;
    if (i > 1 && i % 3 === 0) {
      const side = (i / 3) % 2 === 0 ? -1 : 1;
      for (let k = 1; k <= 2 + rng.int(3); k++) p.leaf(px + side * k, y - i - Math.floor(k / 2), mix([92, 132, 84], [48, 84, 64], rng.next()));
    }
  }
  return p.result('kelp', x, y, y - H);
}

function lilypad(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  // (x, y): the open cell right above a water surface.
  void o;
  const rng = p.rng;
  const w = 5 + rng.int(5);
  const notch = rng.int(w - 2) + 1;
  for (let dx = 0; dx < w; dx++) {
    if (dx === notch) continue;
    p.leaf(x + dx, y, mix([96, 142, 84], [58, 102, 64], rng.next() * 0.7), LEAF_LITTER);
  }
  if (rng.next() < 0.45) {
    const fx = x + Math.floor(w / 2);
    const petal: RGB = rng.next() < 0.5 ? [232, 196, 204] : [236, 232, 214];
    p.leaf(fx, y - 1, jitter(petal, rng, 8), LEAF_LITTER);
    p.leaf(fx - 1, y - 1, jitter(petal, rng, 8, 0.9), LEAF_LITTER);
    p.leaf(fx + 1, y - 1, jitter(petal, rng, 8, 0.9), LEAF_LITTER);
    p.leaf(fx, y - 2, jitter([240, 210, 120], rng, 8), LEAF_LITTER);
  }
  return p.result('lilypad', x, y, y - 2);
}

function emberbark(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  const rng = p.rng;
  const H = o.height ?? 28 + rng.int(18);
  const w = 4 + rng.int(2);
  const bark: RGB = [44, 36, 32];
  const ember: RGB = [196, 84, 34];
  const spine: Array<[number, number]> = [];
  let cx = x;
  for (let i = 0; i < H; i++) {
    if (i > 3 && rng.next() < 0.16) cx += rng.next() < 0.5 ? -1 : 1;
    const t = i / H;
    const width = i === 0 ? w + 3 : t > 0.82 ? Math.max(2, w - 2) : w;
    const left = cx - Math.floor(width / 2);
    for (let dx = 0; dx < width; dx++) {
      // Fissures: the char splits in vertical seams that still hold a coal's glow.
      const seam = ((left + dx) * 5 + (i >> 2) * 3) % 7 === 0 && rng.next() < 0.55;
      const c = seam ? jitter(ember, rng, 16, 0.8 + rng.next() * 0.3) : jitter(bark, rng, 7, dx === 0 ? 0.8 : 1);
      p.wood(left + dx, y - i, c);
    }
    spine.push([cx, y - i]);
  }
  // Gnarled, mostly bare limbs; a few dry rust leaves hang on.
  for (let b = 0; b < 4 + rng.int(3); b++) {
    const [sx, sy] = spine[Math.floor(H * (0.45 + rng.next() * 0.5))];
    const side = rng.next() < 0.5 ? -1 : 1;
    const pts = limb(p, sx + side, sy, -Math.PI / 2 + side * (0.5 + rng.next() * 0.7), 5 + rng.int(9), side * (rng.next() - 0.3) * 0.12,
      () => jitter([56, 44, 38], rng, 8));
    const [tx, ty] = pts[pts.length - 1] ?? [sx, sy];
    if (rng.next() < 0.6) p.blob(tx, ty - 1, 3 + rng.int(2), 2, 0.45, [150, 84, 52], [86, 44, 34]);
  }
  const top = spine[spine.length - 1];
  return p.result('emberbark', x, y, top[1]);
}

function firelily(p: Planter, x: number, y: number, o: PlantOptions): PlantResult | null {
  void o;
  const rng = p.rng;
  const n = 3 + rng.int(5);
  for (let s = 0; s < n; s++) {
    const sx = x + rng.int(11) - 5;
    const h = 4 + rng.int(6);
    for (let i = 0; i < h; i++) p.wood(sx, y - i, jitter([66, 78, 42], rng, 8));
    // The bloom: a flared cup of red-orange petals around a gold heart.
    const by = y - h;
    const petal: RGB = rng.next() < 0.5 ? [222, 78, 40] : [236, 124, 46];
    for (const [dx, dy] of [[-1, 0], [1, 0], [-2, -1], [2, -1], [-1, -1], [1, -1], [0, 0]]) {
      p.leaf(sx + dx, by + dy, jitter(petal, rng, 12, dy < 0 ? 1.05 : 0.95));
    }
    p.leaf(sx, by - 1, jitter([246, 200, 84], rng, 8));
    if (rng.next() < 0.5) p.leaf(sx + (rng.next() < 0.5 ? -1 : 1), by + 3, jitter([70, 96, 48], rng, 8));
  }
  return p.result('firelily', x, y, y - 10);
}

const GROWERS: Record<FloraSpecies, (p: Planter, x: number, y: number, o: PlantOptions) => PlantResult | null> = {
  birch, treefern, sapling, fernbed, grasstuft, mushroom, rootcolumn, hangingroot, mangrove, reeds, kelp, lilypad, emberbark, firelily,
};

/**
 * Grow one plant of `species` with its foot at (x, y) — for standing plants the
 * first open cell above solid ground; for hanging roots the first open cell
 * under a ceiling; for water plants a cell at/above the water. Writes only into
 * open cells (never into rock), so it cannot seal a route. Returns what it grew.
 */
export function plantFlora(world: World, species: FloraSpecies, x: number, y: number, rng: Rng, opts: PlantOptions = {}): PlantResult | null {
  const water = species === 'mangrove' || species === 'reeds' || species === 'kelp';
  const p = new Planter(world, rng, water);
  return GROWERS[species](p, Math.round(x), Math.round(y), opts);
}

/** True if a column of `h` open (or liquid, if allowed) cells stands above (x, y). */
export function headroom(world: World, x: number, y: number, h: number, allowLiquid = false): boolean {
  for (let k = 0; k < h; k++) {
    if (!world.inBounds(x, y - k)) return false;
    const t = world.types[world.idx(x, y - k)];
    if (!(openForGrowth(t) || (allowLiquid && isLiquid(t)))) return false;
  }
  return true;
}
