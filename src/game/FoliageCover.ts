import type { Ctx, FoliageCoverApi } from '@/core/types';
import type { World } from '@/sim/World';
import { blocksEntity } from '@/sim/CellType';
import { FOLIAGE_COVER } from '@/config/foliage';
import { surfaceFoliageInBounds } from '@/game/SurfaceFoliage';
import { foliageSupport } from '@/world/surfaceFoliage';
import { visitSurfaceFronds } from '@/world/foliageGeometry';

/** Nine torso samples inside the current crowns' outlines. The canopy's gaps
 * still show fragments of the player, but a knee-high tuft cannot hide a body. */
export function foliageCoverage(world: World, x: number, y: number): number {
  let covered = 0;
  for (const root of surfaceFoliageInBounds(world, x - 44, y - 44, x + 44, y + 44)) {
    if (!root.foreground || root.side !== 0 || root.burning || root.burn >= FOLIAGE_COVER.maxChar ||
      Math.abs(root.x - x) > 38 || Math.abs(root.y - y) > 40 || !foliageSupport(world.type(root.x, root.y + 1))) continue;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    visitSurfaceFronds(root, (ax, ay, bx, by) => {
      for (let row = 0; row < 3; row++) {
        const sy = y - 14 + row * 4;
        if (sy < Math.min(ay, by) - 1 || sy > Math.max(ay, by) + 1) continue;
        const t = Math.max(0, Math.min(1, (sy - ay) / (by - ay || 1)));
        const sx = ax + (bx - ax) * t;
        lo[row] = Math.min(lo[row], sx - 1); hi[row] = Math.max(hi[row], sx + 1);
      }
    });
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const sx = x - 3 + col * 3;
      if (sx >= lo[row] && sx <= hi[row]) covered |= 1 << (row * 3 + col);
    }
  }
  let count = 0;
  for (let bit = covered; bit; bit &= bit - 1) count++;
  return count / 9;
}

export class FoliageCover implements FoliageCoverApi {
  hidden = false;
  coverage = 0;
  progress = 0;
  private settled = 0;
  private revealUntil = 0;
  private world: World | null = null;
  private lastTick = -1;
  private lastX = 0;
  private lastY = 0;
  private readonly disposers: (() => void)[];

  constructor(private readonly ctx: Ctx) {
    this.disposers = ctx.events.asSlot(0, () => [
      ctx.events.on('cardCast', () => this.reveal()),
      ctx.events.on('flaskUsed', ({ verb }) => { if (verb === 'throw' || verb === 'pour') this.reveal(); }),
      ctx.events.on('levelChanged', () => this.reset()),
      ctx.events.on('playerDied', () => this.reset()),
      ctx.events.on('playerRespawned', () => this.reset()),
    ]);
  }

  reveal(): void {
    this.revealUntil = this.ctx.state.frameCount + FOLIAGE_COVER.revealTicks;
    this.hidden = false; this.settled = 0; this.progress = 0;
  }

  private reset(): void {
    this.hidden = false; this.coverage = 0; this.progress = 0;
    this.settled = 0; this.revealUntil = 0; this.lastTick = -1; this.world = null;
  }

  update(ctx: Ctx): void {
    const p = ctx.player, tick = ctx.state.frameCount;
    if (ctx.state.mode !== 'play' || !ctx.levels.current || p.dead || ctx.arena?.active) { this.reset(); return; }
    if (this.world !== ctx.world || tick < this.lastTick) this.reset();
    if (tick === this.lastTick) return;
    const moved = this.lastTick >= 0 && Math.hypot(p.x - this.lastX, p.y - this.lastY) > .65;
    this.world = ctx.world; this.lastTick = tick; this.lastX = p.x; this.lastY = p.y;
    this.coverage = foliageCoverage(ctx.world, p.x, p.y);
    if (p.firing || p.firePressed || p.kickT > 0 || p.recoilT > 0 || p.staggerT > 0 || (p.status?.burning ?? 0) > 0) this.reveal();
    // Close body contact reveals the player, but a creature through solid
    // terrain cannot cancel cover merely because its centre is nearby.
    if (this.coverage >= FOLIAGE_COVER.minCoverage) for (const e of ctx.enemies) {
      if (e.hp <= 0 || e.fighter !== undefined || Math.hypot(e.x - p.x, e.y - p.y) > FOLIAGE_COVER.contactRadius) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(e.x - p.x, e.y - p.y)));
      let clear = true;
      for (let i = 1; i < steps; i++) {
        if (blocksEntity(ctx.world.type(Math.floor(p.x + (e.x - p.x) * i / steps), Math.floor(p.y - 8 + (e.y - p.y) * i / steps)))) { clear = false; break; }
      }
      if (clear) { this.reveal(); break; }
    }
    // Ground contact accumulates gravity until a whole-cell collision step.
    // Actual displacement and grounded state distinguish that from a fall.
    const still = p.grounded && !moved && Math.abs(p.vx) <= FOLIAGE_COVER.maxSpeed;
    if (this.coverage >= FOLIAGE_COVER.minCoverage && still && tick >= this.revealUntil) this.settled++;
    else this.settled = 0;
    this.progress = Math.min(1, this.settled / FOLIAGE_COVER.settleTicks);
    this.hidden = this.progress === 1;
  }

  dispose(): void { for (const off of this.disposers) off(); this.reset(); }
}
