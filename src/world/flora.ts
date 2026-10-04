import type { SurfaceFrondPose } from '@/world/foliageGeometry';

/**
 * Organic plant grammars for the damp surface roots (docs/FOREGROUND-COVER.md).
 *
 * One moss root grows one whole plant: a seeded species, then a seeded body —
 * frond count, lengths, arcs, leaf tilts and layers all differ per root, so no
 * two clumps share a silhouette. Every organ is a quadratic midrib plus a
 * width profile. The same blades are rasterised by render/FloraPainter, swept
 * for heat contact, and sampled for foreground concealment. Pure: no world,
 * no clock (wind and flutter are cosmetic and only exist when `time` is given).
 */

export const FLORA_STEM = 0;
export const FLORA_BLADE = 1;
export const FLORA_LEAF = 2;
export const FLORA_BULB = 3;
export const FLORA_CURL = 4;
export const FLORA_HEAD = 5;
export const FLORA_PETAL = 6;

export const FERN = 0;
export const BROADLEAF = 1;
export const SEDGE = 2;
export const LILY = 3;
export const GRASS = 4;
export const SPRIG = 5;
export const CLOVER = 6;
export const CUSHION = 7;
export const DRAPE = 8;

/** Foreground species, weighted: ferns and broad leaves lead, glowing lilies are the rare treat. */
const FRONT = [FERN, FERN, FERN, BROADLEAF, BROADLEAF, SEDGE, SEDGE, LILY] as const;
const GROUND = [GRASS, GRASS, GRASS, SPRIG, SPRIG, CLOVER, CUSHION, CUSHION, CUSHION] as const;

export interface FloraBlades {
  count: number;
  species: number;
  /** Ground line (y) and drawn height after charring: the painter's shading frame. */
  rootX: number;
  rootY: number;
  height: number;
  /** Organs that emit their own light (spore bulbs): the painter adds a halo. */
  glowing: boolean;
  readonly ax: Float32Array; readonly ay: Float32Array;
  readonly cx: Float32Array; readonly cy: Float32Array;
  readonly bx: Float32Array; readonly by: Float32Array;
  /** Half-width at the widest point (cells). For bulbs/petals/curls: the radius. */
  readonly width: Float32Array;
  readonly kind: Uint8Array;
  /** 0 back, 1 middle, 2 front (draw order and depth shading). */
  readonly layer: Uint8Array;
  /** Per-organ shade offset, about ±0.12. */
  readonly tone: Float32Array;
}

export function createFloraBlades(capacity = 900): FloraBlades {
  const f = (): Float32Array => new Float32Array(capacity);
  return { count: 0, species: 0, rootX: 0, rootY: 0, height: 0, glowing: false,
    ax: f(), ay: f(), cx: f(), cy: f(), bx: f(), by: f(), width: f(), tone: f(),
    kind: new Uint8Array(capacity), layer: new Uint8Array(capacity) };
}

export function floraSpecies(seed: number, side: number, foreground: boolean): number {
  if (side !== 0) return DRAPE;
  const h = Math.imul(seed ^ (seed >>> 13), 0x5bd1e995) >>> 0;
  return foreground ? FRONT[(h >>> 9) % FRONT.length] : GROUND[(h >>> 9) % GROUND.length];
}

/** Stable plant height. Foreground plants stand taller than the alchemist's torso. */
export function floraHeight(seed: number, side: number, foreground: boolean, aquatic: boolean): number {
  const v = (seed >>> 3) % 1000 / 1000;
  switch (floraSpecies(seed, side, foreground)) {
    case FERN: return 27 + v * 9;
    case BROADLEAF: return 25 + v * 8;
    case SEDGE: return 30 + v * 11;
    case LILY: return 28 + v * 9;
    case DRAPE: return 8 + v * 18;
    case SPRIG: return 6 + v * 6;
    case CLOVER: return 3 + v * 4;
    case CUSHION: return 2.5 + v * 2.5;
    default: return aquatic ? 12 + v * 16 : 4 + v * 8;
  }
}

// ---------------------------------------------------------------- generator
// Module state keeps the per-frame build allocation-free (plants are built
// many times per frame: one draw, heat sweeps, cover samples).
let rs = 0;
const rand = (): number => {
  rs = (rs + 0x6d2b79f5) | 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let out: FloraBlades;
let rootX = 0, rootY = 0, plantH = 1, lean = 0, part = 0, clock = 0, animate = false, hanging = false, flex = 1;
let wx = 0, wy = 0;

/** The plant's deformation field: body/wind lean grows with height squared,
 * a passing body parts the crown away from its centre line, and (render only)
 * each organ flutters on its own phase. Attached organs share the field. */
function warp(x: number, y: number, phase: number): void {
  const hf = Math.min(1.3, Math.max(0, (hanging ? y - rootY : rootY - y) / plantH));
  const away = x - rootX;
  let d = lean * hf * hf + Math.sign(away) * Math.min(1, Math.abs(away) / 4) * part * 3.2 * hf;
  if (animate) d += Math.sin(clock * .055 + phase) * .3 * flex * hf;
  wx = x + d;
  wy = y + Math.abs(lean * hf * hf) * .22 * (hanging ? -1 : 1);
}

function organ(kind: number, ax: number, ay: number, cx: number, cy: number, bx: number, by: number,
  width: number, layer: number, tone: number): void {
  const k = out.count;
  if (k >= out.kind.length) return;
  out.ax[k] = ax; out.ay[k] = ay; out.cx[k] = cx; out.cy[k] = cy; out.bx[k] = bx; out.by[k] = by;
  out.width[k] = width; out.kind[k] = kind; out.layer[k] = layer; out.tone[k] = tone;
  out.count = k + 1;
}

/** An organ whose three control points ride the deformation field. */
function warped(kind: number, ax: number, ay: number, cx: number, cy: number, bx: number, by: number,
  width: number, layer: number, tone: number, phase: number): void {
  warp(ax, ay, phase); const a0 = wx, a1 = wy;
  warp(cx, cy, phase); const c0 = wx, c1 = wy;
  warp(bx, by, phase);
  organ(kind, a0, a1, c0, c1, wx, wy, width, layer, tone);
}

let px = 0, py = 0, tx = 0, ty = 0;
function along(k: number, t: number): void {
  const u = 1 - t;
  px = u * u * out.ax[k] + 2 * u * t * out.cx[k] + t * t * out.bx[k];
  py = u * u * out.ay[k] + 2 * u * t * out.cy[k] + t * t * out.by[k];
  const dx = 2 * u * (out.cx[k] - out.ax[k]) + 2 * t * (out.bx[k] - out.cx[k]);
  const dy = 2 * u * (out.cy[k] - out.ay[k]) + 2 * t * (out.by[k] - out.cy[k]);
  const l = Math.hypot(dx, dy) || 1;
  tx = dx / l; ty = dy / l;
}

const pickLayer = (i: number): number => (i * 2 + (rand() < .5 ? 0 : 1)) % 3;

/** Arching fronds with staggered pinnae, outer fronds bowing past their peak. */
function fern(H: number, fronds: number, scale: number, fiddleheads: boolean): void {
  for (let i = 0; i < fronds; i++) {
    const rank = (fronds === 1 ? 0 : i / (fronds - 1) * 2 - 1) + (rand() - .5) * .34;
    const a = Math.min(1, Math.abs(rank)), s = rank < 0 ? -1 : 1;
    const L = H * (1.05 - a * .22) * (.84 + rand() * .2);
    const ax = rootX + rank * 1.5 * scale;
    const cx = ax + s * L * (.08 + a * .4), cy = rootY - L * (.74 + a * .16);
    const bx = ax + s * L * (.2 + a * .8) + (rand() - .5) * L * .1, by = rootY - L * (.95 - a * .72 + rand() * .06);
    const layer = pickLayer(i), tone = (rand() - .5) * .14, phase = rand() * 6.28;
    warped(FLORA_STEM, ax, rootY, cx, cy, bx, by, .38 * scale, layer, tone - .1, phase);
    const rachis = out.count - 1;
    const pinnae = Math.max(3, Math.floor(L / (2.15 * scale)));
    for (let j = 1; j <= pinnae; j++) {
      for (const side of [-1, 1]) {
        const t = .07 + .9 * (j - (side < 0 ? .45 : 0)) / pinnae;
        along(rachis, t);
        const env = Math.pow(Math.sin(Math.PI * Math.min(1, .14 + t * .92)), .55) * (1.1 - t * .5);
        const len = Math.max(.75 * scale, L * .17 * env * (.9 + rand() * .2));
        const ang = side * (1.0 + rand() * .2);
        let dx = tx * Math.cos(ang) - ty * Math.sin(ang), dy = tx * Math.sin(ang) + ty * Math.cos(ang);
        const upper = dy < 0;
        dy += .7; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const flick = animate ? Math.sin(clock * .09 + phase + j * .7) * .18 * flex : 0;
        organ(FLORA_LEAF, px, py, px + dx * len * .5, py + dy * len * .5 + len * .1,
          px + dx * len + flick, py + dy * len + len * .08, Math.max(.42 * scale, Math.min(1.05, len * .21)),
          layer, tone + (upper ? .1 : -.08));
      }
    }
  }
  if (!fiddleheads) return;
  const curls = rand() < .45 ? 2 : 1;
  for (let i = 0; i < curls; i++) {
    const h = H * (.26 + rand() * .16), lx = rootX + (rand() - .5) * 4, s = rand() < .5 ? -1 : 1;
    const phase = rand() * 6.28;
    warped(FLORA_STEM, lx, rootY, lx + s * .6, rootY - h * .65, lx + s * 1.4, rootY - h, .4, 0, -.05, phase);
    const k = out.count - 1;
    organ(FLORA_CURL, out.bx[k], out.by[k], out.bx[k] + s, out.by[k], out.bx[k] + s, out.by[k], 1.25 + rand() * .35, 0, .04);
  }
}

/** Broad, heart-shaped leaves on long petioles at staggered heights and tilts. */
function broadleaf(H: number): void {
  const n = 4 + Math.floor(rand() * 3);
  const first = rand() < .5 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    // The first two hang over the crown's centre, high and middle: the cover a body hides behind.
    const s = i === 0 ? first : i === 1 ? -first : (i % 2 ? -first : first) * (rand() < .2 ? -1 : 1);
    const tier = i === 0 ? .82 + rand() * .1 : i === 1 ? .5 + rand() * .08 : .24 + rand() * .6;
    const hq = H * tier * .78, qx = rootX + s * (i < 2 ? .4 + rand() : 1.5 + rand() * H * .2);
    const ax = rootX + s * rand() * 1.3, layer = i === 0 ? 2 : pickLayer(i), phase = rand() * 6.28;
    warped(FLORA_STEM, ax, rootY, ax + s * .4, rootY - hq * .72, qx, rootY - hq, .5, layer, -.12, phase);
    const k = out.count - 1, qx2 = out.bx[k], qy2 = out.by[k];
    const Ll = H * (.36 + rand() * .16) * (i === 0 ? 1.05 : 1);
    const phi = i < 2 ? 1.1 + rand() * .28 : -.35 + rand() * 1.15;
    const dx = s * Math.cos(phi), dy = Math.sin(phi);
    const fore = i < 2 ? .8 + rand() * .2 : .55 + rand() * .45;
    warp(qx + dx * Ll * .5, rootY - hq + dy * Ll * .5 - Ll * .16, phase); const c0 = wx, c1 = wy;
    warp(qx + dx * Ll, rootY - hq + dy * Ll + Ll * .06, phase);
    organ(FLORA_LEAF, qx2, qy2, c0, c1, wx, wy, Ll * .33 * fore, layer, (rand() - .5) * .16);
  }
  // Young leaves still rolled, standing up out of the crown.
  const young = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < young; i++) {
    const lx = rootX + (rand() - .5) * 3, h = H * (.4 + rand() * .2), s = rand() < .5 ? -1 : 1;
    warped(FLORA_LEAF, lx, rootY, lx + s * 1.2, rootY - h * .6, lx + s * (1.5 + rand() * 2), rootY - h,
      1.15 + rand() * .5, 1, .06, rand() * 6.28);
  }
}

/** A dense sedge: arching straps, a few snapped and folded, and seed heads. */
function sedge(H: number, n: number, width: number, spread: number, heads: number): void {
  for (let i = 0; i < n; i++) {
    const x0 = rootX + (rand() - .5) * spread;
    const th = (rand() - .5) * 1.05 + (x0 - rootX) * .07;
    const L = H * (.42 + rand() * .62), s = th < 0 ? -1 : 1;
    const sx = Math.sin(th), cy = Math.cos(th);
    const layer = pickLayer(i), tone = (rand() - .5) * .18, phase = rand() * 6.28;
    const w = width * (.8 + rand() * .45);
    if (heads > 0 && rand() < .16) {
      // Snapped: the lower part stands, the upper part folds over and hangs.
      const k = .5 + rand() * .2;
      const kx = x0 + sx * L * k, ky = rootY - cy * L * k;
      warped(FLORA_BLADE, x0, rootY, x0 + sx * L * k * .5, rootY - cy * L * k * .55, kx, ky, w, layer, tone, phase);
      const r = L * (1 - k) * .9;
      warped(FLORA_BLADE, kx, ky, kx + s * r * .45, ky - r * .05, kx + s * r * .75, ky + r * .55, w * .55, layer, tone - .05, phase);
      continue;
    }
    warped(FLORA_BLADE, x0, rootY, x0 + sx * L * .5, rootY - cy * L * .62,
      x0 + sx * L * .92 + s * L * .14 * rand(), rootY - cy * L * .8 + L * .2 * Math.abs(sx), w, layer, tone, phase);
  }
  for (let i = 0; i < heads; i++) {
    const x0 = rootX + (rand() - .5) * 3, h = H * (.92 + rand() * .2), l = (rand() - .5) * 4;
    const phase = rand() * 6.28;
    warped(FLORA_STEM, x0, rootY, x0 + l * .4, rootY - h * .55, x0 + l, rootY - h, .32, 1, -.05, phase);
    const k = out.count - 1;
    along(k, .82);
    organ(FLORA_HEAD, px, py, (px + out.bx[k]) / 2, (py + out.by[k]) / 2, out.bx[k], out.by[k], .85, 2, 0);
  }
}

/** A strap-leaf rosette sending up nodding stalks that end in spore bulbs. */
function lily(H: number): void {
  const n = 7 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const r = (i / (n - 1)) * 2 - 1 + (rand() - .5) * .3, a = Math.min(1, Math.abs(r)), s = r < 0 ? -1 : 1;
    const L = H * (a < .45 ? .52 + rand() * .14 : .3 + rand() * .18);
    const ax = rootX + r * 1.4;
    warped(FLORA_BLADE, ax, rootY, ax + s * L * (.12 + a * .3), rootY - L * .84,
      ax + s * L * (.2 + a * .75), rootY - L * (.95 - a * .62), (a < .45 ? 1.8 : 1.4) + rand() * .55, pickLayer(i), (rand() - .5) * .14, rand() * 6.28);
  }
  const stalks = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < stalks; i++) {
    const x0 = rootX + (rand() - .5) * 3, h = H * (.75 + rand() * .3), l = (rand() - .5) * H * .22;
    const nod = (l < 0 ? -1 : 1) * h * (.14 + rand() * .1), phase = rand() * 6.28;
    warped(FLORA_STEM, x0, rootY, x0 + l, rootY - h * 1.06, x0 + l * 1.3 + nod, rootY - h * .88, .4, 1, -.04, phase);
    const k = out.count - 1;
    organ(FLORA_BULB, out.bx[k], out.by[k] + 1, out.bx[k], out.by[k] + 1, out.bx[k], out.by[k] + 1, 1.15 + rand() * .55, 2, rand() * 6.28);
    if (rand() < .6) {
      along(k, .7);
      const bud = (rand() < .5 ? -1 : 1) * 2;
      organ(FLORA_STEM, px, py, px + bud * .5, py, px + bud, py + 1.4, .25, 1, -.04);
      organ(FLORA_BULB, px + bud, py + 2.2, px + bud, py + 2.2, px + bud, py + 2.2, .6 + rand() * .25, 2, rand() * 6.28);
    }
  }
  out.glowing = true;
}

function clover(H: number): void {
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const x0 = rootX + (rand() - .5) * 4, h = H * (.5 + rand() * .55), l = (rand() - .5) * 2.2, phase = rand() * 6.28;
    warped(FLORA_STEM, x0, rootY, x0 + l * .3, rootY - h * .6, x0 + l, rootY - h, .22, 1, -.06, phase);
    const k = out.count - 1, qx = out.bx[k], qy = out.by[k];
    const lw = .75 + rand() * .3;
    organ(FLORA_LEAF, qx, qy, qx - .9, qy - .5, qx - 1.8, qy - .1, lw, 1, .05);
    organ(FLORA_LEAF, qx, qy, qx + .9, qy - .5, qx + 1.8, qy - .1, lw, 1, -.02);
    if (rand() < .22) organ(FLORA_PETAL, qx, qy - 1.2, qx, qy - 1.2, qx, qy - 1.2, .55, 2, rand());
  }
}

function cushion(H: number): void {
  const n = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const x0 = rootX + (rand() - .5) * 6, h = H * (.6 + rand() * .5), l = (rand() - .5) * 1.6;
    organ(FLORA_LEAF, x0, rootY, x0 + l * .5, rootY - h * .7, x0 + l, rootY - h, .9 + rand() * .6, pickLayer(i), (rand() - .5) * .2);
  }
  if (rand() < .35) for (let i = 0; i < 3; i++) {
    const x0 = rootX + (rand() - .5) * 4, h = H * (1.2 + rand() * .8);
    organ(FLORA_STEM, x0, rootY, x0, rootY - h * .5, x0 + (rand() - .5), rootY - h, .15, 1, 0);
    organ(FLORA_PETAL, out.bx[out.count - 1], rootY - h, out.bx[out.count - 1], rootY - h, out.bx[out.count - 1], rootY - h, .35, 2, .9);
  }
}

/** Wall roots hang: one to three strands spill out of the joint and trail down. */
function drape(H: number, side: number): void {
  const strands = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < strands; i++) {
    const L = H * (.55 + rand() * .45), out0 = side * (1.6 + rand() * 2.4), phase = rand() * 6.28;
    const y0 = rootY + (rand() - .5) * 2;
    warped(FLORA_STEM, rootX, y0, rootX + out0 * 1.2, y0 + L * .2, rootX + out0 + (rand() - .5) * 2, y0 + L, .3, i % 3, -.06, phase);
    const k = out.count - 1;
    const leaves = Math.max(2, Math.floor(L / 1.7));
    for (let j = 1; j <= leaves; j++) {
      along(k, j / (leaves + .5));
      const s = j % 2 ? 1 : -1, len = 1.3 + rand() * 1.1 * (1 - j / leaves * .4);
      organ(FLORA_LEAF, px, py, px + s * len * .55, py + len * .1, px + s * len, py + len * .55, .55 + rand() * .2, i % 3, s * .06);
    }
  }
}

/**
 * Build the plant a root grows. `time` (ticks) animates gusts and flutter for
 * drawing; gameplay passes null and gets the plant's rest pose under its
 * current lean and parting, which differs from the drawn one by under a cell.
 */
export function buildFlora(p: SurfaceFrondPose, time: number | null, into: FloraBlades): FloraBlades {
  out = into; out.count = 0; out.glowing = false;
  const species = floraSpecies(p.seed, p.side, Boolean(p.foreground));
  const H = Math.max(1.5, p.height * (1 - p.burn * .75));
  out.species = species; out.height = H;
  hanging = species === DRAPE;
  rootX = p.x + .5 + (hanging ? -p.side * .5 : 0);
  rootY = hanging ? p.y + .5 : p.y + 1;
  out.rootX = rootX; out.rootY = rootY;
  const big = Boolean(p.foreground);
  // Per-leaf flutter only on cover plants: on a ground tuft it is a third of a
  // pixel, and leaving it out lets a still tuft keep its cached bitmap.
  plantH = H; part = p.part; animate = time !== null && big; clock = time ?? 0;
  flex = big ? 1.1 : .55;
  lean = floraLean(p, time, H);
  rs = p.seed ^ 0x9e3779b9;
  switch (species) {
    case FERN: fern(H, 5 + Math.floor(rand() * 3), 1, true); break;
    case BROADLEAF: broadleaf(H); break;
    case SEDGE: sedge(H, 14 + Math.floor(rand() * 8), .95, 6, 2 + Math.floor(rand() * 2)); break;
    case LILY: lily(H); break;
    case SPRIG: fern(H, 3 + Math.floor(rand() * 2), .55, false); break;
    case CLOVER: clover(H); break;
    case CUSHION: cushion(H); break;
    case DRAPE: drape(H, p.side); break;
    default: sedge(H, 5 + Math.floor(rand() * 5), .5, 3, 0);
  }
  return out;
}

/** The crown's lean in cells at full height: body/spring angle plus the
 * level-wide traveling gust (drawing only). Ground tufts lean the old tufts'
 * way; tall plants bend less per unit height. */
export function floraLean(p: SurfaceFrondPose, time: number | null, height = p.height * (1 - p.burn * .75)): number {
  const big = Boolean(p.foreground), x = p.x + .5;
  let l = p.angle * Math.max(1.5, height) * (big ? .42 : 1);
  if (time !== null) l += (Math.sin(time * .013 - x * .021) + .5 * Math.sin(time * .031 - x * .05 + 1.7)) * (big ? .7 : .35);
  return l;
}

const scratch = createFloraBlades();

/** Midrib segments (three per organ) for heat contact. */
export function visitFloraSegments(p: SurfaceFrondPose,
  visit: (ax: number, ay: number, bx: number, by: number, leaf: boolean) => void): void {
  const b = buildFlora(p, null, scratch);
  for (let k = 0; k < b.count; k++) {
    const kind = b.kind[k];
    if (kind === FLORA_BULB || kind === FLORA_PETAL || kind === FLORA_CURL) {
      visit(b.ax[k], b.ay[k], b.bx[k], b.by[k], true); continue;
    }
    let lx = b.ax[k], ly = b.ay[k];
    for (let s = 1; s <= 3; s++) {
      along(k, s / 3);
      visit(lx, ly, px, py, kind !== FLORA_STEM);
      lx = px; ly = py;
    }
  }
}

/** Half-width of an organ at `t` along its midrib (shared with the painter). */
export function floraHalfWidth(kind: number, t: number, w: number): number {
  switch (kind) {
    case FLORA_BLADE: return w * Math.pow(1 - t, .72) * (t < .1 ? .65 + t * 3.5 : 1);
    case FLORA_LEAF: return w * Math.pow(Math.sin(Math.PI * Math.pow(t, .8)), .72);
    case FLORA_HEAD: return w * (t < .15 ? t / .15 : t > .88 ? (1 - t) / .12 : 1);
    default: return w;
  }
}

/**
 * Torso samples (3×3: rows y-14, y-10, y-6; columns x-3, x, x+3) hidden by
 * this plant, as a 9-bit mask. A sample counts when it lies inside an organ's
 * outline, with a small allowance for the body's own width.
 */
export function floraCoverMask(p: SurfaceFrondPose, x: number, y: number): number {
  const b = buildFlora(p, null, scratch);
  let mask = 0;
  for (let k = 0; k < b.count && mask !== 511; k++) {
    const kind = b.kind[k];
    if (kind === FLORA_STEM || kind === FLORA_PETAL) continue;
    const round = kind === FLORA_BULB || kind === FLORA_CURL;
    for (let s = 0; s <= (round ? 0 : 8); s++) {
      const t = s / 8;
      if (round) { px = b.bx[k]; py = b.by[k]; } else along(k, t);
      const r = (round ? b.width[k] : floraHalfWidth(kind, t, b.width[k])) + .85;
      if (py < y - 14 - r || py > y - 6 + r || px < x - 3 - r || px > x + 3 + r) continue;
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        const dx = x - 3 + col * 3 - px, dy = y - 14 + row * 4 - py;
        if (dx * dx + dy * dy <= r * r) mask |= 1 << (row * 3 + col);
      }
    }
  }
  return mask;
}
