import { HEIGHT, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR } from '@/sim/colors';

const CHARGE_SCAN_TILE = 64;

/**
 * The mutable cell-grid state of the entire game world, stored as flat typed
 * arrays indexed by `idx(x, y) = x + y * width` (row-major).
 *
 * Hot loops are expected to read/write the arrays directly; the accessor
 * methods exist for call sites where clarity beats the last nanosecond.
 *
 * Colors are packed 0xRRGGBB in a Uint32Array — see colors.ts for pack/unpack.
 */
export class World {
  readonly width: number;
  readonly height: number;

  /** Cell material, one of the Cell enum values. */
  readonly types: Uint8Array;
  /** Packed 0xRRGGBB per cell. */
  readonly colors: Uint32Array;
  /** Sparse color-only scars that must survive expedition save/restore. */
  readonly colorOverrides = new Set<number>();
  /** Generic per-cell countdown (fire life, smoke life, ember life, ...). */
  readonly life: Int16Array;
  /** Set when a cell moved this sim tick, so it is not simulated twice. */
  readonly moved: Uint8Array;
  /** Electrical charge ticks remaining (chain lightning, sparks). */
  readonly charge: Uint8Array;
  /** Sparse index of charged cells, used to avoid full-window electrical discovery every substep. */
  readonly activeCharges = new Set<number>();
  /** Coarse tiles already scanned for loaded/generated direct charge writes. */
  private readonly chargeScanTiles = new Set<number>();

  /** Active simulation window — only cells inside are simulated each tick. */
  readonly simBounds: { x0: number; x1: number; y0: number; y1: number };

  constructor(width = WIDTH, height = HEIGHT) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.types = new Uint8Array(n);
    this.colors = new Uint32Array(n).fill(EMPTY_COLOR);
    this.life = new Int16Array(n);
    this.moved = new Uint8Array(n);
    this.charge = new Uint8Array(n);
    this.simBounds = { x0: 0, x1: width, y0: 0, y1: height };
  }

  idx(x: number, y: number): number {
    return x + y * this.width;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  type(x: number, y: number): Cell {
    return this.types[x + y * this.width] as Cell;
  }

  /** Reset a cell to empty space. */
  clearCell(x: number, y: number): void {
    const i = x + y * this.width;
    this.clearCellAt(i);
  }

  /** Reset a flat-indexed cell to empty space. */
  clearCellAt(i: number): void {
    this.types[i] = Cell.Empty;
    this.colors[i] = EMPTY_COLOR;
    this.life[i] = 0;
    this.clearChargeAt(i);
    this.colorOverrides.delete(i);
  }

  /** Replace a flat-indexed cell with fresh material, clearing transient metadata. */
  replaceCellAt(i: number, t: number, color: number): void {
    this.types[i] = t;
    this.colors[i] = color;
    this.life[i] = 0;
    this.clearChargeAt(i);
    this.colorOverrides.delete(i);
  }

  /** Set charge while keeping the sparse active-charge index in step. */
  setChargeAt(i: number, charge: number): void {
    const q = Math.max(0, Math.min(255, charge | 0));
    this.charge[i] = q;
    if (q > 0) this.activeCharges.add(i);
    else this.activeCharges.delete(i);
  }

  /** Clear charge while keeping the sparse active-charge index in step. */
  clearChargeAt(i: number): void {
    this.charge[i] = 0;
    this.activeCharges.delete(i);
  }

  /**
   * Rebuild charge tracking for one active window after legacy direct writes or save loads.
   *
   * INVARIANT: positive charge must be deposited either through {@link setChargeAt}
   * (which keeps {@link activeCharges} in step) OR exist before the containing
   * 64x64 tile is first scanned here. Each tile is recorded in `chargeScanTiles`
   * and scanned at most once; a RAW `charge[i] = v` write into an already-scanned
   * tile is NEVER rediscovered, so the electrical sim (which only iterates
   * `activeCharges`) will not propagate it. Authoring/repopulation paths that
   * stamp charge directly into the grid MUST run before the sim window reaches
   * that tile (the worldgen case), or route through `setChargeAt`.
   */
  rebuildActiveChargesInBounds(bounds = this.simBounds): void {
    const bx0 = Math.max(0, Math.min(this.width, bounds.x0));
    const bx1 = Math.max(bx0, Math.min(this.width, bounds.x1));
    const by0 = Math.max(0, Math.min(this.height, bounds.y0));
    const by1 = Math.max(by0, Math.min(this.height, bounds.y1));
    if (bx0 >= bx1 || by0 >= by1) return;
    const tx0 = Math.floor(bx0 / CHARGE_SCAN_TILE);
    const tx1 = Math.floor((bx1 - 1) / CHARGE_SCAN_TILE);
    const ty0 = Math.floor(by0 / CHARGE_SCAN_TILE);
    const ty1 = Math.floor((by1 - 1) / CHARGE_SCAN_TILE);
    const tilesWide = Math.ceil(this.width / CHARGE_SCAN_TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = tx + ty * tilesWide;
        if (this.chargeScanTiles.has(key)) continue;
        const x0 = tx * CHARGE_SCAN_TILE;
        const x1 = Math.min(this.width, x0 + CHARGE_SCAN_TILE);
        const y0 = ty * CHARGE_SCAN_TILE;
        const y1 = Math.min(this.height, y0 + CHARGE_SCAN_TILE);
        for (let y = y0; y < y1; y++) {
          const row = y * this.width;
          for (let x = x0; x < x1; x++) {
            const i = row + x;
            if (this.charge[i] > 0) this.activeCharges.add(i);
          }
        }
        this.chargeScanTiles.add(key);
      }
    }
  }

  chargeTrackingCovers(bounds = this.simBounds): boolean {
    const bx0 = Math.max(0, Math.min(this.width, bounds.x0));
    const bx1 = Math.max(bx0, Math.min(this.width, bounds.x1));
    const by0 = Math.max(0, Math.min(this.height, bounds.y0));
    const by1 = Math.max(by0, Math.min(this.height, bounds.y1));
    if (bx0 >= bx1 || by0 >= by1) return true;
    const tx0 = Math.floor(bx0 / CHARGE_SCAN_TILE);
    const tx1 = Math.floor((bx1 - 1) / CHARGE_SCAN_TILE);
    const ty0 = Math.floor(by0 / CHARGE_SCAN_TILE);
    const ty1 = Math.floor((by1 - 1) / CHARGE_SCAN_TILE);
    const tilesWide = Math.ceil(this.width / CHARGE_SCAN_TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.chargeScanTiles.has(tx + ty * tilesWide)) return false;
      }
    }
    return true;
  }

  /**
   * Epoch stamp for the moved plane: instead of zeroing ~250k window cells
   * every substep, the substep increments this tick and "moved this substep"
   * means moved[i] === movedTick. One real fill(0) every 255 substeps when
   * the Uint8 wraps. Same semantics, none of the memory traffic.
   */
  movedTick = 1;

  /** Swap the full state of two cells and flag both as moved this tick. */
  swap(x1: number, y1: number, x2: number, y2: number): void {
    const a = x1 + y1 * this.width;
    const b = x2 + y2 * this.width;
    const aOverride = this.colorOverrides.has(a);
    const bOverride = this.colorOverrides.has(b);
    const t = this.types[a];
    this.types[a] = this.types[b];
    this.types[b] = t;
    const c = this.colors[a];
    this.colors[a] = this.colors[b];
    this.colors[b] = c;
    const l = this.life[a];
    this.life[a] = this.life[b];
    this.life[b] = l;
    const q = this.charge[a];
    this.charge[a] = this.charge[b];
    this.charge[b] = q;
    this.moved[a] = this.movedTick;
    this.moved[b] = this.movedTick;
    if (aOverride !== bOverride) {
      if (aOverride) {
        this.colorOverrides.delete(a);
        this.colorOverrides.add(b);
      } else {
        this.colorOverrides.delete(b);
        this.colorOverrides.add(a);
      }
    }
    this.syncChargeMembership(a);
    this.syncChargeMembership(b);
  }

  /** Wipe the whole grid back to empty space. */
  clear(): void {
    this.types.fill(Cell.Empty);
    this.colors.fill(EMPTY_COLOR);
    this.life.fill(0);
    this.moved.fill(0);
    this.charge.fill(0);
    this.colorOverrides.clear();
    this.activeCharges.clear();
    this.chargeScanTiles.clear();
  }

  private syncChargeMembership(i: number): void {
    if (this.charge[i] > 0) this.activeCharges.add(i);
    else this.activeCharges.delete(i);
  }
}
