import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, LightningApi, LightningArc } from '@/core/types';
import { EnemySpatialIndex } from '@/entities/enemySpatial';
import { bodyMaterialDef } from '@/entities/bodyMaterials';
import { Cell, isGas } from '@/sim/CellType';

// ===================== Chain Lightning =====================
export class Lightning implements LightningApi {
  readonly arcs: LightningArc[] = [];
  private readonly enemyIndex = new EnemySpatialIndex();
  private readonly enemyScratch: Ctx['enemies'] = [];

  constructor(private readonly ctx: Ctx) {}

  cast(ox: number, oy: number, angle: number): void {
    const ctx = this.ctx;
    const world = ctx.world;
    const params = ctx.params.spells.lightning;
    this.enemyIndex.rebuild(ctx.enemies);
    const pts: Array<{ x: number; y: number }> = [{ x: ox, y: oy }];
    let x = ox,
      y = oy,
      a = angle;
    let struck = false;

    for (let i = 0; i < params.range! && !struck; i++) {
      a += (Math.random() - 0.5) * 0.7;
      a = a * 0.78 + angle * 0.22;
      x += Math.cos(a);
      y += Math.sin(a);
      const gx = Math.floor(x),
        gy = Math.floor(y);
      if (!world.inBounds(gx, gy)) break;
      pts.push({ x, y });

      // Strike enemy
      for (const e of this.enemyIndex.query(x, y + 5, 12, this.enemyScratch)) {
        if (!this.enemyIndex.has(e)) continue;
        const dx = e.x - x,
          dy = e.y - 5 - y;
        if (dx * dx + dy * dy < 130) {
          ctx.enemyCtl.damage(e, params.damage!, Math.cos(angle) * 1.4, -0.8);
          if (e.hp <= 0) this.enemyIndex.syncLive(ctx.enemies);
          for (let j = 0; j < 5; j++) {
            const sx = clamp(gx + ((Math.random() * 5) | 0) - 2, 0, WIDTH - 1);
            const sy = clamp(gy + ((Math.random() * 5) | 0) - 2, 0, HEIGHT - 1);
            world.setChargeAt(world.idx(sx, sy), 8);
          }
          struck = true;
          break;
        }
      }
      if (struck) break;

      // Conductive (metal) rigid bodies catch the bolt and conduct it: charge
      // their surroundings (the sim chains it onward) and zap enemies in contact.
      const body = ctx.rigidBodies?.hitTest?.(x, y);
      if (body && body.material && bodyMaterialDef(body.material).conductive) {
        world.setChargeAt(world.idx(gx, gy), 20);
        for (const e of this.enemyIndex.query(body.x, body.y, 22, this.enemyScratch)) {
          if (!this.enemyIndex.has(e)) continue;
          const ex = e.x - body.x;
          const ey = e.y - 5 - body.y;
          if (ex * ex + ey * ey < 26 * 26) {
            ctx.enemyCtl.damage(e, params.damage!, Math.cos(angle) * 1.4, -0.8);
            if (e.hp <= 0) this.enemyIndex.syncLive(ctx.enemies);
          }
        }
        ctx.explosions.trigger(body.x, body.y, 3);
        struck = true;
        break;
      }

      const c = world.types[world.idx(gx, gy)];
      if (c !== Cell.Empty && !isGas(c) && c !== Cell.Fire) {
        world.setChargeAt(world.idx(gx, gy), 20);
        ctx.explosions.trigger(x, y, 4);
        this.enemyIndex.syncLive(ctx.enemies);
        struck = true;
      }
    }

    this.arcs.push({ pts, life: 8, intensity: 1.0 });
    // Visual fork branches
    for (let b = 0; b < params.branches!; b++) {
      if (pts.length < 8) break;
      const start = pts[Math.floor(pts.length * (0.3 + Math.random() * 0.5))];
      const bpts: Array<{ x: number; y: number }> = [{ x: start.x, y: start.y }];
      let bx = start.x,
        by = start.y,
        ba = angle + (Math.random() - 0.5) * 1.8;
      for (let i = 0; i < 14 + Math.random() * 12; i++) {
        ba += (Math.random() - 0.5) * 0.9;
        bx += Math.cos(ba);
        by += Math.sin(ba);
        if (!world.inBounds(Math.floor(bx), Math.floor(by))) break;
        bpts.push({ x: bx, y: by });
        const c = world.types[world.idx(Math.floor(bx), Math.floor(by))];
        if (c !== Cell.Empty && !isGas(c)) break;
      }
      this.arcs.push({ pts: bpts, life: 6, intensity: 0.55 });
    }
    ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.012, 0.045);
    ctx.audio.lightning();
  }

  update(): void {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      this.arcs[i].life--;
      if (this.arcs[i].life <= 0) this.arcs.splice(i, 1);
    }
  }

  clear(): void {
    this.arcs.length = 0;
  }
}
