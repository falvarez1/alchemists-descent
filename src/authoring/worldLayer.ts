import type { BiomeId } from '@/core/types';
import type { EditorWorldLayer } from '@/authoring/document';
import { base64ToBytes, bytesToBase64, rleDecodeExact, rleEncode, sparsePairs } from '@/core/rle';
import { HEIGHT, WIDTH } from '@/config/constants';
import { BIOMES } from '@/config/biomes';
import { clamp, hash2, valueNoise } from '@/core/math';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, packRGB } from '@/sim/colors';
import { World } from '@/sim/World';
import { crownDeepTint, crownFringeTint, crownTopColor, mossUnderColor } from '@/world/crownPalette';
import { dressWalkSurface } from '@/world/surfaceDress';

/**
 * The world-layer codec: live cell grid <-> `EditorWorldLayer`.
 *
 * This used to live in `src/builder/document.ts` next to the Builder's save
 * code. It moved here because it has a second consumer now — AuthorLink sends
 * a whole world to another window when the two are on different levels — and
 * `src/net`/`src/app` may not import `src/builder`. Duplicating the paint
 * routine was not an option: `repaintWorldLayer` is a deterministic
 * reconstruction of the cave generator's tinting, and a second copy would
 * drift the first time the palette changed.
 *
 * WHY THE REPAINT EXISTS AT ALL. A generated cave world carries ~200k
 * per-cell color scars (biome banding, crown tints, moss). Shipping those
 * literally is ~2.5 MB of pairs, or 6.6 MB for the raw plane. Instead the
 * layer stores the *paint seed*, the receiver re-derives the same colors, and
 * only genuine differences — blood, burn scars, authored accents — travel as
 * sparse overrides. A 1600x1064 cave world costs ~75 KB on the wire that way.
 *
 * The functions take a narrow surface rather than `Ctx` so the neutral layer
 * stays free of runtime services (boundary-enforced).
 */

/** Everything the codec needs to read a world out. */
export interface WorldLayerSource {
  world: World;
  biome: BiomeId;
  seed: number;
  /** CaveGenerator's last paint seed, or null when the world was not generated. */
  paintSeed: number | null;
}

/** Everything the codec needs to write a world back; fallbacks for old layers. */
export interface WorldLayerTarget {
  world: World;
  biome: BiomeId;
  seed: number;
}

/** Sparse-pair budget for one document/message; beyond it the plane is sent whole. */
const SPARSE_CAP = 200_000;

/** Snapshot the LIVE world cells into a terrain layer. */
export function captureWorldLayer(src: WorldLayerSource): EditorWorldLayer {
  const w = src.world;
  // Transient gas life is noise; keep authored/fire life so generated braziers survive restore.
  const life: Array<[number, number]> = [];
  for (let i = 0; i < w.life.length && life.length < SPARSE_CAP; i++) {
    if (w.life[i] === 0) continue;
    const t = w.types[i];
    if (t === Cell.Smoke || t === Cell.Steam) continue;
    life.push([i, w.life[i]]);
  }
  const layer: EditorWorldLayer = {
    rle: rleEncode(w.types),
    biome: src.biome,
    seed: src.seed >>> 0,
    life,
    charge: sparsePairs(w.charge, 20000),
  };
  if (typeof src.paintSeed === 'number' && Number.isFinite(src.paintSeed)) layer.paintSeed = src.paintSeed;
  const colorDiffs = captureColorDiffs(src, layer);
  if (colorDiffs.truncated) layer.colors = encodeColorPlane(w.colors);
  else if (colorDiffs.pairs.length > 0) layer.colorOverrides = colorDiffs.pairs;
  return layer;
}

/** Decode a terrain layer into the LIVE world (colors regenerate). */
export function applyWorldLayer(target: WorldLayerTarget, layer: EditorWorldLayer): void {
  const w = target.world;
  w.clear();
  // A malformed rle must fail safe (leave the cleared world) rather than throw
  // into callers — the importer's sanitizeWorldLayer guards the same way.
  try {
    if (!rleDecodeExact(layer.rle, w.types)) return;
  } catch {
    return;
  }
  repaintWorldLayer(target, layer);
  if (layer.colors) decodeColorPlaneInto(layer.colors, w.colors);
  for (const [i, v] of layer.life ?? []) w.life[i] = v;
  for (const [i, v] of layer.charge ?? []) w.setChargeAt(i, v);
  for (const [i, c] of layer.colorOverrides ?? []) {
    w.colors[i] = c;
    // Register the scar so World.swap carries the authored tint instead of
    // regenerating the factory color on the cell's first move.
    w.colorOverrides.add(i);
  }
}

/** Exported for the document sanitizer, which round-trips an untrusted plane. */
export function encodeColorPlane(colors: Uint32Array): string {
  return bytesToBase64(new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength));
}

/** Exported for the document sanitizer; false when the payload is the wrong length. */
export function decodeColorPlaneInto(encoded: string, colors: Uint32Array): boolean {
  try {
    const bytes = new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength);
    base64ToBytes(encoded, bytes);
    for (let i = 0; i < colors.length; i++) colors[i] &= 0xffffff;
    return true;
  } catch {
    return false;
  }
}

function captureColorDiffs(
  src: WorldLayerSource,
  layer: EditorWorldLayer,
): { pairs: Array<[number, number]>; truncated: boolean } {
  const source = src.world;
  const repainted = new World(source.width, source.height);
  repainted.types.set(source.types);
  repaintWorldLayer({ world: repainted, biome: src.biome, seed: src.seed }, layer);

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < source.colors.length; i++) {
    if (source.colors[i] === repainted.colors[i] && !source.colorOverrides.has(i)) continue;
    if (pairs.length >= SPARSE_CAP) return { pairs, truncated: true };
    pairs.push([i, source.colors[i]]);
  }
  return { pairs, truncated: false };
}

function repaintWorldLayer(target: WorldLayerTarget, layer: EditorWorldLayer): void {
  const world = target.world;
  const biome = isBiomeId(layer.biome) ? layer.biome : target.biome;
  const B = BIOMES[biome] ?? BIOMES.earthen;
  const seed = Number.isFinite(layer.paintSeed)
    ? Math.floor(layer.paintSeed as number)
    : fallbackPaintSeed(layer.seed ?? target.seed, biome);
  const dist = new Uint8Array(WIDTH * HEIGHT).fill(99);
  const queue = new Int32Array(WIDTH * HEIGHT);
  let head = 0;
  let tail = 0;

  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      const i = x + y * WIDTH;
      if (world.types[i] !== Cell.Wall) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const nextDist = dist[i] + 1;
    if (nextDist > 13) continue;
    const x = i % WIDTH;
    if (x + 1 < WIDTH) tail = enqueueWall(i + 1, nextDist, world.types, dist, queue, tail);
    if (x > 0) tail = enqueueWall(i - 1, nextDist, world.types, dist, queue, tail);
    if (i + WIDTH < world.types.length) tail = enqueueWall(i + WIDTH, nextDist, world.types, dist, queue, tail);
    if (i >= WIDTH) tail = enqueueWall(i - WIDTH, nextDist, world.types, dist, queue, tail);
  }

  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      const i = x + y * WIDTH;
      const t = world.types[i];
      if (t === Cell.Empty) {
        world.colors[i] = EMPTY_COLOR;
      } else if (t === Cell.Wall) {
        world.colors[i] = biomeWallColor(x, y, dist[i], seed, B.bands);
      } else {
        const fn = COLOR_FN[t];
        world.colors[i] = fn ? fn() : EMPTY_COLOR;
      }
    }
  }

  for (let x = 0; x < WIDTH; x++) {
    for (let y = 1; y < HEIGHT - 1; y++) {
      const i = x + y * WIDTH;
      if (world.types[i] !== Cell.Wall) continue;
      const topish =
        world.types[x + (y - 1) * WIDTH] === Cell.Empty &&
        (y < 2 || world.types[x + (y - 2) * WIDTH] === Cell.Empty);
      const nbTop = (xx: number): boolean =>
        xx >= 0 &&
        xx < WIDTH &&
        world.types[xx + y * WIDTH] === Cell.Wall &&
        world.types[xx + (y - 1) * WIDTH] === Cell.Empty;
      if (topish && (nbTop(x - 1) || nbTop(x + 1))) {
        world.colors[i] = crownTopColor(x, y, seed, B.crown, B.flowerChance);
        if (B.crown === 'moss') {
          if (world.types[x + (y + 1) * WIDTH] === Cell.Wall) {
            world.colors[x + (y + 1) * WIDTH] = mossUnderColor(x, seed);
          }
          if (y + 2 < HEIGHT && world.types[x + (y + 2) * WIDTH] === Cell.Wall) {
            const i2 = x + (y + 2) * WIDTH;
            const c = crownDeepTint(world.colors[i2], x, y, seed, B.crown);
            if (c !== null) world.colors[i2] = c;
          }
        } else if (B.crown === 'frost' && world.types[x + (y + 1) * WIDTH] === Cell.Wall) {
          const i2 = x + (y + 1) * WIDTH;
          const c = crownDeepTint(world.colors[i2], x, y, seed, B.crown);
          if (c !== null) world.colors[i2] = c;
        }
      } else if (
        world.types[x + (y + 1) * WIDTH] === Cell.Empty &&
        world.types[x + Math.min(HEIGHT - 1, y + 2) * WIDTH] === Cell.Empty
      ) {
        const c = crownFringeTint(world.colors[i], x, y, seed, B.crown);
        if (c !== null) world.colors[i] = c;
      }
    }
  }

  dressWalkSurface(world, {
    seed,
    minY: 2,
    floorBand: HEIGHT - 52,
    crown: B.crown,
    flowerChance: B.flowerChance,
  });
}

function enqueueWall(
  i: number,
  d: number,
  types: Uint8Array,
  dist: Uint8Array,
  queue: Int32Array,
  tail: number,
): number {
  if (types[i] !== Cell.Wall || dist[i] <= d) return tail;
  dist[i] = d;
  queue[tail] = i;
  return tail + 1;
}

function biomeWallColor(
  x: number,
  y: number,
  dist: number,
  seed: number,
  bands: ReadonlyArray<readonly [number, number, number]>,
): number {
  let m = valueNoise(x, y, 0.014, seed);
  m = clamp((m - 0.5) * 2.1 + 0.5, 0, 1);
  const grain = 0.85 + valueNoise(x, y, 0.12, seed + 5) * 0.3;
  const band = m < 0.4 ? bands[0] : m < 0.58 ? bands[1] : m < 0.84 ? bands[2] : bands[3];
  const shade = dist <= 2 ? 1.08 : dist <= 4 ? 0.88 : dist <= 6 ? 0.7 : dist <= 8 ? 0.58 : dist <= 10 ? 0.5 : 0.44;
  const jit = 0.92 + hash2(x, y, seed + 11) * 0.16;
  return packRGB(
    Math.min(255, Math.floor(band[0] * grain * shade * jit)),
    Math.min(255, Math.floor(band[1] * grain * shade * jit)),
    Math.min(255, Math.floor(band[2] * grain * shade * jit)),
  );
}

function fallbackPaintSeed(seed: number | undefined, biome: BiomeId): number {
  const s = Number.isFinite(seed) ? (seed as number) >>> 0 : 0;
  return Math.floor(hash2(s & 0xffff, (s >>> 16) ^ biome.length, 0x51f15e) * 100000);
}

export function isBiomeId(value: unknown): value is BiomeId {
  return typeof value === 'string' && value in BIOMES;
}
