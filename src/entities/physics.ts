// ===================== Entity physics (loose-rubble collision) =====================
// Ported from noita-sandbox.html lines 1487-1563
// (cellBlocks / entityFree / crushLooseDebris / tryMoveEntity).

import { HEIGHT, WIDTH } from '@/config/constants';
import type { Ctx, PhysicsApi } from '@/core/types';
import { blocksEntity, Cell, isGas, isLiquid } from '@/sim/CellType';
import { cellBlocksEntityWithLooseRubble } from '@/sim/collision';
import { EMPTY_COLOR } from '@/sim/colors';

export class Physics implements PhysicsApi {
  // Loose-rubble rule: a solid cell only blocks a moving body if it belongs to a
  // connected cluster of 5+ cells (8-connectivity). Anything smaller is rubble —
  // bodies walk straight through it and it disperses as particles.
  private readonly _cfX = new Int32Array(24);
  private readonly _cfY = new Int32Array(24);
  private readonly _collisionScratch = { x: this._cfX, y: this._cfY };

  constructor(private ctx: Ctx) {}

  cellBlocks(X: number, Y: number): boolean {
    return cellBlocksEntityWithLooseRubble(this.ctx.world, X, Y, this._collisionScratch);
  }

  entityFree(cx: number, cy: number, halfW: number, h: number): boolean {
    for (let dx = -halfW; dx <= halfW; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const X = cx + dx,
          Y = cy - dy;
        if (X < 0 || X >= WIDTH || Y >= HEIGHT) return false;
        if (Y < 0) continue;
        if (this.cellBlocks(X, Y)) return false;
      }
    }
    return true;
  }

  // After a body moves, any loose rubble overlapping it gets kicked aside with a puff
  crushLooseDebris(ent: { x: number; y: number }, halfW: number, h: number): void {
    const ctx = this.ctx;
    const world = ctx.world;
    let crushed = 0;
    for (let dx = -halfW; dx <= halfW && crushed < 18; dx++) {
      for (let dy = 0; dy < h && crushed < 18; dy++) {
        const X = ent.x + dx,
          Y = ent.y - dy;
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        const t = world.types[i];
        if (!blocksEntity(t) || isLiquid(t) || isGas(t)) continue;
        // it's inside the body, so it must be loose — kick it out
        ctx.particles.spawn(
          X,
          Y,
          Math.sign(dx || (Math.random() - 0.5)) * (0.8 + Math.random() * 1.2),
          -0.6 - Math.random() * 1.0,
          t === Cell.Gold ? Cell.Gold : null,
          world.colors[i],
          t === Cell.Gold ? 200 : 40,
          t === Cell.Gold ? { homing: ctx.state.mode === 'play', glow: 2.0, grav: 0 } : undefined,
        );
        world.types[i] = Cell.Empty;
        world.colors[i] = EMPTY_COLOR;
        crushed++;
      }
    }
  }

  tryMoveEntity(
    ent: { x: number; y: number },
    dx: number,
    dy: number,
    halfW: number,
    h: number,
    stepUp: number,
  ): boolean {
    if (dy !== 0) {
      if (this.entityFree(ent.x, ent.y + dy, halfW, h)) {
        ent.y += dy;
        this.crushLooseDebris(ent, halfW, h);
        return true;
      }
      return false;
    }
    if (this.entityFree(ent.x + dx, ent.y, halfW, h)) {
      ent.x += dx;
      this.crushLooseDebris(ent, halfW, h);
      return true;
    }
    if (stepUp) {
      for (let s = 1; s <= stepUp; s++) {
        if (this.entityFree(ent.x + dx, ent.y - s, halfW, h)) {
          ent.x += dx;
          ent.y -= s;
          this.crushLooseDebris(ent, halfW, h);
          return true;
        }
      }
    }
    return false;
  }
}
