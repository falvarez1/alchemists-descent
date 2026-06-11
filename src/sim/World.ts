import { HEIGHT, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR } from '@/sim/colors';

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
  /** Generic per-cell countdown (fire life, smoke life, ember life, ...). */
  readonly life: Int16Array;
  /** Set when a cell moved this sim tick, so it is not simulated twice. */
  readonly moved: Uint8Array;
  /** Electrical charge ticks remaining (chain lightning, sparks). */
  readonly charge: Uint8Array;

  /** Active simulation window — only cells inside are simulated each tick. */
  readonly simBounds = { x0: 0, x1: WIDTH, y0: 0, y1: HEIGHT };

  constructor(width = WIDTH, height = HEIGHT) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.types = new Uint8Array(n);
    this.colors = new Uint32Array(n).fill(EMPTY_COLOR);
    this.life = new Int16Array(n);
    this.moved = new Uint8Array(n);
    this.charge = new Uint8Array(n);
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

  /** Set a cell's material and color; life/charge are left untouched. */
  set(x: number, y: number, t: number, color: number): void {
    const i = x + y * this.width;
    this.types[i] = t;
    this.colors[i] = color;
  }

  /** Reset a cell to empty space. */
  clearCell(x: number, y: number): void {
    const i = x + y * this.width;
    this.types[i] = Cell.Empty;
    this.colors[i] = EMPTY_COLOR;
    this.life[i] = 0;
    this.charge[i] = 0;
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
  }

  /** Wipe the whole grid back to empty space. */
  clear(): void {
    this.types.fill(Cell.Empty);
    this.colors.fill(EMPTY_COLOR);
    this.life.fill(0);
    this.moved.fill(0);
    this.charge.fill(0);
  }
}
