import { Cell, isGas, isLiquid } from '@/sim/CellType';
import { anchoredSupport, LEAF_LITTER, LEAF_REACH, SEED_GLOW_HELD, SEED_GLOW_LOOSE, SEED_THIRSTY_LOOSE, standSupport } from '@/sim/elements/flora';

export { anchoredSupport, standSupport };
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import type { World } from '@/sim/World';

/* ============================================================
 * FELLING — the grid half of a falling tree (pure; no Rapier, no ctx).
 *
 * A stand of living wood (Cell.Trunk) is a connected cluster. It stands while
 * any of its cells touches load-bearing ground; the moment the last contact
 * goes (Excavate, a burned-through base, a blast, acid, a kicked sapling) the
 * whole cluster is felled: its cells — plus the canopy and pods it carries —
 * are lifted out of the grid into a FellSprite, a compound box collider is
 * fitted to the wood, and game/Flora hands that to Rapier as a hinged body.
 * When it comes to rest, restampFell writes it back as solid Wood (the log),
 * Leaf (the crown on the ground) and loose Seed (the pods) in its final pose.
 * ============================================================ */

/** Pixel kinds in a FellSprite. */
export const FELL_EMPTY = 0;
export const FELL_WOOD = 1;
export const FELL_LEAF = 2;
export const FELL_SEED = 3;
export const FELL_EMBER = 4; // wood that was smouldering when it fell
export const FELL_GLOWSEED = 5;

/** A cluster needs at least this many trunk cells to fall as a body; smaller
 *  unsupported scraps just crumble into splinters. */
export const FELL_MIN_CELLS = 10;
/** Flood cap: a stand bigger than this is treated as supported (safe). */
export const STAND_MAX_CELLS = 14000;


const N4X = [0, 1, 0, -1], N4Y = [-1, 0, 1, 0];


const N8X = [-1, 0, 1, -1, 1, -1, 0, 1], N8Y = [-1, -1, -1, 0, 0, 1, 1, 1];

/** Reusable flood scratch (cell indices + an epoch-stamped visit plane). */
export class FloodScratch {
  visit: Uint32Array = new Uint32Array(0);
  epoch = 0;
  queue: Int32Array = new Int32Array(1024);
  ensure(n: number): void {
    if (this.visit.length < n) { this.visit = new Uint32Array(n); this.epoch = 0; }
  }
  next(): number {
    this.epoch++;
    if (this.epoch >= 0xfffffff0) { this.visit.fill(0); this.epoch = 1; }
    return this.epoch;
  }
  grow(): void {
    const q = new Int32Array(this.queue.length * 2);
    q.set(this.queue);
    this.queue = q;
  }
}

export interface Stand {
  /** Trunk cell indices (a view into scratch — copy before the next flood). */
  cells: Int32Array;
  count: number;
  supported: boolean;
  /** True when the flood hit STAND_MAX_CELLS (treated as supported). */
  capped: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Flood the 8-connected Trunk cluster through (sx, sy). `seen` (the scratch
 * epoch) marks every visited cell so callers can sweep a region and flood
 * each cluster exactly once.
 */
export function floodStand(world: World, sx: number, sy: number, scratch: FloodScratch, epoch: number): Stand {
  const W = world.width, types = world.types, visit = scratch.visit;
  const start = sx + sy * W;
  let head = 0, tail = 0;
  scratch.queue[tail++] = start;
  visit[start] = epoch;
  let supported = false, capped = false;
  let x0 = sx, y0 = sy, x1 = sx, y1 = sy;
  while (head < tail) {
    const i = scratch.queue[head++];
    const y = (i / W) | 0, x = i - y * W;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (!supported) {
      for (let k = 0; k < 4; k++) {
        if (anchoredSupport(world, x + N4X[k], y + N4Y[k])) { supported = true; break; }
      }
    }
    for (let k = 0; k < 8; k++) {
      const nx = x + N8X[k], ny = y + N8Y[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= world.height) continue;
      const ni = nx + ny * W;
      if (visit[ni] === epoch || types[ni] !== Cell.Trunk) continue;
      visit[ni] = epoch;
      if (tail >= STAND_MAX_CELLS) { capped = true; continue; }
      if (tail >= scratch.queue.length) scratch.grow();
      scratch.queue[tail++] = ni;
    }
  }
  return { cells: scratch.queue, count: tail, supported: supported || capped, capped, x0, y0, x1, y1 };
}

/* --------------------------- the lifted sprite --------------------------- */

export interface FellSprite {
  /** World-aligned grid at the moment of felling. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  kind: Uint8Array;
  color: Uint32Array;
  woodCount: number;
  leafCount: number;
  seedCount: number;
  /** Mean bark colour (for splinters and dust). */
  bark: number;
  /** Mean foliage colour (for shed leaves). */
  foliage: number;
}

export interface FellBody {
  /** Body origin (world) and spawn angle. */
  cx: number;
  cy: number;
  angle: number;
  /** Overall local bounds (query shape). */
  halfW: number;
  halfH: number;
  /** Compound colliders in the body's local frame. */
  boxes: Array<{ halfW: number; halfH: number; x: number; y: number }>;
  /** Local-frame major-axis extents (top = -halfH side). */
  mass: number;
}

/**
 * Lift a felled stand (trunk cells) and everything it carries — the canopy
 * leaves within reach, the pods hanging in it — out of the grid into a sprite.
 * Clears the lifted cells. Returns null if the stand is too small to fall.
 */
export function liftStand(world: World, stand: Stand, scratch: FloodScratch): FellSprite | null {
  if (stand.count < FELL_MIN_CELLS) return null;
  const W = world.width, H = world.height, types = world.types;
  // Copy the trunk list out of the shared queue before the canopy flood reuses it.
  const trunk = stand.cells.slice(0, stand.count);
  const epoch = scratch.next();
  const visit = scratch.visit;
  for (const i of trunk) visit[i] = epoch;
  // Canopy: leaves (and seeds) 8-connected to the wood, within leaf reach of it.
  const reach = LEAF_REACH + 3;
  const bx0 = Math.max(0, stand.x0 - reach), by0 = Math.max(0, stand.y0 - reach);
  const bx1 = Math.min(W - 1, stand.x1 + reach), by1 = Math.min(H - 1, stand.y1 + reach);
  const canopy: number[] = [];
  let head = 0;
  const frontier: number[] = [...trunk];
  while (head < frontier.length) {
    const i = frontier[head++];
    const y = (i / W) | 0, x = i - y * W;
    for (let k = 0; k < 8; k++) {
      const nx = x + N8X[k], ny = y + N8Y[k];
      if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
      const ni = nx + ny * W;
      if (visit[ni] === epoch) continue;
      const t = types[ni];
      if (t === Cell.Leaf) {
        // Litter on the ground is not the tree's; attached leaves are.
        if (world.life[ni] === LEAF_LITTER) continue;
        visit[ni] = epoch;
        canopy.push(ni);
        frontier.push(ni);
      } else if (t === Cell.Seed && world.life[ni] < 0 && world.life[ni] >= SEED_GLOW_HELD) {
        // Held pods (loose seeds on the ground are not lifted).
        visit[ni] = epoch;
        canopy.push(ni);
      }
    }
  }
  let x0 = stand.x0, y0 = stand.y0, x1 = stand.x1, y1 = stand.y1;
  for (const i of canopy) {
    const y = (i / W) | 0, x = i - y * W;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const kind = new Uint8Array(w * h), color = new Uint32Array(w * h);
  let br = 0, bg = 0, bb = 0, lr = 0, lg = 0, lb = 0, woodCount = 0, leafCount = 0, seedCount = 0;
  const put = (i: number, k: number): void => {
    const y = (i / W) | 0, x = i - y * W;
    const si = (x - x0) + (y - y0) * w;
    const c = world.colors[i];
    kind[si] = k;
    color[si] = c;
  };
  for (const i of trunk) {
    const c = world.colors[i];
    br += unpackR(c); bg += unpackG(c); bb += unpackB(c);
    put(i, world.life[i] > 0 ? FELL_EMBER : FELL_WOOD);
    woodCount++;
  }
  for (const i of canopy) {
    const t = types[i];
    if (t === Cell.Leaf) {
      const c = world.colors[i];
      lr += unpackR(c); lg += unpackG(c); lb += unpackB(c);
      put(i, FELL_LEAF);
      leafCount++;
    } else {
      put(i, world.life[i] === SEED_GLOW_HELD ? FELL_GLOWSEED : FELL_SEED);
      seedCount++;
    }
  }
  for (const i of trunk) world.clearCellAt(i);
  for (const i of canopy) world.clearCellAt(i);
  return {
    x0, y0, w, h, kind, color, woodCount, leafCount, seedCount,
    bark: woodCount ? packRGB(Math.round(br / woodCount), Math.round(bg / woodCount), Math.round(bb / woodCount)) : packRGB(110, 90, 70),
    foliage: leafCount ? packRGB(Math.round(lr / leafCount), Math.round(lg / leafCount), Math.round(lb / leafCount)) : packRGB(90, 130, 70),
  };
}

/**
 * Fit a compound collider to the sprite's WOOD: principal axis → body angle,
 * then slices along that axis, each slice's solid core width (columns at least
 * half filled — sparse branches and twigs do not collide), merged into at most
 * `maxBoxes` boxes. A birch becomes one long box; a giant mushroom a stem box
 * and a cap box.
 */
export function fitFellBody(sprite: FellSprite, density: number, maxBoxes = 4): FellBody {
  const { w, h, kind } = sprite;
  let n = 0, mx = 0, my = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = kind[x + y * w];
    if (k !== FELL_WOOD && k !== FELL_EMBER) continue;
    n++; mx += x + 0.5; my += y + 0.5;
  }
  if (n === 0) {
    return { cx: sprite.x0 + w / 2, cy: sprite.y0 + h / 2, angle: 0, halfW: 1, halfH: 1, boxes: [{ halfW: 1, halfH: 1, x: 0, y: 0 }], mass: density * 4 };
  }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = kind[x + y * w];
    if (k !== FELL_WOOD && k !== FELL_EMBER) continue;
    const dx = x + 0.5 - mx, dy = y + 0.5 - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  // Major axis of the covariance; oriented to point DOWN (+y) so an upright
  // stand has angle 0 and local +y runs from crown to foot.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(theta), uy = Math.sin(theta);
  // Prefer a vertical-ish major axis for near-isotropic blobs (a squat stump).
  if (Math.abs(sxx - syy) < 1e-6 && sxy === 0) { ux = 0; uy = 1; }
  if (uy < 0 || (uy === 0 && ux < 0)) { ux = -ux; uy = -uy; }
  // Body local +y = (-sin a, cos a) = (ux, uy)  =>  a = atan2(-ux, uy)
  const angle = Math.atan2(-ux, uy);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // Local coordinates of every wood pixel (rotate by -angle about the centroid).
  let lyMin = Infinity, lyMax = -Infinity;
  const lxs: number[] = [], lys: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = kind[x + y * w];
    if (k !== FELL_WOOD && k !== FELL_EMBER) continue;
    const dx = x + 0.5 - mx, dy = y + 0.5 - my;
    const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
    lxs.push(lx); lys.push(ly);
    if (ly < lyMin) lyMin = ly;
    if (ly > lyMax) lyMax = ly;
  }
  // Slice along the major axis; per slice find the solid core (columns >= half filled).
  const SLICE = 4;
  const slices = Math.max(1, Math.ceil((lyMax - lyMin + 1) / SLICE));
  const colsLo = -Math.ceil(w + h), colsN = Math.ceil(w + h) * 2 + 2;
  const counts = new Uint16Array(slices * colsN);
  const rowsIn = new Uint16Array(slices);
  for (let p = 0; p < lxs.length; p++) {
    const s = Math.min(slices - 1, Math.floor((lys[p] - lyMin) / SLICE));
    const c = Math.floor(lxs[p]) - colsLo;
    if (c >= 0 && c < colsN) counts[s * colsN + c]++;
  }
  for (let s = 0; s < slices; s++) {
    const y0 = lyMin + s * SLICE;
    rowsIn[s] = Math.max(1, Math.min(SLICE, Math.ceil(lyMax - y0 + 0.001)));
  }
  interface Core { lo: number; hi: number; }
  const cores: Array<Core | null> = [];
  for (let s = 0; s < slices; s++) {
    const need = Math.max(1, Math.floor(rowsIn[s] * 0.5));
    // widest contiguous run of well-filled columns (the trunk, not its twigs)
    let bestLo = 0, bestHi = -1, runLo = -1;
    for (let c = 0; c <= colsN; c++) {
      const ok = c < colsN && counts[s * colsN + c] >= need;
      if (ok && runLo < 0) runLo = c;
      if (!ok && runLo >= 0) {
        if (c - 1 - runLo > bestHi - bestLo) { bestLo = runLo; bestHi = c - 1; }
        runLo = -1;
      }
    }
    cores.push(bestHi >= bestLo ? { lo: bestLo + colsLo, hi: bestHi + colsLo + 1 } : null);
  }
  // Merge adjacent slices with similar cores into boxes.
  type Box = { lo: number; hi: number; y0: number; y1: number };
  let boxes: Box[] = [];
  for (let s = 0; s < slices; s++) {
    const c = cores[s];
    if (!c) continue;
    const y0 = lyMin + s * SLICE, y1 = Math.min(lyMax + 0.5, y0 + SLICE);
    const last = boxes[boxes.length - 1];
    const wNow = c.hi - c.lo;
    if (last && Math.abs(last.y1 - y0) < 0.01) {
      const wLast = last.hi - last.lo;
      if (Math.abs(wNow - wLast) <= Math.max(1.5, wLast * 0.25) && Math.abs((c.lo + c.hi) - (last.lo + last.hi)) <= 3) {
        last.lo = Math.min(last.lo, c.lo); last.hi = Math.max(last.hi, c.hi); last.y1 = y1;
        continue;
      }
    }
    boxes.push({ lo: c.lo, hi: c.hi, y0, y1 });
  }
  if (boxes.length === 0) {
    let lo = Infinity, hi = -Infinity;
    for (const lx of lxs) { if (lx < lo) lo = lx; if (lx + 1 > hi) hi = lx + 1; }
    boxes = [{ lo, hi, y0: lyMin, y1: lyMax + 0.5 }];
  }
  // Too many boxes: repeatedly merge the adjacent pair with the closest widths.
  while (boxes.length > maxBoxes) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i + 1 < boxes.length; i++) {
      const d = Math.abs((boxes[i].hi - boxes[i].lo) - (boxes[i + 1].hi - boxes[i + 1].lo));
      if (d < bd) { bd = d; bi = i; }
    }
    const a = boxes[bi], b = boxes[bi + 1];
    boxes.splice(bi, 2, { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) });
  }
  // Body origin = centre of the overall collider bounds (local), so the query
  // shape (halfW/halfH about the origin) is honest.
  let blo = Infinity, bhi = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const b of boxes) {
    blo = Math.min(blo, b.lo); bhi = Math.max(bhi, b.hi);
    by0 = Math.min(by0, b.y0); by1 = Math.max(by1, b.y1);
  }
  const ox = (blo + bhi) / 2, oy = (by0 + by1) / 2;
  // Origin in world coords: centroid + R(angle)·(ox, oy)
  const cx = sprite.x0 + mx + ox * ca - oy * sa;
  const cy = sprite.y0 + my + ox * sa + oy * ca;
  let area = 0;
  const out = boxes.map((b) => {
    const hw = Math.max(0.75, (b.hi - b.lo) / 2), hh = Math.max(0.75, (b.y1 - b.y0) / 2);
    area += 4 * hw * hh;
    return { halfW: hw, halfH: hh, x: (b.lo + b.hi) / 2 - ox, y: (b.y0 + b.y1) / 2 - oy };
  });
  return {
    cx, cy, angle,
    halfW: Math.max(0.75, (bhi - blo) / 2),
    halfH: Math.max(0.75, (by1 - by0) / 2),
    boxes: out,
    mass: area * density,
  };
}

/* ------------------------------ pose mapping ------------------------------ */

/** The world-aligned frame a sprite was lifted in. */
export interface SpriteFrame {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
}

/** Where a world point `q` sat in the sprite when the body had pose (x, y, a),
 *  given the spawn pose (cx0, cy0, a0). */
export function spriteSampleAt(sprite: SpriteFrame, cx0: number, cy0: number, a0: number,
  x: number, y: number, a: number, qx: number, qy: number): number {
  const d = a0 - a, c = Math.cos(d), s = Math.sin(d);
  const rx = qx - x, ry = qy - y;
  const px = cx0 + rx * c - ry * s, py = cy0 + rx * s + ry * c;
  const sx = Math.floor(px) - sprite.x0, sy = Math.floor(py) - sprite.y0;
  if (sx < 0 || sy < 0 || sx >= sprite.w || sy >= sprite.h) return -1;
  return sx + sy * sprite.w;
}

/** World-space bounds of the sprite at a pose (for culling, rasterising). */
export function spriteBounds(sprite: SpriteFrame, cx0: number, cy0: number, a0: number,
  x: number, y: number, a: number): { x0: number; y0: number; x1: number; y1: number } {
  const d = a - a0, c = Math.cos(d), s = Math.sin(d);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of [[sprite.x0, sprite.y0], [sprite.x0 + sprite.w, sprite.y0],
    [sprite.x0, sprite.y0 + sprite.h], [sprite.x0 + sprite.w, sprite.y0 + sprite.h]]) {
    const rx = px - cx0, ry = py - cy0;
    const wx = x + rx * c - ry * s, wy = y + rx * s + ry * c;
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
    if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
  }
  return { x0, y0, x1, y1 };
}

/* -------------------------------- re-stamp -------------------------------- */

/** Cells a settling log may overwrite: air, flame, loose soft growth. */
function logClaims(t: number): boolean {
  return t === Cell.Empty || isGas(t) || t === Cell.Fire || t === Cell.Ash || t === Cell.Grass || t === Cell.Leaf
    || t === Cell.Moss || t === Cell.Vines || t === Cell.Fungus || t === Cell.Seed;
}

export interface RestampResult {
  wood: number;
  leaves: number;
  seeds: number;
  displacedLiquid: number;
  burning: number;
  /** Cells written, for entity push-out. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

export interface RestampOptions {
  /** Deterministic 0..1 draws (fire/char choices). */
  rand: () => number;
  /** Colour for flame cells. */
  fireColor: () => number;
  /** Cells to leave alone (e.g. inside the player's box). */
  keepClear?: (x: number, y: number) => boolean;
}

/**
 * Write a settled fell back into the grid in its final pose: wood becomes
 * solid Wood (a log; smouldering wood comes down burning), leaves become Leaf
 * (the crown lying on the ground), pods become loose Seed. A log that settles
 * in a liquid displaces it upward — a trunk across a stream raises it.
 */
export function restampFell(world: World, sprite: FellSprite, cx0: number, cy0: number, a0: number,
  x: number, y: number, a: number, opts: RestampOptions): RestampResult {
  const b = spriteBounds(sprite, cx0, cy0, a0, x, y, a);
  const X0 = Math.max(1, Math.floor(b.x0) - 1), Y0 = Math.max(1, Math.floor(b.y0) - 1);
  const X1 = Math.min(world.width - 2, Math.ceil(b.x1) + 1), Y1 = Math.min(world.height - 2, Math.ceil(b.y1) + 1);
  const res: RestampResult = { wood: 0, leaves: 0, seeds: 0, displacedLiquid: 0, burning: 0, bounds: { x0: X1, y0: Y1, x1: X0, y1: Y0 } };
  const note = (qx: number, qy: number): void => {
    const bb = res.bounds;
    if (qx < bb.x0) bb.x0 = qx; if (qx > bb.x1) bb.x1 = qx;
    if (qy < bb.y0) bb.y0 = qy; if (qy > bb.y1) bb.y1 = qy;
  };
  // Wood first (it must claim its cells before the crown), then leaves, then
  // seeds. Rows run bottom-up so liquid pushed out of a low log cell rises
  // past the cells above it (which the log has not claimed yet).
  const written = new Set<number>();
  for (const pass of [FELL_WOOD, FELL_LEAF, FELL_SEED] as const) {
    for (let qy = Y1; qy >= Y0; qy--) {
      for (let qx = X0; qx <= X1; qx++) {
        const si = spriteSampleAt(sprite, cx0, cy0, a0, x, y, a, qx + 0.5, qy + 0.5);
        if (si < 0) continue;
        const k = sprite.kind[si];
        const isWood = k === FELL_WOOD || k === FELL_EMBER;
        const isSeed = k === FELL_SEED || k === FELL_GLOWSEED;
        if (pass === FELL_WOOD ? !isWood : pass === FELL_LEAF ? k !== FELL_LEAF : !isSeed) continue;
        if (opts.keepClear?.(qx, qy)) continue;
        const i = world.idx(qx, qy);
        const t = world.types[i];
        if (pass === FELL_WOOD) {
          if (isLiquid(t)) {
            // Displace the liquid up its own column to the first open cell.
            let placed = false;
            for (let up = 1; up <= 48 && !placed; up++) {
              if (qy - up < 1) break;
              const ui = world.idx(qx, qy - up);
              const ut = world.types[ui];
              if (ut === Cell.Empty || isGas(ut)) {
                world.replaceCellAt(ui, t, world.colors[i]);
                placed = true;
              } else if (!isLiquid(ut) && !logClaims(ut) && !written.has(ui)) break;
            }
            res.displacedLiquid++;
          } else if (!logClaims(t)) continue;
          const c = sprite.color[si];
          if (k === FELL_EMBER && opts.rand() < 0.45) {
            world.replaceCellAt(i, Cell.Fire, opts.fireColor());
            world.life[i] = 30 + Math.floor(opts.rand() * 30);
            res.burning++;
          } else {
            // Dead wood darkens a touch; the bark pattern stays (override: no plank tiles).
            world.replaceCellAt(i, Cell.Wood, packRGB(Math.round(unpackR(c) * 0.9), Math.round(unpackG(c) * 0.88), Math.round(unpackB(c) * 0.86)));
            world.colorOverrides.add(i);
            if (k === FELL_EMBER) res.burning++;
          }
          written.add(i);
          res.wood++;
          note(qx, qy);
        } else if (pass === FELL_LEAF) {
          if (!(t === Cell.Empty || isGas(t) || t === Cell.Ash || t === Cell.Grass)) continue;
          world.replaceCellAt(i, Cell.Leaf, sprite.color[si]);
          world.life[i] = 0; // reclassify: leaves touching the log hold on, the rest drift
          res.leaves++;
          note(qx, qy);
        } else {
          if (!(t === Cell.Empty || isGas(t))) continue;
          world.replaceCellAt(i, Cell.Seed, sprite.color[si]);
          world.life[i] = k === FELL_GLOWSEED ? SEED_GLOW_LOOSE : SEED_THIRSTY_LOOSE;
          res.seeds++;
          note(qx, qy);
        }
      }
    }
  }
  return res;
}
