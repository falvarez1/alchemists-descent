import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, LightningApi, LightningArc } from '@/core/types';
import { EnemySpatialIndex } from '@/entities/enemySpatial';
import { bodyMaterialDef } from '@/entities/bodyMaterials';
import { Cell, isGas } from '@/sim/CellType';
import { chargeDeposit } from '@/sim/electrical';

/** A jagged lightning path between two points (perpendicular jitter, peaking
 *  mid-span, snapping back to the endpoint). Same look as the chain-bolt arcs. */
function jaggedArc(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy) || 1;
  const steps = Math.max(2, Math.min(18, Math.round(dist)));
  const nx = -dy / dist; // perpendicular unit
  const ny = dx / dist;
  const amp = Math.min(3, dist * 0.25);
  const pts: Array<{ x: number; y: number }> = [{ x: x0, y: y0 }];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const j = i === steps ? 0 : (Math.random() - 0.5) * 2 * amp * Math.sin(t * Math.PI);
    pts.push({ x: x0 + dx * t + nx * j, y: y0 + dy * t + ny * j });
  }
  return pts;
}

// ===================== Chain Lightning =====================
export class Lightning implements LightningApi {
  readonly arcs: LightningArc[] = [];
  private readonly enemyIndex = new EnemySpatialIndex();
  private readonly enemyScratch: Ctx['enemies'] = [];
  // Reused scratch for ambientDischarge's charged-cell scan — parallel x/y
  // arrays instead of per-cell {x,y} wrappers, so the every-frame crackle pass
  // allocates nothing here (length is reset, capacity is kept).
  private readonly ambientPoolX: number[] = [];
  private readonly ambientPoolY: number[] = [];

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
            world.setChargeAt(world.idx(sx, sy), chargeDeposit(ctx, 8));
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
        world.setChargeAt(world.idx(gx, gy), chargeDeposit(ctx, 20));
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
        world.setChargeAt(world.idx(gx, gy), chargeDeposit(ctx, 20));
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

  /** A single short discharge arc between two points (the status system crawls
   *  these over a shocked body). Reuses the chain-bolt jagged look + arc list, so
   *  it both draws and seeds light. */
  spark(x0: number, y0: number, x1: number, y1: number): void {
    this.arcs.push({ pts: jaggedArc(x0, y0, x1, y1), life: 2 + ((Math.random() * 3) | 0), intensity: 0.4 + Math.random() * 0.35 });
  }

  update(): void {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      this.arcs[i].life--;
      if (this.arcs[i].life <= 0) this.arcs.splice(i, 1);
    }
  }

  /** Crackle: while cells carry charge, bridge nearby charged cells with short,
   *  dim, flickering arcs so an electrified pool reads as branching lightning —
   *  not just static cyan. Self-limited (no charge → no arcs) and frame-throttled. */
  ambientDischarge(): void {
    const RANGE = 16; // longest cell gap an ambient arc bridges
    const MAX_ARCS = 5; // max arcs spawned per frame (the short arc life gives the flicker)
    const POOL_CAP = 160; // cap on charged cells scanned per frame
    const ctx = this.ctx;
    const w = ctx.world;
    const sim = w.simBounds;
    const poolX = this.ambientPoolX;
    const poolY = this.ambientPoolY;
    let poolLen = 0;
    for (const ci of w.activeCharges) {
      if (w.charge[ci] <= 0) continue;
      const y = (ci / w.width) | 0;
      const x = ci - y * w.width;
      if (x < sim.x0 || x >= sim.x1 || y < sim.y0 || y >= sim.y1) continue;
      poolX[poolLen] = x + 0.5;
      poolY[poolLen] = y + 0.5;
      poolLen++;
      if (poolLen >= POOL_CAP) break;
    }
    if (poolLen < 2) return;
    const range2 = RANGE * RANGE;
    const count = Math.min(MAX_ARCS, 1 + (poolLen >> 3));
    for (let a = 0; a < count; a++) {
      const i0 = (Math.random() * poolLen) | 0;
      const p0x = poolX[i0];
      const p0y = poolY[i0];
      // nearest of a few random candidates, within range — keeps arcs short + local
      let p1x = 0;
      let p1y = 0;
      let found = false;
      let best = range2;
      for (let t = 0; t < 5; t++) {
        const ic = (Math.random() * poolLen) | 0;
        const cx = poolX[ic];
        const cy = poolY[ic];
        const dx = cx - p0x;
        const dy = cy - p0y;
        const d = dx * dx + dy * dy;
        if (d > 1 && d < best) {
          best = d;
          p1x = cx;
          p1y = cy;
          found = true;
        }
      }
      if (!found) continue;
      this.arcs.push({
        pts: jaggedArc(p0x, p0y, p1x, p1y),
        life: 2 + ((Math.random() * 3) | 0),
        intensity: 0.3 + Math.random() * 0.3,
      });
    }
  }

  clear(): void {
    this.arcs.length = 0;
  }
}
