import type { FighterId } from '@/content/fighters';
import type { Ctx } from '@/core/types';
import { PLAYER_HALF_W } from '@/core/types';
import { fxRandom } from '@/core/simRandom';
import { punch } from '@/fighters/effects';
import type { FighterSystem } from '@/fighters/FighterSystem';
import { Cell, blocksEntity } from '@/sim/CellType';
import { emberColor, packRGB } from '@/sim/colors';

/**
 * THE TEN MOVEMENT TECHNIQUES (docs/arena/ROSTER-IDENTITY.md, copy in content/fighterTechniques). A technique is a fighter's own
 * way of getting around, built from the body (core/fighterBody) and the modifiers a fighter may run (`setMod`), plus a body-owning
 * move where it needs one (`startMove`). It reads the same keys a person presses (`ctx.input.keys`), so a bot drives it exactly
 * as a person does; it never writes a position, only the velocity the player's own physics then carries.
 *
 * Each runs once per fixed tick, after the player has moved (`FighterSystem.update`), and is thrown away on unequip. Numbers sit
 * in `TECH` (live-tunable data, like each kit's TUNING).
 */

export interface Technique {
  /** What it is doing right now ('idle' when nothing): the panel and the probes read it. */
  readonly state: string;
  /** Times it has fired since the fighter was equipped, and the frame of the last one. */
  readonly uses: number;
  readonly usedAt: number;
  tick(sys: FighterSystem): void;
  reset(): void;
}

export const TECH = {
  dash: { window: 14, ticks: 6, speed: 3.2, exit: 2.6, cost: 15, cooldown: 70, emberEvery: 2 },
  stomp: { cooldown: 50, radius: 22, radiusMore: 16, damage: 4, damageMore: 8, knock: 2.2, knockMore: 1.6, stun: 20, stunMore: 20, mass: 1.5, fullDive: 18 },
  cling: { budget: 100, slideGravity: 0.1, slideFall: 0.12, maxSlide: 0.55, kickX: 2.8, kickY: -3.6 },
  glide: { dry: 0.25, gravity: 0.22, fall: 0.3, airControl: 1.4, minFall: 0.4 },
  wallrun: { budget: 42, speed: 2.4, minSpeed: 2.0, vaultX: 2.2, vaultY: -2.6 },
  shadow: { concealment: 0.25, move: 1.25, air: 1.2 },
  hover: { rise: 1.1, burn: 0.45 },
  carry: { window: 14, minSpeed: 1.8, boost: 1.12, cap: 4.8 },
  skid: { minSpeed: 1.6, every: 2, budget: 40 },
  root: { cells: 5, move: 1.5, climb: 1.5, friction: 0.7 },
} as const;

// ---- shared helpers (pure where they can be: the decisions are unit-tested without a world) ----

/** A rising edge of a key, tracked between ticks. */
export class Edge {
  private prev = false;
  /** True on the tick `now` is down and last tick's was up. */
  rise(now: boolean): boolean {
    const r = now && !this.prev;
    this.prev = now;
    return r;
  }
  reset(): void { this.prev = false; }
}

/** Two rising edges of the SAME direction within `window` ticks: a double tap. */
export class DoubleTap {
  private lastDir = 0;
  private lastAt = -1e9;
  /** Feed the press (-1, 0 or +1, a rising edge only) at tick `now`; returns the direction when this press completes a double tap. */
  press(dir: number, now: number, window: number): number {
    if (dir === 0) return 0;
    const hit = dir === this.lastDir && now - this.lastAt <= window;
    this.lastDir = dir;
    this.lastAt = now;
    if (hit) { this.lastDir = 0; return dir; }
    return 0;
  }
  reset(): void { this.lastDir = 0; this.lastAt = -1e9; }
}

/** The direction a pair of keys asks for: -1, 0, +1 (both down is 0). */
export function keyDir(left: boolean, right: boolean): number {
  return left === right ? 0 : left ? -1 : 1;
}

function solidAt(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  return w.inBounds(x, y) && blocksEntity(w.types[w.idx(x, y)]);
}

/** Is there a wall hard against the body on side `dir`? Two of three samples up the body, so a lip does not count. */
export function wallOn(ctx: Ctx, dir: number): boolean {
  if (dir === 0) return false;
  const p = ctx.player;
  const x = Math.round(p.x) + dir * (PLAYER_HALF_W + 1);
  let n = 0;
  for (const h of [4, 9, 14]) if (solidAt(ctx, x, Math.round(p.y) - h)) n++;
  return n >= 2;
}

function airborne(ctx: Ctx): boolean {
  const p = ctx.player;
  return !p.grounded && !p.climbing && !p.inLiquid;
}

function emptyAt(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  return w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Empty;
}

function putEmber(ctx: Ctx, x: number, y: number): boolean {
  if (!emptyAt(ctx, x, y)) return false;
  const w = ctx.world;
  const i = w.idx(x, y);
  w.replaceCellAt(i, Cell.Ember, emberColor());
  return true;
}

abstract class Base implements Technique {
  state = 'idle';
  uses = 0;
  usedAt = -1;
  abstract tick(sys: FighterSystem): void;
  reset(): void { this.state = 'idle'; }
  protected fired(sys: FighterSystem): void {
    this.uses++;
    this.usedAt = sys.ctx.state.frameCount;
  }
}

// ======================================================================================== Ilyra: Cinder Dash

class CinderDash extends Base {
  private readonly tap = new DoubleTap();
  private readonly l = new Edge();
  private readonly r = new Edge();
  private cd = 0;

  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, k = ctx.input.keys, T = TECH.dash, now = ctx.state.frameCount;
    if (this.cd > 0) this.cd--;
    const press = this.l.rise(k.left) ? -1 : this.r.rise(k.right) ? 1 : 0;
    const dir = this.tap.press(press, now, T.window);
    this.state = sys.ownsMovement ? 'dashing' : this.cd > 0 ? 'recovering' : 'idle';
    if (!dir || this.cd > 0 || sys.ownsMovement || !airborne(ctx) || p.levit < T.cost) return;
    p.levit -= T.cost;
    this.cd = T.cooldown;
    this.fired(sys);
    this.state = 'dashing';
    let step = 0;
    sys.startMove({
      ticks: T.ticks,
      face: true,
      exitVx: dir * T.exit,
      exitVy: 0,
      step: () => ({ dx: dir * T.speed, dy: 0 }),
      onStep: () => {
        if (++step % T.emberEvery === 0) putEmber(ctx, Math.round(p.x - dir * 5), Math.round(p.y - 5 + (step % 2 ? 1 : -1)));
        if (step % 2 === 0) ctx.particles.spawn(p.x - dir * 4, p.y - 6, -dir * 0.5, -0.1, null, packRGB(255, 150 + ((fxRandom() * 70) | 0), 40), 14, { glow: 1.6, grav: 0.01 });
      },
    });
    ctx.audio.sfx('player.dive');
  }

  override reset(): void { super.reset(); this.tap.reset(); this.l.reset(); this.r.reset(); this.cd = 0; }
}

// ======================================================================================== Brann: Piston Stomp

class PistonStomp extends Base {
  private diving = false;
  private diveTicks = 0;
  private cd = 0;

  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, T = TECH.stomp;
    if (this.cd > 0) this.cd--;
    const diving = p.diveT > 0;
    if (diving) {
      // A plunge is heavy: nothing shoves him off the line.
      sys.setMod('piston', 3, { mass: T.mass });
      this.diveTicks = p.diveT;
      this.state = 'plunging';
    } else if (this.state === 'plunging') this.state = 'idle';
    if (this.diving && !diving && p.grounded && this.cd <= 0) this.land(sys, Math.min(1, this.diveTicks / T.fullDive));
    this.diving = diving;
  }

  private land(sys: FighterSystem, power: number): void {
    const ctx = sys.ctx, p = ctx.player, T = TECH.stomp;
    this.cd = T.cooldown;
    this.fired(sys);
    this.state = 'stomp';
    const radius = T.radius + T.radiusMore * power;
    for (const e of [...sys.enemiesNear(p.x, p.y - 4, radius)]) {
      const side = e.x >= p.x ? 1 : -1;
      sys.hurt(e, T.damage + T.damageMore * power, side * (T.knock + T.knockMore * power), -1.4);
      sys.stunEnemy(e, Math.round(T.stun + T.stunMore * power));
    }
    // The piston's own report: a hard ring of grit along the floor and a jolt.
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        ctx.particles.spawn(p.x + dir * (3 + i * 2), p.y - 1, dir * (1.2 + fxRandom() * 1.4), -0.6 - fxRandom() * 0.8, null, packRGB(190 + ((fxRandom() * 50) | 0), 185, 170), 16, { grav: 0.07 });
      }
    }
    ctx.events.emit('groundImpact', { x: p.x, y: p.y, radius: radius + 20, strength: 0.6 + 0.4 * power });
    punch(ctx, 0.03 + 0.02 * power, 0.25);
  }

  override reset(): void { super.reset(); this.diving = false; this.diveTicks = 0; this.cd = 0; }
}

// ======================================================================================== Sable: Wall-cling

class WallCling extends Base {
  private budget: number = TECH.cling.budget;
  private clingDir = 0;
  private readonly jumpEdge = new Edge();

  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, k = ctx.input.keys, T = TECH.cling;
    const jumped = this.jumpEdge.rise(k.jump);
    if (p.grounded || p.inLiquid) this.budget = T.budget;
    const dir = keyDir(k.left, k.right);
    const clinging = airborne(ctx) && !sys.ownsMovement && dir !== 0 && wallOn(ctx, dir) && p.vy > 0.05 && this.budget > 0;
    if (clinging) {
      if (this.clingDir !== dir) this.fired(sys);
      this.clingDir = dir;
      this.budget--;
      sys.setMod('cling', 3, { gravity: T.slideGravity, fall: T.slideFall });
      p.vx = 0;
      if (p.vy > T.maxSlide) p.vy = T.maxSlide;
      this.state = 'clinging';
      if (ctx.state.frameCount % 5 === 0) ctx.particles.spawn(p.x + dir * 4, p.y - 6, -dir * 0.2, 0.2, null, packRGB(160, 175, 140), 10, { grav: 0.02 });
      if (jumped) this.kick(sys, dir);
      return;
    }
    if (this.state === 'clinging') this.state = 'idle';
    this.clingDir = 0;
  }

  /** Off the wall: away from it and up. Not a new fall: the clock keeps what is left. */
  private kick(sys: FighterSystem, dir: number): void {
    const p = sys.ctx.player, T = TECH.cling;
    p.vx = -dir * T.kickX;
    p.vy = T.kickY;
    p.facing = (-dir) as 1 | -1;
    this.state = 'kick';
    sys.clearMod('cling');
  }

  override reset(): void { super.reset(); this.budget = TECH.cling.budget; this.clingDir = 0; this.jumpEdge.reset(); }
}

// ======================================================================================== Mara: Glide

class Glide extends Base {
  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, k = ctx.input.keys, T = TECH.glide;
    const dry = p.levit <= p.maxLevit * T.dry;
    const gliding = airborne(ctx) && !sys.ownsMovement && k.jump && p.vy > T.minFall && dry;
    if (gliding) {
      if (this.state !== 'gliding') this.fired(sys);
      this.state = 'gliding';
      sys.setMod('glide', 3, { gravity: T.gravity, fall: T.fall, airControl: T.airControl });
      if (p.vy > 5 * T.fall) p.vy = 5 * T.fall;
      if (ctx.state.frameCount % 4 === 0) ctx.particles.spawn(p.x, p.y - 12, (fxRandom() - 0.5) * 0.4, -0.15, null, packRGB(190, 170, 235), 14, { glow: 1.4, grav: -0.005 });
    } else if (this.state === 'gliding') { this.state = 'idle'; sys.clearMod('glide'); }
  }
}

// ======================================================================================== Kest: Wall-run

class WallRun extends Base {
  private budget: number = TECH.wallrun.budget;
  private run = 0;
  private running = false;
  private dir = 0;

  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, k = ctx.input.keys, T = TECH.wallrun;
    this.run = Math.max(Math.abs(p.vx), this.run * 0.9);
    if (p.grounded && !wallOn(ctx, keyDir(k.left, k.right))) this.budget = T.budget;
    const dir = keyDir(k.left, k.right);
    const wall = dir !== 0 && wallOn(ctx, dir);
    const go = wall && k.jump && this.budget > 0 && !p.climbing && !p.inLiquid && !sys.ownsMovement && (this.running || this.run >= T.minSpeed);
    if (go) {
      if (!this.running) this.fired(sys);
      this.running = true;
      this.dir = dir;
      this.budget--;
      p.vy = -T.speed;
      p.vx = 0;
      p.grounded = false;
      // The wall does the lifting: the jet that a held jump would light burns nothing while he runs.
      sys.setMod('wallrun', 3, { jetBurn: 0 });
      this.state = 'wallrun';
      if (ctx.state.frameCount % 3 === 0) ctx.particles.spawn(p.x + dir * 4, p.y - 2, -dir * 0.3, 0.3, null, packRGB(150, 150, 140), 10, { grav: 0.03 });
      if (this.budget === 0) this.vault(sys);
      return;
    }
    if (this.running) {
      // Let go early, the wall ends or the run is spent: a vault only if there is still push in it.
      if (this.budget <= 0 || !k.jump) this.vault(sys);
      this.running = false;
    }
    if (this.state === 'wallrun') this.state = 'idle';
  }

  private vault(sys: FighterSystem): void {
    const p = sys.ctx.player, T = TECH.wallrun;
    p.vx = -this.dir * T.vaultX;
    p.vy = T.vaultY;
    p.facing = (-this.dir) as 1 | -1;
    this.running = false;
    this.state = 'vault';
  }

  override reset(): void { super.reset(); this.budget = TECH.wallrun.budget; this.run = 0; this.running = false; }
}

// ======================================================================================== Nox: Shadow-step

class ShadowStep extends Base {
  tick(sys: FighterSystem): void {
    const T = TECH.shadow;
    const hidden = sys.concealment() >= T.concealment;
    if (hidden) {
      if (this.state !== 'shadow') this.fired(sys);
      this.state = 'shadow';
      sys.setMod('shadowstep', 3, { moveScale: T.move, airControl: T.air });
    } else if (this.state === 'shadow') { this.state = 'idle'; sys.clearMod('shadowstep'); }
  }
}

// ======================================================================================== Edda: Hover

class Hover extends Base {
  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, k = ctx.input.keys, T = TECH.hover;
    if (p.levitating && airborne(ctx) && !sys.ownsMovement) {
      if (this.state !== 'hovering') this.fired(sys);
      this.state = 'hovering';
      sys.setMod('hover', 3, { jetBurn: T.burn });
      // Up and jump together: hold the height. Jump alone: a gentle rise.
      if (k.up) p.vy *= 0.35;
      else if (p.vy < -T.rise) p.vy = -T.rise;
      if (ctx.state.frameCount % 6 === 0) ctx.particles.spawn(p.x + (fxRandom() - 0.5) * 6, p.y - 16, 0, -0.1, null, packRGB(255, 232, 150), 16, { glow: 1.8, grav: -0.004 });
    } else if (this.state === 'hovering') { this.state = 'idle'; sys.clearMod('hover'); }
  }
}

// ======================================================================================== Selene: Carry

class Carry extends Base {
  private landedAt = -1e9;
  private landVx = 0;
  private wasGrounded = true;

  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, T = TECH.carry, now = ctx.state.frameCount;
    const grounded = p.grounded === true;
    if (grounded && !this.wasGrounded) { this.landedAt = now; this.landVx = Math.abs(p.vx); }
    // The launch of a jump: she was on the ground a tick ago and is rising fast now.
    if (!grounded && this.wasGrounded && p.vy < -2.5 && now - this.landedAt <= T.window && this.landVx >= T.minSpeed) {
      const dir = p.vx !== 0 ? Math.sign(p.vx) : p.facing;
      const speed = Math.min(T.cap, Math.max(Math.abs(p.vx), this.landVx * 0.95) * T.boost);
      p.vx = dir * speed;
      this.fired(sys);
      this.state = 'carry';
      for (let i = 0; i < 4; i++) ctx.particles.spawn(p.x - dir * 3, p.y - 1, -dir * (0.5 + fxRandom() * 0.6), -0.2, null, packRGB(190, 215, 255), 12, { glow: 1.5, grav: 0.01 });
    } else if (grounded && this.state === 'carry') this.state = 'idle';
    this.wasGrounded = grounded;
  }

  override reset(): void { super.reset(); this.landedAt = -1e9; this.landVx = 0; this.wasGrounded = true; }
}

// ======================================================================================== Rusk: Skid

class Skid extends Base {
  private ticks = 0;
  private budget = 0;
  /** Last tick's speed: the player's own stop has already eaten most of it by the time this runs. */
  private prevVx = 0;

  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, k = ctx.input.keys, T = TECH.skid;
    const dir = keyDir(k.left, k.right);
    const was = this.prevVx;
    this.prevVx = p.vx;
    const moving = Math.abs(was) >= T.minSpeed;
    // Braking: letting go of a run, or asking for the other way, at speed on the ground.
    const braking = p.grounded && moving && !sys.ownsMovement && (dir === 0 || dir !== Math.sign(was));
    if (braking && this.budget < T.budget) {
      if (this.state !== 'skid') this.fired(sys);
      this.state = 'skid';
      this.budget++;
      if (this.ticks++ % T.every === 0) {
        const behind = -Math.sign(was);
        putEmber(ctx, Math.round(p.x + behind * 2 + (fxRandom() - 0.5) * 3), Math.round(p.y - 1));
        ctx.particles.spawn(p.x + behind * 2, p.y - 1, behind * 0.6, -0.5, null, packRGB(255, 160 + ((fxRandom() * 60) | 0), 40), 12, { glow: 1.8, grav: 0.05 });
      }
    } else {
      if (this.state === 'skid') this.state = 'idle';
      if (p.grounded && !moving) this.budget = 0;
    }
  }

  override reset(): void { super.reset(); this.ticks = 0; this.budget = 0; this.prevVx = 0; }
}

// ======================================================================================== Thorne: Root-walk

const GROWTH: ReadonlySet<number> = new Set<number>([Cell.Moss, Cell.Vines, Cell.Leaf, Cell.Trunk, Cell.Grass]);

class RootWalk extends Base {
  tick(sys: FighterSystem): void {
    const ctx = sys.ctx, p = ctx.player, T = TECH.root;
    const w = ctx.world;
    let n = 0;
    const cx = Math.round(p.x), cy = Math.round(p.y);
    for (let y = cy - 8; y <= cy + 1 && n < T.cells; y++) {
      for (let x = cx - 5; x <= cx + 5; x++) if (w.inBounds(x, y) && GROWTH.has(w.types[w.idx(x, y)])) n++;
    }
    if (n >= T.cells) {
      if (this.state !== 'rooted') this.fired(sys);
      this.state = 'rooted';
      sys.setMod('rootwalk', 4, { moveScale: T.move, friction: T.friction, climbScale: T.climb });
    } else if (this.state === 'rooted') { this.state = 'idle'; sys.clearMod('rootwalk'); }
  }
}

// ======================================================================================== the registry

const MAKE: Readonly<Record<FighterId, () => Technique>> = {
  'ilyra-voss': () => new CinderDash(),
  'brann-rook': () => new PistonStomp(),
  'sable-fen': () => new WallCling(),
  'mara-quell': () => new Glide(),
  'kest-rel': () => new WallRun(),
  'nox-calder': () => new ShadowStep(),
  'edda-morrow': () => new Hover(),
  'selene-wraith': () => new Carry(),
  'rusk-emberjaw': () => new Skid(),
  'father-thorne': () => new RootWalk(),
};

/** A fresh technique for a fighter (null for the classic Alchemist). */
export function techniqueFor(id: FighterId | null): Technique | null {
  return id ? MAKE[id]() : null;
}
