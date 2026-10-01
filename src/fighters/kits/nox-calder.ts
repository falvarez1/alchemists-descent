import { VIEW_H, VIEW_W } from '@/config/constants';
import { FLOOR_DARKNESS } from '@/config/darkness';
import { darkMapFor } from '@/core/darkness';
import { entityRandom, fxRandom } from '@/core/simRandom';
import type { AuthoredLight, DarkZone, LevelRuntime } from '@/core/types';
import { aimOf, punch } from '@/fighters/effects';
import type { FighterSystem } from '@/fighters/FighterSystem';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import { drawCanister, drawDusk, drawSoot, drawVeil, newCanisterView, newDuskView, newSootView } from '@/fighters/kits/nox-calder-art';
import {
  TUNING, bloomCount, cloudBox, dawnLevel, duskLevel, easeCover, lineClear, newCanister, nightZone, planCloud,
  shadeIndex, sightBrightness, smokeCover, SootSense, stepCanister, throwRoom, withZone,
} from '@/fighters/kits/nox-calder-math';
import type { Canister } from '@/fighters/kits/nox-calder-math';
import { Cell, blocksEntity, isGas } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';

export { TUNING } from '@/fighters/kits/nox-calder-math';

/**
 * NOX CALDER, the Lampblack (Controller): docs/FIGHTERS.md "06" and docs/fighters/nox-calder.md.
 *
 *  - Soot Sight (passive): in the dark (`lightQuery.darkness` > 0.5) or inside smoke (6+ Smoke cells in a
 *    9 x 9 box), foes within 160 cells that she has a clear line to are shown as faint silhouettes: the shared
 *    reveal ring (a dim `revealEnemy`) and a pale body-shaped veil. A pulse goes out when the sense comes on.
 *  - Blackglass (Z): a canister (the Flask's bottle, step for step) bursts into a dense cloud of REAL Smoke
 *    cells, each with its own `world.life`, that a vent keeps fed for four seconds. Her cover is read off the
 *    Smoke cells around her (`concealment()`), so it thins as the cloud does. The sim does not burn smoke, so
 *    the kit does: smoke beside flame in a cloud burns away.
 *  - Long Night (T): the authored lamps within 260 cells are snuffed (nearest first, and restored exactly) and
 *    a large dark zone is added to the level's `darkZones` (a NEW array, so the bake notices; the original
 *    array is put back at the end). Her own lantern is untouched. She is half-hidden while it lasts.
 *
 * Nothing here writes a solid: smoke is a gas with a life, the dark is a lighting map, so nothing can seal a route.
 */

const SOOT_SPARKS = [0x1b1e26, 0x2a2e3a, 0x3a4050] as const;
const GLASS_SHARD = (): number => packRGB(150 + ((fxRandom() * 40) | 0), 170 + ((fxRandom() * 40) | 0), 205 + ((fxRandom() * 40) | 0));
/** Lampblack: a faintly cool charcoal, darker than the sim's own smoke, so a cloud reads as dense in the light and not as a pale mist. */
const BLACKGLASS = (): number => packRGB(24 + ((fxRandom() * 18) | 0), 26 + ((fxRandom() * 18) | 0), 30 + ((fxRandom() * 18) | 0));
const EMBER = (): number => packRGB(255, 130 + ((fxRandom() * 100) | 0), 30 + ((fxRandom() * 30) | 0));

interface Cloud {
  world: World;
  x: number;
  y: number;
  born: number;
  xs: Int16Array;
  ys: Int16Array;
  /** How many of the planned cells the bloom has written. */
  stamped: number;
  /** Where the vent resumes its sweep of the nearest cells. */
  cursor: number;
  /** Flame reached it: what was left in the canister has burned, and the vent is shut for good. */
  lit: boolean;
  end: number;
}

interface Lamp {
  light: AuthoredLight;
  base: number;
  dist: number;
  out: boolean;
}

interface Night {
  rt: LevelRuntime | null;
  /** The level's own zone list at the press (possibly undefined): put back, by identity, at the end. */
  zones0: DarkZone[] | undefined;
  installed: boolean;
  lamps: Lamp[];
  /** Set when the level had no darkness character of its own and the kit lent it one for the night. */
  profileId: string | null;
}

type Slot = 'canister' | 'soot' | 'dusk' | 'veil';

class NoxCalder implements KitInstance {
  private canister: Canister | null = null;
  private canisterWorld: World | null = null;
  private readonly clouds: Cloud[] = [];
  private cover = 0;
  private smokeInner = 0;
  private readonly sense = new SootSense();
  private pulseAge = 0;
  private lastPulse = -1e9;
  private sootOffAt = -1;
  private readonly sootView = newSootView();
  private readonly canisterView = newCanisterView();
  private readonly duskView = newDuskView();
  private readonly shades: Array<readonly [number, number, number]>;
  private night: Night | null = null;
  /** Lights this kit added (a burst's flash): never mistaken for a lamp to snuff. */
  private readonly own = new WeakSet<AuthoredLight>();
  private rm: Record<Slot, (() => void) | null> = { canister: null, soot: null, dusk: null, veil: null };
  /** How long the last dark bake took (ms), at the press and at the end: the probe reads these. */
  lastBakeMs = 0;
  lastUnbakeMs = 0;
  /** Why the last press was refused (the probes read it; the player reads the callout). */
  lastRefusal: string | null = null;

  /** Leaving play for the editor puts the night back (the editor reads the level's lights and zones as they stand). */
  private readonly offMode: () => void;

  constructor(private readonly sys: FighterSystem) {
    this.offMode = sys.ctx.events.on('modeChanged', (e) => { if (e.mode !== 'play') this.endNight(); });
    const S = TUNING.soot;
    this.shades = Array.from({ length: S.shades }, (_, i) => {
      const k = S.farK + ((S.nearK - S.farK) * (i + 0.5)) / S.shades;
      return [S.rgb[0] * k, S.rgb[1] * k, S.rgb[2] * k] as const;
    });
  }

  // ======================================================================== small things

  private chest(): { x: number; y: number } {
    const p = this.sys.ctx.player;
    return { x: p.x, y: p.y - (p.crawling ? 4 : 9) };
  }

  private readonly solidAt = (x: number, y: number): boolean => {
    const w = this.sys.ctx.world;
    return !w.inBounds(x, y) || blocksEntity(w.types[w.idx(x, y)]);
  };

  /** The Flask's rule: anything that is not air or a gas stops the bottle. */
  private readonly stopsBottle = (x: number, y: number): boolean => {
    const w = this.sys.ctx.world;
    if (!w.inBounds(x, y)) return true;
    const t = w.types[w.idx(x, y)];
    return t !== Cell.Empty && !isGas(t);
  };

  private readonly foeAt = (x: number, y: number): boolean => {
    const ctx = this.sys.ctx;
    const defs = ctx.enemyCtl.defs, pad = TUNING.glass.foePad;
    for (const e of ctx.enemies) {
      if (e.hp <= 0) continue;
      const def = defs[e.kind];
      if (!def) continue;
      if (Math.abs(x - e.x) <= def.halfW + pad && y >= e.y - def.h - pad && y <= e.y + pad) return true;
    }
    return false;
  };

  private refuse(why: string): false {
    const ctx = this.sys.ctx, p = ctx.player;
    this.lastRefusal = why;
    ctx.audio.sfx('wand.dry', p.x, p.y);
    this.sys.callout(why);
    return false;
  }

  /** Register a drawable once (the system drops every drawable on a reset, so each is added when needed and its handle forgotten in `reset`). */
  private show(slot: Slot): void {
    if (this.rm[slot]) return;
    const sys = this.sys;
    if (slot === 'canister') this.rm.canister = sys.addDrawable({ layer: 'over', draw: (out, f, c) => drawCanister(out, f, c, this.canisterView) });
    else if (slot === 'veil') this.rm.veil = sys.addDrawable({ layer: 'over', draw: (out, f, c) => drawVeil(out, f, c, this.clouds) });
    else if (slot === 'soot') this.rm.soot = sys.addDrawable({ layer: 'over', draw: (out, f, c) => drawSoot(out, f, c, this.sootView) });
    else this.rm.dusk = sys.addDrawable({ layer: 'over', draw: (out, f, c) => drawDusk(out, f, c, this.duskView) });
  }

  private hide(slot: Slot): void {
    const off = this.rm[slot];
    if (off) off();
    this.rm[slot] = null;
  }

  tick(): void {
    this.readCover();
    this.flyCanister();
    this.tendClouds();
    this.sootSight();
  }

  // ======================================================================== cover (Blackglass's other half)

  /** One pass over the box around her chest: the smoke in it, the open cells it has, and the smoke in the 9 x 9 Soot Sight reads. */
  private readCover(): void {
    const ctx = this.sys.ctx, w = ctx.world, C = TUNING.glass.cover, S = TUNING.soot;
    const c = this.chest();
    const cx = Math.round(c.x), cy = Math.round(c.y);
    let smoke = 0, open = 0, inner = 0;
    for (let dy = -C.ry; dy <= C.ry; dy++) {
      const y = cy + dy;
      for (let dx = -C.rx; dx <= C.rx; dx++) {
        const x = cx + dx;
        if (!w.inBounds(x, y)) continue;
        const t = w.types[w.idx(x, y)];
        if (blocksEntity(t)) continue;
        open++;
        if (t === Cell.Smoke) {
          smoke++;
          if (dx >= -S.boxR && dx <= S.boxR && dy >= -S.boxR && dy <= S.boxR) inner++;
        }
      }
    }
    this.smokeInner = inner;
    this.cover = easeCover(this.cover, smokeCover(smoke, open));
  }

  concealment(): number {
    return this.cover;
  }

  tacticalActive(): number {
    return this.cover > 0.02 ? Math.min(1, this.cover / TUNING.glass.cover.max) : 0;
  }

  // ======================================================================== Soot Sight

  private sootSight(): void {
    const ctx = this.sys.ctx, S = TUNING.soot, now = ctx.state.frameCount;
    const c = this.chest();
    const dark = ctx.lightQuery?.darkness(c.x, c.y) ?? 0;
    const edge = this.sense.update(dark, this.smokeInner);
    const view = this.sootView;
    if (edge === 1) {
      // A fresh sweep goes out only if the last was a while ago: a mist that flickers at the edge does not re-pulse.
      const fresh = now - this.lastPulse > S.pulseRest;
      this.pulseAge = fresh ? 0 : S.sweepTicks;
      if (fresh) {
        this.lastPulse = now;
        ctx.audio.sfx('light.eyeshine', c.x, c.y, { gain: 0.9, pitch: -2 });
      }
      this.show('soot');
    }
    if (edge === -1) this.sootOffAt = now;
    if (!this.sense.on) {
      // Out of it: the silhouettes thin away over the same few ticks the reveal rings last, then the drawable goes.
      if (this.rm.soot) {
        for (let i = 0; i < view.count; i++) view.foes[i].k *= 0.78;
        view.k = 0;
        if (now - this.sootOffAt > S.hold + 2) { view.count = 0; this.hide('soot'); }
      }
      return;
    }
    this.show('soot');
    // the pulse
    this.pulseAge++;
    const reach = Math.min(1, this.pulseAge / S.sweepTicks);
    view.r = S.range * reach;
    view.k = reach >= 1 ? Math.max(0, view.k - 0.12) : 1 - reach * 0.55;
    if (now % S.every !== 0 && this.pulseAge > 1) return;
    this.lookAround(c.x, c.y, view.r);
  }

  /** The foes the sense shows right now: within range, within what the pulse has reached, and with a clear line. */
  private lookAround(cx: number, cy: number, reach: number): void {
    const sys = this.sys, ctx = sys.ctx, S = TUNING.soot;
    const defs = ctx.enemyCtl.defs;
    const view = this.sootView;
    let n = 0;
    for (const e of ctx.enemies) {
      if (e.hp <= 0) continue;
      const def = defs[e.kind];
      if (!def) continue;
      const ey = e.y - def.h * 0.5;
      const dist = Math.hypot(e.x - cx, ey - cy);
      if (dist > S.range || dist > reach) continue;
      if (!lineClear(this.solidAt, cx, cy, e.x, ey)) continue;
      const k = sightBrightness(dist);
      sys.revealEnemy(e, S.hold, this.shades[shadeIndex(k)]);
      let s = view.foes[n];
      if (!s) view.foes[n] = s = { x: 0, y: 0, halfW: 0, h: 0, k: 0, phase: 0 };
      s.x = e.x; s.y = e.y; s.halfW = def.halfW; s.h = def.h; s.k = k; s.phase = e.bobPhase;
      n++;
    }
    view.count = n;
  }

  // ======================================================================== Blackglass

  tactical(): boolean {
    const ctx = this.sys.ctx, p = ctx.player, G = TUNING.glass;
    const aim = aimOf(ctx);
    const c = this.chest();
    // A wall at her nose: the canister would burst in her face. Refused, and it costs nothing.
    const room = throwRoom(this.solidAt, c.x, c.y, aim.x, aim.y, G.minRoom);
    if (room < G.minRoom) return this.refuse('NO ROOM TO THROW');
    if (p.swinging) ctx.playerCtl.releaseVine(ctx);
    const reach = throwRoom(this.solidAt, c.x, c.y, aim.x, aim.y, G.handReach);
    let x = c.x + aim.x * reach, y = c.y + aim.y * reach;
    // (a hand that rounds into a solid would burst the canister into rock, where there is no room for smoke: it leaves her chest instead)
    if (this.stopsBottle(Math.floor(x), Math.floor(y))) { x = c.x; y = c.y; }
    this.canister = newCanister(x, y, aim.angle);
    this.canisterWorld = ctx.world;
    this.canisterView.live = true;
    this.canisterView.x = x;
    this.canisterView.y = y;
    this.canisterView.angle = 0;
    this.canisterView.age = 0;
    this.show('canister');
    p.throwT = 14; // the arm follows through
    ctx.audio.sfx('flask.throw', p.x, p.y, { gain: 1.1, pitch: -3 });
    return true;
  }

  private flyCanister(): void {
    const ctx = this.sys.ctx, c = this.canister;
    if (!c) return;
    if (this.canisterWorld !== ctx.world) { this.dropCanister(); return; }
    const hit = stepCanister(c, this.stopsBottle, (x, y) => ctx.world.inBounds(x, y), this.foeAt);
    const v = this.canisterView;
    v.x = c.x;
    v.y = c.y;
    v.age = c.age;
    v.angle += 0.42 * (c.vx >= 0 ? 1 : -1);
    // a thin dark leak off the stopper as it flies
    if (c.age % 2 === 0) ctx.particles.spawn(c.x, c.y, -c.vx * 0.04, -0.05, null, packRGB(40, 44, 54), 14, { grav: -0.01 });
    if (hit) this.burst(hit.x, hit.y);
  }

  private dropCanister(): void {
    this.canister = null;
    this.canisterWorld = null;
    this.canisterView.live = false;
    this.hide('canister');
  }

  /** The canister breaks: shards, a hiss, and a cloud planned once and then written by the bloom and the vent. */
  private burst(bx: number, by: number): void {
    let x = bx, y = by;
    const sys = this.sys, ctx = sys.ctx, G = TUNING.glass, w = ctx.world;
    this.dropCanister();
    const open = (px: number, py: number): boolean => {
      if (!w.inBounds(px, py)) return false;
      const t = w.types[w.idx(px, py)];
      return t === Cell.Empty || isGas(t);
    };
    let plan = planCloud(open, x, y, entityRandom);
    // a burst whose own cell is blocked (a gap that closed under it) smokes from her chest instead of nowhere
    if (plan.xs.length === 0) {
      const c = this.chest();
      x = Math.round(c.x);
      y = Math.round(c.y);
      plan = planCloud(open, x, y, entityRandom);
    }
    const now = ctx.state.frameCount;
    const K = G.cloud;
    if (this.clouds.length >= 3) this.clouds.shift(); // the oldest stops venting (its smoke stays and burns off by itself)
    const cloud: Cloud = { world: w, x, y, born: now, xs: plan.xs, ys: plan.ys, stamped: 0, cursor: 0, lit: false, end: now + K.bloomTicks + K.ventTicks + K.lifeMax + 12 };
    this.clouds.push(cloud);
    this.growCloud(cloud, 0);
    this.show('veil');
    if (this.rm.soot) { this.hide('soot'); this.show('soot'); } // (drawn after the veil: the silhouettes show through the smoke)

    ctx.audio.sfx('flask.shatter', x, y, { gain: 1.2, pitch: -2 });
    ctx.audio.sfx('mat.steam', x, y, { gain: 1.3, pitch: -4 });
    ctx.audio.sfx('mat.hollow', x, y, { gain: 0.8, pitch: -6 });
    ctx.particles.burst(x, y, 12, null, GLASS_SHARD, 2.4, { glow: 1.2, grav: 0.12 });
    ctx.sparks?.burst(x, y, { count: 44, speed: 1.5, spread: Math.PI, colors: SOOT_SPARKS, kind: 'smoke', life: 56, glow: 0.2, radius: 4 });
    // the canister's own flash: a cold pop of light that the smoke swallows at once
    const flash = sys.addLight(x, y, { rgb: [0.55, 0.66, 0.9], intensity: 0.9, radius: 44, bloom: 0.5, flicker: 0 }, 9);
    if (flash) this.own.add(flash);
    punch(ctx, 0.012, 0.12);
  }

  /** Write the part of the cloud the bloom has reached, and (while the vent is open) refill what has risen out of its nearest cells. */
  private tendClouds(): void {
    const ctx = this.sys.ctx, now = ctx.state.frameCount, K = TUNING.glass.cloud;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cl = this.clouds[i];
      if (cl.world !== ctx.world || now >= cl.end) { this.clouds.splice(i, 1); if (this.clouds.length === 0) this.hide('veil'); continue; }
      const age = now - cl.born;
      this.growCloud(cl, age);
      if (age >= K.bloomTicks && age < K.bloomTicks + K.ventTicks && !cl.lit) {
        this.vent(cl);
        if (age % 22 === 0) ctx.audio.sfx('mat.steam', cl.x, cl.y, { gain: 0.55, pitch: -5 });
      }
      if (age % TUNING.glass.burn.every === 0) this.burnSmoke(cl, age);
    }
  }

  private stampCell(cl: Cloud, j: number): boolean {
    const w = cl.world, K = TUNING.glass.cloud;
    const x = cl.xs[j], y = cl.ys[j];
    if (!w.inBounds(x, y)) return false;
    const i = w.idx(x, y);
    if (w.types[i] !== Cell.Empty) return false;
    w.replaceCellAt(i, Cell.Smoke, BLACKGLASS());
    w.life[i] = K.lifeMin + Math.floor(entityRandom() * (K.lifeMax - K.lifeMin + 1));
    return true;
  }

  private growCloud(cl: Cloud, age: number): void {
    const to = Math.min(cl.xs.length, bloomCount(cl.xs.length, age + 1));
    for (let j = cl.stamped; j < to; j++) this.stampCell(cl, j);
    cl.stamped = Math.max(cl.stamped, to);
  }

  private vent(cl: Cloud): void {
    const K = TUNING.glass.cloud;
    const zone = Math.min(K.ventCells, cl.xs.length);
    if (zone <= 0) return;
    let placed = 0, n = 0;
    for (; n < zone && placed < K.ventPerTick; n++) {
      if (this.stampCell(cl, (cl.cursor + n) % zone)) placed++;
    }
    cl.cursor = (cl.cursor + n) % zone;
  }

  /**
   * The sim does not burn smoke (a flame beside a cloud leaves it as it was), so the kit does, inside its own clouds:
   * smoke within a couple of cells of Fire, Lava or an Ember goes up. Real cells removed, so a lit cloud really thins,
   * and her cover (read off the cells around her) really falls.
   */
  private burnSmoke(cl: Cloud, age: number): void {
    const ctx = this.sys.ctx, w = cl.world, B = TUNING.glass.burn;
    const box = cloudBox(cl.x, cl.y, age);
    const x0 = Math.max(0, box.x0), x1 = Math.min(w.width - 1, box.x1);
    const y0 = Math.max(0, box.y0), y1 = Math.min(w.height - 1, box.y1);
    let eaten = 0, sparks = 0;
    const r = B.radius, r2 = r * r + 1;
    for (let y = y0; y <= y1 && eaten < B.cap; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = w.types[w.idx(x, y)];
        if (t !== Cell.Fire && t !== Cell.Lava && t !== Cell.Ember) continue;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const sx = x + dx, sy = y + dy;
            if (!w.inBounds(sx, sy)) continue;
            const si = w.idx(sx, sy);
            if (w.types[si] !== Cell.Smoke || entityRandom() >= B.chance) continue;
            w.clearCellAt(si);
            eaten++;
            if (!cl.lit) this.catchFire(cl);
            if (sparks < 8 && fxRandom() < 0.18) {
              sparks++;
              ctx.particles.spawn(sx, sy, (fxRandom() - 0.5) * 0.7, -0.15 - fxRandom() * 0.4, null, EMBER(), 16 + ((fxRandom() * 10) | 0), { glow: 1.8, grav: -0.02 });
            }
          }
        }
      }
    }
  }

  /** The first flame to touch a cloud: the payload still in the canister burns with it (the vent shuts), with a hiss and a flare. */
  private catchFire(cl: Cloud): void {
    const ctx = this.sys.ctx;
    cl.lit = true;
    ctx.audio.sfx('mat.sizzle', cl.x, cl.y, { gain: 0.9 });
    ctx.audio.sfx('mat.ignite', cl.x, cl.y, { gain: 0.5, pitch: -2 });
  }

  // ======================================================================== Long Night

  ultimate(): boolean {
    const sys = this.sys, ctx = sys.ctx, p = ctx.player, N = TUNING.night;
    const rt = ctx.levels?.current ?? null;
    const lamps: Lamp[] = [];
    if (rt?.authoredLights) {
      for (const light of rt.authoredLights) {
        if (this.own.has(light) || !(light.intensity > 0)) continue;
        const dist = Math.hypot(light.x - p.x, light.y - (p.y - 9));
        if (dist > N.lampRange) continue;
        lamps.push({ light, base: light.intensity, dist, out: false });
      }
    }
    this.night = { rt, zones0: rt?.darkZones, installed: false, lamps, profileId: null };
    sys.setMod(N.id, N.duration + 2, { concealment: N.concealment });
    this.show('dusk');
    this.duskView.reach = 0.02;
    this.duskView.dark = 0;
    ctx.audio.sfx('light.lantern.hood', p.x, p.y, { gain: 1.1, pitch: -5 });
    ctx.audio.sfx('light.bloom.furl', p.x, p.y, { gain: 0.8, pitch: -3 });
    punch(ctx, 0.01, 0);
    return true;
  }

  ultimateTick(remaining: number): void {
    const n = this.night;
    if (!n) return;
    const ctx = this.sys.ctx, N = TUNING.night;
    const e = N.duration - remaining; // ticks since the press
    const dawn = remaining <= N.dawn;
    const dawnT = N.dawn - remaining;

    // ---- the lamps: snuffed in a wave outward from her, and (in the last moments) relit the same way ----
    for (const l of n.lamps) {
      const level = dawn ? dawnLevel(dawnT, l.dist) : duskLevel(e, l.dist);
      const stutter = level > 0 && level < 1 ? 0.55 + 0.45 * fxRandom() : 1;
      l.light.intensity = l.base * level * stutter;
      if (!dawn && level <= 0 && !l.out) {
        l.out = true;
        this.snuffed(l.light);
      }
      if (dawn && level > 0) l.out = false;
    }

    // ---- the dusk closes outward, then the dark falls ----
    if (e < N.windup) {
      const u = (e + 1) / N.windup;
      this.duskView.reach = u;
      this.duskView.dark = Math.min(1, u * 1.5);
    } else if (e === N.windup) this.fall();
    else if (this.rm.dusk) {
      this.duskView.dark = Math.max(0, this.duskView.dark - 1 / 12);
      if (this.duskView.dark <= 0) this.hide('dusk');
    }

    // ---- the tell while it lasts: soot wisps coil off her, and the last of it is a dawn ----
    if (e > N.windup && e % 9 === 0) {
      const c = this.chest();
      ctx.sparks?.burst(c.x + (fxRandom() - 0.5) * 9, c.y + (fxRandom() - 0.3) * 12, { count: 2, speed: 0.3, angle: -Math.PI / 2, spread: 1.2, colors: SOOT_SPARKS, kind: 'smoke', life: 44, glow: 0.15, radius: 3 });
    }
    if (remaining === N.dawn) {
      const p = ctx.player;
      ctx.audio.sfx('light.lantern.unhood', p.x, p.y, { gain: 0.9, pitch: -2 });
    }
  }

  /** A lamp has gone out: a curl of soot where it hung, and the small sound of a wick drowned. */
  private snuffed(light: AuthoredLight): void {
    const ctx = this.sys.ctx, cam = ctx.camera;
    if (light.x < cam.renderX - 10 || light.x > cam.renderX + VIEW_W + 10 || light.y < cam.renderY - 10 || light.y > cam.renderY + VIEW_H + 10) return;
    ctx.sparks?.burst(light.x, light.y, { count: 7, speed: 0.5, angle: -Math.PI / 2, spread: 0.9, colors: SOOT_SPARKS, kind: 'smoke', life: 40, glow: 0.2, radius: 1.5 });
    ctx.audio.sfx('light.bloom.furl', light.x, light.y, { gain: 0.7, pitch: -2 });
  }

  /** The dark falls: the zone goes into a NEW zone array and the bake runs once, here, on the press frame (never per tick). */
  private fall(): void {
    const n = this.night;
    if (!n) return;
    const ctx = this.sys.ctx, p = ctx.player;
    const rt = n.rt;
    if (rt) {
      // A level with no darkness character of its own (a test arena, a custom runtime) bakes a zone to nothing: lend it one for the night.
      const id = rt.def.id;
      if (!(id in FLOOR_DARKNESS)) {
        FLOOR_DARKNESS[id] = { base: 0, deep: 1 };
        n.profileId = id;
      }
      rt.darkZones = withZone(n.zones0, nightZone(p.x, p.y - 9));
      n.installed = true;
      const t0 = performance.now();
      darkMapFor(rt);
      this.lastBakeMs = performance.now() - t0;
    }
    ctx.audio.sfx('mat.hollow', p.x, p.y, { gain: 1.4, pitch: -9 });
    ctx.audio.sfx('light.dark', p.x, p.y, { gain: 0.8 });
    punch(ctx, 0.014, 0);
  }

  /** Everything the night changed goes back exactly: the lamps' intensities, the zone array by identity, the lent profile. Safe to call twice. */
  private endNight(): void {
    const n = this.night;
    if (!n) return;
    this.night = null;
    const ctx = this.sys.ctx;
    for (const l of n.lamps) l.light.intensity = l.base;
    const rt = n.rt;
    if (rt && n.installed) {
      if (n.zones0 === undefined) delete rt.darkZones;
      else rt.darkZones = n.zones0;
    }
    if (n.profileId !== null) delete FLOOR_DARKNESS[n.profileId];
    // The second (and last) bake, at once, while the level is still the one on screen; an old level is rebaked when it is next entered.
    if (rt && n.installed && rt === ctx.levels?.current) {
      const t0 = performance.now();
      darkMapFor(rt);
      this.lastUnbakeMs = performance.now() - t0;
    }
    this.sys.clearMod(TUNING.night.id);
    this.duskView.dark = 0;
    this.hide('dusk');
  }

  ultimateEnd(): void {
    const ctx = this.sys.ctx, p = ctx.player;
    const rt = this.night?.rt;
    this.endNight();
    if (ctx.state.mode === 'play' && !p.dead && rt === ctx.levels?.current) {
      ctx.audio.sfx('light.bloom.open', p.x, p.y, { gain: 0.8, pitch: -1 });
      ctx.sparks?.burst(p.x, p.y - 9, { count: 14, speed: 0.7, spread: Math.PI, colors: SOOT_SPARKS, kind: 'smoke', life: 40, glow: 0.2, radius: 5 });
    }
  }

  // ======================================================================== lifecycle

  reset(): void {
    this.endNight();
    this.dropCanister();
    this.clouds.length = 0;
    this.hide('veil');
    this.cover = 0;
    this.smokeInner = 0;
    this.sense.reset();
    this.sootView.count = 0;
    this.sootView.k = 0;
    this.pulseAge = 0;
    this.lastPulse = -1e9;
    this.hide('soot');
    this.hide('dusk');
  }

  dispose(): void {
    this.offMode();
    this.reset();
  }
}

export const kit: FighterKitDef = {
  id: 'nox-calder',
  tacticalCooldown: TUNING.glass.cooldown,
  ultimateDuration: TUNING.night.duration,
  create: (sys) => new NoxCalder(sys),
};
