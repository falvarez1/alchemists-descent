import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { Cell, isGas, isLiquid } from '@/sim/CellType';
import { EMPTY_COLOR, fireColor, packRGB, smokeColor } from '@/sim/colors';
import type { Ctx, Projectile, SpellId, SpellsApi } from '@/core/types';

/**
 * Player spell casting: wand geometry, the excavation ray, warp teleport
 * resolution, the play-mode per-frame casting dispatch, and the build-mode
 * one-shot casts (original castSpellProjectile → castBuildSpell).
 */
export class Spells implements SpellsApi {
  constructor(private readonly ctx: Ctx) {}

  wandTip(): { x: number; y: number } {
    const { player } = this.ctx;
    return {
      x: player.x + Math.cos(player.aimAngle) * 9,
      y: (player.y - 9) + Math.sin(player.aimAngle) * 9,
    };
  }

  // --- Excavation: ray-march along the aim, chew the first diggable face ---
  digRay(ox: number, oy: number, angle: number, range: number): { x: number; y: number; hit: Cell } | null {
    const { world } = this.ctx;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let x = ox, y = oy;
    for (let s = 0; s < range; s++) {
      x += dx; y += dy;
      const gx = Math.floor(x), gy = Math.floor(y);
      if (!world.inBounds(gx, gy)) return null;
      const c = world.types[world.idx(gx, gy)];
      if (c === Cell.Empty || isGas(c) || c === Cell.Fire || isLiquid(c)) continue;
      return { x: gx, y: gy, hit: c as Cell };
    }
    return null;
  }

  erodeAt(gx: number, gy: number, rad: number): number {
    const { world } = this.ctx;
    let chewed = 0, debris = 0;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const X = gx + dx, Y = gy + dy;
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        const c = world.types[i];
        if (c === Cell.Wall || c === Cell.Sand || c === Cell.Wood || c === Cell.Ice || c === Cell.Vines || c === Cell.Stone || c === Cell.Gunpowder) {
          if (debris < 2 && Math.random() < 0.16) {
            this.ctx.particles.spawn(X, Y, (Math.random() - 0.5) * 1.6, -0.7 - Math.random() * 0.9,
              c === Cell.Wood ? Cell.Wood : Cell.Sand, world.colors[i], 55);
            debris++;
          }
          world.types[i] = Cell.Empty; world.colors[i] = EMPTY_COLOR; chewed++;
        }
      }
    }
    return chewed;
  }

  // --- Warp: blink the wizard to where the bolt struck ---
  executeWarp(p: Projectile): boolean {
    const { player } = this.ctx;
    if (this.ctx.state.mode !== 'play' || player.dead) return false;
    const spd = Math.hypot(p.vx, p.vy) || 1;
    const bx = -p.vx / spd, by = -p.vy / spd;
    for (let s = 0; s < 62; s += 2) {
      const cx = Math.floor(p.x + bx * s);
      for (let dy = 0; dy <= 19; dy += 2) {
        for (const sign of (dy === 0 ? [1] : [1, -1])) {
          const ty = Math.floor(p.y + by * s) + dy * sign;
          if (ty < 18 || ty > HEIGHT - 2 || cx < 5 || cx > WIDTH - 6) continue;
          if (this.ctx.physics.entityFree(cx, ty, 4, 17)) {
            this.ctx.particles.burst(player.x, player.y - 7, 18, null, () => packRGB(200, 140, 255), 2.6, { glow: 2.4, grav: -0.01 });
            player.x = cx; player.y = ty;
            player.vx = 0; player.vy = 0; player.fx = 0; player.fy = 0;
            player.invuln = Math.max(player.invuln, 25);
            this.ctx.particles.burst(player.x, player.y - 7, 22, null, () => packRGB(225, 170, 255), 2.9, { glow: 2.6, grav: -0.01 });
            this.ctx.audio.zap();
            return true;
          }
        }
      }
    }
    return false;
  }

  firePlayerSpell(): void {
    const { player, projectiles, input } = this.ctx;
    if (player.dead || player.cooldown > 0) return;
    const sp = this.ctx.params.spells[player.spell];
    if (player.mana < sp.manaCost) return;
    const tip = this.wandTip();
    const a = player.aimAngle;

    if (player.spell === 'bolt') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      projectiles.push({ x: tip.x, y: tip.y, vx: Math.cos(a) * sp.velocityForce!, vy: Math.sin(a) * sp.velocityForce!, type: 'bolt', life: 180, age: 0, charging: false, hostile: false });
      this.ctx.audio.zap();
    } else if (player.spell === 'bomb') {
      // Worms-style: holding charges the throw; release happens on mouseup
      if (input.bombCharge < 0) input.bombCharge = 0;
      else input.bombCharge = Math.min(1, input.bombCharge + 1 / 65);
      if (input.bombCharge >= 1 && this.ctx.state.frameCount % 20 === 0) this.ctx.audio.tone(880, 35, 0.05, 'square', 0.04); // full-power tick
    } else if (player.spell === 'lightning') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      this.ctx.lightning.cast(tip.x, tip.y, a);
    } else if (player.spell === 'flame') {
      player.mana -= sp.manaCost;
      this.ctx.audio.flame();
      for (let j = 0; j < 4; j++) {
        const spreadA = a + (Math.random() - 0.5) * sp.spread!;
        const spd = 3.2 + Math.random() * 2.2;
        this.ctx.particles.spawn(tip.x, tip.y, Math.cos(spreadA) * spd + player.vx * 0.4,
          Math.sin(spreadA) * spd, Cell.Fire, fireColor(),
          14 + Math.floor(Math.random() * 12), { grav: -0.015, glow: 2.2 });
      }
    } else if (player.spell === 'dig') {
      player.mana -= sp.manaCost;
      const hit = this.digRay(tip.x, tip.y, a, sp.range!);
      const reach = hit ? Math.hypot(hit.x - tip.x, hit.y - tip.y) : sp.range!;
      this.ctx.fx.digBeam = { x0: tip.x, y0: tip.y, x1: tip.x + Math.cos(a) * reach, y1: tip.y + Math.sin(a) * reach, life: 3 };
      this.ctx.audio.dig();
      if (hit) {
        this.erodeAt(hit.x, hit.y, 4);
        if (this.ctx.state.frameCount % 3 === 0) this.ctx.particles.burst(hit.x, hit.y, 2, Cell.Smoke, smokeColor, 0.7);
      }
    } else if (player.spell === 'warp') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      projectiles.push({ x: tip.x, y: tip.y, vx: Math.cos(a) * sp.velocityForce!, vy: Math.sin(a) * sp.velocityForce!, type: 'warp', life: 90, age: 0, charging: false, hostile: false });
      this.ctx.audio.zap();
    } else if (player.spell === 'blackhole') {
      if (input.activeChargingBlackHole) return;
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      const p: Projectile = { x: input.mouse.x, y: input.mouse.y, vx: 0, vy: 0, type: 'blackhole', vortexRad: sp.baseRadius!, life: 240, age: 0, charging: true, hostile: false };
      projectiles.push(p);
      input.activeChargingBlackHole = p;
    }
  }

  // ===================== Build-Mode Spell Casting =====================
  // Build-mode casts originate from the PREVIOUS frame's camera snapshot
  // (ctx.camera.renderX/renderY) — preserved by design.

  emitBuildFlame(): void {
    const { camera, input } = this.ctx;
    const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
    const a = Math.atan2(input.mouse.y - startY, input.mouse.x - startX);
    for (let j = 0; j < 3; j++) {
      const spreadA = a + (Math.random() - 0.5) * this.ctx.params.spells.flame.spread!;
      const spd = 3.4 + Math.random() * 2.5;
      this.ctx.particles.spawn(startX, startY - 1, Math.cos(spreadA) * spd, Math.sin(spreadA) * spd,
        Cell.Fire, fireColor(), 16 + Math.floor(Math.random() * 12), { grav: -0.015, glow: 2.2 });
    }
    if (this.ctx.state.frameCount % 10 === 0) this.ctx.audio.flame();
  }

  castBuildSpell(type: SpellId, targetX: number, targetY: number): void {
    const { camera, projectiles, input } = this.ctx;
    const spells = this.ctx.params.spells;
    if (type === 'blackhole') {
      const p: Projectile = { x: targetX, y: targetY, vx: 0, vy: 0, type: type, vortexRad: spells.blackhole.baseRadius!, life: 240, age: 0, charging: true, hostile: false };
      projectiles.push(p);
      input.activeChargingBlackHole = p;
    } else if (type === 'lightning') {
      const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
      this.ctx.lightning.cast(startX, startY - 1, Math.atan2(targetY - startY, targetX - startX));
    } else if (type === 'flame') {
      this.emitBuildFlame();
    } else if (type === 'dig') {
      // handled continuously by the held-tool loop
    } else {
      const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
      const angle = Math.atan2(targetY - startY, targetX - startX);
      const force = (type === 'bolt') ? spells.bolt.velocityForce!
        : (type === 'warp') ? spells.warp.velocityForce! : spells.bomb.velocityForce!;
      projectiles.push({ x: startX, y: startY, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force, type: type, life: type === 'bomb' ? Math.floor(spells.bomb.fuseTicks!) : 180, age: 0, charging: false, hostile: false });
      if (type === 'bolt') this.ctx.audio.zap();
    }
  }
}
