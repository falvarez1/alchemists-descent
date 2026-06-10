import type { CastAction } from '@/combat/wands/compiler';
import { BOUNCE_COUNTS, INFUSED, TRIGGERED } from '@/combat/wands/WandSystem';
import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, Projectile, ProjectilesApi } from '@/core/types';
import { Cell, isGas, isSolid } from '@/sim/CellType';
import { acidColor, COLOR_FN, EMPTY_COLOR, fireColor, iceColor, packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';
import { probeHollow } from '@/world/secrets';

/** Solid-for-projectiles test (same gate as the impact check in update()). */
function solidAt(world: World, x: number, y: number): boolean {
  if (!world.inBounds(x, y)) return true;
  const c = world.types[world.idx(x, y)];
  return c !== Cell.Empty && !isGas(c);
}

/** Frost shard impact: freeze standing water, rime exposed surfaces — never inside the player. */
function freezeSplash(ctx: Ctx, cx: number, cy: number, radius: number): void {
  const world = ctx.world;
  cx = Math.floor(cx);
  cy = Math.floor(cy);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const X = cx + dx,
        Y = cy + dy;
      if (!world.inBounds(X, Y)) continue;
      // never crust over the wizard
      if (Math.abs(X - ctx.player.x) <= 5 && Y <= ctx.player.y + 1 && Y >= ctx.player.y - 18)
        continue;
      const ci = world.idx(X, Y);
      const t = world.types[ci];
      if (t === Cell.Water) {
        world.types[ci] = Cell.Ice;
        world.colors[ci] = iceColor();
      } else if (t === Cell.Empty && Math.random() < 0.35) {
        // thin rime on solid-adjacent air cells
        let nearSolid = false;
        for (let k = 0; k < 4 && !nearSolid; k++) {
          const nx = X + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const ny = Y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (world.inBounds(nx, ny) && isSolid(world.types[world.idx(nx, ny)])) nearSolid = true;
        }
        if (nearSolid) {
          world.types[ci] = Cell.Ice;
          world.colors[ci] = iceColor();
        }
      }
    }
  }
  ctx.particles.burst(cx, cy, 8, null, iceColor, 1.8, { glow: 1.6, grav: 0.03 });
  ctx.audio.shatter();
}

/** Deposit a disc of liquid cells (glob splashes, future flask spills). */
function splashLiquid(
  ctx: Ctx,
  cx: number,
  cy: number,
  type: number,
  colorFn: () => number,
  radius: number,
): void {
  const world = ctx.world;
  cx = Math.floor(cx);
  cy = Math.floor(cy);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const X = cx + dx,
        Y = cy + dy;
      if (!world.inBounds(X, Y)) continue;
      const ci = world.idx(X, Y);
      const t = world.types[ci];
      if (t === Cell.Empty || isGas(t)) {
        world.types[ci] = type;
        world.colors[ci] = colorFn();
        world.life[ci] = 0;
      }
    }
  }
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

      // Per-type gravity / steering
      if (p.type === 'bomb' || p.type === 'fireball' || p.type === 'frostbolt')
        p.vy += p.type === 'bomb' ? 0.14 : p.type === 'fireball' ? 0.02 : 0.01;
      else if (p.type === 'iceshard') p.vy += 0.04;
      else if (p.type === 'meteor') p.vy += 0.07;
      else if (p.type === 'acidglob') p.vy += 0.12;
      else if (p.type === 'wisp') {
        // Seek the nearest enemy within 240px
        let best = null,
          bestD = 240 * 240;
        for (const e of ctx.enemies) {
          const dx = e.x - p.x,
            dy = e.y - 5 - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            best = e;
          }
        }
        if (best) {
          const d = Math.sqrt(bestD) || 1;
          p.vx += ((best.x - p.x) / d) * 0.42;
          p.vy += ((best.y - 5 - p.y) / d) * 0.42;
          const spd = Math.hypot(p.vx, p.vy);
          if (spd > 5.2) {
            p.vx = (p.vx / spd) * 5.2;
            p.vy = (p.vy / spd) * 5.2;
          }
        }
        if (ctx.state.frameCount % 2 === 0) {
          ctx.particles.spawn(
            p.x,
            p.y,
            (Math.random() - 0.5) * 0.25,
            (Math.random() - 0.5) * 0.25,
            null,
            packRGB(120, 230, 255),
            12,
            { grav: 0, glow: 2.4 },
          );
        }
      }

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

        // Ice lance: pierce, deep-freeze, keep flying
        if (!p.hostile && p.type === 'icelance') {
          for (const e of ctx.enemies) {
            if (e.flash > 2) continue; // already struck by this lance pass
            const dx = e.x - p.x,
              dy = e.y - 5 - p.y;
            if (dx * dx + dy * dy < 130) {
              ctx.enemyCtl.damage(e, 30 * (p.mul ?? 1), p.vx * 0.4, -0.8);
              e.status.frozen = Math.max(e.status.frozen, 150);
              ctx.particles.burst(e.x, e.y - 5, 10, null, () => packRGB(200, 240, 255), 2.2, {
                glow: 1.8,
                grav: 0.08,
              });
              ctx.audio.tone(900 + Math.random() * 300, 130, 0.12, 'sine', 0.08);
            }
          }
          // freeze water in the wake
          for (let fz = -2; fz <= 2; fz++) {
            for (let fzx = -2; fzx <= 2; fzx++) {
              const wx2 = gx + fzx,
                wy2 = gy + fz;
              if (
                world.inBounds(wx2, wy2) &&
                world.types[world.idx(wx2, wy2)] === Cell.Water &&
                Math.random() < 0.6
              ) {
                const wi = world.idx(wx2, wy2);
                world.types[wi] = Cell.Ice;
                world.colors[wi] = iceColor();
                world.life[wi] = 0;
              }
            }
          }
          // frosty contrail
          if (Math.random() < 0.5)
            ctx.particles.spawn(
              p.x,
              p.y,
              (Math.random() - 0.5) * 0.4,
              -0.2,
              null,
              packRGB(190, 235, 255),
              10,
              { grav: -0.005, glow: 1.6 },
            );
        }

        // Hostile projectiles: fireballs detonate on the player, frostbolts
        // hit lighter but soak in as a real frozen status, acid globs splash
        if (p.hostile && ctx.state.mode === 'play' && !ctx.player.dead) {
          const dx = ctx.player.x - p.x,
            dy = ctx.player.y - 9 - p.y;
          if (dx * dx + dy * dy < 85) {
            if (p.type === 'frostbolt') {
              ctx.playerCtl.damage(6, p.vx * 0.8, -0.6);
              ctx.player.status.frozen = Math.max(ctx.player.status.frozen, 120);
            } else if (p.type === 'acidglob') {
              ctx.playerCtl.damage(8, p.vx * 1.3, -1.6, 'acid');
              splashLiquid(ctx, p.x, p.y, Cell.Acid, acidColor, 3);
            } else {
              ctx.playerCtl.damage(11, p.vx * 1.7, -2.3, 'explosion');
              ctx.explosions.trigger(p.x, p.y, 10);
            }
            projectiles.splice(i, 1);
            removed = true;
            break;
          }
        }
        // Player projectiles: detonate on enemies (meteors hit a wider arc)
        if (
          !p.hostile &&
          (p.type === 'bolt' ||
            p.type === 'pellet' ||
            p.type === 'iceshard' ||
            p.type === 'wisp' ||
            p.type === 'meteor')
        ) {
          const mul = p.mul ?? 1;
          let hit = false;
          for (const e of ctx.enemies) {
            const dx = e.x - p.x,
              dy = e.y - 5 - p.y;
            if (dx * dx + dy * dy < (p.type === 'meteor' ? 200 : 120)) {
              if (p.type === 'bolt') {
                ctx.enemyCtl.damage(e, 18 * mul, p.vx * 0.8, -1.6);
                ctx.explosions.trigger(p.x, p.y, ctx.params.spells.bolt.explosionRadius!);
              } else if (p.type === 'pellet') {
                ctx.enemyCtl.damage(e, 8 * mul, p.vx * 0.6, -1.0);
                ctx.explosions.trigger(p.x, p.y, 6);
              } else if (p.type === 'iceshard') {
                ctx.enemyCtl.damage(e, 16 * mul, p.vx * 0.5, -0.8);
                e.status.frozen = Math.max(e.status.frozen, 140);
                freezeSplash(ctx, p.x, p.y, 7);
              } else if (p.type === 'wisp') {
                ctx.enemyCtl.damage(e, 13 * mul, p.vx * 0.5, -1.0);
                ctx.explosions.trigger(p.x, p.y, 5);
              } else {
                ctx.explosions.trigger(p.x, p.y, 40);
              }
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
          if (p.type === 'icelance') {
            // shatter: ice shards + frozen splash
            ctx.spells.erodeAt(gx, gy, 3);
            for (let fz = -5; fz <= 5; fz++) {
              for (let fzx = -5; fzx <= 5; fzx++) {
                if (fz * fz + fzx * fzx > 26) continue;
                const wx2 = gx + fzx,
                  wy2 = gy + fz;
                if (world.inBounds(wx2, wy2) && world.types[world.idx(wx2, wy2)] === Cell.Water) {
                  const wi = world.idx(wx2, wy2);
                  world.types[wi] = Cell.Ice;
                  world.colors[wi] = iceColor();
                  world.life[wi] = 0;
                }
              }
            }
            ctx.particles.burst(gx, gy, 16, Cell.Ice, iceColor, 2.6);
            ctx.particles.burst(gx, gy, 8, null, () => packRGB(220, 245, 255), 2.0, {
              glow: 2.0,
              grav: 0.06,
            });
            ctx.audio.tone(1600, 160, 0.14, 'triangle', 0.1);
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'pellet') {
            ctx.explosions.trigger(gx, gy, 6);
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'iceshard') {
            freezeSplash(ctx, gx, gy, 7);
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'wisp') {
            ctx.explosions.trigger(gx, gy, 5);
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'meteor') {
            ctx.explosions.trigger(gx, gy, 40);
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'acidglob') {
            splashLiquid(ctx, gx, gy, Cell.Acid, acidColor, 3);
            projectiles.splice(i, 1);
            removed = true;
          } else if (p.type === 'bolt') {
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
          if (removed && !p.hostile) {
            releaseTriggered(ctx, p);
            // Rune glyphs and levers answer to projectile strikes too
            ctx.events.emit('structureStrike', { x: gx, y: gy, radius: 7 });
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
        } else if (p.type === 'meteor') {
          ctx.explosions.trigger(p.x, p.y, 40);
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
      if (p.type === 'meteor') {
        ctx.particles.spawn(
          p.x,
          p.y,
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
          Cell.Fire,
          fireColor(),
          16 + Math.floor(Math.random() * 10),
          { grav: -0.01, glow: 2.4 },
        );
      }
    }
  }
}
