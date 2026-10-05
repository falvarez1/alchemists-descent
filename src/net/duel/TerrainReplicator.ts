import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { createCellPatch, type CellPatch } from '@/authoring/cellPatch';

/** Cell types whose colour, life and charge change only through a tracked write. Every other type may be rewritten
 * in place by a simulation hot loop (fire flicker, a burning fuse's life), so those cells are compared every capture. */
const STEADY = new Uint8Array(256);
for (const t of [Cell.Empty, Cell.Wall, Cell.Stone, Cell.Wood, Cell.Metal]) STEADY[t] = 1;
/** Chunks re-compared each capture whatever their version says: a full cycle of the world every few seconds catches
 * any write that bypassed tracking. */
export const TERRAIN_SWEEP_CHUNKS = 6;
const CHUNK = 64;

/** Tracks the last SENT grid, not the last rendered grid. Transport backpressure
 * must be checked before capture. A full baseline recovers any missing delta.
 *
 * A capture compares only what can have changed, by the renderer's own contract (render/TerrainArt): a type change or
 * a steady cell's write moves its 64x64 chunk's activity version, and any other cell may change in place. So it diffs
 * every chunk whose version moved, every cell of a non-steady type, every charged or colour-overridden cell, and a
 * rolling sweep of a few chunks as the safety net. Before the activity grid is ready (a world the simulation has not
 * stepped) or after it is invalidated, it compares every cell. */
export class TerrainReplicator {
  private types = new Uint8Array(0);
  private colors = new Uint32Array(0);
  private life = new Int16Array(0);
  private charge = new Uint16Array(0);
  private versions = new Uint32Array(0);
  /** One bit per cell, row-major words (the activity grid's layout): its type at the last comparison was not steady. */
  private volatile = new Uint32Array(0);
  /** Set bits of `volatile` per chunk, so quiet chunks cost one read. */
  private volatileCount = new Int32Array(0);
  /** The capture that last compared each chunk whole. */
  private stamp = new Uint32Array(0);
  private serial = 0;
  /** Cells last sent with charge, so a discharge to zero is seen after the cell leaves the live index. */
  private charged = new Set<number>();
  private epoch = -1;
  private width = 0;
  private height = 0;
  private words = 0;
  private columns = 0;
  private sweep = 0;
  /** Cells compared by the last capture (instrumentation for the latency probe). */
  compared = 0;

  capture(world: World, baseline: boolean): CellPatch {
    const size = world.types.length;
    if (this.types.length !== size || this.width !== world.width) {
      this.width = world.width;
      this.height = world.height;
      this.words = Math.ceil(world.width / 32);
      this.columns = Math.ceil(world.width / CHUNK);
      const chunks = this.columns * Math.ceil(world.height / CHUNK);
      this.types = new Uint8Array(size);
      this.colors = new Uint32Array(size);
      this.life = new Int16Array(size);
      this.charge = new Uint16Array(size);
      this.volatile = new Uint32Array(this.words * world.height);
      this.volatileCount = new Int32Array(chunks);
      this.stamp = new Uint32Array(chunks);
      baseline = true;
    }
    const activity = world.activity;
    if (activity.ready) activity.flushTouches();
    const patch = createCellPatch();
    const chunks = this.stamp.length;
    if (baseline || !activity.ready || this.epoch !== activity.epoch || activity.versions.length !== chunks) {
      this.scanAll(world, baseline, patch);
      this.versions = activity.versions.slice();
      this.epoch = activity.ready ? activity.epoch : -1;
      return patch;
    }
    this.compared = 0;
    const serial = ++this.serial;
    for (let key = 0; key < chunks; key++) {
      if (activity.versions[key] === this.versions[key]) continue;
      this.versions[key] = activity.versions[key];
      this.diffChunk(world, key, serial, patch);
    }
    for (let n = 0; n < Math.min(TERRAIN_SWEEP_CHUNKS, chunks); n++) {
      if (this.stamp[this.sweep] !== serial) this.diffChunk(world, this.sweep, serial, patch);
      this.sweep = (this.sweep + 1) % chunks;
    }
    const volatile = this.volatile, words = this.words, width = this.width;
    for (let key = 0; key < chunks; key++) {
      if (this.stamp[key] === serial || this.volatileCount[key] === 0) continue;
      const cx = key % this.columns, cy = (key - cx) / this.columns;
      const w0 = (cx * CHUNK) >> 5, w1 = (Math.min(width, cx * CHUNK + CHUNK) - 1) >> 5;
      const y1 = Math.min(this.height, cy * CHUNK + CHUNK);
      for (let y = cy * CHUNK; y < y1; y++) {
        for (let w = w0; w <= w1; w++) {
          let bits = volatile[y * words + w];
          while (bits !== 0) {
            const bit = 31 - Math.clz32(bits & -bits);
            bits &= bits - 1;
            const x = w * 32 + bit;
            this.diffCell(world, x + y * width, x, y, patch);
          }
        }
      }
    }
    for (const i of world.activeCharges) this.diffIndex(world, i, patch);
    for (const i of [...this.charged]) this.diffIndex(world, i, patch);
    for (const i of world.colorOverrides) this.diffIndex(world, i, patch);
    return patch;
  }

  private scanAll(world: World, baseline: boolean, patch: CellPatch): void {
    const { types, colors, life, charge } = world;
    const width = this.width;
    this.charged.clear();
    this.volatile.fill(0);
    this.volatileCount.fill(0);
    for (let y = 0, i = 0; y < this.height; y++) {
      for (let x = 0; x < width; x++, i++) {
        const t = types[i], c = colors[i], l = life[i], q = charge[i];
        if (STEADY[t] === 0) this.mark(x, y, true);
        if (q !== 0) this.charged.add(i);
        if (
          baseline
            ? t === 0 && l === 0 && q === 0
            : t === this.types[i] && c === this.colors[i] && l === this.life[i] && q === this.charge[i]
        ) continue;
        this.push(patch, i, t, c, l, q);
      }
    }
    if (baseline) {
      this.types.set(types);
      this.colors.set(colors);
      this.life.set(life);
      this.charge.set(charge);
    }
    this.compared = types.length;
  }

  private diffChunk(world: World, key: number, serial: number, patch: CellPatch): void {
    this.stamp[key] = serial;
    const width = this.width;
    const cx = key % this.columns, cy = (key - cx) / this.columns;
    const x0 = cx * CHUNK, x1 = Math.min(width, x0 + CHUNK), y1 = Math.min(this.height, cy * CHUNK + CHUNK);
    const { types, colors, life, charge } = world;
    for (let y = cy * CHUNK; y < y1; y++) {
      for (let x = x0, i = x0 + y * width; x < x1; x++, i++) {
        const t = types[i], c = colors[i], l = life[i], q = charge[i];
        this.mark(x, y, STEADY[t] === 0);
        if (t === this.types[i] && c === this.colors[i] && l === this.life[i] && q === this.charge[i]) continue;
        this.push(patch, i, t, c, l, q);
      }
    }
    this.compared += (x1 - x0) * (y1 - cy * CHUNK);
  }

  private diffIndex(world: World, i: number, patch: CellPatch): void {
    const y = Math.floor(i / this.width);
    this.diffCell(world, i, i - y * this.width, y, patch);
  }

  private diffCell(world: World, i: number, x: number, y: number, patch: CellPatch): void {
    const t = world.types[i], c = world.colors[i], l = world.life[i], q = world.charge[i];
    this.compared++;
    if (t === this.types[i] && c === this.colors[i] && l === this.life[i] && q === this.charge[i]) return;
    this.mark(x, y, STEADY[t] === 0);
    this.push(patch, i, t, c, l, q);
  }

  private mark(x: number, y: number, on: boolean): void {
    const word = y * this.words + (x >> 5), bit = 1 << (x & 31);
    const was = (this.volatile[word] & bit) !== 0;
    if (was === on) return;
    this.volatile[word] ^= bit;
    this.volatileCount[(x >> 6) + (y >> 6) * this.columns] += on ? 1 : -1;
  }

  private push(patch: CellPatch, i: number, t: number, c: number, l: number, q: number): void {
    patch.idxs.push(i);
    patch.types.push(t);
    patch.colors.push(c);
    patch.life.push(l);
    patch.charge.push(q);
    this.types[i] = t;
    this.colors[i] = c;
    this.life[i] = l;
    this.charge[i] = q;
    if (q !== 0) this.charged.add(i);
    else this.charged.delete(i);
  }
}
