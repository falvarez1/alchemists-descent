import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, Enemy, EnemyControlApi, EnemyDef, EnemyKind } from '@/core/types';
import { createDefaultStatus, sampleAndTickStatus } from '@/entities/status';
import { makePickup, POTION_KINDS } from '@/game/Pickups';
import { Cell } from '@/sim/CellType';
import {
  acidColor,
  bloodColor,
  EMPTY_COLOR,
  fireColor,
  goldColor,
  iceColor,
  nitrogenColor,
  packRGB,
  slimeColor,
  smokeColor,
  stoneColor,
  toxicColor,
} from '@/sim/colors';
import { splatterStain } from '@/sim/stains';

// ===================== Enemies =====================
const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  slime: { hp: 48, halfW: 5, h: 8, bounty: 30, gore: Cell.Slime, goreFn: slimeColor },
  imp: { hp: 40, halfW: 5, h: 12, bounty: 50, gore: Cell.Fire, goreFn: fireColor },
  golem: { hp: 170, halfW: 7, h: 20, bounty: 150, gore: Cell.Stone, goreFn: stoneColor },
  acidslime: { hp: 40, halfW: 5, h: 8, bounty: 45, gore: Cell.Acid, goreFn: acidColor },
  wisp: { hp: 22, halfW: 4, h: 8, bounty: 60, gore: Cell.Nitrogen, goreFn: nitrogenColor },
  mage: { hp: 60, halfW: 5, h: 14, bounty: 120, gore: Cell.Blood, goreFn: bloodColor },
  // Upgrade port (noita-alchemists-descent.html)
  bat: { hp: 16, halfW: 3, h: 5, bounty: 15, gore: Cell.Blood, goreFn: bloodColor },
  spitter: { hp: 55, halfW: 5, h: 11, bounty: 60, gore: Cell.Toxic, goreFn: toxicColor },
  bomber: { hp: 34, halfW: 5, h: 8, bounty: 45, gore: Cell.Fire, goreFn: fireColor },
};

/** Cells a kind shrugs off when statuses are sampled: imps bathe in fire, wisps in cold. */
const STATUS_IMMUNE: Partial<
  Record<EnemyKind, Partial<Record<'burning' | 'frozen' | 'electrified' | 'wet' | 'oiled', boolean>>>
> = {
  imp: { burning: true },
  wisp: { frozen: true },
};

export class Enemies implements EnemyControlApi {
  readonly defs: Record<EnemyKind, EnemyDef> = ENEMY_DEFS;

  constructor(private ctx: Ctx) {}

  spawn(kind: EnemyKind, x: number, y: number): void {
    const ctx = this.ctx;
    const def = this.defs[kind];
    // Find an open pocket: scan downward from the requested point, retrying nearby columns
    let sx = Math.floor(clamp(x, def.halfW + 2, WIDTH - def.halfW - 3));
    let sy = -1;
    for (let attempt = 0; attempt < 10 && sy < 0; attempt++) {
      const tx =
        attempt === 0
          ? sx
          : Math.floor(clamp(sx + (Math.random() - 0.5) * 240, def.halfW + 2, WIDTH - def.halfW - 3));
      for (let yy = Math.max(def.h, Math.floor(y)); yy < HEIGHT - 2; yy++) {
        if (ctx.physics.entityFree(tx, yy, def.halfW, def.h)) {
          sx = tx;
          sy = yy;
          break;
        }
      }
    }
    if (sy < 0) sy = Math.max(def.h, Math.floor(y)); // last resort
    // Depth scaling: tougher and harder-hitting the deeper you descend
    const depth = ctx.state.mode === 'play' ? (ctx.levels.current?.def.depth ?? 1) : 1;
    const hpMul = 1 + (depth - 1) * 0.16;
    const dmgK = 1 + (depth - 1) * 0.1;
    ctx.enemies.push({
      kind,
      x: sx,
      y: sy,
      fx: 0,
      fy: 0,
      vx: 0,
      vy: 0,
      hp: Math.round(def.hp * hpMul),
      maxHp: Math.round(def.hp * hpMul),
      dmgK,
      flash: 0,
      timer: Math.floor(Math.random() * 80),
      attackCd: 60,
      bobPhase: Math.random() * Math.PI * 2,
      grounded: false,
      stride: 0,
      splat: 0,
      prevG: false,
      blink: 0,
      jetFuel: 0,
      jetCd: 0,
      stuckT: 0,
      status: createDefaultStatus(),
    });
    ctx.particles.burst(sx, sy, 6, Cell.Smoke, smokeColor, 0.9);
  }

  damage(e: Enemy, amount: number, kx: number, ky: number): void {
    const ctx = this.ctx;
    e.hp -= amount;
    e.flash = 6;
    e.vx += kx || 0;
    e.vy += ky || 0;
    const def = this.defs[e.kind];
    ctx.particles.burst(
      e.x,
      e.y - 5,
      Math.min(13, 4 + amount * 0.35),
      def.gore,
      def.goreFn,
      2.1,
      e.kind === 'imp' ? { glow: 1.8, grav: 0.06 } : undefined,
    );
    // Wounds bleed: a directional spray that pools where it lands
    if (e.kind !== 'imp') {
      if (Math.random() < 0.6) splatterStain(ctx.world, e.x - Math.sign(kx || 0) * 3, e.y - 5, 4);
      const n = Math.min(22, 5 + Math.floor(amount * 0.8));
      for (let i = 0; i < n; i++) {
        ctx.particles.spawn(
          e.x + ((Math.random() * 5) | 0) - 2,
          e.y - 5 + ((Math.random() * 5) | 0) - 2,
          (kx || 0) * 0.6 + (Math.random() - 0.5) * 2.6,
          (ky || 0) * 0.5 - 0.6 - Math.random() * 1.8,
          Cell.Blood,
          bloodColor(),
          160,
        );
      }
    } else {
      ctx.particles.burst(
        e.x,
        e.y - 5,
        Math.min(8, 2 + Math.floor(amount * 0.3)),
        Cell.Fire,
        fireColor,
        1.8,
        { glow: 2.0, grav: -0.01 },
      );
    }
    if (e.hp <= 0) this.kill(e, kx, ky);
  }

  kill(e: Enemy, kx: number, ky: number): void {
    const ctx = this.ctx;
    const def = this.defs[e.kind];
    const idx = ctx.enemies.indexOf(e);
    if (idx === -1) return;
    ctx.enemies.splice(idx, 1);
    // Bombers go out the only way they know how
    if (e.kind === 'bomber') {
      ctx.explosions.trigger(e.x, e.y - 4, 24 + Math.floor(Math.random() * 3));
      this.dropBounty(e, def);
      this.maybeDropPotion(e);
      ctx.waves.kills++;
      return;
    }
    // Gib burst + gold bounty shower
    ctx.particles.burst(
      e.x,
      e.y - 5,
      e.kind === 'golem' ? 38 : 22,
      def.gore,
      def.goreFn,
      3.6,
      e.kind === 'imp' ? { glow: 1.6, grav: 0.08 } : undefined,
    );
    if (e.kind === 'acidslime') {
      // The membrane ruptures: a shower of real acid rains back into the grid
      ctx.particles.burst(e.x, e.y - 4, 26, Cell.Acid, acidColor, 3.4);
    }
    if (e.kind === 'spitter') {
      // Toxic bulb ruptures — caustic shower instead of blood
      ctx.particles.burst(e.x, e.y - 5, 40, Cell.Toxic, toxicColor, 3.8);
    } else if (e.kind !== 'imp') {
      // Violent blood splash: fast radial spray + slow wide arc + heavy directional gouts
      ctx.particles.burst(
        e.x,
        e.y - 5,
        e.kind === 'golem' ? 62 : e.kind === 'bat' ? 24 : 46,
        Cell.Blood,
        bloodColor,
        4.8,
      );
      ctx.particles.burst(e.x, e.y - 7, e.kind === 'bat' ? 10 : 24, Cell.Blood, bloodColor, 2.2);
      for (let i = 0; i < (e.kind === 'bat' ? 7 : 16); i++) {
        ctx.particles.spawn(
          e.x,
          e.y - 5,
          (kx || 0) * 1.0 + (Math.random() - 0.5) * 6.5,
          (ky || 0) * 0.8 - 2.2 - Math.random() * 3.0,
          Cell.Blood,
          bloodColor(),
          240,
        );
      }
      // gore decal painted straight onto the nearby cave walls
      splatterStain(ctx.world, e.x, e.y - 5, e.kind === 'golem' ? 14 : e.kind === 'bat' ? 5 : 10);
    }
    this.dropBounty(e, def);
    this.maybeDropPotion(e);
    ctx.audio.squelch();
    ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.012, 0.04);
    ctx.waves.kills++;
  }

  /** Felled foes sometimes drop a potion (golems are walking apothecaries). */
  private maybeDropPotion(e: Enemy): void {
    const ctx = this.ctx;
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play') return;
    if (Math.random() < (e.kind === 'golem' ? 0.3 : 0.12)) {
      runtime.pickups.push(
        makePickup('potion', e.x, e.y - 5, {
          potion: POTION_KINDS[Math.floor(Math.random() * POTION_KINDS.length)],
        }),
      );
    }
  }

  /** Gold coin shower (homing in play mode) + build-mode direct score credit. */
  private dropBounty(e: Enemy, def: EnemyDef): void {
    const ctx = this.ctx;
    const coins = Math.floor(def.bounty / 10);
    for (let i = 0; i < coins; i++) {
      ctx.particles.spawn(
        e.x,
        e.y - 5,
        (Math.random() - 0.5) * 4.2,
        -2.2 - Math.random() * 2.4,
        null,
        goldColor(),
        300,
        {
          homing: ctx.state.mode === 'play',
          glow: 2.0,
          grav: ctx.state.mode === 'play' ? 0 : 0.14,
        },
      );
    }
    if (ctx.state.mode !== 'play') {
      ctx.state.score += def.bounty;
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
    }
  }

  /**
   * Powder Mage telekinesis: tear up to 14 powder cells (Sand/Gold/Gunpowder,
   * nearest-first within 40 cells) OUT of the grid and hurl them at the player
   * as hostile debris. The level itself is the ammunition — whatever misses
   * re-deposits as real cells where it lands.
   */
  private telekinesisVolley(e: Enemy): void {
    const ctx = this.ctx;
    const world = ctx.world;
    const player = ctx.player;
    const ex = Math.floor(e.x),
      ey = Math.floor(e.y) - 7;
    const found: Array<{ x: number; y: number; d2: number }> = [];
    for (let dy = -40; dy <= 40; dy++) {
      for (let dx = -40; dx <= 40; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 1600) continue;
        const nx = ex + dx,
          ny = ey + dy;
        if (!world.inBounds(nx, ny)) continue;
        const t = world.types[world.idx(nx, ny)];
        if (t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder) {
          found.push({ x: nx, y: ny, d2 });
        }
      }
    }
    found.sort((a, b) => a.d2 - b.d2);
    const n = Math.min(14, found.length);
    for (let k = 0; k < n; k++) {
      const c = found[k];
      const ci = world.idx(c.x, c.y);
      const t = world.types[ci];
      const color = world.colors[ci];
      world.types[ci] = Cell.Empty;
      world.colors[ci] = EMPTY_COLOR;
      const aim = Math.atan2(player.y - 9 - c.y, player.x - c.x) + (Math.random() - 0.5) * 0.24;
      const spd = 3.6 + Math.random() * 0.8;
      ctx.particles.spawn(c.x, c.y, Math.cos(aim) * spd, Math.sin(aim) * spd, t, color, 170, {
        hostileDmg: 6,
        glow: 0.6,
        grav: 0.015,
      });
    }
    if (n > 0) {
      ctx.audio.tone(240, 70, 0.3, 'sawtooth', 0.12);
      ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.006, 0.04);
    }
  }

  private enemyEnvironmentDamage(e: Enemy): void {
    const ctx = this.ctx;
    const def = this.defs[e.kind];
    let dmg = 0;
    for (let dy = 0; dy < def.h; dy += 2) {
      const X = Math.floor(e.x),
        Y = Math.floor(e.y) - dy;
      if (!ctx.world.inBounds(X, Y)) continue;
      const c = ctx.world.types[ctx.world.idx(X, Y)];
      if ((c === Cell.Fire || c === Cell.Lava) && e.kind !== 'imp') dmg += c === Cell.Lava ? 1.6 : 0.7;
      if (c === Cell.Acid && e.kind !== 'acidslime') dmg += 0.9;
    }
    if (dmg > 0) this.damage(e, dmg, 0, 0);
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const enemies = ctx.enemies;
    const player = ctx.player;
    const targetAlive = !player.dead;

    const sim = ctx.world.simBounds;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e) continue;
      const def = this.defs[e.kind];
      // Freeze foes far outside the simulation window — they wake when you approach
      if (e.x < sim.x0 - 60 || e.x > sim.x1 + 60 || e.y < sim.y0 - 60 || e.y > sim.y1 + 60)
        continue;
      if (e.flash > 0) e.flash--;
      e.timer++;
      if (e.attackCd > 0) e.attackCd--;
      this.enemyEnvironmentDamage(e);
      if (enemies[i] !== e) continue; // died from environment

      // Sim-sampled statuses (DESIGN pillar 5/9): every 2nd frame the cells
      // touching the body ARE the status — damage lands straight on hp (no
      // flash), and a frozen body's horizontal speed is scaled once per sample.
      if (e.timer % 2 === 0) {
        const eff = sampleAndTickStatus(ctx, e, def.halfW, def.h, STATUS_IMMUNE[e.kind]);
        if (eff.damage > 0) e.hp -= eff.damage;
        if (e.hp <= 0) {
          this.kill(e, 0, 0);
          continue;
        }
        if (eff.slowFactor !== 1) e.vx *= eff.slowFactor;
      }

      const pdx = player.x - e.x,
        pdy = player.y - 9 - (e.y - 5);
      const pDist = Math.sqrt(pdx * pdx + pdy * pdy);

      if (e.kind === 'slime' || e.kind === 'acidslime') {
        e.vy += 0.3;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if (e.grounded) {
          e.vx *= 0.6;
          if (targetAlive && pDist < 260 && e.timer % 50 === 0) {
            e.vx = Math.sign(pdx) * (1.8 + Math.random() * 0.9);
            e.vy = -3.1 - Math.random() * 1.0;
          } else if (e.timer % 130 === 0) {
            e.vx = (Math.random() - 0.5) * 2.8;
            e.vy = -2.4;
          }
        }
        // Corrosive trail: an acid slime sweats one real acid cell at its feet
        if (e.kind === 'acidslime' && e.timer % 14 === 0) {
          const tx = Math.floor(e.x);
          for (let dy = 0; dy <= 1; dy++) {
            const ty = Math.floor(e.y) + dy;
            if (!ctx.world.inBounds(tx, ty)) break;
            const ti = ctx.world.idx(tx, ty);
            if (ctx.world.types[ti] === Cell.Empty) {
              ctx.world.types[ti] = Cell.Acid;
              ctx.world.colors[ti] = acidColor();
              break;
            }
          }
        }
        // Melee contact
        if (targetAlive && e.attackCd === 0 && Math.abs(pdx) < 11 && Math.abs(pdy) < 17) {
          ctx.playerCtl.damage(
            (e.kind === 'acidslime' ? 10 : 12) * (e.dmgK ?? 1),
            Math.sign(pdx) * -3.6,
            -2.8,
          );
          e.attackCd = 45;
        }
      } else if (e.kind === 'bat') {
        // Erratic flying swarmer: darts at the wizard, contact bites
        e.bobPhase += 0.22;
        if (targetAlive && pDist < 320) {
          const d = pDist || 1;
          e.vx += (pdx / d) * 0.14;
          e.vy += (pdy / d) * 0.14;
        } else {
          e.vx += (Math.random() - 0.5) * 0.1;
          e.vy += (Math.random() - 0.5) * 0.1;
        }
        e.vy += Math.sin(e.bobPhase) * 0.08;
        const batMax = 1.7;
        e.vx = clamp(e.vx, -batMax, batMax);
        e.vy = clamp(e.vy, -batMax, batMax);
        if (!ctx.physics.entityFree(e.x, e.y, def.halfW, def.h)) {
          e.y -= 1;
          e.vy = -0.6;
        }
        if (targetAlive && e.attackCd === 0 && Math.abs(pdx) < 8 && Math.abs(pdy) < 12) {
          ctx.playerCtl.damage(6 * (e.dmgK ?? 1), Math.sign(pdx) * -2.2, -1.6);
          e.attackCd = 50;
          // dart away after the bite
          e.vx = -Math.sign(pdx) * 1.6;
          e.vy = -1.0;
        }
      } else if (e.kind === 'spitter') {
        // Rooted toxic bulb: settles, then lobs caustic globs in an arc
        e.vy += 0.33;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        e.vx *= 0.4;
        if ((e.recoil ?? 0) > 0) e.recoil = (e.recoil ?? 0) - 1;
        if (targetAlive && e.attackCd === 0 && pDist < 280) {
          const arc = Math.atan2(pdy - Math.min(60, pDist * 0.35), pdx);
          const spd = 2.6 + pDist * 0.006;
          ctx.projectiles.push({
            x: e.x,
            y: e.y - def.h,
            vx: Math.cos(arc) * spd,
            vy: Math.sin(arc) * spd - 1.4,
            type: 'acidglob',
            life: 220,
            age: 0,
            charging: false,
            hostile: true,
          });
          ctx.audio.flame();
          e.recoil = 14;
          e.attackCd = 150 + Math.floor(Math.random() * 50);
        }
      } else if (e.kind === 'bomber') {
        // Fast hopping slime that fuses and detonates when close
        e.vy += 0.3;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if ((e.fusing ?? 0) > 0) {
          e.fusing = (e.fusing ?? 0) - 1;
          e.vx *= 0.5;
          if (e.fusing === 0) {
            this.kill(e, 0, 0);
            continue;
          }
        } else {
          if (e.grounded) {
            e.vx *= 0.6;
            if (targetAlive && pDist < 300 && e.timer % 32 === 0) {
              e.vx = Math.sign(pdx) * (2.4 + Math.random() * 0.8);
              e.vy = -2.8 - Math.random() * 0.8;
            } else if (e.timer % 110 === 0) {
              e.vx = (Math.random() - 0.5) * 3.0;
              e.vy = -2.2;
            }
          }
          if (targetAlive && pDist < 34) {
            e.fusing = 36; // light the fuse
            ctx.audio.tone(900, 60, 0.3, 'square', 0.1);
          }
        }
      } else if (e.kind === 'imp') {
        // Hover at a standoff distance, strafe, lob fireballs
        e.bobPhase += 0.09;
        if (targetAlive) {
          const standoff = 130;
          // (original computed an unused `desiredX` here:
          //  player.x + (pdx >= 0 ? -1 : 1) * -standoff * Math.sign(pdx || 1))
          const dirX = Math.abs(pdx) > standoff ? Math.sign(pdx) : -Math.sign(pdx);
          e.vx += dirX * 0.1;
          const desiredY = player.y - 75;
          e.vy += Math.sign(desiredY - e.y) * 0.09;
        } else {
          e.vx += (Math.random() - 0.5) * 0.05;
          e.vy += (Math.random() - 0.5) * 0.05;
        }
        e.vy += Math.sin(e.bobPhase) * 0.04;
        e.vx = clamp(e.vx, -1.3, 1.3);
        e.vy = clamp(e.vy, -1.15, 1.15);
        // Escape solids upward
        if (!ctx.physics.entityFree(e.x, e.y, def.halfW, def.h)) {
          e.y -= 1;
          e.vy = -0.5;
        }
        if (targetAlive && e.attackCd === 0 && pDist < 300) {
          const fa = Math.atan2(pdy, pdx) + (Math.random() - 0.5) * 0.16;
          ctx.projectiles.push({
            x: e.x,
            y: e.y - 5,
            vx: Math.cos(fa) * 3.6,
            vy: Math.sin(fa) * 3.6,
            type: 'fireball',
            life: 180,
            age: 0,
            charging: false,
            hostile: true,
          });
          ctx.audio.zap();
          e.attackCd = 130 + Math.floor(Math.random() * 70);
        }
      } else if (e.kind === 'wisp') {
        // Frost wisp: hovers high off the player's shoulder (no gravity at all),
        // flees when cornered, and radiates real cold into the grid beneath it
        e.bobPhase += 0.08;
        const cornered = targetAlive && pDist < 60;
        if (targetAlive) {
          const standoff = 110;
          const dirX = Math.abs(pdx) > standoff ? Math.sign(pdx) : -Math.sign(pdx);
          // retreat at 1.4x when the alchemist closes in
          e.vx += (cornered ? -Math.sign(pdx || 1) * 1.4 : dirX) * 0.1;
          const desiredY = player.y - 60;
          e.vy += Math.sign(desiredY - e.y) * 0.08;
        } else {
          e.vx += (Math.random() - 0.5) * 0.05;
          e.vy += (Math.random() - 0.5) * 0.05;
        }
        e.vy += Math.sin(e.bobPhase) * 0.03; // gentle bob
        e.vx = clamp(e.vx, cornered ? -1.54 : -1.1, cornered ? 1.54 : 1.1);
        e.vy = clamp(e.vy, -1.0, 1.0);
        // Escape solids upward
        if (!ctx.physics.entityFree(e.x, e.y, def.halfW, def.h)) {
          e.y -= 1;
          e.vy = -0.5;
        }
        if (targetAlive && e.attackCd === 0 && pDist < 320) {
          const fa = Math.atan2(pdy, pdx) + (Math.random() - 0.5) * 0.14;
          ctx.projectiles.push({
            x: e.x,
            y: e.y - 5,
            vx: Math.cos(fa) * 3.2,
            vy: Math.sin(fa) * 3.2,
            type: 'frostbolt',
            life: 200,
            age: 0,
            charging: false,
            hostile: true,
          });
          ctx.audio.tone(820, 1300, 0.12, 'sine', 0.09);
          e.attackCd = 140 + Math.floor(Math.random() * 60);
        }
        // Every 8th frame the cold soaks downward: water below locks into real
        // ice, lava occasionally skins over into stone
        if (e.timer % 8 === 0) {
          const wx = Math.floor(e.x),
            wy = Math.floor(e.y);
          let frozen = 0;
          for (let dy = 0; dy <= 6 && frozen < 10; dy++) {
            for (let dx = -6; dx <= 6 && frozen < 10; dx++) {
              if (dx * dx + dy * dy > 36) continue;
              const nx = wx + dx,
                ny = wy + dy;
              if (!ctx.world.inBounds(nx, ny)) continue;
              const ci = ctx.world.idx(nx, ny);
              const c = ctx.world.types[ci];
              if (c === Cell.Water) {
                ctx.world.types[ci] = Cell.Ice;
                ctx.world.colors[ci] = iceColor();
                frozen++;
              } else if (c === Cell.Lava && Math.random() < 0.1) {
                ctx.world.types[ci] = Cell.Stone;
                ctx.world.colors[ci] = stoneColor();
                frozen++;
              }
            }
          }
        }
      } else if (e.kind === 'mage') {
        // Powder Mage (pillar 9): a slow walker that throws the level at you.
        // e.blink doubles as the telekinesis telegraph countdown (the sprite
        // reads it to flare the hands); e.jetFuel doubles as the spent flag
        // for its one-time emergency teleport.
        e.vy += 0.3;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);

        if (e.blink > 0) {
          // Telegraph window: rooted, purple motes rise off the robe
          e.blink--;
          e.vx *= 0.7;
          if (e.timer % 2 === 0) {
            ctx.particles.spawn(
              e.x + ((Math.random() * 13) | 0) - 6,
              e.y - ((Math.random() * def.h) | 0),
              (Math.random() - 0.5) * 0.3,
              -0.5 - Math.random() * 0.7,
              null,
              packRGB(150 + ((Math.random() * 70) | 0), 60, 255),
              20,
              { grav: -0.02, glow: 1.9 },
            );
          }
          if (e.blink === 0 && targetAlive) this.telekinesisVolley(e);
        } else {
          if (targetAlive) e.vx += Math.sign(pdx) * 0.04;
          e.vx = clamp(e.vx, -0.45, 0.45);
          if (targetAlive && e.attackCd === 0 && pDist < 340) {
            e.blink = 20; // begin the 20-frame telegraph
            e.attackCd = 180 + Math.floor(Math.random() * 80);
          }
        }

        // One-time emergency blink once bloodied: 40-80 cells away, both ends
        // marked with purple bursts
        if (e.jetFuel === 0 && e.hp < e.maxHp * 0.5) {
          e.jetFuel = 1;
          const burstCol = (): number => packRGB(180 + ((Math.random() * 60) | 0), 70, 255);
          for (let attempt = 0; attempt < 20; attempt++) {
            const a = Math.random() * Math.PI * 2;
            const r = 40 + Math.random() * 40;
            const nx = Math.floor(clamp(e.x + Math.cos(a) * r, def.halfW + 2, WIDTH - def.halfW - 3));
            const ny = Math.floor(clamp(e.y + Math.sin(a) * r, def.h + 1, HEIGHT - 3));
            if (ctx.physics.entityFree(nx, ny, def.halfW, def.h)) {
              ctx.particles.burst(e.x, e.y - 7, 14, null, burstCol, 2.4, { glow: 2.2, grav: -0.01 });
              e.x = nx;
              e.y = ny;
              e.vx = 0;
              e.vy = 0;
              e.fx = 0;
              e.fy = 0;
              ctx.particles.burst(nx, ny - 7, 14, null, burstCol, 2.4, { glow: 2.2, grav: -0.01 });
              ctx.audio.zap();
              break;
            }
          }
        }
      } else if (e.kind === 'golem') {
        e.vy += 0.33;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if (targetAlive && e.timer % 3 === 0) {
          e.vx += Math.sign(pdx) * 0.12;
        }
        e.vx = clamp(e.vx, -0.78, 0.78);

        // Jet propulsion: temporary thrusters for pit recovery and reaching high ledges
        if (e.jetCd > 0) e.jetCd--;
        if (e.jetFuel > 0) {
          e.jetFuel--;
          e.vy -= 0.58;
          if (e.vy < -2.4) e.vy = -2.4;
          e.vx += Math.sign(pdx) * 0.05;
          // exhaust flame + smoke
          if (ctx.state.frameCount % 2 === 0) {
            ctx.particles.spawn(
              e.x + Math.floor(Math.random() * 5) - 2,
              e.y + 1,
              (Math.random() - 0.5) * 0.6,
              1.3 + Math.random() * 0.8,
              null,
              packRGB(255, 130 + Math.floor(Math.random() * 90), 25),
              14,
              { glow: 2.2, grav: -0.02 },
            );
          }
          if (ctx.state.frameCount % 7 === 0)
            ctx.particles.burst(e.x, e.y + 2, 1, Cell.Smoke, smokeColor, 0.5);
          // cut thrust once level with the wizard or back on solid ground
          if (targetAlive && player.y > e.y - 12) e.jetFuel = Math.min(e.jetFuel, 6);
          if (e.grounded && e.vy >= 0) e.jetFuel = 0;
        } else if (e.jetCd === 0 && targetAlive) {
          const needLift = player.y < e.y - 28 && Math.abs(pdx) < 230; // wizard is up on a ledge
          const fallingHard = !e.grounded && e.vy > 2.3; // tumbling into a pit
          if (needLift || fallingHard) {
            e.jetFuel = 95 + Math.floor(Math.random() * 50);
            e.jetCd = 280;
            ctx.audio.tone(110 + Math.random() * 30, 260, 0.35, 'sawtooth', 0.11);
          }
        }

        // Pathing: vault low ledges; if a wall keeps it from the wizard, pound through
        if (targetAlive && e.grounded && Math.abs(pdx) > 12) {
          const dir = Math.sign(pdx) || 1;
          const ahead = !ctx.physics.entityFree(e.x + dir * (def.halfW + 2), e.y, def.halfW, def.h);
          if (ahead) {
            let clearH = -1;
            for (let hh = 3; hh <= 12; hh++) {
              if (ctx.physics.entityFree(e.x + dir * (def.halfW + 3), e.y - hh, def.halfW, def.h)) {
                clearH = hh;
                break;
              }
            }
            if (clearH > 0) {
              // vault the ledge
              e.vy = -2.0 - clearH * 0.17;
              e.vx = dir * 0.95;
              e.stuckT = 0;
            } else if (e.jetCd === 0) {
              // too tall to vault — fire the thrusters and go over
              e.jetFuel = 115;
              e.jetCd = 280;
              e.stuckT = 0;
              ctx.audio.tone(110 + Math.random() * 30, 260, 0.35, 'sawtooth', 0.11);
            } else {
              e.stuckT = (e.stuckT || 0) + 1;
              if (e.stuckT > 50) {
                // stone fists vs stone wall: the wall loses
                const fx2 = Math.floor(e.x + dir * (def.halfW + 3));
                const fy2 = Math.floor(e.y - 8);
                ctx.spells.erodeAt(fx2, fy2, 6);
                ctx.particles.burst(fx2, fy2, 9, Cell.Sand, stoneColor, 1.9);
                ctx.audio.tone(60 + Math.random() * 25, 90, 0.2, 'square', 0.16);
                ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.008, 0.05);
                e.stuckT = 26; // keep a pounding rhythm until it breaks through
              }
            }
          } else {
            e.stuckT = 0;
          }
        }
        // Smash through powders in path
        const aheadX = e.x + Math.sign(e.vx) * (def.halfW + 1);
        for (let dy = 0; dy < def.h; dy++) {
          if (ctx.world.inBounds(aheadX, e.y - dy)) {
            const ci = ctx.world.idx(aheadX, e.y - dy);
            const c = ctx.world.types[ci];
            if (c === Cell.Sand || c === Cell.Gold || c === Cell.Gunpowder) {
              ctx.particles.spawn(
                aheadX,
                e.y - dy,
                Math.sign(e.vx) * 1.2 + (Math.random() - 0.5),
                -0.8 - Math.random(),
                c,
                ctx.world.colors[ci],
                80,
              );
              ctx.world.types[ci] = Cell.Empty;
              ctx.world.colors[ci] = EMPTY_COLOR;
            }
          }
        }
        // Rock throw
        if (targetAlive && e.attackCd === 0 && pDist > 50 && pDist < 360) {
          for (let r = 0; r < 3; r++) {
            const ta = Math.atan2(pdy - 38 - r * 7, pdx);
            const spd = 4.0 + Math.random() * 1.2;
            ctx.particles.spawn(
              e.x,
              e.y - def.h,
              Math.cos(ta) * spd,
              Math.sin(ta) * spd - 0.6,
              Cell.Stone,
              stoneColor(),
              200,
              { hostileDmg: 9 },
            );
          }
          ctx.audio.boom(4);
          e.attackCd = 240;
        }
        if (targetAlive && e.attackCd < 200 && Math.abs(pdx) < 15 && Math.abs(pdy) < 22) {
          ctx.playerCtl.damage(20, Math.sign(pdx) * -5.0, -3.6);
          e.attackCd = 220;
        }
      }

      // Integrate movement (slimes/golems/mages collide; imps/wisps/bats drift)
      if (e.kind === 'imp' || e.kind === 'wisp' || e.kind === 'bat') {
        // Drift via sub-cell accumulators so e.x / e.y stay integers (grid indices)
        e.fx += e.vx;
        e.fy += e.vy;
        const sx = Math.trunc(e.fx),
          sy = Math.trunc(e.fy);
        if (sx !== 0) {
          e.x = Math.floor(clamp(e.x + sx, 6, WIDTH - 7));
          e.fx -= sx;
        }
        if (sy !== 0) {
          e.y = Math.floor(clamp(e.y + sy, 14, HEIGHT - 7));
          e.fy -= sy;
        }
      } else {
        e.fx += e.vx;
        while (e.fx >= 1) {
          if (!ctx.physics.tryMoveEntity(e, 1, 0, def.halfW, def.h, e.kind === 'golem' ? 2 : 1)) {
            e.vx = 0;
            e.fx = 0;
            break;
          }
          e.fx -= 1;
        }
        while (e.fx <= -1) {
          if (!ctx.physics.tryMoveEntity(e, -1, 0, def.halfW, def.h, e.kind === 'golem' ? 2 : 1)) {
            e.vx = 0;
            e.fx = 0;
            break;
          }
          e.fx += 1;
        }
        e.fy += e.vy;
        while (e.fy >= 1) {
          if (!ctx.physics.tryMoveEntity(e, 0, 1, def.halfW, def.h, 0)) {
            e.vy = 0;
            e.fy = 0;
            break;
          }
          e.fy -= 1;
        }
        while (e.fy <= -1) {
          if (!ctx.physics.tryMoveEntity(e, 0, -1, def.halfW, def.h, 0)) {
            e.vy = 0;
            e.fy = 0;
            break;
          }
          e.fy += 1;
        }
        if (e.y > HEIGHT - 2) {
          e.y = HEIGHT - 2;
          e.vy = 0;
        }
      }
    }
  }
}
