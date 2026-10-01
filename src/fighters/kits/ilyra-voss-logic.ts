/**
 * Ilyra Voss, the Cinder Alchemist (docs/FIGHTERS.md "01", docs/fighters/ilyra-voss.md): the parts of her
 * kit that are pure arithmetic and so can be tested without a browser. The kit module (`ilyra-voss.ts`)
 * wires them to the engine; nothing here imports a system.
 *
 *  - TUNING: every number of the kit, in one object (ticks at 60 Hz, cells, cells/tick).
 *  - Mixture: Volatile Mixture's state machine (two different weapons inside 4 s prime a Scorch).
 *  - channelOf: what counts as a "weapon" (a damage channel) for that machine.
 *  - Vial: the Flash Crucible's flight (Flask.ts's bottle kinematics), stepped against a probe.
 *  - blastKnock / selfShove: the burst's outward push on a foe and on the fighter.
 *  - trailSpan: the Phoenix Draft's fire-trail geometry.
 *  - ticksToReady: how a cooldown that is decremented k times per tick runs down.
 */

export const TUNING = {
  // ---- Volatile Mixture ----
  /** Two different weapons within this many ticks (4 s) prime the next hit. */
  mixtureWindow: 240,
  /** A primed mixture waits this long (5 s) for its next hit, then goes cold. */
  primeTicks: 300,
  /** Blows lighter than this (a burning tick, a flame-jet lick) are not "hits" for the passive. */
  minHit: 0.5,
  /** A spell hit is credited to the last card cast, if it was cast within this many ticks (10 s). */
  cardMemory: 600,
  /** A thrown or poured flask keeps the world's harm "its" for this many ticks (5 s). */
  flaskWindow: 300,
  /** Scorch: the flare's damage, and the burning status it sets (at least this many ticks). */
  scorchFlare: 6,
  scorchBurn: 120,

  // ---- Flash Crucible (Z) ----
  tacticalCooldown: 540,
  vialSpeed: 6.5,
  vialGravity: 0.18,
  vialFuse: 40,
  burstRadius: 30,
  burstDamage: 14,
  /** The outward shove a foe gets at the centre of the blast (falls to ~55% at the rim). */
  burstKnock: 3.4,
  /** Within this many cells of the burst the fighter is shoved outward too. */
  selfShoveRadius: 22,
  selfShove: 2.2,
  /** ...and lifted this much (the first tick's upward speed). The controller's friction eats a raw impulse in 3 ticks, so the shove is a short body-owning glide (below). */
  selfShoveLift: 1.7,
  shoveTicks: 10,
  shoveGravity: 0.28,
  /** Share of the shove's speed she keeps when the glide ends. */
  shoveExit: 0.3,
  /** Real cells the burst scatters (never within `safeRadius` of the fighter, never into rock). */
  scatterFire: 8,
  scatterEmber: 3,
  scatterRadius: 9,
  safeRadius: 13,

  // ---- Phoenix Draft (T) ----
  phoenixTicks: 480,
  phoenixMove: 1.25,
  /** Wand cast / recharge delay is halved: its counter runs down this many times per tick. */
  phoenixReloadRate: 2,
  /** She drops a flame behind her every this many ticks while moving faster than the trail speed. */
  trailEvery: 3,
  trailSpeed: 1.5,
  trailLifeMin: 34,
  trailLifeSpread: 18,
  /** Cells behind her feet the trail is laid, and the longest stretch one drop covers. */
  trailBehind: 4,
  trailMaxSpan: 9,
  /** One drop in this many leaves a real Ember too (embers glow on until quenched: kept few). */
  trailEmberEvery: 4,
  trailEmberBudget: 14,
};

export type Tuning = typeof TUNING;

// ======================================================================== channels (what a "weapon" is)

/** The damage sources a thrown or poured flask causes once it has landed (lava, acid, toxic sludge, steam, a powder blast). */
const FLASK_CAUSES: ReadonlySet<string> = new Set(['rendered', 'dissolved', 'poisoned', 'steeped', 'detonated']);

export interface BlowFacts {
  /** The `EnemyDamageSource` of the blow ('direct', 'burned', 'bowled', ...). */
  source: string;
  /** A kick, a limb swing or a ram landed this tick or the last (`FighterSystem.recentMelee`). */
  melee: boolean;
  /** The last spell card the wand cast (the `cardCast` event), or null. */
  card: string | null;
  /** Ticks since that cast. */
  cardAge: number;
  /** A flask was thrown or poured within `flaskWindow`. */
  flaskOpen: boolean;
}

/**
 * Which weapon dealt a blow, as a stable string; null when it was not one of hers (a fire that was
 * already burning, a blast she did not cast, a fall). A spell card is its own weapon (`spell:spark`,
 * `spell:frostshard`), so the same card twice is one weapon and two cards are two.
 */
export function channelOf(f: BlowFacts): string | null {
  if (f.melee) return 'melee';
  if (f.source === 'direct') return f.card !== null && f.cardAge >= 0 && f.cardAge <= TUNING.cardMemory ? `spell:${f.card}` : 'body';
  if (f.source === 'bowled') return 'bowled';
  if (f.flaskOpen && FLASK_CAUSES.has(f.source)) return 'flask';
  return null;
}

// ======================================================================== Volatile Mixture

/**
 * Two different weapons inside `mixtureWindow` ticks PRIME her; the next hit lands Scorch and spends the
 * prime (and forgets the weapons, so it takes a fresh pair to prime again). A primed mixture that is not
 * spent goes cold after `primeTicks`. Times are the game's frame counter; a stamp from the future (a
 * counter that restarted) is stale, never "recent".
 */
export class Mixture {
  /** channel -> frame of its latest hit. */
  private readonly last = new Map<string, number>();
  private primedUntil = -1;
  /** The frame the prime was struck: the rest of that same blow (a bolt's impact and its blast) is not "the next hit". */
  private primedAt = -1;

  /** Primed and still warm at `now`. */
  primed(now: number): boolean {
    return now < this.primedUntil && this.primedUntil - now <= TUNING.primeTicks;
  }

  /** Primed, and past the blow that primed her: the next hit may be spent on a Scorch. */
  ready(now: number): boolean {
    return this.primed(now) && now > this.primedAt;
  }

  /** Ticks the prime has left (0 when not primed). */
  primedLeft(now: number): number {
    return this.primed(now) ? this.primedUntil - now : 0;
  }

  /** Ticks until the open pair window closes, or 0 when no first weapon is waiting for a second. */
  windowLeft(now: number): number {
    let best = 0;
    for (const at of this.last.values()) {
      const left = at + TUNING.mixtureWindow - now;
      if (at <= now && left > best) best = left;
    }
    return best;
  }

  /**
   * A hit by `channel` landed at `now`. Returns true when this hit completed a pair and primed her. (A hit
   * while already primed is the one that SPENDS the prime: the caller asks `primed` first, applies Scorch,
   * and calls `spend`.)
   */
  note(channel: string, now: number): boolean {
    if (this.primed(now)) return false;
    let pair = false;
    for (const [c, at] of this.last) {
      const age = now - at;
      if (age < 0 || age > TUNING.mixtureWindow) { this.last.delete(c); continue; }
      if (c !== channel) pair = true;
    }
    this.last.set(channel, now);
    if (pair) {
      this.primedUntil = now + TUNING.primeTicks;
      this.primedAt = now;
      return true;
    }
    return false;
  }

  /** The prime was spent on a Scorch: cold, and the weapons are forgotten. */
  spend(): void {
    this.primedUntil = -1;
    this.primedAt = -1;
    this.last.clear();
  }

  /** Forget everything (a respawn, a new floor). */
  clear(): void {
    this.primedUntil = -1;
    this.primedAt = -1;
    this.last.clear();
  }

  /** Restore a prime from a save: `left` ticks of warmth from `now`. */
  restore(left: number, now: number): void {
    this.last.clear();
    this.primedUntil = left > 0 ? now + Math.min(left, TUNING.primeTicks) : -1;
    this.primedAt = -1;
  }
}

// ======================================================================== the vial

export interface Vial {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export type VialEnd = { x: number; y: number; reason: 'solid' | 'foe' | 'fuse' | 'bounds' };

/** What the vial flies through: the grid and the foes. */
export interface VialProbe {
  inBounds(x: number, y: number): boolean;
  /** A cell the vial cannot pass (rock, a powder, a liquid's surface). */
  solid(x: number, y: number): boolean;
  /** A foe's body at this cell. */
  foe(x: number, y: number): boolean;
}

export function launchVial(x: number, y: number, angle: number): Vial {
  return { x, y, vx: Math.cos(angle) * TUNING.vialSpeed, vy: Math.sin(angle) * TUNING.vialSpeed, age: 0 };
}

/**
 * One tick of flight, the way `Flask.ts` flies its bottle: gravity, then the move in sub-steps of at most a
 * cell so a fast vial cannot tunnel a thin wall. Returns where it burst, or null while it is still flying.
 * It bursts at the cell BEFORE the first solid (so the flash starts in open air), on a foe's body, or when
 * the fuse runs out.
 */
export function stepVial(v: Vial, probe: VialProbe): VialEnd | null {
  v.age++;
  v.vy += TUNING.vialGravity;
  const steps = Math.max(1, Math.ceil(Math.hypot(v.vx, v.vy)));
  for (let s = 0; s < steps; s++) {
    const px = v.x, py = v.y;
    v.x += v.vx / steps;
    v.y += v.vy / steps;
    const gx = Math.floor(v.x), gy = Math.floor(v.y);
    if (!probe.inBounds(gx, gy)) return { x: Math.floor(px), y: Math.floor(py), reason: 'bounds' };
    if (probe.solid(gx, gy)) return { x: Math.floor(px), y: Math.floor(py), reason: 'solid' };
    if (probe.foe(gx, gy)) return { x: gx, y: gy, reason: 'foe' };
  }
  if (v.age >= TUNING.vialFuse) return { x: Math.floor(v.x), y: Math.floor(v.y), reason: 'fuse' };
  return null;
}

// ======================================================================== the burst

/**
 * The outward shove a foe at distance `d` from the burst gets: full `burstKnock` at the centre, 55% at the
 * rim, along (dx, dy) normalised, with a lift so it leaves the floor. `fallbackX` is the direction used when
 * the foe is on the burst's centre.
 */
export function blastKnock(dx: number, dy: number, d: number, fallbackX: number): { kx: number; ky: number } {
  const R = TUNING.burstRadius;
  const k = TUNING.burstKnock * (1 - 0.45 * Math.min(1, d / R));
  const len = Math.hypot(dx, dy);
  const nx = len > 0.01 ? dx / len : fallbackX >= 0 ? 1 : -1;
  const ny = len > 0.01 ? dy / len : 0;
  return { kx: nx * k, ky: ny * k * 0.5 - 1.1 };
}

/**
 * The shove the burst gives HER: `selfShove` along the line from the burst to her body, inside
 * `selfShoveRadius`; null when she is clear of it. `aimX/aimY` is the direction it falls back to when she is
 * standing on the burst's centre (away from where she threw).
 */
export function selfShove(dx: number, dy: number, aimX: number, aimY: number): { vx: number; vy: number } | null {
  const d = Math.hypot(dx, dy);
  if (d > TUNING.selfShoveRadius) return null;
  const nx = d > 0.01 ? dx / d : -aimX;
  const ny = d > 0.01 ? dy / d : -aimY;
  return { vx: nx * TUNING.selfShove, vy: ny * TUNING.selfShove * 0.8 - TUNING.selfShoveLift };
}

/**
 * One tick of the glide that carries her clear of a burst: the shove's speed bleeds off linearly over
 * `shoveTicks`, and the lift arcs like a throw (gravity `shoveGravity`), so she is blown back and over, not
 * ground along the floor. (`t` counts from 0.)
 */
export function glideStep(vx: number, vy: number, t: number): { dx: number; dy: number } {
  return { dx: vx * Math.max(0, 1 - t / TUNING.shoveTicks), dy: vy + TUNING.shoveGravity * t };
}

// ======================================================================== the trail

/**
 * The columns one trail drop lights: every cell from where the last drop ended to `trailBehind` cells behind
 * her (`dir` is the direction she is moving, +1 or -1), at most `trailMaxSpan` of them, nearest her first.
 * `lastX` is where the last drop ended (null for the first drop).
 */
export function trailSpan(lastX: number | null, x: number, dir: number): number[] {
  const end = Math.round(x - dir * TUNING.trailBehind);
  const start = lastX === null || Math.abs(lastX - end) > TUNING.trailMaxSpan * 2 ? end : lastX;
  const out: number[] = [];
  const step = end >= start ? 1 : -1;
  // Walk from the old end toward the new one: that is the ground she covered since the last drop.
  for (let cx = start, n = 0; n < TUNING.trailMaxSpan; cx += step, n++) {
    out.push(cx);
    if (cx === end) break;
  }
  return out;
}

/** Her speed is high enough to leave a trail. */
export function trailing(vx: number, vy: number): boolean {
  return Math.hypot(vx, vy) > TUNING.trailSpeed;
}

// ======================================================================== the reload

/**
 * Ticks until a cooldown of `cooldown` is spent when it runs down `perTick` times each tick (1 = the
 * wand's own clock; Phoenix Draft adds one more, so 2): the cast rate of a held wand is its reciprocal.
 */
export function ticksToReady(cooldown: number, perTick: number): number {
  return cooldown <= 0 ? 0 : Math.ceil(cooldown / Math.max(1, perTick));
}
