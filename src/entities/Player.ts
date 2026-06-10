// ===================== Player (the Alchemist) =====================
// Ported from noita-sandbox.html lines 1475-1484 (player initializer) and
// 1565-1760 (damagePlayer / killPlayer / findSpawnPoint / respawnPlayer /
// updatePlayer / updatePlayerAnimation).
// DOM writes (game-over overlay) become 'playerDied' / 'playerRespawned' events.

import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, PlayerControlApi, PlayerState, Projectile } from '@/core/types';
import { Cell, isLiquid } from '@/sim/CellType';
import { bloodColor, EMPTY_COLOR, packRGB, smokeColor } from '@/sim/colors';

/**
 * The player initializer (original lines 1475-1484). `_px/_py/_svx/_svy` are
 * required by the contract, so they start at 0 instead of `undefined`; the
 * original's first-animation-frame `=== undefined` guard is reproduced by a
 * private flag on PlayerControl.
 */
export function createPlayer(): PlayerState {
  return {
    x: Math.floor(WIDTH / 2),
    y: HEIGHT - 20,
    fx: 0,
    fy: 0,
    vx: 0,
    vy: 0,
    hp: 100,
    maxHp: 100,
    mana: 100,
    maxMana: 100,
    levit: 100,
    maxLevit: 100,
    facing: 1,
    aimAngle: 0,
    grounded: false,
    inLiquid: false,
    dead: false,
    invuln: 0,
    spell: 'bolt',
    cooldown: 0,
    firing: false,
    // animation state
    stridePhase: 0,
    landTimer: 0,
    blinkTimer: 0,
    prevGrounded: false,
    fallPeak: 0,
    hat: { ox: 0, oy: 0, vx: 0, vy: 0, pvx: 0, pvy: 0 },
    _px: 0,
    _py: 0,
    _svx: 0,
    _svy: 0,
  };
}

export class PlayerControl implements PlayerControlApi {
  /**
   * False until the first animation pass has run. Replaces the original's
   * `player._px === undefined` first-frame guard (the contract types the
   * trackers as required numbers).
   */
  private animStarted = false;

  constructor(private ctx: Ctx) {}

  /** Original: damagePlayer(amount, kx, ky) — lines 1565-1575. */
  damage(amount: number, kx: number, ky: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    if (player.dead || player.invuln > 0) return;
    player.hp -= amount;
    player.vx += kx || 0;
    player.vy += ky || 0;
    player.invuln = 30;
    ctx.audio.hurt();
    ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.018, 0.05);
    // Blood spray — the Noita way
    ctx.particles.burst(player.x, player.y - 7, Math.min(16, 5 + amount * 0.4), Cell.Blood, bloodColor, 2.4);
    if (player.hp <= 0) this.kill();
  }

  /** Original: killPlayer() — lines 1577-1587. */
  kill(): void {
    const ctx = this.ctx;
    const player = ctx.player;
    if (player.dead) return;
    player.dead = true;
    player.hp = 0;
    ctx.particles.burst(player.x, player.y - 7, 56, Cell.Blood, bloodColor, 4.2);
    ctx.particles.burst(player.x, player.y - 7, 10, null, () => packRGB(168, 85, 247), 3.4, {
      glow: 2.4,
      grav: 0.04,
    });
    ctx.audio.squelch();
    ctx.audio.boom(10);
    ctx.fx.screenShake = 0.05;
    ctx.events.emit('playerDied', { wave: ctx.waves.num, gold: ctx.state.score });
  }

  /** Original: findSpawnPoint() — lines 1589-1606. */
  findSpawnPoint(): { x: number; y: number } {
    const ctx = this.ctx;
    // The cave generator carves a chamber on the main artery — always connected, so try it first
    const caveSpawnHint = ctx.worldgen.spawnHint;
    if (caveSpawnHint) {
      for (const dx of [0, -8, 8, -16, 16]) {
        const cx = caveSpawnHint.x + dx;
        for (let y = caveSpawnHint.y; y < Math.min(HEIGHT - 4, caveSpawnHint.y + 38); y++) {
          if (ctx.physics.entityFree(cx, y, 4, 17) && !ctx.physics.entityFree(cx, y + 1, 4, 1)) {
            return { x: cx, y };
          }
        }
      }
    }
    const candidates = [
      Math.floor(WIDTH / 2),
      Math.floor(WIDTH * 0.3),
      Math.floor(WIDTH * 0.7),
      Math.floor(WIDTH * 0.5) + 20,
    ];
    for (const cx of candidates) {
      for (let y = 18; y < HEIGHT - 4; y++) {
        if (ctx.physics.entityFree(cx, y, 4, 17) && !ctx.physics.entityFree(cx, y + 1, 4, 1)) {
          return { x: cx, y };
        }
      }
    }
    return { x: Math.floor(WIDTH / 2), y: 20 };
  }

  /** Original: respawnPlayer() — lines 1608-1619. */
  respawn(): void {
    const ctx = this.ctx;
    const player = ctx.player;
    const sp = this.findSpawnPoint();
    player.x = sp.x;
    player.y = sp.y;
    player.vx = 0;
    player.vy = 0;
    player.fx = 0;
    player.fy = 0;
    player.hp = player.maxHp;
    player.mana = player.maxMana;
    player.levit = player.maxLevit;
    player.dead = false;
    player.invuln = 90;
    ctx.events.emit('playerRespawned');
    // Clear hostile projectiles, restart current wave
    const kept: Projectile[] = ctx.projectiles.filter((p) => !p.hostile);
    ctx.projectiles.length = 0;
    ctx.projectiles.push(...kept);
    ctx.enemies.length = 0;
    ctx.waves.active = false;
    ctx.waves.intermission = 90;
    ctx.particles.burst(sp.x, sp.y - 7, 20, null, () => packRGB(200, 160, 255), 2.7, {
      glow: 2.2,
      grav: -0.01,
    });
  }

  /** Original: updatePlayer() — lines 1621-1721. */
  update(ctx: Ctx): void {
    const player = ctx.player;
    const keys = ctx.input.keys;
    const world = ctx.world;
    if (ctx.state.mode !== 'play' || player.dead) return;
    if (player.invuln > 0) player.invuln--;

    const accel = 0.5,
      maxRun = 2.6;
    if (keys.left) {
      player.vx -= accel;
      player.facing = -1;
    }
    if (keys.right) {
      player.vx += accel;
      player.facing = 1;
    }
    if (!keys.left && !keys.right) player.vx *= 0.72;
    player.vx = clamp(player.vx, -maxRun, maxRun);

    // Sample body cells for liquid and hazards
    let liquidCount = 0,
      hazardDmg = 0;
    for (let dy = 0; dy < 17; dy += 2) {
      for (let dx = -4; dx <= 4; dx += 2) {
        const X = player.x + dx,
          Y = player.y - dy;
        if (!world.inBounds(X, Y)) continue;
        const c = world.types[world.idx(X, Y)];
        if (isLiquid(c)) liquidCount++;
        if (c === Cell.Fire) hazardDmg += 0.22;
        if (c === Cell.Lava) hazardDmg += 0.62;
        if (c === Cell.Acid) hazardDmg += 0.32;
      }
    }
    player.inLiquid = liquidCount >= 13;
    if (hazardDmg > 0) {
      player.hp -= hazardDmg;
      if (ctx.state.frameCount % 14 === 0) {
        ctx.audio.hurt();
        ctx.particles.burst(player.x, player.y - 7, 4, Cell.Smoke, smokeColor, 1.1);
      }
      if (player.hp <= 0) {
        this.kill();
        return;
      }
    }

    // Gravity / levitation
    const grav = player.inLiquid ? 0.12 : 0.28;
    player.vy += grav;
    if (player.inLiquid) player.vy *= 0.88;

    if (keys.jump) {
      if (player.grounded || player.inLiquid) {
        player.vy = -3.7;
        player.grounded = false;
        ctx.audio.jump();
      } else if (player.levit > 0) {
        player.vy -= 0.62;
        player.levit -= 1.15;
        ctx.audio.levitate();
        if (ctx.state.frameCount % 3 === 0) {
          ctx.particles.spawn(
            player.x + (Math.random() - 0.5) * 2,
            player.y + 0.5,
            (Math.random() - 0.5) * 0.4,
            0.7 + Math.random() * 0.5,
            null,
            packRGB(255, 150 + Math.floor(Math.random() * 80), 30),
            14,
            { grav: 0.02, glow: 2.2 },
          );
        }
      }
    }
    if (player.grounded || player.inLiquid) player.levit = Math.min(player.maxLevit, player.levit + 1.7);
    player.vy = clamp(player.vy, -4.6, 5.0);

    // Mana regen
    player.mana = Math.min(player.maxMana, player.mana + 0.45);
    if (player.cooldown > 0) player.cooldown--;

    // Move horizontally (sub-cell accumulator, with 2-cell step-up)
    player.fx += player.vx;
    while (player.fx >= 1) {
      if (!ctx.physics.tryMoveEntity(player, 1, 0, 4, 17, 5)) {
        player.vx = 0;
        player.fx = 0;
        break;
      }
      player.fx -= 1;
    }
    while (player.fx <= -1) {
      if (!ctx.physics.tryMoveEntity(player, -1, 0, 4, 17, 5)) {
        player.vx = 0;
        player.fx = 0;
        break;
      }
      player.fx += 1;
    }

    // Move vertically
    player.fy += player.vy;
    while (player.fy >= 1) {
      if (!ctx.physics.tryMoveEntity(player, 0, 1, 4, 17, 0)) {
        player.vy = 0;
        player.fy = 0;
        break;
      }
      player.fy -= 1;
    }
    while (player.fy <= -1) {
      if (!ctx.physics.tryMoveEntity(player, 0, -1, 4, 17, 0)) {
        player.vy = 0;
        player.fy = 0;
        break;
      }
      player.fy += 1;
    }
    player.grounded = !ctx.physics.entityFree(player.x, player.y + 1, 4, 1);

    // Aim and continuous fire
    player.aimAngle = Math.atan2(ctx.input.mouse.y - (player.y - 9), ctx.input.mouse.x - player.x);
    if (Math.cos(player.aimAngle) !== 0) player.facing = Math.cos(player.aimAngle) >= 0 ? 1 : -1;
    // Absorb glowing goo: slime residue heals on contact
    if (player.hp < player.maxHp) {
      let absorbed = 0;
      outerGoo: for (let dy = 0; dy < 17; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const gx = Math.floor(player.x) + dx,
            gy = Math.floor(player.y) - dy;
          if (!world.inBounds(gx, gy) || world.types[world.idx(gx, gy)] !== Cell.Slime) continue;
          const gi = world.idx(gx, gy);
          world.types[gi] = Cell.Empty;
          world.colors[gi] = EMPTY_COLOR;
          player.hp = Math.min(player.maxHp, player.hp + 0.9);
          // green motes drift up into the wizard
          ctx.particles.spawn(gx, gy, (player.x - gx) * 0.08, -0.5 - Math.random() * 0.5, null, packRGB(110, 255, 150), 18, {
            grav: -0.015,
            glow: 2.2,
          });
          if (++absorbed >= 3) break outerGoo;
        }
      }
      if (absorbed > 0 && ctx.state.frameCount % 9 === 0) ctx.audio.tone(620 + player.hp * 3, 70, 0.08, 'sine', 0.05);
    }

    if (player.firing) ctx.spells.firePlayerSpell();
    this.updatePlayerAnimation(ctx);
  }

  /** Original: updatePlayerAnimation() — lines 1723-1760. */
  private updatePlayerAnimation(ctx: Ctx): void {
    const player = ctx.player;
    // Animation runs off REAL displacement, not intended velocity — so grinding
    // against a wall doesn't cycle the legs or rattle the hat
    const cx2 = player.x + player.fx,
      cy2 = player.y + player.fy;
    if (!this.animStarted) {
      // first frame: no prior sample yet (original `_px === undefined` guard)
      player._px = cx2;
      player._py = cy2;
      this.animStarted = true;
    }
    const rvx = cx2 - player._px;
    const rvy = cy2 - player._py;
    player._px = cx2;
    player._py = cy2;
    player._svx = player._svx * 0.55 + rvx * 0.45;
    player._svy = player._svy * 0.55 + rvy * 0.45;

    // Stride wheel turns with actual ground speed; drifts slowly in the air
    if (player.grounded && Math.abs(player._svx) > 0.2) player.stridePhase += Math.abs(player._svx) * 0.16;
    else if (!player.grounded) player.stridePhase += 0.05;

    // Landing squash: triggered by how hard we hit the ground
    if (player.grounded && !player.prevGrounded && player.fallPeak > 2.2) {
      player.landTimer = Math.min(10, 4 + Math.floor(player.fallPeak * 1.4));
    }
    player.fallPeak = player.grounded ? 0 : Math.max(player.fallPeak, player.vy);
    if (player.landTimer > 0) player.landTimer--;
    player.prevGrounded = player.grounded;

    // Occasional blink
    if (player.blinkTimer > 0) player.blinkTimer--;
    else if (Math.random() < 0.007) player.blinkTimer = 6;

    // Hat: damped spring driven by the wizard's acceleration — it lags,
    // overshoots, and flops exactly opposite to each change of motion
    const h = player.hat;
    const ax = player._svx - h.pvx,
      ay = player._svy - h.pvy;
    h.vx += -h.ox * 0.16 - ax * 2.4;
    h.vy += -h.oy * 0.2 - ay * 1.9;
    if (!player.grounded) h.vy -= player._svy * 0.035; // airflow lifts the tip while falling
    h.vx *= 0.8;
    h.vy *= 0.76;
    h.ox = clamp(h.ox + h.vx, -5, 5);
    h.oy = clamp(h.oy + h.vy, -4, 4);
    h.pvx = player._svx;
    h.pvy = player._svy;
  }
}
