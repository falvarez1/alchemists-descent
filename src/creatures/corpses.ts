import type { CorpsesApi, Ctx, Enemy, GustFalloff } from '@/core/types';
import type { World } from '@/sim/World';
import { Cell, isLiquid } from '@/sim/CellType';
import { COLOR_FN, ashColor, emberColor, smokeColor } from '@/sim/colors';
import { circleFree, createChainIn, sweptNodeTarget, tickChain } from './body';
import { makeWeaverLoco, WEAVER_LEG_REACH_LOCO, weaverHipWorld } from '@/entities/weaverLocomotion';
import { ensureRig } from './species';
import { constrain, impulse, integrate, liquidAt, movePoint, place, solidAt } from './rig/physics';
import type { IntegrateOpts, RigPoint } from './rig/physics';
import { solveKnee } from './rig/limb';
import { weaverSilhouetteBottom, weaverSilhouetteOverlap } from './weaverAnatomy';
import type { CreatureRig } from './rig/types';
import { BAT } from './species/bat';
import type { BodySample } from './corpseBody';
import { allPoints, corpseFrame, corpseMass, emptySample, forEachBodyPoint, pushBody, pushField, sampleBody } from './corpseBody';
import type { CorpseContact, PendingBlow } from './corpseWorld';
import {
  captureShape, CENSUS_EVERY, corpseMoment, emptyContact, FROZEN_TICKS, holdShape, landingDust, senseContact, shatterCorpse,
  SHATTER_DV, SPLASH_MIN_VY, splashInto, stepElements, strikeBodies, strikeCreatures, strikePlayer, THUD_DV, THUD_MIN_SPEED, twitchStep,
} from './corpseWorld';
import type { CorpseMomentKind } from '@/core/events';

export { allPoints } from './corpseBody';

/**
 * Corpses — Rain World's physical death. A slain creature keeps its body: the
 * rig goes limp and falls, drapes over ledges, floats belly-up in water; a
 * spider's legs curl in; gel slumps into a puddle; lights inside it gutter
 * out. After a while the remains melt back into the grid as the material
 * they were made of — blood, slime, acid, embers — so the world keeps them.
 *
 * And the remains are mass (creatures/corpseWorld): the wand can lift and
 * hurl them (combat/Telekinesis), a boot or a blast sends them flying, a fast
 * one strikes what it meets (BOWLED), they splash, burn, freeze, shatter and
 * twitch by the cells they touch, and they weigh on pressure plates.
 * Handling keeps them fresh a while (bounded). Still presentation-grade in one
 * way: nothing here is saved, and the list clears itself when the world
 * changes (level transitions).
 */
export interface Corpse {
  e: Enemy;
  age: number;
  ttl: number;
  /** Skeleton constraints captured at death: point pairs and rest lengths. */
  bonds: Array<[RigPoint, RigPoint, number]>;
  /** 1 alive-bright → 0 dark: emissive parts gutter out. */
  glow: number;
  world: World;
  /** A Weaver's remains: ticks lain still, whether it has kicked over, and the flip window. */
  restT?: number;
  rolled?: boolean;
  flipT?: number;
  // ---- the remains as a physical object -------------------------------
  /** What it weighs, in slimes (creatures/corpseBody CORPSE_MASS). */
  mass: number;
  /** Centroid velocity at the end of the last tick (impact detection). */
  pvx: number;
  pvy: number;
  /** Velocity 2 ticks before that (a long body meets a wall over a few ticks: the impact is their sum). */
  hvx: number;
  hvy: number;
  h2vx: number;
  h2vy: number;
  /** The wand's hold: Telekinesis writes the pull each tick; null when free. */
  grip: CorpseGrip | null;
  /** Last tick the alchemist handled it (lift, hold, hurl, kick, set down). */
  touchT: number;
  /** A strike before this tick is his doing: BOWLED. */
  bowlUntil: number;
  /** Ticks of flight left (a hurl, kick or blast): thin air, long arcs. */
  flight: number;
  /** Rot already spared by handling or frost (bounded by SPARE_MAX). */
  spared: number;
  /** Ticks resting (not held, flying or frozen): a gel slumps by this, not by age. */
  slump: number;
  /** Fire left (ticks) and how charred it is (0..1). */
  burn: number;
  char: number;
  /** Frozen stiff (ticks left) and the pose it froze in. */
  frozen: number;
  shape: Float64Array | null;
  /** Galvanic twitch ticks left. */
  twitch: number;
  /** Cooldowns: striking a creature, shoving a crate, landing on the alchemist. */
  hitCd: number;
  bodyCd: number;
  headCd: number;
  /** Creatures this flight has already struck (one blow each). */
  struck: Enemy[];
  /** Centroid in liquid last tick; ticks since it was last dry-to-wet. */
  wasWet: boolean;
  dryT: number;
  /** Last tick each moment was announced (throttle). */
  moments: Partial<Record<CorpseMomentKind, number>>;
  /** How it ends: melted gore, ash and embers, taken by lava, eaten by acid. */
  fate: 'gore' | 'burnt' | 'lava' | 'acid';
  /** Flies have found it. */
  flies: boolean;
  /** Shattered or eaten this tick: leaves without melting. */
  gone: boolean;
}

/** The wand's pull on a held body: which point (−1 = the whole body) and this tick's acceleration. */
export interface CorpseGrip {
  index: number;
  ax: number;
  ay: number;
  /** The tick the pull was written: a stale pull (the wand not updated this tick) only holds the body up. */
  tick: number;
}

/** This tick's pull, or none if the wand did not write one (the body just hangs in the field). */
function pullOf(grip: CorpseGrip, now: number): { ax: number; ay: number } {
  return grip.tick === now ? grip : NO_PULL;
}
const NO_PULL = { ax: 0, ay: 0 };

const CORPSE_TTL = 720; // ~12s of remains
const MAX_CORPSES = 10;
/** A limp bond may stretch this far past its rest length, and no further. */
const BOND_MAX_STRETCH = 1.5;
const NO_CORPSE = new Set<Enemy['kind']>(['bomber', 'colossus', 'eggs']);
/** Handled remains (lifted, thrown, kicked) keep fresh this long after... */
export const SPARE_WINDOW = 240;
/** ...but no body is spared more than 30 s of rot in total (frost included). */
export const SPARE_MAX = 1800;
/** An impact this soon after the alchemist set the body moving is his (BOWLED). */
export const BOWL_CREDIT_TICKS = 240;
/** Air time after a hurl, kick or blast: thin drag, so a throw carries. */
export const FLIGHT_TICKS = 90;
/** The field takes this share of the weight off the parts of a body it doesn't hold. */
export const FIELD_LIFT = 0.35;
/** A boot's kick: speed a 1-slime body leaves at (÷√mass for heavier). */
export const KICK_SPEED = 6;
/** A body counts as kicked within this cone of the aim (cos ≈ 80°), or lying at the boot. */
const BODY_KICK_COS = 0.17;
/** The kick's gust: shove per unit falloff (÷√mass). */
const GUST_SPEED = 1.6;

/** Limp: heavy air drag so the dead settle; buoyant in liquid. */
const LIMP: IntegrateOpts = { gravity: 0.22, damping: 0.93, wetDamping: 0.8, buoyancy: -0.35, friction: 0.7 };
/** In flight: a thrown body keeps its momentum. */
const FLIGHT: IntegrateOpts = { gravity: 0.22, damping: 0.985, wetDamping: 0.8, buoyancy: -0.35, friction: 0.55, maxSpeed: 7.5 };
/** Frozen stiff: it slides like a plank (ice floats). */
const FROZEN: IntegrateOpts = { gravity: 0.22, damping: 0.99, wetDamping: 0.85, buoyancy: -0.2, friction: 0.06, maxSpeed: 7.5 };

const list: Corpse[] = [];
const SAMPLE: BodySample = emptySample();
const AFTER: BodySample = emptySample();
const CONTACT: CorpseContact = emptyContact();

export function corpses(): readonly Corpse[] {
  return list;
}

export function clearCorpses(): void {
  list.length = 0;
}

/** Eaten whole (a snapjaw's meal): the remains leave the world without melting into it. */
export function removeCorpse(c: Corpse): void {
  const i = list.indexOf(c);
  if (i >= 0) list.splice(i, 1);
  c.grip = null;
  c.gone = true;
}

/**
 * Scavenged: something is feeding on the remains. Each bite hastens the melt a
 * little (the body is literally being taken away) and returns true while there
 * is still something left worth eating.
 */
export function scavengeCorpse(c: Corpse, bite: number): boolean {
  if (list.indexOf(c) < 0) return false;
  c.age = Math.min(c.ttl, c.age + bite);
  return c.age < c.ttl - 1;
}

/** Is this body still lying in the world (not eaten, melted or shattered)? */
export function corpseLive(c: Corpse, world: World): boolean {
  return !c.gone && c.world === world && list.includes(c);
}

/** The alchemist handled the body: it keeps fresh a while, and what it strikes next is his. */
export function touchCorpse(c: Corpse, now: number): void {
  c.touchT = now;
  c.bowlUntil = now + BOWL_CREDIT_TICKS;
  c.struck.length = 0;
}

/**
 * Re-read the body's velocity after an outside push, so the push is not taken
 * for an impact — and let a body flung out of a puddle leave the puddle's drag
 * behind (a point's immersion is smoothed over several ticks; a kick out of the
 * blood it lay in used to lose a third of its speed to liquid it had left).
 */
function resyncVelocity(c: Corpse): void {
  // ...and the ground it was lying on: last tick's floor contact would charge
  // the launch a tick of ground friction (a punt lost half its speed to it).
  if (c.e.rig && c.world) for (const p of allPoints(c.e.rig)) { p.hit = 0; if (!liquidAt(c.world, p.x, p.y)) p.wet = 0; }
  const s = sampleBody(c.e, SAMPLE);
  c.pvx = c.hvx = c.h2vx = s.vx; c.pvy = c.hvy = c.h2vy = s.vy;
}

/**
 * Fling the body (a hurl, a punt): every part takes the velocity, the gripped
 * part a little more so it tumbles end over end.
 */
export function launchCorpse(c: Corpse, vx: number, vy: number, now: number, spinIndex = -1): void {
  c.grip = null;
  pushBody(c.e, vx, vy);
  if (spinIndex >= 0 && c.e.rig && corpseFrame(c.e) === 'rig') {
    const p = allPoints(c.e.rig)[spinIndex];
    if (p) impulse(p, vx * 0.18, vy * 0.18 - 0.4);
  }
  c.flight = FLIGHT_TICKS;
  touchCorpse(c, now);
  resyncVelocity(c);
}

/** Let go: it keeps the momentum it has (and whatever it strikes is still his). */
export function releaseCorpse(c: Corpse, now: number): void {
  c.grip = null;
  c.flight = Math.max(c.flight, 40);
  touchCorpse(c, now);
}

function allRigPoints(rig: CreatureRig): RigPoint[] {
  return allPoints(rig);
}

/** Keep the body: called from the kill path for creatures that leave remains. */
export function addCorpse(ctx: Ctx, e: Enemy, kx: number, ky: number): boolean {
  if (NO_CORPSE.has(e.kind) || ctx.state.mode !== 'play') return false;
  // Killed before its body was ever posed (frozen outside the simulated
  // window, or on the tick it spawned): build the body now, or the remains
  // hang in the air where it stood.
  if (e.kind === 'weaver') e.weaverLoco ??= makeWeaverLoco(e.x, e.y);
  if ((e.kind === 'rillback' || e.kind === 'stonemaw') && !e.body) {
    e.body = createChainIn(ctx.world, e.x, e.y - 4, e.mind?.facing ?? 1, e.kind === 'rillback' ? 9 : 7);
  }
  const rig = e.rig ?? ensureRig(e) ?? undefined;
  const bonds: Corpse['bonds'] = [];
  if (rig) {
    // Bond each body chunk to its neighbours, each chain root to its nearest chunk.
    for (let i = 1; i < rig.pts.length; i++) {
      const a = rig.pts[i - 1], b = rig.pts[i];
      bonds.push([a, b, Math.hypot(a.x - b.x, a.y - b.y)]);
    }
    for (const c of rig.chains) {
      for (let i = 1; i < c.pts.length; i++) bonds.push([c.pts[i - 1], c.pts[i], c.seg]);
      let best: RigPoint | null = null, bd = Infinity;
      for (const p of rig.pts) { const d = Math.hypot(p.x - c.pts[0].x, p.y - c.pts[0].y); if (d < bd) { bd = d; best = p; } }
      if (best) bonds.push([best, c.pts[0], bd]);
    }
    // Every point gets a collision radius and the death impulse.
    const pts = allRigPoints(rig);
    for (const p of pts) { if (p.r <= 0) p.r = 0.4; impulse(p, (kx || 0) * 0.5, Math.min(0, (ky || 0) * 0.5) - 0.6); }
    if (rig.soft) for (const p of rig.soft.pts) p.r = Math.max(p.r, 0.5);
  }
  // Death poses the rig itself can't find by falling.
  if (rig && e.kind === 'bat') { rig.f[BAT.fold] = 1; rig.f[BAT.spread] = 0; rig.f[BAT.flapRate] = 0; }
  e.hp = Math.min(e.hp, 0);
  // A dead face: eyes shut, jaw slack.
  if (e.expression) { e.expression.lid = 1; e.expression.jaw = 0.4; e.expression.alert = 0; e.expression.fear = 0; }
  // The elements it died in stay with the body: a creature that burned keeps
  // burning, a frozen one is a frozen carcass, a shocked one still jerks.
  const burning = (e.status?.burning ?? 0) > 0, frozen = (e.status?.frozen ?? 0) > 0, shocked = (e.status?.electrified ?? 0) > 0;
  e.sleeping = false;
  e.flash = 0;
  e.windup = 0; e.swoop = 0; e.blink = 0; e.fusing = 0; e.recoil = 0; e.punching = 0; e.jetFuel = 0;
  e.attackCd = 999;
  if (e.weaverLoco) { e.weaverLoco.mode = 'airborne'; e.weaverLoco.vx += (kx || 0) * 0.3; e.weaverLoco.vy += -0.8; }
  e.submerged = false;
  const c: Corpse = {
    e, age: 0, ttl: CORPSE_TTL + ((e.bobPhase * 60) | 0), bonds, glow: 1, world: ctx.world,
    mass: corpseMass(e.kind), pvx: 0, pvy: 0, hvx: 0, hvy: 0, h2vx: 0, h2vy: 0, grip: null, touchT: -1e9, bowlUntil: -1e9, flight: 0, spared: 0, slump: 0,
    burn: burning && !frozen ? 240 : 0, char: 0, frozen: frozen ? FROZEN_TICKS : 0, shape: null, twitch: shocked ? 60 : 0,
    hitCd: 0, bodyCd: 0, headCd: 0, struck: [], wasWet: false, dryT: 99, moments: {}, fate: 'gore', flies: false, gone: false,
  };
  resyncVelocity(c);
  list.push(c);
  // Too many remains: the oldest one nobody is handling melts first (never the held one).
  while (list.length > MAX_CORPSES) {
    const now = ctx.state.frameCount;
    let idx = list.findIndex((k, i) => i < list.length - 1 && !k.grip && now - k.touchT > SPARE_WINDOW);
    if (idx < 0) idx = list.findIndex((k, i) => i < list.length - 1 && !k.grip);
    if (idx < 0) idx = 0;
    const [old] = list.splice(idx, 1);
    meltCorpse(ctx, old, true);
  }
  return true;
}

/** The remains return to the grid as what they were made of (or what the world made of them). */
function meltCorpse(ctx: Ctx, c: Corpse, quick = false): void {
  if (c.world !== ctx.world) return;
  const def = ctx.enemyCtl.defs[c.e.kind];
  const w = ctx.world;
  const gore = def.gore === Cell.Fire ? Cell.Ember : def.gore === Cell.Stone ? Cell.Sand : def.gore;
  // Burnt remains fall to ash with a few live embers; lava leaves nothing but
  // a little ash on its surface; acid leaves less of the body.
  const cellFor = (k: number): number => c.fate === 'burnt' || c.fate === 'lava' ? (k % 4 === 0 ? Cell.Ember : Cell.Ash) : gore;
  const pts: Array<{ x: number; y: number }> = [];
  forEachBodyPoint(c.e, (x, y) => { pts.push({ x, y }); });
  if (pts.length === 0) pts.push({ x: c.e.x, y: c.e.y - 3 });
  let placed = 0;
  let budget = quick ? 6 : Math.min(28, Math.round(def.halfW * def.h * 0.12));
  if (c.fate === 'lava') budget = Math.min(budget, 4);
  else if (c.fate === 'acid') budget = Math.ceil(budget * 0.4);
  for (let k = 0; k < pts.length * 2 && placed < budget; k++) {
    const p = pts[(k * 7) % pts.length];
    const x = Math.floor(p.x + ((k * 13) % 5) - 2), y = Math.floor(p.y + ((k * 5) % 3) - 1);
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    const t = w.types[i];
    const cell = cellFor(k);
    // Ash and embers settle only into open air (never displace a pool — or lava).
    if (cell !== gore ? t !== Cell.Empty : t !== Cell.Empty && !(isLiquid(t) && t !== cell)) continue;
    const color = cell === Cell.Ash ? ashColor() : cell === Cell.Ember ? emberColor() : (COLOR_FN[cell] ?? def.goreFn)();
    w.replaceCellAt(i, cell, color);
    placed++;
  }
  if (!quick) {
    const s = sampleBody(c.e, SAMPLE);
    if (c.fate === 'gore') ctx.particles?.burst(s.x, s.y, 6, null, def.goreFn, 0.6, { grav: 0.05 });
    else ctx.particles?.burst(s.x, s.y, 8, null, c.fate === 'acid' ? smokeColor : emberColor, 0.7, { grav: -0.02, glow: c.fate === 'acid' ? 0 : 1.6 });
  }
  if (!quick && (c.fate === 'gore' || c.fate === 'burnt')) leaveBones(ctx, c);
}

const BONES: Partial<Record<Enemy['kind'], number>> = { spitter: 2, golem: 0, mage: 2, weaver: 1, rootloper: 0, stonemaw: 2, rillback: 1, leviathan: 3, bat: 1 };

/** What outlasts the flesh: a few bones (or a mask) left as real, kickable debris. */
function leaveBones(ctx: Ctx, c: Corpse): void {
  const count = BONES[c.e.kind] ?? 0;
  if (count <= 0 || !ctx.rigidBodies?.spawn) return;
  const big = c.e.kind === 'leviathan';
  for (let i = 0; i < count; i++) {
    const mask = c.e.kind === 'mage' && i === 0;
    const body = ctx.rigidBodies.spawn(
      mask ? { kind: 'circle', radius: 1.8 } : { kind: 'box', halfW: big ? 3.6 : 1.8 + (i % 2) * 0.5, halfH: big ? 0.9 : 0.55 },
      c.e.x + (i - count / 2) * 2.5, c.e.y - 2 - i,
      { density: 0.6, color: mask ? 0xd8cfb4 : c.fate === 'burnt' ? 0x3a302a : chitin(c.e.kind), restitution: 0.3, friction: 0.7,
        vx: (i - count / 2) * 0.3, vy: -0.6, va: (i % 2 ? 0.2 : -0.2), tag: 'gore-chunk' },
    );
    body.goreTtl = 3600 + i * 120;
  }
}

function chitin(kind: Enemy['kind']): number {
  return kind === 'weaver' ? 0x241c30 : kind === 'stonemaw' ? 0x4a4236 : 0xcfc6ad;
}

/**
 * The soft constraints above respect terrain, so a point snagged on a ledge
 * (or wedged in a wall) can't follow its neighbour and the bond between them
 * stretches without limit as the rest of the body falls away. Hard-cap every
 * bond: past BOND_MAX_STRETCH × rest the child is pulled back along the bond,
 * through the snag if need be, with its velocity killed so it can't whip.
 * A pinned point (the one the wand holds) never moves: its partner does.
 */
export function capBonds(bonds: Corpse['bonds'], pin: RigPoint | null = null): void {
  for (const [a, b, rest] of bonds) {
    const max = Math.max(1, rest * BOND_MAX_STRETCH);
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d <= max) continue;
    if (pin === b) place(a, b.x - (dx / d) * max, b.y - (dy / d) * max);
    else place(b, a.x + (dx / d) * max, a.y + (dy / d) * max);
  }
}

function stepLegs(world: World, rig: CreatureRig, age: number): void {
  for (const leg of rig.legs) {
    // Legs go slack: feet fall until they rest on something, then slide in.
    let hip: RigPoint | null = null, bd = Infinity;
    for (const p of rig.pts) { const d = Math.hypot(p.x - leg.kx, p.y - leg.ky); if (d < bd) { bd = d; hip = p; } }
    if (!hip) continue;
    leg.planted = false; leg.swing = -1;
    // Afloat, the dead lie belly-up: the feet rise out of the water.
    if (liquidAt(world, leg.x, leg.y)) leg.y -= 0.5;
    else if (!solidAt(world, leg.x, leg.y + 0.6)) leg.y += Math.min(1.2, 0.3 + age * 0.02);
    leg.x += (hip.x - leg.x) * 0.02;
    const reach = leg.upper + leg.lower, dx = leg.x - hip.x, dy = leg.y - hip.y, d = Math.hypot(dx, dy);
    if (d > reach) { leg.x = hip.x + dx / d * reach; leg.y = hip.y + dy / d * reach; }
    solveKnee(leg, hip.x, hip.y);
  }
}

/** A point whose centre sits in terrain climbs to the nearest open cell above or beside (velocity killed). */
function unembed(world: World, p: RigPoint): void {
  if (!solidAt(world, p.x, p.y)) return;
  for (let r = 1; r <= 5; r++) {
    for (const [dx, dy] of [[0, -r], [-r, 0], [r, 0], [-r, -r], [r, -r]] as const) {
      if (solidAt(world, p.x + dx, p.y + dy)) continue;
      place(p, p.x + dx, p.y + dy);
      return;
    }
  }
}

/** Frozen legs keep their pose: they ride along with their hips. */
function carryLegs(rig: CreatureRig, dx: number, dy: number): void {
  for (const leg of rig.legs) { leg.x += dx; leg.y += dy; leg.kx += dx; leg.ky += dy; }
}

/**
 * A dead Weaver is its drawn silhouette, not a point: it falls, slides and
 * tips over as that shape against the grid, in sub-cell sweeps (so a thin
 * plank still catches it). Remains that start in terrain (killed against a
 * wall, buried by sand) only ever work their way up or sideways out of it —
 * never deeper. Held by the wand it hangs from the grip; frozen, it slides
 * like a plank with its legs locked; afloat, it bobs.
 */
function stepWeaverCorpse(world: World, c: Corpse, now: number): void {
  const e = c.e, loco = e.weaverLoco, age = c.age;
  if (!loco) return;
  const grip = c.grip, frozen = c.frozen > 0, flying = c.flight > 0;
  const overlap = (x: number, y: number, nx = loco.nx, ny = loco.ny, face: number = loco.face): number =>
    weaverSilhouetteOverlap(world, x, y, nx, ny, face);
  const x0 = loco.px, y0 = loco.py;
  if (overlap(loco.px, loco.py) > 0) {
    // Squeezed by terrain: slide toward the nearest clear pose above or beside.
    loco.vx = 0; loco.vy = 0; c.restT = 0;
    search: for (let r = 1; r <= 12; r++) {
      for (const [dx, dy] of [[0, -r], [-r, 0], [r, 0], [-r, -r], [r, -r]] as const) {
        if (overlap(loco.px + dx, loco.py + dy) > 0) continue;
        loco.px += Math.max(-1.5, Math.min(1.5, dx)); loco.py += Math.max(-1.5, Math.min(1.5, dy));
        break search;
      }
    }
  } else {
    const wet = liquidAt(world, loco.px, loco.py);
    if (grip) {
      const pull = pullOf(grip, now);
      loco.vx = loco.vx * 0.94 + pull.ax;
      loco.vy = loco.vy * 0.94 + pull.ay;
    } else {
      // Afloat: the shell is buoyant and the water drags at it.
      loco.vy = Math.min(3, loco.vy + (wet ? -0.1 : 0.25));
      if (wet) { loco.vx *= 0.85; loco.vy *= 0.85; }
      loco.vx *= frozen || flying ? 0.995 : 0.94;
    }
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(loco.vx), Math.abs(loco.vy)) / 0.5));
    let sx = loco.vx / steps, sy = loco.vy / steps, landed = false;
    for (let k = 0; k < steps && (sx !== 0 || sy !== 0); k++) {
      if (sx !== 0) {
        if (overlap(loco.px + sx, loco.py) === 0) loco.px += sx;
        else { sx = 0; loco.vx *= -0.2; }
      }
      if (sy !== 0) {
        if (overlap(loco.px, loco.py + sy) === 0) loco.py += sy;
        else { landed = sy > 0; sy = 0; loco.vy = 0; }
      }
    }
    if (landed) { loco.vx *= frozen ? 0.97 : 0.6; c.restT = (c.restT ?? 0) + 1; } else if (loco.vy > 0.3) c.restT = 0;
    if (!grip && !frozen) {
      // Tip over onto the nearer of back or belly, pivoting clear of the ground.
      const angle = Math.atan2(loco.ny, loco.nx), level = loco.ny < 0 ? -Math.PI / 2 : Math.PI / 2;
      const tip = Math.max(-0.08, Math.min(0.08, level - angle));
      if (Math.abs(tip) > 1e-3) {
        const nx = Math.cos(angle + tip), ny = Math.sin(angle + tip);
        for (let lift = 0; lift <= 3; lift += 0.5) {
          if (overlap(loco.px, loco.py - lift, nx, ny) > 0) continue;
          loco.nx = nx; loco.ny = ny; loco.py -= lift;
          break;
        }
      }
      // Settled upright: a last kick flips it onto its back, mirrored about
      // its spine at the top of the hop so the head stays where it was.
      if (!c.rolled && (c.restT ?? 0) > 14 && loco.ny < -0.98) { c.rolled = true; c.flipT = 12; loco.vy = -1.5; loco.vx += loco.face * 0.2; }
      if ((c.flipT ?? 0) > 0 && loco.vy >= 0) {
        const face = loco.face === 1 ? -1 : 1;
        for (let lift = 0; lift <= 3; lift += 0.5) {
          if (overlap(loco.px, loco.py - lift, loco.nx, -loco.ny, face) > 0) continue;
          loco.ny = -loco.ny; loco.face = face; loco.py -= lift; c.flipT = 0;
          break;
        }
        if (c.flipT) c.flipT--;
      }
    }
  }
  const curl = Math.min(1, age / 70), onBack = loco.ny > 0;
  loco.legs.forEach((leg, i) => {
    if (leg.missing) return;
    leg.planted = false; leg.lift = 0;
    // Feet travel with the body; upright, the legs buckle and settle on the
    // ground; on its back, a dead spider folds them in over its belly. Held
    // up, they dangle; frozen, they stay exactly as they froze.
    leg.x += loco.px - x0; leg.y += loco.py - y0;
    if (frozen) return;
    if (grip) {
      // Held up, a dead spider's legs clutch in under it and trail the swing.
      const hip = weaverHipWorld(loco, i), reach = WEAVER_LEG_REACH_LOCO[i] ?? 20;
      const tx = loco.px + (hip.x - loco.px) * 0.7 - loco.vx * 2, ty = hip.y + reach * 0.42 - loco.vy * 2;
      leg.x += (tx - leg.x) * 0.12; leg.y += (ty - leg.y) * 0.12;
    }
    else if (onBack) {
      const tx = loco.px + (leg.x - loco.px) * (1 - curl * 0.55), ty = loco.py - 6 * curl + (leg.y - loco.py) * (1 - curl * 0.7);
      leg.x += (tx - leg.x) * 0.08; leg.y += (ty - leg.y) * 0.08;
    } else if (!solidAt(world, leg.x, leg.y + 1)) leg.y += 1;
    // Never inside terrain: a buried foot is drawn back toward its hip. It
    // used to be pushed straight UP, which in a shaft narrower than the leg
    // span let each foot climb the rock face a few cells every tick while the
    // body fell, stretching the legs up to the ceiling.
    const hip = weaverHipWorld(loco, i), reach = WEAVER_LEG_REACH_LOCO[i] ?? 20;
    for (let k = 0; k < 8 && solidAt(world, leg.x, leg.y); k++) {
      leg.x += (hip.x - leg.x) * 0.3; leg.y += (hip.y - leg.y) * 0.3;
    }
    // …and a dead leg is still exactly as long as a living one.
    const dx = leg.x - hip.x, dy = leg.y - hip.y, d = Math.hypot(dx, dy);
    if (d > reach) { leg.x = hip.x + (dx / d) * reach; leg.y = hip.y + (dy / d) * reach; }
  });
  // The anchor (melting, flies) sits where the remains touch the ground.
  e.x = Math.round(loco.px); e.y = Math.round(loco.py + weaverSilhouetteBottom(loco.nx, loco.ny, loco.face));
}

/** A verlet rig's remains: limp, held, flying or frozen. */
function stepRigCorpse(world: World, c: Corpse, rig: CreatureRig, opts: IntegrateOpts, now: number): void {
  const pts = allRigPoints(rig);
  const grip = c.grip;
  // Frozen stiff, the body is one rigid piece: the wand holds all of it.
  const whole = grip !== null && (grip.index < 0 || grip.index >= pts.length || c.frozen > 0);
  const g = opts.gravity;
  const pull = grip ? pullOf(grip, now) : NO_PULL;
  const hip0 = rig.pts[0], hx = hip0?.x ?? 0, hy = hip0?.y ?? 0;
  for (let k = 0; k < pts.length; k++) {
    let ax = 0, ay = 0;
    if (grip) {
      if (whole || k === grip.index) { ax = pull.ax; ay = pull.ay - g; }
      else ay = -g * FIELD_LIFT;
    }
    integrate(world, pts[k], opts, ax, ay);
  }
  const frozen = c.frozen > 0;
  if (frozen) {
    if (!c.shape || c.shape.length !== pts.length * 2) c.shape = captureShape(pts);
    holdShape(world, pts, c.shape);
  } else {
    c.shape = null;
    const pin = grip && !whole ? pts[grip.index] ?? null : null;
    for (let it = 0; it < 3; it++) {
      for (const [a, b, rest] of c.bonds) {
        // The held point barely yields: the body hangs from it.
        const share = pin === a ? 0.9 : pin === b ? 0.1 : 0.5;
        constrain(world, a, b, rest, share, 0.9);
      }
    }
    capBonds(c.bonds, pin);
  }
  if (rig.soft) {
    // Gel deflates into a spreading puddle — once it lies still. Held, thrown
    // or frozen it keeps its round.
    const sb = rig.soft;
    let cx = 0, cy = 0;
    for (const p of sb.pts) { cx += p.x; cy += p.y; }
    cx /= sb.pts.length; cy /= sb.pts.length;
    if (!frozen) {
      // Lifted, the slump fills back out and the sack hangs: narrower, longer,
      // heavier below the middle.
      if (grip) c.slump = Math.max(0, c.slump - 3);
      const k = grip ? 0.12 : 0.05, sl = c.slump;
      const sx = grip ? 0.86 : 1 + Math.min(0.6, sl / 200), sy = grip ? 1.22 : Math.max(0.35, 1 - sl / 120);
      for (let i = 0; i < sb.pts.length; i++) {
        const p = sb.pts[i], ry0 = sb.rest[i * 2 + 1];
        const rx = sb.rest[i * 2] * sx * (grip && ry0 > 0 ? 1.08 : 1), ry = ry0 * sy + (grip && ry0 > 0 ? ry0 * 0.15 : 0);
        // Swept, not assigned: a shape pull must never press the ring into rock
        // (an embedded point moves freely, and the gel would sink through the floor).
        movePoint(world, p, p.x + (cx + rx - p.x) * k, p.y + (cy + ry - p.y) * k);
      }
    }
    sb.cx = cx; sb.cy = cy;
  }
  // Remains only ever work their way up or sideways out of rock, never
  // deeper: a point a hard cap or a twitch left inside terrain is lifted clear.
  for (const p of pts) unembed(world, p);
  if (frozen) { if (hip0) carryLegs(rig, hip0.x - hx, hip0.y - hy); }
  else stepLegs(world, rig, c.age);
  // Keep the gameplay anchor on the remains for culling and melting.
  const anchor = rig.pts[0] ?? rig.soft?.pts[0] ?? rig.chains[0]?.pts[0];
  if (anchor) { c.e.x = Math.round(anchor.x); c.e.y = Math.round(anchor.y + 4); }
}

/** A serpent's spine: the head drops (or floats), is held, or flies, and the spine follows. */
function stepChainCorpse(world: World, c: Corpse, frame: number): void {
  const e = c.e, body = e.body!;
  const head = body.nodes[0];
  const wet = liquidAt(world, e.x, e.y - 3);
  const vx = head.x - head.previousX, vy = head.y - head.previousY;
  if (c.frozen > 0) {
    // Frozen stiff: the whole spine moves as one plank, swept against the grid.
    const keep = 0.99;
    let dx = vx * keep, dy = vy * keep + (wet ? -0.1 : 0.4);
    const fits = (ox: number, oy: number): boolean => body.nodes.every(n => circleFree(world, n.x + ox, n.y + oy, Math.max(0, n.radius - 1)));
    if (!fits(dx, 0)) dx = 0;
    if (!fits(dx, dy)) { dy = 0; dx *= 0.94; }
    for (const n of body.nodes) { n.previousX = n.x; n.previousY = n.y; n.x += dx; n.y += dy; }
  } else {
    // The head is swept as its full circle: sliding on its momentum it used
    // to pass into a wall, pinning the spine behind it across the gap.
    // Limp, the head sinks at a steady half cell a tick (floats up in water);
    // held, the wand's pull steers it; flung, it carries its momentum.
    const grip = c.grip;
    let tx: number, ty: number;
    if (grip) { const pull = pullOf(grip, frame); tx = head.x + vx * 0.94 + pull.ax; ty = head.y + vy * 0.94 + pull.ay; }
    else if (c.flight > 0) { tx = head.x + vx * 0.985; ty = head.y + vy * 0.985 + (wet ? -0.15 : 0.22); }
    else { tx = head.x + vx * 0.9; ty = head.y + (wet ? -0.15 : 0.5); }
    const to = sweptNodeTarget(world, head, tx, ty);
    tickChain(world, body, to.x, to.y, wet, frame, e.kind === 'rillback' && wet);
  }
  e.x = Math.round(head.x); e.y = Math.round(head.y + 4);
}

function stepCorpse(ctx: Ctx, c: Corpse, index: number, pending: PendingBlow[]): void {
  const world = ctx.world, e = c.e, now = ctx.state.frameCount;
  // ROT: handled remains keep a while (bounded); fire, lava and acid hasten it.
  const kept = c.grip !== null || now - c.touchT < SPARE_WINDOW || c.frozen > 0;
  if (kept && c.spared < SPARE_MAX) c.spared++;
  else c.age++;
  c.glow = Math.max(0, 1 - c.age / 150);
  if (e.flash > 0) e.flash--; // the grip's brass flare fades
  if (c.hitCd > 0) c.hitCd--;
  if (c.bodyCd > 0) c.bodyCd--;
  if (c.headCd > 0) c.headCd--;
  if (c.flight > 0) c.flight--;
  if (c.frozen > 0) c.frozen--;
  if (!c.grip && c.flight <= 0 && c.frozen <= 0) c.slump++;
  // The cells it touches decide what happens to it (staggered census).
  const s = sampleBody(e, SAMPLE);
  if ((now + index) % CENSUS_EVERY === 0) {
    senseContact(world, e, CONTACT);
    c.age += stepElements(ctx, c, CONTACT, s);
  }
  if (c.twitch > 0) twitchStep(ctx, c, s);
  // Move.
  const frame = corpseFrame(e);
  const opts = c.frozen > 0 ? FROZEN : c.flight > 0 ? FLIGHT : LIMP;
  if (frame === 'weaver') stepWeaverCorpse(world, c, now);
  else if (frame === 'chain') stepChainCorpse(world, c, now);
  else if (e.rig) stepRigCorpse(world, c, e.rig, opts, now);
  // What the motion met.
  const a = sampleBody(e, AFTER);
  const speedBefore = Math.hypot(c.pvx, c.pvy);
  const inLiquid = liquidAt(world, a.x, a.y + a.r * 0.4);
  if (inLiquid && !c.wasWet && c.dryT > 8 && c.pvy >= SPLASH_MIN_VY) splashInto(ctx, c, a.x, a.y + a.r * 0.4, c.pvy);
  else if (!inLiquid || c.wasWet) {
    // The blow is the sharper of this tick's change and the last three ticks'
    // (a long rigid body meets a wall nose first, over a few ticks).
    const dv1 = Math.hypot(a.vx - c.pvx, a.vy - c.pvy - opts.gravity);
    const dv3 = Math.hypot(a.vx - c.h2vx, a.vy - c.h2vy - opts.gravity * 3) * 0.8;
    const fast = Math.max(speedBefore, Math.hypot(c.h2vx, c.h2vy));
    const dv = Math.max(dv1, dv3);
    if (fast >= THUD_MIN_SPEED && dv >= THUD_DV) {
      if (c.frozen > 0 && dv >= SHATTER_DV) shatterCorpse(ctx, c, a);
      else if (dv1 >= THUD_DV || c.flight > 0) { landingDust(ctx, c, a, dv); c.flight = 0; c.h2vx = c.hvx = a.vx; c.h2vy = c.hvy = a.vy; }
    }
  }
  c.dryT = inLiquid ? 0 : c.dryT + 1;
  c.wasWet = inLiquid;
  if (!c.gone) {
    strikeCreatures(ctx, c, a, now, pending);
    strikeBodies(ctx, c, a);
    strikePlayer(ctx, c, a);
  }
  const after = sampleBody(e, AFTER);
  c.h2vx = c.hvx; c.h2vy = c.hvy; c.hvx = c.pvx; c.hvy = c.pvy;
  c.pvx = after.vx; c.pvy = after.vy;
  // Flies find the dead within a few seconds (within sight of the wizard).
  if (!c.flies && c.age >= 150 && c.burn <= 0 && c.frozen <= 0) {
    c.flies = true;
    if (ctx.critters?.spawn && e.kind !== 'wisp' && e.kind !== 'imp' &&
        Math.abs(e.x - ctx.player.x) < 320 && Math.abs(e.y - ctx.player.y) < 200) {
      const flies = e.kind === 'leviathan' || e.kind === 'golem' ? 3 : 2;
      for (let f = 0; f < flies; f++) ctx.critters.spawn('fly', e.x + (f - 1) * 3, e.y - 6 - f * 2);
    }
  }
}

/** A queued blow lands (after the loop: a kill adds a corpse to the list). */
function deliverBlow(ctx: Ctx, b: PendingBlow): void {
  if (b.e.hp <= 0 || !ctx.enemies.includes(b.e)) return;
  ctx.enemyCtl.damage(b.e, b.dmg, b.kx, b.ky, b.bowled ? 'bowled' : 'flattened');
  // A heavy body landing is a beat: the world holds its breath a frame longer.
  if (b.bowled && b.dmg >= 36 && ctx.fx) ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 4);
}

export function updateCorpses(ctx: Ctx): void {
  const world = ctx.world;
  const pending: PendingBlow[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.world !== world || c.gone) { list.splice(i, 1); c.grip = null; continue; }
    stepCorpse(ctx, c, i, pending);
    if (c.gone) { list.splice(i, 1); c.grip = null; continue; }
    if (c.age >= c.ttl) { meltCorpse(ctx, c); list.splice(i, 1); c.grip = null; }
  }
  for (const b of pending) deliverBlow(ctx, b);
}

// ---------------------------------------------------------------- the world's pushes
/**
 * A blast: every part of every body in reach is flung away from it by
 * distance (a rig turns over; limbs fly out). A frozen body close to a strong
 * blast shatters. `byPlayer` (his own wand's blast) makes what the bodies hit his.
 */
export function blastCorpses(ctx: Ctx, cx: number, cy: number, reach: number, strength: number, byPlayer: boolean): void {
  if (reach <= 0) return;
  const now = ctx.state.frameCount;
  for (const c of list) {
    if (c.world !== ctx.world || c.gone) continue;
    const s = sampleBody(c.e, SAMPLE);
    const d = Math.max(0, Math.hypot(s.x - cx, s.y - cy) - s.r * 0.5);
    if (d > reach) continue;
    const falloff = 1 - d / reach;
    if (c.frozen > 0 && falloff > 0.45 && strength * falloff > 1.4) { shatterCorpse(ctx, c, s); continue; }
    const k = strength / Math.sqrt(c.mass);
    if (c.grip) c.grip = null; // the blast tears it out of the wand's hold
    pushField(c.e, cx, cy, (dx, dy, dd) => {
      if (dd > reach) return null;
      const f = (1 - dd / reach) * k, n = dd || 1;
      return [(dx / n) * f, (dy / n) * f - f * 0.35];
    });
    c.flight = FLIGHT_TICKS;
    if (byPlayer) touchCorpse(c, now);
    else c.struck.length = 0;
    resyncVelocity(c);
  }
}

/**
 * The boot (F): a body in the melee cone is punted — light remains fly, heavy
 * ones fold and skid — and even one held in the wand's grip is kicked out of
 * it. Bodies in the wider gust cone are shoved. Returns the kick's reaction
 * (0..1): punting a heavy body pushes the alchemist back like a wall.
 */
export function kickCorpses(ctx: Ctx, ox: number, oy: number, dirX: number, dirY: number, reach: number, cosArc: number, gustAt: GustFalloff): number {
  const now = ctx.state.frameCount;
  let reaction = 0;
  // A body is a big, low target: the boot takes anything in a wider cone than
  // the creature kick, and anything lying at the feet on the kicking side.
  const wide = Math.min(cosArc, BODY_KICK_COS);
  const side = dirX < 0 ? -1 : 1;
  for (const c of list) {
    if (c.world !== ctx.world || c.gone) continue;
    let near = Infinity;
    forEachBodyPoint(c.e, (x, y, r) => {
      const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy) || 1;
      if (d - r > reach) return;
      const inCone = (dx / d) * dirX + (dy / d) * dirY >= wide;
      const atFeet = dy > 0 && dx * side >= -3;
      if (!inCone && !atFeet && d > r + 3) return;
      near = Math.min(near, d);
    });
    const s = sampleBody(c.e, SAMPLE);
    if (near < Infinity) {
      const sp = KICK_SPEED / Math.sqrt(c.mass);
      c.grip = null;
      pushField(c.e, ox, oy, (_dx, _dy, dd) => {
        const f = sp * (0.75 + 0.5 * Math.max(0, 1 - dd / (reach + 6)));
        return [dirX * f, dirY * f - sp * 0.35];
      });
      c.flight = FLIGHT_TICKS;
      touchCorpse(c, now);
      reaction = Math.max(reaction, Math.min(1, c.mass / 3));
      corpseMoment(ctx, c, 'thud', s.x, s.y, Math.min(1, 0.35 + c.mass * 0.1));
      resyncVelocity(c);
      continue;
    }
    const g = gustAt(s.x, s.y);
    if (g > 0) {
      const sp = (GUST_SPEED * g) / Math.sqrt(c.mass);
      pushBody(c.e, dirX * sp, dirY * sp - g * 0.3);
      c.flight = Math.max(c.flight, 30);
      touchCorpse(c, now);
      resyncVelocity(c);
    }
  }
  return reaction;
}

/**
 * Weight resting in a box (a pressure plate's rows): every body with a part
 * inside counts round(mass × 4) — a slime presses a plate like a creature
 * standing on it (4); a bat's carcass (2) is too light. A body the wand is
 * holding up weighs nothing.
 */
export function corpseWeightOn(world: World, x0: number, y0: number, x1: number, y1: number): number {
  let weight = 0;
  for (const c of list) {
    if (c.world !== world || c.gone || c.grip) continue;
    let inside = false;
    forEachBodyPoint(c.e, (x, y, r) => {
      if (!inside && x >= x0 && x <= x1 && y + r >= y0 && y - r <= y1) inside = true;
    });
    if (inside) weight += Math.round(c.mass * 4);
  }
  return weight;
}

/** The remains as the Ctx sees them (the sim's blasts, the boot, the plates). */
export function createCorpsesApi(ctx: Ctx): CorpsesApi {
  return {
    get list() { return list; },
    blast: (cx, cy, reach, strength, byPlayer) => blastCorpses(ctx, cx, cy, reach, strength, byPlayer),
    kick: (ox, oy, dirX, dirY, reach, cosArc, gustAt) => kickCorpses(ctx, ox, oy, dirX, dirY, reach, cosArc, gustAt),
    weightOn: (x0, y0, x1, y1) => corpseWeightOn(ctx.world, x0, y0, x1, y1),
  };
}
