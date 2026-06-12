// ===================== Player (the Alchemist) =====================
// Ported from noita-sandbox.html lines 1475-1484 (player initializer) and
// 1565-1760 (damagePlayer / killPlayer / findSpawnPoint / respawnPlayer /
// updatePlayer / updatePlayerAnimation).
// DOM writes (game-over overlay) become 'playerDied' / 'playerRespawned' events.

import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, PerkId, PlayerControlApi, PlayerState, Projectile } from '@/core/types';
import { createDefaultStatus, sampleAndTickStatus } from '@/entities/status';
import { makePickup } from '@/game/Pickups';
import { Cell, isLiquid } from '@/sim/CellType';
import { bloodColor, EMPTY_COLOR, packRGB, smokeColor } from '@/sim/colors';

const REVIEW_STATUS_FRAMES = 3600;
const REVIEW_PERKS: PerkId[] = [
  'might',
  'vampirism',
  'featherweight',
  'manafont',
  'swiftfoot',
  'torchbearer',
  'ironhide',
  'flameward',
  'toxinward',
  'goldmagnet',
];

export function grantFullReviewKit(player: PlayerState): void {
  player.maxHp = Math.max(player.maxHp, 180);
  player.hp = player.maxHp;
  player.maxMana = Math.max(player.maxMana, 220);
  player.mana = player.maxMana;
  player.maxLevit = Math.max(player.maxLevit, 140);
  player.levit = player.maxLevit;
  player.status.regen = Math.max(player.status.regen, REVIEW_STATUS_FRAMES);
  player.status.levity = Math.max(player.status.levity, REVIEW_STATUS_FRAMES);
  player.status.stoneskin = Math.max(player.status.stoneskin, REVIEW_STATUS_FRAMES);
  player.status.swift = Math.max(player.status.swift, REVIEW_STATUS_FRAMES);
  player.status.torch = Math.max(player.status.torch, REVIEW_STATUS_FRAMES);
  for (const perk of REVIEW_PERKS) player.perks[perk] = true;
}

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
    status: createDefaultStatus(),
    perks: {},
    tpCool: 0,
    recharge: 0,
    pullT: 0,
    pullDir: 1,
    stretchT: 0,
    skidT: 0,
    skidDir: 1,
    swapT: 0,
    recoilT: 0,
    staggerT: 0,
    staggerDir: 1,
    fidgetT: 0,
    crouchT: 0,
    diveT: 0,
    robe: { ox: 0, vx: 0 },
  };
}

export class PlayerControl implements PlayerControlApi {
  /**
   * False until the first animation pass has run. Replaces the original's
   * `player._px === undefined` first-frame guard (the contract types the
   * trackers as required numbers).
   */
  private animStarted = false;

  // Movement-feel state (coyote time / jump buffer / levitation ramp)
  /** Frames since the player last stood on ground (starts "long ago"). */
  private framesSinceGrounded = 99;
  /** Frames remaining in which a pre-landing jump press still fires. */
  private jumpBufferFrames = 0;
  /** Edge detector for the jump key. */
  private prevJumpHeld = false;
  /** Sustained levitation frames (drives the thrust response curve). */
  private levitFrames = 0;
  /** Last half-turn of the stride wheel that produced a footstep. */
  private lastStrideStep = 0;
  /** Consecutive frames standing still (arms the idle fidget). */
  private idleFrames = 0;
  /** Was the body submerged last frame (splash edge detector). */
  private prevInLiquid = false;
  /** Horizontal accel multiplier from the status engine (frozen = 0.55). */
  private statusSlow = 1;

  constructor(private ctx: Ctx) {}

  /** Original: damagePlayer(amount, kx, ky) — lines 1565-1575. */
  damage(amount: number, kx: number, ky: number, src?: string): void {
    const ctx = this.ctx;
    const player = ctx.player;
    if (player.dead || player.invuln > 0) return;
    // Sanctum boon resistances by damage source
    if (src === 'explosion' && player.perks.ironhide) amount *= 0.4;
    if (src === 'fire' && player.perks.flameward) amount *= 0.4;
    if ((src === 'toxic' || src === 'acid') && player.perks.toxinward) amount *= 0.25;
    // Stoneskin (Wave C potion): half damage, knockback shrugged off entirely
    const stoneskinned = player.status.stoneskin > 0;
    if (stoneskinned) amount *= 0.5;
    amount = Math.max(0.5, amount);
    // A blow shatters heart communion — the unhealed remainder is lost
    if (player.recharge > 0) {
      player.recharge = 0;
      ctx.events.emit('toast', { text: 'COMMUNION BROKEN' });
    }
    player.hp -= amount;
    if (!stoneskinned) {
      player.vx += kx || 0;
      player.vy += ky || 0;
    }
    player.invuln = 30;
    // Hurt stagger: a lean away from the blow, and the hat whips with it
    player.staggerT = 12;
    player.staggerDir = kx !== 0 ? Math.sign(kx) : -player.facing;
    player.hat.vx += player.staggerDir * 2.6;
    player.hat.vy -= 1.2;
    ctx.audio.hurt();
    ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.018, 0.05);
    // hitstop: heavy hits freeze gameplay for a beat (Game consumes fx.hitstop)
    if (amount >= 8) ctx.fx.hitstop = 3;
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
    player.recharge = 0;
    ctx.particles.burst(player.x, player.y - 7, 56, Cell.Blood, bloodColor, 4.2);
    ctx.particles.burst(player.x, player.y - 7, 10, null, () => packRGB(168, 85, 247), 3.4, {
      glow: 2.4,
      grav: 0.04,
    });
    // The Noita way: most of your gold spills where you fell — go get it back.
    const runtime = ctx.levels.current;
    const spill = Math.floor(ctx.state.score * 0.75);
    if (runtime && spill > 0) {
      ctx.state.score -= spill;
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
      const piles = Math.min(7, 3 + Math.floor(spill / 60));
      for (let i = 0; i < piles; i++) {
        const gp = makePickup('goldpile', player.x + (Math.random() - 0.5) * 10, player.y - 6, {
          amount: Math.floor(spill / piles) + (i === 0 ? spill % piles : 0),
        });
        gp.vx = (Math.random() - 0.5) * 2.2;
        gp.vy = -1.2 - Math.random() * 1.4;
        runtime.pickups.push(gp);
      }
      ctx.events.emit('toast', { text: `${spill} oz SCATTERS WHERE YOU FELL` });
    }
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

  /** Original: respawnPlayer() — lines 1608-1619; descent rules added in Wave B. */
  respawn(): void {
    const ctx = this.ctx;
    const player = ctx.player;

    // Descent (Wave B): come back at the last lit waystone (or the level
    // spawn) with the world UNTOUCHED — enemies, scars, and hostile fire all
    // persist. The toll already happened: the spilled gold waits where you
    // fell, guarded by whatever killed you.
    if (ctx.levels.current) {
      const rp = ctx.levels.respawnPoint()!;
      player.x = rp.x;
      player.y = rp.y;
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
      ctx.telemetry.count('death.goldLost');
      ctx.particles.burst(rp.x, rp.y - 7, 20, null, () => packRGB(200, 160, 255), 2.7, {
        glow: 2.2,
        grav: -0.01,
      });
      return;
    }

    // Legacy arena path (pre-descent / safety fallback)
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
    const world = ctx.world;
    if (ctx.state.mode !== 'play' || player.dead) return;

    // Near death, you hear it: a slow heartbeat under 25% HP, urgent under 12%.
    const hpFrac = player.hp / player.maxHp;
    if (hpFrac < 0.25) {
      const beat = hpFrac < 0.12 ? 48 : 75;
      if (ctx.state.frameCount % beat === 0) ctx.audio.heartbeat();
    }

    // HEART COMMUNION roots the alchemist; a LEVER PULL plants him too.
    // Movement and casting lock while either runs.
    if (player.pullT > 0) {
      player.pullT--;
      player.facing = player.pullDir; // both hands on the iron
      player.vx *= 0.5;
    }
    const channeling = player.recharge > 0;
    const restrained = channeling || player.pullT > 0;
    const keys = restrained
      ? { left: false, right: false, jump: false, down: false }
      : ctx.input.keys;
    if (channeling) {
      player.recharge--;
      player.hp = Math.min(player.maxHp, player.hp + 0.19);
      player.vx *= 0.7;
      if (ctx.state.frameCount % 3 === 0) {
        ctx.particles.spawn(
          player.x + (Math.random() - 0.5) * 9,
          player.y - 2 - Math.random() * 14,
          (Math.random() - 0.5) * 0.2,
          -0.6 - Math.random() * 0.4,
          null,
          packRGB(255, 110 + Math.floor(Math.random() * 60), 140),
          26,
          { glow: 2.2, grav: -0.01 },
        );
      }
      if (player.recharge % 24 === 0) ctx.audio.tone(520 + (110 - player.recharge) * 3, 660, 0.1, 'sine', 0.05);
      if (player.recharge === 0) {
        // communion complete: a rose-gold ring blooms off the alchemist
        ctx.particles.burst(player.x, player.y - 8, 22, null, () => packRGB(255, 150, 170), 2.6, {
          glow: 2.6,
          grav: -0.005,
        });
        ctx.audio.chest();
      }
    }
    if (player.invuln > 0) player.invuln--;

    // Sim-sampled statuses (Wave C, pillar 5): the cells touching the body
    // decide what you ARE — wet, oiled, burning, frozen, electrified.
    // Sampled every 2nd frame; status DPS bypasses invuln like hazard DPS.
    if (ctx.state.frameCount % 2 === 0) {
      const { damage, slowFactor } = sampleAndTickStatus(
        ctx,
        player,
        4,
        17,
        player.perks.flameward ? { burning: true } : undefined,
      );
      this.statusSlow = slowFactor;
      if (damage > 0) {
        player.hp -= damage;
        if (player.hp <= 0) {
          this.kill();
          return;
        }
      }
      if (player.status.regen > 0) {
        player.hp = Math.min(player.maxHp, player.hp + 0.15);
        // visible mending: soft green motes rise while the potion works
        if (player.hp < player.maxHp && ctx.state.frameCount % 6 === 0) {
          ctx.particles.spawn(
            player.x + (Math.random() - 0.5) * 8,
            player.y - 4 - Math.random() * 10,
            (Math.random() - 0.5) * 0.15,
            -0.45 - Math.random() * 0.3,
            null,
            packRGB(110, 230, 130),
            22,
            { glow: 1.6, grav: -0.008 },
          );
        }
      }
    }

    // DRINK (X held): gulp the flask's contents — a potion is real cells swallowed
    if (ctx.input.drinkHeld) this.drink(ctx);

    // CROUCH (hold S on the ground): knees bend, steps shorten to a creep,
    // and the camera peeks below the ledge — scouting the next drop is a
    // stance, not a guess. Camera reads crouchT for the peek.
    const crouching =
      keys.down &&
      player.grounded &&
      !player.inLiquid &&
      player.pullT === 0 &&
      player.recharge === 0;
    if (crouching) {
      if (player.crouchT === 0) {
        // settle-down puff at the heels
        ctx.particles.burst(player.x, player.y, 3, null, () => {
          const g = 120 + Math.floor(Math.random() * 50);
          return packRGB(g, g, g - 8);
        }, 0.5, { grav: 0.05 });
        player.hat.vy -= 0.8;
      }
      player.crouchT = Math.min(10, player.crouchT + 2);
    } else if (player.crouchT > 0) player.crouchT = Math.max(0, player.crouchT - 2);

    // air control: stronger mid-air acceleration for Ori-like corrections.
    // Swift potion (x1.5) and Swift Soles boon (x1.18) stack on top.
    const speedK =
      (player.status.swift > 0 ? 1.5 : 1) * (player.perks.swiftfoot ? 1.18 : 1);
    const stanceK = crouching ? 0.38 : 1; // crouch-creep
    const accel = (player.grounded ? 0.5 : 0.575) * this.statusSlow * speedK * stanceK,
      maxRun = 2.6 * speedK * stanceK;
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

    // Sample body cells for liquid and hazards (Pyro Skin / Toxicology resist)
    if (player.tpCool > 0) player.tpCool--;
    const pyro = player.perks.flameward ? 0.4 : 1;
    const toxi = player.perks.toxinward ? 0.25 : 1;
    let liquidCount = 0,
      hazardDmg = 0,
      healTouch = 0,
      tpTouch = false,
      fungusBrush = false;
    for (let dy = 0; dy < 17; dy += 2) {
      for (let dx = -4; dx <= 4; dx += 2) {
        const X = player.x + dx,
          Y = player.y - dy;
        if (!world.inBounds(X, Y)) continue;
        const ci2 = world.idx(X, Y);
        const c = world.types[ci2];
        if (isLiquid(c)) liquidCount++;
        if (c === Cell.Fire) hazardDmg += 0.22 * pyro;
        if (c === Cell.Lava) hazardDmg += 0.62 * pyro;
        if (c === Cell.Acid) hazardDmg += 0.32 * toxi;
        if (c === Cell.Toxic) hazardDmg += 0.2 * toxi;
        if (c === Cell.Healium) {
          healTouch += 0.14;
          // consumed as it heals
          if (Math.random() < 0.12) {
            world.types[ci2] = Cell.Empty;
            world.colors[ci2] = EMPTY_COLOR;
          }
        }
        if (c === Cell.Teleportium) tpTouch = true;
        if (c === Cell.Fungus || c === Cell.Glowshroom) fungusBrush = true;
      }
    }
    player.inLiquid = liquidCount >= 13;
    // SPLASH: breaking the surface at speed throws up droplets of whatever
    // you fell into (the pool's own colors — the grid explains the splash).
    if (player.inLiquid && !this.prevInLiquid && player.vy > 1.2) {
      const li2 = world.idx(Math.floor(player.x), Math.floor(player.y));
      const splashColor = world.inBounds(Math.floor(player.x), Math.floor(player.y))
        ? world.colors[li2]
        : packRGB(60, 140, 220);
      for (let d = 0; d < 10; d++) {
        ctx.particles.spawn(
          player.x + (Math.random() - 0.5) * 8,
          player.y - 14,
          (Math.random() - 0.5) * 2.2,
          -1.2 - Math.random() * 1.6,
          null,
          splashColor,
          26,
          { grav: 0.12 },
        );
      }
      ctx.audio.splash(Math.min(1, player.vy / 4));
    }
    this.prevInLiquid = player.inLiquid;
    // Wave F: brushing through glowcap colonies puffs a little spore cloud
    if (
      fungusBrush &&
      Math.random() < 0.05 &&
      (Math.abs(player.vx) > 0.4 || Math.abs(player.vy) > 0.4)
    ) {
      ctx.particles.burst(player.x, player.y - 8, 5, null, () => packRGB(110, 200, 130), 0.9, {
        glow: 0.9,
        grav: -0.004,
      });
    }
    if (healTouch > 0 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + healTouch);
      if (ctx.state.frameCount % 10 === 0) {
        ctx.particles.spawn(
          player.x + (Math.random() - 0.5) * 6,
          player.y - 8 - Math.random() * 8,
          (Math.random() - 0.5) * 0.3,
          -0.5 - Math.random() * 0.4,
          null,
          packRGB(255, 150, 195),
          24,
          { grav: -0.01, glow: 2.0 },
        );
      }
    }
    if (tpTouch && player.tpCool <= 0) this.randomTeleport(ctx);
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

    // jump buffer: remember a fresh press for up to 8 frames before touchdown
    const jumpPressed = keys.jump && !this.prevJumpHeld;
    this.prevJumpHeld = keys.jump;
    if (jumpPressed) this.jumpBufferFrames = 8;
    else if (this.jumpBufferFrames > 0) this.jumpBufferFrames--;

    let levitating = false;
    if (keys.jump) {
      // coyote time: a press within 6 frames of walking off a ledge still gets the full jump
      const coyote = jumpPressed && this.framesSinceGrounded <= 6;
      if (player.grounded || player.inLiquid || coyote) {
        player.vy = -3.7;
        player.grounded = false;
        player.stretchT = 6; // launch stretch (anti-squash)
        this.framesSinceGrounded = 99; // consumed — no double coyote jumps
        this.jumpBufferFrames = 0;
        ctx.audio.jump();
      } else if (player.levit > 0 && player.diveT === 0) {
        levitating = true;
        // levitation response: the jet SPOOLS. Thrust starts at a near-hover
        // 0.34 (gravity is 0.28 — the first frames barely arrest the fall)
        // and builds t-squared to the full 0.62 over 20 frames, so a tap
        // feathers your height and a hold winds up into a climb. Releasing
        // resets the spool (levitFrames), which is what makes tapping a
        // hover instrument instead of an on/off rocket.
        const t = Math.min(this.levitFrames / 20, 1);
        const thrust = 0.34 + 0.28 * t * t;
        player.vy -= thrust;
        // Levity potion (Wave C): levitation burns no levit while the timer runs
        if (player.status.levity <= 0)
          player.levit -= 1.15 * (player.perks.featherweight ? 0.55 : 1);
        this.levitFrames++;
        // SPUTTER WARNING: below 20% fuel the jet coughs — gaps in the
        // exhaust, a put-put under the hum — panic BEFORE the fall starts.
        const sputtering = player.levit / player.maxLevit < 0.2 && player.status.levity <= 0;
        if (sputtering) {
          ctx.audio.sputter();
          if (ctx.state.frameCount % 9 < 4) {
            ctx.particles.spawn(
              player.x + (Math.random() - 0.5) * 3,
              player.y + 1,
              (Math.random() - 0.5) * 0.4,
              0.8,
              null,
              packRGB(110, 100, 90),
              12,
            );
          }
        }
        ctx.audio.levitate();
        if (ctx.state.frameCount % 3 === 0 && !(sputtering && ctx.state.frameCount % 9 >= 4)) {
          // the plume reads the spool: soft puffs while winding up, a full
          // hard exhaust once the jet is at speed
          ctx.particles.spawn(
            player.x + (Math.random() - 0.5) * 2,
            player.y + 0.5,
            (Math.random() - 0.5) * 0.4,
            (0.7 + Math.random() * 0.5) * (0.55 + 0.45 * t),
            null,
            packRGB(255, 150 + Math.floor(Math.random() * 80), 30),
            14,
            { grav: 0.02, glow: 2.2 },
          );
        }
      }
    }
    if (!levitating) this.levitFrames = 0;
    if (player.grounded || player.inLiquid) player.levit = Math.min(player.maxLevit, player.levit + 1.7);

    // DIVE SLAM (press S in the air): commit to the fall. The body locks
    // into a spear, horizontal drift bleeds off, and the landing pays it
    // all back (see the slam in updatePlayerAnimation).
    if (
      keys.down &&
      !player.grounded &&
      !player.inLiquid &&
      player.diveT === 0 &&
      player.vy > -1
    ) {
      player.diveT = 1;
      player.vy = Math.max(player.vy, 5.6);
      player.hat.vy -= 2.6; // the hat objects to the decision
      ctx.audio.noiseBurst(0.12, 320, 0.1);
    }
    if (player.diveT > 0) {
      player.diveT++;
      player.vy = Math.max(player.vy, 4.6); // stays committed
      player.vx *= 0.86;
      if (player.inLiquid) player.diveT = 0; // water catches you (splash plays)
      else if (ctx.state.frameCount % 2 === 0) {
        // speed streaks peeling off the shoulders
        ctx.particles.spawn(
          player.x + (Math.random() - 0.5) * 5,
          player.y - 13 - Math.random() * 4,
          0,
          -0.7,
          null,
          packRGB(140, 170, 210),
          8,
          { grav: -0.01 },
        );
      }
    }
    // dive overrides the normal terminal velocity (5.0)
    player.vy = clamp(player.vy, -4.6, player.diveT > 0 ? 6.4 : 5.0);

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
    if (player.grounded) {
      // jump buffer: a press made just before touchdown fires on the landing frame
      if (this.jumpBufferFrames > 0) {
        player.vy = -3.7;
        player.grounded = false;
        player.fallPeak = 0; // this landing was consumed by the jump
        player.stretchT = 6;
        this.jumpBufferFrames = 0;
        this.framesSinceGrounded = 99;
        ctx.audio.jump();
      } else {
        this.framesSinceGrounded = 0; // coyote time anchor
      }
    } else {
      this.framesSinceGrounded++;
    }

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

    // Wave D: play-mode casting runs the wand's compiled card program
    // (update() already gates on mode === 'play'; build-mode sandbox spells
    // keep the legacy ctx.spells dispatch).
    if (player.firing) ctx.wands.fire(ctx);
    this.updatePlayerAnimation(ctx);
  }

  /**
   * DRINK (Wave C): swallow the flask's real cells, 2 per frame. Elixirs load
   * the potion timers (a potion is a timed rewrite of entity-vs-cell rules);
   * water soaks you and puts you out; anything else refuses to go down.
   */
  private drink(ctx: Ctx): void {
    const s = ctx.flask.state;
    const st = ctx.player.status;
    if (s.material === null || s.count === 0) return;
    const m = s.material;
    if (m !== Cell.ElixirLife && m !== Cell.ElixirLevity && m !== Cell.ElixirStone && m !== Cell.Water) return;

    const sips = Math.min(2, s.count);
    for (let i = 0; i < sips; i++) {
      if (m === Cell.ElixirLife) st.regen = Math.min(1800, st.regen + 10);
      else if (m === Cell.ElixirLevity) st.levity = Math.min(1800, st.levity + 12);
      else if (m === Cell.ElixirStone) st.stoneskin = Math.min(1800, st.stoneskin + 10);
    }
    if (m === Cell.Water) {
      // Drinking water soaks you from the inside — and puts you out
      st.wet = 120;
      st.burning = 0;
    }
    s.count -= sips;
    if (s.count === 0) s.material = null;
    if (ctx.state.frameCount % 10 === 0) ctx.audio.tone(300, 180, 0.08, 'sine', 0.12);
  }

  /**
   * Teleportium contact: the violet liquid flings the alchemist somewhere
   * else entirely. 120-frame cooldown so a pool doesn't strobe-teleport.
   */
  private randomTeleport(ctx: Ctx): void {
    const player = ctx.player;
    player.tpCool = 120;
    ctx.particles.burst(player.x, player.y - 8, 18, null, () => packRGB(185, 110, 255), 2.6, {
      glow: 2.4,
      grav: 0,
    });
    for (let a = 0; a < 60; a++) {
      const tx = 20 + Math.floor(Math.random() * (WIDTH - 40));
      const ty = 24 + Math.floor(Math.random() * (HEIGHT - 60));
      if (ctx.physics.entityFree(tx, ty, 4, 17)) {
        player.x = tx;
        player.y = ty;
        player.vx = 0;
        player.vy = 0;
        ctx.particles.burst(tx, ty - 8, 18, null, () => packRGB(185, 110, 255), 2.6, {
          glow: 2.4,
          grav: 0,
        });
        ctx.audio.tone(660, 1320, 0.18, 'sine', 0.18);
        return;
      }
    }
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
    if (player.grounded && Math.abs(player._svx) > 0.2) {
      player.stridePhase += Math.abs(player._svx) * 0.16;
      // FOOTSTEPS: each half-turn of the wheel is a foot meeting the ground,
      // and the ground decides the sound — stone ticks, sand hushes, wood
      // knocks, shallows slosh.
      const step = Math.floor(player.stridePhase / Math.PI);
      if (step !== this.lastStrideStep) {
        this.lastStrideStep = step;
        const w2 = ctx.world;
        const fx2 = Math.floor(player.x),
          fy2 = Math.floor(player.y);
        const at = w2.inBounds(fx2, fy2) ? w2.types[w2.idx(fx2, fy2)] : Cell.Empty;
        const under = w2.inBounds(fx2, fy2 + 1) ? w2.types[w2.idx(fx2, fy2 + 1)] : Cell.Empty;
        let surface: 'stone' | 'soft' | 'wet' | 'wood' = 'stone';
        if (isLiquid(at)) surface = 'wet';
        else if (
          under === Cell.Sand ||
          under === Cell.Snow ||
          under === Cell.Ash ||
          under === Cell.Gold ||
          under === Cell.Coal
        )
          surface = 'soft';
        else if (under === Cell.Wood || under === Cell.Vines) surface = 'wood';
        ctx.audio.footstep(surface);
      }
    } else if (!player.grounded) player.stridePhase += 0.05;

    // TURN SKID: reversing at speed plants both heels — a beat of
    // anticipation (Dead Cells style) with scuffed dust and a hat whip.
    const want = (ctx.input.keys.right ? 1 : 0) - (ctx.input.keys.left ? 1 : 0);
    if (
      player.skidT === 0 &&
      player.grounded &&
      want !== 0 &&
      Math.sign(player._svx) === -want &&
      Math.abs(player._svx) > 1.1
    ) {
      player.skidT = 9;
      player.skidDir = Math.sign(player._svx);
      player.hat.vx += player.skidDir * 2.0; // hat keeps going the old way
      ctx.audio.noiseBurst(0.05, 700, 0.07, true);
      ctx.particles.burst(player.x + player.skidDir * 2, player.y, 4, null, () => {
        const g = 120 + Math.floor(Math.random() * 60);
        return packRGB(g, g, g - 10);
      }, 0.8, { grav: 0.05 });
    }
    if (player.skidT > 0) {
      player.skidT--;
      // dust keeps kicking off the planted heels mid-skid
      if (player.skidT > 3 && ctx.state.frameCount % 3 === 0) {
        ctx.particles.spawn(
          player.x + player.skidDir * 3,
          player.y,
          player.skidDir * 0.5,
          -0.3,
          null,
          packRGB(140, 135, 125),
          10,
          { grav: 0.06 },
        );
      }
    }

    // SLAM: a dive that meets the ground pays out in cells and bodies —
    // max squash, a dust ring, popped powder grains, and shoved foes.
    if (player.grounded && player.diveT > 0) {
      player.diveT = 0;
      player.landTimer = 10;
      ctx.audio.landThud(1);
      ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.014, 0.04);
      for (const dir of [-1, 1]) {
        for (let k = 0; k < 6; k++) {
          ctx.particles.spawn(
            player.x + dir * (2 + k),
            player.y,
            dir * (0.8 + Math.random() * 0.9),
            -0.5 - Math.random() * 0.7,
            null,
            packRGB(120 + Math.floor(Math.random() * 70), 130, 115),
            18,
            { grav: 0.07 },
          );
        }
      }
      // the impact bursts the soft top layer into real ballistic grains
      const ws = ctx.world;
      let popped = 0;
      for (let dy2 = 1; dy2 <= 2 && popped < 12; dy2++) {
        for (let dx2 = -4; dx2 <= 4 && popped < 12; dx2++) {
          const X2 = Math.floor(player.x) + dx2,
            Y2 = Math.floor(player.y) + dy2;
          if (!ws.inBounds(X2, Y2)) continue;
          const ci4 = ws.idx(X2, Y2);
          const t4 = ws.types[ci4];
          if (
            t4 === Cell.Sand ||
            t4 === Cell.Snow ||
            t4 === Cell.Ash ||
            t4 === Cell.Gold ||
            t4 === Cell.Coal
          ) {
            const col4 = ws.colors[ci4];
            ws.types[ci4] = Cell.Empty;
            ws.colors[ci4] = EMPTY_COLOR;
            ctx.particles.spawn(X2, Y2, (dx2 / 4) * 1.4, -1.2 - Math.random(), t4, col4, 40, {
              grav: 0.12,
            });
            popped++;
          }
        }
      }
      // grounded foes near the impact get knocked off their feet
      for (const e of ctx.enemies) {
        if (Math.abs(e.x - player.x) < 26 && Math.abs(e.y - player.y) < 10) {
          ctx.enemyCtl.damage(e, 1, Math.sign(e.x - player.x || 1) * 1.6, -1.8);
        }
      }
    }

    // Landing squash: triggered by how hard we hit the ground
    if (player.grounded && !player.prevGrounded && player.fallPeak > 2.2) {
      player.landTimer = Math.min(10, 4 + Math.floor(player.fallPeak * 1.4));
      // landing feedback: thud scaled to the fall; dust + shake on hard hits
      ctx.audio.landThud((player.fallPeak - 2.2) / 4);
      if (player.fallPeak > 3.5) {
        ctx.particles.burst(
          player.x,
          player.y,
          6 + Math.floor(Math.random() * 5),
          null,
          () => {
            const g = 110 + Math.floor(Math.random() * 70);
            return packRGB(g, g, g);
          },
          0.9,
          { grav: 0.05 },
        );
        ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.006 + player.fallPeak * 0.0015, 0.03);
      }
    }
    player.fallPeak = player.grounded ? 0 : Math.max(player.fallPeak, player.vy);
    if (player.landTimer > 0) player.landTimer--;
    if (player.stretchT > 0) player.stretchT--;
    if (player.recoilT > 0) player.recoilT--;
    if (player.staggerT > 0) player.staggerT--;
    if (player.swapT > 0) player.swapT--;
    player.prevGrounded = player.grounded;

    // Occasional blink
    if (player.blinkTimer > 0) player.blinkTimer--;
    else if (Math.random() < 0.007) player.blinkTimer = 6;

    // IDLE FIDGETS: stand still long enough and the alchemist stays alive —
    // straightens the hat, then gives the wand a little flourish of sparks.
    const idle =
      player.grounded &&
      Math.abs(player._svx) < 0.15 &&
      !player.firing &&
      player.pullT === 0 &&
      player.recharge === 0 &&
      player.staggerT === 0 &&
      player.crouchT === 0; // a crouch is a stance, not boredom
    if (!idle) {
      this.idleFrames = 0;
      player.fidgetT = 0;
    } else if (player.fidgetT > 0) {
      player.fidgetT--;
      if (player.fidgetT === 74) {
        // the hand reaches the brim: the hat springs from being straightened
        player.hat.vy -= 2.2;
        player.hat.vx += player.facing * 0.8;
      }
      if (player.fidgetT < 50 && player.fidgetT > 18 && player.fidgetT % 6 === 0) {
        // wand flourish: a slow figure of sparks off the tip
        const tip = ctx.spells.wandTip();
        ctx.particles.spawn(
          tip.x,
          tip.y,
          Math.cos(player.fidgetT * 0.45) * 0.5,
          Math.sin(player.fidgetT * 0.45) * 0.5 - 0.15,
          null,
          packRGB(150 + Math.floor(Math.random() * 80), 200, 255),
          16,
          { grav: -0.005, glow: 2.4 },
        );
      }
    } else {
      this.idleFrames++;
      if (this.idleFrames > 420) {
        player.fidgetT = 90;
        this.idleFrames = 60; // next fidget ~6s later, not instantly
      }
    }

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

    // Robe hem: a second, heavier cloth spring — it lags the body and
    // overshoots on direction changes, so the skirt swings instead of snaps.
    const r = player.robe;
    r.vx += -r.ox * 0.2 - ax * 1.5;
    r.vx *= 0.78;
    r.ox = clamp(r.ox + r.vx, -3, 3);
  }
}
