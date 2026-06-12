import type {
  ArterySpec,
  ChamberParams,
  RowAnchor,
  ShaftParams,
  StalactiteParams,
} from '@/config/gen';
import { clamp, valueNoise } from '@/core/math';
import type { Rng } from '@/core/rng';

/**
 * Pure carve primitives over a flat work buffer (`x + y * w`, 1 = wall,
 * 0 = open). All take explicit width/height so tests can run on reduced
 * worlds, and all take their deps explicitly (no hidden state).
 *
 * The EXTRACTED primitives (fillNoise … removeSpecks) are verbatim moves of
 * the original earthen generator loops: same literals via params, same
 * arithmetic, and — critically — the same rng draw order. They are locked by
 * tests/gen-golden.test.ts; do not "clean up" their quirks.
 *
 * Shared rules: writes are clamped to x in (1, w-2) / y in (minY, …) like the
 * original carveDisc, and nothing ever fills rows >= floorBand back in (the
 * floor strip stays open).
 */

/** Resolve a config row anchor against the live world dimensions. */
export function resolveRowAnchor(a: RowAnchor, h: number, floorBand: number): number {
  switch (a.kind) {
    case 'abs':
      return a.v;
    case 'hfrac':
      return h * a.v;
    case 'floorOff':
      return floorBand - a.v;
  }
}

/* ============================================================
 * Extracted primitives (golden-hash locked rng stream)
 * ============================================================ */

/**
 * Noise field on 2x2 blocks (true = wall); rows >= floorBand stay open and
 * consume NO rng draws. Ends with the original explicit floor-strip clear.
 */
export function fillNoise(
  work: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
  density: number,
  floorBand: number,
): void {
  for (let x = 0; x < w; x += 2) {
    for (let y = 0; y < h; y += 2) {
      const v = y >= floorBand ? 0 : rng.next() < density ? 1 : 0;
      work[x + y * w] = v;
      if (x + 1 < w) work[x + 1 + y * w] = v;
      if (y + 1 < h) {
        work[x + (y + 1) * w] = v;
        if (x + 1 < w) work[x + 1 + (y + 1) * w] = v;
      }
    }
  }
  for (let x = 0; x < w; x++) for (let y = floorBand; y < h; y++) work[x + y * w] = 0;
}

/**
 * Cellular-automata smoothing, majority rule (n >= 5 wall, n <= 3 open).
 * Out-of-bounds neighbors count as wall EXCEPT below floorBand, which counts
 * open. Consumes no rng. Result lands back in `work`.
 */
export function smoothCA(work: Uint8Array, w: number, h: number, passes: number, floorBand: number): void {
  let cur: Uint8Array = work;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < floorBand; y++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const X = x + dx,
              Y = y + dy;
            if (X < 0 || X >= w || Y < 0) {
              n++;
              continue;
            }
            if (Y >= floorBand) continue;
            if (cur[X + Y * w]) n++;
          }
        }
        next[x + y * w] = n >= 5 ? 1 : n <= 3 ? 0 : cur[x + y * w];
      }
    }
    cur = next;
  }
  if (cur !== work) work.set(cur);
}

/** Open disc; exact clamps from the original carveDisc closure. */
export function carveDisc(
  work: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  minY: number,
): void {
  cx = Math.floor(cx);
  cy = Math.floor(cy);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        const X = cx + dx,
          Y = cy + dy;
        if (X > 1 && X < w - 2 && Y > minY && Y < h) work[X + Y * w] = 0;
      }
    }
  }
}

/** Open ellipse; exact loop shape from the original chamber carver. */
export function carveEllipse(
  work: Uint8Array,
  w: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  minY: number,
  maxY: number,
): void {
  for (let dy = -Math.ceil(ry); dy <= ry; dy++) {
    for (let dx = -Math.ceil(rx); dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
        const X = Math.floor(cx + dx),
          Y = Math.floor(cy + dy);
        if (X > 1 && X < w - 2 && Y > minY && Y < maxY) work[X + Y * w] = 0;
      }
    }
  }
}

/**
 * Sine-meander horizontal artery. Draw order is load-bearing: ph1, ph2, then
 * the base jitter ONLY if baseJitter > 0 (the original lower/gallery arteries
 * use a fixed base and draw nothing for it). If `tunnelY` is given, every
 * column's clamped row is recorded (primary artery contract).
 */
export function carveSineArtery(
  work: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
  spec: ArterySpec,
  floorBand: number,
  minY: number,
  tunnelY: number[] | null,
): void {
  const ph1 = rng.next() * Math.PI * 2,
    ph2 = rng.next() * Math.PI * 2;
  let base = h * spec.baseFrac;
  if (spec.baseJitter > 0) base += (rng.next() - 0.5) * spec.baseJitter;
  const lo = resolveRowAnchor(spec.clampLo, h, floorBand);
  const hi = resolveRowAnchor(spec.clampHi, h, floorBand);
  for (let x = 2; x < w - 2; x++) {
    let ty = base + Math.sin(x * spec.freq1 + ph1) * spec.amp1 + Math.sin(x * spec.freq2 + ph2) * spec.amp2;
    ty = clamp(ty, lo, hi);
    if (tunnelY) tunnelY[x] = Math.floor(ty);
    if (x % spec.carveEvery === 0) carveDisc(work, w, h, x, ty, spec.radius, minY);
  }
}

/**
 * Vertical shafts stitching the layers together. Draw order: all anchor x
 * jitters first (one per frac, in array order), then per shaft ph, amp, and
 * one walk draw per y step.
 */
export function carveShafts(
  work: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
  p: ShaftParams,
  floorBand: number,
  minY: number,
): void {
  const shaftXs = p.fracs.map((v) => Math.floor(w * v + (rng.next() - 0.5) * p.xJitter));
  for (const sx of shaftXs) {
    const ph = rng.next() * Math.PI * 2;
    const amp = p.ampBase + rng.next() * p.ampRand;
    let jitter = 0;
    for (let y = p.yStart; y < floorBand - p.floorMargin; y += p.yStep) {
      jitter += (rng.next() - 0.5) * p.walkStep;
      jitter = clamp(jitter, -p.walkClamp, p.walkClamp);
      const wx = Math.floor(clamp(sx + Math.sin(y * p.freq + ph) * amp + jitter, p.xClamp, w - p.xClamp));
      carveDisc(work, w, h, wx, y, p.radius, minY);
    }
  }
}

/** Elliptical chambers off the main routes. Draw order per chamber: cx, cy, rx, ry. */
export function carveChambers(
  work: Uint8Array,
  w: number,
  rng: Rng,
  p: ChamberParams,
  floorBand: number,
  minY: number,
): void {
  for (let i = 0; i < p.count; i++) {
    const cx = p.xMargin + rng.next() * (w - 2 * p.xMargin);
    const cy = p.yMin + rng.next() * (floorBand - p.ySpanOff);
    const rx = p.rxBase + rng.next() * p.rxRand,
      ry = p.ryBase + rng.next() * p.ryRand;
    carveEllipse(work, w, cx, cy, rx, ry, minY, floorBand);
  }
}

/**
 * Stalactites dripping into the larger caverns (plus occasional stalagmites).
 * The rng draw pattern is intricate and short-circuit dependent — preserved
 * exactly, including the column-skip mutation of the scan variable.
 */
export function carveStalactites(
  work: Uint8Array,
  w: number,
  rng: Rng,
  p: StalactiteParams,
  floorBand: number,
  minY: number,
): void {
  for (let x = p.xMargin; x < w - p.xMargin; x++) {
    for (let y = minY + 1; y < floorBand - p.ceilMaxOff; y++) {
      if (!(work[x + y * w] && !work[x + (y + 1) * w])) continue; // ceiling surface
      let depth = 0;
      while (depth < p.probeDepth && y + 1 + depth < floorBand && !work[x + (y + 1 + depth) * w]) depth++;
      if (depth >= p.minDepth && rng.next() < p.chance) {
        const len = p.lenBase + Math.floor(rng.next() * Math.min(p.lenRandCap, depth - p.lenDepthOff));
        let hw = Math.round(len * p.hwFrac);
        for (let s = 1; s <= len; s++) {
          const wob = rng.next() < p.wobChance ? 1 : 0;
          for (let dx = -hw - wob; dx <= hw + wob; dx++) {
            const X = x + dx;
            if (X > 1 && X < w - 2) work[X + (y + s) * w] = 1;
          }
          if (rng.next() < p.taperChance) hw = Math.max(0, hw - 1);
        }
        // occasional stalagmite below
        if (rng.next() < p.stalagChance && depth >= p.stalagMinDepth) {
          const fy = y + depth; // floor surface row is open; ground at fy+1
          const slen = p.stalagLenBase + Math.floor(rng.next() * p.stalagLenRand);
          let shw = Math.round(slen * p.stalagHwFrac);
          for (let s = 0; s < slen; s++) {
            for (let dx = -shw; dx <= shw; dx++) {
              const X = x + dx,
                Y = fy - s;
              if (X > 1 && X < w - 2 && Y > minY) work[X + Y * w] = 1;
            }
            if (rng.next() < p.stalagTaperChance) shw = Math.max(0, shw - 1);
          }
        }
        x += p.skipBase + Math.floor(rng.next() * p.skipRand);
      }
      break; // only the topmost ceiling per column
    }
  }
}

/**
 * Strip orphaned 1-2 cell rock specks floating in open space. Draws rng only
 * for specks with exactly one 4-neighbor (stream-order load-bearing).
 */
export function removeSpecks(
  work: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
  passes: number,
  loneChance: number,
): void {
  for (let pass = 0; pass < passes; pass++) {
    for (let x = 1; x < w - 1; x++) {
      for (let y = 1; y < h - 1; y++) {
        if (!work[x + y * w]) continue;
        let n = 0;
        if (work[x - 1 + y * w]) n++;
        if (work[x + 1 + y * w]) n++;
        if (work[x + (y - 1) * w]) n++;
        if (work[x + (y + 1) * w]) n++;
        if (n === 0 || (n === 1 && rng.next() < loneChance)) work[x + y * w] = 0;
      }
    }
  }
}

/* ============================================================
 * New primitives (deterministic; NOT used by the baseline path)
 * ============================================================ */

/** Solid rock above the floor band, open strip below. */
export function fillSolid(work: Uint8Array, w: number, floorBand: number): void {
  work.fill(1, 0, w * floorBand);
  work.fill(0, w * floorBand);
}

/**
 * Wall off the border columns and the top rows (y <= minY) above the floor
 * band, so carved-from-noise skeletons keep the world edges intact.
 */
export function sealBorders(work: Uint8Array, w: number, floorBand: number, minY: number): void {
  for (let y = 0; y < floorBand; y++) {
    const row = y * w;
    work[row] = 1;
    work[row + 1] = 1;
    work[row + w - 2] = 1;
    work[row + w - 1] = 1;
  }
  for (let y = 0; y <= minY && y < floorBand; y++) {
    for (let x = 0; x < w; x++) work[x + y * w] = 1;
  }
}

/** Straight stroke of discs every 2 cells from (x1,y1) to (x2,y2). No rng. */
export function carveStroke(
  work: Uint8Array,
  w: number,
  h: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  minY: number,
): void {
  const dx = x2 - x1,
    dy = y2 - y1;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
  for (let s = 0; s <= steps; s++) {
    carveDisc(work, w, h, x1 + (dx * s) / steps, y1 + (dy * s) / steps, r, minY);
  }
}

export interface NoiseFieldOpts {
  scaleX: number;
  scaleY: number;
  /** FBM octaves, capped at 3. */
  octaves: number;
  /** Cells whose FBM value exceeds this become open. */
  threshold: number;
  floorBand: number;
  minY: number;
}

/**
 * FBM value-noise carve with an EXPLICIT seed — consumes no rng stream, so it
 * can be added to a skeleton without shifting later draws (pair with
 * hashSeed(worldSeed, label)). Anisotropic scales give grain: scaleY << scaleX
 * yields tall vertical crevasses.
 */
export function carveNoiseField(
  work: Uint8Array,
  w: number,
  seed: number,
  opts: NoiseFieldOpts,
): void {
  const oct = Math.max(1, Math.min(3, Math.floor(opts.octaves)));
  for (let y = opts.minY + 1; y < opts.floorBand; y++) {
    for (let x = 2; x < w - 2; x++) {
      let sum = 0,
        norm = 0,
        amp = 1;
      let sx = x * opts.scaleX,
        sy = y * opts.scaleY;
      for (let o = 0; o < oct; o++) {
        sum += valueNoise(sx, sy, 1, seed + o * 1013) * amp;
        norm += amp;
        amp *= 0.5;
        sx *= 2.03;
        sy *= 2.03;
      }
      if (sum / norm > opts.threshold) work[x + y * w] = 0;
    }
  }
}

export interface WalkTunnelOpts {
  starts: Array<{ x: number; y: number }>;
  steps: number;
  radiusMin: number;
  radiusMax: number;
  /** Heading jitter per step, radians (± turn/2). */
  turn: number;
  /** Constant downward pull mixed into the heading (0 = none, ~1+ = plunging). */
  gravityBias: number;
  branchChance: number;
  maxBranches: number;
  floorBand: number;
  minY: number;
}

/** Branching random-walk tunnels. Walkers die when they reach the floor band. */
export function carveWalkTunnels(
  work: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
  opts: WalkTunnelOpts,
): void {
  interface Walker {
    x: number;
    y: number;
    ang: number;
    steps: number;
  }
  const queue: Walker[] = [];
  for (const s of opts.starts) {
    queue.push({ x: s.x, y: s.y, ang: rng.next() * Math.PI * 2, steps: opts.steps });
  }
  let branches = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const wk = queue[qi];
    let x = wk.x,
      y = wk.y,
      ang = wk.ang;
    for (let s = 0; s < wk.steps; s++) {
      const r = opts.radiusMin + rng.next() * (opts.radiusMax - opts.radiusMin);
      carveDisc(work, w, h, x, y, Math.floor(r), opts.minY);
      ang += (rng.next() - 0.5) * opts.turn;
      let dx = Math.cos(ang),
        dy = Math.sin(ang) + opts.gravityBias;
      const inv = 1 / (Math.hypot(dx, dy) || 1);
      const step = Math.max(2, r * 0.45);
      x += dx * inv * step;
      y += dy * inv * step;
      if (x < 12) {
        x = 12;
        ang = Math.PI - ang;
      } else if (x > w - 13) {
        x = w - 13;
        ang = Math.PI - ang;
      }
      if (y < opts.minY + 10) {
        y = opts.minY + 10;
        ang = -ang;
      }
      if (y >= opts.floorBand - 4) break;
      if (branches < opts.maxBranches && rng.next() < opts.branchChance) {
        branches++;
        const side = rng.next() < 0.5 ? -1 : 1;
        queue.push({
          x,
          y,
          ang: ang + side * (0.7 + rng.next() * 0.8),
          steps: Math.max(20, Math.floor((wk.steps - s) * 0.6)),
        });
      }
    }
  }
}

export interface RoomGridOpts {
  cellW: number;
  cellH: number;
  /** ± jitter applied to each room center, in cells. */
  jitter: number;
  roomWFrac: number;
  roomHFrac: number;
  corridorW: number;
  skipChance: number;
  floorBand: number;
  minY: number;
}

export interface RoomGridResult {
  /** Centers of carved (non-skipped) rooms. */
  centers: Array<{ x: number; y: number }>;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
}

/** Open axis-aligned rect with the standard border clamps. */
function carveRect(
  work: Uint8Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minY: number,
  maxY: number,
): void {
  const xa = Math.max(2, Math.floor(Math.min(x0, x1)));
  const xb = Math.min(w - 3, Math.floor(Math.max(x0, x1)));
  const ya = Math.max(minY + 1, Math.floor(Math.min(y0, y1)));
  const yb = Math.min(maxY - 1, Math.floor(Math.max(y0, y1)));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) work[x + y * w] = 0;
  }
}

/**
 * Jittered room-and-corridor grid. Per grid cell (row-major) the draws are:
 * x jitter, y jitter, skip roll. Corridors connect every cell to its right
 * and down neighbor (even skipped ones) so the lattice stays whole.
 */
export function carveRoomGrid(
  work: Uint8Array,
  w: number,
  rng: Rng,
  opts: RoomGridOpts,
): RoomGridResult {
  const cols = Math.max(1, Math.floor((w - 60) / opts.cellW));
  const rows = Math.max(1, Math.floor((opts.floorBand - 50) / opts.cellH));
  const originX = Math.floor((w - cols * opts.cellW) / 2);
  const originY = Math.floor((opts.floorBand - 10 - rows * opts.cellH) / 2) + 10;
  const cx = new Float64Array(cols * rows);
  const cy = new Float64Array(cols * rows);
  const present: boolean[] = new Array<boolean>(cols * rows).fill(false);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const i = gx + gy * cols;
      cx[i] = originX + gx * opts.cellW + opts.cellW / 2 + (rng.next() - 0.5) * opts.jitter;
      cy[i] = originY + gy * opts.cellH + opts.cellH / 2 + (rng.next() - 0.5) * opts.jitter;
      present[i] = rng.next() >= opts.skipChance;
    }
  }
  const halfRW = (opts.cellW * opts.roomWFrac) / 2;
  const halfRH = (opts.cellH * opts.roomHFrac) / 2;
  const centers: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < cols * rows; i++) {
    if (!present[i]) continue;
    carveRect(work, w, cx[i] - halfRW, cy[i] - halfRH, cx[i] + halfRW, cy[i] + halfRH, opts.minY, opts.floorBand);
    centers.push({ x: Math.floor(cx[i]), y: Math.floor(cy[i]) });
  }
  const halfC = opts.corridorW / 2;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const i = gx + gy * cols;
      if (gx + 1 < cols) {
        const j = i + 1;
        carveRect(work, w, cx[i], cy[i] - halfC, cx[j], cy[i] + halfC, opts.minY, opts.floorBand);
        carveRect(work, w, cx[j] - halfC, cy[i], cx[j] + halfC, cy[j], opts.minY, opts.floorBand);
      }
      if (gy + 1 < rows) {
        const j = i + cols;
        carveRect(work, w, cx[i] - halfC, cy[i], cx[i] + halfC, cy[j], opts.minY, opts.floorBand);
        carveRect(work, w, cx[i], cy[j] - halfC, cx[j], cy[j] + halfC, opts.minY, opts.floorBand);
      }
    }
  }
  return { centers, cols, rows, originX, originY };
}

export interface BubbleChainOpts {
  chains: number;
  links: number;
  rMin: number;
  rMax: number;
  throatW: number;
  floorBand: number;
  minY: number;
}

/**
 * Random-walked chains of overlapping ellipse pockets connected by throats.
 * Per chain: start x, start y; per link: rx, ry, then heading + reach draws.
 */
export function carveBubbleChains(
  work: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
  opts: BubbleChainOpts,
): void {
  const throatR = Math.max(2, Math.floor(opts.throatW / 2));
  for (let c = 0; c < opts.chains; c++) {
    let x = 60 + rng.next() * (w - 120);
    let y = 60 + rng.next() * (opts.floorBand - 160);
    let prevX = x,
      prevY = y;
    for (let l = 0; l < opts.links; l++) {
      const rx = opts.rMin + rng.next() * (opts.rMax - opts.rMin);
      const ry = opts.rMin + rng.next() * (opts.rMax - opts.rMin);
      carveEllipse(work, w, x, y, rx, ry, opts.minY, opts.floorBand);
      if (l > 0) carveStroke(work, w, h, prevX, prevY, x, y, throatR, opts.minY);
      prevX = x;
      prevY = y;
      const ang = rng.next() * Math.PI * 2;
      const d = rx + opts.rMin + rng.next() * 18;
      x = clamp(x + Math.cos(ang) * d, 40, w - 40);
      y = clamp(y + Math.sin(ang) * d, 60, opts.floorBand - 40);
    }
  }
}

export interface ConnectivityOpts {
  /** Components smaller than this (in full-res open cells) are left alone. */
  minArea: number;
  tunnelRadius: number;
  floorBand: number;
  minY: number;
}

/**
 * Safety net for non-baseline skeletons (mandatory last step): flood-fill the
 * open space on a 1:4 downsampled grid, then carve an L-shaped tunnel from
 * every component with area >= minArea to the nearest cell of the largest
 * component. Returns the number of components joined.
 */
export function ensureConnectivity(
  work: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
  opts: ConnectivityOpts,
): number {
  const DS = 4;
  const dw = Math.ceil(w / DS),
    dh = Math.ceil(h / DS);
  const openCount = new Int32Array(dw * dh);
  for (let y = 0; y < h; y++) {
    const dy = (y / DS) | 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!work[x + row]) openCount[((x / DS) | 0) + dy * dw]++;
    }
  }

  // Label 4-connected components of down-cells containing any open space.
  const label = new Int32Array(dw * dh).fill(-1);
  const stack = new Int32Array(dw * dh);
  const compArea: number[] = [];
  const compSeed: number[] = [];
  for (let i = 0; i < dw * dh; i++) {
    if (openCount[i] === 0 || label[i] >= 0) continue;
    const id = compArea.length;
    compArea.push(0);
    compSeed.push(i);
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    while (sp > 0) {
      const c = stack[--sp];
      compArea[id] += openCount[c];
      const cx = c % dw,
        cy = (c / dw) | 0;
      if (cx > 0 && openCount[c - 1] > 0 && label[c - 1] < 0) {
        label[c - 1] = id;
        stack[sp++] = c - 1;
      }
      if (cx + 1 < dw && openCount[c + 1] > 0 && label[c + 1] < 0) {
        label[c + 1] = id;
        stack[sp++] = c + 1;
      }
      if (cy > 0 && openCount[c - dw] > 0 && label[c - dw] < 0) {
        label[c - dw] = id;
        stack[sp++] = c - dw;
      }
      if (cy + 1 < dh && openCount[c + dw] > 0 && label[c + dw] < 0) {
        label[c + dw] = id;
        stack[sp++] = c + dw;
      }
    }
  }
  if (compArea.length <= 1) return 0;

  let largest = 0;
  for (let i = 1; i < compArea.length; i++) if (compArea[i] > compArea[largest]) largest = i;

  // BFS scratch (geometric, walls ignored) reused across components.
  const visited = new Int32Array(dw * dh);
  const bfs = new Int32Array(dw * dh);
  let generation = 0;
  let joined = 0;
  for (let id = 0; id < compArea.length; id++) {
    if (id === largest || compArea[id] < opts.minArea) continue;
    generation++;
    let head = 0,
      tail = 0;
    bfs[tail++] = compSeed[id];
    visited[compSeed[id]] = generation;
    let target = -1;
    while (head < tail && target < 0) {
      const c = bfs[head++];
      if (label[c] === largest) {
        target = c;
        break;
      }
      const cx = c % dw,
        cy = (c / dw) | 0;
      if (cx > 0 && visited[c - 1] !== generation) {
        visited[c - 1] = generation;
        bfs[tail++] = c - 1;
      }
      if (cx + 1 < dw && visited[c + 1] !== generation) {
        visited[c + 1] = generation;
        bfs[tail++] = c + 1;
      }
      if (cy > 0 && visited[c - dw] !== generation) {
        visited[c - dw] = generation;
        bfs[tail++] = c - dw;
      }
      if (cy + 1 < dh && visited[c + dw] !== generation) {
        visited[c + dw] = generation;
        bfs[tail++] = c + dw;
      }
    }
    if (target < 0) continue;
    const sx = (compSeed[id] % dw) * DS + 2,
      sy = ((compSeed[id] / dw) | 0) * DS + 2;
    const tx = (target % dw) * DS + 2,
      ty = ((target / dw) | 0) * DS + 2;
    if (rng.next() < 0.5) {
      carveStroke(work, w, h, sx, sy, tx, sy, opts.tunnelRadius, opts.minY);
      carveStroke(work, w, h, tx, sy, tx, ty, opts.tunnelRadius, opts.minY);
    } else {
      carveStroke(work, w, h, sx, sy, sx, ty, opts.tunnelRadius, opts.minY);
      carveStroke(work, w, h, sx, ty, tx, ty, opts.tunnelRadius, opts.minY);
    }
    joined++;
  }
  return joined;
}
