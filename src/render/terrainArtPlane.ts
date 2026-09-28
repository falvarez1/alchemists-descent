import type { World } from '@/sim/World';
import { blocksEntity, isLiquid, isSoftGrowth, isSolid } from '@/sim/CellType';
import { ACTIVITY_SIZE } from '@/sim/ActivityGrid';

/**
 * The terrain ART PLANE: one presentation byte per world cell, derived from
 * the live grid, that lets the compositors dress terrain by its shape
 * (config/floorLooks `natural`). It never feeds collision, saves or the
 * simulation.
 *
 *   solid  (rigid: rock, masonry, timber, metal, glass, ice):  0x80 | built << 6 | depth
 *   loose  (liquids and powders):                              0x40 | depth
 *   open   (air, gas, fire, growth):   sealed << 5 | air distance to the nearest solid or loose cell
 *
 * DEPTH is the chamfer distance to the nearest exposed OPEN cell (1 = an
 * exposed face); it sinks terrain cores. Loose cells are not open, and
 * neither is a SEALED pocket (a small enclosed air vug) — a water-filled
 * pore, a coal seam or a buried bubble stays part of the rock mass instead of
 * haloing it with lit faces. A pocket unseals when a dig connects it to air. AIR DISTANCE gives the contact shadow terrain (and a pool) casts on
 * the backdrop. BUILT marks masonry: a lining behind every long straight
 * horizontal or vertical face and every face inside an authored footprint;
 * everything else is natural rock.
 *
 * Built is decided ONCE, from the terrain as the level first renders, and is
 * sticky afterwards like a generation tag: digging into a lining reveals more
 * lining, and a straight tunnel dug through rock never turns to brick.
 *
 * Upkeep: a shadow copy of the type plane finds changed cells four at a time
 * in chunks whose activity version moved. Each chunk's changes re-derive as
 * their own region (the change plus the field reach — never a union across
 * the view, so scattered fires stay cheap). Solid changes (digging, a blast,
 * burning timber) go first, a few regions per frame; loose <-> air churn
 * (falling sand, burning coal, pools settling) only moves shading and
 * trickles through one region every other frame.
 */
export const ART_SOLID_BIT = 0x80;
export const ART_BUILT_BIT = 0x40;
export const ART_LOOSE_BIT = 0x40;
export const ART_DEPTH_MASK = 0x3f;
export const ART_SEALED_BIT = 0x20;
/**
 * On a LOOSE byte (the bit an open byte uses for SEALED): this liquid lies in
 * a sealed POCKET — a small liquid body that touches no exposed air (a
 * water-filled pore in a flooded wall). Pockets stay part of the rock mass;
 * the renderer draws only the water you can reach as water (fix4b: clear
 * water and wet faces must not turn every pore into a lit hole).
 */
export const ART_POCKET_BIT = 0x20;
/** Loose depth never exceeds ART_DEPTH_MAX (< 32), so it fits under the pocket bit. */
const LOOSE_DEPTH_MASK = 0x1f;
export const ART_AIR_MASK = 0x0f;
/** Deepest depth the plane distinguishes (cells). */
export const ART_DEPTH_MAX = 20;
/** Farthest air distance the plane distinguishes (cells). */
export const ART_AIR_MAX = 15;

const OPEN = 0, LOOSE = 1, SOLID = 2;
const CLASS = new Uint8Array(256);
for (let t = 0; t < 256; t++) {
  CLASS[t] = isSolid(t) && !isSoftGrowth(t) ? SOLID : isLiquid(t) || blocksEntity(t) ? LOOSE : OPEN;
}
/** The stored class of a plane byte. */
const storedClass = (v: number): number => (v & ART_SOLID_BIT ? SOLID : v & ART_LOOSE_BIT ? LOOSE : OPEN);

export interface ArtZone { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

export interface ArtPlaneOptions {
  /** Straight exposed run (cells) that reads as a built face. */
  readonly builtRun: number;
  /** Masonry lining thickness behind a built face (cells, jittered ±3). */
  readonly lining: number;
  /** Authored footprints whose faces are built regardless of run length. */
  readonly zones: readonly ArtZone[];
}

const INF = 30000;
// Chamfer weights: orthogonal 3, diagonal 4 (≈ Euclidean × 3). A change moves
// field values at most this far away.
const REACH = ART_DEPTH_MAX + 2;
/** Chunk regions re-derived per sync: solid changes first, then loose/air churn. */
const SOLID_PER_SYNC = 4;
/** Loose/air churn: one region every LAZY_CADENCE syncs. */
const LAZY_CADENCE = 2;
/** Dirty rects kept apart for the CPU re-shade before they merge into one. */
const DIRTY_RECTS = 12;
/** An enclosed open component smaller than this is a sealed pocket (cells). */
const POCKET_MAX = 1500;
/** A liquid body touching no exposed air and smaller than this is a sealed pocket (cells). */
const LIQUID_POCKET_MAX = 1500;
const LIQUID = new Uint8Array(256);
for (let t = 0; t < 256; t++) LIQUID[t] = isLiquid(t) ? 1 : 0;

// Scratch shared by every plane (single-threaded; builds never interleave).
let scratchSize = 0;
let depthUnits = new Uint16Array(0);
let airUnits = new Uint16Array(0);
let builtUnits = new Uint16Array(0);
/** 1 = an exposed open cell (a depth source). */
let exposed = new Uint8Array(0);
let solidMask = new Uint8Array(0);
let queue = new Int32Array(0);
let runLeft = new Uint16Array(0);
let runRight = new Uint16Array(0);
/** Full-build liquid labels: 2 = a sealed pocket (see ART_POCKET_BIT). */
let liquidMark = new Uint8Array(0);
function scratch(size: number): void {
  if (scratchSize >= size) return;
  scratchSize = size;
  depthUnits = new Uint16Array(size); airUnits = new Uint16Array(size); builtUnits = new Uint16Array(size);
  exposed = new Uint8Array(size); solidMask = new Uint8Array(size); queue = new Int32Array(size);
  runLeft = new Uint16Array(size); runRight = new Uint16Array(size); liquidMark = new Uint8Array(size);
}

/** Smooth ±1 jitter from an integer lattice. */
function jitter(x: number, y: number): number {
  const gx = x >> 3, gy = y >> 3, fx = (x & 7) / 8, fy = (y & 7) / 8;
  const h = (a: number, b: number): number => ((((a * 73) ^ (b * 151) ^ (a * b * 7)) & 255) / 127.5) - 1;
  const top = h(gx, gy) * (1 - fx) + h(gx + 1, gy) * fx;
  const bottom = h(gx, gy + 1) * (1 - fx) + h(gx + 1, gy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

export class TerrainArtPlane {
  readonly data: Uint8Array;
  /** Bumped whenever any byte changes; takeDirty() hands out the union rect. */
  revision = 0;
  /** Probe counters: chunks scanned, regions re-derived, cells re-derived. */
  readonly stats = { scans: 0, regions: 0, cells: 0, syncMs: 0 };
  private dirty: Rect[] = [];
  private readonly versions: Uint32Array;
  private readonly shadow: Uint8Array;
  private readonly shadow32: Uint32Array | null;
  private readonly types32: Uint32Array | null;
  private readonly solid = new Map<number, Rect>();
  private readonly lazy = new Map<number, Rect>();
  private epoch: number;
  private revisionSeen: number;
  private syncedRevision = -1;
  private syncedEpoch = -1;
  private syncedX = NaN;
  private syncedY = NaN;
  private syncCount = 0;

  constructor(private readonly world: World, readonly options: ArtPlaneOptions) {
    this.data = new Uint8Array(world.width * world.height);
    this.shadow = new Uint8Array(world.width * world.height);
    // Word-wise scans need 4-aligned rows and chunk edges (true for the 1600-wide worlds).
    const types = world.types;
    const aligned = types.byteOffset % 4 === 0 && types.length % 4 === 0 && world.width % 4 === 0;
    this.shadow32 = aligned ? new Uint32Array(this.shadow.buffer) : null;
    this.types32 = aligned ? new Uint32Array(types.buffer, types.byteOffset, types.length >> 2) : null;
    this.versions = new Uint32Array(world.activity.versions.length);
    this.epoch = world.activity.epoch;
    this.revisionSeen = world.mutationVersion;
    this.buildAll();
  }

  /** Full derivation, including the one-time built classification. */
  buildAll(): void {
    const world = this.world, width = world.width, height = world.height;
    scratch(width * height);
    this.labelPockets();
    this.labelLiquidPockets();
    this.fields(0, 0, width, height, false);
    this.classify();
    this.pack(0, 0, width, height, false);
    this.versions.set(world.activity.versions);
    this.shadow.set(world.types);
    this.solid.clear();
    this.lazy.clear();
    this.epoch = world.activity.epoch;
    this.revisionSeen = world.mutationVersion;
    this.markDirty(0, 0, width, height);
  }

  /**
   * Bring the plane up to date around the rect the compositor is about to
   * draw (callers pass the view plus their padding). Chunks whose activity
   * version moved are scanned for class changes; solid changes re-derive now,
   * loose/air changes queue.
   */
  sync(x0: number, y0: number, x1: number, y1: number): void {
    const world = this.world, activity = world.activity;
    // Several compositors may ask in one frame; nothing moved, nothing to scan.
    if (this.syncedRevision === world.mutationVersion && this.syncedEpoch === activity.epoch
      && this.syncedX === x0 && this.syncedY === y0 && this.solid.size === 0 && this.lazy.size === 0) return;
    this.syncedRevision = world.mutationVersion; this.syncedEpoch = activity.epoch;
    this.syncedX = x0; this.syncedY = y0;
    if (activity.epoch !== this.epoch) { this.buildAll(); return; }
    const started = performance.now();
    // Writes before the first simulation step only bump the revision.
    if (!activity.ready && this.revisionSeen !== world.mutationVersion) this.versions.fill(0xffffffff);
    this.revisionSeen = world.mutationVersion;
    const width = world.width, height = world.height;
    const cx0 = Math.max(0, x0 - REACH) >> 6, cy0 = Math.max(0, y0 - REACH) >> 6;
    const cx1 = Math.min(width - 1, x1 + REACH) >> 6, cy1 = Math.min(height - 1, y1 + REACH) >> 6;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = cx + cy * activity.columns;
      if (this.versions[key] === activity.versions[key]) continue;
      this.versions[key] = activity.versions[key];
      this.scanChunk(key, cx, cy);
    }
    let budget = SOLID_PER_SYNC;
    for (const [key, rect] of this.solid) {
      if (budget-- <= 0) break;
      this.solid.delete(key);
      const region = this.expand(rect);
      this.rederive(region);
      // Queued churn wholly inside the fresh region is already current.
      const lazy = this.lazy.get(key);
      if (lazy && lazy.x0 >= region.x0 && lazy.x1 < region.x1 && lazy.y0 >= region.y0 && lazy.y1 < region.y1) this.lazy.delete(key);
    }
    if (++this.syncCount % LAZY_CADENCE === 0) {
      for (const [key, rect] of this.lazy) {
        this.lazy.delete(key);
        this.rederive(this.expand(rect));
        break;
      }
    }
    this.stats.syncMs += performance.now() - started;
  }

  /** Every re-derived rect since the last call (a few, or one union when many). */
  takeDirty(): readonly Rect[] {
    const rects = this.dirty;
    this.dirty = [];
    return rects;
  }

  /** Compare one chunk against the shadow types; queue its class changes. */
  private scanChunk(key: number, cx: number, cy: number): void {
    const world = this.world, width = world.width, types = world.types, shadow = this.shadow;
    const left = cx * ACTIVITY_SIZE, top = cy * ACTIVITY_SIZE;
    const right = Math.min(width, left + ACTIVITY_SIZE), bottom = Math.min(world.height, top + ACTIVITY_SIZE);
    this.stats.scans++;
    let sx0 = Infinity, sy0 = Infinity, sx1 = -1, sy1 = -1, lx0 = Infinity, ly0 = Infinity, lx1 = -1, ly1 = -1;
    const t32 = this.types32, s32 = this.shadow32;
    for (let y = top; y < bottom; y++) {
      const row = y * width;
      for (let x = left; x < right;) {
        if (t32 && s32 && x + 4 <= right && t32[(row + x) >> 2] === s32[(row + x) >> 2]) { x += 4; continue; }
        const end = t32 && s32 ? Math.min(right, x + 4) : x + 1;
        for (; x < end; x++) {
          const i = row + x, now = types[i], was = shadow[i];
          if (now === was) continue;
          shadow[i] = now;
          const a = CLASS[now], b = CLASS[was];
          if (a === b) continue;
          if (a === SOLID || b === SOLID) {
            if (x < sx0) sx0 = x;
            if (x > sx1) sx1 = x;
            if (y < sy0) sy0 = y;
            if (y > sy1) sy1 = y;
          } else {
            if (x < lx0) lx0 = x;
            if (x > lx1) lx1 = x;
            if (y < ly0) ly0 = y;
            if (y > ly1) ly1 = y;
          }
        }
      }
    }
    if (sx1 >= 0) queueRect(this.solid, key, sx0, sy0, sx1, sy1);
    if (lx1 >= 0) queueRect(this.lazy, key, lx0, ly0, lx1, ly1);
  }

  /** A change rect (inclusive) grown by the field reach (half-open). */
  private expand(rect: Rect): Rect {
    const world = this.world;
    return {
      x0: Math.max(0, rect.x0 - REACH), y0: Math.max(0, rect.y0 - REACH),
      x1: Math.min(world.width, rect.x1 + 1 + REACH), y1: Math.min(world.height, rect.y1 + 1 + REACH),
    };
  }

  private rederive(region: Rect): void {
    this.relabel(region);
    this.fields(region.x0, region.y0, region.x1, region.y1, true);
    this.pack(region.x0, region.y0, region.x1, region.y1, true);
    this.markDirty(region.x0, region.y0, region.x1, region.y1);
    this.stats.regions++;
    this.stats.cells += (region.x1 - region.x0) * (region.y1 - region.y0);
  }

  /**
   * Full-world open components: each small enclosed one is a sealed pocket;
   * the rest are exposed (depth sources).
   */
  private labelPockets(): void {
    const world = this.world, width = world.width, height = world.height, types = world.types;
    const size = width * height, mark = exposed;
    // 0 = unvisited open, 1 = exposed, 2 = sealed, 3 = not open, 4 = queued.
    for (let i = 0; i < size; i++) mark[i] = CLASS[types[i]] === OPEN ? 0 : 3;
    // Air touching the world's edge is exposed whatever its size. (A ±1 step
    // from an edge cell wraps only onto another edge cell, which is exposed too.)
    let tail = 0;
    for (let x = 0; x < width; x++) {
      if (mark[x] === 0) { mark[x] = 1; queue[tail++] = x; }
      const b = size - width + x;
      if (mark[b] === 0) { mark[b] = 1; queue[tail++] = b; }
    }
    for (let y = 1; y < height - 1; y++) {
      const l = y * width, r = l + width - 1;
      if (mark[l] === 0) { mark[l] = 1; queue[tail++] = l; }
      if (mark[r] === 0) { mark[r] = 1; queue[tail++] = r; }
    }
    flood(mark, 0, tail, width, size, 1);
    // Every other component never touches an edge, so its ±1 steps never wrap.
    for (let start = 0; start < size; start++) {
      if (mark[start] !== 0) continue;
      mark[start] = 4; queue[0] = start;
      const count = flood(mark, 0, 1, width, size, 4);
      const verdict = count >= POCKET_MAX ? 1 : 2;
      for (let k = 0; k < count; k++) mark[queue[k]] = verdict;
    }
    for (let i = 0; i < size; i++) mark[i] = mark[i] === 1 ? 1 : 0;
  }

  /**
   * Full-world liquid bodies (after labelPockets: `exposed` marks exposed
   * air): a body smaller than LIQUID_POCKET_MAX that touches no exposed air
   * is a sealed pocket (liquidMark 2). Incremental packs carry the verdict
   * forward cell by cell (see pack).
   */
  private labelLiquidPockets(): void {
    const world = this.world, width = world.width, height = world.height, types = world.types;
    const size = width * height, mark = liquidMark;
    // 0 = unvisited liquid, 1 = a body, 2 = a pocket, 3 = not liquid, 4 = queued.
    for (let i = 0; i < size; i++) mark[i] = LIQUID[types[i]] ? 0 : 3;
    for (let start = 0; start < size; start++) {
      if (mark[start] !== 0) continue;
      mark[start] = 4; queue[0] = start;
      let head = 0, tail = 1, touches = false;
      while (head < tail) {
        const i = queue[head++], x = i % width, y = (i - x) / width;
        for (let n = 0; n < 4; n++) {
          const nx = n === 0 ? x - 1 : n === 1 ? x + 1 : x;
          const ny = n === 2 ? y - 1 : n === 3 ? y + 1 : y;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const j = nx + ny * width;
          if (mark[j] === 0) { mark[j] = 4; queue[tail++] = j; } else if (exposed[j] === 1) touches = true;
        }
      }
      const verdict = !touches && tail < LIQUID_POCKET_MAX ? 2 : 1;
      for (let k = 0; k < tail; k++) mark[queue[k]] = verdict;
    }
  }

  /**
   * Exposure inside a re-derived region: open cells reachable (within the
   * region) from an exposed open cell — one already exposed before, or on the
   * ring around the region — are exposed; the rest stay sealed. A dig into a
   * pocket therefore unseals it, and a blast inside solid rock opens a sealed
   * hollow, not a lit one.
   */
  private relabel(region: Rect): void {
    const world = this.world, width = world.width, height = world.height, types = world.types, data = this.data;
    const mark = exposed;
    let tail = 0;
    const x0 = Math.max(0, region.x0 - 1), y0 = Math.max(0, region.y0 - 1);
    const x1 = Math.min(width, region.x1 + 1), y1 = Math.min(height, region.y1 + 1);
    for (let y = y0; y < y1; y++) {
      const ringRow = y < region.y0 || y >= region.y1;
      let i = x0 + y * width;
      for (let x = x0; x < x1; x++, i++) {
        const v = data[i];
        const wasExposedOpen = storedClass(v) === OPEN && (v & ART_SEALED_BIT) === 0;
        // The ring keeps its stored verdict (it lies beyond the change's reach).
        const ring = ringRow || x < region.x0 || x >= region.x1;
        const seed = ring ? wasExposedOpen : wasExposedOpen && CLASS[types[i]] === OPEN;
        mark[i] = seed ? 1 : 0;
        if (seed) queue[tail++] = i;
      }
    }
    let head = 0;
    const rx0 = region.x0, ry0 = region.y0, rx1 = region.x1, ry1 = region.y1;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = (i - x) / width;
      for (let n = 0; n < 4; n++) {
        const nx = n === 0 ? x - 1 : n === 1 ? x + 1 : x;
        const ny = n === 2 ? y - 1 : n === 3 ? y + 1 : y;
        if (nx < rx0 || nx >= rx1 || ny < ry0 || ny >= ry1) continue;
        const j = nx + ny * width;
        if (mark[j] === 0 && CLASS[types[j]] === OPEN) { mark[j] = 1; queue[tail++] = j; }
      }
    }
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    this.revision++;
    if (this.dirty.length < DIRTY_RECTS) { this.dirty.push({ x0, y0, x1, y1 }); return; }
    const all = this.dirty[0];
    for (const rect of this.dirty) {
      all.x0 = Math.min(all.x0, rect.x0); all.y0 = Math.min(all.y0, rect.y0);
      all.x1 = Math.max(all.x1, rect.x1); all.y1 = Math.max(all.y1, rect.y1);
    }
    all.x0 = Math.min(all.x0, x0); all.y0 = Math.min(all.y0, y0);
    all.x1 = Math.max(all.x1, x1); all.y1 = Math.max(all.y1, y1);
    this.dirty = [all];
  }

  /**
   * Two-pass chamfer transforms over [x0,x1)×[y0,y1): depth (non-open →
   * nearest open) and air distance (open → nearest solid or loose cell). For a
   * partial rect, the one-cell ring outside it is seeded from the current
   * plane: those cells lie beyond the reach of the change, so their values
   * are still final.
   */
  private fields(x0: number, y0: number, x1: number, y1: number, seeded: boolean): void {
    const world = this.world, width = world.width, height = world.height, types = world.types, data = this.data;
    const dIn = depthUnits, dOut = airUnits;
    if (seeded) {
      const seed = (x: number, y: number): void => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const i = x + y * width, v = data[i];
        if (storedClass(v) !== OPEN) {
          const depth = v & (v & ART_SOLID_BIT ? ART_DEPTH_MASK : LOOSE_DEPTH_MASK);
          dIn[i] = depth >= ART_DEPTH_MAX ? INF : depth * 3; dOut[i] = 0;
        } else {
          const air = v & ART_AIR_MASK;
          dIn[i] = v & ART_SEALED_BIT ? INF : 0; dOut[i] = air >= ART_AIR_MAX ? INF : air * 3;
        }
      };
      for (let x = x0 - 1; x <= x1; x++) { seed(x, y0 - 1); seed(x, y1); }
      for (let y = y0; y < y1; y++) { seed(x0 - 1, y); seed(x1, y); }
    }
    const source = exposed;
    for (let y = y0; y < y1; y++) {
      let i = x0 + y * width;
      for (let x = x0; x < x1; x++, i++) {
        const open = CLASS[types[i]] === OPEN;
        dIn[i] = source[i] ? 0 : INF; dOut[i] = open ? INF : 0;
      }
    }
    // Forward: left, upper-left, up, upper-right.
    for (let y = y0; y < y1; y++) {
      const up = y > 0;
      let i = x0 + y * width;
      for (let x = x0; x < x1; x++, i++) {
        const hasL = x > 0, hasR = x + 1 < width;
        let a = dIn[i], b = dOut[i];
        if (a !== 0) {
          if (hasL && dIn[i - 1] + 3 < a) a = dIn[i - 1] + 3;
          if (up) {
            const u = i - width;
            if (dIn[u] + 3 < a) a = dIn[u] + 3;
            if (hasL && dIn[u - 1] + 4 < a) a = dIn[u - 1] + 4;
            if (hasR && dIn[u + 1] + 4 < a) a = dIn[u + 1] + 4;
          }
          dIn[i] = a;
        }
        if (b !== 0) {
          if (hasL && dOut[i - 1] + 3 < b) b = dOut[i - 1] + 3;
          if (up) {
            const u = i - width;
            if (dOut[u] + 3 < b) b = dOut[u] + 3;
            if (hasL && dOut[u - 1] + 4 < b) b = dOut[u - 1] + 4;
            if (hasR && dOut[u + 1] + 4 < b) b = dOut[u + 1] + 4;
          }
          dOut[i] = b;
        }
      }
    }
    // Backward: right, lower-right, down, lower-left.
    for (let y = y1 - 1; y >= y0; y--) {
      const down = y + 1 < height;
      let i = x1 - 1 + y * width;
      for (let x = x1 - 1; x >= x0; x--, i--) {
        const hasL = x > 0, hasR = x + 1 < width;
        let a = dIn[i], b = dOut[i];
        if (a !== 0) {
          if (hasR && dIn[i + 1] + 3 < a) a = dIn[i + 1] + 3;
          if (down) {
            const d = i + width;
            if (dIn[d] + 3 < a) a = dIn[d] + 3;
            if (hasR && dIn[d + 1] + 4 < a) a = dIn[d + 1] + 4;
            if (hasL && dIn[d - 1] + 4 < a) a = dIn[d - 1] + 4;
          }
          dIn[i] = a;
        }
        if (b !== 0) {
          if (hasR && dOut[i + 1] + 3 < b) b = dOut[i + 1] + 3;
          if (down) {
            const d = i + width;
            if (dOut[d] + 3 < b) b = dOut[d] + 3;
            if (hasR && dOut[d + 1] + 4 < b) b = dOut[d + 1] + 4;
            if (hasL && dOut[d - 1] + 4 < b) b = dOut[d - 1] + 4;
          }
          dOut[i] = b;
        }
      }
    }
  }

  /**
   * Built faces: straight runs of solid faces (open or loose above, below,
   * left or right) at least `builtRun` long, plus every exposed face inside
   * an authored zone. The lining behind them is every solid cell whose
   * nearest face is a built face and that lies within the (jittered) lining
   * thickness of it.
   */
  private classify(): void {
    const world = this.world, width = world.width, height = world.height, types = world.types;
    const size = width * height, run = Math.max(2, this.options.builtRun);
    const dB = builtUnits, solid = solidMask;
    dB.fill(INF, 0, size);
    for (let i = 0; i < size; i++) solid[i] = CLASS[types[i]] === SOLID ? 1 : 0;
    // Horizontal runs (faces open above / below), row by row.
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let y = 0; y < height; y++) {
        if (y + dir < 0 || y + dir >= height) continue;
        const row = y * width, other = (y + dir) * width;
        let length = 0;
        for (let x = 0; x <= width; x++) {
          if (x < width && solid[row + x] === 1 && solid[other + x] === 0) { length++; continue; }
          if (length >= run) for (let k = x - length; k < x; k++) dB[row + k] = 3;
          length = 0;
        }
      }
    }
    // Vertical runs (faces open left / right), still row-major: one counter per column.
    const left = runLeft, right = runRight;
    left.fill(0, 0, width); right.fill(0, 0, width);
    for (let y = 0; y <= height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x, inside = y < height && solid[i] === 1;
        if (inside && x > 0 && solid[i - 1] === 0) left[x]++;
        else {
          if (left[x] >= run) for (let k = y - left[x]; k < y; k++) dB[k * width + x] = 3;
          left[x] = 0;
        }
        if (inside && x + 1 < width && solid[i + 1] === 0) right[x]++;
        else {
          if (right[x] >= run) for (let k = y - right[x]; k < y; k++) dB[k * width + x] = 3;
          right[x] = 0;
        }
      }
    }
    // Authored footprints: every face inside is built.
    for (const zone of this.options.zones) {
      const zx0 = Math.max(1, Math.floor(zone.x0)), zy0 = Math.max(1, Math.floor(zone.y0));
      const zx1 = Math.min(width - 1, Math.ceil(zone.x1)), zy1 = Math.min(height - 1, Math.ceil(zone.y1));
      for (let y = zy0; y < zy1; y++) for (let x = zx0; x < zx1; x++) {
        const i = x + y * width;
        if (solid[i] === 1 && (solid[i - 1] === 0 || solid[i + 1] === 0 || solid[i - width] === 0 || solid[i + width] === 0)) dB[i] = 3;
      }
    }
    // Propagate through solid mass only, and only as deep as a lining can
    // reach: every step of a shortest path to a lining cell lies within that
    // distance of its face, so the deep core never needs visiting.
    const reach = (this.options.lining + 5) * 3, dIn = depthUnits;
    for (let i = 0; i < size; i++) if (dIn[i] > reach) solid[i] = 0;
    for (let y = 0; y < height; y++) {
      let i = y * width;
      for (let x = 0; x < width; x++, i++) {
        if (solid[i] === 0) continue;
        let a = dB[i];
        if (x > 0 && dB[i - 1] + 3 < a) a = dB[i - 1] + 3;
        if (y > 0) {
          const u = i - width;
          if (dB[u] + 3 < a) a = dB[u] + 3;
          if (x > 0 && dB[u - 1] + 4 < a) a = dB[u - 1] + 4;
          if (x + 1 < width && dB[u + 1] + 4 < a) a = dB[u + 1] + 4;
        }
        dB[i] = a;
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      let i = width - 1 + y * width;
      for (let x = width - 1; x >= 0; x--, i--) {
        if (solid[i] === 0) continue;
        let a = dB[i];
        if (x + 1 < width && dB[i + 1] + 3 < a) a = dB[i + 1] + 3;
        if (y + 1 < height) {
          const d = i + width;
          if (dB[d] + 3 < a) a = dB[d] + 3;
          if (x + 1 < width && dB[d + 1] + 4 < a) a = dB[d + 1] + 4;
          if (x > 0 && dB[d - 1] + 4 < a) a = dB[d - 1] + 4;
        }
        dB[i] = a;
      }
    }
  }

  /**
   * Is the loose cell i a sealed liquid pocket? A full build reads the
   * labels. An incremental pack (the region's `exposed` marks are fresh, the
   * byte still holds the last verdict) carries it forward: a liquid cell that
   * was a pocket stays one, and a cell newly turned liquid joins a pocket it
   * touches — unless it touches exposed air, which opens it (a dig into a
   * pore lets its water read as water where the air meets it).
   */
  private liquidPocket(i: number, incremental: boolean): boolean {
    const world = this.world, types = world.types;
    if (!LIQUID[types[i]]) return false;
    if (!incremental) return liquidMark[i] === 2;
    const width = world.width, size = width * world.height, data = this.data, x = i % width;
    const l = x > 0 ? i - 1 : -1, r = x + 1 < width ? i + 1 : -1, u = i - width, d = i + width < size ? i + width : -1;
    let pocketNear = false;
    for (let n = 0; n < 4; n++) {
      const j = n === 0 ? l : n === 1 ? r : n === 2 ? u : d;
      if (j < 0) continue;
      if (CLASS[types[j]] === OPEN && exposed[j] === 1) return false;
      const v = data[j];
      if (storedClass(v) === LOOSE && (v & ART_POCKET_BIT) !== 0) pocketNear = true;
    }
    const v = data[i];
    return storedClass(v) === LOOSE ? (v & ART_POCKET_BIT) !== 0 : pocketNear;
  }

  /**
   * Write the plane bytes for a rect. A full pack derives BUILT from the
   * classification (a lining cell's nearest face must be the built face: its
   * built distance may exceed its face distance by at most one diagonal
   * step); an incremental pack keeps each surviving solid cell's built bit
   * (new solid is natural rock).
   */
  private pack(x0: number, y0: number, x1: number, y1: number, keepBuilt: boolean): void {
    const world = this.world, width = world.width, types = world.types, data = this.data;
    const dIn = depthUnits, dOut = airUnits, dB = builtUnits;
    const lining = this.options.lining;
    for (let y = y0; y < y1; y++) {
      let i = x0 + y * width;
      for (let x = x0; x < x1; x++, i++) {
        const cls = CLASS[types[i]];
        if (cls === OPEN) {
          const b = dOut[i];
          data[i] = (exposed[i] ? 0 : ART_SEALED_BIT) | (b >= INF ? ART_AIR_MAX : Math.min(ART_AIR_MAX, Math.ceil(b / 3)));
          continue;
        }
        const a = dIn[i];
        const depth = a >= INF ? ART_DEPTH_MAX : Math.min(ART_DEPTH_MAX, Math.ceil(a / 3));
        if (cls === LOOSE) {
          data[i] = ART_LOOSE_BIT | depth | (this.liquidPocket(i, keepBuilt) ? ART_POCKET_BIT : 0);
          continue;
        }
        let built: boolean;
        if (keepBuilt) built = (data[i] & (ART_SOLID_BIT | ART_BUILT_BIT)) === (ART_SOLID_BIT | ART_BUILT_BIT);
        else {
          const b = dB[i];
          built = b < INF && b - a <= 4 && b <= (lining + jitter(x, y) * 3) * 3;
        }
        data[i] = ART_SOLID_BIT | (built ? ART_BUILT_BIT : 0) | depth;
      }
    }
  }
}

/** Breadth-first fill of unvisited (0) cells from queue[head, tail); returns the new tail. */
function flood(mark: Uint8Array, head: number, tail: number, width: number, size: number, value: number): number {
  while (head < tail) {
    const i = queue[head++];
    if (i > 0 && mark[i - 1] === 0) { mark[i - 1] = value; queue[tail++] = i - 1; }
    if (i + 1 < size && mark[i + 1] === 0) { mark[i + 1] = value; queue[tail++] = i + 1; }
    if (i >= width && mark[i - width] === 0) { mark[i - width] = value; queue[tail++] = i - width; }
    if (i + width < size && mark[i + width] === 0) { mark[i + width] = value; queue[tail++] = i + width; }
  }
  return tail;
}

function queueRect(queue: Map<number, Rect>, key: number, x0: number, y0: number, x1: number, y1: number): void {
  const queued = queue.get(key);
  if (!queued) { queue.set(key, { x0, y0, x1, y1 }); return; }
  queued.x0 = Math.min(queued.x0, x0); queued.y0 = Math.min(queued.y0, y0);
  queued.x1 = Math.max(queued.x1, x1); queued.y1 = Math.max(queued.y1, y1);
}

const planes = new WeakMap<World, TerrainArtPlane>();

/** The plane for a world under the given options (rebuilt if they change). */
export function terrainArtPlane(world: World, options: ArtPlaneOptions): TerrainArtPlane {
  let plane = planes.get(world);
  if (!plane || plane.options.builtRun !== options.builtRun || plane.options.lining !== options.lining
    || !sameZones(plane.options.zones, options.zones)) {
    plane = new TerrainArtPlane(world, options);
    planes.set(world, plane);
  }
  return plane;
}

/** The plane already built for a world, if any (probes and tests). */
export function existingTerrainArtPlane(world: World): TerrainArtPlane | null {
  return planes.get(world) ?? null;
}

function sameZones(a: readonly ArtZone[], b: readonly ArtZone[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x0 !== b[i].x0 || a[i].y0 !== b[i].y0 || a[i].x1 !== b[i].x1 || a[i].y1 !== b[i].y1) return false;
  }
  return true;
}
