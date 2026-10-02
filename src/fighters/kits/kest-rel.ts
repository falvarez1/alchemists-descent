import { entityRandom, fxRandom } from '@/core/simRandom';
import type { Ctx, Enemy } from '@/core/types';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W, PLAYER_STEP_UP } from '@/core/types';
import { aimOf, punch } from '@/fighters/effects';
import type { FighterSystem } from '@/fighters/FighterSystem';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import { BOX_H, drawFurnace } from '@/fighters/kits/kest-rel-furnace';
import type { FurnaceView } from '@/fighters/kits/kest-rel-furnace';
import {
  blockedAxes, columnFrac, foeKnockVy, inColumn, riderVy, simulateDash, slideAlong, smokeLife,
} from '@/fighters/kits/kest-rel-math';
import type { DashSpec, FoeModel, RiderModel } from '@/fighters/kits/kest-rel-math';
import { Cell, blocksEntity, isGas, isLiquid } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * KEST REL, the Chimney Jack (Duelist). docs/FIGHTERS.md "05", docs/fighters/kest-rel.md.
 *
 *  - Rooftop Runner (passive): a permanent climb modifier. Player's climb accumulator and its mantle reach
 *    both read `climbScale()`, so one number makes ladders and walls faster and lets her top out of a ledge
 *    a few cells higher than anyone else.
 *  - Smoke Step (Z): a body-owning dash along the aim that leaves a puff of real Smoke at both ends and
 *    hides her for a while: enemies' sight range is scaled by `concealment()` (Enemies.update).
 *  - Updraft (T): a furnace at her feet drives a column of rising air. The column is explained by real
 *    cells (Fire in the mouth, Steam and soot rising from it) and lifts what stands in it: she rides it
 *    (a buoyant draft that balances near the top), foes are hoisted by their knock state and flung out,
 *    crates float up by a velocity kick.
 *
 * Nothing here writes a solid. Smoke, Fire and Steam only: nothing can seal a route.
 *
 * Numbers are first-pass tuning, live-tunable like config/params; the probe (scripts/verify-fighter-kest.mjs)
 * and tests/fighters-kest.test.ts decide the final values.
 */
export const TUNING = {
  passive: {
    id: 'rooftop-runner',
    /** x the climb rate (Player's CLIMB_RATE_UP / DOWN accumulator). Anything above 1 also lengthens the mantle reach. */
    climbScale: 1.5,
    /** A mantle that rose at least this many cells could not have been made by anyone else (Player's CLIMB_MANTLE_MAX_UP + 1). */
    bonusMantle: 21,
  },
  step: {
    id: 'smoke-step',
    cooldown: 480,
    ticks: 6,
    /** Cells per tick along the aim: 6 x 6 = 36. */
    speed: 6,
    invuln: 5,
    /** A dash with less than this many cells of room is refused and costs nothing. */
    minRoom: 8,
    puffRadius: 7,
    puffLifeMin: 40,
    puffLifeMax: 70,
    /** How unseen she is, and for how long. */
    concealment: 0.6,
    concealTicks: 150,
  },
  updraft: {
    id: 'updraft-heat',
    duration: 360,
    /** The draft: 18 wide, 90 tall (clipped to the first ceiling). */
    halfW: 9,
    height: 90,
    /** The flame and the lift taper over the last this-many ticks, so the end is a glide, not a drop. */
    fadeTicks: 50,
    /** How long the iron stays on screen, cooling, after the flame is out. */
    coolTicks: 70,
    /** Refused when there is less than this much open air above the furnace: nothing to ride. */
    minRise: 24,
    /** How far below her a floor is still found when she is airborne. */
    maxDrop: 40,
    /** Refused when more than this many cells of the furnace's mouth are liquid: it cannot be lit. */
    liquidRefuse: 12,
    rider: { gravity: 0.28, k: 0.9, fEq: 0.75, liftMax: 0.9, drag: 0.93, riseCap: 3.6, fadeFloor: 0.25 } as RiderModel,
    foe: { lift: 0.5, taper: 0.85, massRef: 40, kMin: 0.45, kMax: 1.3, riseCap: 3.2 } as FoeModel,
    /** Crates and barrels: a velocity kick per tick (cells/tick), and the speed above which it stops. */
    body: { lift: 0.5, cap: 3.2, pull: 0.006 },
    /** A foe is hoisted for at most this long, then flung out sideways, and cannot be caught again for a while. */
    hoistTicks: 90,
    recatchTicks: 80,
    flingVx: 1.7,
    flingVy: 1.1,
    /** The burner: how often and how many Fire / Steam / Smoke cells it writes at the mouth. */
    fire: { every: 2, count: 6, lifeMin: 16, lifeMax: 26 },
    steam: { every: 3, count: 3, lifeMin: 90, lifeMax: 150 },
    soot: { every: 6, count: 2, lifeMin: 60, lifeMax: 110 },
    /** Foes the draft leaves alone: the bosses and anything rooted. */
    skip: ['colossus', 'leviathan', 'rimewarden', 'lenswright', 'eggs', 'stonemaw'] as readonly string[],
  },
};

interface Furnace {
  world: World;
  x: number;
  floorY: number;
  mouthY: number;
  topY: number;
  born: number;
  /** 'lit' while the ultimate runs, then 'cooling' while the iron is left to tick over. */
  state: 'lit' | 'cooling';
  coolLeft: number;
  view: FurnaceView;
}

interface Caught {
  /** The frame it was first lifted, -1 when it is not in the draft. */
  since: number;
  /** It cannot be caught again until this frame. */
  free: number;
}

const SOOT = (): number => packRGB(54 + ((fxRandom() * 22) | 0), 51 + ((fxRandom() * 20) | 0), 52 + ((fxRandom() * 20) | 0));
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Write `cell` into one open cell (air or gas), with a life; false when it is rock, liquid or off the map. */
function putCell(ctx: Ctx, x: number, y: number, cell: number, life: number): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return false;
  const i = w.idx(x, y);
  const t = w.types[i];
  if (t !== Cell.Empty && !isGas(t)) return false;
  w.replaceCellAt(i, cell, COLOR_FN[cell]());
  w.life[i] = life;
  return true;
}

class KestRel implements KitInstance {
  private furnace: Furnace | null = null;
  private removeDrawable: (() => void) | null = null;
  private concealUntil = 0;
  private caught = new WeakMap<Enemy, Caught>();
  private prevClimbing = false;
  private prevY = 0;
  /** Why the last press was refused (the probes read it; the player reads the callout). */
  lastRefusal: string | null = null;

  constructor(private readonly sys: FighterSystem) {
    this.holdPassive();
  }

  // ======================================================================== Rooftop Runner

  /** The passive is a modifier with no end. Floor changes and respawns clear every modifier, so it is re-asserted each tick. */
  private holdPassive(): void {
    const P = TUNING.passive;
    if (!this.sys.hasMod(P.id)) this.sys.setMod(P.id, Number.POSITIVE_INFINITY, { climbScale: P.climbScale });
  }

  tick(): void {
    this.holdPassive();
    this.runnerFx();
    this.concealFx();
    this.coolFurnace();
  }

  /** A little soot off her hands as she climbs, and a flourish when she tops out of a ledge only she could reach. */
  private runnerFx(): void {
    const ctx = this.sys.ctx, p = ctx.player;
    const now = ctx.state.frameCount;
    if (p.climbing && p.climbIntentY !== 0 && now % 6 === 0) {
      ctx.particles.spawn(
        p.x + p.climbDir * (PLAYER_HALF_W + 1), p.y - 4 - fxRandom() * 10,
        -p.climbDir * (0.12 + fxRandom() * 0.2), 0.08 + fxRandom() * 0.15, null, SOOT(), 16, { grav: 0.03 },
      );
    }
    // A mantle is a jump of the body from a hang to a stand in one tick: it climbed and now it does not, and it is higher.
    if (this.prevClimbing && !p.climbing && p.grounded && this.prevY - p.y >= TUNING.passive.bonusMantle) {
      ctx.particles.burst(p.x, p.y - 2, 12, null, SOOT, 1.5, { grav: 0.04 });
      ctx.particles.burst(p.x, p.y - 4, 4, null, () => packRGB(255, 180 + ((fxRandom() * 50) | 0), 70), 1.2, { glow: 1.6, grav: 0.02 });
    }
    this.prevClimbing = p.climbing;
    this.prevY = p.y;
  }

  // ======================================================================== Smoke Step

  tactical(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player;
    const T = TUNING.step;
    const aim = aimOf(ctx);
    const bodyH = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const free = (x: number, y: number): boolean => ctx.physics.entityFree(x, y, PLAYER_HALF_W, bodyH);
    const spec: DashSpec = { speed: T.speed, ticks: T.ticks, stepUp: PLAYER_STEP_UP };
    // No room: a wall at her nose. Refuse, so the cooldown is not spent on a dash that goes nowhere.
    if (simulateDash(free, p.x, p.y, aim.angle, spec).cells < T.minRoom) return this.refuse('NO ROOM TO STEP');
    if (p.swinging) ctx.playerCtl.releaseVine(ctx); // she lets go of the vine and goes
    const vx = Math.cos(aim.angle), vy = Math.sin(aim.angle);

    this.puff(p.x, p.y - 8);
    ctx.audio.sfx('trick.whip', p.x, p.y, { gain: 0.9 });
    ctx.audio.sfx('mat.steam', p.x, p.y, { gain: 0.45 });
    punch(ctx, 0.008, 0.18);
    sys.setMod(T.id, T.concealTicks, { concealment: T.concealment }); // her silhouette is lost in the soot
    this.concealUntil = ctx.state.frameCount + T.concealTicks;

    sys.startMove({
      ticks: T.ticks,
      invuln: T.invuln,
      face: true,
      exitVx: clamp(vx * 3, -3, 3),
      exitVy: clamp(vy * 2.4, -2.4, 2.4),
      // Along the aim; where the aim runs into the floor, a ceiling or a wall beside her she skims it instead of stopping dead.
      step: () => {
        const b = blockedAxes(free, p.x, p.y, vx * T.speed, vy * T.speed, PLAYER_STEP_UP);
        return slideAlong(vx * T.speed, vy * T.speed, b.bx, b.by, T.speed);
      },
      onStep: () => {
        for (let k = 0; k < 3; k++) {
          ctx.particles.spawn(
            p.x + (fxRandom() - 0.5) * 5, p.y - 3 - fxRandom() * 12,
            -vx * (0.1 + fxRandom() * 0.3), -0.04 - fxRandom() * 0.12, null, SOOT(), 22 + ((fxRandom() * 18) | 0), { grav: -0.012 },
          );
        }
      },
      onEnd: (reason) => {
        if (reason === 'cancelled') return; // a death or a new floor: the world this was in is gone
        this.puff(p.x, p.y - 8);
        ctx.audio.sfx('mat.steam', p.x, p.y, { gain: 0.7, pitch: -2 });
        if (reason === 'blocked') {
          ctx.audio.sfx('body.impact.stone', p.x, p.y, { gain: 0.5 });
          punch(ctx, 0.01, 0.1);
        }
      },
    });
    return true;
  }

  /** A puff of soot: real Smoke cells in a ragged disc, each with its own life so the cloud thins unevenly rather than vanishing at once. */
  private puff(cx: number, cy: number): void {
    const ctx = this.sys.ctx;
    const T = TUNING.step;
    const r = T.puffRadius;
    const x0 = Math.round(cx), y0 = Math.round(cy);
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        // a ragged rim: the outer cells are kept less often
        if (entityRandom() < (d2 / (r * r)) * 0.55) continue;
        if (putCell(ctx, x0 + dx, y0 + dy, Cell.Smoke, smokeLife(entityRandom(), T.puffLifeMin, T.puffLifeMax))) n++;
      }
    }
    if (n > 0) ctx.particles.burst(cx, cy, 8, null, SOOT, 1.3, { grav: -0.01 });
  }

  /** Wisps of soot around her while she is hidden, thinning as the cover runs out (the tell, and the end). */
  private concealFx(): void {
    const ctx = this.sys.ctx, p = ctx.player;
    const now = ctx.state.frameCount;
    if (now >= this.concealUntil) return;
    const left = this.concealUntil - now;
    if (now % 3 === 0 && fxRandom() < Math.min(1, left / 30)) {
      ctx.particles.spawn(
        p.x + (fxRandom() - 0.5) * 11, p.y - 2 - fxRandom() * 14, (fxRandom() - 0.5) * 0.18, -0.12 - fxRandom() * 0.12,
        null, SOOT(), 26 + ((fxRandom() * 14) | 0), { grav: -0.01 },
      );
    }
  }

  /** An ability that cannot go off says why (a line over her head, a dry click) and costs nothing. */
  private refuse(why: string): false {
    const ctx = this.sys.ctx, p = ctx.player;
    this.lastRefusal = why;
    ctx.audio.sfx('wand.dry', p.x, p.y);
    this.sys.callout(why);
    return false;
  }

  // ======================================================================== Updraft

  /** Where the furnace can stand, and how far its draft can rise; or why it cannot be lit here. */
  private findSite(): { x: number; floorY: number; mouthY: number; topY: number } | string {
    const ctx = this.sys.ctx, p = ctx.player, w = ctx.world, T = TUNING.updraft;
    const x = Math.round(p.x);
    let y = Math.round(p.y);
    const standing = (yy: number): boolean => !ctx.physics.entityFree(x, yy + 1, 4, 1);
    if (!standing(y)) {
      // airborne: the furnace stands on the first floor below her
      let found = -1;
      for (let d = 1; d <= T.maxDrop; d++) {
        if (standing(y + d) && ctx.physics.entityFree(x, y + d, 4, 3)) { found = y + d; break; }
      }
      if (found < 0) return 'NO FLOOR FOR A FURNACE';
      y = found;
    } else if (!ctx.physics.entityFree(x, y, 4, 3)) return 'NO ROOM FOR A FURNACE';
    const mouthY = y - BOX_H;
    // a furnace cannot be lit under water
    let wet = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (w.inBounds(x + dx, mouthY + dy) && isLiquid(w.types[w.idx(x + dx, mouthY + dy)])) wet++;
    }
    if (wet > T.liquidRefuse) return 'TOO WET TO LIGHT';
    // the draft ends at the first ceiling over any part of it
    let rise = T.height;
    for (let dx = -(T.halfW - 1); dx <= T.halfW - 1; dx += 2) {
      let run = 0;
      while (run < rise && w.inBounds(x + dx, mouthY - 1 - run) && !blocksEntity(w.types[w.idx(x + dx, mouthY - 1 - run)])) run++;
      rise = Math.min(rise, run);
    }
    if (rise < T.minRise) return 'NO ROOM TO RISE';
    return { x, floorY: y, mouthY, topY: mouthY - rise };
  }

  ultimate(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.updraft;
    const site = this.findSite();
    if (typeof site === 'string') return this.refuse(site);
    this.dropFurnace(); // a leftover cooling furnace from the last one
    const now = ctx.state.frameCount;
    const view: FurnaceView = { x: site.x, floorY: site.floorY, mouthY: site.mouthY, topY: site.topY, halfW: T.halfW, born: now, flame: 1, heat: 1 };
    this.furnace = { world: ctx.world, ...site, born: now, state: 'lit', coolLeft: 0, view };
    this.removeDrawable = sys.addDrawable({ layer: 'under', draw: (out, field, c) => drawFurnace(out, field, c, view) });
    sys.addLight(site.x, site.mouthY - 4, { rgb: [1, 0.6, 0.24], intensity: 1.3, radius: 110, bloom: 0.9, flicker: 0.22 }, T.duration + T.coolTicks);
    // Her own furnace does not burn her. (Fire cells at the mouth are the point of it.)
    sys.setMod(T.id, T.duration + 40, { immuneTo: ['fire', 'burning', 'oiled-fire'] });

    // the iron is set down, the burner lights
    ctx.audio.sfx('body.impact.metal', site.x, site.floorY, { gain: 0.9 });
    ctx.audio.sfx('spell.flame.ignite', site.x, site.mouthY, { gain: 1.1 });
    ctx.audio.sfx('mat.ignite', site.x, site.mouthY, { gain: 0.8, pitch: -3 });
    punch(ctx, 0.018, 0.5);
    ctx.particles.burst(site.x, site.floorY, 12, null, () => packRGB(120, 108, 94), 1.7, { grav: 0.05 });
    ctx.particles.burst(site.x, site.mouthY - 2, 14, null, () => packRGB(255, 150 + ((fxRandom() * 80) | 0), 30), 2.2, { glow: 2.4, grav: -0.02 });
    this.feed(1, true);
    // a hop off the ground, so she leaves it the tick the draft takes her
    if (p.grounded && inColumn(site.x, site.topY, site.floorY, T.halfW, p.x, p.y - 8, 2)) p.vy = Math.min(p.vy, -1.4);
    return true;
  }

  ultimateTick(remaining: number): void {
    const f = this.furnace;
    const ctx = this.sys.ctx;
    if (!f || f.state !== 'lit' || f.world !== ctx.world) return;
    const T = TUNING.updraft;
    const fade = clamp(remaining / T.fadeTicks, 0, 1);
    f.view.flame = fade;
    ctx.player.status.burning = 0; // her own furnace's flames do not stick to her
    this.feed(fade, false);
    this.lift(f, fade);
  }

  ultimateEnd(): void {
    const f = this.furnace;
    if (!f) return;
    const ctx = this.sys.ctx;
    f.state = 'cooling';
    f.coolLeft = TUNING.updraft.coolTicks;
    f.view.flame = 0;
    if (f.world === ctx.world) {
      ctx.audio.sfx('body.burnout', f.x, f.mouthY, { gain: 0.9 });
      ctx.audio.sfx('mat.steam', f.x, f.mouthY, { gain: 0.6, pitch: -4 });
      ctx.particles.burst(f.x, f.mouthY - 2, 10, null, SOOT, 1.2, { grav: -0.012 });
    }
    // a foe still hoisted when the flame dies is let go (it falls on its own)
    this.caught = new WeakMap();
  }

  /** The furnace is out: the iron ticks down and fades from view. */
  private coolFurnace(): void {
    const f = this.furnace;
    if (!f || f.state !== 'cooling') return;
    f.coolLeft--;
    f.view.heat = Math.max(0, f.coolLeft / TUNING.updraft.coolTicks);
    if (f.coolLeft <= 0) this.dropFurnace();
  }

  private dropFurnace(): void {
    this.removeDrawable?.();
    this.removeDrawable = null;
    this.furnace = null;
  }

  /** The burner: real Fire in the mouth, Steam and a little soot rising from it. `fade` thins it as the flame dies. */
  private feed(fade: number, burst: boolean): void {
    const f = this.furnace;
    const ctx = this.sys.ctx;
    if (!f || f.world !== ctx.world) return;
    const T = TUNING.updraft;
    const now = ctx.state.frameCount;
    const sputter = fade < 0.5 && entityRandom() > fade * 2; // a dying burner coughs
    if ((burst || now % T.fire.every === 0) && !sputter) {
      const n = Math.max(1, Math.round(T.fire.count * (burst ? 2 : fade)));
      for (let k = 0; k < n; k++) {
        const x = f.x + Math.round((entityRandom() * 2 - 1) * 3);
        const y = f.mouthY - Math.floor(entityRandom() * 3);
        putCell(ctx, x, y, Cell.Fire, T.fire.lifeMin + Math.floor(entityRandom() * (T.fire.lifeMax - T.fire.lifeMin + 1)));
      }
    }
    if ((burst || now % T.steam.every === 0) && !sputter) {
      const n = Math.max(1, Math.round(T.steam.count * (burst ? 3 : fade)));
      for (let k = 0; k < n; k++) {
        const x = f.x + Math.round((entityRandom() * 2 - 1) * 4);
        const y = f.mouthY - 3 - Math.floor(entityRandom() * 3);
        putCell(ctx, x, y, Cell.Steam, smokeLife(entityRandom(), T.steam.lifeMin, T.steam.lifeMax));
      }
    }
    if (!burst && now % T.soot.every === 0 && fade > 0.3) {
      for (let k = 0; k < T.soot.count; k++) {
        const x = f.x + Math.round((entityRandom() * 2 - 1) * 3);
        putCell(ctx, x, f.mouthY - 7, Cell.Smoke, smokeLife(entityRandom(), T.soot.lifeMin, T.soot.lifeMax));
      }
    }
    // embers that ride the draft (cosmetic, so they never touch the world)
    if (!burst && fade > 0.15) {
      const n = fxRandom() < fade ? 1 : 0;
      for (let k = 0; k < n + (fxRandom() < 0.3 * fade ? 1 : 0); k++) {
        ctx.particles.spawn(
          f.x + (fxRandom() * 2 - 1) * 4, f.mouthY - 1, (fxRandom() - 0.5) * 0.35, -(1.6 + fxRandom() * 1.8),
          null, packRGB(255, 120 + ((fxRandom() * 90) | 0), 14), 30 + ((fxRandom() * 28) | 0), { glow: 2.4, grav: -0.012 },
        );
      }
    }
  }

  /** Everything standing in the column is pushed up: her (a rider), the foes (hoisted, then flung), the crates. */
  private lift(f: Furnace, fade: number): void {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.updraft;
    const now = ctx.state.frameCount;

    // ---- the rider ----
    if (!p.dead && !p.swinging && !p.climbing && !sys.ownsMovement) {
      const by = p.y - 8;
      if (inColumn(f.x, f.topY, f.floorY, T.halfW, p.x, by, 2)) {
        p.vy = riderVy(p.vy, columnFrac(f.mouthY, f.topY, by), fade, T.rider);
        p.hat.vy -= 0.1; // the hat streams up
      }
    }

    // ---- the foes ----
    const defs = ctx.enemyCtl.defs;
    for (const e of ctx.enemies) {
      if (e.hp <= 0 || e.boss || T.skip.includes(e.kind)) continue;
      const def = defs[e.kind];
      if (!def) continue;
      const cy = e.y - def.h * 0.5;
      let st = this.caught.get(e);
      if (!inColumn(f.x, f.topY, f.floorY, T.halfW, e.x, cy, def.halfW)) {
        // it left the draft: it may be caught again after a while. Out of the top, it is thrown clear of the axis too.
        if (st && st.since >= 0) {
          st.since = -1;
          st.free = now + T.recatchTicks;
          if (cy < f.topY + 8) this.fling(e, f);
        }
        continue;
      }
      if (!st) this.caught.set(e, st = { since: -1, free: 0 });
      if (now < st.free) continue;
      if (st.since < 0) {
        st.since = now;
        ctx.particles.burst(e.x, e.y - def.h * 0.5, 6, null, () => packRGB(255, 170 + ((fxRandom() * 60) | 0), 60), 1.4, { glow: 1.6, grav: -0.02 });
        ctx.audio.sfx('flora.whoosh', e.x, e.y, { gain: 0.5, pitch: 3 });
      }
      if (now - st.since > T.hoistTicks) {
        // a heavy foe that has hung in the draft long enough is thrown out of it
        this.fling(e, f);
        st.since = -1;
        st.free = now + T.recatchTicks;
        continue;
      }
      e.knockVy = foeKnockVy(e.knockVy ?? 0, columnFrac(f.mouthY, f.topY, cy), def.halfW * def.h, fade, T.foe);
      e.knockVx = (e.knockVx ?? 0) * 0.85 + (f.x - e.x) * 0.012;
      e.knockT = Math.max(e.knockT ?? 0, 3);
      e.sleeping = false;
    }

    // ---- the crates and barrels ----
    const rb = ctx.rigidBodies;
    if (rb) {
      const kick = T.body.lift * (0.25 + 0.75 * fade);
      for (const b of rb.bodies) {
        if (b.kind !== 'dynamic' || b === rb.playerCorpse) continue;
        const half = b.shape.kind === 'box' ? b.shape.halfW : b.shape.radius;
        if (!inColumn(f.x, f.topY, f.floorY, T.halfW, b.x, b.y, half)) continue;
        if (b.vy > -T.body.cap) rb.applyImpulse(b, (f.x - b.x) * T.body.pull, -kick);
      }
    }
  }

  /** Thrown clear of the draft, away from its axis (it keeps whatever way up it was going, and falls where it lands). */
  private fling(e: Enemy, f: Furnace): void {
    const T = TUNING.updraft;
    const side = Math.abs(e.x - f.x) < 1 ? (entityRandom() < 0.5 ? -1 : 1) : Math.sign(e.x - f.x);
    e.knockVx = side * T.flingVx * (0.75 + entityRandom() * 0.5);
    e.knockVy = Math.min(e.knockVy ?? 0, -T.flingVy);
    e.knockT = Math.max(e.knockT ?? 0, 26);
  }

  // ======================================================================== lifecycle

  reset(): void {
    this.dropFurnace();
    this.concealUntil = 0;
    this.caught = new WeakMap();
    this.prevClimbing = false;
  }

  dispose(): void {
    this.reset();
  }
}

export const kit: FighterKitDef = {
  id: 'kest-rel',
  tacticalCooldown: TUNING.step.cooldown,
  ultimateDuration: TUNING.updraft.duration,
  create: (sys) => new KestRel(sys),
};
