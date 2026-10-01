import { isWardedBoss } from '@/core/bossWard';
import type { FighterDrawable } from '@/core/fighters';
import { entityRandom, fxRandom } from '@/core/simRandom';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import type { AuthoredLight, Ctx, Enemy, EnemyDamageSource } from '@/core/types';
import { rollCatchFire } from '@/entities/status';
import { castToSolid, punch } from '@/fighters/effects';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import type { FighterSystem } from '@/fighters/FighterSystem';
import {
  armorStruck, boxesOverlap, burstReady, countIn, emberSpots, foeBox, FUEL, isFoeBlow, isMeleeElimination, ramColumns, recoverArmor, shoulderBox, TINDER, TUNING,
} from '@/fighters/kits/rusk-emberjaw-logic';
import { Cell, isGas } from '@/sim/CellType';
import { emberColor, packRGB } from '@/sim/colors';

export { TUNING };

/**
 * 09 RUSK EMBERJAW, the Furnace Hound (Bulwark). docs/FIGHTERS.md, docs/fighters/rusk-emberjaw.md.
 *
 * - SCRAP RECOVERY. A 40-point armor pool (the system's: `setArmorMax` / `addArmor`, absorbed in the
 *   player's damage path). A melee elimination (`killed && sys.recentMelee`: a kick, a limb swing, her ram;
 *   or the wall that finishes a foe her ram flung) restores 14.
 * - SHOULDER RAM (Z). A body-owning charge (`startMove`): 8 ticks of 5.5 cells along her facing with
 *   i-frames, level over a gap. Foes in the path take 16, are flung (`gustShove`) and then stunned. Every Wood
 *   cell in the path, her height + 6 tall, is broken: to Ember when nothing near can catch from it (the
 *   Intake's barricade is moss-caulked and oil-cored, so there it is only cleared), else just cleared.
 *   A concussion goes to `Mechanisms.strike` once per charge: on the first break, or at the wall (levers
 *   flip, rune glyphs answer); a Wood barricade that is mostly broken fires its plug and opens its gate.
 *   Metal and stone are walls: the charge ends there with a thump and no hole.
 * - KILN HEART (T). The armor ceiling rises to 80 and fills, incoming damage x0.8; while it burns, a blow
 *   from a foe within 20 cells (one the armor swallows counts) vents embers: real Ember cells, unless oil,
 *   powder or bog gas is near her or she is oiled; foes within 16 take 6 and catch fire. The ceiling
 *   returns to 40 (armor clamped) when it ends.
 */

/** Foes that cannot catch fire (the engine's FIREPROOF set: they take the burst's blow only). */
const FIREPROOF: ReadonlySet<string> = new Set(['imp', 'colossus', 'leviathan', 'rimewarden', 'lenswright']);

const KILN_RGB: readonly [number, number, number] = [255, 128, 48];
const SPARK_HOT = [0xffe9a0, 0xffb040, 0xff7a20];
const SPARK_STEEL = [0xffffff, 0xffe9a0, 0xc8d0e0];
/** A scrap fragment that has not found her chest by now (ticks) is dropped, so a stray one never lingers. */
const SCRAP_MAX_AGE = 40;

/** A fragment of the fallen foe flying to her chest: it homes in, then clinks onto the armor. */
interface Scrap {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Armor the first fragment announces when it lands (0 for the rest). */
  carry: number;
  trail: Array<[number, number]>;
}

interface Afterimage {
  x: number;
  y: number;
  at: number;
  dir: number;
}

class RuskKit implements KitInstance {
  private readonly ctx: Ctx;
  /** The pool has been set up for this life (the system zeroes armor on equip and on a respawn). */
  private primed = false;
  private lastArmor = 0;

  // ---- the ram
  private ramDir = 1;
  private readonly hitThisRam = new Set<Enemy>();
  private struckThisRam = false;
  private readonly scratch: Enemy[] = [];
  private readonly stunQueue: Array<{ e: Enemy; at: number; by: number }> = [];
  private readonly trail: Afterimage[] = [];
  private readonly bits: Scrap[] = [];

  // ---- Kiln Heart
  private kilnOn = false;
  private kilnLight: AuthoredLight | null = null;
  private lastBurstAt = -999;

  private readonly paid = new WeakSet<Enemy>();
  /** When the ram last struck each foe (a flung foe that is slammed dead by a wall is her kill). */
  private readonly rammedAt = new WeakMap<Enemy, number>();
  private readonly offs: Array<() => void> = [];
  private readonly drawable: FighterDrawable;

  constructor(private readonly sys: FighterSystem) {
    this.ctx = sys.ctx;
    // A respawn zeroes the pool (the system's fresh start): she starts full again on her next tick.
    this.offs.push(
      this.ctx.events.on('playerRespawned', () => { this.primed = false; }),
      this.ctx.events.on('playerDeathCleared', () => { this.primed = false; }),
    );
    this.drawable = { layer: 'over', draw: (out, _field, ctx) => this.draw(out, ctx) };
  }

  // ======================================================================== the passive

  tick(): void {
    const s = this.sys, ctx = this.ctx, now = ctx.state.frameCount;
    if (!this.primed) {
      s.setArmorMax(this.kilnOn ? TUNING.kiln.armorMax : TUNING.armorMax, true);
      this.primed = true;
      this.lastArmor = s.armor;
    }

    // A blow that the armor swallowed is still a blow: the furnace answers it too (onPlayerHurt only hears health).
    if (this.kilnOn && armorStruck(this.lastArmor, s.armor)) this.kilnHit(ctx.player.lastDamageSource ?? undefined);
    this.lastArmor = s.armor;

    if (this.stunQueue.length > 0) this.runStuns(now);
    if (this.bits.length > 0) this.flyScrap();
    if (this.trail.length > 0) {
      while (this.trail.length > 0 && now - this.trail[0].at >= TUNING.ram.trailLife) this.trail.shift();
    }
  }

  onEnemyHurt(e: Enemy, _amount: number, source: EnemyDamageSource, killed: boolean): void {
    if (!killed) return;
    const at = this.rammedAt.get(e);
    if (isMeleeElimination(this.sys.recentMelee, source, at === undefined ? undefined : this.ctx.state.frameCount - at, TUNING.ram.slamWindow)) this.scrap(e);
  }

  /** A melee elimination: +14 armor, a stream of scrap flies from the body to her. */
  private scrap(e: Enemy): void {
    if (this.paid.has(e)) return;
    this.paid.add(e);
    const s = this.sys;
    const r = recoverArmor(s.armor, s.armorMax, TUNING.scrapRestore);
    s.addArmor(TUNING.scrapRestore);
    this.lastArmor = s.armor;
    // The tell: bright fragments burst off the fallen foe and fly to her chest (the armor is hers at once; the
    // clink and the number come when the first one lands). Drawn additive over the gore, so they read.
    for (let i = 0; i < 7; i++) {
      this.bits.push({
        x: e.x + (fxRandom() - 0.5) * 6, y: e.y - 6 + (fxRandom() - 0.5) * 6,
        vx: (fxRandom() - 0.5) * 4, vy: -0.6 - fxRandom() * 1.8, age: 0, carry: i === 0 ? r.gained : 0, trail: [],
      });
    }
    this.ensureDrawable();
  }

  /** Each tick the fragments steer to her chest; the first to arrive lands the glint, the sound and the number. */
  private flyScrap(): void {
    const ctx = this.ctx, p = ctx.player;
    const tx = p.x, ty = p.y - 9;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.trail.push([b.x, b.y]);
      if (b.trail.length > 4) b.trail.shift();
      b.vx = b.vx * 0.82 + (tx - b.x) * 0.11;
      b.vy = b.vy * 0.82 + (ty - b.y) * 0.11;
      b.x += b.vx;
      b.y += b.vy;
      b.age++;
      const arrived = Math.hypot(tx - b.x, ty - b.y) < 3.5;
      if (!arrived && b.age < SCRAP_MAX_AGE) continue;
      this.bits.splice(i, 1);
      if (!arrived || p.dead) continue;
      if (b.carry > 0) {
        ctx.sparks?.burst(tx, ty, { count: 10, speed: 1.8, colors: SPARK_STEEL, kind: 'spark', glow: 1.4, radius: 2, life: 16 });
        ctx.audio.sfx('body.impact.metal', p.x, p.y, { gain: 0.7, pitch: 7 });
        if (b.carry > 0.5) ctx.events.emit('combatCallout', { x: p.x, y: p.y - 24, text: `+${Math.round(b.carry)} ARMOR`, tone: 'brass' });
      }
    }
  }

  // ======================================================================== Shoulder Ram

  tactical(): boolean {
    const ctx = this.ctx, p = ctx.player;
    if (p.dead || p.swinging === true) return false;
    const dir = p.facing >= 0 ? 1 : -1;
    if (!this.roomAhead(dir)) {
      ctx.audio.sfx('body.impact.metal', p.x, p.y, { gain: 0.35, pitch: -4 }); // a dull clink: nowhere to run
      return false;
    }
    this.beginRam(dir);
    return true;
  }

  /** Room to charge: she can take a step, or there is wood to break, or a foe to meet. */
  private roomAhead(dir: number): boolean {
    const ctx = this.ctx, p = ctx.player;
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const x = Math.round(p.x), y = Math.round(p.y);
    for (let s = 0; s <= 5; s++) if (ctx.physics.entityFree(x + dir, y - s, PLAYER_HALF_W, h)) return true;
    if (this.woodScan(dir, 3, true) > 0) return true;
    const box = shoulderBox(p.x, p.y, dir, PLAYER_HALF_W, h, TUNING.ram.reach);
    const defs = ctx.enemyCtl.defs;
    for (const e of ctx.enemies) {
      const def = defs[e.kind];
      if (e.hp > 0 && def && boxesOverlap(box, foeBox(e.x, e.y, def.halfW, def.h))) return true;
    }
    return false;
  }

  private beginRam(dir: number): void {
    const s = this.sys, ctx = this.ctx, p = ctx.player;
    this.ramDir = dir;
    this.hitThisRam.clear();
    this.struckThisRam = false;
    this.ensureDrawable();
    this.trail.push({ x: p.x, y: p.y, at: ctx.state.frameCount, dir });
    s.startMove({
      ticks: TUNING.ram.ticks,
      face: true,
      invuln: TUNING.ram.invuln,
      exitVx: dir * TUNING.ram.exitSpeed,
      exitVy: 0,
      step: () => this.ramStep(),
      onStep: () => this.ramContact(),
      onEnd: (reason) => this.ramEnd(reason),
    });
    // The launch: she kicks off the ground. Dust and sparks behind, a low drum, a bloom.
    const feetY = p.y;
    this.dust(p.x - dir * 3, feetY, -dir, 9, 1.8);
    ctx.sparks?.burst(p.x - dir * 4, feetY - 1, {
      count: 10, speed: 2.4, spread: 0.7, angle: dir > 0 ? Math.PI : 0, life: 18, colors: SPARK_HOT, kind: 'spark', glow: 1.2, radius: 2,
    });
    ctx.audio.sfx('player.dive', p.x, p.y, { gain: 0.9, pitch: -5 });
    ctx.audio.sfx('creature.golem.step', p.x, p.y, { gain: 0.8, pitch: -2 });
    punch(ctx, 0.012, 0.3);
  }

  /** Before the body moves: break the Wood it is about to meet. */
  private ramStep(): { dx: number; dy: number } {
    const dir = this.ramDir;
    const broke = this.woodScan(dir, TUNING.ram.speed, false);
    if (broke > 0) this.woodBroke(dir, broke);
    // She charges level: over a gap she holds her height (the charge is 44 cells at most) and falls the moment
    // it ends. A fall inside it would trade a pit for a wall at the far lip, and a vertical step that fails
    // ends the system's move as if she had hit one.
    return { dx: dir * TUNING.ram.speed, dy: 0 };
  }

  /**
   * Wood in the box ahead of the body (the rows she fills, plus a little headroom): counted when
   * `countOnly` (and the scan stops at the first), else broken: part to Ember, the rest cleared, with
   * splinters of the same wood flung ahead.
   */
  private woodScan(dir: number, dist: number, countOnly: boolean): number {
    const ctx = this.ctx, w = ctx.world, p = ctx.player;
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const y1 = Math.round(p.y), y0 = y1 - (h - 1) - TUNING.ram.headroom;
    let n = 0;
    const cols = ramColumns(p.x, dir, PLAYER_HALF_W, dist);
    // Embers only where nothing near can catch from them (see TINDER): decided once per scan, when the first Wood is found.
    let emberSafe: boolean | null = null;
    for (const X of cols) {
      for (let Y = y0; Y <= y1; Y++) {
        if (!w.inBounds(X, Y)) continue;
        const i = w.idx(X, Y);
        if (w.types[i] !== Cell.Wood) continue;
        n++;
        if (countOnly) return n;
        const color = w.colors[i];
        emberSafe ??= countIn(TINDER, (x, y) => (w.inBounds(x, y) ? w.types[w.idx(x, y)] : 0),
          Math.min(...cols) - 3, y0 - 3, Math.max(...cols) + 3, y1 + 3) === 0;
        if (emberSafe && entityRandom() < TUNING.ram.emberShare) w.replaceCellAt(i, Cell.Ember, emberColor());
        else w.clearCellAt(i);
        // Splinters of the very wood that broke, flung the way she is going.
        if (n <= 14 || entityRandom() < 0.2) {
          ctx.particles.spawn(X, Y, dir * (0.8 + entityRandom() * 2.4), -0.4 - entityRandom() * 1.6, null, color, 22 + Math.floor(entityRandom() * 14), { grav: 0.07 });
        }
      }
    }
    return n;
  }

  private woodBroke(dir: number, n: number): void {
    const ctx = this.ctx, p = ctx.player;
    ctx.audio.sfx('body.smash.wood', p.x + dir * 8, p.y - 8, { gain: Math.min(1.2, 0.6 + n * 0.01) });
    ctx.sparks?.burst(p.x + dir * 8, p.y - 8, {
      count: Math.min(12, 3 + (n >> 3)), speed: 2.2, spread: 0.9, angle: dir > 0 ? 0 : Math.PI, life: 22, colors: SPARK_HOT, kind: 'ember', glow: 1.1, radius: 4,
    });
    punch(ctx, 0.01, 0.2);
    // A broken barricade is a struck one: a lever on it flips, a rune glyph in it answers (once per charge).
    if (!this.struckThisRam) {
      this.struckThisRam = true;
      ctx.mechanisms.strike(ctx, p.x + dir * (PLAYER_HALF_W + 6), p.y - 8, TUNING.ram.strikeRadius);
    }
  }

  /** After the body moved: the shoulder meets whatever is in front of it. */
  private ramContact(): void {
    const ctx = this.ctx, p = ctx.player, dir = this.ramDir, now = ctx.state.frameCount;
    this.trail.push({ x: p.x, y: p.y, at: now, dir });
    if (p.grounded && now % 2 === 0) this.dust(p.x - dir * 4, p.y, -dir, 2, 1.1);
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const box = shoulderBox(p.x, p.y, dir, PLAYER_HALF_W, h, TUNING.ram.reach);
    const defs = ctx.enemyCtl.defs;
    const hits = this.scratch;
    hits.length = 0;
    for (const e of ctx.enemies) {
      if (e.hp <= 0 || this.hitThisRam.has(e)) continue;
      const def = defs[e.kind];
      if (!def || !boxesOverlap(box, foeBox(e.x, e.y, def.halfW, def.h))) continue;
      // The shoulder does not reach through rock: a foe on the far side of a wall is spared.
      const fx = e.x - p.x, fy = e.y - def.h * 0.5 - (p.y - 8), d = Math.hypot(fx, fy);
      if (d > 2 && castToSolid(ctx, p.x, p.y - 8, fx / d, fy / d, Math.floor(d - 1)).hit) continue;
      hits.push(e);
    }
    for (let i = 0; i < hits.length; i++) this.landBlow(hits[i], dir);
    hits.length = 0;
  }

  private landBlow(e: Enemy, dir: number): void {
    const s = this.sys, ctx = this.ctx, p = ctx.player;
    this.hitThisRam.add(e);
    this.rammedAt.set(e, ctx.state.frameCount);
    // The blow is melee: a kill now restores armor (the system's recentMelee window is this tick and the next).
    s.noteMelee();
    s.hurt(e, TUNING.ram.damage, dir * 2.4, -0.8);
    if (e.hp <= 0) this.scrap(e);
    else {
      ctx.enemyCtl.gustShove(e, dir, TUNING.ram.shoveDown, TUNING.ram.shove);
      const now = ctx.state.frameCount;
      if (!isWardedBoss(e.kind)) this.stunQueue.push({ e, at: now + TUNING.ram.stunDelay, by: now + TUNING.ram.stunWait });
    }
    const hx = p.x + dir * (PLAYER_HALF_W + 2), hy = p.y - 9;
    ctx.sparks?.burst(hx, hy, {
      count: 14, speed: 3.2, spread: 1.1, angle: dir > 0 ? -0.3 : Math.PI + 0.3, life: 20, colors: SPARK_HOT, kind: 'spark', glow: 1.4, radius: 3,
    });
    ctx.particles.burst(hx, hy, 6, null, () => packRGB(255, 170 + ((fxRandom() * 60) | 0), 70), 2.4, { glow: 1.6, grav: 0.04 });
    ctx.audio.sfx('body.bash', hx, hy, { gain: 1.1, pitch: -2 });
    ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, e.hp <= 0 ? 4 : 3);
    punch(ctx, 0.02, 0.4);
  }

  private runStuns(now: number): void {
    const ctx = this.ctx;
    for (let i = this.stunQueue.length - 1; i >= 0; i--) {
      const q = this.stunQueue[i];
      // The stun waits for the shove to play out (it pins the foe's velocity to zero): until the flight is over, or too long.
      if (now < q.at || ((q.e.knockT ?? 0) > 1 && now < q.by)) continue;
      this.stunQueue.splice(i, 1);
      if (q.e.hp > 0 && ctx.enemies.includes(q.e)) this.sys.stunEnemy(q.e, TUNING.ram.stunTicks);
    }
  }

  private ramEnd(reason: 'done' | 'blocked' | 'cancelled'): void {
    const ctx = this.ctx, p = ctx.player, dir = this.ramDir;
    if (reason === 'cancelled') return;
    if (reason === 'done') {
      this.dust(p.x - dir * 2, p.y, -dir, 6, 1.4);
      ctx.audio.sfx('player.skid', p.x, p.y, { gain: 0.8 });
      return;
    }
    // Blocked: a wall. Find what she hit so it sounds like it.
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const wx = Math.round(p.x) + dir * (PLAYER_HALF_W + 1);
    let mat: number = Cell.Stone, wy = Math.round(p.y) - 8;
    for (let dy = 0; dy < h; dy += 2) {
      const X = wx, Y = Math.round(p.y) - dy;
      if (ctx.world.inBounds(X, Y) && ctx.physics.cellBlocks(X, Y)) { mat = ctx.world.types[ctx.world.idx(X, Y)]; wy = Y; break; }
    }
    const metal = mat === Cell.Metal;
    ctx.audio.sfx(metal ? 'body.impact.metal' : 'body.impact.stone', wx, wy, { gain: 1.3, pitch: -3 });
    ctx.audio.sfx('player.land.hard', p.x, p.y, { gain: 0.9 });
    ctx.sparks?.burst(wx - dir, wy, {
      count: metal ? 16 : 9, speed: 2.8, spread: 1.3, angle: dir > 0 ? Math.PI : 0, life: 20, colors: metal ? SPARK_STEEL : SPARK_HOT, kind: 'spark', glow: metal ? 1.6 : 0.9, radius: 3,
    });
    this.dust(wx - dir, wy, -dir, 8, 1.6);
    punch(ctx, 0.03, 0.35);
    ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 2);
    p.vx = -dir * 0.7; // rebound off the wall: she does not stay glued to it
    // The concussion carries into whatever is bolted to the wall (a lever, a rune glyph): once per charge.
    if (!this.struckThisRam) {
      this.struckThisRam = true;
      ctx.mechanisms.strike(ctx, wx, wy, TUNING.ram.strikeRadius);
    }
  }

  /** Kicked-up grit: a dry, grey puff along the ground. */
  private dust(x: number, y: number, dir: number, n: number, speed: number): void {
    const ctx = this.ctx;
    for (let k = 0; k < n; k++) {
      ctx.particles.spawn(x + (fxRandom() - 0.5) * 3, y - fxRandom() * 3,
        dir * (0.4 + fxRandom() * speed) , -0.2 - fxRandom() * 0.9, null,
        packRGB(176 + ((fxRandom() * 24) | 0), 166 + ((fxRandom() * 20) | 0), 146), 12 + ((fxRandom() * 10) | 0), { grav: 0.05 });
    }
  }

  // ======================================================================== Kiln Heart

  ultimate(): boolean {
    const s = this.sys, ctx = this.ctx, p = ctx.player;
    this.kilnOn = true;
    this.primed = true;
    s.setArmorMax(TUNING.kiln.armorMax, true);
    this.lastArmor = s.armor;
    s.setMod('kiln-heart', TUNING.kiln.duration + 2, { damageTaken: TUNING.kiln.damageTaken });
    // Her furnace core blazes: a warm light that rides her chest for the whole burn and cools over its last third.
    this.kilnLight = s.addLight(p.x, p.y - 9, { rgb: [KILN_RGB[0] / 255, KILN_RGB[1] / 255, KILN_RGB[2] / 255], intensity: 0.95, radius: 76, bloom: 0.7, flicker: 0.16 }, TUNING.kiln.duration);
    s.addLight(p.x, p.y - 9, { rgb: [1, 0.62, 0.25], intensity: 1.7, radius: 120, bloom: 1.0, flicker: 0.05 }, 16);
    this.ensureDrawable();
    ctx.sparks?.burst(p.x, p.y - 9, { count: 26, speed: 3.4, colors: SPARK_HOT, kind: 'ember', glow: 1.5, radius: 3, life: 36 });
    ctx.particles.burst(p.x, p.y - 9, 14, null, () => packRGB(255, 140 + ((fxRandom() * 70) | 0), 40), 2.6, { glow: 2.2, grav: -0.01 });
    ctx.audio.sfx('spell.emberstorm', p.x, p.y, { gain: 0.9, pitch: -5 });
    ctx.audio.sfx('mat.ignite', p.x, p.y, { gain: 1 });
    punch(ctx, 0.025, 0.7);
    s.callout('KILN HEART');
    return true;
  }

  ultimateTick(remaining: number): void {
    const ctx = this.ctx, p = ctx.player, now = ctx.state.frameCount;
    const l = this.kilnLight;
    if (l) {
      l.x = p.x; l.y = p.y - 9;
      // In its last second the fire gutters: the flicker deepens, so the end is something you see coming.
      l.flicker = remaining < 70 ? 0.34 : 0.16;
    }
    // A vent of embers off her shoulders: two a quarter-second, a small tell that the heart is lit.
    if (now % 8 === 0) {
      for (let k = 0; k < 2; k++) {
        ctx.particles.spawn(p.x + (fxRandom() - 0.5) * 8, p.y - 11 - fxRandom() * 5, (fxRandom() - 0.5) * 0.4, -0.5 - fxRandom() * 0.5,
          null, packRGB(255, 120 + ((fxRandom() * 80) | 0), 30), 24 + ((fxRandom() * 14) | 0), { glow: 1.8, grav: -0.006 });
      }
    }
    if (remaining === 60) ctx.audio.sfx('mat.sizzle', p.x, p.y, { gain: 0.8 });
  }

  ultimateEnd(): void {
    const s = this.sys, ctx = this.ctx, p = ctx.player;
    const wasOn = this.kilnOn;
    this.kilnOn = false;
    this.kilnLight = null;
    s.clearMod('kiln-heart');
    // The ceiling returns to 40 and whatever she carried above it is spent: setArmorMax clamps the pool.
    s.setArmorMax(TUNING.armorMax, false);
    this.lastArmor = s.armor;
    if (wasOn && !p.dead) {
      ctx.particles.burst(p.x, p.y - 10, 10, null, () => packRGB(190 + ((fxRandom() * 30) | 0), 190, 196), 1.0, { grav: -0.03 });
      ctx.audio.sfx('mat.steam', p.x, p.y, { gain: 0.8 });
      s.callout('HEART COOLS');
    }
  }

  /** onPlayerHurt: health lost (after armor). The armor-absorbed blows reach the same place through `tick`. */
  onPlayerHurt(_lost: number, source: string | undefined): void {
    this.kilnHit(source);
  }

  private kilnHit(source: string | undefined): void {
    if (!this.kilnOn) return;
    const s = this.sys, ctx = this.ctx, p = ctx.player, now = ctx.state.frameCount;
    if (!burstReady(now, this.lastBurstAt, TUNING.kiln.burstGuard) || !isFoeBlow(source)) return;
    if (s.enemiesNear(p.x, p.y - 8, TUNING.kiln.burstRange).length === 0) return;
    this.lastBurstAt = now;
    this.vent();
  }

  /** The furnace answers: real Ember cells around her, and every foe within reach is scorched and set alight. */
  private vent(): void {
    const s = this.sys, ctx = this.ctx, p = ctx.player, w = ctx.world;
    const cx = p.x, cy = p.y - 9;
    // The furnace banks its embers when oil, powder or bog gas is near her, or she is soaked in oil herself:
    // a pool fire at her own feet is not the answer to a blow. (The foes are still scorched.)
    const fuelNear = p.status.oiled > 0 || countIn(FUEL, (x, y) => (w.inBounds(x, y) ? w.types[w.idx(x, y)] : 0),
      Math.round(cx) - 8, Math.round(cy) - 8, Math.round(cx) + 8, Math.round(cy) + 8) > 0;
    if (!fuelNear) for (const [x, y] of emberSpots(cx, cy, 11, TUNING.kiln.burstEmbers, entityRandom, (px, py) => {
      if (!w.inBounds(px, py)) return false;
      const t = w.types[w.idx(px, py)];
      return t === Cell.Empty || isGas(t);
    })) {
      w.replaceCellAt(w.idx(x, y), Cell.Ember, emberColor());
    }
    const foes = s.enemiesNear(cx, cy, TUNING.kiln.burstRadius).slice();
    for (const e of foes) {
      if (e.hp <= 0) continue;
      const away = Math.sign(e.x - p.x) || 1;
      s.hurt(e, TUNING.kiln.burstDamage, away * 1.2, -0.6);
      if (e.hp > 0) this.ignite(e);
    }
    ctx.sparks?.burst(cx, cy, { count: 18, speed: 3, colors: SPARK_HOT, kind: 'ember', glow: 1.5, radius: 4, life: 30 });
    ctx.particles.burst(cx, cy, 10, null, () => packRGB(255, 120 + ((fxRandom() * 90) | 0), 30), 2.2, { glow: 2, grav: 0.02 });
    s.addLight(cx, cy, { rgb: [1, 0.55, 0.2], intensity: 1.5, radius: 70, bloom: 0.9, flicker: 0.05 }, 12);
    ctx.audio.sfx('spell.emberstorm', p.x, p.y, { gain: 0.7, pitch: 2 });
    ctx.audio.sfx('mat.ignite', p.x, p.y, { gain: 0.8, pitch: -2 });
    punch(ctx, 0.015, 0.5);
  }

  private ignite(e: Enemy): void {
    // Heat well past the engine's 'hot enough' line: certain for any foe that can burn, nothing for the fireproof.
    rollCatchFire(e.status, 40, 0, FIREPROOF.has(e.kind), TUNING.kiln.burnTicks, TUNING.kiln.burnOiledTicks);
  }

  // ======================================================================== drawing

  private ensureDrawable(): void {
    if (!this.sys.drawables.includes(this.drawable)) this.sys.addDrawable(this.drawable);
  }

  /**
   * Over the foes and the light, additive: heat streaks trailing the ram with a hot shoulder at its front,
   * and the furnace core in her chest while Kiln Heart burns. (The art is the look track's; this is only
   * the ability's own glow, and it keeps off the body itself so the look still reads.)
   */
  private draw(out: Parameters<FighterDrawable['draw']>[0], ctx: Ctx): void {
    const px = out.addFinePx ?? out.addPx;
    const step = out.addFinePx ? (out.pixelStep ?? 1) : 1;
    const now = ctx.state.frameCount, calm = ctx.state.reduceFlashes === true;
    const life = TUNING.ram.trailLife;
    for (const t of this.trail) {
      const k = 1 - (now - t.at) / life;
      if (k <= 0) continue;
      const a = k * k * (calm ? 0.45 : 0.85);
      // Streaks off her back at five heights, a little different each tick so they read as air torn by heat, not a sprite.
      for (let j = 0; j < 5; j++) {
        const row = 2 + j * 3 + ((t.at + j) & 1);
        const len = 6 + ((t.at * 7 + j * 5) % 5);
        for (let c = 0; c < len; c += step) {
          const f = a * (1 - c / len);
          px.call(out, t.x - t.dir * (PLAYER_HALF_W + 1 + c), t.y - row, f, f * 0.42, f * 0.08);
        }
      }
    }
    for (const b of this.bits) {
      // A white-gold fragment with a short tail: additive, so it is brightest over the gore it is flying through.
      const k = calm ? 0.6 : 1;
      for (let t = 0; t < b.trail.length; t++) {
        const f = ((t + 1) / (b.trail.length + 1)) * 0.5 * k;
        px.call(out, b.trail[t][0], b.trail[t][1], f, f * 0.9, f * 0.55);
      }
      for (let dy = 0; dy < 2; dy += step) for (let dx = 0; dx < 2; dx += step) px.call(out, b.x + dx - 0.5, b.y + dy - 0.5, k, k * 0.92, k * 0.6);
    }
    const p = ctx.player;
    if (ctx.fighters?.ownsMovement === true && this.trail.length > 0) {
      // The shoulder that drives: a hot spot at the front of the charge.
      const cx = p.x + this.ramDir * (PLAYER_HALF_W + 1), cy = p.y - 11, R = 4;
      for (let dy = -R; dy <= R; dy += step) {
        for (let dx = -R; dx <= R; dx += step) {
          const d2 = (dx * dx + dy * dy) / (R * R);
          if (d2 > 1) continue;
          const f = (1 - d2) * (1 - d2) * (calm ? 0.45 : 0.8);
          px.call(out, cx + dx, cy + dy, f, f * 0.55, f * 0.18);
        }
      }
    }
    if (this.kilnOn) {
      // The core: a hot disc over her chest, pulsing. In the last ~70 ticks it gutters (a fast, deep flicker
      // on a fading floor), so the end is something you see coming; then it goes out with the hiss.
      const u = Math.min(1, ctx.fighters?.view.ultimate.active ?? 1);
      const guttering = u < 70 / TUNING.kiln.duration;
      const fade = guttering ? 0.35 + 0.65 * Math.min(1, u * TUNING.kiln.duration / 70) : 1;
      const pulse = guttering
        ? 0.5 + 0.5 * Math.sin(now * (calm ? 0.35 : 0.8))
        : 0.75 + 0.25 * Math.sin(now * 0.21) + (calm ? 0 : 0.1 * Math.sin(now * 0.57));
      const cx = p.x + p.facing * 0.5, cy = p.y - 9, R = 4.5;
      for (let dy = -R; dy <= R; dy += step) {
        for (let dx = -R; dx <= R; dx += step) {
          const d2 = (dx * dx + dy * dy) / (R * R);
          if (d2 > 1) continue;
          const f = (1 - d2) * (1 - d2) * pulse * fade * (calm ? 0.7 : 1);
          px.call(out, cx + dx, cy + dy, f * 0.9, f * 0.47, f * 0.13);
        }
      }
    }
  }

  // ======================================================================== lifecycle

  reset(): void {
    this.trail.length = 0;
    this.stunQueue.length = 0;
    this.bits.length = 0;
    this.hitThisRam.clear();
    this.kilnLight = null;
    this.lastBurstAt = -999;
    // (The system has already dropped the drawables and the lights: `ensureDrawable` re-adds on the next use.)
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }

  save(): Record<string, number> {
    return { primed: this.primed ? 1 : 0 };
  }

  load(_bag: Record<string, number>): void {
    // The system has restored the pool; set the ceiling around it (the pool clamps, it is not refilled).
    this.sys.setArmorMax(TUNING.armorMax, false);
    this.primed = true;
    this.lastArmor = this.sys.armor;
  }
}

export const kit: FighterKitDef = {
  id: 'rusk-emberjaw',
  tacticalCooldown: TUNING.ram.cooldown,
  ultimateDuration: TUNING.kiln.duration,
  create: (sys) => new RuskKit(sys),
};
