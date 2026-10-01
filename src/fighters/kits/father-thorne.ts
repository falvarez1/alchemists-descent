import type { FighterDrawable, FighterMeter } from '@/core/fighters';
import { entityRandom, fxRandom } from '@/core/simRandom';
import type { Enemy } from '@/core/types';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { aimOf, punch } from '@/fighters/effects';
import type { FighterSystem } from '@/fighters/FighterSystem';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import { Crop } from '@/fighters/kits/father-thorne-crop';
import type { CropCell, GrowReport } from '@/fighters/kits/father-thorne-crop';
import { FLARE_TICKS, drawThorneFx } from '@/fighters/kits/father-thorne-fx';
import type { ThorneView } from '@/fighters/kits/father-thorne-fx';
import {
  Camouflage, TUNING, coverCells, isStill, planIronvine, planOvergrowth, witherDie,
} from '@/fighters/kits/father-thorne-grow';
import type { SkipFn } from '@/fighters/kits/father-thorne-grow';
import { Cell } from '@/sim/CellType';

export { TUNING } from '@/fighters/kits/father-thorne-grow';

/**
 * FATHER THORNE, the Briar Heretic (Controller). docs/FIGHTERS.md "10", docs/fighters/father-thorne.md.
 *
 *  - Rooted Camouflage (passive): still for a second, grounded, within 10 cells of >= 6 cells of natural
 *    cover (Moss, Leaf, Trunk, Vines, Fungus, Glowshroom), and `concealment()` climbs 0 -> 0.6 over three
 *    seconds; a step drops it to 0 at once. Leaf motes stir round her while it works, and a "Rooted" meter shows.
 *  - Ironvine (Z): thorny Vines grown along the surface in the aim, up to 60 cells, 2-3 deep: REAL cells that
 *    burn and can be cut. A foe in or on them is slowed x0.5 and scratched; the first one caught is marked. They
 *    wither on their own after ~25 s (a ledger over the cells: Vines do not age by themselves).
 *  - Overgrowth (T): radius 70 of roots (Trunk) hung from ceilings and up walls, Moss and Leaf ground cover and
 *    hanging Vines, swept out over a second. Inside it she is concealed (0.7), foes are slowed x0.6, and the
 *    roots are hand-holds (the `climbHold` seam). It browns and withers when the effect ends.
 *
 * Everything written is soft growth (a body walks through it): nothing can seal a route.
 */

const GREEN: readonly [number, number, number] = [0.4, 1, 0.5];
const SPORES = [0xb8e6a0, 0x7fd68a, 0xe8f2c0, 0x5fbf7a] as const;
const LEAF_COLOURS = [0x6ea84a, 0x8cc060, 0x4f8a3a, 0xb8a050] as const;
const DUST_COLOURS = [0x8a7240, 0x6b5a34, 0x9a8450] as const;

interface Zone {
  cx: number;
  cy: number;
  born: number;
  world: Crop['world'];
}

class FatherThorne implements KitInstance {
  private readonly camo = new Camouflage();
  private cover = 0;
  private coverAt = -999;
  private rootedMeter = 0;
  private conceal = 0;
  private zoneConceal = 0;
  private readonly crops: Crop[] = [];
  private zone: Zone | null = null;
  private readonly view: ThorneView = { camo: 0, zone: null, flares: [] };
  private removeFx: (() => void) | null = null;
  private scratchAt = new WeakMap<Enemy, number>();
  private readonly report: GrowReport = { written: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly meterBag: FighterMeter = { label: 'Rooted', value: 0, max: 100 };
  private sampler = 0;
  /** Why the last press was refused (the probes read it; the player reads the callout). */
  lastRefusal: string | null = null;
  private readonly fxDrawable: FighterDrawable = {
    layer: 'over',
    draw: (out, field, ctx) => drawThorneFx(out, field, ctx, this.view),
  };

  constructor(private readonly sys: FighterSystem) {
    this.ensureFx();
  }

  /**
   * Sever the swaying strand the sim has lifted a hanging vine of hers into (entities/VineStrands lifts a
   * ceiling-hung cluster near the player and keeps its cells off the grid): a withered vine must not live on as a
   * strand, nor settle back into cells later. Radius 2 reaches the nearest node of a compacted chain.
   */
  private readonly cutStrand = (x: number, y: number): boolean => (this.sys.ctx.vineStrands?.cutAt?.(x + 0.5, y + 0.5, 2) ?? 0) > 0;

  /** The system clears every drawable on a reset, so the kit puts its own back. */
  private ensureFx(): void {
    if (this.sys.drawables.includes(this.fxDrawable)) return;
    this.removeFx = this.sys.addDrawable(this.fxDrawable);
  }

  // ======================================================================== the tick

  tick(): void {
    const ctx = this.sys.ctx;
    const now = ctx.state.frameCount;
    this.ensureFx();
    this.camoTick(now);
    this.growTick(now);
    if (now % TUNING.vine.every === 0) this.contactTick(now);
    // inside the Overgrowth she is hidden (it is a place, so it is read from where she stands)
    const z = this.zone;
    if (z && z.world === ctx.world) {
      const p = ctx.player;
      const dx = p.x - z.cx, dy = p.y - 8 - z.cy, R = TUNING.over.radius;
      this.zoneConceal = dx * dx + dy * dy <= R * R ? TUNING.over.conceal : 0;
    } else this.zoneConceal = 0;
    if ((now & 3) === 0) this.glints();
    this.view.camo = this.camo.progress();
    const fl = this.view.flares;
    while (fl.length > 0 && now - fl[0].born >= FLARE_TICKS) fl.shift();
  }

  // ======================================================================== Rooted Camouflage

  private camoTick(now: number): void {
    const ctx = this.sys.ctx, p = ctx.player, T = TUNING.camo;
    const busy = this.sys.ownsMovement || p.climbing === true || p.swinging === true;
    const still = isStill(p.grounded, p.vx, busy, T);
    if (now - this.coverAt >= T.every || this.coverAt > now) {
      this.cover = coverCells(ctx.world, p.x, p.y - 8, T.box, T.box);
      this.coverAt = now;
    }
    const covered = this.cover >= T.need;
    const before = this.camo.progress(T);
    this.conceal = this.camo.step(!still, covered, T);
    const after = this.camo.progress(T);
    // The HUD readout: the settling second counts for a quarter of it, the ramp the rest; gone the moment she moves.
    this.rootedMeter = still && covered ? 100 * (0.25 * Math.min(1, this.camo.still / T.stillTicks) + 0.75 * after) : 0;

    if (before === 0 && after > 0) {
      ctx.audio.sfx('flora.rustle', p.x, p.y, { gain: 0.3, pitch: -3 }); // she settles into the green
    } else if (before > 0.25 && after === 0 && !still) {
      this.leaves(p.x, p.y - 9, 10); // she moves and the cover breaks: a flurry of leaves
      ctx.audio.sfx('flora.rustle', p.x, p.y, { gain: 0.45, pitch: 1 });
    }
    if (before < 1 && after >= 1) this.leaves(p.x, p.y - 12, 5);
  }

  concealment(): number {
    return this.conceal > this.zoneConceal ? this.conceal : this.zoneConceal;
  }

  meter(): FighterMeter | null {
    if (this.rootedMeter <= 0) return null;
    this.meterBag.value = this.rootedMeter;
    return this.meterBag;
  }

  /** A few real cosmetic leaves (the drawn motes are the steady tell; these are the punctuation). */
  private leaves(x: number, y: number, n: number): void {
    const ctx = this.sys.ctx;
    ctx.particles.burst(x, y, n, null, () => LEAF_COLOURS[(fxRandom() * LEAF_COLOURS.length) | 0], 0.9, { grav: 0.02, glow: 0.4 });
  }

  // ======================================================================== bodies and the cells they hold

  /** The cells a growth must not be written over: her body, every foe's, every loose crate's (rectangles, a cell wider each way). */
  private bodies(): SkipFn {
    const ctx = this.sys.ctx, p = ctx.player;
    const rects: number[] = [];
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    rects.push(p.x - PLAYER_HALF_W - 1, p.y - h - 1, p.x + PLAYER_HALF_W + 1, p.y + 1);
    const defs = ctx.enemyCtl.defs;
    for (const e of ctx.enemies) {
      const def = defs[e.kind];
      if (!def || e.hp <= 0) continue;
      rects.push(e.x - def.halfW - 1, e.y - def.h - 1, e.x + def.halfW + 1, e.y + 1);
    }
    const rb = ctx.rigidBodies;
    if (rb) {
      for (const b of rb.bodies) {
        if (b.kind !== 'dynamic' || b === rb.playerCorpse) continue;
        if (Math.abs(b.x - p.x) > 140 || Math.abs(b.y - p.y) > 140) continue;
        const r = b.shape.kind === 'box' ? Math.hypot(b.shape.halfW, b.shape.halfH) : b.shape.radius;
        rects.push(b.x - r, b.y - r, b.x + r, b.y + r);
      }
    }
    return (x, y) => {
      for (let i = 0; i < rects.length; i += 4) {
        if (x >= rects[i] && x <= rects[i + 2] && y >= rects[i + 1] && y <= rects[i + 3]) return true;
      }
      return false;
    };
  }

  /** An ability that cannot go off says why (a line over her head, a dry click) and costs nothing. */
  private refuse(why: string): false {
    const ctx = this.sys.ctx, p = ctx.player;
    this.lastRefusal = why;
    ctx.audio.sfx('wand.dry', p.x, p.y);
    this.sys.callout(why);
    return false;
  }

  // ======================================================================== growth and withering

  private growTick(now: number): void {
    const ctx = this.sys.ctx;
    let skip: SkipFn | null = null;
    for (let c = this.crops.length - 1; c >= 0; c--) {
      const crop = this.crops[c];
      if (crop.world !== ctx.world) {
        // a floor the fighter has left: what she grew there goes with her
        crop.wipe(); // (its strands went with the level: VineStrands settled them when the floor changed)
        this.crops.splice(c, 1);
        continue;
      }
      if (crop.growing) {
        skip ??= this.bodies();
        crop.grow(now - crop.born, skip, this.report, (x, y, cell) => this.growFx(crop, x, y, cell));
        if (this.report.written > 0) {
          if (crop.kind === 'over') ctx.flora?.noteGrowth(this.report.x0, this.report.y0, this.report.x1, this.report.y1);
          if (crop.kind === 'vine' && now % 5 === 0) ctx.audio.sfx('flora.rustle', this.report.x1, this.report.y1, { gain: 0.32, pitch: 2 });
          if (crop.kind === 'over' && now % 7 === 0) ctx.audio.sfx('flora.rustle', ctx.player.x, ctx.player.y, { gain: 0.5, pitch: -1 });
        }
      }
      const T = crop.kind === 'vine' ? TUNING.vine : TUNING.over;
      if ((now & 3) === 0 && now >= crop.firstDie - T.fadeTicks) {
        const gone = crop.wither(now, T.fadeTicks, TUNING.vine.owedTicks, (x, y, cell) => this.crumbleFx(x, y, cell), this.cutStrand);
        if (gone > 0 && now % 12 === 0) ctx.audio.sfx('flora.creak', ctx.player.x, ctx.player.y, { gain: 0.3, pitch: 1 });
      }
      if (crop.finished) this.crops.splice(c, 1);
    }
  }

  private readonly spot = { x: 0, y: 0, cell: 0 };

  /** What she has grown glimmers: a pale thorn catching a light that is not there, a spore lifting off the moss. Cosmetic, a few a pass. */
  private glints(): void {
    const ctx = this.sys.ctx;
    for (const crop of this.crops) {
      if (crop.world !== ctx.world || crop.live <= 0 || crop.growing) continue;
      const n = crop.kind === 'vine' ? 2 : 3;
      for (let k = 0; k < n; k++) {
        if (!crop.sample(fxRandom, this.spot)) continue;
        const c = this.spot;
        if (crop.kind === 'vine') {
          ctx.particles.spawn(c.x + 0.5, c.y - 0.5, 0, -0.03, null, 0xd8f0d0, 12 + ((fxRandom() * 8) | 0), { glow: 1.7, grav: -0.004 });
        } else if (c.cell === Cell.Moss || c.cell === Cell.Leaf) {
          ctx.particles.spawn(c.x + 0.5, c.y - 0.5, (fxRandom() - 0.5) * 0.12, -0.08 - fxRandom() * 0.1, null, SPORES[(fxRandom() * SPORES.length) | 0], 26 + ((fxRandom() * 16) | 0), { glow: 1.3, grav: -0.006 });
        }
      }
    }
  }

  /** A spark off a growing cell (sampled: a zone writes a thousand). */
  private growFx(crop: Crop, x: number, y: number, cell: number): void {
    const ctx = this.sys.ctx;
    this.sampler++;
    const every = crop.kind === 'vine' ? 2 : cell === Cell.Trunk ? 9 : 14;
    if (this.sampler % every !== 0) return;
    ctx.particles.spawn(
      x + 0.5, y, (fxRandom() - 0.5) * 0.3, -0.12 - fxRandom() * 0.25, null,
      SPORES[(fxRandom() * SPORES.length) | 0], 20 + ((fxRandom() * 14) | 0), { glow: 1.5, grav: -0.01 },
    );
  }

  /** A flake of dust where a withered cell lets go (sampled). */
  private crumbleFx(x: number, y: number, cell: number): void {
    if (fxRandom() > 0.22) return;
    const ctx = this.sys.ctx;
    const leaf = cell === Cell.Leaf || cell === Cell.Moss;
    ctx.particles.spawn(
      x + 0.5, y, (fxRandom() - 0.5) * 0.4, -0.05 + fxRandom() * 0.1, null,
      (leaf ? LEAF_COLOURS : DUST_COLOURS)[(fxRandom() * 3) | 0], 26 + ((fxRandom() * 16) | 0), { grav: 0.04 },
    );
  }

  // ======================================================================== Ironvine (Z)

  tactical(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.vine;
    const aim = aimOf(ctx);
    const plan = planIronvine(ctx.world, p.x, p.y, aim.x, aim.y, entityRandom, this.bodies(), T);
    if (typeof plan === 'string') return this.refuse(plan);
    const now = ctx.state.frameCount;
    const cells: CropCell[] = plan.cells.map((c) => ({
      x: c.x, y: c.y, cell: Cell.Vines,
      life: -1, // dormant: it does not sprout past what was written, and so cannot wander across a route
      color: c.color, at: c.at, die: witherDie(now, T.lifeTicks, T.spread, c.order), root: false,
    }));
    this.crops.push(new Crop(ctx.world, 'vine', now, cells));
    if (p.swinging) ctx.playerCtl.releaseVine(ctx);

    // the tell: her hand in the earth, thorns bursting along the ground ahead
    const hx = p.x + aim.facing * 6, hy = p.y - 3;
    ctx.audio.sfx('flora.whoosh', p.x, p.y, { gain: 0.9, pitch: 3 });
    ctx.audio.sfx('flora.seed.sprout', p.x, p.y, { gain: 0.8, pitch: -1 });
    ctx.audio.sfx('flora.creak', hx, hy, { gain: 0.5, pitch: 2 });
    ctx.sparks?.burst(hx, hy, { count: 14, speed: 1.3, angle: Math.atan2(aim.y, aim.x), spread: 1.1, colors: SPORES, kind: 'magic', glow: 1.2, radius: 2, life: 26 });
    ctx.particles.burst(hx, p.y - 1, 8, null, () => (fxRandom() < 0.5 ? 0x5a4630 : 0x7a6444), 1.6, { grav: 0.06 });
    this.view.flares.push({ x: hx + aim.facing * 6, y: p.y - 4, born: now, r: 9 });
    punch(ctx, 0.008, 0.15);
    return true;
  }

  tacticalActive(): number {
    const now = this.sys.ctx.state.frameCount, T = TUNING.vine;
    let best = 0;
    for (const c of this.crops) {
      if (c.kind !== 'vine' || c.live <= 0) continue;
      const left = (c.lastDie - now) / (T.lifeTicks + T.spread);
      if (left > best) best = left;
    }
    return best > 1 ? 1 : best;
  }

  /** Foes in or on the vines (checked every few ticks): slowed, scratched, and the first one marked. */
  private contactTick(now: number): void {
    const ctx = this.sys.ctx, T = TUNING.vine;
    let any = false;
    for (const c of this.crops) if (c.kind === 'vine' && c.world === ctx.world && c.live > 0) { any = true; break; }
    if (!any || ctx.enemies.length === 0) return;
    const defs = ctx.enemyCtl.defs;
    // A copy: a scratch can kill, and a kill reshuffles the live list under the loop.
    for (const e of ctx.enemies.slice()) {
      if (e.hp <= 0) continue;
      const def = defs[e.kind];
      if (!def) continue;
      const crop = this.vineUnder(e.x, e.y, def.halfW, def.h);
      if (!crop) continue;
      this.sys.slowEnemy(e, T.slow, T.slowTicks);
      if (!crop.caught) {
        crop.caught = true;
        this.sys.markEnemy(e, T.markTicks);
        this.sys.revealEnemy(e, T.markTicks, GREEN);
        ctx.audio.sfx('flora.crack', e.x, e.y, { gain: 0.5, pitch: 4 });
        ctx.sparks?.burst(e.x, e.y - def.h * 0.5, { count: 12, speed: 1.1, colors: SPORES, kind: 'magic', glow: 1.3, radius: 2, life: 24 });
        this.sys.callout('ENTANGLED');
      }
      const last = this.scratchAt.get(e) ?? -999;
      if (now - last >= T.scratchEvery) {
        this.scratchAt.set(e, now);
        ctx.particles.burst(e.x, e.y - def.h * 0.35, 3, null, () => 0xc8e0b0, 0.7, { glow: 0.8, grav: 0.02 });
        ctx.audio.sfx('flora.brush.grass', e.x, e.y, { gain: 0.5, pitch: 2 });
        this.sys.hurt(e, T.scratch, 0, 0);
      }
    }
  }

  /** The vine crop whose standing cell touches the body box (a foot, a flank), or null. */
  private vineUnder(x: number, y: number, halfW: number, h: number): Crop | null {
    const w = this.sys.ctx.world;
    const x0 = Math.max(0, Math.floor(x - halfW)), x1 = Math.min(w.width - 1, Math.ceil(x + halfW));
    const y0 = Math.max(0, Math.floor(y - h)), y1 = Math.min(w.height - 1, Math.floor(y) + 1);
    for (let yy = y0; yy <= y1; yy++) {
      const row = yy * w.width;
      for (let xx = x0; xx <= x1; xx++) {
        if (w.types[row + xx] !== Cell.Vines) continue;
        for (const c of this.crops) if (c.kind === 'vine' && c.world === w && c.find(row + xx) >= 0) return c;
      }
    }
    return null;
  }

  // ======================================================================== Overgrowth (T)

  ultimate(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, T = TUNING.over;
    const cx = Math.round(p.x), cy = Math.round(p.y - 8);
    const plan = planOvergrowth(ctx.world, cx, cy, entityRandom, this.bodies(), T);
    if (plan.length < T.minCells) return this.refuse('NOTHING WILL TAKE ROOT HERE');
    const now = ctx.state.frameCount;
    const cells: CropCell[] = plan.map((c) => ({
      x: c.x, y: c.y, cell: c.cell, life: c.life, color: c.color, at: c.at,
      die: witherDie(now, T.duration, T.witherSpread, c.order), root: c.root,
    }));
    this.crops.push(new Crop(ctx.world, 'over', now, cells));
    this.zone = { cx, cy, born: now, world: ctx.world };
    this.view.zone = { cx, cy, r: T.radius, grow: 0, left: 1 };

    ctx.audio.sfx('flora.canopy', p.x, p.y, { gain: 1.4, pitch: -2 });
    ctx.audio.sfx('flora.crack', p.x, p.y, { gain: 0.7, pitch: -5 });
    ctx.audio.sfx('flora.whoosh', p.x, p.y, { gain: 1.2, pitch: -3 });
    ctx.audio.sfx('flora.ladder.bloom', p.x, p.y, { gain: 1, pitch: -1 });
    this.view.flares.push({ x: cx, y: cy, born: now, r: 18 });
    ctx.sparks?.burst(cx, cy, { count: 60, speed: 2.4, colors: SPORES, kind: 'magic', glow: 1.3, radius: 4, life: 36 });
    this.leaves(cx, cy - 4, 20);
    punch(ctx, 0.03, 0.7);
    return true;
  }

  ultimateTick(remaining: number): void {
    const sys = this.sys, ctx = sys.ctx, T = TUNING.over;
    const z = this.zone;
    if (!z) return;
    const age = T.duration - remaining + 1;
    const v = this.view.zone;
    if (v) { v.grow = Math.min(1, age / T.growTicks); v.left = remaining / T.duration; }
    if (z.world !== ctx.world) return;
    // foes inside the zone are slowed, refreshed as they stand in it
    if (age % T.every === 0) {
      for (const e of sys.enemiesNear(z.cx, z.cy, T.radius)) {
        if (e.hp <= 0) continue;
        sys.slowEnemy(e, T.slow, T.slowTicks);
      }
    }
    // spores drift up through the cover about her
    if (age % 9 === 0 && !ctx.player.dead) {
      const p = ctx.player;
      ctx.particles.spawn(
        p.x + (fxRandom() - 0.5) * 60, p.y - 2 - fxRandom() * 22, (fxRandom() - 0.5) * 0.2, -0.1 - fxRandom() * 0.15, null,
        SPORES[(fxRandom() * SPORES.length) | 0], 40 + ((fxRandom() * 20) | 0), { glow: 1.2, grav: -0.004 },
      );
    }
  }

  ultimateEnd(): void {
    const ctx = this.sys.ctx;
    const z = this.zone;
    this.zone = null;
    this.view.zone = null;
    this.zoneConceal = 0;
    // the zone is let go: the roots stay and brown (their own clock), the slow and the cover end here
    if (z && z.world === ctx.world && ctx.state.mode === 'play' && !ctx.player.dead) {
      ctx.audio.sfx('flora.creak', ctx.player.x, ctx.player.y, { gain: 0.8, pitch: -3 });
      ctx.audio.sfx('flora.settle', ctx.player.x, ctx.player.y, { gain: 0.7, pitch: -2 });
    }
  }

  /** The roots are hand-holds: Player.hasClimbFaceAt asks for every cell it feels for a grip. */
  climbHold(x: number, y: number): boolean {
    if (this.crops.length === 0) return false;
    const w = this.sys.ctx.world;
    const xi = Math.floor(x), yi = Math.floor(y);
    if (!w.inBounds(xi, yi)) return false;
    const wi = w.idx(xi, yi);
    if (w.types[wi] !== Cell.Trunk) return false;
    for (const c of this.crops) if (c.kind === 'over' && c.world === w && c.isRoot(wi)) return true;
    return false;
  }

  // ======================================================================== lifecycle

  reset(): void {
    // What she grew goes with the fight: a respawn, a floor change and an unequip clear it (the world may be the old one).
    for (const c of this.crops) c.wipe(c.world === this.sys.ctx.world ? this.cutStrand : undefined);
    this.crops.length = 0;
    this.zone = null;
    this.view.zone = null;
    this.view.camo = 0;
    this.view.flares.length = 0;
    this.camo.reset();
    this.conceal = 0;
    this.zoneConceal = 0;
    this.rootedMeter = 0;
    this.coverAt = -999;
    this.scratchAt = new WeakMap();
  }

  dispose(): void {
    this.reset();
    this.removeFx?.();
    this.removeFx = null;
  }
}

export const kit: FighterKitDef = {
  id: 'father-thorne',
  tacticalCooldown: TUNING.vine.cooldown,
  ultimateDuration: TUNING.over.duration,
  create: (sys) => new FatherThorne(sys),
};
