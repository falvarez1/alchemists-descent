import { entityRandom, fxRandom } from '@/core/simRandom';
import type { AuthoredLight, Ctx, Enemy } from '@/core/types';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { shiftChain } from '@/creatures/rig/chain';
import { aimOf, castToSolid, punch, shoulderOf } from '@/fighters/effects';
import type { FighterSystem } from '@/fighters/FighterSystem';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import {
  drawBody, drawBurstRing, drawGroundRing, LiveCopy, snapshotShell,
} from '@/fighters/kits/selene-wraith-echo';
import type { EchoShell } from '@/fighters/kits/selene-wraith-echo';
import {
  TUNING, SlideModel, approach, chooseBlink, echoFade, echoSlot, lureChoice, nearestSpot, slideStartSpeed,
} from '@/fighters/kits/selene-wraith-math';
import type { BlinkSpec, SlideEnv } from '@/fighters/kits/selene-wraith-math';
import type { LightField, PixelSurface } from '@/render/pixels';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';

export { TUNING } from '@/fighters/kits/selene-wraith-math';

/**
 * SELENE WRAITH, the Mercury Twin (Duelist). docs/FIGHTERS.md "08", docs/fighters/selene-wraith.md.
 *
 *  - Liquid Momentum (passive): a crouch while grounded and running fast is a SLIDE, not a crawl. It is a
 *    body-owning move (`startMove`): the player's own stance would clamp a run to 32 % the moment S goes down.
 *    She keeps her speed with a 3 % decay for up to 45 ticks at crawl gauge (9 cells: a slide goes where a
 *    crawl does), follows the floor down a slope and a step, and ends when she stops, jumps, is hit, lets go,
 *    is blocked or runs out of floor, leaving with 80 % of her speed.
 *  - Quicksilver Echo (Z): a silver echo is left where she stands and she blinks up to 40 cells along the aim
 *    to the nearest place she can stand (never through rock, never into fire or lava; refused, free, when there
 *    is none). Z again inside 180 ticks returns her to the echo and keeps 40 % of what is left of the cooldown.
 *  - Mirror Hunt (T): two echoes ride the ground 28 cells to either side of her, wearing her pose. Foes may
 *    hunt them instead of her (`decoyFor`); a foe that reaches one pops it and is stunned. A foe drawn to an echo
 *    cannot attack (Enemies.update) and finds the lantern on the echo (lightResponse): two small engine seams.
 *
 * Nothing here writes a cell. The slide and the blink move the body, the echoes are pixels and a lure, so
 * nothing she does can seal a route (docs/fighters/selene-wraith.md).
 */

const SILVER = [0xf4f8ff, 0xc4d8ff, 0x8ab4ff, 0xffffff] as const;
const MOTE = (): number => packRGB(170 + ((fxRandom() * 70) | 0), 200 + ((fxRandom() * 50) | 0), 255);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** What sets a body on fire or eats it: she does not blink into it. */
const HURTS = new Set<number>([Cell.Fire, Cell.Lava, Cell.Acid, Cell.Toxic]);

interface Echo {
  world: World;
  x: number;
  y: number;
  born: number;
  shell: EchoShell;
  /** The calm silver glow that marks it in the dark, and the list it was put in. */
  light: AuthoredLight | null;
  lights: AuthoredLight[] | undefined;
}

type DecoyState = 'out' | 'popped' | 'fading';

interface Decoy {
  side: number;
  x: number;
  y: number;
  born: number;
  state: DecoyState;
  /** No ground for it right now: it is not drawn and draws no foe. */
  hidden: boolean;
  /** Ticks left of a pop's or an ending's dissolve. */
  fade: number;
  copy: LiveCopy;
}

interface Ring {
  x: number;
  y: number;
  born: number;
  life: number;
  radius: number;
}

interface Lure {
  /** -1 = the real body, else an index into the decoys. */
  pick: number;
  until: number;
}

class SeleneWraith implements KitInstance {
  // ---- Liquid Momentum
  private prevDown = false;
  private prevVx = 0;
  private prevGrounded = false;
  private rearm = 0;
  private model: SlideModel | null = null;
  // ---- Quicksilver Echo
  private echo: Echo | null = null;
  // ---- Mirror Hunt
  private mirrorOn = false;
  private mirrorLeft = 0;
  private decoys: Decoy[] = [];
  private lures = new WeakMap<Enemy, Lure>();
  private readonly seen = { x: 0, y: 0, vx: 0 };
  private readonly dists: number[] = [-1, -1];
  private readonly rolls: number[] = [0.5, 0.5, 0.5];
  // ---- the picture
  private rings: Ring[] = [];
  private removeDrawable: (() => void) | null = null;
  /** Why the last press was refused (the probes read it; the player reads the callout). */
  lastRefusal: string | null = null;

  constructor(private readonly sys: FighterSystem) {}

  // ======================================================================== the tick

  tick(): void {
    const ctx = this.sys.ctx;
    this.passiveTick();
    this.echoTick();
    this.copiesTick();
    if (this.rings.length > 0) {
      const now = ctx.state.frameCount;
      this.rings = this.rings.filter((r) => now - r.born < r.life);
    }
    this.trimDrawable();
  }

  // ======================================================================== Liquid Momentum

  private passiveTick(): void {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.slide;
    const down = ctx.input.keys.down === true;
    if (this.rearm > 0) this.rearm--;
    if (
      down && !this.prevDown && this.rearm === 0 && !sys.ownsMovement &&
      this.prevGrounded && p.grounded && !p.climbing && !p.swinging && !p.inLiquid && p.recharge === 0 && p.pullT === 0
    ) {
      const v0 = slideStartSpeed(this.prevVx, p.vx, T.minSpeed);
      if (v0 !== 0) this.startSlide(v0);
    }
    this.prevDown = down;
    this.prevVx = p.vx;
    this.prevGrounded = p.grounded;
  }

  private startSlide(v0: number): void {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.slide;
    const model = new SlideModel(v0, T);
    // Crawl gauge: the body is 9 cells tall for the slide, so it goes wherever a crawl goes (a 9-cell gap), and the
    // pose is the prone one. The player's own stance machine takes her from there when the slide ends.
    p.crawling = true;
    p.climbing = false;
    const keys = ctx.input.keys;
    const env: SlideEnv = {
      x: 0, y: 0, jump: false, down: true, hurt: false,
      floored: (x, y) => !ctx.physics.entityFree(x, y + 1, PLAYER_HALF_W, 1),
    };
    let lastHp = p.hp;
    const dir = v0 > 0 ? 1 : -1;
    this.slideBurst(dir, true);
    ctx.audio.sfx('player.skid', p.x, p.y, { gain: 1.0, pitch: -2 });
    sys.startMove({
      ticks: T.maxTicks,
      face: true,
      step: () => {
        env.x = p.x; env.y = p.y;
        env.jump = keys.jump === true;
        env.down = keys.down === true;
        env.hurt = p.hp < lastHp - 0.01 || p.staggerT > 0;
        lastHp = p.hp;
        return model.step(env);
      },
      // A blow's knock is hers to keep; otherwise she leaves with most of her speed and her feet on the floor.
      get exitVx(): number { return model.end === 'hurt' ? p.vx : model.exitVx; },
      get exitVy(): number { return model.end === 'hurt' ? p.vy : 0; },
      onStep: () => this.slideFx(model, dir),
      onEnd: (reason) => this.endSlide(reason, dir),
    });
    this.model = model; // (after the call: starting a move first ends any other, whose end would clear this)
  }

  /** Quicksilver shed off her heels as she goes, and a hush of scuff. */
  private slideFx(model: SlideModel, dir: number): void {
    const ctx = this.sys.ctx, p = ctx.player;
    if (model.age % TUNING.slide.sparkEvery === 0) {
      ctx.sparks?.burst(p.x - dir * 3, p.y - 1, {
        count: 2, speed: 0.9, angle: dir > 0 ? -2.7 : -0.45, spread: 0.5, colors: SILVER, kind: 'spark', glow: 1.2, radius: 1.5, life: 18,
      });
      ctx.particles.spawn(p.x - dir * (2 + fxRandom() * 2), p.y - 1 - fxRandom() * 2, -dir * (0.15 + fxRandom() * 0.25), -0.05, null, MOTE(), 14, { glow: 1.4, grav: 0.01 });
    }
    if (model.age % 15 === 7) ctx.audio.sfx('player.crawl', p.x, p.y, { gain: 0.55 });
  }

  private slideBurst(dir: number, start: boolean): void {
    const ctx = this.sys.ctx, p = ctx.player;
    ctx.sparks?.burst(p.x - dir * 2, p.y - 1, {
      count: start ? 10 : 6, speed: start ? 1.4 : 1.0, angle: dir > 0 ? -2.6 : -0.55, spread: 0.7, colors: SILVER, kind: 'spark', glow: 1.3, radius: 2, life: 22,
    });
    ctx.particles.burst(p.x - dir * 2, p.y - 1, start ? 5 : 3, null, MOTE, 0.9, { glow: 1.2, grav: 0.02 });
  }

  private endSlide(reason: 'done' | 'blocked' | 'cancelled', dir: number): void {
    const ctx = this.sys.ctx, p = ctx.player;
    const model = this.model;
    this.model = null;
    this.rearm = TUNING.slide.rearm;
    if (reason === 'cancelled') return; // a death, a new floor, a blink: the world this was in is gone or moved on
    if (reason === 'blocked') {
      // The wall at her nose: she stops dead, and the wall says so.
      p.vx = 0;
      p.fx = 0;
      ctx.audio.sfx('body.impact.stone', p.x, p.y, { gain: 0.45 });
      ctx.particles.burst(p.x + dir * 4, p.y - 4, 4, null, () => packRGB(150, 146, 138), 0.9, { grav: 0.05 });
      punch(ctx, 0.008, 0.08);
      return;
    }
    this.slideBurst(dir, false);
    if (model?.end === 'ledge') ctx.audio.sfx('player.land.soft', p.x, p.y, { gain: 0.3, pitch: 3 });
  }

  // ======================================================================== Quicksilver Echo

  private hazardIn(x: number, y: number): boolean {
    const w = this.sys.ctx.world;
    for (let dy = 0; dy < PLAYER_H; dy++) {
      for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) {
        const X = x + dx, Y = y - dy;
        if (w.inBounds(X, Y) && HURTS.has(w.types[w.idx(X, Y)])) return true;
      }
    }
    return false;
  }

  /** Room for the whole body, firm footing (more than half a boot on something), and nothing in it that burns or eats. */
  private canStand(x: number, y: number): boolean {
    const ph = this.sys.ctx.physics;
    if (!ph.entityFree(x, y, PLAYER_HALF_W, PLAYER_H) || ph.entityFree(x, y + 1, PLAYER_HALF_W, 1)) return false;
    let firm = 0;
    for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) if (ph.cellBlocks(x + dx, y + 1)) firm++;
    return firm >= TUNING.echo.minFooting && !this.hazardIn(x, y);
  }

  tactical(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.echo;
    const aim = aimOf(ctx);
    const sh = shoulderOf(ctx);
    const ray = castToSolid(ctx, sh.x, sh.y, aim.x, aim.y, T.range);
    const spec: BlinkSpec = {
      x: p.x, y: p.y, ax: aim.x, ay: aim.y,
      clear: ray.hit ? Math.hypot(ray.x - sh.x, ray.y - sh.y) : T.range,
      ok: (x, y) => this.canStand(x, y),
    };
    const to = chooseBlink(spec, T);
    if (!to) return this.refuse('NOWHERE TO BLINK');
    const now = ctx.state.frameCount;
    this.dropEcho();
    const shell = snapshotShell(ctx);
    const light = sys.addLight(p.x, p.y - 9, { rgb: [0.55, 0.72, 1], intensity: 0.7, radius: 34, bloom: 0.5, flicker: 0.05 }, T.window);
    this.echo = { world: ctx.world, x: p.x, y: p.y, born: now, shell, light, lights: ctx.levels?.current?.authoredLights };
    this.ensureDrawable();
    const from = { x: p.x, y: p.y };
    if (p.swinging) ctx.playerCtl.releaseVine(ctx);
    sys.cancelMove();
    this.moveTo(to.x, to.y);
    this.blinkFx(from, to, 'out');
    return true;
  }

  /** Z while the tactical cools: inside the window, back to the echo. */
  tacticalAgain(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.echo;
    const e = this.echo;
    if (!e) return false;
    if (e.world !== ctx.world || ctx.state.frameCount - e.born > T.window) { this.dropEcho(); return false; }
    const land = nearestSpot((x, y) => this.canStand(x, y), e.x, e.y, T.recallReach);
    if (!land) {
      return this.refuse('ECHO LOST'); // the place has changed under it: the ordinary refusal, and the echo runs out its time
    }
    const from = { x: p.x, y: p.y };
    if (p.swinging) ctx.playerCtl.releaseVine(ctx);
    sys.cancelMove();
    this.foldEcho(e);
    this.moveTo(land.x, land.y);
    this.blinkFx(from, land, 'back');
    sys.scaleTacticalCooldown(T.recallKeep);
    sys.view.tactical.usedAt = ctx.state.frameCount; // the chip flourishes: she used it again
    return true;
  }

  tacticalActive(): number {
    const e = this.echo;
    if (!e) return 0;
    const age = this.sys.ctx.state.frameCount - e.born;
    return age >= TUNING.echo.window ? 0 : 1 - age / TUNING.echo.window;
  }

  /** Put her down at (x, y): the body, its small clocks and its cloth all go together. */
  private moveTo(x: number, y: number): void {
    const ctx = this.sys.ctx, p = ctx.player, T = TUNING.echo;
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    p.fx = 0; p.fy = 0;
    p.vy = 0;
    p.grounded = true;
    p.climbing = false;
    p.fallPeak = 0; // a blink is not a fall: no landing thud
    p._px = x; p._py = y; // the animation reads displacement: a blink is not a sprint
    p.vx = clamp(p.vx, -3, 3);
    p.invuln = Math.max(p.invuln, T.invuln);
    const c = p.costume;
    if (c) for (const ch of [c.tails[0], c.tails[1], c.mantle, c.crown]) shiftChain(ch, dx, dy);
  }

  /** Both ends of a blink: silver light and sparks, a ring, the streak between, the sound. */
  private blinkFx(a: { x: number; y: number }, b: { x: number; y: number }, kind: 'out' | 'back'): void {
    const sys = this.sys, ctx = sys.ctx;
    const now = ctx.state.frameCount;
    for (const [pt, r] of [[a, 14], [b, 16]] as const) {
      ctx.sparks?.burst(pt.x, pt.y - 9, { count: 22, speed: 1.9, spread: Math.PI, colors: SILVER, kind: 'spark', glow: 1.5, radius: 3, life: 28 });
      ctx.particles.burst(pt.x, pt.y - 9, 10, null, MOTE, 1.7, { glow: 2, grav: -0.01 });
      sys.addLight(pt.x, pt.y - 9, { rgb: [0.62, 0.78, 1], intensity: 1.3, radius: 48, bloom: 0.9, flicker: 0 }, 12);
      this.rings.push({ x: pt.x, y: pt.y - 8, born: now, life: 16, radius: r });
    }
    // The streak: motes strung along the line she went, fading as they hang.
    const n = Math.max(6, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      ctx.particles.spawn(
        a.x + (b.x - a.x) * t + (fxRandom() - 0.5) * 3, a.y - 9 + (b.y - a.y) * t + (fxRandom() - 0.5) * 6,
        (fxRandom() - 0.5) * 0.3, (fxRandom() - 0.5) * 0.3 - 0.05, null, MOTE(), 14 + ((fxRandom() * 10) | 0), { glow: 1.8, grav: -0.005 },
      );
    }
    ctx.audio.sfx('player.teleport', a.x, a.y, { gain: 0.9, pitch: kind === 'back' ? 3 : 0 });
    ctx.audio.sfx('spell.warp.cast', b.x, b.y, { gain: 0.5, pitch: kind === 'back' ? 5 : 2 });
    punch(ctx, 0.01, 0.3);
  }

  /** The echo folds into her: it thins in a burst of silver where it stood. */
  private foldEcho(e: Echo): void {
    const ctx = this.sys.ctx;
    ctx.sparks?.burst(e.x, e.y - 9, { count: 26, speed: 1.6, spread: Math.PI, colors: SILVER, kind: 'spark', glow: 1.4, radius: 3, life: 26 });
    ctx.particles.burst(e.x, e.y - 9, 8, null, MOTE, 1.3, { glow: 2, grav: -0.01 });
    this.rings.push({ x: e.x, y: e.y - 8, born: ctx.state.frameCount, life: 14, radius: 11 });
    this.dropEcho();
  }

  private dropEcho(): void {
    const e = this.echo;
    if (!e) return;
    this.echo = null;
    // Its glow goes with it (the system would let it run out its 180 ticks otherwise).
    const at = e.light && e.lights ? e.lights.indexOf(e.light) : -1;
    if (at >= 0) e.lights?.splice(at, 1);
  }

  private echoTick(): void {
    const e = this.echo;
    if (!e) return;
    const ctx = this.sys.ctx, now = ctx.state.frameCount;
    if (e.world !== ctx.world) { this.dropEcho(); return; }
    const age = now - e.born;
    if (age >= TUNING.echo.window) {
      // Out of time: it comes apart where it stands.
      ctx.sparks?.burst(e.x, e.y - 9, { count: 14, speed: 0.9, spread: Math.PI, colors: SILVER, kind: 'spark', glow: 1.2, radius: 3, life: 24 });
      ctx.particles.burst(e.x, e.y - 9, 6, null, MOTE, 0.9, { glow: 1.6, grav: -0.01 });
      ctx.audio.sfx('mat.shatter', e.x, e.y, { gain: 0.35, pitch: 8 });
      this.dropEcho();
      return;
    }
    // Mercury drops lift off it and hang, so a still echo is not a still image.
    if (now % 6 === 0) {
      ctx.particles.spawn(e.x + (fxRandom() - 0.5) * 8, e.y - 2 - fxRandom() * 14, (fxRandom() - 0.5) * 0.1, -0.18 - fxRandom() * 0.15, null, MOTE(), 26, { glow: 1.5, grav: -0.004 });
    }
  }

  // ======================================================================== Mirror Hunt

  /** The floor an echo stands on in column x, nearest to `y` (a little up, a long way down), or null. */
  private groundAt(x: number, y: number, h: number): number | null {
    const ph = this.sys.ctx.physics;
    // Firm footing, as for her own landings: an echo does not hang half over an edge.
    const floored = (yy: number): boolean => {
      let firm = 0;
      for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) if (ph.cellBlocks(x + dx, yy + 1)) firm++;
      return firm >= TUNING.echo.minFooting && ph.entityFree(x, yy, PLAYER_HALF_W, h);
    };
    for (let i = 0; i <= 44; i++) {
      if (floored(y + i)) return y + i;
      if (i > 0 && i <= 12 && floored(y - i)) return y - i;
    }
    return null;
  }

  ultimate(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.mirror;
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const ground = (x: number): number | null => this.groundAt(x, p.y, h);
    if (echoSlot(p.x, 1, ground) === null && echoSlot(p.x, -1, ground) === null) return this.refuse('NO ROOM FOR ECHOES');
    const now = ctx.state.frameCount;
    this.mirrorOn = true;
    this.mirrorLeft = T.duration;
    this.lures = new WeakMap();
    this.decoys = [1, -1].map((side) => ({ side, x: p.x, y: p.y, born: now, state: 'out' as DecoyState, hidden: false, fade: 0, copy: new LiveCopy(ctx) }));
    this.ensureDrawable();
    // The twins peel off her: a ring of silver, a flash, and a chime that is not quite a bell.
    ctx.sparks?.burst(p.x, p.y - 9, { count: 40, speed: 2.2, spread: Math.PI, colors: SILVER, kind: 'spark', glow: 1.5, radius: 3, life: 30 });
    ctx.particles.burst(p.x, p.y - 9, 14, null, MOTE, 1.8, { glow: 2, grav: -0.01 });
    sys.addLight(p.x, p.y - 9, { rgb: [0.6, 0.76, 1], intensity: 1.5, radius: 70, bloom: 1.0, flicker: 0 }, 22);
    this.rings.push({ x: p.x, y: p.y - 8, born: now, life: 22, radius: 22 });
    ctx.audio.sfx('spell.warp.cast', p.x, p.y, { gain: 0.9, pitch: -1 });
    ctx.audio.sfx('pickup.bell', p.x, p.y, { gain: 0.6, pitch: 7 });
    ctx.audio.sfx('player.teleport', p.x, p.y, { gain: 0.7, pitch: 4 });
    punch(ctx, 0.02, 0.6);
    return true;
  }

  ultimateTick(remaining: number): void {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.mirror;
    this.mirrorLeft = remaining;
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const ground = (x: number): number | null => this.groundAt(x, p.y, h);
    const glide = Math.max(T.glide, Math.abs(p.vx) + 1.2);
    for (const d of this.decoys) {
      if (d.state !== 'out') continue;
      const slot = echoSlot(p.x, d.side, ground);
      d.hidden = slot === null;
      if (slot === null) continue;
      // After a blink she is far from where they were: they do not cross the level to follow, they are simply there.
      if (Math.abs(d.x - slot.x) > 90) { d.x = slot.x; d.y = slot.y; }
      d.x = approach(d.x, slot.x, glide);
      d.y = approach(d.y, slot.y, T.rise);
      this.reach(d);
    }
    // A mote or two off each, so a standing pair still shimmers.
    const now = ctx.state.frameCount;
    if (now % 5 === 0) {
      for (const d of this.decoys) {
        if (d.state === 'out' && !d.hidden) ctx.particles.spawn(d.x + (fxRandom() - 0.5) * 8, d.y - 2 - fxRandom() * 14, (fxRandom() - 0.5) * 0.1, -0.16 - fxRandom() * 0.12, null, MOTE(), 22, { glow: 1.4, grav: -0.004 });
      }
    }
  }

  /** A foe that has reached an echo pops it, and stands stunned in its own surprise. */
  private reach(d: Decoy): void {
    const sys = this.sys, T = TUNING.mirror;
    const now = sys.ctx.state.frameCount;
    if (now - d.born < 4) return; // an echo still leaving her has nothing to be reached
    for (const e of sys.enemiesNear(d.x, d.y - 8, T.popReach)) {
      if (e.hp <= 0 || e.sleeping === true || e.boss !== undefined || e.kind === 'eggs') continue;
      this.pop(d, e);
      return;
    }
  }

  private pop(d: Decoy, e: Enemy): void {
    const sys = this.sys, ctx = sys.ctx;
    d.state = 'popped';
    d.fade = 0;
    sys.stunEnemy(e, TUNING.mirror.stun);
    ctx.sparks?.burst(d.x, d.y - 9, { count: 34, speed: 2.0, spread: Math.PI, colors: SILVER, kind: 'spark', glow: 1.5, radius: 3, life: 28 });
    ctx.particles.burst(d.x, d.y - 9, 12, null, MOTE, 1.6, { glow: 2, grav: -0.01 });
    sys.addLight(d.x, d.y - 9, { rgb: [0.62, 0.78, 1], intensity: 1.4, radius: 52, bloom: 1.0, flicker: 0 }, 14);
    this.rings.push({ x: d.x, y: d.y - 8, born: ctx.state.frameCount, life: 18, radius: 16 });
    ctx.audio.sfx('flask.shatter', d.x, d.y, { gain: 0.7, pitch: 5 });
    ctx.audio.sfx('mat.shatter', d.x, d.y, { gain: 0.45, pitch: 6 });
    punch(ctx, 0.012, 0.35);
  }

  ultimateEnd(): void {
    this.mirrorOn = false;
    this.mirrorLeft = 0;
    const ctx = this.sys.ctx;
    for (const d of this.decoys) {
      if (d.state !== 'out') continue;
      d.state = 'fading';
      d.fade = TUNING.mirror.fade;
      if (!d.hidden && ctx.state.mode === 'play') {
        ctx.sparks?.burst(d.x, d.y - 9, { count: 12, speed: 0.8, spread: Math.PI, colors: SILVER, kind: 'spark', glow: 1.2, radius: 3, life: 22 });
      }
    }
  }

  /** Echoes that were popped or are ending thin out and go. */
  private copiesTick(): void {
    if (this.decoys.length === 0) return;
    for (const d of this.decoys) if (d.state === 'fading') d.fade--;
    if (this.decoys.every((d) => d.state === 'popped' || (d.state === 'fading' && d.fade <= 0))) {
      if (!this.mirrorOn) this.decoys = [];
    }
  }

  /** Which of the real body and the echoes foe `e` believes is her (re-rolled every 20 ticks, per foe). */
  decoyFor(e: Enemy): { x: number; y: number; vx: number } | null {
    if (!this.mirrorOn) return null;
    if (e.hp <= 0 || e.sleeping === true || e.boss !== undefined || e.kind === 'eggs') return null;
    const ctx = this.sys.ctx, p = ctx.player, now = ctx.state.frameCount;
    let st = this.lures.get(e);
    if (!st) { st = { pick: -1, until: 0 }; this.lures.set(e, st); }
    if (now >= st.until || (st.pick >= 0 && !this.live(this.decoys[st.pick]))) {
      const T = TUNING.mirror;
      const dists = this.dists;
      for (let i = 0; i < dists.length; i++) {
        const d = this.decoys[i];
        dists[i] = d && this.live(d) ? Math.hypot(e.x - d.x, e.y - d.y) : -1;
      }
      const rolls = this.rolls;
      for (let i = 0; i < rolls.length; i++) rolls[i] = entityRandom();
      st.pick = lureChoice(Math.hypot(e.x - p.x, e.y - p.y), dists, rolls, T.noise, T.lureRange);
      st.until = now + T.reroll;
    }
    if (st.pick < 0) return null;
    const d = this.decoys[st.pick];
    this.seen.x = d.x; this.seen.y = d.y; this.seen.vx = p.vx;
    return this.seen;
  }

  private live(d: Decoy | undefined): boolean {
    return d !== undefined && d.state === 'out' && !d.hidden;
  }

  // ======================================================================== the picture

  private ensureDrawable(): void {
    if (this.removeDrawable) return;
    this.removeDrawable = this.sys.addDrawable({ layer: 'under', draw: (out, field, ctx) => this.draw(out, field, ctx) });
  }

  /** Nothing left to draw: the drawable goes (a standing one costs a frame's walk of the list). */
  private trimDrawable(): void {
    if (!this.removeDrawable) return;
    if (this.echo || this.decoys.length > 0 || this.rings.length > 0) return;
    this.removeDrawable();
    this.removeDrawable = null;
  }

  private draw(out: PixelSurface, field: LightField, ctx: Ctx): void {
    const frame = ctx.state.frameCount;
    const calm = ctx.state.reduceFlashes === true;
    for (const r of this.rings) drawBurstRing(out, r.x, r.y, (frame - r.born) / r.life, r.radius);
    const e = this.echo;
    if (e && e.world === ctx.world) {
      const age = frame - e.born, k = echoFade(age);
      drawGroundRing(out, e.x, e.y, k, frame, calm);
      // Thinning: solid, then a ghost, flickering over its last breath.
      const level = k >= 1 ? 0 : k > 0.66 ? 1 : k > 0.33 ? 2 : 3;
      if (calm || k >= 0.5 || (frame >> 1) % 2 === 0) drawBody(out, field, ctx, e.shell.ghost, e.shell.skel, e.shell.costume, level);
    }
    for (const d of this.decoys) {
      if (d.hidden || d.state === 'popped') continue;
      const born = frame - d.born;
      let level = born < TUNING.mirror.form ? 3 - Math.floor((born / TUNING.mirror.form) * 3) : 0;
      if (d.state === 'fading') level = 1 + Math.min(2, Math.floor((1 - d.fade / TUNING.mirror.fade) * 3));
      else if (this.mirrorLeft > 0 && this.mirrorLeft <= TUNING.mirror.warnTicks && !calm) {
        // About to end: they flicker.
        if ((frame >> 2) % 2 === 0) level = Math.max(level, 2);
      }
      if (d.state === 'fading' && d.fade <= 0) continue;
      d.copy.draw(out, field, ctx, d.x, d.y, level);
    }
  }

  // ======================================================================== lifecycle

  /** An ability that cannot go off says why (a line over her head, a dry click) and costs nothing. */
  private refuse(why: string): false {
    const ctx = this.sys.ctx, p = ctx.player;
    this.lastRefusal = why;
    ctx.audio.sfx('wand.dry', p.x, p.y);
    this.sys.callout(why);
    return false;
  }

  reset(): void {
    this.model = null;
    this.rearm = 0;
    this.prevDown = false;
    this.prevVx = 0;
    this.prevGrounded = false;
    this.dropEcho();
    this.mirrorOn = false;
    this.mirrorLeft = 0;
    this.decoys = [];
    this.lures = new WeakMap();
    this.rings = [];
    this.trimDrawable();
  }

  dispose(): void {
    this.reset();
  }
}

export const kit: FighterKitDef = {
  id: 'selene-wraith',
  tacticalCooldown: TUNING.echo.cooldown,
  ultimateDuration: TUNING.mirror.duration,
  create: (sys) => new SeleneWraith(sys),
};
