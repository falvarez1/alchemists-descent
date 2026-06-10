import type { Ctx, ExplosionApi } from '@/core/types';
import { Cell, blocksEntity } from '@/sim/CellType';
import { EMPTY_COLOR, fireColor, smokeColor } from '@/sim/colors';

/**
 * Explosions. Ported from triggerExplosion (noita-sandbox.html lines 718-800).
 */
export class Explosions implements ExplosionApi {
  constructor(private ctx: Ctx) {}

  trigger(cx: number, cy: number, radius: number): void {
    const ctx = this.ctx;
    const world = ctx.world;
    cx = Math.floor(cx);
    cy = Math.floor(cy);
    radius = Math.floor(radius);
    ctx.shockwaves.push({
      cx: cx,
      cy: cy,
      currentRadius: 0,
      maxRadius: radius * 2.2,
      speed: 3.5,
      strength: 12,
    });
    ctx.fx.bloomKick = Math.min(0.95, ctx.fx.bloomKick + radius * 0.026);
    ctx.fx.screenShake = Math.min(ctx.fx.screenShake + radius * 0.0022, 0.045);
    ctx.audio.boom(radius);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const nx = cx + dx,
            ny = cy + dy;
          if (!world.inBounds(nx, ny)) continue;
          const ni = world.idx(nx, ny);
          const orig = world.types[ni];
          if (orig !== Cell.Metal) {
            // Terrain crumbles fully near the core, raggedly at the rim
            if (
              orig === Cell.Wall &&
              dx * dx + dy * dy > radius * radius * 0.55 &&
              Math.random() < 0.45
            )
              continue;
            // Launch a fraction of destroyed material as ballistic debris
            if (
              orig !== Cell.Empty &&
              orig !== Cell.Fire &&
              orig !== Cell.Smoke &&
              orig !== Cell.Steam &&
              Math.random() < 0.22
            ) {
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              const force = (1.2 - d / radius) * 2.6 + Math.random();
              ctx.particles.spawn(
                nx,
                ny,
                (dx / d) * force + (Math.random() - 0.5),
                (dy / d) * force - 1.2 - Math.random(),
                orig,
                world.colors[ni],
                90,
                { glow: orig === Cell.Lava || orig === Cell.Gold ? 1.5 : 0 },
              );
            }
            if (Math.random() < 0.3) {
              world.types[ni] = Cell.Fire;
              world.life[ni] = Math.floor(Math.random() * 25) + 10;
              world.colors[ni] = fireColor();
            } else if (Math.random() < 0.2) {
              world.types[ni] = Cell.Smoke;
              world.life[ni] = Math.floor(Math.random() * 30) + 20;
              world.colors[ni] = smokeColor();
            } else {
              world.types[ni] = Cell.Empty;
              world.colors[ni] = EMPTY_COLOR;
            }
            if (Math.random() < 0.4) world.charge[ni] = 4;
          }
        }
      }
    }

    // Sweep the rim: orphaned 1-2 cell specks left by the ragged edge get knocked loose
    const sweepR = radius + 4;
    for (let dy = -sweepR; dy <= sweepR; dy++) {
      for (let dx = -sweepR; dx <= sweepR; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= radius * radius * 0.5 || d2 > sweepR * sweepR) continue;
        const nx = cx + dx,
          ny = cy + dy;
        if (!world.inBounds(nx, ny)) continue;
        const ni = world.idx(nx, ny);
        const t = world.types[ni];
        if (t === Cell.Empty || t === Cell.Metal || !blocksEntity(t) || ctx.physics.cellBlocks(nx, ny))
          continue;
        if (Math.random() < 0.25) {
          ctx.particles.spawn(
            nx,
            ny,
            (Math.random() - 0.5) * 2.0,
            -0.8 - Math.random(),
            t,
            world.colors[ni],
            70,
          );
        }
        world.types[ni] = Cell.Empty;
        world.colors[ni] = EMPTY_COLOR;
      }
    }

    // Sparks fountain for drama
    ctx.particles.burst(cx, cy, Math.min(14, 4 + Math.floor(radius * 0.5)), Cell.Fire, fireColor, 1.8, {
      glow: 2.4,
      grav: 0.1,
    });

    // Entity damage
    for (const e of ctx.enemies) {
      const dx = e.x - cx,
        dy = e.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius * 1.6) {
        const dmg = Math.max(4, (1 - d / (radius * 1.6)) * radius * 2.4);
        ctx.enemyCtl.damage(e, dmg, (dx / (d || 1)) * 2.2, -1.6);
      }
    }
    if (ctx.state.mode === 'play' && !ctx.player.dead) {
      const dx = ctx.player.x - cx,
        dy = ctx.player.y - 3 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius * 1.5) {
        const dmg = Math.min(42, Math.max(3, (1 - d / (radius * 1.5)) * radius * 2.0));
        ctx.playerCtl.damage(dmg, (dx / (d || 1)) * 2.4, -1.8);
      }
    }
  }
}
