import type { CastAction } from '@/combat/wands/compiler';
import { BOUNCE_COUNTS, INFUSED, TRIGGERED } from '@/combat/wands/WandSystem';
import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, Projectile, ProjectilesApi } from '@/core/types';
import { Cell, isGas } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, iceColor, packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';
import { probeHollow } from '@/world/secrets';

/** Solid-for-projectiles test (same gate as the impact check in update()). */
function solidAt(world: World, x: number, y: number): boolean {
  if (!world.inBounds(x, y)) return true;
  const c = world.types[world.idx(x, y)];
  return c !== Cell.Empty && !isGas(c);
}

/**
 * Trigger card payload (Wave D): cast one compiled action at an impact point,
 * aimed along the carrier's flight direction. Only the simple payloads are
 * handled — spark/bomb/warp pushes plus a lightning arc; the compiler keeps
 * the exotic cards (dig, flame, blackhole) out of trigger nests.
 */
function castActionAt(ctx: Ctx, x: number, y: number, angle: number, action: CastAction): void {
  const spells = ctx.params.spells;
  if (action.card === 'spark') {
    ctx.projectiles.push({
      x,
      y,
      vx: Math.cos(angle) * spells.bolt.velocityForce!,
      vy: Math.sin(angle) * spells.bolt.velocityForce!,
      type: 'bolt',
      life: 180,
      age: 0,
      charging: false,
      hostile: false,
    });
    ctx.audio.zap();
  } else if (action.card === 'bomb') {
    ctx.projectiles.push({
      x,
      y,
      vx: Math.cos(angle) * spells.bomb.velocityForce!,
      vy: Math.sin(angle) * spells.bomb.velocityForce! - 0.6,
      type: 'bomb',
      life: Math.floor(spells.bomb.fuseTicks!),
      age: 0,
      charging: false,
      hostile: false,
    });
  } else if (action.card === 'warp') {
    ctx.projectiles.push({
      x,
      y,
      vx: Math.cos(angle) * spells.warp.velocityForce!,
      vy: Math.sin(angle) * spells.warp.velocityForce!,
      type: 'warp',
      life: 90,
      age: 0,
      charging: false,
      hostile: false,
    });
    ctx.audio.zap();
  } else if (action.card === 'lightning') {
    ctx.lightning.cast(x, y, angle);
  }
}

/**
 * Release a projectile's trigger payload (if any) at its terminal impact.
 * No-op for projectiles the wand system never charged.
 */
function releaseTriggered(ctx: Ctx, p: Projectile): void {
  const actions = TRIGGERED.get(p);
  if (!actions) return;
  TRIGGERED.delete(p);
  const angle = Math.atan2(p.vy, p.vx);
  for (const action of actions) castActionAt(ctx, p.x, p.y, angle, action);
}

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
        releaseTriggered(ctx, p);
        projectiles.splice(i, 1);
        continue;
      }

      if (p.type === 'bomb' && p.life <= 0) {
        ctx.explosions.trigger(p.x, p.y, Math.floor(ctx.params.spells.bomb.explosionRadius!));
        releaseTriggered(ctx, p);
        projectiles.splice(i, 1);
        continue;
      }

      if (p.type === 'bomb' || p.type === 'fireball' || p.type === 'frostbolt')
        p.vy += p.type === 'bomb' ? 0.14 : p.type === 'fireball' ? 0.02 : 0.01;

      // Infuser card (Wave D): the wand charged this projectile from the
      // flask — it sheds 2 real cells of that material per frame in its wake.
      const infuseMat = INFUSED.get(p);
      if (infuseMat !== undefined) {
        const spd = Math.hypot(p.vx, p.vy) || 1;
        const colorFn = COLOR_FN[infuseMat];
        for (let d = 0; d < 2; d++) {
          const tx = Math.floor(p.x - (p.vx / spd) * 2 + (Math.random() - 0.5) * 2);
          const ty = Math.floor(p.y - (p.vy / spd) * 2 + (Math.random() - 0.5) * 2);
          if (!world.inBounds(tx, ty)) continue;
          const ti = world.idx(tx, ty);
          const t = world.types[ti];
          if (t === Cell.Empty || isGas(t)) {
            world.types[ti] = infuseMat;
            world.colors[ti] = colorFn ? colorFn() : EMPTY_COLOR;
          }
        }
      }

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

        // Hostile projectiles: fireballs detonate on the player, frostbolts
        // hit lighter but soak in as a real frozen status
        if (p.hostile && ctx.state.mode === 'play' && !ctx.player.dead) {
          const dx = ctx.player.x - p.x,
            dy = ctx.player.y - 9 - p.y;
          if (dx * dx + dy * dy < 85) {
            if (p.type === 'frostbolt') {
              ctx.playerCtl.damage(6, p.vx * 0.8, -0.6);
              ctx.player.status.frozen = Math.max(ctx.player.status.frozen, 120);
            } else {
              ctx.playerCtl.damage(11, p.vx * 1.7, -2.3);
              ctx.explosions.trigger(p.x, p.y, 10);
            }
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
              releaseTriggered(ctx, p);
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
          // Hollow-wall tell (pillar 10): a player shot striking a thin wall
          // with open space behind it knocks hollow — probed through the real
          // cells along the impact direction. The speed gate keeps a bomb
          // resting on the ground from drumming every frame.
          if (
            !p.hostile &&
            (p.type === 'bolt' || p.type === 'bomb' || p.type === 'fireball') &&
            Math.abs(p.vx) + Math.abs(p.vy) > 0.8
          ) {
            const behind = probeHollow(ctx.world, gx, gy, p.vx, p.vy);
            if (behind) {
              ctx.audio.hollowKnock();
              for (let d = 0; d < 2; d++) {
                ctx.particles.spawn(
                  gx,
                  gy,
                  (Math.random() - 0.5) * 1.4,
                  -0.4 - Math.random() * 0.9,
                  null,
                  packRGB(145, 145, 152),
                  30,
                  { grav: 0.1 },
                );
              }
            }
          }
          // Bounce card (Wave D): while charges remain, a player bolt/fireball
          // ricochets off terrain instead of detonating — reflect off the
          // axis whose substep entered the solid (cf. the bomb branch below).
          if (!p.hostile && (p.type === 'bolt' || p.type === 'fireball')) {
            const left = BOUNCE_COUNTS.get(p);
            if (left !== undefined && left > 0) {
              BOUNCE_COUNTS.set(p, left - 1);
              const prevGx = Math.floor(p.x - p.vx / steps);
              const prevGy = Math.floor(p.y - p.vy / steps);
              const hitVertical = solidAt(world, gx, prevGy); // the x-step alone hits
              const hitHorizontal = solidAt(world, prevGx, gy); // the y-step alone hits
              if (hitVertical || !hitHorizontal) p.vx *= -0.55;
              if (hitHorizontal || !hitVertical) p.vy *= -0.55;
              p.x += p.vx;
              p.y += p.vy;
              ctx.particles.burst(gx, gy, 4, null, () => packRGB(255, 215, 120), 1.2, {
                glow: 2.0,
                grav: 0.02,
              });
              break;
            }
          }
          if (p.type === 'bolt') {
            ctx.explosions.trigger(gx, gy, ctx.params.spells.bolt.explosionRadius!);
            world.charge[world.idx(gx, gy)] = 20;
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'fireball') {
            ctx.explosions.trigger(gx, gy, 10);
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'frostbolt') {
            // No blast — the impact frost-locks nearby water into real ice
            let frozen = 0;
            for (let dy = -4; dy <= 4 && frozen < 6; dy++) {
              for (let dx = -4; dx <= 4 && frozen < 6; dx++) {
                if (dx * dx + dy * dy > 16) continue;
                const nx = gx + dx,
                  ny = gy + dy;
                if (!world.inBounds(nx, ny)) continue;
                const ci = world.idx(nx, ny);
                if (world.types[ci] === Cell.Water) {
                  world.types[ci] = Cell.Ice;
                  world.colors[ci] = iceColor();
                  frozen++;
                }
              }
            }
            ctx.particles.burst(gx, gy, 10, null, iceColor, 1.3, { glow: 1.5, grav: 0.02 });
            ctx.audio.tone(900, 400, 0.1, 'sine', 0.1);
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
          // Trigger card (Wave D): a terminal terrain impact releases any
          // nested cast payload at the hit point.
          if (removed && !p.hostile) releaseTriggered(ctx, p);
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
