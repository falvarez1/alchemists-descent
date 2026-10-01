import { fxRandom } from '@/core/simRandom';
import type { AuthoredLight, Ctx, Projectile } from '@/core/types';
import { punch } from '@/fighters/effects';
import type { FighterSystem } from '@/fighters/FighterSystem';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import {
  GLASS_HEX, GOLD_HEX, PANE_HEX, SHARD_TRAIL, drawRoseWindow, drawShard, drawShimmer, newShardView, newWindowView,
} from '@/fighters/kits/edda-morrow-glass';
import type { WindowView } from '@/fighters/kits/edda-morrow-glass';
import {
  StoredLight, TUNING, allyTargets, chooseAlly, healed, newShardPose, overshieldGain, refract, shardPose, windowLook, within,
} from '@/fighters/kits/edda-morrow-logic';
import type { AllyBody, Refraction, ShardPose } from '@/fighters/kits/edda-morrow-logic';

export { TUNING, allyTargets } from '@/fighters/kits/edda-morrow-logic';

/**
 * EDDA MORROW, the Glass Saint (Support): docs/FIGHTERS.md "07" and docs/fighters/edda-morrow.md.
 *
 *  - Stored Light (passive): an armor pool of 30 that starts empty and does not refill by itself. Every
 *    consumable she uses (a drink from the flask, a potion lifted off the floor) grants +12 overshield with
 *    a gold glint; the pool absorbs damage before health (FighterSystem.reduceIncoming).
 *  - Mercy Shard (Z): a floating shard of glass is sent to an ally and grants x0.6 incoming damage for 6 s.
 *    Solo the ally is herself: it flies out along the aim, curls back and settles into an orbit. Who it can
 *    go to is `allyTargets(ctx)`, so the arena mode can add peers.
 *  - Rose Window (T): a stationary stained-glass window stands at her feet for 10 s. Within 60 cells it
 *    heals her 4 hp/s and TURNS hostile shots that enter its radius (the velocity is rotated away from the
 *    prism, the shot lives on). It dims, cracks and shatters at the end.
 *
 * The kit writes no cell at all (its glass is drawn, its light is an authored light), so nothing it does can
 * seal a route.
 */

const MERCY_MOD = 'mercy-shard';

class EddaMorrow implements KitInstance {
  private readonly stored = new StoredLight();
  private readonly offEvents: Array<() => void>;

  // ---- the passive ----
  private dropShimmer: (() => void) | null = null;
  private armorSeen = 0;

  // ---- Mercy Shard (public so the probe can read where the shard is) ----
  readonly shardView = newShardView();
  shard: { target: AllyBody; age: number; aim: number; light: AuthoredLight | null; settled: boolean } | null = null;
  private readonly pose: ShardPose = newShardPose();
  /** The shard has one drawable behind her and one in front of her (it goes round her); see shardBehind. */
  private dropShard: Array<() => void> = [];

  // ---- Rose Window (public likewise) ----
  win: {
    world: Ctx['world'];
    x: number;
    cy: number;
    view: WindowView;
    state: 'live' | 'breaking';
    /** What the system last told us was left (1 on the last tick of a full run). */
    remaining: number;
    light: AuthoredLight | null;
    healing: boolean;
  } | null = null;
  private dropWin: (() => void) | null = null;
  private readonly turn: Refraction = { vx: 0, vy: 0, turned: 0 };
  private lastRefractFx = -99;
  private lastBlowFx = -99;
  /** Scratch point: the engine's hooks are allocation-free, so read it at once and never keep it. */
  private readonly at = { x: 0, y: 0 };

  constructor(private readonly sys: FighterSystem) {
    this.holdPassive();
    const events = sys.ctx.events;
    // (The system's own handlers for these were registered first, so by the time ours runs the pool has been emptied: that is not a blow.)
    const rebase = (): void => { this.armorSeen = this.sys.armor; };
    this.offEvents = [
      events.on('flaskUsed', (e) => this.onFlask(e.verb, e.material, e.amount)),
      events.on('playerRespawned', rebase),
      events.on('playerDeathCleared', rebase),
    ];
  }

  private get ctx(): Ctx {
    return this.sys.ctx;
  }

  private chest(): { x: number; y: number } {
    const p = this.ctx.player;
    this.at.x = p.x;
    this.at.y = p.y - (p.crawling ? 4 : 9);
    return this.at;
  }

  private sparks(x: number, y: number, count: number, speed: number, angle: number, spread: number, colors: readonly number[], life = 24, radius = 1.5): void {
    this.ctx.sparks?.burst(x, y, { count, speed, angle, spread, colors, kind: 'spark', glow: 1.3, radius, life });
  }

  // ======================================================================== Stored Light

  /**
   * The pool's ceiling is re-asserted every tick: equipping resets it after a cached kit has been created, and a
   * restored save may name more armor than she can carry (the system clamps it only against its own, wider, bound).
   */
  private holdPassive(): void {
    const max = TUNING.stored.armorMax;
    if (this.sys.armorMax !== max || this.sys.armor > max) this.sys.setArmorMax(max);
  }

  /**
   * A consumable was used. `flaskUsed` with verb 'drink' is a sip of the flask (one a tick while X is held, so a
   * whole drink is one use, see StoredLight) or, with no material, a potion taken off the floor (always one use).
   */
  private onFlask(verb: string, material: number | null, amount: number): void {
    if (verb !== 'drink') return;
    const ctx = this.ctx;
    if (ctx.player.dead || ctx.state.mode !== 'play') return;
    const now = ctx.state.frameCount;
    const potion = material === null;
    if (!potion && !(amount > 0)) return;
    if (!potion && !this.stored.sip(now)) return;
    this.holdPassive();
    const T = TUNING.stored;
    const gain = overshieldGain(this.sys.armor, this.sys.armorMax, T.perUse);
    if (gain <= 0) return; // a full pool takes nothing and the glass is not spent
    this.sys.addArmor(gain);
    this.armorSeen = this.sys.armor;
    if (!potion) this.stored.spent(now);
    this.glint(gain);
  }

  /** The gold glint: a ring of light leaves her chest, sparks rise, a chime, a warm flash and a line over her head. */
  private glint(gain: number): void {
    const ctx = this.ctx, p = ctx.player, c = this.chest();
    const x = c.x, y = c.y;
    this.sparks(x, y - 2, 26, 1.5, -Math.PI / 2, 1.2, GOLD_HEX, 30, 3);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ctx.particles.spawn(x + Math.cos(a) * 3, y + Math.sin(a) * 5, Math.cos(a) * 0.75, Math.sin(a) * 0.75 - 0.1, null, GOLD_HEX[i % GOLD_HEX.length], 20, { glow: 2, grav: -0.004 });
    }
    ctx.audio.sfx('pickup.bell', p.x, p.y, { gain: 0.7, pitch: 6 });
    ctx.audio.sfx('player.heal', p.x, p.y, { gain: 0.5, pitch: 4 });
    this.sys.addLight(x, y, { rgb: [1, 0.84, 0.45], intensity: 1.0, radius: 36, bloom: 0.9, flicker: 0 }, 12);
    this.sys.callout(`+${Math.round(gain)} STORED LIGHT`);
    punch(ctx, 0.006, 0.18);
  }

  /** Overshield that was just struck away: a scatter of gold, a ping, and a crack when the last of it goes. */
  private watchArmor(): void {
    const a = this.sys.armor;
    const lost = this.armorSeen - a;
    this.armorSeen = a;
    if (lost < 0.4) return;
    const ctx = this.ctx, p = ctx.player, c = this.chest();
    this.sparks(c.x, c.y - 2, Math.min(18, Math.round(5 + lost)), 1.5, -Math.PI / 2, Math.PI, GOLD_HEX, 20, 3);
    ctx.audio.sfx('pickup.bell', p.x, p.y, { gain: 0.4, pitch: -3 });
    if (a <= 0.01) ctx.audio.sfx('mat.shatter', p.x, p.y, { gain: 0.5, pitch: 4 });
  }

  private stepShimmer(): void {
    const sys = this.sys;
    if (sys.armor > 0.5 && !this.dropShimmer) {
      this.dropShimmer = sys.addDrawable({ layer: 'over', draw: (out, field, ctx) => drawShimmer(out, field, ctx, sys.armor / TUNING.stored.armorMax) });
    } else if (sys.armor <= 0.5 && this.dropShimmer) {
      this.dropShimmer();
      this.dropShimmer = null;
    }
  }

  // ======================================================================== the tick

  tick(): void {
    this.holdPassive();
    this.stepShimmer();
    this.watchArmor();
    this.stepShard();
    this.stepWindow();
  }

  // ======================================================================== Mercy Shard

  /** The ally's chest this tick (a peer is looked up afresh; the fighter herself is read from the player). */
  private whereIs(a: AllyBody): { x: number; y: number } {
    if (a.self) return this.chest();
    const live = allyTargets(this.ctx).find((b) => b.id === a.id) ?? a;
    this.at.x = live.x;
    this.at.y = live.y;
    return this.at;
  }

  private grant(target: AllyBody): void {
    const T = TUNING.shard;
    if (target.grant) target.grant(T.duration, T.damageTaken);
    else if (target.self) this.sys.setMod(MERCY_MOD, T.duration, { damageTaken: T.damageTaken });
  }

  tactical(): boolean {
    const sys = this.sys, ctx = this.ctx, p = ctx.player, T = TUNING.shard;
    const c = this.chest();
    const fx = c.x, fy = c.y;
    const target = chooseAlly(allyTargets(ctx), fx, fy, p.aimAngle);
    if (!target) return false;
    this.endShard(false);
    this.grant(target);
    const aim = p.aimAngle;
    this.shard = { target, age: 0, aim, light: null, settled: false };
    const v = this.shardView;
    v.on = true;
    v.trail.length = 0;
    v.k = 0;
    v.flash = 0;
    v.warn = false;
    v.settle = 0;
    const t = this.whereIs(target);
    shardPose(0, fx, fy, t.x, t.y, target.self, aim, this.pose);
    v.x = this.pose.x; v.y = this.pose.y; v.rot = this.pose.rot; v.cx = t.x; v.cy = t.y;
    this.shard.light = sys.addLight(v.x, v.y, { rgb: [0.72, 0.87, 1], intensity: 0.55, radius: 30, bloom: 0.7, flicker: 0.05 }, T.duration, false);
    if (this.dropShard.length === 0) {
      this.dropShard.push(
        sys.addDrawable({ layer: 'under', draw: (out, field, cx) => drawShard(out, field, cx, this.shardView, true) }),
        sys.addDrawable({ layer: 'over', draw: (out, field, cx) => drawShard(out, field, cx, this.shardView, false) }),
      );
    }
    // The throw: a shower of glass off her hand along the aim, the glass singing as it takes the air.
    this.sparks(fx + Math.cos(aim) * 6, fy + Math.sin(aim) * 6, 18, 1.7, aim, 0.7, GLASS_HEX, 22);
    ctx.audio.sfx('spell.vitrify', p.x, p.y, { gain: 0.8, pitch: 3 });
    ctx.audio.sfx('pickup.bell', p.x, p.y, { gain: 0.5, pitch: 9, delay: 0.05 });
    punch(ctx, 0.006, 0.16);
    return true;
  }

  tacticalActive(): number {
    const s = this.shard;
    return s ? Math.max(0, (TUNING.shard.duration - s.age) / TUNING.shard.duration) : 0;
  }

  /** The shard takes the blow with her: it flares white and rings (only for a blow worth it, so a burn's tick does not chatter). */
  reduceIncoming(amount: number): number {
    if (this.shard && amount >= 1.5) {
      const now = this.ctx.state.frameCount;
      this.shardView.flash = 1;
      if (now - this.lastBlowFx >= 6) {
        this.lastBlowFx = now;
        const p = this.ctx.player;
        this.ctx.audio.sfx('pickup.bell', p.x, p.y, { gain: 0.45, pitch: 11 });
        this.sparks(this.shardView.x, this.shardView.y, 8, 1.3, -Math.PI / 2, Math.PI, GLASS_HEX, 16, 1);
      }
    }
    return amount;
  }

  private stepShard(): void {
    const v = this.shardView;
    v.flash = v.flash > 0.03 ? v.flash * 0.86 : 0;
    const s = this.shard;
    if (!s) return;
    const ctx = this.ctx, T = TUNING.shard;
    const c = this.chest();
    const fx = c.x, fy = c.y;
    const t = this.whereIs(s.target);
    s.age++;
    shardPose(s.age, fx, fy, t.x, t.y, s.target.self, s.aim, this.pose);
    v.x = this.pose.x; v.y = this.pose.y; v.rot = this.pose.rot; v.settle = this.pose.settle;
    v.cx = t.x; v.cy = t.y;
    v.trail.unshift(v.x, v.y);
    if (v.trail.length > SHARD_TRAIL * 2) v.trail.length = SHARD_TRAIL * 2;
    const left = T.duration - s.age;
    v.k = Math.min(1, s.age / 6, left / T.fadeTicks);
    v.warn = left <= T.warnTicks && left > T.fadeTicks;
    if (s.light) {
      s.light.x = v.x;
      s.light.y = v.y;
      s.light.intensity = 0.55 * v.k * (0.85 + 0.15 * v.settle) * (1 + 0.8 * v.flash);
    }
    // Glints shed as it flies; a ring and a chime as it settles into its orbit.
    if (s.age < T.flightTicks && s.age % 2 === 0) {
      ctx.particles.spawn(v.x + (fxRandom() - 0.5) * 2, v.y + (fxRandom() - 0.5) * 2, (fxRandom() - 0.5) * 0.25, 0.05 + fxRandom() * 0.15, null, GLASS_HEX[(fxRandom() * GLASS_HEX.length) | 0], 16, { glow: 1.9, grav: 0.01 });
    }
    if (!s.settled && s.age >= T.flightTicks) {
      s.settled = true;
      const p = ctx.player;
      ctx.audio.sfx('pickup.bell', p.x, p.y, { gain: 0.4, pitch: 10 });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.particles.spawn(v.x, v.y, Math.cos(a) * 0.6, Math.sin(a) * 0.6, null, GLASS_HEX[i % GLASS_HEX.length], 16, { glow: 1.8, grav: 0 });
      }
    }
    if (left <= 0) this.endShard(true);
  }

  /** The shard goes: it dissolves in a puff of glints (when it ran its course) and the protection is lifted. */
  private endShard(natural: boolean): void {
    const s = this.shard;
    if (!s) return;
    this.shard = null;
    this.sys.clearMod(MERCY_MOD);
    const v = this.shardView;
    const ctx = this.ctx;
    if (natural && !ctx.player.dead && ctx.state.mode === 'play') {
      this.sparks(v.x, v.y, 16, 1.2, -Math.PI / 2, Math.PI, GLASS_HEX, 22, 1.5);
      ctx.audio.sfx('spell.ice.impact', v.x, v.y, { gain: 0.4, pitch: 8 });
      ctx.audio.sfx('pickup.bell', v.x, v.y, { gain: 0.35, pitch: -2 });
    }
    v.on = false;
    v.trail.length = 0;
    for (const drop of this.dropShard.splice(0)) drop();
    if (s.light) s.light.intensity = 0; // the system removes it on its own clock (or at once on a reset)
  }

  // ======================================================================== Rose Window

  /** Where the window stands: at her feet, on the floor under her when she is in the air (floating where she is if there is none). */
  private findSite(): { x: number; floorY: number } {
    const ctx = this.ctx, p = ctx.player;
    const x = Math.round(p.x);
    let y = Math.round(p.y);
    const standing = (yy: number): boolean => !ctx.physics.entityFree(x, yy + 1, 4, 1);
    if (!standing(y)) {
      for (let d = 1; d <= TUNING.window.maxDrop; d++) {
        if (standing(y + d)) { y += d; break; }
      }
    }
    return { x, floorY: y };
  }

  ultimate(): boolean {
    const sys = this.sys, ctx = this.ctx, T = TUNING.window;
    const site = this.findSite();
    this.dropWindow();
    // The glass stands on the floor: its lowest edge is the surface under her feet.
    const cy = site.floorY + 1 - T.glassR;
    const view = newWindowView(site.x, cy);
    windowLook(0, T.duration, 0, ctx.state.reduceFlashes === true, view.look);
    const light = sys.addLight(site.x, cy, { rgb: [1, 0.88, 0.62], intensity: T.lightIntensity, radius: T.lightRadius, bloom: 0.55, flicker: 0.04 }, T.duration, false);
    this.win = { world: ctx.world, x: site.x, cy, view, state: 'live', remaining: T.duration, light, healing: false };
    this.dropWin = sys.addDrawable({ layer: 'under', draw: (out, field, c) => drawRoseWindow(out, field, c, view) });
    // The unfolding: a fountain of coloured glass off the floor, a deep chime and the glass coming into being.
    this.sparks(site.x, site.floorY - 2, 40, 2.2, -Math.PI / 2, 0.9, PANE_HEX, 34, 4);
    ctx.audio.sfx('spell.conjure', site.x, cy, { gain: 1.1, pitch: -2 });
    ctx.audio.sfx('pickup.bell', site.x, cy, { gain: 0.9, pitch: -5 });
    ctx.audio.sfx('spell.vitrify', site.x, cy, { gain: 0.6, pitch: -3, delay: 0.08 });
    punch(ctx, 0.016, 0.5);
    this.sys.callout('ROSE WINDOW');
    view.pulse = 0;
    return true;
  }

  ultimateTick(remaining: number): void {
    const w = this.win;
    if (!w || w.state !== 'live' || w.world !== this.ctx.world) return;
    w.remaining = remaining;
    // Healing, straight into her health, capped at its ceiling: nothing here needs the potion's own visuals.
    const p = this.ctx.player;
    const T = TUNING.window;
    w.healing = p.hp > 0 && p.hp < p.maxHp && within(p.x, p.y - 9, w.x, w.cy, T.radius);
    if (w.healing) p.hp = healed(p.hp, p.maxHp, T.healPerSecond);
  }

  /** The window's own clock: how it looks, its pulse and glints, the motes of colour and of mending, and the shattering. */
  private stepWindow(): void {
    const w = this.win;
    if (!w) return;
    const ctx = this.ctx, T = TUNING.window, now = ctx.state.frameCount, v = w.view;
    if (w.world !== ctx.world) { this.dropWindow(); return; }
    v.flash = v.flash > 0.03 ? v.flash * 0.88 : 0;
    for (let i = v.glints.length - 1; i >= 0; i--) {
      if (++v.glints[i].age > 12) v.glints.splice(i, 1);
    }
    if (w.state === 'breaking') {
      if (++v.broke >= T.breakTicks) this.dropWindow();
      return;
    }
    const age = T.duration - w.remaining;
    windowLook(age, T.duration, now, ctx.state.reduceFlashes === true, v.look);
    if (w.light) w.light.intensity = T.lightIntensity * v.look.glow * Math.min(1, v.look.scale + 0.2);
    if (v.pulse >= 0) {
      v.pulse += 1 / T.pulseTicks;
      if (v.pulse > 1) v.pulse = -1;
    }
    if (age > 0 && age % T.pulseEvery === 0 && w.remaining > T.crackTicks) {
      v.pulse = 0;
      const p = ctx.player;
      if (w.healing) ctx.audio.sfx('player.heal', p.x, p.y, { gain: 0.5 });
    }
    // Colour drifting off the glass.
    if (now % 6 === 0 && v.look.glow > 0.4) {
      ctx.particles.spawn(
        w.x + (fxRandom() - 0.5) * 20, w.cy + (fxRandom() - 0.5) * 18, (fxRandom() - 0.5) * 0.18, -0.12 - fxRandom() * 0.18,
        null, PANE_HEX[(fxRandom() * PANE_HEX.length) | 0], 36, { glow: 1.8, grav: -0.004 },
      );
    }
    // Mending: gold motes cross from the glass to her while she is being healed.
    if (w.healing && now % 5 === 0) {
      const c = this.chest();
      const dx = c.x - w.x, dy = c.y - w.cy;
      const d = Math.max(1, Math.hypot(dx, dy));
      const sp = Math.min(1.4, 0.5 + d * 0.012);
      ctx.particles.spawn(w.x + (fxRandom() - 0.5) * 10, w.cy + (fxRandom() - 0.5) * 10, (dx / d) * sp, (dy / d) * sp, null, GOLD_HEX[(fxRandom() * GOLD_HEX.length) | 0], Math.ceil(d / sp), { glow: 1.9, grav: 0 });
      if (now % 10 === 0) ctx.particles.spawn(c.x + (fxRandom() - 0.5) * 8, c.y + 4 - fxRandom() * 8, 0, -0.35 - fxRandom() * 0.2, null, 0xfff1b8, 20, { glow: 1.8, grav: -0.01 });
    }
  }

  /**
   * A hostile shot about to be tested against her. Inside the window's radius it is TURNED (its velocity
   * rotated away from the prism, speed kept) and lives on: the engine calls this at every sub-step of the
   * shot's flight (<= 1 cell), so even a 45-cell-a-tick shot is caught at the radius, and `refract` leaves a
   * shot that is already leaving alone, so it is turned once. Always false: nothing is eaten.
   */
  intercept(shot: Projectile): boolean {
    const w = this.win;
    if (!w || w.state !== 'live') return false;
    const R = TUNING.window.radius;
    const dx = shot.x - w.x, dy = shot.y - w.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > R * R) return false;
    const d = Math.sqrt(d2) || 1e-6;
    const rx = dx / d, ry = dy / d;
    // (A shot dead-on picks its side from where it is, not from a roll: nothing here consumes the seeded stream.)
    const tie = ((shot.age + (shot.y | 0)) & 1) === 0 ? 1 : -1;
    if (!refract(shot.vx, shot.vy, rx, ry, tie, this.turn)) return false;
    shot.vx = this.turn.vx;
    shot.vy = this.turn.vy;
    this.refracted(w, shot, rx, ry);
    return false;
  }

  /** The prism takes the shot's light and throws it out in colours: a flare at the entry, a flash on the ring, a chime. */
  private refracted(w: NonNullable<EddaMorrow['win']>, shot: Projectile, rx: number, ry: number): void {
    const ctx = this.ctx, now = ctx.state.frameCount;
    const v = w.view;
    v.flash = 1;
    v.flashAngle = Math.atan2(ry, rx);
    v.glints.push({ x: shot.x, y: shot.y, age: 0 });
    if (v.glints.length > 8) v.glints.shift();
    this.sparks(shot.x, shot.y, 12, 1.6, Math.atan2(shot.vy, shot.vx), 0.8, PANE_HEX, 20, 1.2);
    if (now - this.lastRefractFx < 3) return;
    this.lastRefractFx = now;
    ctx.audio.sfx('pickup.bell', shot.x, shot.y, { gain: 0.5, pitch: 7 });
    this.sys.addLight(shot.x, shot.y, { rgb: [1, 0.92, 0.7], intensity: 0.8, radius: 24, bloom: 0.8, flicker: 0 }, 7);
  }

  /** The ultimate ran out: when it ran its course the glass shatters and its pieces fall; any other end just takes it away. */
  ultimateEnd(): void {
    const w = this.win;
    if (!w) return;
    const ctx = this.ctx;
    const natural = w.state === 'live' && w.remaining <= 1 && w.world === ctx.world && !ctx.player.dead && ctx.state.mode === 'play';
    if (!natural) { this.dropWindow(); return; }
    w.state = 'breaking';
    w.view.broke = 0;
    w.view.pulse = -1;
    w.healing = false;
    if (w.light) w.light.intensity = 0;
    const x = w.x, y = w.cy;
    ctx.audio.sfx('flask.shatter', x, y, { gain: 1.1, pitch: -2 });
    ctx.audio.sfx('mat.shatter', x, y, { gain: 0.7, pitch: 2 });
    ctx.audio.sfx('pickup.bell', x, y, { gain: 0.7, pitch: -8, delay: 0.05 });
    this.sparks(x, y, 70, 2.6, -Math.PI / 2, Math.PI, PANE_HEX, 44, 8);
    ctx.particles.burst(x, y, 40, null, () => PANE_HEX[(fxRandom() * PANE_HEX.length) | 0], 2.6, { glow: 1.6, grav: 0.07 });
    this.sys.addLight(x, y, { rgb: [1, 0.95, 0.8], intensity: 1.7, radius: 80, bloom: 1.0, flicker: 0 }, 10);
    punch(ctx, 0.02, 0.6);
  }

  private dropWindow(): void {
    if (this.dropWin) { this.dropWin(); this.dropWin = null; }
    const w = this.win;
    if (w?.light) w.light.intensity = 0;
    this.win = null;
  }

  // ======================================================================== lifecycle

  reset(): void {
    this.endShard(false);
    this.dropWindow();
    if (this.dropShimmer) { this.dropShimmer(); this.dropShimmer = null; }
    this.stored.reset();
    this.armorSeen = this.sys.armor;
    this.shardView.flash = 0;
    this.lastRefractFx = -99;
    this.lastBlowFx = -99;
  }

  dispose(): void {
    for (const off of this.offEvents) off();
    this.reset();
  }
}

export const kit: FighterKitDef = {
  id: 'edda-morrow',
  tacticalCooldown: TUNING.shard.cooldown,
  ultimateDuration: TUNING.window.duration,
  create: (sys) => new EddaMorrow(sys),
};
