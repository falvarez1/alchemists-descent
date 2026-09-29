import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

export const ACTIVITY_SIZE = 64;
const category = new Uint8Array(256).fill(3);
for (const t of [Cell.Empty, Cell.Wall, Cell.Wood, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.Glowshroom, Cell.RawOre, Cell.Mirror]) category[t] = 0;
for (const t of [Cell.Ice, Cell.Vines, Cell.Fungus, Cell.Moss, Cell.Grass, Cell.Leaf, Cell.Trunk]) category[t] = 1;
for (const t of [Cell.Water, Cell.Oil, Cell.Sand, Cell.Gold, Cell.Catalyst, Cell.Seed, Cell.Brine]) category[t] = 2;
const waterRestContact = new Uint8Array(256), oilRestContact = new Uint8Array(256), urgentMaterial = new Uint8Array(256);
// Brine at rest among brine and inert rock sleeps like still water; beside ice,
// snow, nitrogen or fresh water it stays awake (it has salt work to do there).
const brineRestContact = new Uint8Array(256);
for (const t of [Cell.Brine, Cell.Wall, Cell.Wood, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.RawOre, Cell.Mirror]) brineRestContact[t] = 1;
for (const t of [Cell.Fire, Cell.Ember, Cell.Lava, Cell.Acid, Cell.Nitrogen, Cell.Steam, Cell.MarshGas]) urgentMaterial[t] = 1;
for (const t of [Cell.Water, Cell.Wall, Cell.Wood, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.RawOre, Cell.Mirror]) waterRestContact[t] = 1;
for (const t of [Cell.Oil, Cell.Wall, Cell.Wood, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.RawOre, Cell.Mirror]) oilRestContact[t] = 1;

/** The activity planes a parallel chunk sweep's participants read (eligible,
 *  rowMasks, scheduled) or flag mid-sweep (scheduled, dirty, quiet, seeds) —
 *  allocated on SharedArrayBuffers by sim/parallel/sharedWorld. */
export interface ActivitySharedPlanes {
  scheduled: Uint8Array;
  dirty: Uint8Array;
  quiet: Uint8Array;
  eligible: Uint8Array;
  rowMasks: Uint32Array;
  seeds: Uint32Array;
  /** The reclassify phase's planes (participants run reclassChunk too). */
  cellClass: Uint8Array;
  dirtyRows: Uint32Array;
  dynamic: Uint32Array;
  restless: Uint32Array;
  urgent: Uint32Array;
  minX: Int16Array;
  minY: Int16Array;
  maxX: Int16Array;
  maxY: Int16Array;
  growthChanged: Uint8Array;
}

/** Activity and independent render damage over the save-compatible flat grid. */
export class ActivityGrid {
  readonly columns: number;
  readonly rows: number;
  readonly wordsPerRow: number;
  readonly scheduled: Uint8Array;
  readonly versions: Uint32Array;
  readonly dirty: Uint8Array;
  readonly eligible: Uint8Array;
  readonly rowMasks: Uint32Array;
  readonly renderDirtyRows: Uint32Array;
  readonly growthChanged: Uint8Array;
  readonly growthScheduled: Uint8Array;
  readonly growthCells: number[][];
  readonly renderMinX: Int16Array;
  readonly renderMinY: Int16Array;
  readonly renderMaxX: Int16Array;
  readonly renderMaxY: Int16Array;
  readonly bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  revision = 0;
  epoch = 0;
  stepSerial = 0;
  activeChunks = 0;
  coarseChunks = 0;
  sleepingChunks = 0;
  private initialized = false;
  get ready(): boolean { return this.initialized; }
  private readonly dynamic: Uint32Array;
  private readonly restless: Uint32Array;
  private readonly urgent: Uint32Array;
  protected readonly quiet: Uint8Array;
  private readonly cellClass: Uint8Array;
  private readonly dirtyRows: Uint32Array;
  private readonly growthSets: Set<number>[];
  private readonly minX: Int16Array;
  private readonly minY: Int16Array;
  private readonly maxX: Int16Array;
  private readonly maxY: Int16Array;
  /**
   * DEFERRED CONTACT HALOS. A touch of a small in-bounds rect (every swap and
   * single-cell write) records only its own cells here; the halos are dilated
   * once per step in flushTouches() with word-parallel bit ops (32 cells per
   * operation) instead of per touch. The render halo stays two cells (terrain
   * art reads a two-cell neighbourhood), so renderDirtyRows and the render
   * bounds come out bit-identical. The SIM halo is one cell: a cell's
   * eligibility reads only itself and its 8 neighbours, so reclassifying the
   * second ring re-derives the same answer — dropping it changes no class,
   * mask, counter or schedule, only the work. Per-chunk flags the sweep reads
   * mid-step (scheduled, dirty) and the change counters (versions, revision)
   * are still written at touch time over the two-cell halo, as before.
   */
  protected readonly seeds: Uint32Array;
  private readonly seedChunk: Uint8Array;
  private readonly seedMinX: Int16Array;
  private readonly seedMinY: Int16Array;
  private readonly seedMaxX: Int16Array;
  private readonly seedMaxY: Int16Array;
  private readonly seededChunks: Int32Array;
  private seededCount = 0;
  /** Horizontally dilated seed rows of one chunk's seed box (<=64 rows x <=4
   *  words): +-1 cell (sim) and +-2 cells (render). */
  private readonly dilated1 = new Uint32Array(64 * 4);
  private readonly dilated2 = new Uint32Array(64 * 4);
  private readonly lastWordMask: number;
  /** Chunks whose seed boxes a parallel sweep handed over (adoptSeedBox). */
  private readonly adoptMark: Uint8Array;
  private readonly adoptList: Int32Array;
  private adoptCount = 0;
  /** Chunks whose growth sets a parallel reclass edited (applyGrowthEdit). */
  private readonly growthMark: Uint8Array;
  private readonly growthEditList: Int32Array;
  private growthEditCount = 0;

  constructor(protected readonly width: number, protected readonly height: number, shared?: ActivitySharedPlanes) {
    this.columns = Math.ceil(width / 64); this.rows = Math.ceil(height / 64);
    this.wordsPerRow = Math.ceil(width / 32);
    const count = this.columns * this.rows;
    this.scheduled = shared?.scheduled ?? new Uint8Array(count); this.versions = new Uint32Array(count);
    this.dirty = shared?.dirty ?? new Uint8Array(count); this.dynamic = shared?.dynamic ?? new Uint32Array(count);
    this.restless = shared?.restless ?? new Uint32Array(count); this.urgent = shared?.urgent ?? new Uint32Array(count);
    this.quiet = shared?.quiet ?? new Uint8Array(count); this.eligible = shared?.eligible ?? new Uint8Array(width * height);
    this.cellClass = shared?.cellClass ?? new Uint8Array(width * height);
    this.rowMasks = shared?.rowMasks ?? new Uint32Array(this.wordsPerRow * height);
    this.dirtyRows = shared?.dirtyRows ?? new Uint32Array(this.wordsPerRow * height);
    this.renderDirtyRows = new Uint32Array(this.wordsPerRow * height);
    this.growthChanged = shared?.growthChanged ?? new Uint8Array(count); this.growthScheduled = new Uint8Array(count);
    this.growthCells = Array.from({ length: count }, () => []);
    this.growthSets = Array.from({ length: count }, () => new Set<number>());
    this.minX = shared?.minX ?? new Int16Array(count).fill(32767); this.minY = shared?.minY ?? new Int16Array(count).fill(32767);
    this.maxX = shared?.maxX ?? new Int16Array(count); this.maxY = shared?.maxY ?? new Int16Array(count);
    this.renderMinX = new Int16Array(count).fill(32767); this.renderMinY = new Int16Array(count).fill(32767);
    this.renderMaxX = new Int16Array(count); this.renderMaxY = new Int16Array(count);
    this.seeds = shared?.seeds ?? new Uint32Array(this.wordsPerRow * height);
    this.seedChunk = new Uint8Array(count);
    this.seedMinX = new Int16Array(count); this.seedMinY = new Int16Array(count);
    this.seedMaxX = new Int16Array(count); this.seedMaxY = new Int16Array(count);
    this.seededChunks = new Int32Array(count);
    const tail = width & 31;
    this.lastWordMask = tail === 0 ? 0xffffffff : ((1 << tail) - 1);
    this.adoptMark = new Uint8Array(count);
    this.adoptList = new Int32Array(count);
    this.growthMark = new Uint8Array(count);
    this.growthEditList = new Int32Array(count);
  }

  /**
   * PARALLEL SWEEP HAND-OVER. A participant (sim/parallel) already wrote its
   * touched cells into the shared `seeds` plane and flagged scheduled/dirty/
   * quiet as it went; this unions its per-chunk seed box (inclusive cells, all
   * inside chunk `key`) into the pending halos so the next flushTouches()
   * dilates them like any other touch. Call finishAdoption() after the last box.
   */
  adoptSeedBox(key: number, sx0: number, sy0: number, sx1: number, sy1: number): void {
    if (this.seedChunk[key] === 0) {
      this.seedChunk[key] = 1;
      this.seededChunks[this.seededCount++] = key;
      this.seedMinX[key] = sx0; this.seedMinY[key] = sy0; this.seedMaxX[key] = sx1; this.seedMaxY[key] = sy1;
    } else {
      if (sx0 < this.seedMinX[key]) this.seedMinX[key] = sx0;
      if (sy0 < this.seedMinY[key]) this.seedMinY[key] = sy0;
      if (sx1 > this.seedMaxX[key]) this.seedMaxX[key] = sx1;
      if (sy1 > this.seedMaxY[key]) this.seedMaxY[key] = sy1;
    }
    if (this.adoptMark[key] === 0) { this.adoptMark[key] = 1; this.adoptList[this.adoptCount++] = key; }
  }

  /** Change counters for the adopted boxes: once per adopted chunk, over its
   *  two-cell halo — independent of how many participants touched it. */
  finishAdoption(): void {
    const columns = this.columns;
    for (let n = 0; n < this.adoptCount; n++) {
      const key = this.adoptList[n];
      this.adoptMark[key] = 0;
      this.revision++;
      const ex0 = Math.max(0, this.seedMinX[key] - 2), ey0 = Math.max(0, this.seedMinY[key] - 2);
      const ex1 = Math.min(this.width - 1, this.seedMaxX[key] + 2), ey1 = Math.min(this.height - 1, this.seedMaxY[key] + 2);
      for (let cy = ey0 >> 6; cy <= ey1 >> 6; cy++) for (let cx = ex0 >> 6; cx <= ex1 >> 6; cx++) {
        const k = cx + cy * columns;
        this.dirty[k] = 1; this.quiet[k] = 0; this.scheduled[k] = 1; this.versions[k]++;
      }
    }
    this.adoptCount = 0;
  }

  invalidateAll(): void { this.initialized = false; this.revision++; this.epoch++; }

  touch(x: number, y: number): void { this.touchRect(x, y, x + 1, y + 1); }

  touchIndex(index: number): void {
    if (!this.initialized) { this.revision++; return; }
    const y = Math.floor(index / this.width);
    this.touch(index - y * this.width, y);
  }

  /** Half-open cell bounds with a two-cell contact halo. */
  touchRect(x0: number, y0: number, x1: number, y1: number): void {
    this.revision++;
    if (!this.initialized) return;
    if (x1 - x0 <= 2 && y1 - y0 <= 2 && x0 >= 0 && y0 >= 0 && x0 < x1 && y0 < y1 && x1 <= this.width && y1 <= this.height) {
      this.seedRect(x0, y0, x1, y1);
      return;
    }
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
    x1 = Math.min(this.width, x1 + 2); y1 = Math.min(this.height, y1 + 2);
    if (x0 >= x1 || y0 >= y1) return;
    for (let y = y0 >> 6; y <= (y1 - 1) >> 6; y++) for (let x = x0 >> 6; x <= (x1 - 1) >> 6; x++) {
      const key = x + y * this.columns;
      const left = Math.max(x0, x * 64), top = Math.max(y0, y * 64);
      const right = Math.min(x1, x * 64 + 64), bottom = Math.min(y1, y * 64 + 64);
      for (let py = top; py < bottom; py++) for (let word = left >> 5; word <= (right - 1) >> 5; word++) {
        const lo = Math.max(0, left - word * 32), hi = Math.min(31, right - 1 - word * 32);
        const bits = (0xffffffff << lo) & (0xffffffff >>> (31 - hi)), index = py * this.wordsPerRow + word;
        this.dirtyRows[index] |= bits; this.renderDirtyRows[index] |= bits;
      }
      this.dirty[key] = 1; this.quiet[key] = 0; this.scheduled[key] = 1; this.versions[key]++;
      this.minX[key] = Math.min(this.minX[key], left); this.minY[key] = Math.min(this.minY[key], top);
      this.maxX[key] = Math.max(this.maxX[key], right); this.maxY[key] = Math.max(this.maxY[key], bottom);
      this.renderMinX[key] = Math.min(this.renderMinX[key], left); this.renderMinY[key] = Math.min(this.renderMinY[key], top);
      this.renderMaxX[key] = Math.max(this.renderMaxX[key], right); this.renderMaxY[key] = Math.max(this.renderMaxY[key], bottom);
    }
  }

  /** Small in-bounds rect: chunk flags now, halo bits at the next flush. */
  private seedRect(x0: number, y0: number, x1: number, y1: number): void {
    const ex0 = x0 < 2 ? 0 : x0 - 2, ey0 = y0 < 2 ? 0 : y0 - 2;
    const ex1 = x1 + 2 > this.width ? this.width : x1 + 2, ey1 = y1 + 2 > this.height ? this.height : y1 + 2;
    const columns = this.columns, dirty = this.dirty, quiet = this.quiet, scheduled = this.scheduled, versions = this.versions;
    for (let cy = ey0 >> 6, cy1 = (ey1 - 1) >> 6; cy <= cy1; cy++) {
      for (let cx = ex0 >> 6, cx1 = (ex1 - 1) >> 6; cx <= cx1; cx++) {
        const key = cx + cy * columns;
        dirty[key] = 1; quiet[key] = 0; scheduled[key] = 1; versions[key]++;
      }
    }
    const seeds = this.seeds, wordsPerRow = this.wordsPerRow;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        seeds[y * wordsPerRow + (x >> 5)] |= 1 << (x & 31);
        const key = (x >> 6) + (y >> 6) * columns;
        if (this.seedChunk[key] === 0) {
          this.seedChunk[key] = 1;
          this.seededChunks[this.seededCount++] = key;
          this.seedMinX[key] = x; this.seedMaxX[key] = x; this.seedMinY[key] = y; this.seedMaxY[key] = y;
        } else {
          if (x < this.seedMinX[key]) this.seedMinX[key] = x; else if (x > this.seedMaxX[key]) this.seedMaxX[key] = x;
          if (y < this.seedMinY[key]) this.seedMinY[key] = y; else if (y > this.seedMaxY[key]) this.seedMaxY[key] = y;
        }
      }
    }
  }

  /**
   * Apply the pending contact halos (see `seeds`): dilate each seeded chunk's
   * seed box by two cells in both axes into dirtyRows + renderDirtyRows and
   * grow the per-chunk sim/render bounds to match. Idempotent; beginStep runs
   * it first, and render-damage readers (TerrainArt) call it before reading.
   */
  flushTouches(): void {
    const count = this.seededCount;
    if (count === 0) return;
    const seeds = this.seeds, dirtyRows = this.dirtyRows, renderDirtyRows = this.renderDirtyRows;
    const wordsPerRow = this.wordsPerRow, lastWord = wordsPerRow - 1, lastWordMask = this.lastWordMask;
    const width = this.width, height = this.height, columns = this.columns;
    const dilated1 = this.dilated1, dilated2 = this.dilated2;
    const minX = this.minX, minY = this.minY, maxX = this.maxX, maxY = this.maxY;
    const rMinX = this.renderMinX, rMinY = this.renderMinY, rMaxX = this.renderMaxX, rMaxY = this.renderMaxY;
    for (let n = 0; n < count; n++) {
      const key = this.seededChunks[n];
      const sx0 = this.seedMinX[key], sx1 = this.seedMaxX[key], sy0 = this.seedMinY[key], sy1 = this.seedMaxY[key];
      const w0 = (sx0 < 2 ? 0 : sx0 - 2) >> 5, w1 = (sx1 + 2 >= width ? width - 1 : sx1 + 2) >> 5;
      const spanW = w1 - w0 + 1;
      // Horizontal pass over the seed rows (carrying across words).
      for (let y = sy0; y <= sy1; y++) {
        const row = y * wordsPerRow, out = (y - sy0) * spanW - w0;
        for (let w = w0; w <= w1; w++) {
          const s = seeds[row + w];
          const prev = w > 0 ? seeds[row + w - 1] : 0;
          const next = w < lastWord ? seeds[row + w + 1] : 0;
          let h1 = s | (s << 1) | (s >>> 1) | (prev >>> 31) | (next << 31);
          let h2 = h1 | (s << 2) | (s >>> 2) | (prev >>> 30) | (next << 30);
          if (w === lastWord) { h1 &= lastWordMask; h2 &= lastWordMask; }
          dilated1[out + w] = h1;
          dilated2[out + w] = h2;
        }
      }
      // Vertical pass straight into the damage planes + bounds.
      const ry0 = sy0 < 2 ? 0 : sy0 - 2, ry1 = sy1 + 2 >= height ? height - 1 : sy1 + 2;
      for (let y = ry0; y <= ry1; y++) {
        const a2 = y - 2 < sy0 ? sy0 : y - 2, b2 = y + 2 > sy1 ? sy1 : y + 2;
        const a1 = y - 1 < sy0 ? sy0 : y - 1, b1 = y + 1 > sy1 ? sy1 : y + 1;
        const row = y * wordsPerRow, cyKey = (y >> 6) * columns;
        for (let w = w0; w <= w1; w++) {
          let v2 = 0, v1 = 0;
          for (let r = a2; r <= b2; r++) v2 |= dilated2[(r - sy0) * spanW + w - w0];
          if (v2 === 0) continue;
          for (let r = a1; r <= b1; r++) v1 |= dilated1[(r - sy0) * spanW + w - w0];
          const ck = (w >> 1) + cyKey;
          renderDirtyRows[row + w] |= v2;
          const rxs = w * 32 + 31 - Math.clz32(v2 & -v2), rxe = w * 32 + 32 - Math.clz32(v2);
          if (rxs < rMinX[ck]) rMinX[ck] = rxs;
          if (rxe > rMaxX[ck]) rMaxX[ck] = rxe;
          if (y < rMinY[ck]) rMinY[ck] = y;
          if (y + 1 > rMaxY[ck]) rMaxY[ck] = y + 1;
          if (v1 === 0) continue;
          dirtyRows[row + w] |= v1;
          const xs = w * 32 + 31 - Math.clz32(v1 & -v1), xe = w * 32 + 32 - Math.clz32(v1);
          if (xs < minX[ck]) minX[ck] = xs;
          if (xe > maxX[ck]) maxX[ck] = xe;
          if (y < minY[ck]) minY[ck] = y;
          if (y + 1 > maxY[ck]) maxY[ck] = y + 1;
        }
      }
    }
    // Seeds are cleared only after every chunk dilated: a box's carry reads can
    // see a neighbour's seed words, which must still be there for its own pass.
    for (let n = 0; n < count; n++) {
      const key = this.seededChunks[n];
      const w0 = this.seedMinX[key] >> 5, w1 = this.seedMaxX[key] >> 5;
      for (let y = this.seedMinY[key], y1 = this.seedMaxY[key]; y <= y1; y++) {
        const row = y * wordsPerRow;
        for (let w = w0; w <= w1; w++) seeds[row + w] = 0;
      }
      this.seedChunk[key] = 0;
    }
    this.seededCount = 0;
  }

  beginStep(world: World, interest?: { x0: number; y0: number; x1: number; y1: number }, tick?: number): void {
    const first = this.prepareStep();
    for (let key = 0, count = this.columns * this.rows; key < count; key++) this.reclassChunk(world, key, first, null);
    this.scheduleStep(interest, tick);
  }

  /**
   * beginStep in three parts, so a parallel sweep (sim/parallel) can run the
   * middle one -- every chunk independent of the others -- on its workers.
   * prepareStep: pending halos, the step counter, and the full reset on a
   * first/invalidated step (returned as "first").
   */
  prepareStep(): boolean {
    this.flushTouches();
    this.stepSerial++;
    const first = !this.initialized;
    if (first) {
      this.dynamic.fill(0); this.restless.fill(0); this.urgent.fill(0); this.cellClass.fill(0);
      this.eligible.fill(0); this.rowMasks.fill(0);
      this.quiet.fill(0);
      for (const set of this.growthSets) set.clear();
    }
    return first;
  }

  /**
   * Reclassify one chunk's changed cells (or age a clean chunk's quiet
   * counter). Touches only that chunk's cells, row words and counters.
   * growthSink receives growth-set edits instead of this grid applying them
   * (a parallel participant, whose growth sets are not main's); main then
   * calls applyGrowthEdit + finishGrowthEdits.
   */
  reclassChunk(world: World, key: number, first: boolean,
    growthSink: ((key: number, index: number, added: boolean) => void) | null): void {
    if (!first && !this.dirty[key]) { this.quiet[key] = Math.min(120, this.quiet[key] + 1); return; }
    const types = world.types, width = this.width, height = this.height;
    const life = world.life, charge = world.charge, wordsPerRow = this.wordsPerRow;
    const cellClass = this.cellClass, eligible = this.eligible, rowMasks = this.rowMasks, dirtyRows = this.dirtyRows;
    const tx = key % this.columns, ty = (key - tx) / this.columns, x0 = tx * 64, y0 = ty * 64;
    const x1 = Math.min(width, x0 + 64), y1 = Math.min(height, y0 + 64);
    this.growthChanged[key] = 1;
    const left = first ? x0 : this.minX[key], top = first ? y0 : this.minY[key];
    const right = first ? x1 : this.maxX[key], bottom = first ? y1 : this.maxY[key];
    const growth = this.growthSets[key];
    let growthEdited = first;
    // Chunk counters accumulate locally (Uint32 wraparound makes the order
    // of -- and ++ irrelevant) and each row word's mask is written once.
    let dDynamic = 0, dRestless = 0, dUrgent = 0;
    for (let y = top; y < bottom; y++) {
      const rowBase = y * wordsPerRow, cellRow = y * width;
      for (let word = left >> 5; word <= (right - 1) >> 5; word++) {
        const rowIndex = rowBase + word;
        let changed = first ? 0xffffffff : dirtyRows[rowIndex];
        if (changed === 0) continue;
        dirtyRows[rowIndex] = 0;
        let mask = rowMasks[rowIndex];
        while (changed !== 0) {
          const low = changed & -changed;
          changed ^= low;
          const x = word * 32 + 31 - Math.clz32(low);
          if (x >= width) continue;
          const i = x + cellRow, type = types[i], kind = category[type], old = cellClass[i], q = charge[i];
          // Inert stays inert: class 0 means the last pass left this cell
          // ineligible with its mask bit clear, and nothing about it changed.
          if (kind === 0 && old === 0 && q === 0) continue;
          if (eligible[i]) { dDynamic--; if (old & 8) dRestless--; }
          if (old & 4) dUrgent--;
          const burningOil = type === Cell.Oil && life[i] > 0;
          const urgent = urgentMaterial[type] !== 0 || q > 0 || burningOil;
          const restless = kind === 3 || q > 0 || burningOil;
          cellClass[i] = kind | (urgent ? 4 : 0) | (restless ? 8 : 0);
          if (urgent) dUrgent++;
          if ((old & 3) === 1 && kind !== 1) {
            if (growthSink === null) { growth.delete(i); growthEdited = true; } else growthSink(key, i, false);
          }
          if (kind === 1 && (old & 3) !== 1) {
            if (growthSink === null) { growth.add(i); growthEdited = true; } else growthSink(key, i, true);
          }
          let active = kind > 1;
          const restContact = type === Cell.Water ? waterRestContact : type === Cell.Oil && !burningOil ? oilRestContact
            : type === Cell.Brine ? brineRestContact : null;
          if (restContact !== null && !urgent && x > 0 && x + 1 < width && y > 0 && y + 1 < height &&
              restContact[types[i - 1]] && restContact[types[i + 1]] &&
              restContact[types[i - width]] && restContact[types[i + width]] &&
              restContact[types[i - width - 1]] && restContact[types[i - width + 1]] &&
              restContact[types[i + width - 1]] && restContact[types[i + width + 1]] &&
              (charge[i - 1] | charge[i + 1] | charge[i - width] | charge[i + width] |
               charge[i - width - 1] | charge[i - width + 1] | charge[i + width - 1] | charge[i + width + 1]) === 0) active = false;
          eligible[i] = active ? 1 : 0;
          if (active) { mask |= low; dDynamic++; if (restless) dRestless++; }
          else mask &= ~low;
        }
        rowMasks[rowIndex] = mask;
      }
    }
    this.dynamic[key] += dDynamic; this.restless[key] += dRestless; this.urgent[key] += dUrgent;
    if (growthSink === null && growthEdited) this.rebuildGrowthCells(key);
    this.dirty[key] = 0; this.minX[key] = 32767; this.minY[key] = 32767; this.maxX[key] = 0; this.maxY[key] = 0;
  }

  private rebuildGrowthCells(key: number): void {
    const cells = this.growthCells[key];
    cells.length = 0;
    for (const index of this.growthSets[key]) cells.push(index);
    cells.sort((a, b) => a - b);
  }

  /** A growth-set edit a participant's reclassChunk reported (see growthSink). */
  applyGrowthEdit(key: number, index: number, added: boolean): void {
    if (added) this.growthSets[key].add(index);
    else this.growthSets[key].delete(index);
    if (this.growthMark[key] === 0) { this.growthMark[key] = 1; this.growthEditList[this.growthEditCount++] = key; }
  }

  /** Rebuild the sorted growth lists of every chunk edited since the last call.
   *  first: a full reclass ran, so every list is rebuilt (the serial path's rule). */
  finishGrowthEdits(first: boolean): void {
    if (first) {
      for (let key = 0; key < this.growthCells.length; key++) this.rebuildGrowthCells(key);
    } else {
      for (let n = 0; n < this.growthEditCount; n++) this.rebuildGrowthCells(this.growthEditList[n]);
    }
    for (let n = 0; n < this.growthEditCount; n++) this.growthMark[this.growthEditList[n]] = 0;
    this.growthEditCount = 0;
  }

  /** Rebuild every growth set from the cell classes (a participant's growth log overflowed). */
  rebuildGrowthSets(): void {
    for (const set of this.growthSets) set.clear();
    const cellClass = this.cellClass, width = this.width, columns = this.columns;
    for (let i = 0; i < cellClass.length; i++) {
      if ((cellClass[i] & 3) !== 1) continue;
      const y = Math.floor(i / width);
      this.growthSets[((i - y * width) >> 6) + (y >> 6) * columns].add(i);
    }
    for (let key = 0; key < this.growthCells.length; key++) this.rebuildGrowthCells(key);
  }

  /** The per-chunk schedule for this step (after every chunk was reclassified). */
  scheduleStep(interest?: { x0: number; y0: number; x1: number; y1: number }, tick?: number): void {
    const width = this.width;
    this.activeChunks = 0; this.sleepingChunks = 0; this.coarseChunks = 0;
    const bounds = this.bounds;
    bounds.x0 = width; bounds.y0 = this.height; bounds.x1 = 0; bounds.y1 = 0;
    for (let ty = 0; ty < this.rows; ty++) for (let tx = 0; tx < this.columns; tx++) {
      const key = tx + ty * this.columns, x0 = tx * 64, y0 = ty * 64;
      const x1 = Math.min(width, x0 + 64), y1 = Math.min(this.height, y0 + 64);
      const near = !interest || (x1 > interest.x0 && x0 < interest.x1 && y1 > interest.y0 && y0 < interest.y1);
      // Distant fluids/growth advance at 15 Hz. Heat, active reagents and charge
      // retain 60 Hz everywhere. Activation is independent of the camera.
      const due = near || this.urgent[key] > 0 || (((tick ?? this.stepSerial) + key) & 3) === 0;
      this.growthScheduled[key] = due ? 1 : 0;
      if (!near && !this.urgent[key] && (this.dynamic[key] || this.growthCells[key].length)) this.coarseChunks++;
      const active = due && this.dynamic[key] > 0 && (this.restless[key] > 0 || this.quiet[key] < 90);
      this.scheduled[key] = active ? 1 : 0;
      if (active) {
        this.activeChunks++;
        bounds.x0 = Math.min(bounds.x0, x0); bounds.x1 = Math.max(bounds.x1, x1);
        bounds.y0 = Math.min(bounds.y0, y0); bounds.y1 = Math.max(bounds.y1, y1);
      } else this.sleepingChunks++;
    }
    this.initialized = true;
  }
}
