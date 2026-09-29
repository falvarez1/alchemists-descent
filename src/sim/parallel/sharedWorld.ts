import { HEIGHT, WIDTH } from '@/config/constants';
import { ActivityGrid, type ActivitySharedPlanes } from '@/sim/ActivityGrid';
import { ColorOverrides } from '@/sim/ColorOverrides';
import { EMPTY_COLOR } from '@/sim/colors';
import { ChargeIndexSet, World, type WorldPlanes } from '@/sim/World';
import { E_CHARGE_ADD, E_CHARGE_DEL, E_SCAR_ADD, E_SCAR_DEL, E_TOUCH, type EffectLog } from '@/sim/parallel/effectLog';
import { ParallelFlow, type FlowSharedPlanes } from '@/sim/parallel/ParallelFlow';

/**
 * A World whose planes live on SharedArrayBuffers, so sim workers can sweep
 * it in place (docs/SANDBOX-MT.md). Everything here is structured-cloneable:
 * posting the descriptor to a worker hands it views of the same memory.
 *
 * Only the Sandbox world is built this way. Browser APIs (WebGL uploads,
 * Blob, ImageData, crypto.subtle) refuse shared views, and every consumer of
 * the grid copies out of it before handing bytes to one — keep it so.
 */
export interface SharedWorldDescriptor {
  width: number;
  height: number;
  world: { types: SharedArrayBuffer; colors: SharedArrayBuffer; life: SharedArrayBuffer; moved: SharedArrayBuffer; charge: SharedArrayBuffer };
  chargeFlags: SharedArrayBuffer;
  scarMask: SharedArrayBuffer;
  activity: Record<keyof ActivitySharedPlanes, SharedArrayBuffer>;
  flow: Record<keyof FlowSharedPlanes, SharedArrayBuffer>;
}

const descriptors = new WeakMap<World, SharedWorldDescriptor>();

/** True where this page may create SharedArrayBuffers (COOP/COEP isolation). */
export function sharedMemoryAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' &&
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

export function sharedDescriptorOf(world: World): SharedWorldDescriptor | undefined {
  return descriptors.get(world);
}

function bufferOf(view: ArrayBufferView): SharedArrayBuffer {
  return view.buffer as SharedArrayBuffer;
}

function planesFrom(d: SharedWorldDescriptor): {
  world: WorldPlanes; chargeFlags: Uint8Array; scarMask: Uint8Array; activity: ActivitySharedPlanes; flow: FlowSharedPlanes;
} {
  const f = d.flow, a = d.activity;
  return {
    world: {
      types: new Uint8Array(d.world.types), colors: new Uint32Array(d.world.colors), life: new Int16Array(d.world.life),
      moved: new Uint8Array(d.world.moved), charge: new Uint16Array(d.world.charge),
    },
    chargeFlags: new Uint8Array(d.chargeFlags),
    scarMask: new Uint8Array(d.scarMask),
    activity: {
      scheduled: new Uint8Array(a.scheduled), dirty: new Uint8Array(a.dirty), quiet: new Uint8Array(a.quiet),
      eligible: new Uint8Array(a.eligible), rowMasks: new Uint32Array(a.rowMasks), seeds: new Uint32Array(a.seeds),
      cellClass: new Uint8Array(a.cellClass), dirtyRows: new Uint32Array(a.dirtyRows),
      dynamic: new Uint32Array(a.dynamic), restless: new Uint32Array(a.restless), urgent: new Uint32Array(a.urgent),
      minX: new Int16Array(a.minX), minY: new Int16Array(a.minY), maxX: new Int16Array(a.maxX), maxY: new Int16Array(a.maxY),
      growthChanged: new Uint8Array(a.growthChanged),
    },
    flow: {
      vx: new Float32Array(f.vx), vy: new Float32Array(f.vy), tileActive: new Uint8Array(f.tileActive),
      inFlight: new Uint8Array(f.inFlight), fx: new Float32Array(f.fx), fy: new Float32Array(f.fy),
      fvx: new Float32Array(f.fvx), fvy: new Float32Array(f.fvy), pdx: new Int8Array(f.pdx), pdy: new Int8Array(f.pdy),
      tag: new Uint16Array(f.tag),
    },
  };
}

/** The main thread's shared World (the Sandbox). Plays exactly like a normal World. */
export function createSharedWorld(width = WIDTH, height = HEIGHT): World {
  const n = width * height, columns = Math.ceil(width / 64), rows = Math.ceil(height / 64);
  const wordsPerRow = Math.ceil(width / 32), chunks = columns * rows;
  const sab = (bytes: number): SharedArrayBuffer => new SharedArrayBuffer(bytes);
  const flow = ParallelFlow.allocate(width, height, sab);
  const d: SharedWorldDescriptor = {
    width, height,
    world: { types: sab(n), colors: sab(n * 4), life: sab(n * 2), moved: sab(n), charge: sab(n * 2) },
    chargeFlags: sab(n),
    scarMask: sab(n),
    activity: {
      scheduled: sab(chunks), dirty: sab(chunks), quiet: sab(chunks), eligible: sab(n),
      rowMasks: sab(wordsPerRow * height * 4), seeds: sab(wordsPerRow * height * 4),
      cellClass: sab(n), dirtyRows: sab(wordsPerRow * height * 4),
      dynamic: sab(chunks * 4), restless: sab(chunks * 4), urgent: sab(chunks * 4),
      minX: sab(chunks * 2), minY: sab(chunks * 2), maxX: sab(chunks * 2), maxY: sab(chunks * 2),
      growthChanged: sab(chunks),
    },
    flow: {
      vx: bufferOf(flow.vx), vy: bufferOf(flow.vy), tileActive: bufferOf(flow.tileActive), inFlight: bufferOf(flow.inFlight),
      fx: bufferOf(flow.fx), fy: bufferOf(flow.fy), fvx: bufferOf(flow.fvx), fvy: bufferOf(flow.fvy),
      pdx: bufferOf(flow.pdx), pdy: bufferOf(flow.pdy), tag: bufferOf(flow.tag),
    },
  };
  const p = planesFrom(d);
  p.world.colors.fill(EMPTY_COLOR);
  p.activity.minX.fill(32767); p.activity.minY.fill(32767); // ActivityGrid's "no damage" bounds
  const world = new World(width, height, {
    planes: p.world,
    flow: new ParallelFlow(width, height, p.flow),
    activity: new ActivityGrid(width, height, p.activity),
    colorOverrides: new ColorOverrides(n, p.scarMask),
    activeCharges: new ChargeIndexSet(n, p.chargeFlags),
  });
  descriptors.set(world, d);
  return world;
}

/**
 * A sweep participant's touch recorder. Touches write their cells into the
 * shared seed plane and flag scheduled/dirty/quiet directly (same-value
 * byte stores: a benign race), and remember a per-chunk seed box privately;
 * main adopts the boxes after the sweep (ActivityGrid.adoptSeedBox). The
 * checkerboard guarantees two concurrent participants never share a seed
 * word: a rule writes within REACH of its chunk, and seed words are
 * chunk-aligned. Large or edge-clipped rects are logged for main to replay.
 */
export class ParticipantActivity extends ActivityGrid {
  log: EffectLog | null = null;
  private readonly boxMinX: Int16Array;
  private readonly boxMinY: Int16Array;
  private readonly boxMaxX: Int16Array;
  private readonly boxMaxY: Int16Array;
  private readonly boxMark: Uint8Array;
  private readonly boxList: Int32Array;
  private boxCount = 0;

  constructor(width: number, height: number, shared: ActivitySharedPlanes) {
    super(width, height, shared);
    const count = this.columns * this.rows;
    this.boxMinX = new Int16Array(count); this.boxMinY = new Int16Array(count);
    this.boxMaxX = new Int16Array(count); this.boxMaxY = new Int16Array(count);
    this.boxMark = new Uint8Array(count); this.boxList = new Int32Array(count);
  }

  override touch(x: number, y: number): void { this.touchRect(x, y, x + 1, y + 1); }

  override touchIndex(index: number): void {
    const y = Math.floor(index / this.width), x = index - y * this.width;
    this.touchRect(x, y, x + 1, y + 1);
  }

  override touchRect(x0: number, y0: number, x1: number, y1: number): void {
    const width = this.width, height = this.height, columns = this.columns;
    const small = x1 - x0 <= 2 && y1 - y0 <= 2 && x0 >= 0 && y0 >= 0 && x0 < x1 && y0 < y1 && x1 <= width && y1 <= height;
    const ex0 = Math.max(0, x0 - 2), ey0 = Math.max(0, y0 - 2);
    const ex1 = Math.min(width, x1 + 2), ey1 = Math.min(height, y1 + 2);
    if (ex0 >= ex1 || ey0 >= ey1) return;
    const scheduled = this.scheduled, dirty = this.dirty, quiet = this.quiet;
    for (let cy = ey0 >> 6, cy1 = (ey1 - 1) >> 6; cy <= cy1; cy++) {
      for (let cx = ex0 >> 6, cx1 = (ex1 - 1) >> 6; cx <= cx1; cx++) {
        const key = cx + cy * columns;
        // Store only on change: these per-chunk bytes share a handful of cache
        // lines with every other thread, and a store per swap (what the serial
        // grid does) keeps those lines bouncing between cores.
        if (dirty[key] === 0) dirty[key] = 1;
        if (scheduled[key] === 0) scheduled[key] = 1;
        if (quiet[key] !== 0) quiet[key] = 0;
      }
    }
    if (!small) {
      this.log?.put4(E_TOUCH, x0, y0, x1, y1);
      return;
    }
    const seeds = this.seeds, wordsPerRow = this.wordsPerRow;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        seeds[y * wordsPerRow + (x >> 5)] |= 1 << (x & 31);
        const key = (x >> 6) + (y >> 6) * columns;
        if (this.boxMark[key] === 0) {
          this.boxMark[key] = 1;
          this.boxList[this.boxCount++] = key;
          this.boxMinX[key] = x; this.boxMaxX[key] = x; this.boxMinY[key] = y; this.boxMaxY[key] = y;
        } else {
          if (x < this.boxMinX[key]) this.boxMinX[key] = x; else if (x > this.boxMaxX[key]) this.boxMaxX[key] = x;
          if (y < this.boxMinY[key]) this.boxMinY[key] = y; else if (y > this.boxMaxY[key]) this.boxMaxY[key] = y;
        }
      }
    }
  }

  /** Write the substep's seed boxes as [count, (key, x0, y0, x1, y1)...] and forget them. */
  publishBoxes(out: Int32Array): void {
    out[0] = this.boxCount;
    for (let n = 0; n < this.boxCount; n++) {
      const key = this.boxList[n], o = 1 + n * 5;
      out[o] = key; out[o + 1] = this.boxMinX[key]; out[o + 2] = this.boxMinY[key];
      out[o + 3] = this.boxMaxX[key]; out[o + 4] = this.boxMaxY[key];
      this.boxMark[key] = 0;
    }
    this.boxCount = 0;
  }
}

/** Scar set for participants: the shared mask is membership; Set edits are logged. */
class LoggedColorOverrides extends ColorOverrides {
  constructor(cells: number, mask: Uint8Array, private readonly log: EffectLog) { super(cells, mask); }
  override add(index: number): this {
    this.mask[index] = 255;
    this.log.put1(E_SCAR_ADD, index);
    return this;
  }
  override delete(index: number): boolean {
    if (this.mask[index] === 0) return false;
    this.mask[index] = 0;
    this.log.put1(E_SCAR_DEL, index);
    return true;
  }
  override has(index: number): boolean { return this.mask[index] !== 0; }
}

/** Charge index for participants: the shared flag plane is membership; Set edits are logged. */
class LoggedChargeIndex extends ChargeIndexSet {
  constructor(cells: number, flags: Uint8Array, private readonly log: EffectLog) { super(cells, flags); }
  override add(i: number): this {
    if (this.flags[i] === 0) { this.flags[i] = 1; this.log.put1(E_CHARGE_ADD, i); }
    return this;
  }
  override delete(i: number): boolean {
    if (this.flags[i] === 0) return false;
    this.flags[i] = 0;
    this.log.put1(E_CHARGE_DEL, i);
    return true;
  }
  override has(i: number): boolean { return this.flags[i] !== 0; }
}

export interface ParticipantView {
  world: World;
  flow: ParallelFlow;
  activity: ParticipantActivity;
}

/** A participant's World over the shared planes (a worker's, or main's own). */
export function viewSharedWorld(d: SharedWorldDescriptor, log: EffectLog): ParticipantView {
  const { width, height } = d, n = width * height;
  const p = planesFrom(d);
  const flow = new ParallelFlow(width, height, p.flow);
  const activity = new ParticipantActivity(width, height, p.activity);
  activity.log = log;
  const world = new World(width, height, {
    planes: p.world,
    flow,
    activity,
    colorOverrides: new LoggedColorOverrides(n, p.scarMask, log),
    activeCharges: new LoggedChargeIndex(n, p.chargeFlags, log),
  });
  return { world, flow, activity };
}
