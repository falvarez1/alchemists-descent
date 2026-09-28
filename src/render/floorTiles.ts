/**
 * Natural-rock material tiles for the procedural floors, painted in code at
 * load (no download). Floor 1's hand-built Works keep the authored terrain
 * atlas; floors 2–4 pair that atlas's masonry (for built faces) with one of
 * these tiles (for the cave). Each tile is a 256×256 seamless torus in one
 * slot of a 512×768 RGBA sheet (two columns, three rows):
 *
 *   slot 0  Rot Gardens   peat and root-bound soil with buried stones
 *   slot 1  Drowned Cisterns  bedded slate, jointed and pitted, seep streaks
 *   slot 2  Kiln Heart    columnar basalt, soot-dark with hairline cracks
 *   slot 3  spare (neutral mineral rock, for off-spine looks)
 *   slot 4  Cold Store    rime-crusted granite blocks veined with blue ice
 *   slot 5  Glass Galleries  faceted glassy rock and ground-lens masonry
 *
 * RGB is the albedo (graded again per floor by FloorLook.natural). ALPHA is a
 * feature mask the sampler colours per floor — root threads, seep streaks,
 * ember veins — so their colour, strength and depth window stay tunable
 * without repainting. Every compose path samples these same pixels.
 *
 * Painting rules: clustered pixel steps from small ramps (no smooth gradients,
 * no white-noise grain), features at the terrain atlas's scale (two texels per
 * world cell on the fine WebGL path), and every feature wraps on the torus so
 * the tile repeats without a seam.
 */

export const FLOOR_TILE = 256;
/** Sheet width (two tiles); also the row stride of floorTilePixels(). */
export const FLOOR_SHEET = FLOOR_TILE * 2;
/** Sheet height (three rows of tiles). */
export const FLOOR_SHEET_H = FLOOR_TILE * 3;

type Ramp = readonly (readonly [number, number, number])[];

let sheet: Uint8ClampedArray | null = null;

/** The 512×768 RGBA sheet, painted once on first use (deterministic). */
export function floorTilePixels(): Uint8ClampedArray {
  if (!sheet) sheet = paintSheet();
  return sheet;
}

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (v: number): number => ((v % FLOOR_TILE) + FLOOR_TILE) % FLOOR_TILE;

/** Periodic value noise on the tile torus (cell = lattice spacing, divides 256). */
function valueNoise(seed: number, cell: number): (x: number, y: number) => number {
  const n = FLOOR_TILE / cell;
  const next = rng(seed);
  const lattice = new Float32Array(n * n);
  for (let i = 0; i < lattice.length; i++) lattice[i] = next();
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const ix0 = ((x0 % n) + n) % n, iy0 = ((y0 % n) + n) % n;
    const ix1 = (ix0 + 1) % n, iy1 = (iy0 + 1) % n;
    const a = lattice[ix0 + iy0 * n], b = lattice[ix1 + iy0 * n];
    const c = lattice[ix0 + iy1 * n], d = lattice[ix1 + iy1 * n];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

function fbm(seed: number, cells: readonly number[]): (x: number, y: number) => number {
  const layers = cells.map((cell, i) => valueNoise(seed + i * 101, cell));
  let total = 0;
  for (let i = 0; i < cells.length; i++) total += 1 / (1 << i);
  return (x, y) => {
    let v = 0;
    for (let i = 0; i < layers.length; i++) v += layers[i](x, y) / (1 << i);
    return v / total;
  };
}

interface Voronoi {
  /** Nearest site index, F1 and F2 distances, and the nearest site position. */
  query(x: number, y: number): { id: number; f1: number; f2: number; id2: number; sx: number; sy: number };
}

/** Jittered-grid Voronoi on the torus; `squash` < 1 stretches cells vertically. */
function voronoi(seed: number, gx: number, gy: number, squash: number, jitter = 0.85): Voronoi {
  const next = rng(seed);
  const cw = FLOOR_TILE / gx, ch = FLOOR_TILE / gy;
  const px = new Float32Array(gx * gy), py = new Float32Array(gx * gy);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    px[i + j * gx] = (i + 0.5 + (next() - 0.5) * jitter) * cw;
    py[i + j * gx] = (j + 0.5 + (next() - 0.5) * jitter) * ch;
  }
  const out = { id: 0, f1: 0, f2: 0, id2: 0, sx: 0, sy: 0 };
  return {
    query(x, y) {
      const ci = Math.floor(x / cw), cj = Math.floor(y / ch);
      let f1 = Infinity, f2 = Infinity, id = 0, id2 = 0, sx = 0, sy = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = ((ci + di) % gx + gx) % gx, jj = ((cj + dj) % gy + gy) % gy;
        const k = ii + jj * gx;
        // Nearest periodic image of the site.
        let dx = px[k] - x, dy = py[k] - y;
        dx -= Math.round(dx / FLOOR_TILE) * FLOOR_TILE;
        dy -= Math.round(dy / FLOOR_TILE) * FLOOR_TILE;
        const d = Math.hypot(dx, dy * squash);
        if (d < f1) { f2 = f1; id2 = id; f1 = d; id = k; sx = x + dx; sy = y + dy; }
        else if (d < f2) { f2 = d; id2 = k; }
      }
      out.id = id; out.f1 = f1; out.f2 = f2; out.id2 = id2; out.sx = sx; out.sy = sy;
      return out;
    },
  };
}

const hash2 = (a: number, b: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

interface Tile { rgb: Uint8Array; mask: Uint8Array }

function newTile(): Tile {
  return { rgb: new Uint8Array(FLOOR_TILE * FLOOR_TILE * 3), mask: new Uint8Array(FLOOR_TILE * FLOOR_TILE) };
}

function put(tile: Tile, x: number, y: number, c: readonly [number, number, number]): void {
  const i = (wrap(y) * FLOOR_TILE + wrap(x)) * 3;
  tile.rgb[i] = c[0]; tile.rgb[i + 1] = c[1]; tile.rgb[i + 2] = c[2];
}

function tone(ramp: Ramp, i: number): readonly [number, number, number] {
  return ramp[Math.max(0, Math.min(ramp.length - 1, i))];
}

/** A wandering 1-texel thread (roots, seeps) drawn into the mask and colour. */
function thread(tile: Tile, next: () => number, x: number, y: number, length: number,
  down: number, wander: number, value: number, color: readonly [number, number, number] | null, depth = 0): void {
  let fx = x, fy = y, heading = (next() - 0.5) * wander;
  for (let s = 0; s < length; s++) {
    const ix = wrap(Math.round(fx)), iy = wrap(Math.round(fy));
    const i = iy * FLOOR_TILE + ix;
    const fade = 1 - (s / length) * 0.55;
    tile.mask[i] = Math.max(tile.mask[i], Math.round(value * fade));
    if (color) put(tile, ix, iy, color);
    heading = Math.max(-1.2, Math.min(1.2, heading + (next() - 0.5) * wander));
    fx += heading; fy += down;
    if (depth < 2 && next() < 0.035) {
      thread(tile, next, fx, fy, Math.floor(length * (0.25 + next() * 0.3)), down * 0.9, wander * 1.3, value * 0.8, color, depth + 1);
    }
  }
}

// ---------------------------------------------------------------- Rot Gardens
const SOIL: Ramp = [[20, 17, 15], [28, 24, 20], [37, 31, 25], [46, 39, 30], [55, 47, 35], [65, 56, 41]];
const MOULD: Ramp = [[17, 21, 18], [24, 30, 25], [31, 39, 32], [39, 48, 39], [47, 57, 46], [57, 67, 54]];
const SOIL_STONE: Ramp = [[26, 27, 25], [36, 38, 34], [46, 48, 43], [57, 59, 52], [69, 71, 62]];

function paintRotGardens(): Tile {
  const tile = newTile(), next = rng(0x2a17);
  // Humus in slumped, gently tilted layers: horizontal-biased noise quantized
  // to the ramp, so the soil reads as bedded earth, not static.
  const bed = fbm(11, [64, 32, 16]);
  const grain = fbm(12, [16, 8]);
  // Mould: broad sickly blooms where the soil rots green-grey.
  const mould = fbm(15, [32, 16, 8]);
  for (let y = 0; y < FLOOR_TILE; y++) for (let x = 0; x < FLOOR_TILE; x++) {
    const warp = bed(x, y * 0.5) * 22;
    const band = Math.sin(((y + warp) / FLOOR_TILE) * Math.PI * 2 * 9) * 0.5 + 0.5;
    const v = band * 0.45 + grain(x, y) * 0.55;
    const rot = mould(x, y);
    const rotted = rot > 0.63 || (rot > 0.58 && ((x + y) & 1) === 0 && ((x >> 1) & 1) === (y & 1));
    put(tile, x, y, tone(rotted ? MOULD : SOIL, 1 + Math.floor(v * 4.2)));
  }
  // Buried stones and clods: a sparse subset of Voronoi sites, each an
  // irregular flattened lump (noise-bitten outline, wider than tall) lit from
  // the upper left, sitting in a dark contact seam. Mostly small; a few big.
  const stones = voronoi(13, 10, 12, 1.4, 0.95);
  const bite = fbm(14, [8, 4]);
  for (let y = 0; y < FLOOR_TILE; y++) for (let x = 0; x < FLOOR_TILE; x++) {
    const q = stones.query(x, y);
    if (hash2(q.id, 7) > 0.26) continue;
    const size = hash2(q.id, 9);
    const r = size < 0.7 ? 3 + size * 5 : 7 + (size - 0.7) * 16;
    const d = q.f1 + (bite(x, y) - 0.5) * 4.5;
    if (d > r + 1) continue;
    if (d > r) { put(tile, x, y, tone(SOIL, 0)); continue; }
    const lx = (x - q.sx) / r, ly = (y - q.sy) / r;
    const light = -(lx * 0.8 + ly) * 0.6 + (1 - d / r) * 0.35;
    const base = 1 + Math.floor(hash2(q.id, 3) * 2.2);
    put(tile, x, y, tone(SOIL_STONE, base + (light > 0.42 ? 2 : light > 0.02 ? 1 : light < -0.4 ? -1 : 0)));
  }
  // Pale mycelium flecks in small clusters.
  for (let n = 0; n < 70; n++) {
    const cx = Math.floor(next() * FLOOR_TILE), cy = Math.floor(next() * FLOOR_TILE);
    const count = 1 + Math.floor(next() * 4);
    for (let k = 0; k < count; k++) put(tile, cx + Math.floor(next() * 3) - 1, cy + Math.floor(next() * 2), k === 0 ? [92, 112, 74] : [70, 86, 58]);
  }
  // Root threads: mostly downward, wandering, branching. Colour comes from the
  // floor look through the mask (visible near faces, fading into the core);
  // the baked shadow beside each thread keeps them readable at any tint.
  for (let n = 0; n < 26; n++) {
    thread(tile, next, next() * FLOOR_TILE, next() * FLOOR_TILE, 24 + Math.floor(next() * 70), 0.9, 0.5, 255, null);
  }
  return tile;
}

// ----------------------------------------------------------- Drowned Cisterns
const SLATE: Ramp = [[20, 28, 32], [29, 39, 44], [37, 48, 53], [45, 57, 61], [55, 67, 70], [67, 78, 79]];
const SILT: Ramp = [[26, 33, 34], [36, 43, 43], [45, 52, 51], [55, 61, 58], [65, 71, 67]];

function paintCisterns(): Tile {
  const tile = newTile(), next = rng(0x51c7);
  // Bedding: horizontal beds 6–18 texels thick with a periodic wave, some of
  // them silt. Bed boundaries are bedding planes (a dark line); vertical
  // joints split each bed into eroded blocks — the natural cousin of the
  // cistern masonry it meets.
  const tops: number[] = [];
  let y0 = 0;
  while (y0 < FLOOR_TILE - 10) { tops.push(y0); y0 += 6 + Math.floor(next() * 13); }
  const beds = tops.length;
  const phase = tops.map(() => next() * Math.PI * 2);
  const freq = tops.map(() => 1 + Math.floor(next() * 3));
  const amp = tops.map(() => 1 + next() * 2.2);
  const silt = tops.map(() => next() < 0.2);
  const toneOf = tops.map(() => 1 + Math.floor(next() * 3));
  const edge = (k: number, x: number): number => {
    const kk = ((k % beds) + beds) % beds;
    const wrapY = Math.floor(k / beds) * FLOOR_TILE;
    return tops[kk] + wrapY + Math.round(Math.sin((x / FLOOR_TILE) * Math.PI * 2 * freq[kk] + phase[kk]) * amp[kk]);
  };
  const pits = fbm(21, [16, 8, 4]);
  // Joint positions per bed.
  const joints = tops.map(() => {
    const xs: number[] = [];
    let x = Math.floor(next() * 30);
    while (x < FLOOR_TILE) { xs.push(x); x += 30 + Math.floor(next() * 60); }
    return xs;
  });
  for (let x = 0; x < FLOOR_TILE; x++) {
    for (let k = 0; k < beds; k++) {
      const top = edge(k, x), bottom = edge(k + 1, x);
      for (let y = top; y < bottom; y++) {
        const ramp = silt[k] ? SILT : SLATE;
        let t = toneOf[k] + (silt[k] ? 0 : 0);
        const local = y - top, height = bottom - top;
        if (local === 0) t = 0;                       // bedding plane
        else if (local === 1) t += 1;                 // lit bed top
        else if (local >= height - 2) t -= 1;         // shaded bed foot
        const p = pits(x, y * 1.6);
        if (p < 0.3 && local > 1) t -= 1;             // pitted, eroded faces
        if (p > 0.72 && local > 1 && local < height - 2) t += 1;
        put(tile, x, y, tone(ramp, t));
      }
    }
  }
  // Joints: a jittered dark crack through each bed, lit on its left lip.
  for (let k = 0; k < beds; k++) {
    for (const jx of joints[k]) {
      let x = jx;
      for (let y = edge(k, jx) + 1; y < edge(k + 1, jx); y++) {
        if (next() < 0.18) x += next() < 0.5 ? -1 : 1;
        put(tile, x, y, tone(SLATE, 0));
        put(tile, x - 1, y, tone(silt[k] ? SILT : SLATE, toneOf[k] + 1));
      }
    }
  }
  // Seep streaks: water weeping down from bedding planes (mask only; the
  // floor look adds the wet sheen near faces).
  for (let n = 0; n < 60; n++) {
    const k = Math.floor(next() * beds);
    const x = Math.floor(next() * FLOOR_TILE);
    const start = edge(k, x) + 1;
    const len = 8 + Math.floor(next() * 34);
    for (let s = 0; s < len; s++) {
      const i = wrap(start + s) * FLOOR_TILE + wrap(x);
      tile.mask[i] = Math.max(tile.mask[i], Math.round(255 * (1 - s / len)));
    }
  }
  return tile;
}

// ---------------------------------------------------------------- Kiln Heart
const BASALT: Ramp = [[13, 11, 12], [24, 21, 22], [32, 28, 28], [40, 35, 34], [50, 44, 41], [62, 54, 49]];

function paintKilnHeart(): Tile {
  const tile = newTile(), next = rng(0x6b11);
  // Fractured basalt: angular blocks (a slightly flattened Voronoi), each
  // face a quiet tone with a bevel where it meets a neighbour. Only some
  // joints open into dark cracks — the rest merge as a tone step, so the mass
  // reads as one fractured body, not paving. Fine hairline fractures cross the
  // faces, and horizontal flow banding ties neighbouring blocks into strata.
  // A subset of the open cracks carries ember veins (mask).
  const blocks = voronoi(31, 7, 8, 1.25, 0.9);
  const hair = voronoi(34, 17, 17, 1.0, 0.9);
  const skin = fbm(32, [32, 16, 8]);
  const heat = fbm(33, [64, 32]);
  const flow = fbm(35, [64, 32]);
  for (let y = 0; y < FLOOR_TILE; y++) for (let x = 0; x < FLOOR_TILE; x++) {
    const q = blocks.query(x, y);
    const edge = q.f2 - q.f1;
    const pair = q.id < q.id2 ? hash2(q.id, q.id2) : hash2(q.id2, q.id);
    const band = Math.sin(((y + flow(x, y) * 30) / FLOOR_TILE) * Math.PI * 2 * 6);
    let t = 2 + (hash2(q.id, 5) < 0.35 ? 1 : 0) + (band > 0.55 ? 1 : band < -0.6 ? -1 : 0);
    const s = skin(x, y);
    if (s > 0.68) t += 1; else if (s < 0.3) t -= 1;
    if (edge < 1.2 && pair < 0.58) {
      t = 0;
      const h = heat(x, y);
      if (pair < 0.3 && h > 0.4) tile.mask[y * FLOOR_TILE + x] = Math.min(255, Math.round((h - 0.4) * 900));
    } else if (edge < 3 && pair < 0.58) {
      // Bevel: a block's upper-left rim catches light, its lower-right sinks.
      t += (x - q.sx) + (y - q.sy) < 0 ? 1 : -1;
    } else if (edge < 1.2) {
      t -= 1;
    } else {
      const f = hair.query(x, y);
      if (f.f2 - f.f1 < 0.9 && hash2(f.id + f.id2, 3) < 0.22) t -= 1;
    }
    put(tile, x, y, tone(BASALT, t));
  }
  // Vesicles: tiny gas pits in clusters, and sparse pale ash flecks.
  for (let n = 0; n < 60; n++) {
    const cx = next() * FLOOR_TILE | 0, cy = next() * FLOOR_TILE | 0;
    for (let k = 0; k < 3; k++) put(tile, cx + (next() * 7 | 0) - 3, cy + (next() * 4 | 0) - 2, tone(BASALT, 0));
  }
  for (let n = 0; n < 70; n++) put(tile, next() * FLOOR_TILE | 0, next() * FLOOR_TILE | 0, tone(BASALT, 5));
  return tile;
}

// --------------------------------------------------------------- spare rock
const MINERAL: Ramp = [[22, 24, 26], [32, 34, 36], [41, 43, 44], [51, 53, 53], [63, 64, 63]];

function paintSpare(): Tile {
  const tile = newTile();
  const cells = voronoi(41, 9, 9, 0.9);
  const skin = fbm(42, [32, 16, 8]);
  for (let y = 0; y < FLOOR_TILE; y++) for (let x = 0; x < FLOOR_TILE; x++) {
    const q = cells.query(x, y);
    let t = 1 + Math.floor(hash2(q.id, 5) * 2.4) + (skin(x, y) > 0.6 ? 1 : 0);
    if (q.f2 - q.f1 < 1.1) t = 0;
    put(tile, x, y, tone(MINERAL, t));
  }
  return tile;
}

// ---------------------------------------------------------------- Cold Store
const GRANITE: Ramp = [[20, 25, 33], [30, 37, 47], [40, 48, 60], [51, 60, 73], [63, 73, 87], [78, 89, 104]];
const RIME: Ramp = [[92, 108, 126], [118, 136, 156], [150, 168, 188], [182, 198, 214], [214, 226, 238]];
const BLUE_ICE: Ramp = [[18, 42, 72], [26, 60, 98], [38, 84, 128], [58, 112, 158], [92, 148, 190]];

function paintColdStore(): Tile {
  const tile = newTile(), next = rng(0xc01d);
  // Frost-split granite: blocky Voronoi masses (flattened a little, as
  // ice-wedging splits rock along its bedding), each a quiet cold tone with a
  // bevel, most joints closed to a tone step and a few opened into cracks.
  const blocks = voronoi(51, 8, 9, 1.2, 0.9);
  const skin = fbm(52, [32, 16, 8]);
  const frost = fbm(53, [64, 32, 16]);
  const veinField = fbm(54, [64, 32]);
  for (let y = 0; y < FLOOR_TILE; y++) for (let x = 0; x < FLOOR_TILE; x++) {
    const q = blocks.query(x, y);
    const edge = q.f2 - q.f1;
    const pair = q.id < q.id2 ? hash2(q.id, q.id2) : hash2(q.id2, q.id);
    let t = 2 + (hash2(q.id, 5) < 0.4 ? 1 : 0);
    const s = skin(x, y);
    if (s > 0.66) t += 1; else if (s < 0.32) t -= 1;
    const f = frost(x, y);
    if (edge < 1.1 && pair < 0.5) { put(tile, x, y, tone(GRANITE, 0)); continue; }
    // Rime: a thin crust along the TOP edge of some blocks (frost settles on
    // the ledge of a joint), two texels at most, broken where the frost is thin.
    const upper = y < q.sy - 2;
    if (upper && edge >= 1.1 && edge < 3.2 && pair < 0.5 && hash2(q.id, 17) < 0.45 && f > 0.42) {
      put(tile, x, y, tone(RIME, edge < 2.1 ? 2 : 1));
      continue;
    }
    if (edge < 2.6 && pair < 0.5) t += (x - q.sx) + (y - q.sy) < 0 ? 1 : -1;
    // Hoarfrost: broad, soft blooms across a face (clustered, never dithered).
    if (f > 0.74) { put(tile, x, y, f > 0.8 ? tone(RIME, 0) : tone(GRANITE, Math.min(5, t + 1))); continue; }
    put(tile, x, y, tone(GRANITE, t));
  }
  // Blue ice veins: meltwater that ran into the joints and froze. The mask
  // carries them so the floor look can light them near the faces.
  for (let n = 0; n < 34; n++) {
    let x = next() * FLOOR_TILE, y = next() * FLOOR_TILE;
    const len = 30 + Math.floor(next() * 90);
    let heading = next() * Math.PI * 2;
    for (let s = 0; s < len; s++) {
      const w = veinField(x, y) > 0.55 ? 2 : 1;
      for (let k = 0; k < w; k++) {
        const ix = wrap(Math.round(x) + k), iy = wrap(Math.round(y));
        put(tile, ix, iy, tone(BLUE_ICE, 1 + Math.floor(next() * 3)));
        tile.mask[iy * FLOOR_TILE + ix] = Math.max(tile.mask[iy * FLOOR_TILE + ix], 200 - Math.floor((s / len) * 90));
      }
      heading += (next() - 0.5) * 0.7;
      x += Math.cos(heading); y += Math.sin(heading) * 0.8 + 0.25;
    }
  }
  // Frost sparkle: single bright texels, sparse.
  for (let n = 0; n < 160; n++) put(tile, next() * FLOOR_TILE | 0, next() * FLOOR_TILE | 0, tone(RIME, 3 + (next() < 0.3 ? 1 : 0)));
  return tile;
}

// ----------------------------------------------------------- Glass Galleries
const LENS_STONE: Ramp = [[18, 16, 26], [27, 24, 38], [37, 33, 51], [48, 43, 64], [60, 54, 79], [74, 67, 95]];
const GLASS: Ramp = [[40, 52, 72], [58, 76, 102], [82, 104, 136], [112, 138, 170], [150, 176, 204], [198, 216, 234]];

function paintGlassGalleries(): Tile {
  const tile = newTile(), next = rng(0x91a5);
  // Faceted rock: sharp Voronoi facets, each lit as a flat plane (one tone per
  // facet from a hashed normal), glassy facets brighter with a specular edge —
  // the look of a cut stone, not a boulder.
  const facets = voronoi(61, 12, 12, 1.0, 0.95);
  const skin = fbm(62, [32, 16]);
  for (let y = 0; y < FLOOR_TILE; y++) for (let x = 0; x < FLOOR_TILE; x++) {
    const q = facets.query(x, y);
    const edge = q.f2 - q.f1;
    const glassy = hash2(q.id, 11) < 0.28;
    const ang = hash2(q.id, 13) * Math.PI * 2;
    const lit = Math.cos(ang - 2.4); // light from the upper left
    if (edge < 0.9) {
      // facet seams: dark on stone, a bright hairline on glass
      put(tile, x, y, glassy ? tone(GLASS, 4) : tone(LENS_STONE, 0));
      if (glassy) tile.mask[y * FLOOR_TILE + x] = 220;
      continue;
    }
    if (glassy) {
      let t = 2 + Math.round(lit * 1.4);
      if (edge < 2.2 && (x - q.sx) + (y - q.sy) < 0) t += 1; // bevel catches light
      put(tile, x, y, tone(GLASS, t));
      if (edge < 3) tile.mask[y * FLOOR_TILE + x] = Math.max(tile.mask[y * FLOOR_TILE + x], 110);
    } else {
      let t = 2 + Math.round(lit * 1.2) + (skin(x, y) > 0.64 ? 1 : 0);
      if (edge < 2) t += (x - q.sx) + (y - q.sy) < 0 ? 1 : -1;
      put(tile, x, y, tone(LENS_STONE, t));
    }
  }
  // Ground lenses: polished disks set into the rock, concentric grinding rings
  // and a crescent of reflected light.
  for (let n = 0; n < 9; n++) {
    const cx = next() * FLOOR_TILE, cy = next() * FLOOR_TILE, r = 6 + next() * 9;
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > r + 1) continue;
      const ix = wrap(Math.round(cx + dx)), iy = wrap(Math.round(cy + dy));
      if (d > r) { put(tile, ix, iy, tone(LENS_STONE, 0)); continue; }
      const ring = Math.floor(d / 2.2) % 2 === 0;
      const crescent = dx * 0.7 + dy * 0.7 < -r * 0.35 && d > r * 0.45;
      put(tile, ix, iy, crescent ? tone(GLASS, 5) : tone(GLASS, ring ? 2 : 1));
      tile.mask[iy * FLOOR_TILE + ix] = Math.max(tile.mask[iy * FLOOR_TILE + ix], crescent ? 255 : 90);
    }
  }
  // Prismatic glints: a few single bright texels.
  for (let n = 0; n < 80; n++) {
    const x = next() * FLOOR_TILE | 0, y = next() * FLOOR_TILE | 0;
    put(tile, x, y, tone(GLASS, 5));
    tile.mask[wrap(y) * FLOOR_TILE + wrap(x)] = 255;
  }
  return tile;
}

function paintSheet(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(FLOOR_SHEET * FLOOR_SHEET_H * 4);
  const tiles = [paintRotGardens(), paintCisterns(), paintKilnHeart(), paintSpare(), paintColdStore(), paintGlassGalleries()];
  tiles.forEach((tile, q) => {
    const ox = (q & 1) * FLOOR_TILE, oy = (q >> 1) * FLOOR_TILE;
    for (let y = 0; y < FLOOR_TILE; y++) for (let x = 0; x < FLOOR_TILE; x++) {
      const s = y * FLOOR_TILE + x, d = ((oy + y) * FLOOR_SHEET + ox + x) * 4;
      out[d] = tile.rgb[s * 3]; out[d + 1] = tile.rgb[s * 3 + 1]; out[d + 2] = tile.rgb[s * 3 + 2];
      out[d + 3] = tile.mask[s];
    }
  });
  return out;
}
