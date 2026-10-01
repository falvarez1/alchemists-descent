import { isWardedBoss } from '@/core/bossWard';
import type { FighterDrawable, FighterMeter } from '@/core/fighters';
import { fxRandom } from '@/core/simRandom';
import type { Ctx, Enemy, EnemyDamageSource } from '@/core/types';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W, PLAYER_STEP_UP } from '@/core/types';
import { pointHitsCreature } from '@/creatures/body';
import { aimOf, castToSolid, punch, shoulderOf } from '@/fighters/effects';
import type { FighterSystem, MovePlan } from '@/fighters/FighterSystem';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import { drawOverlay, drawSpoor, drawTether } from '@/fighters/kits/sable-fen-draw';
import type { Ping, Ring, Stun, TetherView } from '@/fighters/kits/sable-fen-draw';
import {
  TUNING, beatAt, dist, exitVelocity, firstBodyAlong, haulVector, isWounded, lineBlocked, newTrail, pushSpoor,
  revealStrength, ringPassed, ringRadius, sampleDue, slideHaul, tetherReach, tooHeavy, trailSpent, yankVelocity,
} from '@/fighters/kits/sable-fen-logic';
import type { SpoorTrail } from '@/fighters/kits/sable-fen-logic';
import { Cell, blocksEntity } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';

/**
 * SABLE FEN, the Mire Stalker (Hunter). docs/FIGHTERS.md "03", docs/fighters/sable-fen.md.
 *
 *  - Wounded Spoor (passive): any foe the fighter hurts is marked for 6 s and leaves a trail of fading green
 *    motes at its last positions (a drawable on the 'under' layer, so the track reads through darkness and over
 *    rock). A marked foe the fighter cannot see (rock between, or too dark) pulses faintly through the system's
 *    reveal ring. Information only: it changes what she knows, never what a foe does.
 *  - Bogline (Z): a hooked tether fired along the aim. It stops at the first solid cell or the first foe body.
 *    On rock she is hauled to the hook by the system's body-owning move; on a light foe it is yanked toward her
 *    through the engine's knock state, then stunned; a foe too heavy to drag (a golem, a boss) hauls HER to it.
 *    No hook: refused, no cooldown.
 *  - Bloodsense (T): every wounded foe within 320 cells is revealed through rock and darkness, renewed each tick
 *    (a foe wounded mid-ultimate joins in), green, with a slow double heartbeat ring from her; she is 10% faster.
 *
 * Nothing here writes a cell: the tether is a drawable and the haul is a body move, so it cannot seal a route.
 */

const GREEN = (): number => packRGB(70 + ((fxRandom() * 40) | 0), 235 + ((fxRandom() * 20) | 0), 110 + ((fxRandom() * 40) | 0));
const SPORE = (): number => packRGB(140 + ((fxRandom() * 60) | 0), 255, 170 + ((fxRandom() * 60) | 0));

interface Yank {
  e: Enemy;
  left: number;
}

class SableFen implements KitInstance {
  private readonly trails = new Map<Enemy, SpoorTrail>();
  private readonly seen = new WeakMap<Enemy, { at: number; unseen: boolean }>();
  private markedNow = 0;

  private tether: TetherView | null = null;
  private yank: Yank | null = null;

  private readonly rings: Ring[] = [];
  private readonly pings: Ping[] = [];
  /** The foes Bloodsense is showing this tick (the overlay warms each from within). */
  private readonly sensed: Enemy[] = [];
  /** Foes the line has dazed, for the stars over their heads. */
  private readonly stuns: Stun[] = [];
  private blood = false;

  /** Why the last press was refused (the probes read it; the player reads the callout). */
  lastRefusal: string | null = null;

  private readonly spoorDrawable: FighterDrawable;
  private readonly tetherDrawable: FighterDrawable;
  private readonly overlayDrawable: FighterDrawable;

  constructor(private readonly sys: FighterSystem) {
    this.spoorDrawable = { layer: 'under', draw: (out, field, ctx) => drawSpoor(out, field, ctx, { trails: this.trails }) };
    this.tetherDrawable = {
      layer: 'over',
      draw: (out, field, ctx) => { if (this.tether) drawTether(out, field, ctx, this.tether); },
    };
    this.overlayDrawable = {
      layer: 'over',
      draw: (out, field, ctx) => drawOverlay(out, field, ctx, { rings: this.rings, pings: this.pings, sensed: this.sensed, stuns: this.stuns }),
    };
  }

  // ======================================================================== drawables

  /** The system clears every drawable on a respawn or a floor change: the kit puts back what it still needs. */
  private mounted(d: FighterDrawable, want: boolean): void {
    const list = this.sys.drawables;
    const at = list.indexOf(d);
    if (want && at < 0) list.push(d);
    else if (!want && at >= 0) list.splice(at, 1);
  }

  private mount(): void {
    this.mounted(this.spoorDrawable, true);
    this.mounted(this.tetherDrawable, this.tether !== null);
    this.mounted(this.overlayDrawable, this.rings.length > 0 || this.pings.length > 0 || this.sensed.length > 0 || this.stuns.length > 0);
  }

  // ======================================================================== tick

  tick(): void {
    const ctx = this.sys.ctx;
    const now = ctx.state.frameCount;
    this.passive(ctx, now);
    this.yankTick(ctx);
    this.tetherTick(now);
    this.tidyBeats(now);
    this.mount();
  }

  // ======================================================================== Wounded Spoor

  onEnemyHurt(e: Enemy, _amount: number, _source: EnemyDamageSource, killed: boolean): void {
    if (killed || e.hp <= 0) return;
    this.mark(e);
  }

  /** Put a foe on the scent: marked for 6 s, its first mote down at once. */
  private mark(e: Enemy): void {
    const ctx = this.sys.ctx;
    const fresh = !this.sys.isMarked(e);
    this.sys.markEnemy(e, TUNING.spoor.markTicks);
    const tr = this.trailFor(e);
    pushSpoor(tr, e.x, e.y, ctx.state.frameCount);
    if (fresh) {
      const def = ctx.enemyCtl.defs[e.kind];
      ctx.particles.burst(e.x, e.y - (def ? def.h * 0.5 : 5), 5, null, SPORE, 0.9, { glow: 1.7, grav: -0.015 });
      ctx.audio.sfx('mat.bubble', e.x, e.y, { gain: 0.45, pitch: 5 });
    }
  }

  private trailFor(e: Enemy): SpoorTrail {
    let tr = this.trails.get(e);
    if (!tr) { tr = newTrail(); this.trails.set(e, tr); }
    return tr;
  }

  private passive(ctx: Ctx, now: number): void {
    const S = TUNING.spoor;
    const p = ctx.player;
    const eyeX = p.x, eyeY = p.y - (p.crawling ? 4 : 9);
    const defs = ctx.enemyCtl.defs;
    const solidAt = (x: number, y: number): boolean => !ctx.world.inBounds(x, y) || blocksEntity(ctx.world.types[ctx.world.idx(x, y)]);
    let marked = 0;
    for (const e of ctx.enemies) {
      if (e.hp <= 0 || !this.sys.isMarked(e)) continue;
      marked++;
      // The spoor: a mote of where it is, every few ticks.
      if (sampleDue(now, 0, S.sampleEvery)) pushSpoor(this.trailFor(e), e.x, e.y, now);
      // Out of her sight: a faint pulse through the reveal ring (the system draws it). Bloodsense says it louder.
      if (this.blood) continue;
      const def = defs[e.kind];
      if (!def) continue;
      let st = this.seen.get(e);
      if (!st) { st = { at: -99, unseen: false }; this.seen.set(e, st); }
      if (now - st.at >= 6) {
        st.at = now;
        const cy = e.y - def.h * 0.5;
        const dark = (ctx.lightQuery?.level(e.x, cy) ?? 1) < S.darkLevel;
        st.unseen = dark || lineBlocked(solidAt, eyeX, eyeY, e.x, cy);
      }
      if (st.unseen) this.sys.revealEnemy(e, 8, S.pulseRgb);
    }
    this.markedNow = marked;
    if (this.trails.size > 0 && (now & 7) === 0) {
      for (const [e, tr] of this.trails) if (trailSpent(tr, now)) this.trails.delete(e);
    }
  }

  meter(): FighterMeter | null {
    return this.markedNow > 0 ? { label: 'Marked', value: this.markedNow, max: TUNING.spoor.meterMax } : null;
  }

  // ======================================================================== Bogline

  tactical(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player;
    const T = TUNING.bogline;
    const aim = aimOf(ctx);
    const sh = shoulderOf(ctx);
    const defs = ctx.enemyCtl.defs;

    // The first solid cell along the aim, then the first foe body that comes before it.
    const rock = castToSolid(ctx, sh.x, sh.y, aim.x, aim.y, T.range);
    const reach = rock.hit ? dist(sh.x, sh.y, rock.hitX, rock.hitY) : T.range;
    const foes = ctx.enemies.filter((e) => e.hp > 0 && defs[e.kind] !== undefined && dist(sh.x, sh.y, e.x, e.y) <= reach + 40);
    const hit = foes.length === 0 ? null : firstBodyAlong(sh.x, sh.y, aim.x, aim.y, reach, (x, y) => {
      for (let i = 0; i < foes.length; i++) if (pointHitsCreature(foes[i], defs[foes[i].kind], x, y, T.bodyPad)) return i;
      return -1;
    });

    if (hit) {
      if (p.swinging) ctx.playerCtl.releaseVine(ctx);
      return this.hookFoe(foes[hit.index], hit.x, hit.y, sh, aim);
    }
    if (!rock.hit) return this.refuse('NOTHING TO HOOK');
    if (reach < T.minHook) return this.refuse('TOO CLOSE TO HOOK');
    if (p.swinging) ctx.playerCtl.releaseVine(ctx);
    // A hook that ran off the edge of the map bites the last open cell: there is always a cell to read.
    const inside = ctx.world.inBounds(rock.hitX, rock.hitY);
    return this.hookRock(inside ? rock.hitX : rock.x, inside ? rock.hitY : rock.y, sh);
  }

  /** An ability that cannot go off says why (a line over her head, a dry click) and costs nothing. */
  private refuse(why: string): false {
    const ctx = this.sys.ctx, p = ctx.player;
    this.lastRefusal = why;
    ctx.audio.sfx('wand.dry', p.x, p.y);
    this.sys.callout(why);
    return false;
  }

  /** The hook bites rock: she is hauled to it. */
  private hookRock(ax: number, ay: number, sh: { x: number; y: number }): true {
    const ctx = this.sys.ctx;
    const t = ctx.world.types[ctx.world.idx(ax, ay)];
    this.castFx(sh, ax, ay);
    // What it bit decides what it sounds like, and what flies off it.
    ctx.audio.sfx(t === Cell.Wood ? 'body.impact.wood' : t === Cell.Metal ? 'body.impact.metal' : 'body.impact.stone', ax, ay, { gain: 0.8, pitch: 2 });
    const chip = COLOR_FN[t];
    ctx.particles.burst(ax, ay, 7, null, chip ? () => chip() : () => packRGB(150, 140, 120), 1.5, { grav: 0.05 });
    ctx.particles.burst(ax, ay, 4, null, SPORE, 1.1, { glow: 1.8, grav: -0.01 });
    const anchor = (): { x: number; y: number } => ({ x: ax, y: ay });
    this.haul(anchor, TUNING.bogline.stopShort, null, this.newTether(anchor, false));
    return true;
  }

  /** The hook bites a foe: a light one is dragged to her and stunned; a heavy one drags HER to it. */
  private hookFoe(e: Enemy, hx: number, hy: number, sh: { x: number; y: number }, aim: { x: number; y: number }): true {
    const sys = this.sys, ctx = sys.ctx;
    const T = TUNING.bogline;
    const def = ctx.enemyCtl.defs[e.kind];
    // The hook sits a little inside the body's edge (the find has a couple of cells of padding), and rides the foe.
    const into = T.bodyPad + 1.5;
    const offX = hx + aim.x * into - e.x, offY = hy + aim.y * into - e.y;
    this.castFx(sh, hx, hy);
    ctx.audio.sfx('creature.hit', e.x, e.y, { gain: 0.8, pitch: -1 });
    ctx.particles.burst(hx, hy, 8, null, GREEN, 1.7, { glow: 1.9, grav: -0.01 });
    ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 2);
    this.mark(e);
    const anchor = (): { x: number; y: number } => ({ x: e.x + offX, y: e.y + offY });
    const tether = this.newTether(anchor, true);
    const heavy = tooHeavy(def.halfW, def.h, isWardedBoss(e.kind), T.heavyMass);
    // A touch, so the foe wakes, turns on her and whatever the pull delivers it to counts as hers (the kick's bookkeeping).
    ctx.enemyCtl.gustShove(e, -aim.x, -aim.y, heavy ? 0.05 : 0.4);
    if (heavy) this.haul(anchor, T.stopShort + def.halfW, e, tether);
    else {
      this.yank = { e, left: T.yankTicks };
      this.tether = tether;
    }
    return true;
  }

  /** The crack of the line leaving her hand. */
  private castFx(sh: { x: number; y: number }, tx: number, ty: number): void {
    const ctx = this.sys.ctx, p = ctx.player;
    ctx.audio.sfx('trick.whip', p.x, p.y, { gain: 0.9 });
    const d = dist(sh.x, sh.y, tx, ty) || 1;
    const dx = (tx - sh.x) / d, dy = (ty - sh.y) / d;
    ctx.particles.burst(sh.x + dx * 5, sh.y + dy * 5, 5, null, SPORE, 1.1, { glow: 1.6, grav: -0.01 });
    punch(ctx, 0.006, 0.12);
  }

  /** A line thrown now. It is the kit's current tether only once the move that carries it has started (see `haul`). */
  private newTether(anchor: () => { x: number; y: number }, foe: boolean): TetherView {
    return { born: this.sys.ctx.state.frameCount, endAge: null, anchor, foe };
  }

  /** Haul her toward `anchor`, stopping `stop` cells short of it, sliding along rock rather than stopping dead. */
  private haul(anchor: () => { x: number; y: number }, stop: number, stunOnArrival: Enemy | null, tether: TetherView): void {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player;
    const T = TUNING.bogline;
    const bodyH = (): number => (p.crawling ? PLAYER_CRAWL_H : PLAYER_H);
    const free = (x: number, y: number): boolean => ctx.physics.entityFree(x, y, PLAYER_HALF_W, bodyH());
    let alive = true;
    const plan: MovePlan = {
      ticks: T.haulTicks,
      face: true,
      step: () => {
        const a = anchor();
        if (stunOnArrival && (stunOnArrival.hp <= 0 || !ctx.enemies.includes(stunOnArrival))) alive = false; // the foe died on the line
        if (!alive) return null;
        const v = haulVector(p.x, p.y - 9, a.x, a.y, T.haulSpeed, stop);
        if (!v) return null;
        const s = slideHaul(free, p.x, p.y, v, PLAYER_STEP_UP);
        if (s) {
          const ex = exitVelocity(s.dx, s.dy, T.exitSpeed, T.exitRise);
          plan.exitVx = ex.vx;
          plan.exitVy = ex.vy;
        }
        return s;
      },
      onStep: () => {
        // A green wake: the line is hauling her through the air.
        for (let k = 0; k < 2; k++) {
          ctx.particles.spawn(
            p.x + (fxRandom() - 0.5) * 6, p.y - 3 - fxRandom() * 12, (fxRandom() - 0.5) * 0.2, -0.05 - fxRandom() * 0.1,
            null, SPORE(), 18 + ((fxRandom() * 10) | 0), { glow: 1.6, grav: -0.005 },
          );
        }
      },
      onEnd: (reason) => {
        if (reason === 'cancelled') { if (this.tether === tether) this.tether = null; return; }
        this.endTether(tether);
        // She arrives: a landing, with the weight of it.
        const hard = reason === 'blocked';
        ctx.audio.sfx(hard ? 'player.land.hard' : 'player.land.soft', p.x, p.y, { gain: 0.8 });
        punch(ctx, hard ? 0.012 : 0.006, 0.1);
        if (p.grounded) ctx.particles.burst(p.x, p.y - 1, 6, null, () => packRGB(120, 112, 98), 1.3, { grav: 0.05 });
        if (stunOnArrival && stunOnArrival.hp > 0 && ctx.enemies.includes(stunOnArrival) && !isWardedBoss(stunOnArrival.kind)) {
          sys.stunEnemy(stunOnArrival, T.stunTicks);
          this.stuns.push({ e: stunOnArrival, until: ctx.state.frameCount + T.stunTicks });
        }
      },
    };
    // (starting a move first cancels any move already running, whose end clears ITS tether)
    sys.startMove(plan);
    this.tether = tether;
  }

  /** One tick of the yank: the foe is carried toward her chest in a straight line, then stunned. */
  private yankTick(ctx: Ctx): void {
    const y = this.yank;
    if (!y) return;
    const T = TUNING.bogline;
    const e = y.e;
    const def = ctx.enemyCtl.defs[e.kind];
    if (e.hp <= 0 || !def || !ctx.enemies.includes(e)) { this.yank = null; this.endTether(this.tether); return; }
    const p = ctx.player;
    const v = y.left > 0 ? yankVelocity(e.x, e.y - def.h * 0.5, p.x, p.y - 9, T.yankSpeed, T.yankStop) : null;
    if (!v) {
      this.yank = null;
      this.sys.stunEnemy(e, T.stunTicks);
      this.stuns.push({ e, until: ctx.state.frameCount + T.stunTicks });
      this.endTether(this.tether);
      ctx.audio.sfx('body.bash', e.x, e.y, { gain: 0.5, pitch: 3 });
      ctx.particles.burst(e.x, e.y - def.h * 0.5, 6, null, GREEN, 1.4, { glow: 1.8, grav: -0.01 });
      return;
    }
    y.left--;
    e.sleeping = false;
    e.knockVx = v.vx;
    e.knockVy = v.vy;
    e.knockT = Math.max(e.knockT ?? 0, 2);
    if (fxRandom() < 0.7) {
      ctx.particles.spawn(e.x + (fxRandom() - 0.5) * def.halfW, e.y - fxRandom() * def.h, -v.vx * 0.15, -v.vy * 0.15, null, SPORE(), 14, { glow: 1.6, grav: 0 });
    }
  }

  /** The pull is over: the line goes slack and coils back to her. */
  private endTether(t: TetherView | null): void {
    if (!t || t.endAge !== null) return;
    t.endAge = this.sys.ctx.state.frameCount - t.born;
  }

  private tetherTick(now: number): void {
    const t = this.tether;
    if (!t || t.endAge === null) return;
    const age = now - t.born;
    if (tetherReach(age, TUNING.bogline.flightTicks, t.endAge, TUNING.bogline.retractTicks) <= 0) this.tether = null;
  }

  // ======================================================================== Bloodsense

  ultimate(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player;
    const B = TUNING.bloodsense;
    this.blood = true;
    sys.setMod('bloodsense', B.duration + 2, { moveScale: B.moveScale });
    ctx.audio.sfx('player.heartbeat', p.x, p.y, { gain: 1.1, pitch: -3 });
    ctx.audio.sfx('world.gong', p.x, p.y, { gain: 0.3, pitch: -6 });
    punch(ctx, 0.012, 0.35);
    ctx.particles.burst(p.x, p.y - 9, 14, null, GREEN, 2.0, { glow: 2.0, grav: -0.01 });
    return true;
  }

  ultimateTick(remaining: number): void {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player;
    const B = TUNING.bloodsense;
    const now = ctx.state.frameCount;
    const elapsed = B.duration - remaining;

    const beat = beatAt(elapsed, B.beatEvery, B.dubGap);
    if (beat === 'sweep') this.rings.push({ born: now, ticks: B.sweepTicks, r0: 6, r1: B.range, strength: 1 });
    else if (beat === 'lub') {
      this.rings.push({ born: now, ticks: B.ringTicks, r0: 6, r1: B.ringRadius, strength: 0.8 });
      ctx.audio.sfx('player.heartbeat', p.x, p.y, { gain: 0.75, pitch: -3 });
    } else if (beat === 'dub') {
      this.rings.push({ born: now, ticks: B.ringTicks, r0: 6, r1: B.dubRadius, strength: 0.5 });
      ctx.audio.sfx('mat.hollow', p.x, p.y, { gain: 0.35, pitch: -7 });
    }

    // Every wounded foe in range, shown through rock and dark; the strength fades over the last second so the end is a dimming.
    const k = revealStrength(remaining, B.fadeTicks);
    const cx = p.x, cy = p.y - 9;
    const defs = ctx.enemyCtl.defs;
    const rgb: readonly [number, number, number] = [0.45 * k + 0.05, 1.35 * k + 0.05, 0.7 * k + 0.05];
    this.sensed.length = 0;
    for (const e of ctx.enemies) {
      if (!isWounded(e.hp, e.maxHp)) continue;
      const def = defs[e.kind];
      const ey = e.y - (def ? def.h * 0.5 : 5);
      const d = dist(cx, cy, e.x, ey);
      if (d > B.range) continue;
      sys.revealEnemy(e, B.revealTicks, rgb);
      if (k > 0.2) this.sensed.push(e);
      this.pingFoes(now, e, d);
    }
  }

  /** A ring that has just swept past a wounded foe makes it flare once. */
  private pingFoes(now: number, e: Enemy, d: number): void {
    for (const ring of this.rings) {
      const age = now - ring.born;
      if (age < 0 || age > ring.ticks) continue;
      const r = ringRadius(age, ring.ticks, ring.r0, ring.r1);
      const grew = r - ringRadius(age - 1, ring.ticks, ring.r0, ring.r1);
      if (!ringPassed(d, r, grew)) continue;
      const known = this.pings.find((q) => q.e === e && now - q.born < 10);
      if (!known) this.pings.push({ e, born: now });
    }
  }

  ultimateEnd(): void {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player;
    this.blood = false;
    this.sensed.length = 0;
    sys.clearMod('bloodsense');
    if (p.dead) return;
    ctx.audio.sfx('player.heartbeat', p.x, p.y, { gain: 0.6, pitch: -6 });
    ctx.particles.burst(p.x, p.y - 9, 8, null, GREEN, 1.2, { glow: 1.6, grav: 0.01 });
  }

  /** Spent rings and flares are dropped, so the heartbeat drawable can come off when nothing is left to draw. */
  private tidyBeats(now: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) if (now - this.rings[i].born > this.rings[i].ticks) this.rings.splice(i, 1);
    const ping = TUNING.bloodsense.pingTicks;
    for (let i = this.pings.length - 1; i >= 0; i--) if (now - this.pings[i].born > ping) this.pings.splice(i, 1);
    for (let i = this.stuns.length - 1; i >= 0; i--) if (now >= this.stuns[i].until) this.stuns.splice(i, 1);
  }

  // ======================================================================== lifecycle

  reset(): void {
    this.trails.clear();
    this.tether = null;
    this.yank = null;
    this.rings.length = 0;
    this.pings.length = 0;
    this.sensed.length = 0;
    this.stuns.length = 0;
    this.blood = false;
    this.markedNow = 0;
  }

  dispose(): void {
    this.reset();
    this.mounted(this.spoorDrawable, false);
    this.mounted(this.tetherDrawable, false);
    this.mounted(this.overlayDrawable, false);
  }
}

export const kit: FighterKitDef = {
  id: 'sable-fen',
  tacticalCooldown: TUNING.bogline.cooldown,
  ultimateDuration: TUNING.bloodsense.duration,
  create: (sys) => new SableFen(sys),
};
