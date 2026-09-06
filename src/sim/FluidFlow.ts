import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

const TILE = 8, MAX_PRESSURE_REACH = 384;
const wet = (type: number): boolean => type === Cell.Water || type === Cell.Blood;
const open = (type: number): boolean => type === Cell.Empty || type === Cell.Smoke || type === Cell.Steam;
const MAX_FLIGHTS = 4096;

export interface WaterFlight {
  x: number; y: number; previousX: number; previousY: number;
  vx: number; vy: number; step: number;
}

/** Cell-conserving hydraulic relaxation. A submerged outlet borrows from the
 * free surface along a proven connected liquid path, so a full pool transmits
 * pressure instead of waiting for a one-cell vacancy to crawl upstream.
 * Coarse flux is shared by suspended material and aquatic bodies. It is not
 * a second liquid grid: terrain remains the authoritative material/collision map. */
export class FluidFlow {
  /** Only airborne cells need subcell momentum. Pools allocate no extra plane. */
  readonly falling = new Map<number, WaterFlight>();
  private readonly columns: number;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly active = new Set<number>();
  private readonly surface: Int16Array;
  private readonly bottom: Int16Array;
  private readonly checked: Uint32Array;
  private step = 0;
  private epoch = -1;

  constructor(width: number, height: number) {
    this.columns = Math.ceil(width / TILE);
    const count = this.columns * Math.ceil(height / TILE);
    this.vx = new Float32Array(count); this.vy = new Float32Array(count);
    this.surface = new Int16Array(width); this.bottom = new Int16Array(width); this.checked = new Uint32Array(width);
  }

  beginStep(world: World): void {
    if (this.epoch !== world.activity.epoch) {
      this.vx.fill(0); this.vy.fill(0); this.active.clear(); this.falling.clear(); this.epoch = world.activity.epoch;
    }
    this.step++;
    for (const [index, flight] of this.falling) {
      if (flight.step < this.step - 1 || world.types[index] !== Cell.Water) this.falling.delete(index);
    }
    for (const index of this.active) {
      this.vx[index] *= .94; this.vy[index] *= .94;
      if (Math.abs(this.vx[index]) + Math.abs(this.vy[index]) < .004) this.active.delete(index);
    }
  }

  x(x: number, y: number): number { return this.vx[(x >> 3) + (y >> 3) * this.columns] ?? 0; }
  y(x: number, y: number): number { return this.vy[(x >> 3) + (y >> 3) * this.columns] ?? 0; }

  forget(index: number): void { if (this.falling.size) this.falling.delete(index); }

  private launch(world: World, x: number, y: number, vx: number, vy: number): void {
    if (this.falling.size >= MAX_FLIGHTS) return;
    this.falling.set(world.idx(x, y), { x: x + .5, y: y + .5, previousX: x + .5, previousY: y + .5, vx, vy, step: this.step });
  }

  /** Carry the same material cell along a swept ballistic path. Fractional
   * momentum survives the lip; no new cells are painted into the wake. */
  fall(world: World, x: number, y: number): boolean {
    const index = world.idx(x, y), previous = this.falling.get(index);
    if (y + 1 >= world.height || !open(world.type(x, y + 1))) {
      this.forget(index); return false;
    }
    // A one-cell vacancy inside a pool uses the cheaper local settling rule.
    if (!previous && (y + 2 >= world.height || !open(world.type(x, y + 2)))) return false;
    if (!previous && this.falling.size >= MAX_FLIGHTS) return false;
    const flight = previous ?? { x: x + .5, y: y + .5, previousX: x + .5, previousY: y + .5,
      vx: Math.max(-1.8, Math.min(1.8, this.x(x, y) * .45)), vy: .8, step: this.step };
    flight.previousX = flight.x; flight.previousY = flight.y;
    flight.vy = Math.min(6, flight.vy + .24); flight.vx *= .995;
    const steps = Math.ceil(Math.max(Math.abs(flight.vx), flight.vy) * 2);
    let nx = x, ny = y, px = flight.x, py = flight.y;
    for (let i = 1; i <= steps; i++) {
      const tx = flight.x + flight.vx * i / steps, ty = flight.y + flight.vy * i / steps;
      const ix = Math.floor(tx), iy = Math.floor(ty);
      if (ix === x && iy === y) { px = tx; py = ty; continue; }
      if (!world.inBounds(ix, iy) || !open(world.type(ix, iy))) break;
      nx = ix; ny = iy; px = tx; py = ty;
    }
    if (nx === x && ny === y) { this.forget(index); return false; }
    world.swap(x, y, nx, ny);
    this.record(nx, ny, (nx - x) / 64, (ny - y) / 64);
    flight.x = px; flight.y = py; flight.step = this.step;
    this.falling.set(world.idx(nx, ny), flight);
    return true;
  }

  private record(x: number, y: number, dx: number, dy: number): void {
    const index = (x >> 3) + (y >> 3) * this.columns;
    if (index < 0 || index >= this.vx.length) return;
    this.vx[index] = Math.max(-4, Math.min(4, this.vx[index] + dx));
    this.vy[index] = Math.max(-4, Math.min(4, this.vy[index] + dy));
    this.active.add(index);
  }

  move(world: World, x: number, y: number, nx: number, ny: number): void {
    world.swap(x, y, nx, ny);
    this.record(nx, ny, (nx - x) / 64, (ny - y) / 64);
    // The final sideways step off a shelf seeds a directed stream, not a
    // random sideways decision on every airborne tick.
    if (nx !== x && ny + 2 < world.height && open(world.type(nx, ny + 1)) && open(world.type(nx, ny + 2))) {
      this.launch(world, nx, ny, Math.sign(nx - x) * .85, .8);
    }
  }

  private surfaceAt(world: World, x: number, y: number): number {
    if (this.checked[x] === this.step && y <= this.bottom[x] && y >= this.surface[x]) {
      let top = this.surface[x];
      // Surface donors may already have left during this pressure sweep.
      while (top < y && !wet(world.type(x, top))) top++;
      this.surface[x] = top; return top;
    }
    let top = y;
    while (top > 1 && y - top < 192 && wet(world.type(x, top - 1))) top--;
    this.checked[x] = this.step; this.surface[x] = top; this.bottom[x] = y;
    return top;
  }

  discharge(world: World, x: number, y: number): boolean {
    if (y < 3) return false;
    const direction = x + 1 < world.width && open(world.type(x + 1, y)) ? 1 : x > 0 && open(world.type(x - 1, y)) ? -1 : 0;
    if (!direction) return false;
    // A shallow film has little head; ordinary local spreading handles it.
    let left = x, right = x;
    if (direction > 0) while (left > 1 && x - left < MAX_PRESSURE_REACH && wet(world.type(left - 1, y))) left--;
    else while (right + 1 < world.width && right - x < MAX_PRESSURE_REACH && wet(world.type(right + 1, y))) right++;
    if (right - left < 3) return false;
    let surfaceY = y;
    for (let sx = left; sx <= right; sx++) surfaceY = Math.min(surfaceY, this.surfaceAt(world, sx, y));
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
        const top = this.surfaceAt(world, candidateX, y), index = world.idx(candidateX, top);
        if (top >= donorY || world.moved[index] === world.movedTick || world.types[index] !== Cell.Water || !open(world.type(candidateX, top - 1))) continue;
        donorX = candidateX; donorY = top;
      }
      if (donorX < 0) break;
      world.swap(donorX, donorY, targetX, y);
      if (y + 1 < world.height && open(world.type(targetX, y + 1))) {
        this.launch(world, targetX, y, direction * Math.min(1.8, .55 + Math.sqrt(head) * .12), .8);
      }
      this.surface[donorX] = donorY + 1;
      // Average displacement per 8x8 fluid tile, retained briefly as momentum.
      for (let fx = Math.min(donorX, targetX); fx <= Math.max(donorX, targetX); fx += TILE) this.record(fx, y, direction * .09, 0);
      for (let fy = donorY; fy <= y; fy += TILE) this.record(donorX, fy, 0, .07);
      this.record(targetX, y, direction * .16, .03);
      moved = true;
    }
    return moved;
  }
}
