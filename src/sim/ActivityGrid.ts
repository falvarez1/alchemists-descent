import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

export const ACTIVITY_SIZE = 64;
const category = new Uint8Array(256).fill(3);
for (const t of [Cell.Empty, Cell.Wall, Cell.Wood, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.Glowshroom, Cell.RawOre]) category[t] = 0;
for (const t of [Cell.Ice, Cell.Vines, Cell.Fungus, Cell.Moss, Cell.Grass]) category[t] = 1;
for (const t of [Cell.Water, Cell.Oil, Cell.Sand, Cell.Gold, Cell.Catalyst]) category[t] = 2;
const waterRestContact = new Uint8Array(256), oilRestContact = new Uint8Array(256), urgentMaterial = new Uint8Array(256);
for (const t of [Cell.Fire, Cell.Ember, Cell.Lava, Cell.Acid, Cell.Nitrogen, Cell.Steam, Cell.MarshGas]) urgentMaterial[t] = 1;
for (const t of [Cell.Water, Cell.Wall, Cell.Wood, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.RawOre]) waterRestContact[t] = 1;
for (const t of [Cell.Oil, Cell.Wall, Cell.Wood, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.RawOre]) oilRestContact[t] = 1;

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
  private readonly quiet: Uint8Array;
  private readonly cellClass: Uint8Array;
  private readonly dirtyRows: Uint32Array;
  private readonly growthSets: Set<number>[];
  private readonly minX: Int16Array;
  private readonly minY: Int16Array;
  private readonly maxX: Int16Array;
  private readonly maxY: Int16Array;

  constructor(private readonly width: number, private readonly height: number) {
    this.columns = Math.ceil(width / 64); this.rows = Math.ceil(height / 64);
    this.wordsPerRow = Math.ceil(width / 32);
    const count = this.columns * this.rows;
    this.scheduled = new Uint8Array(count); this.versions = new Uint32Array(count);
    this.dirty = new Uint8Array(count); this.dynamic = new Uint32Array(count);
    this.restless = new Uint32Array(count); this.urgent = new Uint32Array(count);
    this.quiet = new Uint8Array(count); this.eligible = new Uint8Array(width * height);
    this.cellClass = new Uint8Array(width * height);
    this.rowMasks = new Uint32Array(this.wordsPerRow * height);
    this.dirtyRows = new Uint32Array(this.wordsPerRow * height);
    this.renderDirtyRows = new Uint32Array(this.wordsPerRow * height);
    this.growthChanged = new Uint8Array(count); this.growthScheduled = new Uint8Array(count);
    this.growthCells = Array.from({ length: count }, () => []);
    this.growthSets = Array.from({ length: count }, () => new Set<number>());
    this.minX = new Int16Array(count).fill(32767); this.minY = new Int16Array(count).fill(32767);
    this.maxX = new Int16Array(count); this.maxY = new Int16Array(count);
    this.renderMinX = new Int16Array(count).fill(32767); this.renderMinY = new Int16Array(count).fill(32767);
    this.renderMaxX = new Int16Array(count); this.renderMaxY = new Int16Array(count);
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

  beginStep(world: World, interest?: { x0: number; y0: number; x1: number; y1: number }, tick?: number): void {
    this.stepSerial++;
    const first = !this.initialized, types = world.types, width = this.width;
    if (first) {
      this.dynamic.fill(0); this.restless.fill(0); this.urgent.fill(0); this.cellClass.fill(0);
      this.eligible.fill(0); this.rowMasks.fill(0);
      this.quiet.fill(0);
      for (const set of this.growthSets) set.clear();
    }
    this.activeChunks = 0; this.sleepingChunks = 0; this.coarseChunks = 0;
    const bounds = this.bounds;
    bounds.x0 = width; bounds.y0 = this.height; bounds.x1 = 0; bounds.y1 = 0;
    for (let ty = 0; ty < this.rows; ty++) for (let tx = 0; tx < this.columns; tx++) {
      const key = tx + ty * this.columns, x0 = tx * 64, y0 = ty * 64;
      const x1 = Math.min(width, x0 + 64), y1 = Math.min(this.height, y0 + 64);
      if (first || this.dirty[key]) {
        this.growthChanged[key] = 1;
        const left = first ? x0 : this.minX[key], top = first ? y0 : this.minY[key];
        const right = first ? x1 : this.maxX[key], bottom = first ? y1 : this.maxY[key];
        const growth = this.growthSets[key];
        let growthEdited = first;
        for (let y = top; y < bottom; y++) for (let word = left >> 5; word <= (right - 1) >> 5; word++) {
          const rowIndex = y * this.wordsPerRow + word;
          let changed = first ? 0xffffffff : this.dirtyRows[rowIndex];
          this.dirtyRows[rowIndex] = 0;
          while (changed !== 0) {
            const bitIndex = 31 - Math.clz32(changed & -changed), x = word * 32 + bitIndex;
            changed &= changed - 1;
            if (x >= width) continue;
            const i = x + y * width, type = types[i], kind = category[type], old = this.cellClass[i];
            if (this.eligible[i]) { this.dynamic[key]--; if (old & 8) this.restless[key]--; }
            if (old & 4) this.urgent[key]--;
            const burningOil = type === Cell.Oil && world.life[i] > 0;
            const urgent = urgentMaterial[type] || world.charge[i] > 0 || burningOil;
            const restless = kind === 3 || world.charge[i] > 0 || burningOil;
            this.cellClass[i] = kind | (urgent ? 4 : 0) | (restless ? 8 : 0);
            if (urgent) this.urgent[key]++;
            if ((old & 3) === 1 && kind !== 1) { growth.delete(i); growthEdited = true; }
            if (kind === 1 && (old & 3) !== 1) { growth.add(i); growthEdited = true; }
            let active = kind > 1;
            const restContact = type === Cell.Water ? waterRestContact : type === Cell.Oil && !burningOil ? oilRestContact : null;
            if (restContact && !urgent && x > 0 && x + 1 < width && y > 0 && y + 1 < this.height &&
                restContact[types[i - 1]] && restContact[types[i + 1]] &&
                restContact[types[i - width]] && restContact[types[i + width]] &&
                restContact[types[i - width - 1]] && restContact[types[i - width + 1]] &&
                restContact[types[i + width - 1]] && restContact[types[i + width + 1]] &&
                (!world.charge[i - 1] && !world.charge[i + 1] && !world.charge[i - width] && !world.charge[i + width] &&
                 !world.charge[i - width - 1] && !world.charge[i - width + 1] && !world.charge[i + width - 1] && !world.charge[i + width + 1])) active = false;
            this.eligible[i] = active ? 1 : 0;
            const mask = rowIndex, bit = 1 << bitIndex;
            if (active) { this.rowMasks[mask] |= bit; this.dynamic[key]++; if (restless) this.restless[key]++; }
            else this.rowMasks[mask] &= ~bit;
          }
        }
        if (growthEdited) {
          this.growthCells[key].length = 0;
          for (const index of growth) this.growthCells[key].push(index);
          this.growthCells[key].sort((a, b) => a - b);
        }
        this.dirty[key] = 0; this.minX[key] = 32767; this.minY[key] = 32767; this.maxX[key] = 0; this.maxY[key] = 0;
      } else this.quiet[key] = Math.min(120, this.quiet[key] + 1);
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
