import type { StockLedgeInput, StockLedgeView } from '@/core/arenaMatch';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';

interface Body { x: number; y: number; vx: number; vy: number; grounded: boolean }
type Solid = (x: number, y: number) => boolean;
type Free = (x: number, y: number) => boolean;

/** A real corner, one catch per airborne sequence, and a finite, punishable hang. */
export class StockLedge implements StockLedgeView {
  phase: StockLedgeView['phase'] = 'idle';
  airReady = true;
  x = 0; y = 0; side = 1; age = 0;
  private jumpHeld = false;
  get busy(): boolean { return this.phase !== 'idle'; }
  get protected(): boolean { return this.phase === 'hang' && this.age < 8; }
  cancel(): void { this.phase = 'idle'; this.age = 0; }
  reset(): void { this.cancel(); this.airReady = true; this.jumpHeld = false; }

  private valid(solid: Solid, free: Free): boolean {
    const { x, y, side } = this;
    if (!solid(x, y) || solid(x, y - 1) || solid(x - side, y) || solid(x - side, y + 1)) return false;
    // Enough real support for the entire landing body, with headroom above and hanging room outside.
    for (let i = 0; i <= PLAYER_HALF_W * 2 + 2; i++) if (!solid(x + side * i, y)) return false;
    return free(x + side * (PLAYER_HALF_W + 2), y - 1) && free(x - side * (PLAYER_HALF_W + 1), y + PLAYER_H - 2);
  }

  step(body: Body, keys: StockLedgeInput, canAct: boolean, solid: Solid, free: Free): Body | null {
    const jump = keys.jump && !this.jumpHeld; this.jumpHeld = keys.jump;
    if (!canAct) { this.cancel(); return null; }
    if (!this.busy) {
      if (body.grounded) { this.airReady = true; return null; }
      if (!this.airReady || body.vy < 0 || keys.down || keys.dir === 0) return null;
      this.side = keys.dir < 0 ? -1 : 1;
      for (const dy of [0, -1, 1, -2, 2, -3, 3]) for (let reach = PLAYER_HALF_W + 1; reach <= PLAYER_HALF_W + 4; reach++) {
        this.x = Math.round(body.x) + this.side * reach; this.y = Math.round(body.y) - PLAYER_H + 2 + dy;
        if (!this.valid(solid, free)) continue;
        this.phase = 'hang'; this.age = 0; this.airReady = false;
        return { x: this.x - this.side * (PLAYER_HALF_W + 1), y: this.y + PLAYER_H - 2, vx: 0, vy: 0, grounded: false };
      }
      return null;
    }
    this.age++;
    if (!this.valid(solid, free) || keys.down || (keys.dir !== 0 && keys.dir !== this.side) || (this.phase === 'hang' && this.age >= 45)) {
      this.cancel(); return { ...body, vx: -this.side * 1.5, vy: 1.8, grounded: false };
    }
    if (this.phase === 'hang') {
      if (this.age >= 4 && (keys.up || jump)) { this.phase = 'climb'; this.age = 0; }
      return { ...body, vx: 0, vy: 0, grounded: false };
    }
    let { x, y } = body;
    const landX = this.x + this.side * (PLAYER_HALF_W + 2), landY = this.y - 1;
    for (let i = 0; i < 2; i++) {
      const nx = y > landY ? x : x + Math.sign(landX - x), ny = y > landY ? y - 1 : y;
      if (!free(nx, ny)) { this.cancel(); return { ...body, vx: 0, vy: 1, grounded: false }; }
      x = nx; y = ny;
    }
    const landed = x === landX && y === landY;
    if (landed) this.cancel();
    return { x, y, vx: 0, vy: 0, grounded: landed };
  }
}
