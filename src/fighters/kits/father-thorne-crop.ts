import { Cell, isGas } from '@/sim/CellType';
import type { World } from '@/sim/World';
import { DRY, STAGE_DRY, mixRgb, witherStage } from '@/fighters/kits/father-thorne-grow';

/**
 * One cast's worth of growth, as a ledger over the real grid (Ironvine's column, the Overgrowth's zone).
 *
 * It exists because Vines do not age: `handleVines` keeps a growth-energy budget in `life` (0 = charge it, >0 =
 * may sprout, -1 = dormant) that only throttles NEW growth, and nothing in the sim ever removes a Vines cell
 * for being old. So "the vines wither on their own after ~25 s" is this ledger's job: it remembers every cell
 * it wrote (the world, the index, the type it wrote), browns them over a short fade and clears each one when
 * its time comes. A cell that is no longer what was written (burnt, cut, a flutter-fallen Leaf) is let go; a
 * Vines cell the sim lifted into a swaying tendril (`entities/VineStrands`) is "owed": it is withered if it
 * settles back into the same place within `owedTicks`.
 *
 * Pure of the Ctx: the World is held by reference (levels persist, so a floor change must still be able to
 * clear what was grown in the old one), and every cosmetic or engine hook is passed in.
 */

export interface CropCell {
  x: number;
  y: number;
  cell: number;
  life: number;
  color: number;
  /** Ticks after `born` that it is written. */
  at: number;
  /** The frame it crumbles. */
  die: number;
  root: boolean;
}

/** What one step of growth did (read at once: the object is reused). */
export interface GrowReport {
  written: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const PENDING = 0, LIVE = 1, BROWN = 2, DRIED = 3, GONE = 4, OWED = 5;

export class Crop {
  readonly n: number;
  private readonly idx: Int32Array;
  private readonly xs: Int16Array;
  private readonly ys: Int16Array;
  private readonly cell: Uint8Array;
  private readonly life: Int16Array;
  private readonly color: Uint32Array;
  private readonly orig: Uint32Array;
  private readonly at: Int32Array;
  private readonly die: Int32Array;
  private readonly root: Uint8Array;
  private readonly state: Uint8Array;
  private readonly byIdx = new Map<number, number>();
  private next = 0;
  /** Cells written and not yet withered or lost. */
  live = 0;
  /** Cells written, ever. */
  written = 0;
  /** The first foe caught in an Ironvine crop is marked once. */
  caught = false;
  /** The latest frame any cell is due to crumble. */
  readonly lastDie: number;
  readonly firstDie: number;
  /** The rectangle the crop covers. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;

  constructor(readonly world: World, readonly kind: 'vine' | 'over', readonly born: number, cells: readonly CropCell[]) {
    const n = this.n = cells.length;
    this.idx = new Int32Array(n);
    this.xs = new Int16Array(n);
    this.ys = new Int16Array(n);
    this.cell = new Uint8Array(n);
    this.life = new Int16Array(n);
    this.color = new Uint32Array(n);
    this.orig = new Uint32Array(n);
    this.at = new Int32Array(n);
    this.die = new Int32Array(n);
    this.root = new Uint8Array(n);
    this.state = new Uint8Array(n);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, last = 0, first = Infinity;
    cells.forEach((c, i) => {
      this.idx[i] = world.idx(c.x, c.y);
      this.xs[i] = c.x;
      this.ys[i] = c.y;
      this.cell[i] = c.cell;
      this.life[i] = c.life;
      this.color[i] = this.orig[i] = c.color;
      this.at[i] = c.at;
      this.die[i] = c.die;
      this.root[i] = c.root ? 1 : 0;
      this.byIdx.set(this.idx[i], i);
      if (c.x < x0) x0 = c.x;
      if (c.x > x1) x1 = c.x;
      if (c.y < y0) y0 = c.y;
      if (c.y > y1) y1 = c.y;
      if (c.die > last) last = c.die;
      if (c.die < first) first = c.die;
    });
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    this.lastDie = last;
    this.firstDie = n > 0 ? first : 0;
  }

  /** Done: every cell has been written (or refused) and then withered or lost. */
  get finished(): boolean {
    return this.next >= this.n && this.live === 0;
  }

  /** Still writing: cells remain whose time has not come. */
  get growing(): boolean {
    return this.next < this.n;
  }

  /**
   * Write every cell whose time has come (`age` ticks after the cast). `blocked(x, y)`: a body holds that cell.
   * `onWrite` is told of each cell written (the caller samples it for sparks).
   */
  grow(age: number, blocked: (x: number, y: number) => boolean, report: GrowReport, onWrite?: (x: number, y: number, cell: number) => void): void {
    const w = this.world;
    report.written = 0;
    report.x0 = Infinity; report.y0 = Infinity; report.x1 = -Infinity; report.y1 = -Infinity;
    while (this.next < this.n && this.at[this.next] <= age) {
      const i = this.next++;
      if (this.state[i] !== PENDING) continue;
      const wi = this.idx[i];
      const t = w.types[wi];
      const x = this.xs[i], y = this.ys[i];
      if ((t !== Cell.Empty && !isGas(t)) || blocked(x, y)) { this.state[i] = GONE; continue; }
      w.replaceCellAt(wi, this.cell[i], this.color[i]);
      w.life[wi] = this.life[i];
      w.moved[wi] = w.movedTick;
      this.state[i] = LIVE;
      this.live++;
      this.written++;
      report.written++;
      onWrite?.(x, y, this.cell[i]);
      if (x < report.x0) report.x0 = x;
      if (x > report.x1) report.x1 = x;
      if (y < report.y0) report.y0 = y;
      if (y > report.y1) report.y1 = y;
    }
  }

  /** The cell of this crop at world index `wi` that is still standing as written, or -1. */
  find(wi: number): number {
    const i = this.byIdx.get(wi);
    if (i === undefined) return -1;
    const s = this.state[i];
    return (s === LIVE || s === BROWN || s === DRIED) && this.world.types[wi] === this.cell[i] ? i : -1;
  }

  /** True when world index `wi` is one of this crop's cells, standing, and a climbable root. */
  isRoot(wi: number): boolean {
    const i = this.find(wi);
    return i >= 0 && this.root[i] === 1;
  }

  /**
   * Brown and crumble what is due. Returns how many cells crumbled this call (so the caller can make a sound).
   * `crumbled(x, y, cell)` is told of each, for a flake of dust.
   *
   * A Vines cell that is missing at its time because the sim lifted it into a swaying strand cannot be cleared
   * (the strand holds it): `cut(x, y)` is asked to sever that strand there, lowest cell first so that what is cut
   * never leaves a loose end to fall and settle somewhere new. Whatever it answers, the cell is let go; without a
   * `cut` the cell stays owed (and is withered if the strand settles back) until the owing runs out.
   */
  wither(now: number, fade: number, owedTicks: number, crumbled?: (x: number, y: number, cell: number) => void, cut?: (x: number, y: number) => boolean): number {
    const w = this.world;
    let gone = 0;
    let due: number[] | null = null;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if (s === PENDING || s === GONE) continue;
      const wi = this.idx[i];
      const here = w.types[wi] === this.cell[i];
      const die = this.die[i];
      if (!here) {
        // Burnt, cut or blown: let go. A Vines cell may instead have been lifted into a swaying strand
        // (entities/VineStrands) that settles back into the same place: it is owed until then, or until the owing runs out.
        if (this.cell[i] === Cell.Vines && now < die + owedTicks) {
          this.state[i] = OWED;
          if (cut && now >= die) (due ??= []).push(i);
          continue;
        }
        this.state[i] = GONE;
        this.live--;
        continue;
      }
      if (s === OWED) this.state[i] = LIVE; // it is back
      const stage = witherStage(now, die, fade);
      if (stage === 3) {
        crumbled?.(this.xs[i], this.ys[i], this.cell[i]);
        w.clearCellAt(wi);
        this.state[i] = GONE;
        this.live--;
        gone++;
        continue;
      }
      if (stage >= 1 && this.state[i] < (stage === 1 ? BROWN : DRIED)) {
        this.state[i] = stage === 1 ? BROWN : DRIED;
        const c = mixRgb(this.orig[i], DRY, STAGE_DRY[stage]);
        w.colors[wi] = c;
        w.activity.touchIndex(wi);
      }
    }
    if (due && cut) this.severLowestFirst(due, cut);
    return gone;
  }

  /** Ask `cut` to sever the strands holding these missing Vines cells, the lowest first; then let the cells go. */
  private severLowestFirst(list: number[], cut: (x: number, y: number) => boolean): void {
    list.sort((a, b) => this.ys[b] - this.ys[a]);
    for (const i of list) {
      cut(this.xs[i], this.ys[i]);
      this.state[i] = GONE;
      this.live--;
    }
  }

  /**
   * Clear every cell still standing as written (a respawn, a floor change, an unequip). Returns how many.
   * A Vines cell lifted into a strand is cut loose with `cut`, lowest first (see `wither`).
   */
  wipe(cut?: (x: number, y: number) => boolean): number {
    const w = this.world;
    let n = 0;
    let lifted: number[] | null = null;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if (s === PENDING || s === GONE) continue;
      const wi = this.idx[i];
      if (w.types[wi] === this.cell[i]) { w.clearCellAt(wi); n++; } else if (cut && this.cell[i] === Cell.Vines) (lifted ??= []).push(i);
      this.state[i] = GONE;
    }
    this.next = this.n;
    this.live = 0;
    if (lifted && cut) {
      lifted.sort((a, b) => this.ys[b] - this.ys[a]);
      for (const i of lifted) cut(this.xs[i], this.ys[i]);
    }
    return n;
  }

  /** A random cell that stands as written (a place for a glint): false when a few tries find none. */
  sample(rand: () => number, out: { x: number; y: number; cell: number }): boolean {
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(rand() * this.n);
      const s = this.state[i];
      if ((s === LIVE || s === BROWN) && this.world.types[this.idx[i]] === this.cell[i]) {
        out.x = this.xs[i];
        out.y = this.ys[i];
        out.cell = this.cell[i];
        return true;
      }
    }
    return false;
  }

  /** Cells currently standing as written. */
  standing(): number {
    const w = this.world;
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if ((s === LIVE || s === BROWN || s === DRIED) && w.types[this.idx[i]] === this.cell[i]) n++;
    }
    return n;
  }
}
