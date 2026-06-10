import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, Projectile, ProjectilesApi } from '@/core/types';
import { Cell, isGas } from '@/sim/CellType';
import { EMPTY_COLOR, packRGB } from '@/sim/colors';

// ===================== Projectiles & Black Holes =====================
export class Projectiles implements ProjectilesApi {
  private implosionCollapse(ctx: Ctx, p: Projectile): void {
    const world = ctx.world;
    const cx = Math.floor(p.x),
      cy = Math.floor(p.y);
    const R = Math.floor(p.vortexRad! * 1.2);
    // Everything left inside the well is sheared loose and streams into the center
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const nx = cx + dx,
          ny = cy + dy;
        if (!world.inBounds(nx, ny)) continue;
        const ci = world.idx(nx, ny);
        const t = world.types[ci];
        if (t === Cell.Empty || t === Cell.Metal) continue;
        const d = Math.sqrt(d2) || 1;
        if (Math.random() < 0.35) {
          ctx.particles.spawn(
            nx,
            ny,
            (-dx / d) * (2.0 + d * 0.1),
            (-dy / d) * (2.0 + d * 0.1),
            null,
            world.colors[ci],
            60,
            { grav: 0, glow: t === Cell.Gold || t === Cell.Lava ? 1.6 : 0 },
          );
        }
        world.types[ci] = Cell.Empty;
        world.colors[ci] = EMPTY_COLOR;
      }
    }
    // Inverted shockwave: space visibly snaps inward
    ctx.shockwaves.push({ cx, cy, currentRadius: 0, maxRadius: R * 2.4, speed: 5.5, strength: -16 });
    // Converging ring of violet light
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = R * (0.8 + Math.random() * 0.4);
      ctx.particles.spawn(
        cx + Math.cos(a) * rr,
        cy + Math.sin(a) * rr,
        -Math.cos(a) * 3.2,
        -Math.sin(a) * 3.2,
        null,
        packRGB((190 + Math.random() * 60) | 0, 80, 255),
        40,
        { grav: 0, glow: 2.8 },
      );
    }
    // Pinprick of light at the singularity
    ctx.particles.burst(cx, cy, 10, null, () => packRGB(240, 220, 255), 0.8, { glow: 3.0, grav: 0 });
    ctx.fx.bloomKick = Math.min(1.1, ctx.fx.bloomKick + 0.85);
    ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.03, 0.05);
    ctx.audio.implode();
  }

  private updateSingularityGravityWells(ctx: Ctx): void {
    const world = ctx.world;
    for (let i = ctx.projectiles.length - 1; i >= 0; i--) {
      const p = ctx.projectiles[i];
      if (p.type === 'blackhole') {
        const vortexRad = Math.floor(p.vortexRad!);
        for (let dy = -vortexRad; dy <= vortexRad; dy++) {
          for (let dx = -vortexRad; dx <= vortexRad; dx++) {
            const px = Math.floor(p.x) + dx,
              py = Math.floor(p.y) + dy;
            if (!world.inBounds(px, py)) continue;
            const ci = world.idx(px, py);
            const t = world.types[ci];
            if (t === Cell.Empty || t === Cell.Metal) continue;
            const dSq = dx * dx + dy * dy;
            if (dSq <= Math.max(9, (vortexRad * 0.12) ** 2)) {
              // crossed the event horizon: gone
              world.types[ci] = Cell.Empty;
              world.colors[ci] = EMPTY_COLOR;
            } else if (t === Cell.Wall) {
              // bedrock shears loose and streams toward the singularity
              if (dSq <= vortexRad * vortexRad && Math.random() < 0.05) {
                const d = Math.sqrt(dSq) || 1;
                ctx.particles.spawn(
                  px,
                  py,
                  (-dx / d) * (1.2 + Math.random() * 1.6),
                  (-dy / d) * (1.2 + Math.random() * 1.6),
                  null,
                  world.colors[ci],
                  90,
                  { grav: 0 },
                );
                world.types[ci] = Cell.Empty;
                world.colors[ci] = EMPTY_COLOR;
              }
            } else if (dSq <= vortexRad * vortexRad && Math.random() < 0.55) {
              const stepX = px - Math.sign(dx),
                stepY = py - Math.sign(dy);
              if (world.inBounds(stepX, stepY)) {
                const st = world.types[world.idx(stepX, stepY)];
                if (st === Cell.Empty || st === Cell.Steam || st === Cell.Smoke) {
                  world.swap(px, py, stepX, stepY);
                }
              }
            }
          }
        }
        // Drag entities toward the singularity
        for (const e of ctx.enemies) {
          const dx = p.x - e.x,
            dy = p.y - e.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < vortexRad * 1.4 && d > 0.5) {
            e.vx += (dx / d) * 0.22;
            e.vy += (dy / d) * 0.22;
            if (d < 4) ctx.enemyCtl.damage(e, 2.2, 0, 0);
          }
        }
        if (ctx.state.mode === 'play' && !ctx.player.dead) {
          const dx = p.x - ctx.player.x,
            dy = p.y - (ctx.player.y - 3);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < vortexRad * 1.2 && d > 1) {
            ctx.player.vx += (dx / d) * 0.1;
            ctx.player.vy += (dy / d) * 0.1;
          }
        }
      }
    }
  }

  update(ctx: Ctx): void {
    this.updateSingularityGravityWells(ctx);

    const world = ctx.world;
    const projectiles = ctx.projectiles;
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life--;
      p.age++;

      if (p.charging) {
        p.life = 240;
        if (p.vortexRad! < ctx.params.spells.blackhole.collapseLimit!) {
          p.vortexRad = p.vortexRad! + ctx.params.spells.blackhole.chargeRate!;
        }
        continue;
      }

      if (p.type === 'blackhole' && p.life <= 0) {
        this.implosionCollapse(ctx, p);
        projectiles.splice(i, 1);
        continue;
      }

      if (p.type === 'bomb' && p.life <= 0) {
        ctx.explosions.trigger(p.x, p.y, Math.floor(ctx.params.spells.bomb.explosionRadius!));
        projectiles.splice(i, 1);
        continue;
      }

      if (p.type === 'bomb' || p.type === 'fireball') p.vy += p.type === 'fireball' ? 0.02 : 0.14;

      // Swept movement: sub-step at <=1 cell so fast bolts can't tunnel through thin walls
      const speed = Math.max(Math.abs(p.vx), Math.abs(p.vy));
      const steps = Math.max(1, Math.ceil(speed));
      let removed = false;
      for (let s = 0; s < steps && !removed; s++) {
        p.x += p.vx / steps;
        p.y += p.vy / steps;
        const gx = Math.floor(p.x),
          gy = Math.floor(p.y);

        if (!world.inBounds(gx, gy)) {
          if (p.type === 'warp') {
            p.x = clamp(p.x, 3, WIDTH - 4);
            p.y = clamp(p.y, 10, HEIGHT - 2);
            if (!ctx.spells.executeWarp(p))
              ctx.particles.burst(p.x, p.y, 10, null, () => packRGB(200, 140, 255), 1.6, {
                glow: 2.2,
                grav: -0.01,
              });
          }
          projectiles.splice(i, 1);
          removed = true;
          break;
        }

        // Hostile fireball: detonate on the player
        if (p.hostile && ctx.state.mode === 'play' && !ctx.player.dead) {
          const dx = ctx.player.x - p.x,
            dy = ctx.player.y - 9 - p.y;
          if (dx * dx + dy * dy < 85) {
            ctx.playerCtl.damage(11, p.vx * 1.7, -2.3);
            ctx.explosions.trigger(p.x, p.y, 10);
            projectiles.splice(i, 1);
            removed = true;
            break;
          }
        }
        // Player bolt: detonate on enemies
        if (!p.hostile && p.type === 'bolt') {
          let hit = false;
          for (const e of ctx.enemies) {
            const dx = e.x - p.x,
              dy = e.y - 5 - p.y;
            if (dx * dx + dy * dy < 120) {
              ctx.enemyCtl.damage(e, 18, p.vx * 0.8, -1.6);
              ctx.explosions.trigger(p.x, p.y, ctx.params.spells.bolt.explosionRadius!);
              projectiles.splice(i, 1);
              hit = true;
              break;
            }
          }
          if (hit) {
            removed = true;
            break;
          }
        }

        const col = world.types[world.idx(gx, gy)];
        if (col !== Cell.Empty && !isGas(col)) {
          if (p.type === 'bolt') {
            ctx.explosions.trigger(gx, gy, ctx.params.spells.bolt.explosionRadius!);
            world.charge[world.idx(gx, gy)] = 20;
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'fireball') {
            ctx.explosions.trigger(gx, gy, 10);
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'warp') {
            if (!ctx.spells.executeWarp(p))
              ctx.particles.burst(p.x, p.y, 10, null, () => packRGB(200, 140, 255), 1.6, {
                glow: 2.2,
                grav: -0.01,
              });
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'bomb') {
            p.vx *= -0.3;
            p.vy *= -0.2;
            p.x += p.vx;
            p.y += p.vy;
          }
          break;
        }
      }
      if (removed) continue;

      if (p.life <= 0) {
        if (p.type === 'warp') {
          p.x = clamp(p.x, 3, WIDTH - 4);
          p.y = clamp(p.y, 10, HEIGHT - 2);
          if (!ctx.spells.executeWarp(p))
            ctx.particles.burst(p.x, p.y, 10, null, () => packRGB(200, 140, 255), 1.6, {
              glow: 2.2,
              grav: -0.01,
            });
        }
        projectiles.splice(i, 1);
        continue;
      }

      if (p.type === 'fireball' && ctx.state.frameCount % 2 === 0) {
        ctx.particles.spawn(
          p.x,
          p.y,
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2,
          null,
          packRGB(255, 110, 20),
          9,
          { grav: -0.01, glow: 1.8 },
        );
      }
    }
  }
}
