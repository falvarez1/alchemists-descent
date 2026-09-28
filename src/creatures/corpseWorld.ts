import type { Ctx, Enemy } from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';
import type { CorpseMomentKind } from '@/core/events';
import type { World } from '@/sim/World';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import { COLOR_FN, emberColor, fireColor, iceColor, packRGB, smokeColor, steamColor, unpackB, unpackG, unpackR } from '@/sim/colors';
import { chargeDeposit } from '@/sim/electrical';
import { fxRandom } from '@/core/simRandom';
import { pointHitsCreature } from './body';
import type { Corpse } from './corpses';
import type { BodySample } from './corpseBody';
import { allPoints, corpseFrame, forEachBodyPoint, pushBody } from './corpseBody';
import type { RigPoint } from './rig/physics';
import { movePoint } from './rig/physics';

/**
 * CORPSES AS PHYSICAL CITIZENS. The remains are mass in the grid: the cells
 * they touch decide what happens to them, and what they do is written back as
 * cells. A carcass in a fire catches and writes real flame as it goes (thrown
 * into oil, it lights the oil); lava takes it in a hiss of embers; acid eats it
 * and is spent doing so; nitrogen or ice freezes it stiff, and a frozen body
 * that meets anything hard enough breaks into real ice. A charged conductor
 * makes the dead twitch (Galvani's frogs, in a Victorian refinery), and a wet
 * body carries a little of that current on. Moving fast, it is a projectile:
 * it strikes creatures (BOWLED), shoves crates and bones, splashes real water
 * out of a pool. None of it draws the entity random stream: cosmetic motes use
 * fx randomness, grid writes pick their cells by a deterministic hash.
 */

// ------------------------------------------------------------------ tuning
/** A strike below this relative speed (cells/tick) is a nudge, not a blow. */
export const BOWL_MIN_SPEED = 2.2;
/** Blow damage: BOWL_BASE + BOWL_K × mass^0.6 × relative speed, capped. */
export const BOWL_BASE = 6;
export const BOWL_K = 4.5;
export const BOWL_MAX = 90;
/** Ticks before the same remains can strike a creature again. */
const BOWL_COOLDOWN = 14;
/** Share of its velocity a body keeps after striking a creature (the rest went into the victim). */
const BOWL_KEEP = 0.45;
/** An abrupt velocity change this big (cells/tick) against terrain is a landing worth hearing. */
export const THUD_DV = 1.6;
/** ...and this big, frozen stiff, breaks the body. */
export const SHATTER_DV = 2.4;
/** A frozen body striking a creature this fast breaks on it. */
const SHATTER_BOWL_SPEED = 3;
/** Minimum speed before the landing counts (a body settling is not a thud). */
export const THUD_MIN_SPEED = 1.8;
/** Entering liquid this fast downward throws a splash. */
export const SPLASH_MIN_VY = 1;
/** A crate or bone is shoved when a body this fast passes through it. */
const SHOVE_MIN_SPEED = 2.4;
/** Momentum a body passes into a crate per slime per cell/tick (a kick is ~75). */
const SHOVE_K = 12;
/** Only a genuinely heavy body dropped on the alchemist's head hurts him. */
export const HEAD_MASS_MIN = 2.5;
const HEAD_MIN_VY = 2.2;
export const HEAD_DMG_MAX = 8;

/** Ticks a body burns once caught (oiled: longer); how fast it chars (per tick). */
const BURN_TICKS = 480;
const BURN_OILED_TICKS = 780;
const CHAR_RATE = 0.0035;
/** Extra rot per tick while burning (it burns out faster), in lava, in acid. */
const BURN_ROT = 2;
const LAVA_ROT = 10;
const ACID_ROT = 6;
/** Ticks a body stays frozen stiff after its last cold contact. */
export const FROZEN_TICKS = 1200;
/** Ticks of galvanic twitching after the last charged contact. */
const TWITCH_TICKS = 24;
/** The census runs every this many ticks, staggered per body. */
export const CENSUS_EVERY = 3;
/** Ticks between two announcements of the same moment by one body. */
const MOMENT_CD: Readonly<Record<CorpseMomentKind, number>> = {
  thud: 10, bowl: 8, splash: 30, ignite: 120, consume: 240, dissolve: 90, freeze: 240, shatter: 0,
  twitch: 45, douse: 90,
};

// ------------------------------------------------------------------ contact census
export interface CorpseContact {
  fire: number;
  lava: number;
  acid: number;
  water: number;
  oil: number;
  cold: number;
  charge: number;
  /** Samples taken. */
  n: number;
  /** Body points sitting in liquid, and in water-like liquid (water, blood, gel) that puts fire out. */
  wet: number;
  soak: number;
  /** A touching cell of each kind, for the writes (−1 none). */
  acidIdx: number;
  wetIdx: number;
}

export function emptyContact(): CorpseContact {
  return { fire: 0, lava: 0, acid: 0, water: 0, oil: 0, cold: 0, charge: 0, n: 0, wet: 0, soak: 0, acidIdx: -1, wetIdx: -1 };
}

const RING: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const RING2: ReadonlyArray<readonly [number, number]> = [...RING, [1, 0], [-1, 0], [0, 1], [0, -1]];

/** Which cells the body touches: its own cell and the four around it at its rim. */
export function senseContact(world: World, e: Enemy, out: CorpseContact): CorpseContact {
  out.fire = out.lava = out.acid = out.water = out.oil = out.cold = out.charge = out.n = out.wet = out.soak = 0;
  out.acidIdx = -1; out.wetIdx = -1;
  let visited = 0;
  forEachBodyPoint(e, (x, y, r) => {
    // A big rig samples every other point: the census is about contact, not detail.
    if (visited++ > 28 && (visited & 1)) return;
    out.n++;
    // Two rings: just inside the body's rim and just outside it (a flame
    // licking the flank, the metal it lies on).
    const inner = Math.max(0.5, r * 0.6), outer = Math.min(3.5, r + 1.4);
    for (let k = 0; k < RING2.length; k++) {
      const reach = k < RING.length ? inner : outer;
      const X = Math.floor(x + RING2[k][0] * reach), Y = Math.floor(y + RING2[k][1] * reach);
      if (X < 0 || Y < 0 || X >= world.width || Y >= world.height) continue;
      const i = X + Y * world.width, t = world.types[i];
      if (k === 0 && isLiquid(t)) { out.wet++; if (t === Cell.Water || t === Cell.Blood || t === Cell.Slime) out.soak++; }
      if (world.charge[i] > 0) out.charge++;
      switch (t) {
        case Cell.Fire: case Cell.Ember: out.fire++; break;
        case Cell.Lava: out.lava++; break;
        case Cell.Acid: out.acid++; out.acidIdx = i; break;
        case Cell.Water: case Cell.Blood: case Cell.Slime: case Cell.Steam: out.water++; if (t !== Cell.Steam) out.wetIdx = i; break;
        case Cell.Oil: out.oil++; break;
        case Cell.Ice: case Cell.Nitrogen: case Cell.Snow: out.cold++; break;
        default: break;
      }
    }
  });
  return out;
}

// ------------------------------------------------------------------ moments
/** Announce a moment (audio/EventCues sounds it), throttled per body and kind. */
export function corpseMoment(ctx: Ctx, c: Corpse, kind: CorpseMomentKind, x: number, y: number, strength: number): void {
  const t = ctx.state.frameCount, last = c.moments[kind] ?? -1e9;
  if (t - last < MOMENT_CD[kind]) return;
  c.moments[kind] = t;
  ctx.events?.emit('corpseMoment', { kind, x, y, strength: Math.max(0, Math.min(1, strength)), mass: c.mass, species: c.e.kind });
}

/** A cheap deterministic hash (grid writes never draw the entity stream). */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function burst(ctx: Ctx, x: number, y: number, n: number, color: () => number, speed: number, opts?: { glow?: number; grav?: number }): void {
  ctx.particles?.burst(x, y, n, null, color, speed, opts);
}

// ------------------------------------------------------------------ elements
/**
 * One census step of fire, lava, acid, frost and current. Returns the extra
 * rot (ticks of age) the body took this step. Runs every CENSUS_EVERY ticks.
 */
export function stepElements(ctx: Ctx, c: Corpse, k: CorpseContact, s: BodySample): number {
  const world = ctx.world, t = ctx.state.frameCount, dt = CENSUS_EVERY;
  let rot = 0;
  const wetShare = k.n > 0 ? k.wet / k.n : 0, soakShare = k.n > 0 ? k.soak / k.n : 0;
  // FROST: nitrogen, ice or snow against the body freezes it stiff; it stays
  // frozen while the cold touches it and a while after.
  if (k.cold > 0 && k.fire + k.lava === 0) {
    if (c.frozen <= 0) {
      c.frozen = FROZEN_TICKS;
      c.shape = null; // captured by the stepper on the next integration
      c.burn = 0;
      burst(ctx, s.x, s.y, 10, iceColor, 0.8, { glow: 0.6, grav: 0.02 });
      corpseMoment(ctx, c, 'freeze', s.x, s.y, Math.min(1, 0.4 + c.mass * 0.15));
    } else c.frozen = Math.max(c.frozen, FROZEN_TICKS);
  }
  // Heat thaws a frozen body fast (with a breath of steam) before it can burn.
  if (c.frozen > 0 && k.fire + k.lava > 0) {
    c.frozen = Math.max(0, c.frozen - 60 * dt);
    burst(ctx, s.x, s.y - 2, 3, steamColor, 0.6, { grav: -0.03 });
  }
  // LAVA takes it quickly: the body chars through in a hiss of embers.
  if (k.lava > 0) {
    rot += LAVA_ROT * dt;
    c.char = Math.min(1, c.char + 0.02 * dt);
    c.burn = Math.max(c.burn, 120);
    c.fate = 'lava';
    burst(ctx, s.x, s.y - 1, 3, emberColor, 1.2, { glow: 2, grav: -0.02 });
    corpseMoment(ctx, c, 'consume', s.x, s.y, Math.min(1, 0.5 + c.mass * 0.1));
  }
  // ACID eats it and is spent doing so: a touching acid cell goes up as smoke.
  if (k.acid > 0) {
    rot += ACID_ROT * dt;
    if (c.fate === 'gore') c.fate = 'acid';
    if (k.acidIdx >= 0 && hash(t, c.e.bobPhase * 1000) < 0.4) world.replaceCellAt(k.acidIdx, Cell.Smoke, smokeColor());
    burst(ctx, s.x, s.y - 1, 2, () => packRGB(150, 220, 120), 0.5, { grav: -0.03 });
    corpseMoment(ctx, c, 'dissolve', s.x, s.y, Math.min(1, 0.4 + k.acid * 0.08));
  }
  // FIRE: flame or embers against a body that isn't soaked or frozen catches it.
  if (c.frozen <= 0 && (k.fire > 0 || k.lava > 0) && soakShare < 0.4) {
    if (c.burn <= 0) {
      const oiled = c.e.status.oiled > 0 || k.oil > 0;
      c.burn = oiled ? BURN_OILED_TICKS : BURN_TICKS;
      burst(ctx, s.x, s.y, 8, fireColor, 1.1, { glow: 2.2, grav: -0.04 });
      corpseMoment(ctx, c, 'ignite', s.x, s.y, Math.min(1, 0.45 + c.mass * 0.12));
    } else if (k.oil > 0) c.burn = Math.max(c.burn, BURN_OILED_TICKS * 0.6);
  }
  // Water puts it out.
  if (c.burn > 0 && (soakShare >= 0.4 || k.water >= 3)) {
    c.burn = 0;
    burst(ctx, s.x, s.y - 2, 6, steamColor, 0.7, { grav: -0.04 });
    corpseMoment(ctx, c, 'douse', s.x, s.y, 0.5);
  }
  if (c.burn > 0) {
    c.burn = Math.max(0, c.burn - dt);
    c.char = Math.min(1, c.char + CHAR_RATE * dt);
    rot += BURN_ROT * dt;
    if (c.fate === 'gore') c.fate = 'burnt';
    writeFlame(world, c, t);
    if (fxRandom() < 0.7) ctx.particles?.spawn(s.x + (fxRandom() - 0.5) * s.r, s.y - 1, (fxRandom() - 0.5) * 0.3, -0.5 - fxRandom() * 0.5, null, fireColor(), 14 + ((fxRandom() * 10) | 0), { glow: 2, grav: -0.03 });
  }
  // CURRENT: a charged cell against the body sets it twitching; a wet body
  // carries a little of the current on into the liquid it lies in.
  if (k.charge > 0) {
    if (c.twitch <= 0) corpseMoment(ctx, c, 'twitch', s.x, s.y, Math.min(1, 0.3 + k.charge * 0.05));
    c.twitch = TWITCH_TICKS;
    if (wetShare >= 0.25 && k.wetIdx >= 0) {
      const q = chargeDeposit(ctx, 10);
      if (world.charge[k.wetIdx] < q) world.setChargeAt(k.wetIdx, q);
    }
  }
  return rot;
}

/** A burning body writes real flame: one cell of fire in the air against it. */
function writeFlame(world: World, c: Corpse, t: number): void {
  const pts: Array<[number, number]> = [];
  forEachBodyPoint(c.e, (x, y) => { pts.push([x, y]); });
  if (pts.length === 0) return;
  const [x, y] = pts[Math.floor(hash(t, pts.length) * pts.length) % pts.length];
  for (const [dx, dy] of [[0, -1], [0, -2], [1, -1], [-1, -1], [1, 0], [-1, 0]] as const) {
    const X = Math.floor(x) + dx, Y = Math.floor(y) + dy;
    if (!world.inBounds(X, Y)) continue;
    const i = world.idx(X, Y), cell = world.types[i];
    if (cell !== Cell.Empty && cell !== Cell.Oil && cell !== Cell.Grass && cell !== Cell.Leaf && cell !== Cell.MarshGas) continue;
    world.replaceCellAt(i, Cell.Fire, fireColor());
    world.life[i] = 16 + Math.floor(hash(i, t) * 14);
    return;
  }
}

/** Galvanism: the dead limbs jerk while current runs through them. */
export function twitchStep(ctx: Ctx, c: Corpse, s: BodySample): void {
  const e = c.e, t = ctx.state.frameCount;
  c.twitch--;
  if (t % 3 !== 0) return;
  const kick = (0.6 + hash(t, 7) * 0.7) / Math.sqrt(c.mass);
  const side = hash(t, 13) < 0.5 ? -1 : 1;
  const frame = corpseFrame(e);
  if (frame === 'rig' && e.rig) {
    const pts = allPoints(e.rig);
    const p = pts[Math.floor(hash(t, 3) * pts.length) % Math.max(1, pts.length)];
    if (p) { p.px -= side * kick; p.py += kick * 0.8; }
    for (const leg of e.rig.legs) { leg.x += side * 1.5 * hash(t, leg.x | 0); leg.y -= 1.2; }
  } else if (frame === 'weaver') {
    const loco = e.weaverLoco!;
    for (const leg of loco.legs) if (!leg.missing) { leg.x += (hash(t, leg.x | 0) - 0.5) * 3; leg.y -= hash(t, leg.y | 0) * 2; }
    if (hash(t, 5) < 0.3) loco.vy -= 0.4;
  } else {
    const nodes = e.body!.nodes, n = nodes[Math.floor(hash(t, 11) * nodes.length) % nodes.length];
    if (n) { n.previousX += side * kick; n.previousY += kick; }
  }
  ctx.particles?.spawn(s.x + (fxRandom() - 0.5) * s.r * 1.4, s.y + (fxRandom() - 0.5) * s.r, (fxRandom() - 0.5) * 1.2, -fxRandom() * 0.8, null, packRGB(150, 230, 255), 6, { glow: 2.2, grav: 0 });
}

// ------------------------------------------------------------------ frost: a rigid pose
/** The frozen pose: each point's offset from the centroid. */
export function captureShape(pts: readonly RigPoint[]): Float64Array {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length || 1; cy /= pts.length || 1;
  const shape = new Float64Array(pts.length * 2);
  pts.forEach((p, i) => { shape[i * 2] = p.x - cx; shape[i * 2 + 1] = p.y - cy; });
  return shape;
}

/**
 * Hold the frozen pose (2-D shape matching): find the rotation that best maps
 * the frozen offsets onto the points, then pull every point onto that rigid
 * pose. The body tumbles and slides as one piece, like a plank.
 */
export function holdShape(world: World, pts: readonly RigPoint[], shape: Float64Array): void {
  if (shape.length !== pts.length * 2 || pts.length < 2) return;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let dot = 0, cross = 0;
  pts.forEach((p, i) => {
    const rx = shape[i * 2], ry = shape[i * 2 + 1], qx = p.x - cx, qy = p.y - cy;
    dot += rx * qx + ry * qy; cross += rx * qy - ry * qx;
  });
  const a = Math.atan2(cross, dot), co = Math.cos(a), si = Math.sin(a);
  pts.forEach((p, i) => {
    const rx = shape[i * 2], ry = shape[i * 2 + 1];
    movePoint(world, p, cx + rx * co - ry * si, cy + rx * si + ry * co);
  });
}

// ------------------------------------------------------------------ splash
/**
 * A body belly-flops into a pool: the liquid it lands in is thrown up and out
 * — real cells, moved by swap (mass conserved; the sim lets it fall back) —
 * with a spray of cosmetic droplets in the pool's own colour.
 */
export function splashInto(ctx: Ctx, c: Corpse, x: number, y: number, vy: number): number {
  const world = ctx.world;
  const cx = Math.floor(x);
  let sy = Math.floor(y);
  // Find the surface: climb while still in liquid (the entry point may be a cell or two under).
  for (let k = 0; k < 6 && world.inBounds(cx, sy - 1) && isLiquid(world.types[world.idx(cx, sy - 1)]); k++) sy--;
  if (!world.inBounds(cx, sy) || !isLiquid(world.types[world.idx(cx, sy)])) return 0;
  const color = world.colors[world.idx(cx, sy)];
  const power = Math.min(1.6, vy / 4) * Math.sqrt(Math.min(4, c.mass));
  const halfW = Math.min(9, Math.round(2 + c.mass * 1.5 + vy * 0.6));
  let moved = 0;
  for (let dx = -halfW; dx <= halfW; dx++) {
    const X = cx + dx;
    if (!world.inBounds(X, sy)) continue;
    // The column's surface cell near the entry.
    let Y = sy;
    for (let k = 0; k < 3 && world.inBounds(X, Y - 1) && isLiquid(world.types[world.idx(X, Y - 1)]); k++) Y--;
    if (!isLiquid(world.types[world.idx(X, Y)])) continue;
    // Thrown up (and outward at the rim) by a few cells, into open air only.
    const edge = Math.abs(dx) / (halfW + 1);
    const lift = Math.max(1, Math.round(power * (4 + 4 * (1 - edge)) * (0.6 + hash(X, Y) * 0.6)));
    const out = Math.sign(dx) * Math.round(edge * power * 3);
    let TX = X + out, TY = Y - lift;
    while (TY < Y && (!world.inBounds(TX, TY) || world.types[world.idx(TX, TY)] !== Cell.Empty)) { TY++; TX = X + Math.round(out * (Y - TY) / lift); }
    if (TY >= Y || !world.inBounds(TX, TY)) continue;
    world.swap(X, Y, TX, TY);
    moved++;
  }
  const r = unpackR(color), g = unpackG(color), b = unpackB(color);
  const n = Math.min(26, 8 + Math.round(power * 10));
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (fxRandom() - 0.5) * 2.2;
    const sp = (1.2 + fxRandom() * 2.6) * Math.max(0.6, power);
    ctx.particles?.spawn(x + (fxRandom() - 0.5) * halfW, sy - 1, Math.cos(a) * sp, Math.sin(a) * sp, null,
      packRGB(Math.min(255, r + 40), Math.min(255, g + 40), Math.min(255, b + 40)), 18 + ((fxRandom() * 16) | 0), { grav: 0.14 });
  }
  corpseMoment(ctx, c, 'splash', x, sy, Math.min(1, 0.3 + power * 0.45));
  return moved;
}

// ------------------------------------------------------------------ shatter
/** A frozen body breaks: real ice where it was, frozen chunks that tumble, glassy shards. */
export function shatterCorpse(ctx: Ctx, c: Corpse, s: BodySample): void {
  const world = ctx.world, t = ctx.state.frameCount;
  const def = ctx.enemyCtl?.defs?.[c.e.kind];
  let ice = 0, gore = 0;
  const goreCell = def?.gore === Cell.Fire ? Cell.Ember : def?.gore === Cell.Stone ? Cell.Sand : def?.gore ?? Cell.Blood;
  forEachBodyPoint(c.e, (x, y, _r, i) => {
    const X = Math.floor(x), Y = Math.floor(y);
    if (!world.inBounds(X, Y) || world.types[world.idx(X, Y)] !== Cell.Empty) return;
    const idx = world.idx(X, Y);
    if (ice < 7 && hash(t, i) < 0.6) { world.replaceCellAt(idx, Cell.Ice, iceColor()); ice++; }
    else if (gore < 3) { world.replaceCellAt(idx, goreCell, (COLOR_FN[goreCell] ?? iceColor)()); gore++; }
  });
  // Frozen chunks as real, kickable debris.
  const bodies = ctx.rigidBodies;
  if (bodies?.spawn) {
    const pieces = Math.min(5, 2 + Math.round(c.mass));
    for (let i = 0; i < pieces; i++) {
      const a = (i / pieces) * Math.PI * 2 + hash(t, i) * 0.8;
      const sp = 0.6 + hash(i, t) * 1.2;
      const body = bodies.spawn({ kind: 'box', halfW: 1 + hash(i, 3) * 1.4, halfH: 0.7 + hash(i, 5) * 0.8 },
        s.x + Math.cos(a) * 2, s.y + Math.sin(a) * 2,
        { density: 0.7, color: i % 2 ? 0xbfe4f6 : 0x8fb8d0, restitution: 0.25, friction: 0.35,
          vx: s.vx * 0.5 + Math.cos(a) * sp, vy: s.vy * 0.5 + Math.sin(a) * sp - 0.8, va: (hash(i, 9) - 0.5) * 0.6, tag: 'gore-chunk' });
      body.goreTtl = 1500 + i * 90;
    }
  }
  for (let i = 0; i < 24; i++) {
    const a = fxRandom() * Math.PI * 2, sp = 0.8 + fxRandom() * 2.6;
    ctx.particles?.spawn(s.x + Math.cos(a) * s.r * 0.4, s.y + Math.sin(a) * s.r * 0.4, Math.cos(a) * sp + s.vx * 0.3, Math.sin(a) * sp - 0.6,
      null, i % 3 ? packRGB(200, 236, 255) : packRGB(150, 200, 235), 20 + ((fxRandom() * 18) | 0), { glow: 0.9, grav: 0.1 });
  }
  corpseMoment(ctx, c, 'shatter', s.x, s.y, Math.min(1, 0.5 + c.mass * 0.12));
  c.gone = true;
}

// ------------------------------------------------------------------ strikes
export interface PendingBlow {
  e: Enemy;
  dmg: number;
  kx: number;
  ky: number;
  bowled: boolean;
}

/** Damage a body deals striking a creature at relative speed `rel`. Pure. */
export function bowlDamage(mass: number, rel: number): number {
  if (rel < BOWL_MIN_SPEED) return 0;
  return Math.min(BOWL_MAX, Math.round(BOWL_BASE + BOWL_K * Math.pow(Math.max(0.1, mass), 0.6) * rel));
}

/**
 * A fast body passing through a creature strikes it: damage by mass and
 * relative speed, knockback along its flight, one blow per creature per
 * flight. The blows are queued (a kill makes a new corpse; the list must not
 * change under the caller's loop). Returns true if it struck.
 */
export function strikeCreatures(ctx: Ctx, c: Corpse, s: BodySample, now: number, out: PendingBlow[]): boolean {
  if (c.hitCd > 0) return false;
  const speed = Math.hypot(s.vx, s.vy);
  if (speed < BOWL_MIN_SPEED || !ctx.enemies?.length) return false;
  const defs = ctx.enemyCtl?.defs;
  if (!defs) return false;
  for (const e of ctx.enemies) {
    if (e.hp <= 0 || e === c.e || c.struck.includes(e)) continue;
    const def = defs[e.kind];
    if (!def) continue;
    const reach = s.r + def.halfW + def.h + 4;
    if (Math.abs(e.x - s.x) > reach || Math.abs(e.y - def.h * 0.5 - s.y) > reach) continue;
    let hit = false;
    forEachBodyPoint(c.e, (x, y, r) => { if (!hit && pointHitsCreature(e, def, x, y, Math.min(2.5, r))) hit = true; });
    if (!hit) continue;
    const rel = Math.hypot(s.vx - (e.vx || 0), s.vy - (e.vy || 0));
    const dmg = bowlDamage(c.mass, rel);
    if (dmg <= 0) continue;
    const push = Math.min(4.5, Math.sqrt(c.mass) * 0.7);
    out.push({ e, dmg, kx: (s.vx / (speed || 1)) * push * 1.6, ky: (s.vy / (speed || 1)) * push - 1.2, bowled: now < c.bowlUntil });
    c.struck.push(e);
    c.hitCd = BOWL_COOLDOWN;
    // The body sheds momentum into the creature and thuds off it.
    pushBody(c.e, -s.vx * (1 - BOWL_KEEP), -s.vy * (1 - BOWL_KEEP));
    ctx.particles?.burst(e.x, e.y - def.h * 0.5, 6, null, () => packRGB(200, 180, 150), 1.4, { grav: 0.06 });
    corpseMoment(ctx, c, 'bowl', e.x, e.y - def.h * 0.5, Math.min(1, dmg / 50));
    if (c.frozen > 0 && rel >= SHATTER_BOWL_SPEED) shatterCorpse(ctx, c, s);
    return true;
  }
  return false;
}

/** A fast body shoves the loose crates and bones it passes through (their mass resists). */
export function strikeBodies(ctx: Ctx, c: Corpse, s: BodySample): void {
  if (c.bodyCd > 0) return;
  const speed = Math.hypot(s.vx, s.vy);
  const rb = ctx.rigidBodies;
  if (speed < SHOVE_MIN_SPEED || !rb?.hitTest || !rb.bodies?.length) return;
  let hitBody: ReturnType<typeof rb.hitTest> = null, hx = 0, hy = 0, visited = 0;
  forEachBodyPoint(c.e, (x, y) => {
    if (hitBody || visited++ > 10) return;
    const b = rb.hitTest(x, y);
    if (b && b.kind === 'dynamic' && b !== rb.heldBody?.() && !b.tag?.startsWith('flora-')) { hitBody = b; hx = x; hy = y; }
  });
  if (!hitBody) return;
  rb.applyMomentumAt(hitBody, s.vx * c.mass * SHOVE_K, s.vy * c.mass * SHOVE_K, hx, hy);
  pushBody(c.e, -s.vx * 0.3, -s.vy * 0.3);
  c.bodyCd = 12;
  corpseMoment(ctx, c, 'thud', hx, hy, Math.min(1, speed / 7));
}

/**
 * The alchemist is not hurt by his own throws — except a genuinely heavy body
 * dropped on his head, which is only fair (and small).
 */
export function strikePlayer(ctx: Ctx, c: Corpse, s: BodySample): void {
  const p = ctx.player;
  if (c.headCd > 0 || c.grip || c.mass < HEAD_MASS_MIN || s.vy < HEAD_MIN_VY || !p || p.dead || !ctx.playerCtl) return;
  if (Math.abs(s.x - p.x) > s.r + 6 || Math.abs(s.y - (p.y - 14)) > s.r + 8) return;
  let hit = false;
  forEachBodyPoint(c.e, (x, y, r) => {
    if (!hit && Math.abs(x - p.x) <= 4 + r && y >= p.y - 19 - r && y <= p.y - 10) hit = true;
  });
  if (!hit) return;
  const dmg = Math.min(HEAD_DMG_MAX, Math.round(1 + c.mass * s.vy * 0.45));
  ctx.playerCtl.damage(dmg, Math.sign(s.vx || 1) * 0.8, -0.4, 'hostile-debris');
  pushBody(c.e, Math.sign(s.x - p.x || 1) * 0.8, -s.vy * 1.2);
  c.headCd = 45;
  corpseMoment(ctx, c, 'thud', s.x, s.y, 0.8);
}

/** A body landing hard is heard, and throws the dust (or the ice) of what it hit. */
export function landingDust(ctx: Ctx, c: Corpse, s: BodySample, dv: number): void {
  const world = ctx.world;
  const X = Math.floor(s.x), Y = Math.floor(s.y + s.r * 0.6);
  let col = packRGB(150, 138, 120);
  for (let k = 0; k < 4; k++) {
    if (!world.inBounds(X, Y + k)) break;
    const tt = world.types[world.idx(X, Y + k)];
    if (blocksEntity(tt)) { col = world.colors[world.idx(X, Y + k)]; break; }
  }
  const n = Math.min(16, Math.round(3 + dv * 2 + c.mass));
  const r = Math.min(255, unpackR(col) + 30), g = Math.min(255, unpackG(col) + 30), b = Math.min(255, unpackB(col) + 30);
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    ctx.particles?.spawn(s.x + side * fxRandom() * s.r, s.y + s.r * 0.5, side * (0.4 + fxRandom() * 1.4), -0.3 - fxRandom() * 0.9, null, packRGB(r, g, b), 14 + ((fxRandom() * 12) | 0), { grav: 0.05 });
  }
  corpseMoment(ctx, c, 'thud', s.x, s.y + s.r * 0.5, Math.min(1, (dv - THUD_DV) / 4 + 0.25 + c.mass * 0.05));
  // A heavy carcass slammed down is felt: a small, local shake (the same
  // quadratic falloff as every ambient shake, dead at 420 cells).
  if (c.mass >= HEAVY_THUD_MASS && dv >= HEAVY_THUD_DV && ctx.fx && ctx.camera) {
    const d = Math.hypot(s.x - (ctx.camera.x + VIEW_W / 2), s.y - (ctx.camera.y + VIEW_H / 2));
    const falloff = Math.max(0, 1 - d / 420);
    ctx.fx.screenShake = Math.min((ctx.fx.screenShake ?? 0) + 0.004 * dv * Math.sqrt(c.mass) * falloff * falloff, 0.025);
  }
}

/** Remains this heavy landing this hard shake the view a little. */
const HEAVY_THUD_MASS = 2;
const HEAVY_THUD_DV = 3;
