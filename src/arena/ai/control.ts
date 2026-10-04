import type { NavEdge } from '@/arena/ai/nav';
import type { BrainSelf } from '@/arena/ai/brain';
import type { MeView } from '@/arena/ai/worldView';
import { PLAYER_H, PLAYER_HALF_W, PLAYER_STEP_UP } from '@/core/types';
import { AI_BEHAVIOR } from '@/config/aiBehavior';

/**
 * CONTROL (docs/arena/AI-FIGHTERS.md 2.4): turns a goal into this tick's inputs. It owns the hands (`Hand`: the keys,
 * the cursor and the trigger, written exactly as the input layer writes them), steering with TRACTION AWARENESS
 * (`Traction`: the bot learns how fast its own body stops, so a heavy or slidey fighter brakes by predicted stop
 * distance instead of by a constant), obstacle hopping, the nav's rise-and-cross edges, the stuck detector, and aim with
 * lead. Nothing here moves the body: it only presses what a person would press.
 */

/** The terrain questions Control asks (the game's own collision test: what a person SEES the body can and cannot pass). */
export interface Terrain {
  /** A body with `halfW` either side and `h` tall, feet at (x, y), fits there. */
  free(x: number, y: number, halfW: number, h: number): boolean;
}

/** Tallest ledge the body walks up on its own (`PLAYER_STEP_UP`). */
const STEP = PLAYER_STEP_UP;
/** The tallest lift worth scanning for. */
const MAX_LIFT = 64;
/** A plain jump gets this high on its own (the apex of the launch: 3.7 cells/tick against 0.28 gravity). */
const JUMP_APEX = 24;
/** The body's gravity, cells per tick squared (entities/Player): a released jump coasts up by `vy^2 / (2 * GRAVITY)`. */
const GRAVITY = 0.28;

/** Where the feet will peak if the jump/jet is let go now. */
export function apexY(me: Pick<MeView, 'y' | 'vy'>): number {
  return me.vy < 0 ? me.y - (me.vy * me.vy) / (2 * GRAVITY) : me.y;
}

// ---------------------------------------------------------------------------------------------------------------- hands

/**
 * The fighter's hands: writes the keys, the cursor and the trigger the way `InputManager` does (a rising jump
 * edge queues the jump so a one-tick tap still counts; a fresh trigger pull sets the press edge; releasing clears the
 * "fresh press" block), and counts the ticks nothing was held.
 */
export class Hand {
  private jumpHeld = false;
  private fireHeld = false;
  /** Ticks in a row with no key, no trigger, no press. */
  idle = 0;
  private touched = false;

  constructor(private readonly self: BrainSelf) {}

  /** Call at the start of a tick before anything writes. */
  begin(): void {
    this.touched = false;
  }

  /** Call at the end of a tick: counts empty-handed ticks. */
  end(): void {
    const k = this.self.input.keys;
    const busy = this.touched || k.left || k.right || k.up || k.jump || k.down || k.grab || this.self.player.firing;
    this.idle = busy ? 0 : this.idle + 1;
  }

  /** Mark that a press (kick, Z, T, flask) happened this tick. */
  pressed(): void {
    this.touched = true;
  }

  /** -1 left, 0 none, +1 right. */
  move(dir: number): void {
    const k = this.self.input.keys;
    k.left = dir < 0;
    k.right = dir > 0;
  }

  get dir(): number {
    const k = this.self.input.keys;
    return k.right ? 1 : k.left ? -1 : 0;
  }

  jump(held: boolean): void {
    const input = this.self.input;
    if (held && !this.jumpHeld) input.queuedJump = 'jump';
    this.jumpHeld = held;
    input.keys.jump = held;
  }

  down(held: boolean): void {
    this.self.input.keys.down = held;
  }

  /** The cursor's world point (a whole cell, as the pointer's is). */
  aim(x: number, y: number): void {
    const m = this.self.input.mouse;
    m.x = Math.round(x);
    m.y = Math.round(y);
  }

  fire(held: boolean): void {
    const p = this.self.player;
    if (held && !this.fireHeld) {
      p.fireBlockedUntilRelease = false;
      p.firePressed = true;
    }
    if (!held && this.fireHeld) p.fireBlockedUntilRelease = false;
    this.fireHeld = held;
    p.firing = held;
  }

  /** Every input off (a switch-off, a death, a new floor). */
  release(): void {
    const input = this.self.input;
    const k = input.keys;
    k.left = k.right = k.up = k.jump = k.wallJump = k.down = k.grab = false;
    input.queuedJump = undefined;
    input.queuedDodge = false;
    this.self.player.firePressed = false;
    this.self.fighters?.releaseInputs?.();
    this.jumpHeld = false;
    if (this.fireHeld) {
      this.self.player.firing = false;
      this.self.player.fireBlockedUntilRelease = false;
    }
    this.fireHeld = false;
    this.idle = 0;
  }
}

// ------------------------------------------------------------------------------------------------------------- traction

/**
 * How quickly this body stops. On the ground, a released key multiplies `vx` by a decay each tick (the game's
 * `groundStopDecay`, 0.48: it stops in about three cells; a slidey fighter's is far higher), so the distance still to be
 * travelled after letting go is `|vx| * d / (1 - d)`. The bot starts from the shipped decay and LEARNS its own from the
 * ticks it watches itself coast (an exponential average of observed `vx` ratios), so a fighter whose body is heavier or
 * slidier brakes at the right moment without Control knowing which fighter it drives.
 */
export class Traction {
  decay: number;
  /** Observations folded in (the tests read it). */
  samples = 0;
  private prevVx = 0;
  private prevGrounded = false;

  constructor(initialDecay: number) {
    this.decay = clamp(initialDecay, 0.05, 0.97);
  }

  /** `vx` is the speed the last tick left the body with; `keyHeld` is whether a horizontal key was down DURING that tick. */
  observe(vx: number, keyHeld: boolean, grounded: boolean): void {
    // A clean coasting tick: grounded both ticks, no horizontal key held, moving fast enough to read, still the same way.
    if (!keyHeld && this.prevGrounded && grounded && Math.abs(this.prevVx) > 0.5 && vx * this.prevVx > 0) {
      const ratio = clamp(vx / this.prevVx, 0.05, 0.97);
      this.decay += (ratio - this.decay) * 0.2;
      this.samples++;
    }
    this.prevVx = vx;
    this.prevGrounded = grounded;
  }

  /** Cells the body still travels after letting go at speed `vx` (signed like `vx`). */
  stopDistance(vx: number): number {
    return (vx * this.decay) / (1 - this.decay);
  }
}

// ------------------------------------------------------------------------------------------------------- stuck detector

/**
 * The bot's own sense of "I am not getting anywhere": the same place (within 3 cells) for 3 s while the goal said move.
 * The brain answers by dropping the plan and trying another way (docs/arena/AI-FIGHTERS.md 8.3: a stuck bot is a bug).
 */
export class StuckDetector {
  static readonly WINDOW = 180;
  private x = 0;
  private y = 0;
  private since = 0;
  private moveTicks = 0;

  /** Returns true on the tick the bot decides it is stuck (and starts a fresh window). */
  update(me: Pick<MeView, 'x' | 'y'>, wantsMove: boolean, tick: number, idleTicks = 0): boolean {
    if (!wantsMove) { this.moveTicks = 0; this.anchor(me, tick); return false; }
    this.moveTicks++;
    if (Math.abs(me.x - this.x) > 3 || Math.abs(me.y - this.y) > 6) { this.anchor(me, tick); this.moveTicks = 1; return false; }
    if (idleTicks >= 90 || (tick - this.since >= StuckDetector.WINDOW && this.moveTicks >= StuckDetector.WINDOW)) {
      this.anchor(me, tick);
      this.moveTicks = 0;
      return true;
    }
    return false;
  }

  private anchor(me: Pick<MeView, 'x' | 'y'>, tick: number): void {
    this.x = me.x;
    this.y = me.y;
    this.since = tick;
  }
}

// --------------------------------------------------------------------------------------------------------------- control

export type EdgeStatus = 'running' | 'done' | 'failed';
type HopPhase = 'none' | 'rise' | 'cross' | 'land';
type EdgePhase = 'approach' | 'rise' | 'cross' | 'land';

/** How the walk steering behaves. */
export interface WalkOptions {
  /** How close counts as there (cells). */
  tol: number;
  /** Do not hop: a bot that wants to stay put or is leaving a ledge by walking. */
  noHop?: boolean;
}

export class Control {
  readonly hand: Hand;
  readonly traction: Traction;
  readonly stuck = new StuckDetector();
  private hop: { phase: HopPhase; dir: number; topY: number; until: number; landingX?: number } = { phase: 'none', dir: 0, topY: 0, until: 0 };
  private edge: { phase: EdgePhase; since: number; edge: NavEdge | null; holdJump: boolean } = { phase: 'approach', since: 0, edge: null, holdJump: false };
  private escapeUntil = 0;
  private escapeDir = 0;
  private escapeJump = true;
  /** Ticks of the current rise/cross: a timeout turns a hop that never lands into a failure. */
  private tick = 0;
  /** How many hops started, for the probes. */
  hops = 0;

  constructor(
    self: BrainSelf,
    private readonly terrain: Terrain,
    groundDecay: number,
  ) {
    this.hand = new Hand(self);
    this.traction = new Traction(groundDecay);
  }

  /** Per tick, first: learn from what the body just did. */
  observe(me: MeView, tick: number): void {
    this.tick = tick;
    this.traction.observe(me.vx, this.hand.dir !== 0, me.grounded);
  }

  reset(): void {
    this.hand.release();
    this.hop = { phase: 'none', dir: 0, topY: 0, until: 0 };
    this.edge = { phase: 'approach', since: 0, edge: null, holdJump: false };
    this.escapeUntil = 0;
  }

  // ---------------------------------------------------------------------------------------------------------- walking

  /** Walk to `goalX` and stop there, braking by the predicted stop distance; hop what is in the way. */
  walkTo(me: MeView, goalX: number, opts: WalkOptions): void {
    if (this.tick < this.escapeUntil) { this.escape(me); return; }
    const dir = this.steer(me, goalX, opts.tol);
    this.hand.move(dir);
    if (opts.noHop) { this.hand.jump(false); return; }
    this.hopAhead(me, dir);
  }

  /** Stand still: let go of the keys, brake by coasting. A hop in progress finishes first. */
  hold(me: MeView): void {
    if (this.tick < this.escapeUntil) { this.escape(me); return; }
    this.hand.move(0);
    this.hopAhead(me, 0);
  }

  /**
   * The steering decision: which way to hold, given where the body would COAST to. It presses until the predicted
   * resting place reaches the goal, lets go, and re-presses only when the prediction falls clear of the tolerance, so it
   * brakes on a mark at any traction and does not chatter on it.
   */
  steer(me: MeView, goalX: number, tol: number): number {
    const grounded = me.grounded || me.inLiquid;
    const stop = grounded ? this.traction.stopDistance(me.vx) : me.vx * 6; // in the air momentum carries: guess a short glide
    const err = goalX - (me.x + stop);
    const held = this.hand.dir;
    if (held === 0) return Math.abs(err) > tol + 1.5 ? Math.sign(err) : 0;
    // already pressing: keep on until the prediction reaches the goal (or we would overshoot), then let go
    if (Math.sign(err) !== held) return Math.abs(err) > tol * 0.5 + 0.5 ? Math.sign(err) : 0;
    return Math.abs(err) < tol * 0.4 ? 0 : held;
  }

  /** How many cells the body must be lifted for the cell `ahead` cells along `dir` to be free, or -1 when it cannot be. */
  lift(me: MeView, dir: number, ahead: number): number {
    for (let h = 0; h <= MAX_LIFT; h++) {
      if (this.terrain.free(me.x + dir * ahead, me.y - h, PLAYER_HALF_W, PLAYER_H)) return h;
    }
    return -1;
  }

  /** Hop an obstacle in the walking direction: a jump (and the jet, for a tall one) held until the feet clear its top. */
  private hopAhead(me: MeView, dir: number): void {
    const hop = this.hop;
    if (hop.phase === 'rise') {
      this.hand.move(hop.dir);
      // let go when the coast alone carries the feet over the top (a jet climbs at 3+ cells a tick: it coasts a long way)
      const cleared = apexY(me) <= hop.topY - 2;
      if (cleared || this.tick > hop.until || (me.levit < 4 && !me.grounded && me.vy > 0)) {
        this.hand.jump(false);
        hop.phase = 'cross';
        hop.until = this.tick + 40;
      } else {
        this.hand.jump(true);
      }
      return;
    }
    if (hop.phase === 'cross') {
      if (hop.landingX !== undefined && (me.x - hop.landingX) * hop.dir >= -2) {
        hop.phase = 'land'; hop.until = this.tick + 60;
        this.hand.move(this.steer(me, hop.landingX, 2));
        this.hand.jump(false);
        return;
      }
      this.hand.move(hop.dir);
      // hold the clearance while the body is still over the obstacle: the jet comes on again if it sinks below the top
      this.hand.jump(me.y > hop.topY - 2 && !me.grounded && me.levit > 6);
      if ((me.grounded && this.tick > hop.until - 36) || this.tick > hop.until) hop.phase = 'none';
      return;
    }
    if (hop.phase === 'land') {
      // Brake over the planner's checked island and let go of the jet,
      // even if combat has already chosen a farther movement goal.
      this.hand.move(this.steer(me, hop.landingX ?? me.x, 2));
      this.hand.jump(false);
      if (me.grounded || this.tick > hop.until) hop.phase = 'none';
      return;
    }
    this.hand.jump(false);
    if (dir === 0 || !me.grounded) return;
    const h = this.lift(me, dir, 5);
    if (h <= STEP) return; // clear, or a step the body climbs on its own (-1, an obstacle too tall, falls through to nothing)
    if (me.levit < Math.max(0, (h - JUMP_APEX) * 0.8) + 8) return; // not enough fuel for this: wait on the ground
    hop.phase = 'rise';
    hop.dir = dir;
    hop.topY = me.y - h;
    hop.until = this.tick + 20 + h;
    this.hops++;
    this.hand.move(dir);
    this.hand.jump(true);
  }

  /** Is a hop or an edge in progress (the brain does not change plans mid-air)? */
  get committed(): boolean {
    return this.hop.phase !== 'none' || (this.edge.edge !== null && this.edge.phase !== 'approach');
  }

  /** A terrain-checked rise over a hazard uses the same height control as cover. */
  startHop(dir: number, topY: number, fromY: number, landingX?: number): void {
    this.hop = { phase: 'rise', dir, topY, until: this.tick + 20 + fromY - topY, landingX };
    this.escapeUntil = 0;
    this.hand.move(dir);
    this.hand.jump(true);
    this.hops++;
  }

  // ---------------------------------------------------------------------------------------------------------- nav edges

  /** Begin a nav edge (the brain calls this once, then `runEdge` every tick until it is no longer 'running'). */
  startEdge(edge: NavEdge): void {
    this.edge = { phase: 'approach', since: this.tick, edge, holdJump: false };
    this.hop.phase = 'none';
  }

  cancelEdge(): void {
    this.edge.edge = null;
    this.edge.phase = 'approach';
    this.hand.jump(false);
  }

  get activeEdge(): NavEdge | null {
    return this.edge.edge;
  }

  /**
   * Carry out one nav edge: walk to its launch point, rise beside the ledge (the jump, then the jet) until the feet are
   * over its lip, cross sideways holding the height, and let go over the landing. Returns whether it is still going,
   * landed on the far side (`done`), or timed out / came down where it started (`failed`).
   */
  runEdge(me: MeView, onTarget: boolean): EdgeStatus {
    const st = this.edge;
    const e = st.edge;
    if (!e) return 'failed';
    const elapsed = this.tick - st.since;
    if (e.kind === 'walk' || e.kind === 'drop') {
      this.walkTo(me, e.landX, { tol: 4, noHop: false });
      if (onTarget && me.grounded) { st.edge = null; return 'done'; }
      return elapsed > 360 ? this.failEdge() : 'running';
    }
    switch (st.phase) {
      case 'approach': {
        this.walkTo(me, e.launchX, { tol: 2, noHop: e.through });
        if (Math.abs(me.x - e.launchX) <= 3 && me.grounded && Math.abs(me.vx) < 0.7) {
          this.hand.jump(false);
          if (me.levit < (e.minFuel ?? 0)) break;
          st.phase = 'rise';
          st.since = this.tick;
          this.hand.move(0);
        } else if (elapsed > 420) return this.failEdge();
        break;
      }
      case 'rise': {
        this.hand.jump(true);
        // keep the column: a nudge back toward the launch x when the jet drifts the body
        const off = e.launchX - me.x;
        this.hand.move(Math.abs(off) > 3 ? Math.sign(off) : 0);
        if (e.through ? me.y <= e.clearY && !me.grounded : apexY(me) <= e.clearY - 1 && !me.grounded) {
          st.phase = e.through ? 'land' : 'cross'; st.since = this.tick;
          if (e.through) this.hand.jump(false);
        }
        else if (this.tick - st.since > 110 || me.levit < 2) return this.failEdge();
        break;
      }
      case 'cross': {
        this.hand.move(e.dir);
        // hold the height while crossing: jet on below the clear line, off well above it
        if (me.y > e.clearY - 1) st.holdJump = true;
        else if (me.y < e.clearY - 7) st.holdJump = false;
        this.hand.jump(st.holdJump && me.levit > 2);
        const past = (me.x - e.landX) * e.dir >= -2;
        if (past) { st.phase = 'land'; st.since = this.tick; this.hand.jump(false); }
        else if (this.tick - st.since > 90) return this.failEdge();
        break;
      }
      case 'land': {
        this.hand.jump(false);
        // settle on the landing spot
        this.hand.move(this.steer(me, e.landX, 3));
        if (me.grounded && onTarget) { st.edge = null; this.hand.move(0); return 'done'; }
        if (me.grounded && this.tick - st.since > 12) return this.failEdge(); // down, and not on the far side: missed it
        if (this.tick - st.since > 80) return this.failEdge();
        break;
      }
    }
    return 'running';
  }

  private failEdge(): EdgeStatus {
    this.edge.edge = null;
    this.edge.phase = 'approach';
    this.hand.jump(false);
    this.hand.move(0);
    return 'failed';
  }

  // ------------------------------------------------------------------------------------------------------ getting unstuck

  /** Shake loose: walk one way for a while, tapping jump. The brain calls it when the stuck detector fires. */
  startEscape(dir: number, ticks: number, jump = true): void {
    this.escapeJump = jump;
    this.escapeDir = dir < 0 ? -1 : 1;
    this.escapeUntil = this.tick + ticks;
    this.hop.phase = 'none';
    this.edge.edge = null;
    this.edge.phase = 'approach';
  }

  private escape(me: MeView): void {
    this.hand.move(this.escapeDir);
    // a jump held for 14 ticks out of 24: over a low obstacle, and through the jet for a tall one
    const phase = (this.escapeUntil - this.tick) % 24;
    this.hand.jump(this.escapeJump && phase < 14 && (me.grounded || me.levit > 6));
  }

  get escaping(): boolean {
    return this.tick < this.escapeUntil;
  }
}

// -------------------------------------------------------------------------------------------------------------------- aim

/**
 * Where to put the cursor to hit a mover: its body centre led by (how old the bot's picture is) plus (how long the shot takes
 * to arrive), then turned about the shoulder by the bot's aim error. `projSpeed` 0 means instant (a beam, a stream).
 */
export function leadPoint(
  shoulder: { x: number; y: number },
  target: { cx: number; cy: number; vx: number; vy: number; age: number },
  projSpeed: number,
  errorRad: number,
  gravity = 0,
  prediction = 1,
): { x: number; y: number } {
  const dx0 = target.cx - shoulder.x;
  const dy0 = target.cy - shoulder.y;
  const flight = projSpeed > 0 ? Math.hypot(dx0, dy0) / projSpeed : 0;
  const t = Math.min(AI_BEHAVIOR.maxLeadTicks * prediction, target.age + flight) * AI_BEHAVIOR.aimLead * prediction;
  // the horizontal velocity leads in full; the vertical (a hop's arc, a fall) only half: it is not a straight line
  let ax = target.cx + target.vx * t - shoulder.x;
  let ay = target.cy + target.vy * t * 0.5 - shoulder.y - gravity * flight * (flight + 1) * 0.5;
  if (errorRad !== 0) {
    const c = Math.cos(errorRad);
    const s = Math.sin(errorRad);
    const rx = ax * c - ay * s;
    ay = ax * s + ay * c;
    ax = rx;
  }
  return { x: shoulder.x + ax, y: shoulder.y + ay };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
