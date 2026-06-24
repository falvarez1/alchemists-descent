import type { Ctx, FlyingParticle, ParticleOpts, ParticlesApi } from '@/core/types';
import { EntityPool } from '@/entities/ecs';
import { MAX_PARTICLES } from '@/config/constants';
import { Cell, blocksEntity, isGas, isLiquid } from '@/sim/CellType';
import { stainCell } from '@/sim/stains';

/**
 * Ballistic flying particles: explosion debris, gore, sparks, homing coins,
 * hostile thrown rocks. Ported from spawnFlyingParticle / burstParticles /
 * updateFlyingParticles (noita-sandbox.html lines 649-716).
 */
export class Particles implements ParticlesApi {
  // Highest-churn pool in the game; it only ever uses add/removeAt/list/full/
  // clear and never references particles by EntityId, so run it untracked to
  // skip the per-spawn id allocation + WeakMap/Map bookkeeping.
  private readonly pool = new EntityPool<FlyingParticle>({ max: MAX_PARTICLES, untracked: true });
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
    p.hostileSource = opts?.hostileSource ?? null;
    p.deposit = (opts && opts.deposit) || false;
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

  /** A wet mote hitting a pool throws up a few short-lived droplets — purely
   *  visual (type=null, so they never deposit or splash again, no feedback
   *  loop) plus an occasional soft splash sound. */
  private splash(ctx: Ctx, x: number, y: number, color: number): void {
    const n = 2 + ((Math.random() * 3) | 0);
    for (let k = 0; k < n; k++) {
      this.spawn(
        x,
        y - 1,
        (Math.random() - 0.5) * 1.8,
        -0.7 - Math.random() * 1.4,
        null,
        color,
        16 + ((Math.random() * 14) | 0),
        { grav: 0.22 },
      );
    }
    if (Math.random() < 0.12) ctx.audio.splash(0.4 + Math.random() * 0.3);
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

      if (!world.inBounds(gx, gy)) {
        // a pour stream that flies off the map still drops its cell at the last
        // in-bounds step, so siphoned material is conserved
        if (p.deposit && p.type !== null) {
          const bx = Math.floor(p.x - p.vx),
            by = Math.floor(p.y - p.vy);
          if (world.inBounds(bx, by)) {
            const bi = world.idx(bx, by);
            if (world.types[bi] === Cell.Empty || isGas(world.types[bi])) world.replaceCellAt(bi, p.type, p.color);
          }
        }
        this.removeAt(i);
        continue;
      }
      if (p.life <= 0) {
        // a pour stream that runs out of arc mid-air drops its cell where it is
        if (p.deposit && p.type !== null) {
          const di = world.idx(gx, gy);
          if (world.types[di] === Cell.Empty || isGas(world.types[di])) world.replaceCellAt(di, p.type, p.color);
        }
        this.removeAt(i);
        continue;
      }

      // Hostile thrown debris (golem rocks) can strike the player
      if (p.hostileDmg > 0 && ctx.state.mode === 'play' && !player.dead) {
        const dx = player.x - p.x,
          dy = player.y - 3 - p.y;
        if (dx * dx + dy * dy < 9) {
          ctx.playerCtl.damage(p.hostileDmg, p.vx * 1.5, -1, p.hostileSource ?? 'hostile-debris');
          this.removeAt(i);
          continue;
        }
      }

      // A poured/sprayed HAZARD droplet (lava/fire/acid) that strikes a foe
      // splashes its material onto it — the stream burns enemies it hits.
      if (
        p.deposit &&
        (p.type === Cell.Lava || p.type === Cell.Fire || p.type === Cell.Acid) &&
        ctx.enemyCtl.splashHazard(p.x, p.y, p.type)
      ) {
        this.removeAt(i);
        continue;
      }

      const cell = world.types[world.idx(gx, gy)];
      if (cell !== Cell.Empty && !isGas(cell)) {
        const hitLiquid = isLiquid(cell);
        // A wet mote (a liquid particle) striking a pool kicks up a small splash.
        // ONLY liquid-typed motes splash — the purely-visual droplets splash()
        // itself spawns are type=null, so they never splash again (no runaway
        // feedback loop that would make any disturbed pool roar forever).
        if (hitLiquid && p.type !== null && isLiquid(p.type)) {
          this.splash(ctx, p.x, p.y, p.color);
        }
        // Blood spatter marks the surface it strikes — a red stain soaked into
        // the wall (stainCell only takes on sturdy materials; sand/etc. churn).
        if (p.type === Cell.Blood) stainCell(world, gx, gy, 118, 14, 20, 0.35 + Math.random() * 0.25);
        // Deposit at last free position behind us
        if (p.type !== null) {
          const blockingDebris = blocksEntity(p.type);
          if (!(hitLiquid && blockingDebris)) {
            const bx = Math.floor(p.x - p.vx),
              by = Math.floor(p.y - p.vy);
            let placed = false;
            if (world.inBounds(bx, by)) {
              const bi = world.idx(bx, by);
              if (world.types[bi] === Cell.Empty || isGas(world.types[bi])) {
                world.replaceCellAt(bi, p.type, p.color);
                if (p.type === Cell.Fire) world.life[bi] = 18 + Math.floor(Math.random() * 18);
                if (p.type === Cell.Smoke) world.life[bi] = 30 + Math.floor(Math.random() * 30);
                placed = true;
              }
            }
            // Pour streams CONSERVE: if the spot behind was full (a dense stream
            // piling up), drop the carried cell into a nearby empty cell instead
            // of losing the siphoned material.
            if (!placed && p.deposit) {
              const cand: ReadonlyArray<readonly [number, number]> = [
                [gx, gy - 1], [gx - 1, gy], [gx + 1, gy], [gx, gy - 2],
              ];
              for (const [cxp, cyp] of cand) {
                if (!world.inBounds(cxp, cyp)) continue;
                const cidx = world.idx(cxp, cyp);
                if (world.types[cidx] === Cell.Empty || isGas(world.types[cidx])) {
                  world.replaceCellAt(cidx, p.type, p.color);
                  break;
                }
              }
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
