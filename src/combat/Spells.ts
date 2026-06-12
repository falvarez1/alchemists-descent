import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { Cell, isGas, isLiquid } from '@/sim/CellType';
import {
  EMPTY_COLOR,
  acidColor,
  emberColor,
  fireColor,
  packRGB,
  smokeColor,
  stoneColor,
} from '@/sim/colors';
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

  private conjureStone(tx: number, ty: number, originX: number, originY: number): void {
    const sp = this.ctx.params.spells.conjure;
    const dx = tx - originX,
      dy = ty - originY;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > sp.range!) {
      tx = originX + (dx / dist) * sp.range!;
      ty = originY + (dy / dist) * sp.range!;
    }
    const cx = Math.floor(tx),
      cy = Math.floor(ty),
      radius = sp.radius!;
    const { world } = this.ctx;
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        const X = cx + ox,
          Y = cy + oy;
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        const t = world.types[i];
        if (t === Cell.Empty || isLiquid(t) || isGas(t)) {
          world.types[i] = Cell.Stone;
          world.colors[i] = stoneColor();
          world.life[i] = 0;
          world.charge[i] = 0;
        }
      }
    }
    this.ctx.particles.burst(cx, cy - 4, 8, null, stoneColor, 1.2, { grav: 0.08 });
    this.ctx.audio.dig();
  }

  private castScatter(x: number, y: number, angle: number, mul = 1): void {
    const sp = this.ctx.params.spells.scatter;
    for (let i = 0; i < sp.pellets!; i++) {
      const sa = angle + (Math.random() - 0.5) * sp.spread!;
      const sv = sp.velocityForce! * (0.85 + Math.random() * 0.3);
      this.ctx.projectiles.push({
        x,
        y,
        vx: Math.cos(sa) * sv,
        vy: Math.sin(sa) * sv,
        type: 'pellet',
        life: 70,
        age: 0,
        charging: false,
        hostile: false,
        mul,
      });
    }
    this.ctx.audio.zap();
    this.ctx.audio.noiseBurst(0.06, 800, 0.05);
  }

  private castVitriolSpray(x: number, y: number, angle: number, carryVx = 0): void {
    const sp = this.ctx.params.spells.vitriol;
    this.ctx.audio.flame();
    for (let j = 0; j < 3; j++) {
      const spreadA = angle + (Math.random() - 0.5) * sp.spread!;
      const speed = 3.0 + Math.random() * 2.0;
      this.ctx.particles.spawn(
        x,
        y,
        Math.cos(spreadA) * speed + carryVx,
        Math.sin(spreadA) * speed,
        Cell.Acid,
        acidColor(),
        30 + Math.floor(Math.random() * 16),
        { grav: 0.06, glow: 1.4 },
      );
    }
  }

  private castEmberStorm(x: number, y: number, angle: number): void {
    const sp = this.ctx.params.spells.emberstorm;
    this.ctx.audio.flame();
    for (let j = 0; j < sp.count!; j++) {
      const ea = angle + (Math.random() - 0.5) * 0.55;
      const speed = 2.6 + Math.random() * 2.2;
      this.ctx.particles.spawn(
        x,
        y,
        Math.cos(ea) * speed,
        Math.sin(ea) * speed - 0.8,
        Cell.Ember,
        emberColor(),
        200 + Math.floor(Math.random() * 120),
        { grav: 0.05, glow: 2.0 },
      );
    }
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
    } else if (player.spell === 'scatter') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      this.castScatter(tip.x, tip.y, a);
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
    } else if (player.spell === 'vitriol') {
      player.mana -= sp.manaCost;
      this.castVitriolSpray(tip.x, tip.y, a, player.vx * 0.4);
    } else if (player.spell === 'emberstorm') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      this.castEmberStorm(tip.x, tip.y, a);
    } else if (player.spell === 'frostshard') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      projectiles.push({ x: tip.x, y: tip.y, vx: Math.cos(a) * sp.velocityForce!, vy: Math.sin(a) * sp.velocityForce!, type: 'iceshard', life: 140, age: 0, charging: false, hostile: false });
      this.ctx.audio.zap();
    } else if (player.spell === 'icelance') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      projectiles.push({ x: tip.x, y: tip.y, vx: Math.cos(a) * sp.velocityForce!, vy: Math.sin(a) * sp.velocityForce!, type: 'icelance', life: 90, age: 0, charging: false, hostile: false });
      this.ctx.audio.tone(1400, 220, 0.16, 'sine', 0.10);
    } else if (player.spell === 'wisp') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      projectiles.push({ x: tip.x, y: tip.y, vx: Math.cos(a) * sp.velocityForce!, vy: Math.sin(a) * sp.velocityForce!, type: 'wisp', life: 260, age: 0, charging: false, hostile: false });
      this.ctx.audio.zap();
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
    } else if (player.spell === 'conjure') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      this.conjureStone(input.mouse.x, input.mouse.y, player.x, player.y - 9);
    } else if (player.spell === 'meteor') {
      player.mana -= sp.manaCost; player.cooldown = sp.cooldown;
      projectiles.push({ x: tip.x, y: tip.y, vx: Math.cos(a) * sp.velocityForce!, vy: Math.sin(a) * sp.velocityForce! - 1.0, type: 'meteor', life: 300, age: 0, charging: false, hostile: false });
      this.ctx.audio.boom(8);
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
    } else if (type === 'vitriol') {
      const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
      this.castVitriolSpray(startX, startY, Math.atan2(targetY - startY, targetX - startX));
    } else if (type === 'conjure') {
      const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
      this.conjureStone(targetX, targetY, startX, startY);
    } else if (type === 'emberstorm') {
      const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
      this.castEmberStorm(startX, startY, Math.atan2(targetY - startY, targetX - startX));
    } else if (type === 'icelance') {
      const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
      const angle = Math.atan2(targetY - startY, targetX - startX);
      projectiles.push({ x: startX, y: startY, vx: Math.cos(angle) * spells.icelance.velocityForce!, vy: Math.sin(angle) * spells.icelance.velocityForce!, type: 'icelance', life: 90, age: 0, charging: false, hostile: false });
      this.ctx.audio.tone(1400, 220, 0.16, 'sine', 0.10);
    } else if (type === 'scatter') {
      const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
      this.castScatter(startX, startY, Math.atan2(targetY - startY, targetX - startX));
    } else if (type === 'dig') {
      // handled continuously by the held-tool loop
    } else {
      const startX = camera.renderX + Math.floor(VIEW_W / 2), startY = camera.renderY + VIEW_H - 14;
      const angle = Math.atan2(targetY - startY, targetX - startX);
      const projectileType = type === 'frostshard' ? 'iceshard' : type;
      const force =
        type === 'bolt' ? spells.bolt.velocityForce!
        : type === 'warp' ? spells.warp.velocityForce!
        : type === 'frostshard' ? spells.frostshard.velocityForce!
        : type === 'wisp' ? spells.wisp.velocityForce!
        : type === 'meteor' ? spells.meteor.velocityForce!
        : spells.bomb.velocityForce!;
      const life =
        type === 'bomb' ? Math.floor(spells.bomb.fuseTicks!)
        : type === 'wisp' ? 260
        : type === 'meteor' ? 300
        : type === 'frostshard' ? 140
        : 180;
      projectiles.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * force,
        vy: Math.sin(angle) * force - (type === 'meteor' ? 1.0 : 0),
        type: projectileType,
        life,
        age: 0,
        charging: false,
        hostile: false,
      });
      if (type === 'bolt' || type === 'frostshard' || type === 'wisp') this.ctx.audio.zap();
      if (type === 'meteor') this.ctx.audio.boom(8);
    }
  }
}
