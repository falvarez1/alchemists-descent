import { CHILL_PARAMS } from '@/config/params';
import type { ChillApi, Ctx, PlayerChill, PlayerState } from '@/core/types';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import type { ChillMomentKind } from '@/core/events';
import { entityRandom, fxRandom } from '@/core/simRandom';
import { DEEP_CHILL_REMARK } from '@/content/chill';
import { createPlayerChill, deriveChill, resetPlayerChill, stepChill, type ChillInputs, type ChillMoment } from '@/entities/chill';
import { Cell, blocksEntity, isGas, isLiquid } from '@/sim/CellType';
import { packRGB, snowColor, steamColor, unpackB, unpackG, unpackR, waterColor } from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * THE CHILL — the system. Feeds the model (entities/chill) what the grid says
 * about the alchemist each tick and makes the world answer:
 *
 * - COLD IN: brine at the legs (deeper = colder), liquid nitrogen, fresh water
 *   in a frozen place, ice or snow pressed to the body, a frozen biome's air
 *   (a floor of 0.12), and blows of cold `hit()` in (a frost bolt, a Rime
 *   Warden's rime wave and each lick of its breath).
 * - HEAT OUT: fire, lava, embers, burning coal and oil within `heatRadius`
 *   (weighted by distance), the Warm Refuge, a burning coat. Casting fire
 *   warms you because the fire it makes is real cells beside you.
 * - THE WORLD ANSWERS (real cells): the fresh water a chilled body wades
 *   through skins over with thin rime ice behind him (brine refuses — the
 *   Cold Store's first lesson; the skin thaws back to water after a while);
 *   his breath fogs (motes, and past 0.5 a real Steam cell); his boots print
 *   hoarfrost on the stone and the wall he clings to rimes (a colour stain
 *   that melts back); the thaw beat and the shell's burst shed real Snow and
 *   Ice that tumble off and melt where it is warm, with a hiss of steam.
 * - The Docent remarks once a session, the first time the chill runs deep
 *   (a captioned line of his, voiced; a toast where no narrator is loaded).
 *
 * Sound: `chillMoment` events (audio/EventCues) for the beats; the wind and
 * the creak of ice (a loop the chill holds up) and the slowing heartbeat are
 * called straight from here, like the other tick-rate beds.
 */

/** Ticks a skin of rime ice holds before it gives back to water (it is thin). */
const SKIN_LIFE = 960;
const MAX_SKINS = 160;
/** Rime Soles: how far below the boots (cells) the water's surface may be and still skin over. */
const SOLE_REACH = 4;
/** Ticks a hoarfrost print holds before the stone's own colour comes back. */
const PRINT_LIFE = 2100;
const MAX_PRINTS = 260;
/** Hoarfrost: the stain the frost leaves on stone, wood, metal and ice. */
const RIME_R = 218, RIME_G = 234, RIME_B = 246;

interface Skin { world: World; i: number; color: number; expire: number }
interface Print { world: World; i: number; orig: number; tinted: number; hadOverride: boolean; expire: number }

/** Materials hoarfrost takes to (solid, still, not already white). */
function frostTakes(t: number): boolean {
  return t === Cell.Wall || t === Cell.Stone || t === Cell.Wood || t === Cell.Metal || t === Cell.Ice ||
    t === Cell.RawOre || t === Cell.Coal || t === Cell.Glass || t === Cell.Crystal;
}

function open(t: number): boolean {
  return t === Cell.Empty || isGas(t);
}

/** Something a body stands in without being held or floated: air, gas, and the soft growth that lies on a pool. */
function passable(t: number): boolean {
  return !blocksEntity(t) && !isLiquid(t);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class ChillSystem implements ChillApi {
  readonly tuning = CHILL_PARAMS;
  private readonly moments: ChillMoment[] = [];
  private readonly inputs: ChillInputs = { cold: 0, touching: false, warmth: 0, burning: false, ambientFloor: 0, impulse: 0, press: false, blow: false };
  private readonly skins: Skin[] = [];
  private readonly prints: Print[] = [];
  private readonly printed = new Set<number>();
  private readonly disposers: Array<() => void> = [];
  private pendingHit = 0;
  private lastHp = -1;
  private prevKeys = 0;
  private held: number | null = null;
  // The last body sample (every 2 ticks).
  private cold = 0;
  private touching = false;
  private legWater = 0;
  private headWater = false;
  private warmth = 0;
  // Beats.
  private breathT = 90;
  private heartT = 0;
  private lastStep = 0;
  private standR = 0;
  /** The docent's remark is once a session. */
  private remarked = false;

  constructor(private readonly ctx: Ctx) {
    this.disposers.push(
      ctx.events.on('playerRespawned', () => this.reset()),
      ctx.events.on('playerDeathCleared', () => this.reset()),
      // A new floor: what the cold wrote into the old one gives back, and the body arrives warm.
      ctx.events.on('levelChanged', () => { this.restoreAll(); this.reset(); }),
    );
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off();
  }

  hit(amount: number): void {
    if (Number.isFinite(amount) && amount > 0) this.pendingHit += amount;
  }

  reset(): void {
    const c = this.ctx.player.chill;
    if (c) resetPlayerChill(c);
    this.pendingHit = 0;
    this.lastHp = -1;
    this.standR = 0;
    this.breathT = 90;
  }

  /** Pin the chill at `level` (probes, the console); null lets the grid drive it again. */
  hold(level: number | null): void {
    this.held = level === null || !Number.isFinite(level) ? null : clamp01(level);
  }

  update(ctx: Ctx): void {
    const frame = ctx.state.frameCount;
    if ((frame & 31) === 0) this.expire(frame);
    if (ctx.state.mode !== 'play') return;
    const p = ctx.player;
    if (!p.chill) p.chill = createPlayerChill();
    const c = p.chill;
    if (p.dead) {
      // A body that froze to death keeps its rime; the lock and the lens let go.
      c.shell = 0;
      c.screen *= 0.92;
      this.lastHp = -1;
      return;
    }
    const t = this.tuning;
    if (frame % 2 === 0) this.sampleBody(ctx, p);
    if (frame % 4 === 0) this.warmth = this.sampleHeat(ctx, p);

    const inp = this.inputs;
    const frozenPlace = ctx.levels?.current?.def.biome === 'frozen';
    // Warm Blood boon: everything cold that reaches the body (the grid's, the air's, a frost blow) arrives at half strength.
    const warmK = p.perks.warmblood ? 0.5 : 1;
    inp.cold = this.cold * warmK;
    inp.touching = this.touching;
    inp.warmth = this.warmth;
    inp.burning = p.status.burning > 0;
    inp.ambientFloor = frozenPlace ? t.ambientFloor * warmK : 0;
    inp.impulse = this.pendingHit * warmK;
    this.pendingHit = 0;
    const keys = ctx.input.keys;
    const bits = (keys.left ? 1 : 0) | (keys.right ? 2 : 0) | (keys.jump ? 4 : 0) | (keys.up ? 8 : 0) | (keys.down ? 16 : 0);
    inp.press = (bits & ~this.prevKeys) !== 0;
    this.prevKeys = bits;
    inp.blow = this.lastHp >= 0 && this.lastHp - p.hp >= 1.5;
    this.lastHp = p.hp;

    const wasDeep = c.deep;
    this.moments.length = 0;
    if (this.held !== null && c.shell === 0) {
      // Pinned: the body sits at exactly this cold (the lock's cap and the decay never move it).
      c.level = this.held;
      if (c.rime < c.level) c.rime = Math.min(c.level, c.rime + 0.03);
      deriveChill(c, t, frame);
    } else stepChill(c, inp, t, frame, this.moments);

    const hx = p.x, hy = p.y - (p.crawling ? 4 : 9);
    for (const m of this.moments) this.moment(ctx, p, m.kind, m.strength, m.warm, hx, hy);
    if (!wasDeep && c.deep && !this.remarked && this.held === null) {
      this.remarked = true;
      // The Docent's caption (it waits its turn behind a pipe line rather than
      // being dropped); a toast where there is no narrator to carry it.
      const said = ctx.narrator?.speak?.([{ speaker: 'docent', text: DEEP_CHILL_REMARK }], { priority: 'normal', source: 'chill', ttlMs: 14000, captioned: true });
      if (!said) ctx.events.emit('toast', { text: DEEP_CHILL_REMARK });
    }

    this.breathe(ctx, p, c, frame);
    this.shedMotes(ctx, p, c);
    this.skinWake(ctx, p, c, frame);
    if (p.perks.rimesoles) this.rimeSoles(ctx, p, frame);
    this.printFrost(ctx, p, c, frame);
    this.listen(ctx, c);
  }

  /* ---------------- what the grid says ---------------- */

  private sampleBody(ctx: Ctx, p: PlayerState): void {
    const w = ctx.world, t = this.tuning;
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const bx = Math.floor(p.x), by = Math.floor(p.y);
    let n = 0, brine = 0, nitrogen = 0, water = 0, legWater = 0, frost = 0, headWater = 0;
    for (let dy = 0; dy < h; dy += 2) {
      for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx += 2) {
        const X = bx + dx, Y = by - dy;
        if (!w.inBounds(X, Y)) continue;
        n++;
        const ty = w.types[X + Y * w.width];
        if (ty === Cell.Brine) brine++;
        else if (ty === Cell.Nitrogen) nitrogen++;
        else if (ty === Cell.Water) {
          water++;
          if (dy < 8) legWater++;
          if (dy >= h - 5) headWater++;
        } else if (ty === Cell.Ice || ty === Cell.Snow) frost++;
      }
    }
    // Ice or snow under the boots and against the sides.
    for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx += 2) {
      const X = bx + dx, Y = by + 1;
      if (!w.inBounds(X, Y)) continue;
      const ty = w.types[X + Y * w.width];
      if (ty === Cell.Ice || ty === Cell.Snow) frost++;
    }
    for (let dy = 1; dy < h; dy += 3) {
      for (const X of [bx - PLAYER_HALF_W - 1, bx + PLAYER_HALF_W + 1]) {
        const Y = by - dy;
        if (!w.inBounds(X, Y)) continue;
        const ty = w.types[X + Y * w.width];
        if (ty === Cell.Ice || ty === Cell.Snow) frost++;
      }
    }
    const frozenPlace = ctx.levels?.current?.def.biome === 'frozen';
    const full = Math.max(1, n * 0.8);
    let cold = 0;
    if (brine >= 3) cold += t.brineBase + t.brineSubmerged * clamp01(brine / full);
    if (nitrogen >= 1) cold += Math.min(t.nitrogenCap, nitrogen * t.nitrogenPerCell);
    if (frozenPlace && water >= 3) cold += t.coldWater * clamp01(water / full);
    if (frost >= 3) cold += t.iceContact;
    this.cold = cold;
    this.touching = brine >= 3 || nitrogen >= 1 || (frozenPlace && water >= 3);
    this.legWater = legWater;
    this.headWater = headWater >= 2;
  }

  /** 0..1 heat around the chest: hot cells weighted by distance, and the Warm Refuge. */
  private sampleHeat(ctx: Ctx, p: PlayerState): number {
    const w = ctx.world, t = this.tuning, R = t.heatRadius;
    const cx = Math.floor(p.x), cy = Math.floor(p.y) - 8, soft = R * R * 0.18;
    let sum = 0;
    for (let dy = -R; dy <= R; dy += 3) {
      const Y = cy + dy;
      if (Y < 0 || Y >= w.height) continue;
      for (let dx = -R; dx <= R; dx += 3) {
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const X = cx + dx;
        if (X < 0 || X >= w.width) continue;
        const i = X + Y * w.width, ty = w.types[i];
        let heat = 0;
        if (ty === Cell.Fire) heat = 1;
        else if (ty === Cell.Lava) heat = 1.5;
        else if (ty === Cell.Ember) heat = 0.7;
        else if ((ty === Cell.Coal || ty === Cell.Oil) && w.life[i] > 0) heat = 0.8;
        if (heat > 0) sum += heat / (1 + d2 / soft);
      }
    }
    const refuge = ctx.levels?.current?.refuge;
    if (refuge && Math.hypot(p.x - refuge.x, p.y - refuge.y) < 110) sum += t.heatFull * 0.6;
    return clamp01(sum / t.heatFull);
  }

  /* ---------------- the beats ---------------- */

  private moment(ctx: Ctx, p: PlayerState, kind: ChillMomentKind, strength: number, warm: boolean, x: number, y: number): void {
    const calm = ctx.state.reduceFlashes === true;
    if (kind === 'crackle') {
      // Frost taking: a couple of glassy glints at the silhouette's edge.
      for (let k = 0; k < 2; k++) this.edgeMote(ctx, p, packRGB(226, 242, 255), 0.9, -0.02, 14);
    } else if (kind === 'shell') {
      // Seized: the ice closes over him in a breath of frost smoke.
      ctx.particles.burst(x, y, calm ? 8 : 16, null, () => packRGB(214 + Math.floor(fxRandom() * 30), 236, 255), 1.3, { glow: 0.7, grav: 0.02 });
      ctx.fx.screenShake = Math.max(ctx.fx.screenShake, ctx.state.reduceCameraShake ? 0 : 0.006);
    } else if (kind === 'crack') {
      for (let k = 0; k < 4; k++) this.edgeMote(ctx, p, packRGB(200, 232, 252), 0.6, 0.12, 22, 1.2);
    } else if (kind === 'shatter' || kind === 'thaw') {
      this.shed(ctx, p, strength, warm, kind === 'shatter');
      if (kind === 'shatter' && !calm) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick ?? 0, 0.25);
    }
    ctx.events.emit('chillMoment', { kind, x, y, strength, warm });
  }

  /** The rime comes off as REAL cells: snow and ice that tumble and land, steam where it is warm. */
  private shed(ctx: Ctx, p: PlayerState, amount: number, warm: boolean, burst: boolean): void {
    const w = ctx.world;
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const n = 7 + Math.round(clamp01(amount) * (burst ? 18 : 16));
    for (let k = 0; k < n; k++) {
      const x = p.x + (entityRandom() * 2 - 1) * (PLAYER_HALF_W + 0.5);
      const y = p.y - 1 - entityRandom() * (h - 2);
      const dir = x >= p.x ? 1 : -1;
      const vx = dir * (0.4 + entityRandom() * (burst ? 1.8 : 1.1));
      const vy = -(0.5 + entityRandom() * (burst ? 2.0 : 1.3));
      const roll = entityRandom();
      if (roll < 0.5) {
        ctx.particles.spawn(x, y, vx, vy, Cell.Snow, snowColor(), 70 + Math.floor(entityRandom() * 40), { grav: 0.16, glow: 0.25, deposit: true });
      } else if (roll < 0.66) {
        const b = Math.floor(entityRandom() * 20);
        ctx.particles.spawn(x, y, vx, vy, Cell.Ice, packRGB(178 + b, 220 + Math.floor(b / 2), 250), 70 + Math.floor(entityRandom() * 40), { grav: 0.18, glow: 0.3, deposit: true });
      } else {
        // Glassy shards that glint as they fly and are gone.
        ctx.particles.spawn(x, y, vx * 1.2, vy * 1.1, null, packRGB(200 + Math.floor(fxRandom() * 55), 236, 255), 18 + Math.floor(fxRandom() * 14), { grav: 0.14, glow: 1.1 });
      }
    }
    if (!warm) return;
    // The hiss: meltwater flashing off where the heat is — a few real steam cells round the body.
    for (let k = 0; k < 4; k++) {
      const X = Math.floor(p.x + (entityRandom() * 2 - 1) * (PLAYER_HALF_W + 2));
      const Y = Math.floor(p.y - 2 - entityRandom() * (h - 2));
      if (!w.inBounds(X, Y)) continue;
      const i = X + Y * w.width;
      if (w.types[i] !== Cell.Empty) continue;
      w.replaceCellAt(i, Cell.Steam, steamColor());
      w.life[i] = 40 + Math.floor(entityRandom() * 40);
    }
  }

  /** A mote off a random point of the silhouette's edge. */
  private edgeMote(ctx: Ctx, p: PlayerState, color: number, glow: number, grav: number, life: number, speed = 0.4): void {
    const h = p.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    const side = fxRandom() < 0.5 ? -1 : 1;
    const top = fxRandom() < 0.35;
    const x = top ? p.x + (fxRandom() * 2 - 1) * PLAYER_HALF_W : p.x + side * (PLAYER_HALF_W + 0.5);
    const y = top ? p.y - h + 1 : p.y - fxRandom() * h;
    ctx.particles.spawn(x, y, (top ? fxRandom() - 0.5 : side) * speed * fxRandom(), -speed * fxRandom(), null, color, life, { glow, grav });
  }

  /**
   * Breath fog, quicker and shallower as it deepens: the puff itself is drawn
   * by the art (a translucent wisp off the mouth, AlchemistArt drawBreath);
   * past `breathCellMin` each other breath also leaves a real Steam cell.
   */
  private breathe(ctx: Ctx, p: PlayerState, c: PlayerChill, frame: number): void {
    if (c.level < 0.1 || c.shell > 0 || p.inLiquid && this.headWater) { this.breathT = Math.max(this.breathT, 30); return; }
    if (--this.breathT > 0) return;
    const deep = clamp01((c.level - 0.1) / 0.8);
    this.breathT = Math.round(150 - 90 * deep + fxRandom() * 24);
    const f = p.facing || 1;
    const mx = p.crawling ? p.x + f * 6.4 : p.climbing || p.wallGrabT > 5 ? p.x - f * 0.6 : p.x + f * 2.6;
    const my = p.crawling ? p.y - 3.2 : p.y - 14.3;
    c.breathAt = frame; c.breathX = mx; c.breathY = my; c.breathDir = f; c.breathK = deep;
    if (c.level >= this.tuning.breathCellMin && (frame & 1) === 0) {
      const w = ctx.world, X = Math.floor(mx + f * 2), Y = Math.floor(my);
      if (w.inBounds(X, Y) && w.types[X + Y * w.width] === Cell.Empty) {
        w.replaceCellAt(X + Y * w.width, Cell.Steam, packRGB(222, 232, 238));
        w.life[X + Y * w.width] = 22 + Math.floor(entityRandom() * 16);
      }
    }
    ctx.events.emit('chillMoment', { kind: 'breath', x: mx, y: my, strength: c.level, warm: false });
  }

  /** Rime flakes shaken loose; meltwater dripping off while it thaws. */
  private shedMotes(ctx: Ctx, p: PlayerState, c: PlayerChill): void {
    if (c.rime > 0.25 && fxRandom() < 0.035 * c.rime * (Math.abs(p.vx) > 0.4 ? 2 : 1)) {
      this.edgeMote(ctx, p, packRGB(228, 240, 250), 0.35, 0.03, 36, 0.3);
    }
    if (c.rime > c.level + 0.06 && fxRandom() < 0.1) {
      const x = p.x + (fxRandom() * 2 - 1) * PLAYER_HALF_W;
      ctx.particles.spawn(x, p.y - 3 - fxRandom() * 8, 0, 0.2, null, packRGB(130, 186, 236), 22, { grav: 0.14, glow: 0.3 });
    }
  }

  /* ---------------- the world answers ---------------- */

  /** A chilled body wading fresh water leaves a skin of rime ice on the surface behind it. */
  private skinWake(ctx: Ctx, p: PlayerState, c: PlayerChill, frame: number): void {
    const t = this.tuning;
    if (c.level < t.skinMin || c.shell > 0 || frame % 3 !== 0 || Math.abs(p.vx) < 0.25) return;
    if (this.legWater < 2 || this.headWater) return;
    const w = ctx.world, dir = p.vx > 0 ? 1 : -1;
    const chance = 0.35 + 0.65 * clamp01((c.level - t.skinMin) / (1 - t.skinMin));
    let froze = 0;
    for (let k = 0; k < 3; k++) {
      if (entityRandom() > chance) continue;
      const X = Math.floor(p.x - dir * (PLAYER_HALF_W + 2 + k * 2 + entityRandom() * 2));
      for (let Y = Math.floor(p.y) - 15; Y <= Math.floor(p.y) + 1; Y++) {
        if (!w.inBounds(X, Y) || !w.inBounds(X, Y - 1)) continue;
        const i = X + Y * w.width;
        if (w.types[i] !== Cell.Water) continue;
        // The top of the water only: open air above it.
        if (!open(w.types[i - w.width])) break;
        this.freeze(w, i, frame);
        if (w.inBounds(X - dir, Y) && w.types[i - dir] === Cell.Water && open(w.types[i - dir - w.width])) this.freeze(w, i - dir, frame);
        froze++;
        break;
      }
    }
    if (froze > 0 && fxRandom() < 0.3) {
      ctx.events.emit('chillMoment', { kind: 'skin', x: p.x - dir * 7, y: p.y - 6, strength: c.level, warm: false });
    }
  }

  /**
   * RIME SOLES (boon): the water under the boots skins over, so a pool is a
   * road. Every other tick each column beneath the feet is scanned down through
   * up to SOLE_REACH cells of air (or the glow-leaf and grass that float on a
   * Cistern); the first thing met, if it is the surface of some water with air
   * above it, freezes into the same thin rime as a chilled wader's wake — and
   * thaws back after SKIN_LIFE, but never while it is being stood on (the skin
   * under the boots is topped up). Nothing freezes around a body that is
   * already wading: ice never forms at the waist.
   */
  private rimeSoles(ctx: Ctx, p: PlayerState, frame: number): void {
    if ((frame & 1) !== 0 || p.climbing || p.crawling) return;
    const w = ctx.world, bx = Math.floor(p.x), by = Math.floor(p.y);
    if (!w.inBounds(bx, by + SOLE_REACH) || !passable(w.types[bx + by * w.width])) return;
    let froze = 0, fx = 0;
    for (let dx = -PLAYER_HALF_W - 1; dx <= PLAYER_HALF_W + 1; dx++) {
      const X = bx + dx;
      for (let dy = 1; dy <= SOLE_REACH; dy++) {
        const Y = by + dy;
        if (!w.inBounds(X, Y)) break;
        const i = X + Y * w.width, ty = w.types[i];
        if (ty === Cell.Water) {
          if (passable(w.types[i - w.width])) { this.freeze(w, i, frame); froze++; fx = X; }
          break;
        }
        if (ty === Cell.Ice) {
          if (dy === 1 && (frame & 15) === 0) this.holdSkin(i, frame);
          break;
        }
        if (!passable(ty)) break;
      }
    }
    if (froze === 0) return;
    // A glint off the new ice; the creak is the chillMoment's (audio/EventCues).
    ctx.particles.spawn(fx, p.y + 1, (fxRandom() - 0.5) * 0.6, -0.3 - fxRandom() * 0.4, null, packRGB(226, 242, 255), 16, { glow: 1.1, grav: 0.02 });
    if (froze >= 2 && fxRandom() < 0.4) ctx.events.emit('chillMoment', { kind: 'skin', x: p.x, y: p.y + 2, strength: 0.5, warm: false });
  }

  /** A skin someone is standing on does not thaw yet. */
  private holdSkin(i: number, frame: number): void {
    for (const s of this.skins) if (s.i === i) { s.expire = Math.max(s.expire, frame + SKIN_LIFE); return; }
  }

  private freeze(w: World, i: number, frame: number): void {
    const b = Math.floor(entityRandom() * 16);
    const color = packRGB(184 + b, 222 + Math.floor(b / 2), 247);
    w.replaceCellAt(i, Cell.Ice, color);
    if (this.skins.length >= MAX_SKINS) this.thawSkin(this.skins.shift()!);
    this.skins.push({ world: w, i, color, expire: frame + SKIN_LIFE + Math.floor(entityRandom() * 300) });
  }

  private thawSkin(s: Skin): void {
    if (s.world.types[s.i] === Cell.Ice && s.world.colors[s.i] === s.color) s.world.replaceCellAt(s.i, Cell.Water, waterColor());
  }

  /** Hoarfrost where a deeply chilled body touches: boot prints, the ground round a still body, the wall he clings to. */
  private printFrost(ctx: Ctx, p: PlayerState, c: PlayerChill, frame: number): void {
    const t = this.tuning;
    if (c.level < t.printMin) { this.standR = 0; return; }
    const k = 0.34 + 0.34 * clamp01((c.level - t.printMin) / (1 - t.printMin));
    const bx = Math.floor(p.x), by = Math.floor(p.y);
    if (p.climbing || p.wallGrabT > 5) {
      if (frame % 10 !== 0) return;
      const side = p.climbing ? p.climbDir || p.facing : p.wallGrabDir || p.facing;
      for (let dy = 2; dy < PLAYER_H - 1; dy += 4) {
        for (let reach = PLAYER_HALF_W + 1; reach <= PLAYER_HALF_W + 3; reach++) {
          const X = bx + side * reach, Y = by - dy - Math.floor(entityRandom() * 3);
          if (this.print(ctx.world, X, Y, k, frame)) break;
        }
      }
      return;
    }
    if (!p.grounded || p.inLiquid) { this.standR = 0; return; }
    const step = Math.floor(p.stridePhase / Math.PI);
    if (Math.abs(p.vx) > 0.2) {
      this.standR = 0;
      if (step === this.lastStep) return;
      this.lastStep = step;
      // A boot print: the cell the heel strikes and one either side.
      const foot = bx + ((step & 1) === 0 ? 2 : -2) * (p.facing || 1);
      for (let dx = -1; dx <= 1; dx++) this.printSurface(ctx.world, foot + dx, by + 1, k * (dx === 0 ? 1 : 0.7), frame);
      return;
    }
    // Standing in the cold: the frost creeps out round the boots.
    if (frame % 20 !== 0) return;
    this.standR = Math.min(7, this.standR + 1);
    for (let n = 0; n < 2; n++) {
      const dx = Math.round((entityRandom() * 2 - 1) * (PLAYER_HALF_W + this.standR));
      this.printSurface(ctx.world, bx + dx, by + 1, k * (1 - Math.abs(dx) / 14), frame);
    }
  }

  /** Frost the top of the ground at (x, y) (or the first solid cell up to two rows down). */
  private printSurface(w: World, x: number, y: number, k: number, frame: number): void {
    for (let Y = y; Y <= y + 2; Y++) {
      if (!w.inBounds(x, Y)) return;
      const ty = w.types[x + Y * w.width];
      if (ty === Cell.Empty || isGas(ty)) continue;
      this.print(w, x, Y, k, frame);
      return;
    }
  }

  private print(w: World, x: number, y: number, k: number, frame: number): boolean {
    if (!w.inBounds(x, y)) return false;
    const i = x + y * w.width;
    if (!frostTakes(w.types[i])) return false;
    if (this.printed.has(i)) return true;
    const orig = w.colors[i];
    const r = unpackR(orig), g = unpackG(orig), b = unpackB(orig);
    const tinted = packRGB(Math.round(r + (RIME_R - r) * k), Math.round(g + (RIME_G - g) * k), Math.round(b + (RIME_B - b) * k));
    const hadOverride = w.colorOverrides.has(i);
    w.colors[i] = tinted;
    w.colorOverrides.add(i);
    if (this.prints.length >= MAX_PRINTS) this.unprint(this.prints.shift()!);
    this.prints.push({ world: w, i, orig, tinted, hadOverride, expire: frame + PRINT_LIFE + Math.floor(entityRandom() * 600) });
    this.printed.add(i);
    return true;
  }

  private unprint(q: Print): void {
    this.printed.delete(q.i);
    const w = q.world;
    if (w.colors[q.i] !== q.tinted) return; // something else wrote here since: leave it
    w.colors[q.i] = q.orig;
    if (q.hadOverride) w.colorOverrides.add(q.i);
    else w.colorOverrides.delete(q.i);
  }

  /** Rime ice gives back to water, hoarfrost fades, as their time runs out. */
  private expire(frame: number): void {
    while (this.skins.length > 0 && this.skins[0].expire <= frame) this.thawSkin(this.skins.shift()!);
    while (this.prints.length > 0 && this.prints[0].expire <= frame) this.unprint(this.prints.shift()!);
  }

  /** Leaving a floor: everything the cold wrote into it gives back at once. */
  private restoreAll(): void {
    for (const s of this.skins.splice(0)) this.thawSkin(s);
    for (const q of this.prints.splice(0)) this.unprint(q);
    this.printed.clear();
  }

  /* ---------------- the body's own sound ---------------- */

  /** The wind and the creak of ice rise with the chill; the heart slows past the deep. */
  private listen(ctx: Ctx, c: PlayerChill): void {
    if (c.screen > 0.04) ctx.audio.sfx('player.chill.wind', undefined, undefined, { gain: 0.2 + 0.8 * c.screen });
    if (c.level < 0.72) { this.heartT = 0; return; }
    if (--this.heartT > 0) return;
    const m = clamp01((c.level - 0.72) / 0.28);
    // Hypothermia slows the heart: ~46 bpm, then ~32 at full chill.
    this.heartT = Math.round(78 + 34 * m);
    ctx.audio.sfx('player.heartbeat', undefined, undefined, { rate: 0.86 - 0.08 * m, gain: 0.55 + 0.45 * m });
  }
}
