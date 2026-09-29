import { Cell } from '@/sim/CellType';
import { FluidFlow } from '@/sim/FluidFlow';
import type { World } from '@/sim/World';

const TILE = 8, MAX_PRESSURE_REACH = 384;
const wet = (type: number): boolean => type === Cell.Water || type === Cell.Blood;
const open = (type: number): boolean => type === Cell.Empty || type === Cell.Smoke || type === Cell.Steam;
/** Flight "previous position" deltas are stored in 1/16 cell (Int8: +-8 cells). */
const DELTA_Q = 16;

/** The flow planes on SharedArrayBuffers (sim/parallel/sharedWorld). */
export interface FlowSharedPlanes {
  vx: Float32Array;
  vy: Float32Array;
  tileActive: Uint8Array;
  inFlight: Uint8Array;
  fx: Float32Array;
  fy: Float32Array;
  fvx: Float32Array;
  fvy: Float32Array;
  pdx: Int8Array;
  pdy: Int8Array;
  tag: Uint16Array;
}

/**
 * FluidFlow for the multithreaded sandbox. Same rules, but every piece of
 * state is a flat plane several threads can see, and nothing depends on the
 * order chunks ran in:
 *
 * - Airborne-water flights live per cell (position, velocity, last delta and
 *   the step they last moved) instead of in a Map. A flight is live while its
 *   cell is water and it moved this step or last — the lazy form of the
 *   serial beginStep's stale-flight sweep. No global flight cap: a cap is a
 *   shared counter, which would make the result depend on thread timing.
 * - Momentum tiles keep their decay list as a flag plane.
 * - The pressure solver's column-surface memo is per participant and reset
 *   per chunk. Its row scan (up to 384 cells sideways) is clamped to the
 *   chunk's horizontal reach, so a very wide pool draws its donors from the
 *   ~120 columns around the outlet. Its surface scan is NOT clamped: the
 *   wavefront gives a running chunk its whole vertical band
 *   (protocol.wavefrontSchedule). An earlier checkerboard build had to clamp
 *   it too, and deep pools measurably stopped transmitting pressure.
 *
 * One instance sits on the main World (beginStep, reads, the serial phases)
 * and one on each participant's view World over the same planes.
 */
export class ParallelFlow extends FluidFlow {
  private readonly planes: FlowSharedPlanes;
  private cacheSerial = 1;
  private reachX0 = 0;
  private reachX1: number;

  constructor(private readonly width: number, height: number, planes: FlowSharedPlanes) {
    super(width, height, { vx: planes.vx, vy: planes.vy, inFlight: planes.inFlight });
    this.planes = planes;
    this.reachX1 = width;
  }

  static allocate(width: number, height: number, alloc: (bytes: number) => ArrayBufferLike): FlowSharedPlanes {
    const tiles = Math.ceil(width / TILE) * Math.ceil(height / TILE), n = width * height;
    return {
      vx: new Float32Array(alloc(tiles * 4)), vy: new Float32Array(alloc(tiles * 4)),
      tileActive: new Uint8Array(alloc(tiles)), inFlight: new Uint8Array(alloc(n)),
      fx: new Float32Array(alloc(n * 4)), fy: new Float32Array(alloc(n * 4)),
      fvx: new Float32Array(alloc(n * 4)), fvy: new Float32Array(alloc(n * 4)),
      pdx: new Int8Array(alloc(n)), pdy: new Int8Array(alloc(n)), tag: new Uint16Array(alloc(n * 2)),
    };
  }

  /** Participant: the substep's flow step (main's counter). */
  setStep(step: number): void { this.step = step; }
  get stepNumber(): number { return this.step; }

  /** Participant: a new chunk — fresh surface memo, the pressure row scan clamped to [x0, x1). */
  beginChunk(x0: number, x1: number): void {
    this.cacheSerial++;
    this.reachX0 = Math.max(0, x0); this.reachX1 = Math.min(this.width, x1);
  }

  override clearFlights(): void {
    this.planes.inFlight.fill(0);
  }

  override forget(index: number): void {
    if (this.inFlight[index] !== 0) this.inFlight[index] = 0;
  }

  override beginStep(world: World): void {
    const p = this.planes;
    if (this.epoch !== world.activity.epoch) {
      p.vx.fill(0); p.vy.fill(0); p.tileActive.fill(0); p.inFlight.fill(0); this.epoch = world.activity.epoch;
    }
    this.step++;
    this.cacheSerial++; // serial sweeps over this flow (MT off) memo per step, like FluidFlow
    // A 16-bit step tag would alias after 65536 steps; drop every flight then.
    if ((this.step & 0xffff) === 0) p.inFlight.fill(0);
    const vx = p.vx, vy = p.vy, active = p.tileActive;
    for (let t = 0; t < active.length; t++) {
      if (active[t] === 0) continue;
      vx[t] *= .94; vy[t] *= .94;
      if (Math.abs(vx[t]) + Math.abs(vy[t]) < .004) active[t] = 0;
    }
  }

  private live(world: World, index: number): boolean {
    if (this.inFlight[index] === 0 || world.types[index] !== Cell.Water) return false;
    const tag = this.planes.tag[index], step = this.step & 0xffff;
    return tag === step || tag === ((this.step - 1) & 0xffff);
  }

  override forEachFlight(
    x0: number, y0: number, x1: number, y1: number,
    visit: (index: number, x: number, y: number, previousX: number, previousY: number) => void,
  ): void {
    const p = this.planes, w = this.width, h = this.inFlight.length / w;
    const cx0 = Math.max(0, Math.floor(x0)), cy0 = Math.max(0, Math.floor(y0));
    const cx1 = Math.min(w - 1, Math.floor(x1)), cy1 = Math.min(h - 1, Math.floor(y1));
    const step = this.step & 0xffff, prev = (this.step - 1) & 0xffff;
    for (let y = cy0; y <= cy1; y++) {
      for (let i = y * w + cx0, end = y * w + cx1; i <= end; i++) {
        if (this.inFlight[i] === 0) continue;
        const tag = p.tag[i];
        if (tag !== step && tag !== prev) continue;
        const fx = p.fx[i], fy = p.fy[i];
        visit(i, fx, fy, fx - p.pdx[i] / DELTA_Q, fy - p.pdy[i] / DELTA_Q);
      }
    }
  }

  private setFlightAt(index: number, x: number, y: number, vx: number, vy: number, dx: number, dy: number): void {
    const p = this.planes;
    p.fx[index] = x; p.fy[index] = y; p.fvx[index] = vx; p.fvy[index] = vy;
    p.pdx[index] = Math.max(-127, Math.min(127, Math.round(dx * DELTA_Q)));
    p.pdy[index] = Math.max(-127, Math.min(127, Math.round(dy * DELTA_Q)));
    p.tag[index] = this.step & 0xffff;
    this.inFlight[index] = 1;
  }

  private recordTile(x: number, y: number, dx: number, dy: number): void {
    const index = (x >> 3) + (y >> 3) * this.columns;
    if (index < 0 || index >= this.vx.length) return;
    this.vx[index] = Math.max(-4, Math.min(4, this.vx[index] + dx));
    this.vy[index] = Math.max(-4, Math.min(4, this.vy[index] + dy));
    this.planes.tileActive[index] = 1;
  }

  private launchAt(world: World, x: number, y: number, vx: number, vy: number): void {
    this.setFlightAt(world.idx(x, y), x + .5, y + .5, vx, vy, 0, 0);
  }

  override fall(world: World, x: number, y: number): boolean {
    const index = world.idx(x, y), previous = this.live(world, index);
    if (y + 1 >= world.height || !open(world.type(x, y + 1))) {
      this.forget(index); return false;
    }
    if (!previous && (y + 2 >= world.height || !open(world.type(x, y + 2)))) return false;
    const p = this.planes;
    let fx: number, fy: number, vx: number, vy: number;
    if (previous) { fx = p.fx[index]; fy = p.fy[index]; vx = p.fvx[index]; vy = p.fvy[index]; }
    else { fx = x + .5; fy = y + .5; vx = Math.max(-1.8, Math.min(1.8, this.x(x, y) * .45)); vy = .8; }
    const previousX = fx, previousY = fy;
    vy = Math.min(6, vy + .24); vx *= .995;
    const steps = Math.ceil(Math.max(Math.abs(vx), vy) * 2);
    let nx = x, ny = y, px = fx, py = fy;
    for (let i = 1; i <= steps; i++) {
      const tx = fx + vx * i / steps, ty = fy + vy * i / steps;
      const ix = Math.floor(tx), iy = Math.floor(ty);
      if (ix === x && iy === y) { px = tx; py = ty; continue; }
      if (!world.inBounds(ix, iy) || !open(world.type(ix, iy))) break;
      nx = ix; ny = iy; px = tx; py = ty;
    }
    if (nx === x && ny === y) { this.forget(index); return false; }
    world.swap(x, y, nx, ny);
    this.recordTile(nx, ny, (nx - x) / 64, (ny - y) / 64);
    this.setFlightAt(world.idx(nx, ny), px, py, vx, vy, px - previousX, py - previousY);
    return true;
  }

  override move(world: World, x: number, y: number, nx: number, ny: number): void {
    world.swap(x, y, nx, ny);
    this.recordTile(nx, ny, (nx - x) / 64, (ny - y) / 64);
    if (nx !== x && ny + 2 < world.height && open(world.type(nx, ny + 1)) && open(world.type(nx, ny + 2))) {
      this.launchAt(world, nx, ny, Math.sign(nx - x) * .85, .8);
    }
  }

  private surfaceAtShared(world: World, x: number, y: number): number {
    if (this.checked[x] === this.cacheSerial && y <= this.bottom[x] && y >= this.surface[x]) {
      let top = this.surface[x];
      while (top < y && !wet(world.type(x, top))) top++;
      this.surface[x] = top; return top;
    }
    let top = y;
    while (top > 1 && y - top < 192 && wet(world.type(x, top - 1))) top--;
    this.checked[x] = this.cacheSerial; this.surface[x] = top; this.bottom[x] = y;
    return top;
  }

  override discharge(world: World, x: number, y: number): boolean {
    if (y < 3) return false;
    const direction = x + 1 < world.width && open(world.type(x + 1, y)) ? 1 : x > 0 && open(world.type(x - 1, y)) ? -1 : 0;
    if (!direction) return false;
    let left = x, right = x;
    const minLeft = Math.max(1, this.reachX0), maxRight = Math.min(world.width, this.reachX1);
    if (direction > 0) while (left > minLeft && x - left < MAX_PRESSURE_REACH && wet(world.type(left - 1, y))) left--;
    else while (right + 1 < maxRight && right - x < MAX_PRESSURE_REACH && wet(world.type(right + 1, y))) right++;
    if (right - left < 3) return false;
    let surfaceY = y;
    for (let sx = left; sx <= right; sx++) surfaceY = Math.min(surfaceY, this.surfaceAtShared(world, sx, y));
    const head = y - surfaceY;
    if (head < 3) return false;
    let moved = false;
    const reach = Math.min(5, 1 + Math.floor(Math.sqrt(head * .28)));
    for (let distance = 1; distance <= reach; distance++) {
      const targetX = x + direction * distance;
      if (!world.inBounds(targetX, y) || !open(world.type(targetX, y))) break;
      let donorX = -1, donorY = y - 2;
      const span = right - left + 1, offset = (this.step * 17 + y * 13 + distance * 7) % span;
      for (let k = 0; k < span; k++) {
        const candidateX = left + (k + offset) % span;
        const top = this.surfaceAtShared(world, candidateX, y), index = world.idx(candidateX, top);
        if (top >= donorY || world.moved[index] === world.movedTick || world.types[index] !== Cell.Water || !open(world.type(candidateX, top - 1))) continue;
        donorX = candidateX; donorY = top;
      }
      if (donorX < 0) break;
      // See FluidFlow.discharge: the hop moves water, never the charge of the air it trades with.
      const donorIndex = world.idx(donorX, donorY);
      const targetIndex = world.idx(targetX, y);
      const donorCharge = world.charge[donorIndex];
      const targetCharge = world.charge[targetIndex];
      world.swap(donorX, donorY, targetX, y);
      if (donorCharge > 0 || targetCharge > 0) {
        world.setChargeAt(donorIndex, 0);
        world.setChargeAt(targetIndex, Math.max(donorCharge, targetCharge));
      }
      if (y + 1 < world.height && open(world.type(targetX, y + 1))) {
        this.launchAt(world, targetX, y, direction * Math.min(1.8, .55 + Math.sqrt(head) * .12), .8);
      }
      this.surface[donorX] = donorY + 1;
      for (let fx = Math.min(donorX, targetX); fx <= Math.max(donorX, targetX); fx += TILE) this.recordTile(fx, y, direction * .09, 0);
      for (let fy = donorY; fy <= y; fy += TILE) this.recordTile(donorX, fy, 0, .07);
      this.recordTile(targetX, y, direction * .16, .03);
      moved = true;
    }
    return moved;
  }
}
