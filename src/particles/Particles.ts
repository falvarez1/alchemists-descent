import type { Ctx, FlyingParticle, ParticleOpts, ParticlesApi } from '@/core/types';
import { EntityPool } from '@/entities/ecs';
import { MAX_PARTICLES } from '@/config/constants';
import { Cell, isGas } from '@/sim/CellType';
import { stainCell } from '@/sim/stains';

/**
 * Ballistic flying particles: explosion debris, gore, sparks, homing coins,
 * hostile thrown rocks. Ported from spawnFlyingParticle / burstParticles /
 * updateFlyingParticles (noita-sandbox.html lines 649-716).
 */
export class Particles implements ParticlesApi {
  private readonly pool = new EntityPool<FlyingParticle>({ max: MAX_PARTICLES });
  private readonly free: FlyingParticle[] = [];
  readonly list = this.pool.list;

  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    type: number | null,
    color: number,
    life: number,
    opts?: ParticleOpts,
  ): void {
    if (this.pool.full) return;
    const p = this.free.pop() ?? ({} as FlyingParticle);
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.type = type;
    p.color = color;
    p.life = life;
    p.grav = opts && opts.grav !== undefined ? opts.grav : 0.16;
    p.glow = (opts && opts.glow) || 0;
    p.homing = (opts && opts.homing) || false;
    p.value = opts && opts.value !== undefined ? Math.max(0, Math.floor(opts.value)) : 10;
    p.hostileDmg = (opts && opts.hostileDmg) || 0;
    this.pool.add(p);
  }

  burst(
    cx: number,
    cy: number,
    count: number,
    type: number | null,
    colorFn: () => number,
    speed: number,
    opts?: ParticleOpts,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(
        cx,
        cy,
        Math.cos(a) * s,
        Math.sin(a) * s - speed * 0.4,
        type,
        colorFn(),
        60 + Math.floor(Math.random() * 60),
        opts,
      );
    }
  }

  /**
   * O(1) removal: overwrite slot i with the tail and pop. Draw order of
   * ballistic debris is visually irrelevant, and the backward loop has
   * already processed the tail element this frame, so nothing is skipped.
   */
  private removeAt(i: number): void {
    const removed = this.pool.removeAt(i);
    if (removed && this.free.length < MAX_PARTICLES) this.free.push(removed);
  }

  update(ctx: Ctx): void {
    const world = ctx.world;
    const player = ctx.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life--;

      if (p.homing && !player.dead) {
        // gold coin homing
        const dx = player.x - p.x,
          dy = player.y - 3 - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        p.vx += (dx / d) * 0.3;
        p.vy += (dy / d) * 0.3;
        p.vx *= 0.92;
        p.vy *= 0.92;
        if (d < 2.5) {
          ctx.state.score += p.value;
          ctx.events.emit('scoreChanged', { score: ctx.state.score });
          ctx.audio.coin();
          this.removeAt(i);
          continue;
        }
      } else {
        p.vy += p.grav;
      }

      p.x += p.vx;
      p.y += p.vy;
      const gx = Math.floor(p.x),
        gy = Math.floor(p.y);

      if (!world.inBounds(gx, gy) || p.life <= 0) {
        this.removeAt(i);
        continue;
      }

      // Hostile thrown debris (golem rocks) can strike the player
      if (p.hostileDmg > 0 && ctx.state.mode === 'play' && !player.dead) {
        const dx = player.x - p.x,
          dy = player.y - 3 - p.y;
        if (dx * dx + dy * dy < 9) {
          ctx.playerCtl.damage(p.hostileDmg, p.vx * 1.5, -1);
          this.removeAt(i);
          continue;
        }
      }

      const cell = world.types[world.idx(gx, gy)];
      if (cell !== Cell.Empty && !isGas(cell)) {
        // Blood spatter marks the surface it strikes — a red stain soaked into
        // the wall (stainCell only takes on sturdy materials; sand/etc. churn).
        if (p.type === Cell.Blood) stainCell(world, gx, gy, 118, 14, 20, 0.35 + Math.random() * 0.25);
        // Deposit at last free position behind us
        if (p.type !== null) {
          const bx = Math.floor(p.x - p.vx),
            by = Math.floor(p.y - p.vy);
          if (world.inBounds(bx, by)) {
            const bi = world.idx(bx, by);
            if (world.types[bi] === Cell.Empty || isGas(world.types[bi])) {
              world.replaceCellAt(bi, p.type, p.color);
              if (p.type === Cell.Fire) world.life[bi] = 18 + Math.floor(Math.random() * 18);
              if (p.type === Cell.Smoke) world.life[bi] = 30 + Math.floor(Math.random() * 30);
            }
          }
        }
        this.removeAt(i);
      }
    }
  }

  clear(): void {
    for (const p of this.list) {
      if (this.free.length >= MAX_PARTICLES) break;
      this.free.push(p);
    }
    this.pool.clear();
  }
}
