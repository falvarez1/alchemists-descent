// ===================== Player (the Alchemist) =====================
// Ported from noita-sandbox.html lines 1475-1484 (player initializer) and
// 1565-1760 (damagePlayer / killPlayer / findSpawnPoint / respawnPlayer /
// updatePlayer / updatePlayerAnimation).
// DOM writes (game-over overlay) become 'playerDied' / 'playerRespawned' events.

import { DEATH_SLOWMO_FRAMES, HEIGHT, WIDTH } from '@/config/constants';
import { difficultyMods } from '@/config/difficulty';
import { clamp } from '@/core/math';
import type { Ctx, EnemyKind, PerkId, PlayerControlApi, PlayerState, RigidBody } from '@/core/types';
import { PLAYER_CEIL_SLIP, PLAYER_CRAWL_H, PLAYER_CRAWL_STEP_UP, PLAYER_H, PLAYER_HALF_W, PLAYER_STEP_UP, PLAYER_VERT_SLIP } from '@/core/types';
import { clearElementalStatus, createDefaultStatus, sampleAndTickStatus } from '@/entities/status';
import { makePickup } from '@/core/pickupDefs';
import { resetCombatTransients } from '@/game/transients';
import { blocksEntity, Cell, isGas, isLiquid } from '@/sim/CellType';
import { bloodColor, packRGB, smokeColor } from '@/sim/colors';

const REVIEW_STATUS_FRAMES = 3600;
const CLIMB_FACE_REACHES = [PLAYER_HALF_W + 1, PLAYER_HALF_W + 2, PLAYER_HALF_W + 3, PLAYER_HALF_W + 4];
const CLIMB_X_NUDGES = [0, 1, 2];
/** Climbing UP may bulge farther off the face to round a protruding rock/overhang
 *  (a stone nub poking into the body); nudge 3 keeps the wall just within reach. */
const CLIMB_UP_NUDGES = [0, 1, 2, 3];
const CLIMB_BRUSH_MAX = 8;
/** Mantle: at a wall top, pull up onto a ledge whose surface is this many cells
 *  of rise away (roughly hand-high), nearest first. */
const CLIMB_MANTLE_MIN_UP = 5;
const CLIMB_MANTLE_MAX_UP = PLAYER_H + 3;
/** Climb speed in CELLS PER FRAME (higher = faster). A fractional rate lets us
 *  tune between whole-frame cadences — ~0.45 is a touch quicker than the old
 *  3-frames-per-cell (0.33) without becoming a zip. */
const CLIMB_RATE_UP = 0.45;
const CLIMB_RATE_DOWN = 0.5;
/** Max cells/frame the body is pulled toward the face to close the grip gap. */
const CLIMB_SNUG_MAX = 4;
/** Heights (cells above the feet) the wall-lean sampler reads the face at. */
const CLIMB_LEAN_LOW = 2;
const CLIMB_LEAN_HIGH = 14;
/** Lean below this is treated as a plumb wall (kills jitter on lumpy faces). */
const CLIMB_LEAN_DEADZONE = 0.14;
/** Tilt cap: tan of the body angle off vertical (~0.32 ≈ 18°). Keep it modest —
 *  a strong tilt reads as "lying down", not "climbing". */
const CLIMB_LEAN_MAX = 0.32;
/** How fast the rendered lean eases toward the measured wall angle (heavy = calm). */
const CLIMB_LEAN_EASE = 0.12;
const TELEPORT_SEARCH_RADIUS = 260;
// Vine swing (#2): latch a hanging vine and pendulum on it; pump with left/right.
const KICK_BASE_RECOIL = 0.5; // kick always self-pushes this fraction even into open air (so it works mid-air like wand recoil); a solid hit ramps to 1
const GUST_ENEMY_PUSH = 5; // kick wind-gust shove scalar for enemies (mass-scaled in EnemyControl.gustShove)
const MOVE_ACCEL_CAP = 0.6; // max per-frame ground-speed gain — high top speeds (Swift stacks / God Mode) RAMP up over several frames instead of snapping to max
const LIQUID_SPLASH_MIN_SPEED = 1.2;
const LIQUID_STOMP_SPLASH_MIN_SPEED = 2.2;
// ---- Blood wading (fresh gore is a real liquid you have to slog through).
// The wet Cell.Blood hugging the lower body is counted each frame; that one
// number drives a movement drag, a robe stain, and a spattering wake. Tuned so
// a shallow film barely drags and a leg-deep wade is a real trudge. See the
// "BLOOD WADE" block in update().
const WADE_SAMPLE_H = 9; // cells up from the feet the leg-deep blood scan reaches
const WADE_FULL_CELLS = 48; // blood-cell count that reads as a full leg-deep wade (drag saturates here)
const WADE_SLOW_MAX = 0.55; // fraction of ground accel / top run-speed shed at a full wade
const WADE_STAIN_TOUCH_MIN = 4; // blood cells at the legs that count as "stepped in it" (soaks the robe)
const WADE_WAKE_MIN_SPEED = 0.5; // |vx| below which plowing through throws no wake
const BLOOD_STAIN_MAX = 3600; // soak-charge cap — a full soak lingers ~60s (at 60Hz) once he leaves the blood
const WADE_STAIN_GAIN = 18; // soak charge banked per frame of wading (×0.35–1.0 with depth) — deeper/longer = redder
// Fine horizontal control + variable jump height (Celeste-style) used to live as
// module consts here; they now live on ctx.params.player (moveSoftStart,
// groundStopDecay/Snap, airGlideSpeed, airStopDecay, jumpCut, jumpHoldWindow,
// maxRunCap) so the inspector can tune jump/run/air FEEL live without a recompile.
// See config/params.ts PLAYER_PARAMS and core/types.ts PlayerTuning.
const ENEMY_STOMP_BOUNCE = 3.6; // upward pop after a Mario-style stomp kill (chains to the next foe)
// Too big/heavy to stomp — a boot off these just bounces (handle them another way).
const STOMP_IMMUNE: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['colossus', 'leviathan', 'golem']);
const SWING_REACH = 16;
const SWING_PUMP = 0.16;
const SWING_MIN_LEN = 14;
const SWING_MAX_LEN = 150;
const TELEPORT_SEARCH_RADIUS_SQ = TELEPORT_SEARCH_RADIUS * TELEPORT_SEARCH_RADIUS;
const TELEPORT_MAX_VISITED = 60000;
const TELEPORT_MAX_CANDIDATES = 384;
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

export function climbBrushesCell(t: number): boolean {
  return t === Cell.Snow || t === Cell.Ash || t === Cell.Moss || t === Cell.Fungus;
}

export function playerLiquidSplashDropletCount(vy: number, stomping: boolean): number {
  if (vy <= LIQUID_SPLASH_MIN_SPEED) return 0;
  const base = 10 + Math.floor((vy - LIQUID_SPLASH_MIN_SPEED) * 4);
  if (!stomping || vy <= LIQUID_STOMP_SPLASH_MIN_SPEED) return Math.min(22, base);
  return Math.min(96, Math.max(45, base * 3 + Math.floor((vy - LIQUID_STOMP_SPLASH_MIN_SPEED) * 12)));
}

function teleportHazardCell(t: number): boolean {
  return (
    t === Cell.Fire ||
    t === Cell.Lava ||
    t === Cell.Acid ||
    t === Cell.Toxic ||
    t === Cell.Nitrogen ||
    t === Cell.Teleportium
  );
}

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
    kickT: 0,
    kickDir: 1,
    staggerT: 0,
    staggerDir: 1,
    fidgetT: 0,
    crouchT: 0,
    diveT: 0,
    crawling: false,
    crawlT: 0,
    crawlSlope: 0,
    wallGrabT: 0,
    wallGrabDir: 1,
    climbing: false,
    climbDir: 1,
    climbT: 0,
    climbPhase: 0,
    climbMoveT: 0,
    climbIntentY: 0,
    climbLean: 0,
    robe: { ox: 0, vx: 0 },
    bloodStain: 0,
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
  /** Frames left in a fresh jump's ballistic rise: during this window holding
   *  jump stays a (cuttable) ballistic leap rather than spooling the jet, so
   *  releasing early gives a short hop. Counts down; 0 = jet may engage. */
  private jumpRiseFrames = 0;
  /** Rigid-body footing gets a short grace before jump-cut so launches clear the body. */
  private jumpCutGraceFrames = 0;
  /** Edge detector for the jump key. */
  private prevJumpHeld = false;
  /** Frames until the player can kick again. */
  private kickCooldownT = 0;
  /** Death ragdoll: the flung corpse body (null when alive), its settle flag + timer. */
  private corpse: RigidBody | null = null;
  private corpseSettled = false;
  private corpseT = 0;
  /** Vine swing: pendulum state (anchor pivot + rope length) while latched. */
  private swinging = false;
  private swingAX = 0;
  private swingAY = 0;
  private swingLen = 0;
  private swingJumpPrev = false;
  /** Edge detector for the Space-only wall-jump key. */
  private prevWallJumpHeld = false;
  /** Grab input buffer, so near-miss wall catches feel intentional. */
  private grabBufferFrames = 0;
  /** Edge detector for grab. */
  private prevGrabHeld = false;
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
  /** Edge detector for the CRAMPED HUD glyph (crawling, wants up, can't). */
  private prevCramped = false;

  private findClimbFace(ctx: Ctx, bodyH: number): number {
    const { player } = ctx;
    const wantSide = ctx.input.keys.right ? 1 : ctx.input.keys.left ? -1 : player.facing || 1;
    const sides = [wantSide, -wantSide];
    for (const side of sides) {
      if (this.hasClimbFaceAt(ctx, side, bodyH, player.x, player.y)) return side;
    }
    return 0;
  }

  private hasClimbFace(ctx: Ctx, side: number, bodyH: number): boolean {
    const { player } = ctx;
    return this.hasClimbFaceAt(ctx, side, bodyH, player.x, player.y);
  }

  private hasClimbFaceAt(ctx: Ctx, side: number, bodyH: number, x: number, y: number): boolean {
    const { world } = ctx;
    const clearance = this.climbClearance(ctx, x, y, side, bodyH);
    if (!clearance.ok) return false;

    let anchored = 0;
    let samples = 0;
    for (let dy = 2; dy <= bodyH - 2; dy += 3) {
      let hasHold = false;
      for (const reach of CLIMB_FACE_REACHES) {
        const sx = x + side * reach;
        const sy = y - dy;
        if (!world.inBounds(sx, sy)) continue;
        hasHold ||= ctx.physics.cellBlocks(sx, sy);
      }
      samples++;
      if (hasHold) anchored++;
    }
    return samples >= 4 && anchored >= 2;
  }

  /** Horizontal cells from body center to the first solid face cell on `side`. */
  private wallSurfaceDist(ctx: Ctx, x: number, y: number, side: number, dy: number): number {
    const maxReach = PLAYER_HALF_W + 9;
    for (let r = PLAYER_HALF_W - 1; r <= maxReach; r++) {
      const sx = x + side * r,
        sy = y - dy;
      if (!ctx.world.inBounds(sx, sy)) return -1;
      if (ctx.physics.cellBlocks(sx, sy)) return r;
    }
    return -1;
  }

  private rigidBodyHalfExtents(body: RigidBody): [number, number] {
    const shape = body.shape;
    if (shape.kind === 'circle') return [shape.radius, shape.radius];
    const c = Math.abs(Math.cos(body.angle));
    const s = Math.abs(Math.sin(body.angle));
    return [shape.halfW * c + shape.halfH * s, shape.halfW * s + shape.halfH * c];
  }

  private supportedByRigidBody(ctx: Ctx, bodyH: number): boolean {
    const { player } = ctx;
    const feetY = player.y;
    const headY = player.y - bodyH;
    const left = player.x - PLAYER_HALF_W;
    const right = player.x + PLAYER_HALF_W;
    for (const body of ctx.rigidBodies.bodies) {
      if (body === ctx.rigidBodies.playerCorpse) continue;
      const [ex, ey] = this.rigidBodyHalfExtents(body);
      const bL = body.x - ex;
      const bR = body.x + ex;
      if (right <= bL || left >= bR) continue;
      const bT = body.y - ey;
      if (feetY >= bT - 1 && feetY <= bT + Math.max(2, player.vy + 1) && headY < bT) return true;
    }
    return false;
  }

  /**
   * The climbed face's tangent slope: x-shift per cell of HEIGHT, sampling the
   * surface distance low and high on the body. 0 on a plumb wall. The sprite
   * leans by this so it lies parallel to the rock; the climb releases when it
   * exceeds CLIMB_LEAN_RELEASE (a walkable slope or a wrong-way overhang).
   */
  private climbLeanTarget(ctx: Ctx): number {
    const { player } = ctx;
    const side = player.climbDir || 1;
    // Least-squares slope of surface-distance vs height over MANY samples, so a
    // single bump or edge can't throw the lean — real cave faces are lumpy and a
    // two-point read swings wildly off any nub.
    let n = 0,
      sumH = 0,
      sumD = 0,
      sumHH = 0,
      sumHD = 0;
    for (let dy = CLIMB_LEAN_LOW; dy <= CLIMB_LEAN_HIGH; dy += 2) {
      const d = this.wallSurfaceDist(ctx, player.x, player.y, side, dy);
      if (d < 0) continue;
      n++;
      sumH += dy;
      sumD += d;
      sumHH += dy * dy;
      sumHD += dy * d;
    }
    if (n < 4) return 0; // not enough face sampled to trust a slope
    const denom = n * sumHH - sumH * sumH;
    if (denom === 0) return 0;
    return (side * (n * sumHD - sumH * sumD)) / denom;
  }

  private climbClearance(
    ctx: Ctx,
    x: number,
    y: number,
    side: number,
    bodyH: number,
  ): { ok: boolean; brush: Array<[number, number]> } {
    const { world } = ctx;
    const brush: Array<[number, number]> = [];
    for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) {
      for (let dy = 0; dy < bodyH; dy++) {
        const sx = x + dx;
        const sy = y - dy;
        if (sx < 0 || sx >= WIDTH || sy >= HEIGHT) return { ok: false, brush: [] };
        if (sy < 0) continue;
        if (!ctx.physics.cellBlocks(sx, sy)) continue;

        const onWallShoulder = dx * side >= PLAYER_HALF_W - 1;
        const t = world.types[world.idx(sx, sy)];
        if (!onWallShoulder || !climbBrushesCell(t)) return { ok: false, brush: [] };

        brush.push([sx, sy]);
        if (brush.length > CLIMB_BRUSH_MAX) return { ok: false, brush: [] };
      }
    }
    return { ok: true, brush };
  }

  private brushClimbDebris(ctx: Ctx, cells: Array<[number, number]>, side: number): void {
    const { world } = ctx;
    for (const [x, y] of cells) {
      if (!world.inBounds(x, y)) continue;
      const i = world.idx(x, y);
      const t = world.types[i];
      if (!climbBrushesCell(t)) continue;
      ctx.particles.spawn(
        x,
        y,
        -side * (0.25 + Math.random() * 0.35),
        -0.25 - Math.random() * 0.35,
        null,
        world.colors[i],
        32,
        { grav: 0.06 },
      );
      world.clearCellAt(i);
    }
  }

  private tryClimbStep(ctx: Ctx, dy: number): boolean {
    const { player } = ctx;
    const side = player.climbDir || 1;
    // Climbing up bulges farther off the face to get the body around a jutting
    // rock; down keeps the tighter nudge set (hasClimbFaceAt still gates it onto
    // the wall, so a bulge that loses the face is simply not taken).
    const nudges = dy < 0 ? CLIMB_UP_NUDGES : CLIMB_X_NUDGES;
    for (const nudge of nudges) {
      const nx = player.x - side * nudge;
      const ny = player.y + dy;
      const clearance = this.climbClearance(ctx, nx, ny, side, PLAYER_H);
      if (!clearance.ok || !this.hasClimbFaceAt(ctx, side, PLAYER_H, nx, ny)) continue;
      player.x = nx;
      player.y = ny;
      this.brushClimbDebris(ctx, clearance.brush, side);
      return true;
    }
    return false;
  }

  /**
   * Top-out mantle: when an up-climb can't continue (the wall ended), look for a
   * standable lip just over the top — toward the wall, near the hands — and haul
   * up onto it instead of dangling. Returns true if he pulled up (now grounded).
   */
  private tryMantle(ctx: Ctx): boolean {
    const { player } = ctx;
    const side = player.climbDir || 1;
    for (let up = CLIMB_MANTLE_MIN_UP; up <= CLIMB_MANTLE_MAX_UP; up++) {
      for (let over = 0; over <= PLAYER_HALF_W + 3; over++) {
        const nx = player.x + side * over; // step onto the TOP of the wall (toward the face)
        const ny = player.y - up;
        if (!ctx.physics.entityFree(nx, ny, PLAYER_HALF_W, PLAYER_H)) continue; // standing room
        if (ctx.physics.entityFree(nx, ny + 1, PLAYER_HALF_W, 1)) continue; // solid underfoot
        player.x = nx;
        player.y = ny;
        player.vx = side * 0.5;
        player.vy = 0;
        player.fx = 0;
        player.fy = 0;
        player.grounded = true;
        player.stretchT = 6; // a little pull-up pop
        player.hat.vy -= 1.4;
        this.stopClimb(player);
        ctx.particles.burst(nx, ny - 2, 7, null, () => packRGB(150, 140, 120), 1.2, { grav: 0.05 });
        ctx.audio.noiseBurst(0.05, 300, 0.08, true);
        return true;
      }
    }
    return false;
  }

  private startClimb(ctx: Ctx, side: number): void {
    const { player } = ctx;
    player.climbing = true;
    player.climbDir = side;
    player.climbT = Math.max(player.climbT, 2);
    player.climbMoveT = 0;
    player.climbIntentY = 0;
    player.wallGrabDir = side;
    player.wallGrabT = 10;
    player.crawling = false;
    player.crawlT = 0;
    player.diveT = 0;
    player.vx = 0;
    player.vy = 0;
    player.fx = 0;
    player.fy = 0;
    player.firing = false;
    ctx.input.siphonHeld = ctx.input.pourHeld = ctx.input.drinkHeld = false;
    const clearance = this.climbClearance(ctx, player.x, player.y, side, PLAYER_H);
    if (clearance.ok) this.brushClimbDebris(ctx, clearance.brush, side);
    player.hat.vx += side * 0.9;
    player.hat.vy -= 1.0;
    ctx.audio.noiseBurst(0.04, 420, 0.06, true);
  }

  private stopClimb(player: PlayerState): void {
    player.climbing = false;
    player.climbMoveT = 0;
    player.climbIntentY = 0;
  }

  /** A subtle gleam when the wizard's light catches an EXPOSED RawOre face nearby
   *  — the discovery tell for the hidden gold-flecked ore. Cheap: a few random
   *  samples in the light radius per frame, only on ore with an open neighbor. */
  private glintNearbyOre(ctx: Ctx): void {
    const w = ctx.world;
    const p = ctx.player;
    const R = 28;
    const open = (x: number, y: number): boolean => {
      if (!w.inBounds(x, y)) return false;
      const t = w.types[w.idx(x, y)];
      return t === Cell.Empty || isGas(t);
    };
    for (let s = 0; s < 5; s++) {
      const gx = Math.round(p.x + (Math.random() - 0.5) * 2 * R);
      const gy = Math.round(p.y - 9 + (Math.random() - 0.5) * 2 * R);
      if (!w.inBounds(gx, gy) || w.types[w.idx(gx, gy)] !== Cell.RawOre) continue;
      if (!(open(gx - 1, gy) || open(gx + 1, gy) || open(gx, gy - 1) || open(gx, gy + 1))) continue;
      if (Math.random() < 0.3) {
        ctx.particles.spawn(gx, gy, (Math.random() - 0.5) * 0.3, -0.15, null, packRGB(255, 222, 130), 12, { glow: 1.9, grav: -0.012 });
      }
    }
  }

  /** Mario stomp: a committed dive that spears a stompable foe's upper body kills
   *  it outright and bounces the player off (chaining to the next). Caller gates
   *  on diveT > 0, so a plain fall onto a foe never triggers it. */
  private tryStompEnemy(ctx: Ctx): void {
    const player = ctx.player;
    for (const e of ctx.enemies.slice()) {
      if (!ctx.enemies.includes(e)) continue;
      if (STOMP_IMMUNE.has(e.kind)) continue;
      const def = ctx.enemyCtl.defs[e.kind];
      if (Math.abs(player.x - e.x) > PLAYER_HALF_W + def.halfW) continue; // no horizontal overlap
      const crown = e.y - def.h;
      // Feet must have driven down into the foe from above (crown..feet band).
      if (player.y >= crown - 4 && player.y <= e.y + 1) {
        ctx.enemyCtl.kill(e, player.vx * 0.4, -1.2);
        player.diveT = 0;
        player.vy = -ENEMY_STOMP_BOUNCE;
        player.grounded = false;
        player.stretchT = 6;
        ctx.fx.hitstop = Math.max(ctx.fx.hitstop, 3); // a crunchy little freeze
        ctx.audio.landThud(0.85);
        return; // one kill per frame; the bounce carries you onward
      }
    }
  }

  private resetClimbState(player: PlayerState): void {
    player.climbing = false;
    player.climbDir = player.wallGrabDir || 1;
    player.climbT = 0;
    player.climbPhase = 0;
    player.climbMoveT = 0;
    player.climbIntentY = 0;
    player.wallGrabT = 0;
  }

  constructor(private ctx: Ctx) {}

  private reduceIncomingDamage(amount: number, minimum = 0): number {
    if (this.ctx.player.status.stoneskin > 0) amount *= 0.5;
    return Math.max(minimum, amount);
  }

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
    amount = this.reduceIncomingDamage(amount, 0.5);
    // A blow shatters heart communion — the unhealed remainder is lost
    if (player.recharge > 0) {
      player.recharge = 0;
      ctx.events.emit('toast', { text: 'COMMUNION BROKEN' });
    }
    player.hp -= amount;
    this.applyImpulse(kx || 0, ky || 0);
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

  /** Add a velocity impulse (cells/frame) to the player — the shared verb for
   *  explosions, knockback, and (later) rigid-body pushes. Stoneskin shrugs off
   *  external knockback entirely (self-inflicted wand recoil bypasses this). */
  applyImpulse(vx: number, vy: number): void {
    const player = this.ctx.player;
    if (player.status.stoneskin > 0) return;
    player.vx += vx;
    player.vy += vy;
  }

  /**
   * Melee kick (bound to F): a short cone toward the aim shoves rigid bodies
   * (mass-aware via applyMomentumAt — light crates fly, heavy ones resist) and
   * knocks back/damages enemies. Landing it on something solid (a heavy body or
   * terrain) recoils the wizard the other way — a kick-jump off the world.
   */
  kick(ctx: Ctx): void {
    const player = ctx.player;
    if (player.dead || player.climbing || ctx.state.mode !== 'play') return;
    if (this.kickCooldownT > 0) return;
    const lp = ctx.params.player;
    this.kickCooldownT = lp.kickCooldown;
    const a = player.aimAngle;
    const dirX = Math.cos(a);
    const dirY = Math.sin(a);
    player.kickT = 12;
    player.kickDir = dirX < 0 ? -1 : 1;
    player.facing = player.kickDir;
    // Origin at the hip, nudged toward the aim.
    const ox = player.x + dirX * 3;
    const oy = player.y - 8 + dirY * 3;
    const cosArc = Math.cos(lp.kickArc);
    let reaction = 0; // 0 = kicked air; → 1 = hit something immovable (full recoil)

    // Rigid bodies in the cone: mass-aware shove + spin.
    for (const body of ctx.rigidBodies.bodies) {
      if (body.kind !== 'dynamic') continue;
      const dx = body.x - ox;
      const dy = body.y - oy;
      const d = Math.hypot(dx, dy) || 1;
      const reach = lp.kickRange + (body.shape.kind === 'circle' ? body.shape.radius : 5);
      if (d > reach) continue;
      const nx = dx / d;
      const ny = dy / d;
      if (nx * dirX + ny * dirY < cosArc) continue;
      ctx.rigidBodies.applyMomentumAt(
        body,
        dirX * lp.kickImpulse,
        dirY * lp.kickImpulse - lp.kickImpulse * 0.2,
        body.x - nx * 1.5,
        body.y - ny * 1.5,
      );
      const mass = body.invMass && body.invMass > 0 ? 1 / body.invMass : 100;
      reaction = Math.max(reaction, Math.min(1, mass / 90));
    }

    // Enemies in the cone: knockback + contact damage.
    for (const e of ctx.enemies.slice()) {
      if (!ctx.enemies.includes(e)) continue;
      const dx = e.x - ox;
      const dy = e.y - 5 - oy;
      const d = Math.hypot(dx, dy) || 1;
      if (d > lp.kickRange + 6) continue;
      const nx = dx / d;
      const ny = dy / d;
      if (nx * dirX + ny * dirY < cosArc) continue;
      ctx.enemyCtl.damage(e, lp.kickDamage, dirX * 3.2, dirY * 2 - 1.4);
      reaction = Math.max(reaction, 0.5);
    }

    // Terrain straight ahead → full reaction (kick off a wall/floor).
    const world = ctx.world;
    for (let s = 4; s <= lp.kickRange; s += 2) {
      const cx = Math.floor(ox + dirX * s);
      const cy = Math.floor(oy + dirY * s);
      if (world.inBounds(cx, cy) && blocksEntity(world.types[world.idx(cx, cy)])) {
        reaction = 1;
        break;
      }
    }

    // Self-recoil opposite the kick. A base push-off ALWAYS applies — Newton for
    // the kick effort — so the shove feels the same mid-air (levitating) as it
    // does on the ground, matching how a wand shot always recoils. Biting into
    // something solid adds the stronger kick-jump on top.
    const recoil = lp.kickSelfRecoil * Math.max(KICK_BASE_RECOIL, reaction);
    this.applyImpulse(-dirX * recoil, -dirY * recoil);
    if (player.grounded && dirY > 0.2) player.grounded = false; // kicking down lifts you off
    // The gust catches the wizard's own cloth: the hat whips and the robe flares
    // in the blast (the same springs the dive/skid/recoil drive).
    player.hat.vx += dirX * 1.8;
    player.hat.vy -= 1.2;
    player.robe.vx += dirX * 1.4;

    // WIND GUST: the kick is a blast of air. Within a wide gust cone it blows loose
    // light cells (ash ALWAYS, plus embers + gases) into flying motes, shoves loose
    // particles and ambient critters (moths) away from the wizard, and bends the
    // hanging vines — the same "push, don't block" feel as walking through debris.
    const windRange = lp.kickRange + 10;
    const windCos = Math.cos(Math.min(Math.PI * 0.9, lp.kickArc * 1.5)); // wider fan than the melee cone
    const gustAt = (px: number, py: number): number => {
      const gx = px - ox;
      const gy = py - oy;
      const gd = Math.hypot(gx, gy) || 1;
      if (gd > windRange) return 0;
      if ((gx / gd) * dirX + (gy / gd) * dirY < windCos) return 0;
      return 1 - gd / windRange; // linear falloff
    };
    let blown = 0;
    const bx = Math.floor(ox);
    const by = Math.floor(oy);
    const wr = Math.ceil(windRange);
    // The fan only opens AHEAD: when its half-angle is under 90° (windCos > 0 —
    // true for every sane kickArc) gustAt rejects anything behind the origin
    // plane, so skip that whole rear half-box up front with a cheap dot test on
    // the cell→origin offset (saves the idx/types reads on ~half the ~65×65 box).
    // A freak-wide fan (windCos ≤ 0) falls back to the full scan, behavior same.
    const pruneRear = windCos > 0;
    for (let yy = -wr; yy <= wr && blown < 64; yy++) {
      for (let xx = -wr; xx <= wr && blown < 64; xx++) {
        const cx = bx + xx;
        const cy = by + yy;
        if (pruneRear && (cx - ox) * dirX + (cy - oy) * dirY <= 0) continue; // strictly behind → gustAt = 0
        if (!world.inBounds(cx, cy)) continue;
        const ci = world.idx(cx, cy);
        const t = world.types[ci];
        if (t !== Cell.Ash && t !== Cell.Ember && !isGas(t)) continue;
        const g = gustAt(cx, cy);
        if (g <= 0) continue;
        const col = world.colors[ci];
        world.clearCellAt(ci);
        ctx.particles.spawn(cx + 0.5, cy + 0.5, dirX * (2 + g * 4) + (Math.random() - 0.5) * 1.2, dirY * (2 + g * 4) - 0.5 - Math.random(), t, col, 36 + ((Math.random() * 24) | 0), { grav: isGas(t) ? -0.03 : 0.06, glow: t === Cell.Ember ? 1.2 : 0 });
        blown++;
      }
    }
    for (const pt of ctx.particles.list) {
      const g = gustAt(pt.x, pt.y);
      if (g > 0) { pt.vx += dirX * g * 3.6; pt.vy += dirY * g * 3.6 - g * 0.4; }
    }
    if (ctx.critters) {
      for (const cr of ctx.critters.list) {
        const g = gustAt(cr.x, cr.y);
        if (g > 0) {
          cr.vx += dirX * g * 4.5;
          cr.vy += dirY * g * 4.5 - g * 1.4;
          cr.facing = dirX < 0 ? -1 : 1;
          // startle so the AI stops instantly damping the shove — it scatters
          // and flees (a beetle that would otherwise re-plant its crawl speed).
          cr.startle = Math.max(cr.startle ?? 0, Math.round(18 + g * 14));
        }
      }
    }
    // Enemies in the gust are blown back too — mass-scaled in the enemy controller:
    // a slime is nudged, a bat is hurled hard enough to smash into a wall and splatter.
    for (const e of ctx.enemies) {
      const g = gustAt(e.x, e.y - 5);
      if (g > 0) ctx.enemyCtl.gustShove(e, dirX, dirY, g * GUST_ENEMY_PUSH);
    }
    ctx.vineStrands?.applyRadialImpulse(ox, oy, windRange * 0.9, 1.8); // bend the hanging vines in the gust

    // Feedback: a dust arc along the kick + a low thud + an airy whoosh.
    for (let k = 0; k < 8; k++) {
      const spread = a + (Math.random() - 0.5) * lp.kickArc * 1.6;
      ctx.particles.spawn(ox + dirX * 4, oy + dirY * 4, Math.cos(spread) * 1.6, Math.sin(spread) * 1.6, null, packRGB(190, 178, 158), 12, { grav: 0.05 });
    }
    ctx.audio.tone(150, 90, 0.14, 'square', 0.09);
    ctx.audio.noiseBurst(0.12, 220, 0.09); // whoosh
  }

  /** Latch onto the nearest hanging vine for a pendulum swing; true if latched. */
  grabVine(ctx: Ctx): boolean {
    if (this.swinging) return true;
    const player = ctx.player;
    if (player.dead || player.climbing || ctx.state.mode !== 'play') return false;
    const g = ctx.vineStrands.grabSwing(player.x, player.y - 8, SWING_REACH);
    if (!g) return false;
    this.swinging = true;
    player.swinging = true; // body-resolve skips him while the pendulum owns movement
    this.swingAX = g.anchorX;
    this.swingAY = g.anchorY;
    this.swingLen = Math.max(SWING_MIN_LEN, Math.min(g.length, SWING_MAX_LEN));
    this.swingJumpPrev = ctx.input.keys.jump; // don't insta-launch if jump is already held
    ctx.vineStrands.driveSwing(player.x, player.y - 8);
    ctx.audio.tone(260, 160, 0.06, 'sine', 0.06);
    return true;
  }

  /** Let go of a vine swing (keeps the launch velocity). */
  releaseVine(ctx: Ctx): void {
    if (!this.swinging) return;
    this.swinging = false;
    ctx.player.swinging = false;
    this.swingJumpPrev = false;
    // `grounded` is frozen at its pre-swing value (the normal update — which
    // re-detects ground — was skipped every swinging frame). If it's stale-true,
    // the release-frame horizontal block clamps vx to maxRun and the swing's
    // momentum vanishes. Force airborne so the inertia path carries the launch;
    // ground is correctly re-detected at the end of this frame.
    ctx.player.grounded = false;
    ctx.vineStrands.releaseSwing();
  }

  resetTransientState(ctx: Ctx): void {
    this.releaseVine(ctx);
    this.clearCorpse(ctx);
    this.resetClimbState(ctx.player);
    ctx.player.crawling = false;
    ctx.player.crawlT = 0;
    ctx.player.swinging = false;
    this.animStarted = false;
    this.framesSinceGrounded = 99;
    this.jumpBufferFrames = 0;
    this.jumpRiseFrames = 0;
    this.jumpCutGraceFrames = 0;
    this.prevJumpHeld = false;
    this.kickCooldownT = 0;
    this.swingAX = 0;
    this.swingAY = 0;
    this.swingLen = 0;
    this.swingJumpPrev = false;
    this.prevWallJumpHeld = false;
    this.grabBufferFrames = 0;
    this.prevGrabHeld = false;
    this.levitFrames = 0;
    this.lastStrideStep = 0;
    this.idleFrames = 0;
    this.prevInLiquid = false;
    this.statusSlow = 1;
    this.prevCramped = false;
  }

  /** Pendulum while latched to a vine: gravity + a rigid rope constraint (radial
   *  velocity projected out, tangential kept), pumped by left/right; jump launches. */
  private updateSwing(ctx: Ctx): void {
    const player = ctx.player;
    const keys = ctx.input.keys;
    player.vy += 0.28; // gravity drives the swing
    const rx = player.x - this.swingAX;
    const ry = player.y - this.swingAY;
    const rd = Math.hypot(rx, ry) || 0.001;
    const tx = -ry / rd; // tangent (perpendicular to the rope)
    const ty = rx / rd;
    // Tangent (tx,ty) points LEFT when hanging below the anchor, so the pump sign
    // is inverted vs intuition: RIGHT must drive +x. (left → −pump → +tx·… etc.)
    let pump = 0;
    if (keys.left) pump += SWING_PUMP;
    if (keys.right) pump -= SWING_PUMP;
    player.vx += tx * pump;
    player.vy += ty * pump;
    player.vx *= 0.992;
    player.vy *= 0.996;
    const oldX = player.x;
    const oldY = player.y;
    player.x += player.vx;
    player.y += player.vy;
    // enforce the rope length: clamp to the arc and project out radial velocity
    const nx = player.x - this.swingAX;
    const ny = player.y - this.swingAY;
    const nd = Math.hypot(nx, ny) || 0.001;
    if (nd > this.swingLen) {
      const ux = nx / nd;
      const uy = ny / nd;
      player.x = this.swingAX + ux * this.swingLen;
      player.y = this.swingAY + uy * this.swingLen;
      const radial = player.vx * ux + player.vy * uy;
      if (radial > 0) {
        player.vx -= ux * radial;
        player.vy -= uy * radial;
      }
    }
    // don't swing through solid (torso/feet sample); revert + bleed the speed
    const bx = Math.floor(player.x);
    if (ctx.physics.cellBlocks(bx, Math.floor(player.y - 8)) || ctx.physics.cellBlocks(bx, Math.floor(player.y - 1))) {
      player.x = oldX;
      player.y = oldY;
      player.vx *= 0.4;
      player.vy *= 0.4;
    }
    player.fx = 0;
    player.fy = 0;
    player.facing = player.vx >= 0 ? 1 : -1;
    ctx.vineStrands.driveSwing(player.x, player.y - 8);
    // jump launches off the vine with a boost
    const jumpEdge = keys.jump && !this.swingJumpPrev;
    this.swingJumpPrev = keys.jump;
    if (jumpEdge) {
      this.releaseVine(ctx);
      player.vy -= 2.0;
      ctx.audio.jump();
    }
  }

  /** Original: killPlayer() — lines 1577-1587. */
  kill(): void {
    const ctx = this.ctx;
    const player = ctx.player;
    if (player.dead) return;
    this.releaseVine(ctx); // let go of any vine before ragdolling
    player.dead = true;
    player.hp = 0;
    player.recharge = 0;
    clearElementalStatus(player.status);
    this.resetClimbState(player);
    ctx.particles.burst(player.x, player.y - 7, 56, Cell.Blood, bloodColor, 4.2);
    ctx.particles.burst(player.x, player.y - 7, 10, null, () => packRGB(168, 85, 247), 3.4, {
      glow: 2.4,
      grav: 0.04,
    });
    // Death is a walk back, not a reset: a small recoverable purse spills (the
    // fraction scales with difficulty — gentler on easy, harsher on Archmage).
    const runtime = ctx.levels.current;
    const spill = Math.floor(ctx.state.score * difficultyMods(ctx.state).deathPenalty);
    if (runtime && spill > 0) {
      ctx.state.score -= spill;
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
      const piles = Math.min(spill, 7, 3 + Math.floor(spill / 60));
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
    ctx.levels.saveDeathCheckpoint?.(ctx);
    // RAGDOLL DEATH: the wizard becomes a tumbling corpse flung with his last
    // momentum (plus a death-pop + spin). The game-over overlay waits until it
    // settles (see tickCorpse → 'playerCorpseSettled'); a tombstone rises then.
    if (ctx.rigidBodies) {
      this.corpse = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3, halfH: 8 }, player.x, player.y - 8, {
        density: 1,
        friction: 0.7,
        restitution: 0.28,
        vx: player.vx * 0.9 + (Math.random() - 0.5) * 1.2,
        vy: Math.min(player.vy, 0) - 1.6,
        va: (Math.random() - 0.5) * 0.5 - player.vx * 0.04,
        tag: 'player-corpse',
        color: packRGB(70, 110, 190),
      });
      this.corpseSettled = false;
      this.corpseT = 0;
    }
    ctx.audio.squelch();
    ctx.audio.boom(10);
    ctx.fx.screenShake = 0.05;
    // A beat of freeze, then slow-mo: the death reads as a moment, and the camera
    // (see Camera.update) rides the ragdoll down through it.
    ctx.fx.hitstop = Math.max(ctx.fx.hitstop, 5);
    ctx.fx.deathSlowMo = DEATH_SLOWMO_FRAMES;
    const level = ctx.levels.current?.def;
    ctx.events.emit('playerDied', {
      depth: level?.depth ?? ctx.waves.num,
      level: level?.name ?? 'Arena',
      gold: ctx.state.score,
    });
  }

  /** Watch the death ragdoll: once it sleeps (or after a timeout so the UI is
   *  never stranded) mark it settled — the renderer raises a tombstone and the
   *  game-over overlay reveals. Runs every frame while a corpse exists. */
  private tickCorpse(ctx: Ctx): void {
    const corpse = this.corpse;
    if (!corpse) return;
    this.corpseT++;
    if (!this.corpseSettled && (corpse.sleeping || this.corpseT > 240)) {
      this.corpseSettled = true;
      corpse.data = { settled: true }; // the renderer reads this to raise the tombstone
      ctx.audio.tone(150, 320, 0.32, 'sine', 0.09); // a low knell
      ctx.events.emit('playerCorpseSettled');
    }
  }

  /** Remove the death ragdoll + tombstone (on respawn / death-clear). */
  private clearCorpse(ctx: Ctx): void {
    if (this.corpse) ctx.rigidBodies.remove(this.corpse);
    this.corpse = null;
    this.corpseSettled = false;
    this.corpseT = 0;
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
          // Hitbox is PLAYER_HALF_W wide × PLAYER_H tall; the y+1 probe is the cell underfoot.
          if (ctx.physics.entityFree(cx, y, PLAYER_HALF_W, PLAYER_H) && !ctx.physics.entityFree(cx, y + 1, PLAYER_HALF_W, 1)) {
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
        if (ctx.physics.entityFree(cx, y, PLAYER_HALF_W, PLAYER_H) && !ctx.physics.entityFree(cx, y + 1, PLAYER_HALF_W, 1)) {
          return { x: cx, y };
        }
      }
    }
    return { x: Math.floor(WIDTH / 2), y: 20 };
  }

  /** The reset shared by both respawn paths: drop the player at (x,y) with full
   *  vitals, cleared status/climb/crawl, a fresh invuln window, and announce it.
   *  Each path computes its own spawn point and does its own extra cleanup after. */
  private resetPlayerAt(x: number, y: number): void {
    const player = this.ctx.player;
    player.x = x;
    player.y = y;
    player.vx = 0;
    player.vy = 0;
    player.fx = 0;
    player.fy = 0;
    player.hp = player.maxHp;
    player.mana = player.maxMana;
    player.levit = player.maxLevit;
    clearElementalStatus(player.status);
    player.dead = false;
    player.invuln = 90;
    player.crawling = false; // arrivals are standing-safe
    player.crawlT = 0;
    player.bloodStain = 0; // a fresh robe on every arrival
    this.resetClimbState(player);
    this.resetTransientState(this.ctx);
    this.ctx.fx.hitstop = 0;
    this.ctx.fx.deathSlowMo = 0;
    this.ctx.events.emit('playerRespawned');
  }

  /** Original: respawnPlayer() — lines 1608-1619; descent rules added in Wave B. */
  respawn(): void {
    const ctx = this.ctx;
    this.clearCorpse(ctx); // remove the death ragdoll + tombstone
    this.releaseVine(ctx);

    // Descent (Wave B): come back at the last lit waystone (or the level
    // spawn) with the world UNTOUCHED — enemies, scars, and hostile fire all
    // persist. The toll already happened: the spilled gold waits where you
    // fell, guarded by whatever killed you.
    if (ctx.levels.current) {
      const rp = ctx.levels.respawnPoint()!;
      this.resetPlayerAt(rp.x, rp.y);
      ctx.telemetry.count('death.goldLost');
      ctx.particles.burst(rp.x, rp.y - 7, 20, null, () => packRGB(200, 160, 255), 2.7, {
        glow: 2.2,
        grav: -0.01,
      });
      return;
    }

    // Legacy arena path (pre-descent / safety fallback)
    const sp = this.findSpawnPoint();
    this.resetPlayerAt(sp.x, sp.y);
    // Clear hostile projectiles and stale charging handles, restart current wave.
    resetCombatTransients(ctx, { projectiles: 'keep-friendly', particles: false });
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
    this.tickCorpse(ctx); // runs while dead too (watches the ragdoll settle)
    if (ctx.state.mode !== 'play' || player.dead) return;
    if (this.swinging) { this.updateSwing(ctx); return; } // pendulum replaces normal movement
    if (this.kickCooldownT > 0) this.kickCooldownT--;

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
      ? { left: false, right: false, up: false, jump: false, wallJump: false, down: false, grab: false }
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

    // ---- CRAWL stance machine (docs/CRAWL.md): S is intent, geometry is law.
    // The key expresses what you want; the world decides the actual stance,
    // and the stance may never desync from the ceiling above it.
    let cramped = false;
    if (!player.crawling) {
      // Enter: the crouch-creep flows into a crawl the moment you push
      // sideways — voluntarily in the open (staying small under fire), and
      // it is the only shape that fits a 9-tall gap. Stationary S stays the
      // crouch-peek; S in the air stays the dive slam.
      if (
        keys.down &&
        (keys.left || keys.right) &&
        !keys.jump &&
        player.grounded &&
        !player.inLiquid &&
        !player.climbing &&
        player.wallGrabT <= 0 && // never drop into a crawl while gripping a wall face — it reads as lying off the rock
        !restrained
      ) {
        player.crawling = true;
        // going down on all fours: dust at the hands and knees, hat bobs hard
        player.hat.vy -= 1.8;
        for (const u of [3, -2]) {
          ctx.particles.burst(player.x + player.facing * u, player.y, 2, null, () => {
            const g = 115 + Math.floor(Math.random() * 50);
            return packRGB(g, g, g - 8);
          }, 0.55, { grav: 0.05 });
        }
        ctx.audio.crawlShuffle();
      }
    } else {
      // Wants-to-stand: S released, W pressed (a stand attempt comes before
      // any jump), swimming preempting the stance, or a restraint (communion,
      // lever) demanding the full posture. Geometry has the final word.
      // Gripping a wall face stands you up (geometry permitting) so a crawl can't
      // cling sideways to the rock — the bouldering pose owns the wall, not the crawl.
      const wantsStand = !keys.down || keys.jump || player.inLiquid || restrained || player.wallGrabT > 0;
      if (wantsStand) {
        if (ctx.physics.entityFree(player.x, player.y, 4, PLAYER_H)) {
          // POP upright: reverse squash overshoot, the hat flips, dust shakes off
          player.crawling = false;
          player.stretchT = 6;
          player.hat.vy -= 2.4;
          player.hat.vx += player.facing * 1.2;
          ctx.particles.burst(player.x, player.y - 10, 4, null, () => {
            const g = 120 + Math.floor(Math.random() * 50);
            return packRGB(g, g, g - 8);
          }, 0.7, { grav: 0.04 });
        } else {
          // CRAMPED: the world says no — visibly and audibly. Every ~40
          // ticks the hat bumps the ceiling and a grit-fleck falls.
          cramped = true;
          if (ctx.state.frameCount % 40 === 0) {
            player.hat.vy -= 1.4;
            ctx.audio.crampedBump();
            ctx.particles.spawn(
              player.x + (Math.random() - 0.5) * 4,
              player.y - PLAYER_CRAWL_H,
              (Math.random() - 0.5) * 0.3,
              0.4,
              null,
              packRGB(122, 112, 98),
              14,
              { grav: 0.08 },
            );
          }
        }
      }
    }
    if (cramped !== this.prevCramped) {
      this.prevCramped = cramped;
      ctx.events.emit('crampedChanged', { cramped });
    }
    // Crawl pose ease, 0->10 like crouchT (a 3-4 frame squash either way)
    player.crawlT = player.crawling
      ? Math.min(10, player.crawlT + 3)
      : Math.max(0, player.crawlT - 3);
    const bodyH = player.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const stepUp = player.crawling ? PLAYER_CRAWL_STEP_UP : PLAYER_STEP_UP;
    const supportedByRigidBody = this.supportedByRigidBody(ctx, bodyH);
    const supportedByTerrain = !ctx.physics.entityFree(player.x, player.y + 1, PLAYER_HALF_W, 1);
    if (!player.grounded && (supportedByRigidBody || supportedByTerrain)) {
      player.grounded = true;
      this.framesSinceGrounded = 0;
    }

    // Sim-sampled statuses (Wave C, pillar 5): the cells touching the body
    // decide what you ARE — wet, oiled, burning, frozen, electrified.
    // Sampled every 2nd frame; status DPS bypasses invuln like hazard DPS.
    if (ctx.state.frameCount % 2 === 0) {
      const { damage, slowFactor } = sampleAndTickStatus(
        ctx,
        player,
        4,
        bodyH,
        player.perks.flameward ? { burning: true } : undefined,
        2,
      );
      this.statusSlow = slowFactor;
      if (damage > 0) {
        player.hp -= this.reduceIncomingDamage(damage);
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
    if (ctx.input.drinkHeld && !player.climbing) this.drink(ctx);

    // CROUCH (hold S on the ground): knees bend, steps shorten to a creep,
    // and the camera peeks below the ledge — scouting the next drop is a
    // stance, not a guess. Camera reads crouchT for the peek.
    const crouching =
      keys.down &&
      player.grounded &&
      !player.inLiquid &&
      !player.crawling &&
      !player.climbing &&
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

    // ---- BLOOD WADE (design: if the grid can't explain it, it doesn't ship).
    // Fresh blood pooling around the legs is a liquid you have to slog through.
    // Count the wet Cell.Blood hugging the lower body; that drives the drag
    // (folded into accel/maxRun below), the robe soak, and the wake.
    let bloodWadeCells = 0;
    const wadeTop = Math.min(bodyH, WADE_SAMPLE_H);
    const sampleX = Math.floor(player.x);
    const sampleY = Math.floor(player.y);
    for (let dy = 0; dy <= wadeTop; dy++) {
      for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) {
        const X = sampleX + dx,
          Y = sampleY - dy;
        if (!world.inBounds(X, Y)) continue;
        if (world.types[world.idx(X, Y)] === Cell.Blood) bloodWadeCells++;
      }
    }
    const wade01 = Math.min(1, bloodWadeCells / WADE_FULL_CELLS);
    const wadeSlow = 1 - wade01 * WADE_SLOW_MAX;
    // Soak the robe: the stain BUILDS with exposure — deeper blood (wade01) and
    // more time both bank charge, so the robe reddens the more/longer he wades
    // (saturating at the cap, which also sets the ~1 min lifetime). Off the
    // blood the charge drains 1/frame. The sprite tints in proportion.
    if (bloodWadeCells >= WADE_STAIN_TOUCH_MIN) {
      player.bloodStain = Math.min(BLOOD_STAIN_MAX, player.bloodStain + WADE_STAIN_GAIN * (0.35 + 0.65 * wade01));
    } else if (player.bloodStain > 0) {
      player.bloodStain--;
    }
    // A visible wake: plowing through at speed shoves the pool up into a crest
    // (a real swap, mass conserved) and flings droplets of its own colour
    // (cosmetic type=null motes, so the wake can never flood the sim).
    if (
      wade01 > 0 &&
      player.grounded &&
      Math.abs(player.vx) > WADE_WAKE_MIN_SPEED &&
      ctx.state.frameCount % 2 === 0
    ) {
      const dir = player.vx >= 0 ? 1 : -1;
      const leadX = Math.round(player.x + dir * PLAYER_HALF_W);
      let kicked = 0;
      for (let dy = 0; dy <= 5 && kicked < 3; dy++) {
        const Y = sampleY - dy;
        if (!world.inBounds(leadX, Y)) continue;
        const i = world.idx(leadX, Y);
        if (world.types[i] !== Cell.Blood) continue;
        const col = world.colors[i];
        ctx.particles.spawn(
          leadX + 0.5,
          Y,
          dir * (0.5 + Math.random() * 0.9) + player.vx * 0.18,
          -0.45 - Math.random() * 1.0,
          null,
          col,
          12 + ((Math.random() * 10) | 0),
          { grav: 0.18 },
        );
        // shove this surface cell up a row when there's headroom (a bow-wave crest)
        if (
          Math.random() < 0.5 &&
          world.inBounds(leadX, Y - 1) &&
          world.types[world.idx(leadX, Y - 1)] === Cell.Empty
        ) {
          world.swap(leadX, Y, leadX, Y - 1);
        }
        kicked++;
      }
      if (Math.random() < 0.05) ctx.audio.splash(0.18 + Math.random() * 0.18);
    }

    // air control: stronger mid-air acceleration for Ori-like corrections.
    // Swift potion (x1.5) and Swift Soles boon (x1.18) stack on top — but those
    // are GROUND legs. While the levitation jet is lit (levitFrames>0 means we
    // levitated last frame) the horizontal handling switches to its own knob
    // (levitHorizControl), so a ground-speed buff no longer makes flight skate
    // sideways far faster than it climbs. This is also the hook for future
    // levitation enhancement cards/spells.
    const lp = ctx.params.player;
    const levitatingMove =
      this.levitFrames > 0 && !player.grounded && !player.inLiquid && !player.climbing;
    const speedK = levitatingMove
      ? lp.levitHorizControl
      : (player.status.swift > 0 ? 1.5 : 1) * (player.perks.swiftfoot ? 1.18 : 1);
    // crouch-creep 0.38; crawl 0.32 — slow is the crawl's whole cost
    const stanceK = player.crawling ? 0.32 : crouching ? 0.38 : 1;
    // Cap the per-frame speed gain so a high top speed builds up over several
    // frames (a natural ramp) instead of snapping to max in ~5 frames flat. The
    // cap only bites at high speedK (Swift/God Mode); normal, crawl, and the
    // gentle levitation accel stay well under it and are unchanged.
    // wadeSlow (≤1) bogs both the accel and the top speed when slogging through
    // blood — a leg-deep wade trudges, a thin film barely registers.
    const accel = Math.min((player.grounded ? 0.5 : 0.575) * this.statusSlow * speedK * stanceK * wadeSlow, MOVE_ACCEL_CAP),
      // Cap the boosted top speed (Swift/God Mode) so it stays inside the
      // precision curve; crawl/crouch then scale down from the capped run.
      maxRun = Math.min(2.6 * speedK, lp.maxRunCap) * stanceK * wadeSlow;
    // Soft-start: ease in from a standstill (a tap stays slow + precise), ramping
    // to full accel with speed. Applies in the air too, so a fresh airborne tap is
    // gentle while CARRIED speed (already near maxRun) still gets full control.
    const stepAccel = accel * (lp.moveSoftStart + (1 - lp.moveSoftStart) * Math.min(1, Math.abs(player.vx) / maxRun));
    if (!player.climbing) {
      // Powered input accelerates UP TO maxRun but never drags carried momentum
      // back DOWN — a fast run carried into a jump/levitate keeps its speed (you
      // can still actively brake or reverse). Pressing past maxRun is a no-op;
      // any excess momentum bleeds off through drag, never a hard snap.
      if (keys.right) {
        player.facing = 1;
        if (player.vx < maxRun) player.vx = Math.min(maxRun, player.vx + stepAccel);
      }
      if (keys.left) {
        player.facing = -1;
        if (player.vx > -maxRun) player.vx = Math.max(-maxRun, player.vx - stepAccel);
      }
      if (player.grounded || player.inLiquid) {
        // On a surface: a quick, snappy stop on release so a tap is a small,
        // predictable nudge instead of a long coast (precision-platformer feel).
        if (!keys.left && !keys.right) {
          player.vx *= lp.groundStopDecay;
          if (Math.abs(player.vx) < lp.groundStopSnap) player.vx = 0;
        }
        player.vx = clamp(player.vx, -maxRun, maxRun);
      } else {
        // Airborne / levitating: a fast run still GLIDES (carried momentum bleeds
        // slowly through airDrag), but a quick low-speed TAP stops fast so it's a
        // small nudge, not a 60-cell skate. The ±12 rail caps stacked recoil.
        if (!keys.left && !keys.right && Math.abs(player.vx) < lp.airGlideSpeed) {
          player.vx *= lp.airStopDecay;
          if (Math.abs(player.vx) < lp.groundStopSnap) player.vx = 0;
        } else {
          player.vx *= lp.airDrag;
        }
        player.vx = clamp(player.vx, -12, 12);
      }
    } else {
      player.vx = 0;
      player.fx = 0;
    }

    // Sample body cells for liquid and hazards (Pyro Skin / Toxicology resist)
    if (player.tpCool > 0) player.tpCool--;
    const pyro = player.perks.flameward ? 0.4 : 1;
    const toxi = player.perks.toxinward ? 0.25 : 1;
    let liquidCount = 0,
      waterOrBloodCount = 0,
      hazardDmg = 0,
      healTouch = 0,
      tpTouch = false,
      fungusBrush = false,
      sampledSplashColor: number | null = null;
    for (let dy = 0; dy < bodyH; dy += 2) {
      for (let dx = -4; dx <= 4; dx += 2) {
        const X = player.x + dx,
          Y = player.y - dy;
        if (!world.inBounds(X, Y)) continue;
        const ci2 = world.idx(X, Y);
        const c = world.types[ci2];
        if (isLiquid(c)) {
          liquidCount++;
          if (sampledSplashColor === null || c === Cell.Water || c === Cell.Blood) {
            sampledSplashColor = world.colors[ci2];
          }
          if (c === Cell.Water || c === Cell.Blood) waterOrBloodCount++;
        }
        if (c === Cell.Fire) hazardDmg += 0.22 * pyro;
        if (c === Cell.Lava) hazardDmg += 0.62 * pyro;
        if (c === Cell.Acid) hazardDmg += 0.32 * toxi;
        if (c === Cell.Toxic) hazardDmg += 0.2 * toxi;
        if (c === Cell.Healium) {
          healTouch += 0.14;
          // consumed as it heals
          if (Math.random() < 0.12) {
            world.clearCellAt(ci2);
          }
        }
        if (c === Cell.Teleportium) tpTouch = true;
        if (c === Cell.Fungus || c === Cell.Glowshroom) fungusBrush = true;
      }
    }
    // submersion threshold scales to the sampled body (13/45 -> 7/25 crawling)
    player.inLiquid = liquidCount >= (player.crawling ? 7 : 13);
    // SPLASH: breaking the surface at speed throws up droplets of whatever
    // you fell into (the pool's own colors — the grid explains the splash).
    if (player.inLiquid && !this.prevInLiquid && player.vy > LIQUID_SPLASH_MIN_SPEED) {
      const stomping = waterOrBloodCount > 0 && player.diveT > 0 && player.vy > LIQUID_STOMP_SPLASH_MIN_SPEED;
      const dropletCount = playerLiquidSplashDropletCount(player.vy, stomping);
      const splashColor = sampledSplashColor ?? packRGB(60, 140, 220);
      const spread = stomping ? 4.8 : 2.2;
      const lift = stomping ? 3.5 : 1.6;
      const sideBias = stomping ? 0.9 : 0.35;
      for (let d = 0; d < dropletCount; d++) {
        const side = d % 2 === 0 ? -1 : 1;
        ctx.particles.spawn(
          player.x + (Math.random() - 0.5) * (stomping ? 14 : 8),
          player.y - (stomping ? 11 : 14),
          (Math.random() - 0.5) * spread + side * Math.random() * sideBias,
          -1.1 - Math.random() * lift,
          null,
          splashColor,
          stomping ? 30 + ((Math.random() * 18) | 0) : 26,
          { grav: stomping ? 0.14 : 0.12 },
        );
      }
      ctx.audio.splash(Math.min(1, player.vy / (stomping ? 2.8 : 4)));
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
      player.hp -= this.reduceIncomingDamage(hazardDmg);
      if (ctx.state.frameCount % 14 === 0) {
        ctx.audio.hurt();
        ctx.particles.burst(player.x, player.y - 7, 4, Cell.Smoke, smokeColor, 1.1);
      }
      if (player.hp <= 0) {
        this.kill();
        return;
      }
    }

    const jumpPressed = keys.jump && !this.prevJumpHeld;
    this.prevJumpHeld = keys.jump;
    const wallJumpPressed = keys.wallJump && !this.prevWallJumpHeld;
    this.prevWallJumpHeld = keys.wallJump;
    const grabPressed = keys.grab && !this.prevGrabHeld;
    this.prevGrabHeld = keys.grab;
    if (grabPressed) this.grabBufferFrames = 10;
    else if (this.grabBufferFrames > 0) this.grabBufferFrames--;

    // jump buffer: remember a fresh press for up to 8 frames before touchdown
    // (a press while crawling stands, and Space while climbing wall-jumps)
    if (jumpPressed && !player.crawling && !player.climbing) this.jumpBufferFrames = 8;
    else if (this.jumpBufferFrames > 0) this.jumpBufferFrames--;

    // Mana regen
    player.mana = Math.min(player.maxMana, player.mana + 0.45);
    if (player.cooldown > 0) player.cooldown--;

    const canClimb =
      !player.dead &&
      !player.crawling &&
      !player.inLiquid &&
      !restrained &&
      (keys.grab || this.grabBufferFrames > 0);
    if (!player.climbing && canClimb) {
      const side = this.findClimbFace(ctx, PLAYER_H);
      if (side !== 0) this.startClimb(ctx, side);
    }

    let handledByClimb = false;
    if (player.climbing) {
      const stillOnFace = this.hasClimbFace(ctx, player.climbDir, PLAYER_H);
      // The local rock angle: drives the wall-hug tilt, and if it's steeper than
      // a climbable face (a walkable slope, or an overhang tilting the wrong way)
      // we let go — the climb resolves into a walk or a fall.
      const leanTarget = this.climbLeanTarget(ctx);
      if (!keys.grab || player.inLiquid || restrained) {
        this.stopClimb(player);
      } else if (wallJumpPressed || keys.wallJump) {
        const away = -player.climbDir;
        this.stopClimb(player);
        player.vx = away * 2.4;
        player.vy = -3.85;
        player.facing = away;
        player.grounded = false;
        player.stretchT = 6;
        player.wallGrabT = 0;
        player.hat.vx += away * 2.0;
        player.hat.vy -= 2.0;
        this.framesSinceGrounded = 99;
        this.jumpBufferFrames = 0;
        this.grabBufferFrames = 0;
        ctx.audio.jump();
        ctx.particles.burst(player.x - player.climbDir * 3, player.y - 8, 5, null, () => {
          const g = 128 + Math.floor(Math.random() * 50);
          return packRGB(g, g, g - 12);
        }, 0.75, { grav: 0.04 });
      } else if ((player.climbDir > 0 && keys.left && !keys.right) || (player.climbDir < 0 && keys.right && !keys.left)) {
        // Lean AWAY from the wall and you peel off it — let go and fall (no launch,
        // unlike a wall-jump; pressing INTO the wall keeps you hugging it).
        const away = -player.climbDir;
        this.stopClimb(player);
        player.vx = away * 1.2; // a small shove off the face
        player.grounded = false;
        player.wallGrabT = 0;
        player.facing = away;
        this.framesSinceGrounded = 99;
        player.hat.vx += away * 1.0;
        ctx.particles.burst(player.x - player.climbDir * 2, player.y - 6, 3, null, () => {
          const g = 128 + Math.floor(Math.random() * 50);
          return packRGB(g, g, g - 12);
        }, 0.6, { grav: 0.05 });
      } else if (!stillOnFace) {
        // The face ran out. If he was hauling UP and there's a landing in reach,
        // mantle onto it (top-out) rather than just dropping. Otherwise the
        // "healthy limit" is the reach itself — a too-shallow ramp or a face that
        // receded out of reach stops anchoring, dropping him to a walk/fall.
        if (!(keys.up && this.tryMantle(ctx))) this.stopClimb(player);
      } else {
        const climbIntent = keys.up === keys.down ? 0 : keys.up ? -1 : 1;
        player.climbIntentY = climbIntent;
        player.climbT = Math.min(10, player.climbT + 2);
        // ease the rendered body toward the wall angle so he hugs it. A soft
        // deadzone keeps lumpy near-vertical faces plumb; the cap keeps the tilt
        // a lean, not a recline.
        let leanGoal = 0;
        if (Math.abs(leanTarget) > CLIMB_LEAN_DEADZONE) {
          leanGoal = clamp(
            leanTarget - Math.sign(leanTarget) * CLIMB_LEAN_DEADZONE,
            -CLIMB_LEAN_MAX,
            CLIMB_LEAN_MAX,
          );
        }
        player.climbLean += (leanGoal - player.climbLean) * CLIMB_LEAN_EASE;
        // SNUG to the rock: the catch reach is lenient (up to 4 cells off the
        // face), and tryClimbStep nudges AWAY to find clearance — together they
        // leave him gripping air. Pull toward the wall each frame; climbClearance
        // stops him one cell off the surface, so he reads as actually holding on.
        for (let n = 0; n < CLIMB_SNUG_MAX; n++) {
          const nx = player.x + player.climbDir;
          if (
            !this.climbClearance(ctx, nx, player.y, player.climbDir, PLAYER_H).ok ||
            !this.hasClimbFaceAt(ctx, player.climbDir, PLAYER_H, nx, player.y)
          )
            break;
          player.x = nx;
        }
        player.wallGrabDir = player.climbDir;
        player.wallGrabT = 10;
        player.facing = -player.climbDir;
        player.grounded = false;
        player.vx = 0;
        player.vy = 0;
        player.fx = 0;
        player.fy = 0;
        player.diveT = 0;
        player.firing = false;
        ctx.input.siphonHeld = ctx.input.pourHeld = ctx.input.drinkHeld = false;

        if (climbIntent !== 0) {
          // accumulate fractional cells-per-frame; a whole cell of progress = one step
          player.climbMoveT += climbIntent < 0 ? CLIMB_RATE_UP : CLIMB_RATE_DOWN;
          if (player.climbMoveT >= 1) {
            player.climbMoveT -= 1;
            if (this.tryClimbStep(ctx, climbIntent)) {
              player.climbPhase = (player.climbPhase + 1) % 24;
              player.hat.vy += climbIntent < 0 ? -0.35 : 0.25;
              if (ctx.state.frameCount % 8 === 0) {
                ctx.particles.spawn(
                  player.x + player.climbDir * (PLAYER_HALF_W + 1),
                  player.y - 7 - Math.random() * 7,
                  -player.climbDir * (0.15 + Math.random() * 0.25),
                  0.15 + Math.random() * 0.25,
                  null,
                  packRGB(118, 111, 98),
                  14,
                  { grav: 0.06 },
                );
              }
            } else if (climbIntent < 0) {
              // can't climb higher — if a landing is in reach, pull up onto it
              this.tryMantle(ctx);
            }
          }
        } else {
          player.climbMoveT = 0;
        }
        this.levitFrames = 0;
        this.framesSinceGrounded++;
        handledByClimb = true;
      }
    }
    if (!player.climbing) {
      player.climbT = Math.max(0, player.climbT - 2);
      player.climbIntentY = 0;
      player.climbLean *= 0.7; // relax back to plumb after letting go
    }

    if (!handledByClimb) {
      // Gravity / levitation
      const grav = player.inLiquid ? 0.12 : 0.28;
      player.vy += grav;
      if (player.inLiquid) player.vy *= 0.88;

      let levitating = false;
      if (keys.jump && !player.crawling) {
        // coyote time: a press within 6 frames of walking off a ledge still gets the full jump
        const coyote = jumpPressed && this.framesSinceGrounded <= 6;
        if (player.grounded || player.inLiquid || coyote) {
          player.vy = -3.7;
          player.grounded = false;
          player.stretchT = 6; // launch stretch (anti-squash)
          this.framesSinceGrounded = 99; // consumed — no double coyote jumps
          this.jumpBufferFrames = 0;
          this.jumpRiseFrames = lp.jumpHoldWindow; // arm the cuttable ballistic rise
          this.jumpCutGraceFrames = supportedByRigidBody && !supportedByTerrain ? 4 : 0;
          ctx.audio.jump();
        } else if (player.levit > 0 && player.diveT === 0 && this.jumpRiseFrames <= 0) {
          levitating = true;
          // levitation response: the jet SPOOLS. Thrust starts at a near-hover
          // levitThrust0 (gravity is 0.28 — the first frames barely arrest the
          // fall) and builds t-CUBED to full over levitRampFrames, so a tap
          // feathers your height and a hold winds up into a climb. Releasing
          // resets the spool (levitFrames), which is what makes tapping a hover
          // instrument instead of an on/off rocket. The per-frame levitDrag is
          // the load-bearing bit: it makes climb speed ASYMPTOTE to a comfy
          // terminal (~3.3) instead of accumulating linearly into the cap, and
          // also damps a fall you catch mid-air. Apply it EVERY frame (the
          // simulated curve depends on the drag hitting positive vy too).
          const t = Math.min(this.levitFrames / lp.levitRampFrames, 1);
          const thrust = lp.levitThrust0 + lp.levitThrustGain * t * t * t;
          player.vy -= thrust;
          player.vy *= lp.levitDrag;
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
      // Variable jump height: count down the ballistic window; if jump is let go
      // mid-rise, cut the climb short (a low hop to land on a crate). At the apex
      // there's nothing left to cut, so close the window (the jet may take over).
      if (this.jumpRiseFrames > 0) {
        this.jumpRiseFrames--;
        if (player.vy >= 0) this.jumpRiseFrames = 0;
        else if (!keys.jump) {
          if (this.jumpCutGraceFrames > 0) {
            this.jumpCutGraceFrames--;
          } else {
            player.vy *= lp.jumpCut;
            this.jumpRiseFrames = 0;
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
        !player.crawling && // S held off a ledge keeps the crawl, never a slam
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
      // dive overrides the normal terminal velocity (5.0). The up-cap is a pure
      // safety net (levitDrag settles the climb well under it); keep it ≤ -3.7
      // so it never clips the jump impulse.
      player.vy = clamp(player.vy, ctx.params.player.vyCapUp, player.diveT > 0 ? 6.4 : 5.0);

      // Move horizontally (sub-cell accumulator; step-up 5 standing, 2 crawling)
      player.fx += player.vx;
      while (player.fx >= 1) {
        // stepUp climbs floor lips; PLAYER_CEIL_SLIP ducks under a ceiling that
        // steps down in the travel direction (else a tiny lip pins the slide).
        if (!ctx.physics.tryMoveEntity(player, 1, 0, PLAYER_HALF_W, bodyH, stepUp, PLAYER_CEIL_SLIP)) {
          player.vx = 0;
          player.fx = 0;
          break;
        }
        player.fx -= 1;
      }
      while (player.fx <= -1) {
        if (!ctx.physics.tryMoveEntity(player, -1, 0, PLAYER_HALF_W, bodyH, stepUp, PLAYER_CEIL_SLIP)) {
          player.vx = 0;
          player.fx = 0;
          break;
        }
        player.fx += 1;
      }

      // Move vertically
      player.fy += player.vy;
      while (player.fy >= 1) {
        if (!ctx.physics.tryMoveEntity(player, 0, 1, PLAYER_HALF_W, bodyH, 0)) {
          player.vy = 0;
          player.fy = 0;
          break;
        }
        player.fy -= 1;
      }
      while (player.fy <= -1) {
        // Rising: allow a lateral slip so a small wall nub can't pin a climb up
        // a tunnel (the vertical mirror of the run's stepUp over floor debris).
        if (!ctx.physics.tryMoveEntity(player, 0, -1, PLAYER_HALF_W, bodyH, 0, PLAYER_VERT_SLIP)) {
          player.vy = 0;
          player.fy = 0;
          break;
        }
        player.fy += 1;
      }
      // A committed dive that spears a foe's crown stomps it (Mario-style) and
      // bounces off — gated on diveT so only a real STOMP kills, never an idle
      // fall onto a foe (that still trades contact damage as before).
      if (player.diveT > 0) this.tryStompEnemy(ctx);
      if (ctx.state.frameCount % 3 === 0) this.glintNearbyOre(ctx); // discovery gleam on lit ore
      player.grounded =
        !ctx.physics.entityFree(player.x, player.y + 1, PLAYER_HALF_W, 1) ||
        this.supportedByRigidBody(ctx, bodyH);
      if (player.grounded) {
        // jump buffer: a press made just before touchdown fires on the landing frame
        if (this.jumpBufferFrames > 0 && !player.crawling) {
          player.vy = -3.7;
          player.grounded = false;
          player.fallPeak = 0; // this landing was consumed by the jump
          player.stretchT = 6;
          this.jumpBufferFrames = 0;
          this.framesSinceGrounded = 99;
          this.jumpCutGraceFrames = 0;
          ctx.audio.jump();
        } else {
          this.framesSinceGrounded = 0; // coyote time anchor
        }
      } else {
        this.framesSinceGrounded++;
      }
    }

    // ---- WALL GRAB (bouldering): "grounded" on nothing but the lip of a
    // cliff — the only support under the 9-wide feet row sits at the body's
    // edge, with a rock face rising beside it. Pose state ONLY: the
    // pixel-catch mechanic that lets him cling and climb is untouched.
    let grabSide = 0;
    if (player.grounded && !player.crawling && !player.inLiquid && player.pullT === 0) {
      let center = false,
        leftEdge = false,
        rightEdge = false;
      const fy = player.y + 1;
      for (let dx = -4; dx <= 4; dx++) {
        const X = player.x + dx;
        if (X < 0 || X >= WIDTH || fy >= HEIGHT) {
          center = true; // the world border is a floor, not a hold
          break;
        }
        if (!ctx.physics.cellBlocks(X, fy)) continue;
        if (dx <= -3) leftEdge = true;
        else if (dx >= 3) rightEdge = true;
        else {
          center = true;
          break;
        }
      }
      if (!center && leftEdge !== rightEdge) {
        const side = leftEdge ? -1 : 1;
        // a face worth gripping: solid rock beside the body through its height
        let face = 0;
        for (let dy = 1; dy <= 15; dy += 2) {
          const X = player.x + side * 5,
            Y = player.y - dy;
          if (world.inBounds(X, Y) && blocksEntity(world.types[world.idx(X, Y)])) face++;
        }
        if (face >= 3) grabSide = side;
      }
    }
    if (player.climbing) {
      player.wallGrabDir = player.climbDir;
      player.wallGrabT = 10;
    } else if (grabSide !== 0) {
      player.wallGrabDir = grabSide;
      player.wallGrabT = Math.min(10, player.wallGrabT + 2);
    } else {
      // slow decay: the airborne beats of a hand-over-hand climb keep the pose
      player.wallGrabT = Math.max(0, player.wallGrabT - 1);
    }

    // Aim and continuous fire (the shoulder rides at prone height in a crawl)
    player.aimAngle = Math.atan2(
      ctx.input.mouse.y - (player.y - (player.crawling ? 4 : 9)),
      ctx.input.mouse.x - player.x,
    );
    if (Math.cos(player.aimAngle) !== 0) player.facing = Math.cos(player.aimAngle) >= 0 ? 1 : -1;
    // Absorb glowing goo: slime residue heals on contact
    if (player.hp < player.maxHp) {
      let absorbed = 0;
      outerGoo: for (let dy = 0; dy < bodyH; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const gx = Math.floor(player.x) + dx,
            gy = Math.floor(player.y) - dy;
          if (!world.inBounds(gx, gy) || world.types[world.idx(gx, gy)] !== Cell.Slime) continue;
          const gi = world.idx(gx, gy);
          world.clearCellAt(gi);
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
   * else nearby and reachable. 120-frame cooldown so a pool doesn't
   * strobe-teleport.
   */
  private randomTeleport(ctx: Ctx): void {
    const player = ctx.player;
    player.tpCool = 120;
    ctx.particles.burst(player.x, player.y - 8, 18, null, () => packRGB(185, 110, 255), 2.6, {
      glow: 2.4,
      grav: 0,
    });
    const target = this.safeTeleportTarget(ctx);
    if (!target) return;
    player.x = target.x;
    player.y = target.y;
    player.vx = 0;
    player.vy = 0;
    player.crawling = false; // the arrival spot fits the full stance
    this.resetClimbState(player);
    ctx.particles.burst(target.x, target.y - 8, 18, null, () => packRGB(185, 110, 255), 2.6, {
      glow: 2.4,
      grav: 0,
    });
    ctx.audio.tone(660, 1320, 0.18, 'sine', 0.18);
  }

  private safeTeleportTarget(ctx: Ctx): { x: number; y: number } | null {
    const { player, world } = ctx;
    const sx = Math.floor(player.x);
    const sy = Math.floor(player.y);
    if (!world.inBounds(sx, sy)) return null;

    const visited = new Uint8Array(world.types.length);
    const queue = new Int32Array(Math.min(world.types.length, TELEPORT_MAX_VISITED));
    const candidates: Array<{ x: number; y: number }> = [];
    let head = 0;
    let tail = 0;

    const enqueue = (x: number, y: number): void => {
      if (tail >= queue.length || !world.inBounds(x, y)) return;
      const dx = x - sx;
      const dy = y - sy;
      if (dx * dx + dy * dy > TELEPORT_SEARCH_RADIUS_SQ) return;
      const i = world.idx(x, y);
      if (visited[i]) return;
      if (tail > 0 && !ctx.physics.entityFree(x, y, PLAYER_HALF_W, PLAYER_H)) return;
      visited[i] = 1;
      queue[tail++] = i;
    };

    enqueue(sx, sy);
    while (head < tail && candidates.length < TELEPORT_MAX_CANDIDATES) {
      const i = queue[head++];
      const x = i % WIDTH;
      const y = Math.floor(i / WIDTH);
      if ((x !== sx || y !== sy) && this.isSafeTeleportLanding(ctx, x, y)) {
        candidates.push({ x, y });
      }
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private isSafeTeleportLanding(ctx: Ctx, x: number, y: number): boolean {
    if (!ctx.physics.entityFree(x, y, PLAYER_HALF_W, PLAYER_H)) return false;
    if (ctx.physics.entityFree(x, y + 1, PLAYER_HALF_W, 1)) return false;
    const world = ctx.world;
    for (let dy = 0; dy < PLAYER_H; dy += 2) {
      for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx += 2) {
        const sx = x + dx;
        const sy = y - dy;
        if (!world.inBounds(sx, sy)) return false;
        if (teleportHazardCell(world.types[world.idx(sx, sy)])) return false;
      }
    }
    return true;
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

    // Crawl sprite tilt: the body lies along the TERRAIN under it — sampled
    // floor-surface heights below nose and tail. (It used to follow the
    // travel velocity, which dies to horizontal the moment a lip stalls you
    // or you stop: a wizard lying flat ACROSS a 45-degree slope.) A floor
    // surface is a blocking cell with air above it, so a ceiling dipping
    // into the scan ahead can't hijack the read. World-space dy/dx; the
    // collision box stays an axis-aligned square — only the drawing tilts.
    let slopeTarget = 0;
    if (player.crawling) {
      const world = ctx.world;
      const floorAt = (col: number): number => {
        if (col < 1 || col >= WIDTH - 1) return NaN;
        for (let Y = player.y - 7; Y <= player.y + 9; Y++) {
          if (Y < 1 || Y >= HEIGHT) break;
          if (
            blocksEntity(world.types[world.idx(col, Y)]) &&
            !blocksEntity(world.types[world.idx(col, Y - 1)])
          )
            return Y;
        }
        return NaN;
      };
      const gFront = floorAt(Math.round(player.x + 6));
      const gRear = floorAt(Math.round(player.x - 6));
      slopeTarget =
        Number.isNaN(gFront) || Number.isNaN(gRear)
          ? player.crawlSlope // straddling a void or a dead end: hold the line
          : clamp((gFront - gRear) / 12, -1.1, 1.1);
    }
    player.crawlSlope += (slopeTarget - player.crawlSlope) * 0.18;

    // Stride wheel turns with actual ground speed; drifts slowly in the air.
    // Crawling, the wheel is the hand-over-hand cycle (hands beat faster
    // than boots at the same crawl speed).
    if (player.grounded && Math.abs(player._svx) > 0.2) {
      player.stridePhase += Math.abs(player._svx) * (player.crawling ? 0.3 : 0.16);
      // FOOTSTEPS: each half-turn of the wheel is a foot meeting the ground,
      // and the ground decides the sound — stone ticks, sand hushes, wood
      // knocks, shallows slosh.
      const step = Math.floor(player.stridePhase / Math.PI);
      if (step !== this.lastStrideStep) {
        this.lastStrideStep = step;
        if (player.crawling) {
          // hand-over-hand: a soft cloth shuffle, a pebble fleck at the hands
          ctx.audio.crawlShuffle();
          if (step % 2 === 0) {
            ctx.particles.spawn(
              player.x + player.facing * (3 + Math.floor(Math.random() * 2)),
              player.y,
              player.facing * 0.3,
              -0.25,
              null,
              packRGB(135, 128, 118),
              9,
              { grav: 0.07 },
            );
          }
        } else {
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
      }
    } else if (!player.grounded) player.stridePhase += 0.05;

    // Ceiling at exactly crawl gauge (solid at y-9): the hat scrapes along
    // it now and then, shedding grit — you HEAR how tight the squeeze is.
    if (
      player.crawling &&
      Math.abs(player._svx) > 0.3 &&
      Math.random() < 0.03 &&
      !ctx.physics.entityFree(player.x, player.y, 4, PLAYER_CRAWL_H + 1)
    ) {
      player.hat.vy += 0.5;
      ctx.particles.spawn(
        player.x + player.facing * 2,
        player.y - PLAYER_CRAWL_H + 1,
        -player.facing * 0.2,
        0.3,
        null,
        packRGB(128, 120, 106),
        12,
        { grav: 0.08 },
      );
    }

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
      ctx.events.emit('groundImpact', { x: player.x, y: player.y, radius: 54, strength: 1 });
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
            ws.clearCellAt(ci4);
            ctx.particles.spawn(X2, Y2, (dx2 / 4) * 1.4, -1.2 - Math.random(), t4, col4, 40, {
              grav: 0.12,
            });
            popped++;
          }
        }
      }
      // grounded foes near the impact get knocked off their feet
      for (const e of ctx.enemies.slice()) {
        if (!ctx.enemies.includes(e)) continue;
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
        const strength = clamp((player.fallPeak - 3.5) / 3.5, 0.25, 1);
        ctx.events.emit('groundImpact', { x: player.x, y: player.y, radius: 28 + strength * 28, strength });
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
    if (player.kickT > 0) player.kickT--;
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
      player.crouchT === 0 && // a crouch is a stance, not boredom
      player.crawlT === 0 &&
      player.wallGrabT < 5; // and hanging off a cliff is no time to fidget
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
