import type { StockAttackKind, StockAttackSpec } from '@/core/stockAttacks';
import type { StockMoveset } from '@/config/stockAttacks';
import type { Personality } from '@/config/aiPersonalities';
import type { Rng } from '@/core/rng';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { stockAttackOverlaps } from '@/arena/StockAttack';

/**
 * STOCK TACTICS (docs/arena/AI-STOCK-TACTICS.md): the computer fighter's close game in a stock match. It answers one
 * question every tick: given what the bot SAW of its opponent (`reaction` ticks ago, with the swing it could see), where
 * should it stand, and should it strike, grab, shield, dodge or hop right now?
 *
 * The rules a person would follow, and the old bot did not:
 *  - It stands on ITS side of the opponent. Fighters pass through each other, so a goal "ten cells short of where the
 *    foe was" walked straight through it; every goal here is `foe - toward * spacing` with a sticky `toward`.
 *  - It holds a spacing band just outside the opponent's reach (closer for an aggressive profile), drifts in and out
 *    of it, and only enters with a reason: a committed approach, a whiff to punish, a shield to grab, a hit to follow.
 *  - It answers a swing it can see (shield, dodge or step out) once per swing, at a skill-scaled rate, and punishes a
 *    recovery it can reach in time. A four-tick jab is never "reacted to": it is older than the bot's picture of it.
 *  - A jump is a decision (an aerial approach, a juggle, an escape from a corner), never a hop over the opponent.
 *
 * Pure: everything it reads is in `StockTacticsView`, everything it wants is in the returned `StockOrder`, and its only
 * randomness is the brain's seeded Rng. `BasicBrain` turns the order into the same inputs a person presses.
 */

export type StockMode = 'neutral' | 'approach' | 'punish' | 'defend' | 'pressure' | 'edgeguard' | 'escape';
export type StockStrike = StockAttackKind | 'grab';

/** Grab contact (ArenaSlots.resolveStockGrabs): 3..22 cells in front, within 12 rows, after 6 ticks of startup. */
export const STOCK_GRAB = { min: 3, max: 22, dy: 12, startup: 6 } as const;
/** The speed an approach is timed with (a body's top walk is about 3 cells a tick). */
const WALK = 3;
/** Ticks a short hop is held (a tap: the jump, not the jet). */
const HOP_HOLD = 3;
/** Any visible swing is assumed to stop the attacker in place: grounded attacks lock the keys. */
const LEAD_CAP = 30;

/** Per difficulty level (1..5): how often a seen swing is answered, a seen recovery punished, an approach started. */
export const STOCK_SKILL = {
  defend: [0.2, 0.35, 0.55, 0.72, 0.88],
  punish: [0.25, 0.4, 0.6, 0.8, 0.95],
  approach: [0.55, 0.7, 0.85, 0.95, 1],
  /** Cells of slack a strike accepts at the far edge of a move (a careless hand swings from too far). */
  slop: [7, 5, 3, 2, 1],
} as const;

/** The opponent as the bot perceives it. Position, motion and the swing are one delayed snapshot; percent is the HUD. */
export interface StockFoeRead {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks old. */
  age: number;
  grounded: boolean;
  /** The swing the snapshot showed: its spec, facing, and how many ticks into it the snapshot was. */
  attack: { kind: StockAttackKind; spec: StockAttackSpec; facing: number; age: number } | null;
  shielding: boolean;
  dodging: boolean;
  /** In hitstun (a launch or a flinch). */
  stunned: boolean;
  onLedge: boolean;
  /** Reaching for a grab (startup or active). */
  grabbing: boolean;
  percent: number;
  moves: StockMoveset;
}

/** The bot's own body: known exactly and now (the HUD and the hands). */
export interface StockSelfRead {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: number;
  percent: number;
  /** Not stunned, not locked, not mid-commitment: a press would be accepted. */
  canAct: boolean;
  shieldStrength: number;
  shielding: boolean;
  dodgeReady: boolean;
  /** Holding the opponent and allowed to throw now. */
  canThrow: boolean;
  moves: StockMoveset;
}

export interface StockTacticsView {
  tick: number;
  me: StockSelfRead;
  foe: StockFoeRead;
  /** The surface the bot walks on, already inset to where its feet may safely go. */
  deck: { x0: number; x1: number; y: number };
  /** The main platform's lips and its feet row: beyond them the opponent is offstage. */
  stage: { x0: number; x1: number; y: number };
  personality: Personality;
  skill: { level: number; prediction: number; spacing: number };
  /** Ticks until a seen projectile reaches the bot, or null. */
  shotIn: number | null;
  /** Harmful cells (fire, embers, lava, acid) a body standing at x on the bot's surface would touch: 0 is clean ground. */
  heat?: (x: number) => number;
  /** Learned outcome bias for a strike in the current context, and whether it may be tried (not twice failed, not pending). */
  learned?: (strike: StockStrike) => number;
  ready?: (strike: StockStrike) => boolean;
  rng: Rng;
  /** A decision beat (Execution's cadence): strategic choices are made only on one, or on an urgent read. */
  decide: boolean;
}

export interface StockOrder {
  mode: StockMode;
  /** Walk here (null: stand). */
  goalX: number | null;
  tol: number;
  /** Strike now, facing `facing`. */
  strike: StockStrike | null;
  facing: number;
  shield: boolean;
  /** Dodge now: -1/+1 a roll that way, 0 in place. */
  dodge: number | null;
  /** Hold jump this tick. */
  jump: boolean;
  /** The throw direction while holding the opponent. */
  throwDir: 'left' | 'right' | 'up' | 'down' | null;
  /** Hold this horizontal direction (survival influence on a launch the bot could not stop), 0 none. */
  influence: number;
  why: string;
}

/** The farthest in front a move hits (feet to feet). */
export function forwardReach(spec: StockAttackSpec): number {
  return spec.reach + PLAYER_HALF_W;
}

/** How far the opponent's grounded game reaches: the band a careful fighter stays outside. */
export function threatReach(moves: StockMoveset): number {
  return Math.max(forwardReach(moves.opener), forwardReach(moves.finisher), forwardReach(moves.launcher));
}

/** Where the opponent most likely is `ahead` ticks after the snapshot, kept on its surface while it stands. */
export function predictFoe(foe: Pick<StockFoeRead, 'x' | 'y' | 'vx' | 'vy' | 'age' | 'grounded' | 'attack'>, prediction: number, ahead = 0,
  bounds?: { x0: number; x1: number }): { x: number; y: number } {
  // A grounded swing locks its owner's keys: the body is not going anywhere until it ends.
  const moving = foe.attack && foe.grounded ? 0 : 1;
  const t = (Math.min(LEAD_CAP, foe.age) + ahead) * prediction * moving;
  let x = foe.x + foe.vx * t;
  const y = foe.grounded ? foe.y : foe.y + foe.vy * t * 0.5;
  if (foe.grounded && bounds) x = Math.max(bounds.x0, Math.min(bounds.x1, x));
  return { x, y };
}

/** Would `spec`, started now from (x, y) facing `facing`, catch a body standing at (tx, ty)? `slop` widens its far edge. */
export function strikeCovers(spec: StockAttackSpec, facing: number, x: number, y: number, tx: number, ty: number, slop = 0): boolean {
  return stockAttackOverlaps(slop ? { ...spec, reach: spec.reach + slop } : spec, facing, x, y, tx, ty);
}

function grabCovers(facing: number, x: number, y: number, tx: number, ty: number): boolean {
  const dx = (tx - x) * facing;
  return dx >= STOCK_GRAB.min + 1 && dx <= STOCK_GRAB.max - 2 && Math.abs(ty - y) <= STOCK_GRAB.dy;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The nearest x on the bot's surface where a body touches nothing harmful, searching out from `x`: first on the bot's own
 * side of the opponent (never through it while there is a choice), then anywhere on the deck. Null when it all burns.
 */
export function cleanGround(x: number, toward: number, foeX: number, deck: { x0: number; x1: number }, heat: (x: number) => number): number | null {
  let fallback: number | null = null;
  for (let d = 3; d <= 120; d += 3) {
    for (const dir of [-toward, toward]) {
      const cx = x + dir * d;
      if (cx < deck.x0 || cx > deck.x1 || heat(cx) > 0) continue;
      if (Math.sign(foeX - cx) === toward || Math.abs(foeX - cx) < 4) return cx;
      fallback ??= cx;
    }
  }
  return fallback;
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp(t, 0, 1);

/** The current swing seen on the opponent, aged to NOW: the snapshot is `foe.age` ticks old and the swing kept going. */
export function swingNow(foe: Pick<StockFoeRead, 'attack' | 'age'>): { spec: StockAttackSpec; facing: number; kind: StockAttackKind; age: number; toActive: number; left: number; total: number } | null {
  const a = foe.attack;
  if (!a) return null;
  const age = a.age + foe.age, total = a.spec.startup + a.spec.active + a.spec.recovery;
  if (age >= total) return null; // over by now (a person knows how long it lasts)
  return { spec: a.spec, facing: a.facing, kind: a.kind, age, toActive: a.spec.startup - age, left: total - age, total };
}

export class StockTactics {
  mode: StockMode = 'neutral';
  private since = 0;
  private until = 0;
  /** Which way the opponent is from the bot (+1: to its right). Sticky while the bodies overlap. */
  private toward = 0;
  private offset = 0;
  private offsetUntil = 0;
  private plan: StockStrike | 'hop' = 'opener';
  /** The start tick of the last swing the bot rolled an answer for (one answer per swing). */
  private answered = -999;
  private punishRolled = -999;
  private shieldUntil = 0;
  private approachAfter = 0;
  private hopUntil = -1;
  private hopped = false;
  private escapeAfter = 0;
  private landedAt = -999;
  private hurtAt = -999;
  /** Seen opponent shields during approaches, decayed: the grab becomes the answer to a shielder. */
  private foeShields = 0;
  private influenceDir = 0;
  private influenceUntil = 0;
  readonly counts: Record<string, number> = {};

  /** Forget the plan (a respawn keeps the match's counts and what the opponent's shield habit taught it). */
  reset(keepMatch = false): void {
    this.mode = 'neutral'; this.since = this.until = 0; this.toward = 0; this.offset = 0; this.offsetUntil = 0;
    this.plan = 'opener'; this.answered = this.punishRolled = -999; this.shieldUntil = 0; this.approachAfter = 0;
    this.hopUntil = -1; this.hopped = false; this.escapeAfter = 0; this.landedAt = this.hurtAt = -999;
    this.influenceDir = this.influenceUntil = 0;
    if (keepMatch) return;
    this.foeShields = 0;
    for (const k of Object.keys(this.counts)) delete this.counts[k];
  }

  /** The bot's own blow landed (it sees its hit at once: the hitstop is on its own screen). */
  landed(tick: number): void { this.landedAt = tick; }
  /** The bot was hit: whatever it was doing is over. */
  hurt(tick: number): void { this.hurtAt = tick; if (this.mode !== 'neutral') this.enter('neutral', tick, 0); this.approachAfter = tick + 20; }

  private count(key: string): void { this.counts[key] = (this.counts[key] ?? 0) + 1; }

  private enter(mode: StockMode, tick: number, hold: number): void {
    if (mode !== this.mode) this.count(`mode_${mode}`);
    this.mode = mode; this.since = tick; this.until = tick + hold;
  }

  /** This tick's order. Call every tick (movement and timing are per tick; choices wait for a beat or an urgent read). */
  next(v: StockTacticsView): StockOrder {
    const order = this.choose(v);
    order.mode = this.mode;
    // Standing in fire: out to the nearest clean ground. Walking THROUGH a few embers to clean ground beyond them is
    // fine (stepping back out of every ember on the way turned one burning cell into a wall). A shield blocks the burn.
    const { me, heat } = v;
    if (!me.grounded && me.moves.neutral_air.name !== me.moves.aerial.name && order.strike && order.strike !== 'grab') order.facing = me.facing;
    if (heat && me.grounded && this.mode !== 'punish' && order.strike === null && !order.shield && order.dodge === null && heat(me.x) > 0) {
      const g = order.goalX;
      const passing = g !== null && Math.abs(g - me.x) > 12 && heat(g) === 0;
      const clean = passing ? null : cleanGround(me.x, this.toward || me.facing, this.lastAt, v.deck, heat);
      if (clean !== null) {
        if (!this.inFire) { this.inFire = true; this.count('fireEscapes'); }
        order.goalX = clean; order.tol = 2; order.why = 'step out of the fire';
        return order;
      }
    }
    this.inFire = false;
    return order;
  }

  private choose(v: StockTacticsView): StockOrder {
    const { me, foe, deck, stage, personality: p, skill, rng, tick } = v;
    const level = clamp(Math.round(skill.level), 1, 5) - 1;
    const order: StockOrder = { mode: this.mode, goalX: null, tol: 6, strike: null, facing: this.toward || me.facing, shield: false, dodge: null, jump: false, throwDir: null, influence: 0, why: '' };

    // ---- where the opponent is now, and which side of it the bot keeps ----
    const bounds = { x0: stage.x0, x1: stage.x1 };
    const at = predictFoe(foe, skill.prediction, 0, bounds);
    const dx = at.x - me.x, adx = Math.abs(dx);
    if (this.toward === 0 || adx > PLAYER_HALF_W * 2 - 1) this.toward = Math.sign(dx) || this.toward || me.facing || 1;
    const toward = this.toward;
    order.facing = toward;
    if (tick < this.influenceUntil) order.influence = this.influenceDir;
    const dy = at.y - me.y;
    const offstage = at.x < stage.x0 - 2 || at.x > stage.x1 + 2 || (foe.y > stage.y + 8 && !foe.grounded) || foe.onLedge;

    const myPoke = forwardReach(me.moves.opener);
    const foeThreat = threatReach(foe.moves);
    const slop = STOCK_SKILL.slop[level];
    const ready = (s: StockStrike): boolean => v.ready?.(s) ?? true;

    // ---- holding the opponent: throw it toward the nearer blast line (up once it is high enough to die off the top) ----
    if (me.canThrow) {
      const nearLeft = me.x - stage.x0 < stage.x1 - me.x;
      order.throwDir = foe.percent > 110 && rng.next() < 0.35 ? 'up' : nearLeft ? 'left' : 'right';
      order.why = `throw ${order.throwDir}`;
      this.count('throws');
      return order;
    }

    // ---- urgent: a swing the bot can see coming at it ----
    const swing = swingNow(foe);
    // (a body still in its own blow, a special's recovery or a dodge cannot answer: the roll waits until it can)
    if (swing && swing.toActive > -swing.spec.active && me.grounded && me.canAct) {
      const swingStart = tick - swing.age;
      const facesMe = Math.sign(me.x - at.x) === swing.facing || adx < PLAYER_HALF_W * 2;
      const reaches = facesMe && strikeCovers(swing.spec, swing.facing, at.x, at.y, me.x, me.y, 6);
      if (reaches && this.answered !== swingStart) {
        this.answered = swingStart;
        const chance = STOCK_SKILL.defend[level] * (0.55 + 0.45 * Math.max(p.block, p.defense)) * (1 - 0.35 * p.risk);
        if (rng.next() < chance) {
          const room = forwardReach(swing.spec) + 6 - adx;
          if (swing.toActive >= 6 && room < 12 && this.canStep(me.x - toward * 18, deck)) {
            this.enter('defend', tick, swing.toActive + 2); this.plan = 'opener'; this.count('stepOuts');
          } else if (me.shieldStrength >= 25 && (p.block >= p.dodge * 0.9 || !me.dodgeReady)) {
            this.enter('defend', tick, Math.max(8, swing.left - swing.spec.recovery + 3)); this.shieldUntil = this.until; this.count('shields');
          } else if (me.dodgeReady && swing.toActive >= 1) {
            order.dodge = 0; this.enter('defend', tick, 14); this.count('dodges');
            order.why = 'spot dodge the swing'; return order;
          }
        } else if (me.percent > 60) {
          // Unanswered: lean the coming launch back toward the middle (influence turns a launch, it never stops one).
          this.influenceDir = Math.sign((stage.x0 + stage.x1) / 2 - me.x); this.influenceUntil = tick + Math.max(0, swing.toActive) + swing.spec.active + 2;
        }
      }
    }

    // ---- urgent: a projectile about to land, on the ground: shield it (the jump/roll answer stays the brain's) ----
    if (v.shotIn !== null && v.shotIn <= 6 && me.grounded && me.shieldStrength >= 30 && this.mode !== 'defend' && v.decide &&
      rng.next() < p.block * 0.8 + 0.1) {
      this.enter('defend', tick, v.shotIn + 6); this.shieldUntil = this.until; this.count('shotShields');
    }

    // ---- defending: shield held, a step out, or waiting out a dodge ----
    if (this.mode === 'defend') {
      if (tick < this.shieldUntil && me.grounded && me.shieldStrength > 4) {
        order.shield = true;
        // A grab out of shield the moment the swing is spent and the attacker is still in front.
        const s2 = swingNow(foe);
        if ((!s2 || s2.toActive < -s2.spec.active) && grabCovers(toward, me.x, me.y, at.x, at.y) && ready('grab') && me.canAct) {
          order.shield = false; order.strike = 'grab'; this.shieldUntil = 0; this.count('oosGrabs');
          this.enter('neutral', tick, 0); this.approachAfter = tick + 24; order.why = 'grab out of shield'; return order;
        }
        if (s2 || tick < this.since + 8) { order.why = 'shield the swing'; return order; }
        this.shieldUntil = 0;
      } else if (tick < this.until) {
        order.goalX = clamp(me.x - toward * 22, deck.x0, deck.x1); order.tol = 3; order.why = 'step out of reach'; return order;
      }
      this.shieldUntil = 0;
      this.enter('neutral', tick, 0);
    }

    const heat = v.heat;
    this.lastAt = at.x;

    // ---- urgent: a recovery the bot can reach in time ----
    if (swing && swing.toActive < -swing.spec.active && this.mode !== 'punish') {
      const swingStart = tick - swing.age;
      if (this.punishRolled !== swingStart) {
        this.punishRolled = swingStart;
        const kind = this.punishWith(me, at, swing.left, ready);
        const chance = STOCK_SKILL.punish[level] * (0.6 + 0.4 * Math.max(p.counterattack, p.opportunism));
        if (kind && rng.next() < chance) { this.plan = kind; this.enter('punish', tick, swing.left); this.count('punishes'); }
      }
    }

    // ---- the opponent off the stage or hanging on its ledge: guard the edge, never follow it out ----
    if (offstage && this.mode !== 'punish') {
      if (this.mode !== 'edgeguard') this.enter('edgeguard', tick, 0);
      const side = at.x < (stage.x0 + stage.x1) / 2 ? -1 : 1;
      const lip = side < 0 ? deck.x0 : deck.x1;
      const stand = lip - side * (foe.onLedge ? 26 : 12);
      order.goalX = clamp(stand, deck.x0, deck.x1); order.tol = 4;
      order.facing = side;
      const strike = this.pickStrike(me, foe, at, side, slop, ready, v, true);
      if (strike) { order.strike = strike; order.facing = side; order.why = `edgeguard ${strike}`; return order; }
      order.why = foe.onLedge ? 'wait off the ledge' : 'guard the edge';
      return order;
    }
    if (this.mode === 'edgeguard') this.enter('neutral', tick, 0);

    // ---- after the bot's own hit: follow it (juggle a launched opponent, or step in for the next blow) ----
    if (tick - this.landedAt < 4 && this.mode !== 'punish' && this.mode !== 'pressure') {
      this.enter('pressure', tick, 40 + Math.round(30 * p.pressure));
      this.plan = foe.grounded ? 'opener' : 'hop';
    }
    if (this.mode === 'pressure' && (tick >= this.until || adx > 140)) { this.enter('neutral', tick, 0); this.approachAfter = tick + 10; }

    // ---- cornered with the opponent pressing: roll or jump back to the middle ----
    const centre = (stage.x0 + stage.x1) / 2;
    const cornered = (toward > 0 ? me.x - deck.x0 : deck.x1 - me.x) < 18 && Math.sign(centre - me.x) === toward;
    if (cornered && adx < foeThreat + 10 && tick >= this.escapeAfter && v.decide && this.mode === 'neutral' && me.grounded && me.canAct) {
      this.escapeAfter = tick + 150;
      if (rng.next() < 0.25 + 0.4 * Math.max(p.dodge, p.mobility)) {
        this.count('escapes');
        if (me.dodgeReady && rng.next() < 0.6) { order.dodge = toward; order.why = 'roll out of the corner'; return order; }
        this.enter('escape', tick, 34); this.hopUntil = tick + 9; this.hopped = false;
      }
    }
    if (this.mode === 'escape') {
      if (tick >= this.until || (me.grounded && tick > this.since + 12)) this.enter('neutral', tick, 0);
      else {
        order.goalX = clamp(at.x + toward * 30, deck.x0, deck.x1); order.tol = 3;
        order.jump = tick < this.hopUntil; order.why = 'jump out of the corner'; return order;
      }
    }

    // ---- the opponent coming in: counter-poke it, shield early, or give ground ----
    const closing = -Math.sign(dx) * foe.vx;
    if (this.mode === 'neutral' && v.decide && foe.grounded && closing > 1.2 && adx < foeThreat + 14 && !foe.stunned && me.canAct) {
      const r = rng.next();
      const poke = 0.25 * p.counterattack + 0.2 * p.aggression;
      const guard = 0.25 * p.block + 0.1 * p.defense;
      const give = 0.2 * p.patience;
      if (r < poke && adx <= myPoke + closing * me.moves.opener.startup + slop) {
        this.plan = 'opener'; this.enter('approach', tick, 12); this.count('counterPokes');
      } else if (r < poke + guard && me.shieldStrength > 40) {
        this.enter('defend', tick, 14 + rng.int(8)); this.shieldUntil = this.until; this.count('preShields');
        order.shield = true; order.why = 'shield the approach'; return order;
      } else if (r < poke + guard + give && this.canStep(me.x - toward * 24, deck)) {
        this.offset = 14; this.offsetUntil = tick + 30; this.count('giveGround');
      }
    }

    // ---- decide to go in ----
    if (this.mode === 'neutral' && v.decide && tick >= this.approachAfter && me.canAct && !foe.stunned) {
      let want = 0.05 + 0.24 * p.aggression + 0.08 * p.pressure + 0.06 * p.risk - 0.07 * p.patience;
      if (foe.percent > 90) want += 0.08 * p.opportunism;
      if (foe.shielding) want += 0.08;
      if (tick - this.hurtAt < 40) want -= 0.1 * p.defense;
      want *= STOCK_SKILL.approach[level];
      if (rng.next() < want) {
        this.foeShields *= 0.8;
        const grab = foe.shielding || rng.next() < Math.min(0.5, this.foeShields * 0.25);
        const hop = !grab && me.grounded && adx > 30 && adx < 90 && rng.next() < 0.12 + 0.3 * p.aerial;
        this.plan = grab && ready('grab') ? 'grab' : hop ? 'hop' : 'opener';
        this.enter('approach', tick, 70); this.count(`approach_${this.plan}`);
        this.hopped = false;
      }
    }
    if (foe.shielding && (this.mode === 'approach' || this.mode === 'pressure')) this.foeShields = Math.min(4, this.foeShields + 0.05);

    // ---- carrying out an approach, a punish, or a follow-up ----
    if (this.mode === 'approach' || this.mode === 'punish' || this.mode === 'pressure') {
      if (tick >= this.until && this.mode !== 'pressure') {
        this.enter('neutral', tick, 0); this.approachAfter = tick + 15;
      } else {
        const strike = this.goIn(v, order, at, toward, slop, ready);
        if (strike) {
          order.strike = strike;
          this.count(`strike_${strike}`);
          const spec = strike === 'grab' ? null : me.moves[strike];
          this.enter('neutral', tick, 0);
          this.approachAfter = tick + (spec ? spec.startup + spec.active + spec.recovery : 28) + 6 + rng.int(12);
          return order;
        }
        return order;
      }
    }

    // ---- neutral: hold a band just outside the opponent's reach, drift inside it, strike what walks in ----
    if (tick >= this.offsetUntil) {
      // Footsies: drift in and out of the band. A cautious profile drifts in less (it stays outside the reach it fears).
      this.offset = (rng.next() * 2 - 1) * 9 * (0.5 + p.mobility);
      if (this.offset < 0) this.offset *= 0.3 + 0.7 * (0.6 * p.aggression + 0.4 * p.risk);
      this.offsetUntil = tick + 28 + rng.int(44);
    }
    const bold = 0.6 * p.aggression + 0.4 * p.risk;
    const hurtLately = tick - this.hurtAt < 45 ? 10 * p.defense : 0;
    const prefer = Math.max(myPoke - 4, lerp(foeThreat + 10, myPoke + 1, bold)) + this.offset + skill.spacing + hurtLately;
    // On another surface (an opponent overhead) stand under it instead of a band that would walk off the deck.
    const target = Math.abs(dy) > 30 && !foe.grounded ? at.x - toward * 6 : at.x - toward * prefer;
    order.goalX = clamp(target, deck.x0, deck.x1);
    // Never hold the band on burning ground: the nearest clean spot on this side of the opponent.
    if (heat && heat(order.goalX) > 0) order.goalX = cleanGround(order.goalX, toward, at.x, deck, heat) ?? order.goalX;
    order.tol = 6;
    order.why = 'hold spacing';
    // Something walked into a blow's reach: take it (a person does not wait for a beat when it is right there).
    if (me.canAct && tick >= this.approachAfter - 10) {
      const strike = this.pickStrike(me, foe, at, toward, Math.min(slop, 2), ready, v, false);
      if (strike) {
        order.strike = strike; this.count(`strike_${strike}`);
        const spec = me.moves[strike];
        this.approachAfter = tick + spec.startup + spec.active + spec.recovery + 8 + rng.int(10);
        order.why = `poke what walked in: ${strike}`;
      }
    }
    // Turn to face the opponent while standing (a one-tick tap, as a person turns).
    if (order.goalX !== null && Math.abs(order.goalX - me.x) <= order.tol && me.facing !== toward && me.grounded && !order.strike) {
      order.goalX = me.x + toward * (order.tol + 2); order.tol = 0;
    }
    return order;
  }

  private inFire = false;
  private lastAt = 0;

  private canStep(x: number, deck: { x0: number; x1: number }): boolean {
    return x > deck.x0 + 2 && x < deck.x1 - 2;
  }

  /** The best blow to punish a recovery with `left` ticks remaining, if the bot can get there in time. */
  private punishWith(me: StockSelfRead, at: { x: number; y: number }, left: number, ready: (s: StockStrike) => boolean): StockAttackKind | null {
    if (!me.grounded) return null;
    const adx = Math.abs(at.x - me.x);
    let best: StockAttackKind | null = null, value = -1;
    for (const kind of ['finisher', 'launcher', 'opener'] as const) {
      const spec = me.moves[kind];
      if (!ready(kind)) continue;
      const travel = Math.max(0, adx - (forwardReach(spec) - 2)) / WALK;
      if (travel + spec.startup + 1 > left) continue;
      if (at.y < me.y + spec.top - 2 || at.y - PLAYER_H > me.y + spec.bottom + 2) continue;
      const v = spec.damage * (1 + spec.growth) - travel;
      if (v > value) { value = v; best = kind; }
    }
    return best;
  }

  /** Walk in (or hop in) for the planned strike; returns the strike to press this tick, if it lands. */
  private goIn(v: StockTacticsView, order: StockOrder, at: { x: number; y: number }, toward: number, slop: number, ready: (s: StockStrike) => boolean): StockStrike | null {
    const { me, foe, deck, tick } = v;
    const plan = this.plan;
    order.why = `${this.mode} ${plan}`;
    order.tol = 2;
    if (plan === 'grab') {
      order.goalX = clamp(at.x - toward * 12, deck.x0, deck.x1);
      if (me.grounded && me.canAct && grabCovers(toward, me.x, me.y, at.x, at.y)) return 'grab';
      return null;
    }
    if (plan === 'hop') {
      // A short hop at the opponent, the aerial pressed as its hitbox will meet the body.
      if (me.grounded && !this.hopped) {
        const lead = Math.abs(at.x - me.x);
        if (lead < 70 && me.canAct) { this.hopped = true; this.hopUntil = tick + HOP_HOLD; }
        order.goalX = clamp(at.x - toward * 14, deck.x0, deck.x1);
      } else {
        order.goalX = clamp(at.x - toward * 8, deck.x0, deck.x1);
        order.tol = 0;
      }
      order.jump = tick < this.hopUntil;
      if (!me.grounded && me.canAct) {
        const spec = me.moves.aerial;
        const later = predictFoe(foe, v.skill.prediction, spec.startup, { x0: v.stage.x0, x1: v.stage.x1 });
        if (strikeCovers(spec, toward, me.x + me.vx * spec.startup, me.y + me.vy * spec.startup * 0.5, later.x, later.y, slop) && ready('aerial')) return 'aerial';
      }
      if (me.grounded && this.hopped && tick > this.hopUntil + 4) { this.enter('neutral', tick, 0); this.approachAfter = tick + 12; }
      return null;
    }
    // A juggle: the opponent launched above the bot. Get under where it is falling and meet it.
    if (!foe.grounded && foe.stunned && at.y < me.y - 18) {
      order.goalX = clamp(at.x - toward * 4, deck.x0, deck.x1); order.tol = 2;
      order.why = `${this.mode} juggle`;
      const strike = this.pickStrike(me, foe, at, toward, slop, ready, v, false);
      if (strike) return strike;
      if (me.grounded && me.canAct && Math.abs(at.x - me.x) < 22 && at.y > me.y - 70 && foe.vy > 0 && !this.hopped) {
        this.hopped = true; this.hopUntil = tick + HOP_HOLD + 2; this.plan = 'hop';
      }
      return null;
    }
    const kind: StockAttackKind = typeof plan === 'string' && plan in me.moves ? plan as StockAttackKind : 'opener';
    const spec = me.moves[kind];
    order.goalX = clamp(at.x - toward * Math.max(6, forwardReach(spec) - 8), deck.x0, deck.x1);
    if (!me.canAct) return null;
    const strike = this.pickStrike(me, foe, at, toward, slop, ready, v, this.mode === 'punish', kind);
    return strike;
  }

  /**
   * The blow to throw now, if one will meet the opponent where it will be when the blow comes out. Value prefers the
   * planned kind, a finisher when the opponent is high enough to die, a launcher at a body above, and what has worked.
   */
  private pickStrike(me: StockSelfRead, foe: StockFoeRead, at: { x: number; y: number }, facing: number, slop: number,
    ready: (s: StockStrike) => boolean, v: StockTacticsView, heavy: boolean, planned?: StockAttackKind): StockAttackKind | null {
    if (!me.canAct) return null;
    if (foe.dodging) return null; // swinging into a dodge is a free punish for it
    const p = v.personality;
    const expanded = me.moves.neutral_air.name !== me.moves.aerial.name;
    const kinds: readonly StockAttackKind[] = me.grounded
      ? expanded ? ['opener', 'launcher', 'finisher', 'up_smash', 'down_smash'] : ['opener', 'launcher', 'finisher']
      : expanded ? ['aerial', 'neutral_air', 'back_air', 'up_air', 'down_air'] : ['aerial'];
    let best: StockAttackKind | null = null, bestValue = -Infinity;
    for (const kind of kinds) {
      const spec = me.moves[kind];
      if (!ready(kind)) continue;
      const later = predictFoe(foe, v.skill.prediction, spec.startup, { x0: v.stage.x0, x1: v.stage.x1 });
      const sx = me.grounded ? me.x : me.x + me.vx * spec.startup;
      const sy = me.grounded ? me.y : me.y + me.vy * spec.startup * 0.5;
      const strikeFacing = me.grounded || !expanded ? facing : me.facing;
      if (!strikeCovers(spec, strikeFacing, sx, sy, later.x, later.y, slop) || !strikeCovers(spec, strikeFacing, sx, sy, at.x, at.y, slop + 2)) continue;
      let value = kind === 'opener' ? 0.7 + 0.25 * p.fastAttack : kind === 'launcher' ? 0.35 + 0.2 * p.combo : kind === 'finisher' ? 0.3 + 0.3 * p.heavyAttack : 0.8;
      if (kind === planned) value += 0.25;
      // Percent decides what a blow is FOR: build damage early, launch late.
      const ko = clamp((foe.percent - 60) / 80, 0, 1);
      if (kind === 'finisher') value += 0.7 * ko + (heavy ? 0.5 : 0) + (foe.stunned ? 0.3 : 0);
      if (kind === 'launcher') value += (at.y < me.y - 14 ? 0.6 : 0) + 0.3 * ko;
      if (foe.shielding) value -= kind === 'opener' ? 0.2 : 0.5;
      value += v.learned?.(kind) ?? 0;
      value += (v.rng.next() - 0.5) * 0.2 * (0.5 + p.variety);
      if (value > bestValue) { bestValue = value; best = kind; }
    }
    return best;
  }
}
