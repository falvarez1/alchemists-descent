import type { Ctx } from '@/core/types';

/**
 * Edda Morrow's rules as pure maths (docs/fighters/edda-morrow.md): what counts as "a use" of a
 * consumable for Stored Light, who Mercy Shard can be sent to and where the shard is on its flight and in
 * its orbit, and what the Rose Window does to a shot that enters it (turns it, never eats it). No engine
 * imports beyond a type, so tests/fighters-edda.test.ts holds every number without a browser; the kit
 * (edda-morrow.ts) wires them to the world and edda-morrow-glass.ts draws them.
 *
 * All times are fixed ticks (60 Hz); angles are radians in the world's y-down frame.
 */

/** Every number the kit uses (docs/FIGHTERS.md "07 Edda Morrow"); first-pass tuning, the probe decides the final values. */
export const TUNING = {
  stored: {
    /** The armor pool's ceiling; it starts empty. */
    armorMax: 30,
    /** The overshield one consumable grants. */
    perUse: 12,
    /** Sips of the flask this close together (ticks) are one drink, not many. */
    sessionGap: 30,
    /** After a flask's grant the glass is slow to take the light again: no second flask grant inside this many ticks. */
    flaskCooldown: 180,
  },
  shard: {
    cooldown: 720,
    duration: 360,
    /** x incoming damage while it holds. */
    damageTaken: 0.6,
    /** The out-and-back flight, ticks, and how far it strays from her (cells). */
    flightTicks: 30,
    excursion: 22,
    /** The orbit it settles into: an ellipse (cells) around the one it protects, and its turning speed (radians a tick). */
    orbitRx: 9,
    orbitRy: 5.5,
    orbitOmega: 0.075,
    /** It blinks for this long before it goes, and dissolves over the very last of it. */
    warnTicks: 70,
    fadeTicks: 24,
    /** An ally farther than this is not a candidate (the arena mode). */
    range: 220,
    /** The cone about the aim in which a peer counts as the one she meant. */
    aimCone: (50 * Math.PI) / 180,
  },
  window: {
    duration: 600,
    /** Within this many cells of the prism: she is healed and a hostile shot is turned. */
    radius: 60,
    healPerSecond: 4,
    /** The drawn window's radius (cells) and how long it takes to unfold. */
    glassR: 16,
    riseTicks: 22,
    /** It dims over its last `dimTicks`, cracks over its last `crackTicks`, then the pieces fall for `breakTicks`. */
    dimTicks: 90,
    crackTicks: 36,
    breakTicks: 48,
    /** A pulse of healing light leaves it every `pulseEvery` ticks and takes `pulseTicks` to cross the radius. */
    pulseEvery: 90,
    pulseTicks: 62,
    /** A shot whose heading is at least this far outward (cosine of the angle to the outward normal) is already leaving: left alone. */
    leaving: 0.15,
    /** A turned shot leaves between `minScatter` and `maxTurn` off the outward normal. */
    minScatter: (16 * Math.PI) / 180,
    maxTurn: (62 * Math.PI) / 180,
    /** The prism's own light (authored): its strength at full glow. */
    lightIntensity: 0.95,
    lightRadius: 100,
    /** How far below her a floor is still found when she is airborne. */
    maxDrop: 40,
  },
} as const;

// ------------------------------------------------------------------------------------ Stored Light

/**
 * What counts as "a use". Drinking from the flask emits one event a tick for as long as X is held, so the
 * kit takes a *session* of sips (none more than `sessionGap` ticks apart) as one use; a potion lifted off the
 * floor is one use. A flask grant also rests the glass for `flaskCooldown` ticks, so a pool of water and a
 * tapped X cannot be turned into a fountain of armor.
 */
export class StoredLight {
  private lastSip = -1e9;
  private lastGrant = -1e9;

  /** A sip of the flask at tick `now`. True when it opens a new drink and the glass is ready to take the light. */
  sip(now: number): boolean {
    const t = TUNING.stored;
    const opens = now - this.lastSip > t.sessionGap;
    this.lastSip = now;
    return opens && now - this.lastGrant >= t.flaskCooldown;
  }

  /** The kit granted the light for the sip above: the glass rests. */
  spent(now: number): void {
    this.lastGrant = now;
  }

  reset(): void {
    this.lastSip = -1e9;
    this.lastGrant = -1e9;
  }
}

/** How much of `perUse` fits under the ceiling (never negative, never NaN). */
export function overshieldGain(armor: number, max: number, perUse: number): number {
  const room = max - (Number.isFinite(armor) ? armor : 0);
  return room > 0 ? Math.min(perUse, room) : 0;
}

// ------------------------------------------------------------------------------------ allies

/**
 * A friendly body the shard can be sent to. Solo that is only the fighter herself; the arena mode adds a
 * peer by appending to what `allyTargets` returns (and a `grant` that applies the damage reduction to that
 * peer's own fighter, since the kit can only reach its own system's modifiers).
 */
export interface AllyBody {
  id: string;
  /** The fighter herself. */
  self: boolean;
  /** Chest height, world cells. */
  x: number;
  y: number;
  /** Apply `damageTaken` (x incoming damage) to this body for `ticks`. Absent for the fighter: the kit holds its own. */
  grant?: (ticks: number, damageTaken: number) => void;
}

/** Every friendly body, the fighter first. Solo there are no others; the arena mode appends its peers here. */
export function allyTargets(ctx: Ctx): AllyBody[] {
  const p = ctx.player;
  return [{ id: 'self', self: true, x: p.x, y: p.y - (p.crawling ? 4 : 9) }];
}

/**
 * Who a Mercy Shard goes to: the peer nearest the aim line (within `range` and the aim cone) if there is
 * one, otherwise the fighter herself. Pure, so the arena mode's choice can be tested before it exists.
 */
export function chooseAlly(allies: readonly AllyBody[], fromX: number, fromY: number, aimAngle: number): AllyBody | null {
  const S = TUNING.shard;
  let self: AllyBody | null = null;
  let best: AllyBody | null = null;
  let bestOff = Infinity;
  for (const a of allies) {
    if (a.self) { self ??= a; continue; }
    const dx = a.x - fromX, dy = a.y - fromY;
    const d = Math.hypot(dx, dy);
    if (d > S.range || !Number.isFinite(d)) continue;
    let off = Math.atan2(dy, dx) - aimAngle;
    off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
    if (d > 1 && off > S.aimCone) continue;
    if (off < bestOff) { best = a; bestOff = off; }
  }
  return best ?? self;
}

// ------------------------------------------------------------------------------------ the shard in flight and in orbit

export interface ShardPose {
  x: number;
  y: number;
  /** How the shard is turned (radians; 0 = standing point-up). */
  rot: number;
  /** 0 just sent .. 1 settled in its orbit. */
  settle: number;
}

export const newShardPose = (): ShardPose => ({ x: 0, y: 0, rot: 0, settle: 0 });

const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const easeOut = (u: number): number => 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;

/**
 * Where the shard is `age` ticks after it was sent, written into `out`. It starts on the aim side of the
 * caster's chest, tumbling, and is sent out along the aim and curled back (solo: she is the ally, so it
 * returns to her) or carried across to the ally (a peer), spinning down as it arrives, and from then on
 * rides an ellipse around the ally's live chest, bobbing. `(fx, fy)` is the caster's chest, `(tx, ty)` the
 * ally's (the same point when the ally is the caster).
 */
export function shardPose(age: number, fx: number, fy: number, tx: number, ty: number, selfTarget: boolean, aim: number, out: ShardPose = newShardPose()): ShardPose {
  const S = TUNING.shard;
  const u = Math.min(1, Math.max(0, age / S.flightTicks));
  const theta = aim + S.orbitOmega * age;
  const e = easeOut(u);
  // The orbit: an ellipse about the ally, a little breathing in and out so it is never a rail.
  const breathe = 1 + 0.06 * Math.sin(age * 0.09);
  let ox = Math.cos(theta) * S.orbitRx * breathe;
  let oy = Math.sin(theta) * S.orbitRy * breathe + Math.sin(age * 0.11) * 0.8;
  let bx = tx, by = ty;
  if (selfTarget) {
    // Sent out along the aim, curling back: a bell of travel that is zero at both ends, with a sidelong swing.
    const bell = Math.sin(Math.PI * u);
    const ax = Math.cos(aim), ay = Math.sin(aim);
    ox += ax * S.excursion * bell + -ay * 6 * bell * (1 - u);
    oy += ay * S.excursion * bell + ax * 6 * bell * (1 - u);
  } else {
    // Carried across to the ally: from the caster's chest, easing onto theirs; the orbit opens as it lands.
    bx = fx + (tx - fx) * e;
    by = fy + (ty - fy) * e;
    ox *= 0.3 + 0.7 * e;
    oy *= 0.3 + 0.7 * e;
  }
  out.x = bx + ox;
  out.y = by + oy;
  out.rot = Math.sin(theta) * 0.45 + (1 - u) * (1 - u) * 12;
  out.settle = smooth(u);
  return out;
}

// ------------------------------------------------------------------------------------ the Rose Window

/**
 * How the window looks `age` ticks after it was raised of `duration`: how far it has unfolded, how bright the
 * glass is (it dims toward the end and flickers as it does), how cracked it is, and the spin of the tracery
 * as it opens. `flickerPhase` is any steadily rising number (the frame); `calm` holds the flicker still.
 */
export interface WindowLook {
  scale: number;
  spin: number;
  glow: number;
  crack: number;
}

export function windowLook(age: number, duration: number, flickerPhase: number, calm: boolean, out: WindowLook = { scale: 0, spin: 0, glow: 1, crack: 0 }): WindowLook {
  const W = TUNING.window;
  const remaining = Math.max(0, duration - age);
  const rise = Math.min(1, Math.max(0, age / W.riseTicks));
  // An overshoot at the end of the unfolding (a window that swings open, then settles).
  out.scale = rise >= 1 ? 1 : easeOut(rise) * (1 + 0.1 * Math.sin(rise * Math.PI));
  out.spin = (1 - rise) * (1 - rise) * 1.8;
  let glow = 1;
  if (remaining < W.dimTicks) {
    const k = remaining / W.dimTicks;
    glow = 0.3 + 0.7 * k;
    if (!calm) glow *= 0.82 + 0.18 * Math.sin(flickerPhase * (0.5 + (1 - k) * 0.9));
  }
  out.glow = glow;
  out.crack = remaining < W.crackTicks ? 1 - remaining / W.crackTicks : 0;
  return out;
}

/** Is (x, y) within `r` of (cx, cy)? */
export function within(x: number, y: number, cx: number, cy: number, r: number): boolean {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** One tick of healing: `hp` raised by the rate, never past `maxHp`, and never lowered (a bad number changes nothing). */
export function healed(hp: number, maxHp: number, perSecond: number): number {
  if (!(hp < maxHp) || !(perSecond > 0)) return hp;
  return Math.min(maxHp, hp + perSecond / 60);
}

export interface Refraction {
  vx: number;
  vy: number;
  /** How far the heading turned (radians, > 0). */
  turned: number;
}

/**
 * The prism turns a shot that is flying INTO it away from its centre, without slowing it or ending it.
 * `(rx, ry)` is the unit vector from the centre to the shot. A shot already leaving (heading within
 * `acos(leaving)` of outward) is left alone, so calling this every sub-step of a shot that is inside the
 * radius turns it exactly once. The shot leaves `minScatter`..`maxTurn` off the outward normal, on the side
 * it was already leaning to (a mirror about the normal, bounded so a grazing shot is bent out rather than
 * left to skim the glass, and a dead-on one is scattered rather than sent straight back); `tie` (+-1) picks
 * the side when it was dead-on. Speed is preserved exactly. Writes `out` and returns true when it turned.
 */
export function refract(vx: number, vy: number, rx: number, ry: number, tie: number, out: Refraction): boolean {
  const speed = Math.hypot(vx, vy);
  if (!(speed > 1e-9)) return false;
  const W = TUNING.window;
  const along = (vx * rx + vy * ry) / speed;
  if (along >= W.leaving) return false;
  const cross = rx * vy - ry * vx; // speed * sin(angle from the outward normal)
  const phi = Math.atan2(cross, along * speed);
  const side = cross > 1e-9 ? 1 : cross < -1e-9 ? -1 : tie >= 0 ? 1 : -1;
  const turnedAbs = Math.min(W.maxTurn, Math.max(W.minScatter, Math.PI - Math.abs(phi)));
  const ang = side * turnedAbs;
  const c = Math.cos(ang), s = Math.sin(ang);
  out.vx = (rx * c - ry * s) * speed;
  out.vy = (rx * s + ry * c) * speed;
  out.turned = Math.abs(Math.atan2(vx * out.vy - vy * out.vx, vx * out.vx + vy * out.vy));
  return true;
}

/**
 * Where a fallen pane of the shattered window has got to `t` ticks after the break: a sector flies out
 * along its own bearing and falls. `sector` 0..7 is a pane of the rose, 8 the hub.
 */
export function fragmentOffset(sector: number, t: number, out: { x: number; y: number }): void {
  const mid = -Math.PI + (sector + 0.5) * (Math.PI / 4);
  const speed = sector === 8 ? 0.15 : 0.55 + 0.12 * ((sector * 5) % 4);
  out.x = Math.cos(mid) * speed * t;
  out.y = Math.sin(mid) * speed * t - 0.5 * t + 0.5 * 0.045 * t * t;
}
