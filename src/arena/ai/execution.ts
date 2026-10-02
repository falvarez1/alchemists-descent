import { aiTier } from '@/config/aiTiers';
import type { AiLevel, AiTier } from '@/config/aiTiers';
import type { Rng } from '@/core/rng';
import type { FoeView, ShotView, WorldView } from '@/arena/ai/worldView';

/**
 * EXECUTION (docs/arena/AI-FIGHTERS.md 2.5): skill noise on top of Control, so one brain is a clumsy opponent at level 1
 * and a sharp one at level 5. Four things, all drawn from the bot's own seeded `Rng` (never `entityRandom`, no wall
 * clock), all read live from `config/aiTiers` so a tuner can move them under a running bot:
 *
 *  - REACTION: the foes it perceives are `reaction` ticks old (a ring of recent snapshots). A competent bot knows how old
 *    its picture is and leads by it, so a slow bot is wrong when a foe CHANGES course, not on every shot.
 *  - AIM ERROR: a slowly drifting angular bias, up to `aimError` degrees, wider the faster the target moves. It drifts
 *    (re-aimed each decision and smoothed) rather than jitters, so the crosshair wanders like a hand and does not buzz.
 *  - DECISION RATE: Intent and the plan re-evaluate every `decision` ticks (a little jittered), not every tick.
 *  - HESITATION: one bounded chance to keep the previous plausible plan. No independent mistake rolls per action.
 * See docs/arena/AI-TUNING.md for awareness, prediction, spacing, adaptation and commitment settings.
 */

const RING = 64;
const RING_MASK = RING - 1;
const MAX_SNAP = 16;
const DEG = Math.PI / 180;

interface SnapFoe {
  body: FoeView | null;
  ref: object | null;
  x: number;
  y: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
}

interface Snap {
  tick: number;
  n: number;
  foes: SnapFoe[];
  shots: ShotView[];
}

/** A foe as the bot sees it: the current identity and body, with the position and velocity from `age` ticks ago. */
export interface PerceivedFoe {
  foe: FoeView;
  x: number;
  y: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  age: number;
  /** From the shoulder now to the foe's perceived body centre. */
  dist: number;
}

export type LapseKind = 'hesitate';

export interface Lapse {
  kind: LapseKind;
  until: number;
}

export class Execution {
  private readonly ring: Snap[] = [];
  private readonly seen: PerceivedFoe[] = [];
  private readonly seenShots: ShotView[] = [];
  private nextDecision = 0;
  private aimBias = 0;
  private aimGoal = 0;
  private reactionOffset = 0;
  private observationTick = -Infinity;
  spacingBias = 0;
  variation = 0;
  lapse: Lapse | null = null;
  /** How many lapses have happened: the probes and the tests read it. */
  lapses = 0;

  constructor(
    private readonly rng: Rng,
    public level: AiLevel,
  ) {
    for (let i = 0; i < RING; i++) {
      const foes: SnapFoe[] = [];
      for (let k = 0; k < MAX_SNAP; k++) foes.push({ body: null, ref: null, x: 0, y: 0, cx: 0, cy: 0, vx: 0, vy: 0 });
      this.ring.push({ tick: -1, n: 0, foes, shots: [] });
    }
  }

  /** The live numbers for this bot's level (re-read every call: the tuner may move them). */
  get tier(): AiTier {
    return aiTier(this.level);
  }

  /** Forget everything that was seen and planned (a respawn, a new floor). */
  reset(): void {
    for (const s of this.ring) { s.tick = -1; s.n = 0; s.shots.length = 0; }
    this.seen.length = 0;
    this.seenShots.length = 0;
    this.nextDecision = 0;
    this.aimBias = 0;
    this.aimGoal = 0;
    this.lapse = null;
    this.lapses = 0;
    this.reactionOffset = 0;
    this.observationTick = -Infinity;
    this.spacingBias = this.variation = 0;
  }

  /** Remember this tick's foes (call once per tick, with the truth). */
  record(view: WorldView): void {
    const s = this.ring[view.tick & RING_MASK];
    s.tick = view.tick;
    const n = Math.min(MAX_SNAP, view.foes.length);
    s.n = n;
    for (let i = 0; i < n; i++) {
      const f = view.foes[i];
      const d = s.foes[i];
      if (d.body === null) d.body = { ...f };
      else Object.assign(d.body, f);
      d.ref = f.ref;
      d.x = f.x;
      d.y = f.y;
      d.cx = f.cx;
      d.cy = f.cy;
      d.vx = f.vx;
      d.vy = f.vy;
    }
    const shots = view.shots ?? [];
    for (let i = 0; i < shots.length; i++) {
      if (s.shots[i]) Object.assign(s.shots[i], shots[i]);
      else s.shots[i] = { ...shots[i] };
    }
    s.shots.length = shots.length;
  }

  /**
   * The foes as the bot sees them: those that existed `reaction` ticks ago AND still do, at their old positions. A foe that
   * appeared inside the window is unseen for the rest of it (reaction time to something new); one that has died is gone at
   * once (the kill is on the bot's own screen).
   */
  perceive(view: WorldView): readonly PerceivedFoe[] {
    const seen = this.seen;
    seen.length = 0;
    const want = this.observedAt(view.tick);
    const delay = view.tick - want;
    const snap = this.ring[want & RING_MASK];
    const live = snap.tick === want;
    if (!live) return seen; // A new brain must acquire its first observation, too.
    const me = view.me;
    for (const f of view.foes) {
      let x = f.x, y = f.y, cx = f.cx, cy = f.cy, vx = f.vx, vy = f.vy, age = 0;
      let body = f;
      if (live) {
        let found: SnapFoe | null = null;
        for (let i = 0; i < snap.n; i++) if (snap.foes[i].ref === f.ref) { found = snap.foes[i]; break; }
        if (!found) continue; // it was not there `reaction` ticks ago: not yet noticed
        x = found.x; y = found.y; cx = found.cx; cy = found.cy; vx = found.vx; vy = found.vy;
        age = delay;
        body = found.body ?? f;
      }
      const dx = cx - me.x;
      const dy = cy - me.sy;
      const dist = Math.hypot(dx, dy);
      if (dist <= Math.max(48, this.tier.awareness * (body.clarity ?? 1))) seen.push({ foe: body, x, y, cx, cy, vx, vy, age, dist });
    }
    return seen;
  }

  /** Projectile recognition obeys the same reaction delay as target recognition. */
  perceiveShots(view: WorldView): readonly ShotView[] {
    const want = this.observedAt(view.tick);
    const delay = view.tick - want;
    const snap = this.ring[want & RING_MASK];
    this.seenShots.length = 0;
    if (snap.tick !== want) return this.seenShots;
    for (const old of snap.shots) {
      if (!view.shots.some((s) => s.ref === old.ref)) continue;
      this.seenShots.push({ ...old, age: delay });
    }
    return this.seenShots;
  }

  /** Is it time to decide again? (The first call always is.) */
  decisionDue(tick: number): boolean {
    return tick >= this.nextDecision;
  }

  private observedAt(tick: number): number {
    const age = Math.max(1, Math.min(60, Math.round(this.tier.reaction + this.reactionOffset)));
    this.observationTick = Math.max(this.observationTick, tick - age);
    return this.observationTick;
  }

  /** A decision was made at `tick`: schedule the next, and roll for a lapse. */
  decided(tick: number): void {
    const t = this.tier;
    this.reactionOffset = Math.round((this.rng.next() * 2 - 1) * t.reactionVariance);
    this.spacingBias = (this.rng.next() * 2 - 1) * t.spacingError;
    this.variation = (this.rng.next() * 2 - 1) * t.decisionNoise;
    const gap = Math.max(2, Math.round(t.decision * (0.85 + 0.3 * this.rng.next())));
    this.nextDecision = tick + gap;
    if (this.lapse && tick >= this.lapse.until) this.lapse = null;
    if (!this.lapse && t.mistake > 0 && this.rng.next() < t.mistake) {
      // One imperfection roll: a short hesitation, never a deliberately unsafe misstep.
      this.lapse = { kind: 'hesitate', until: tick + gap };
      this.lapses++;
    }
    // a new aim error for this interval; the crosshair drifts to it (tickAim)
    this.aimGoal = (this.rng.next() * 2 - 1) * t.aimError * DEG;
  }

  /** Is a lapse of this kind in force now? */
  lapsing(kind: LapseKind, tick: number): boolean {
    return this.lapse !== null && this.lapse.kind === kind && tick < this.lapse.until;
  }

  /**
   * Advance the aim error one tick and return it (radians): the bias drifts toward this decision's goal, scaled up with the
   * target's speed (a fast target is harder to track). Call once per tick.
   */
  tickAim(targetSpeed: number): number {
    this.aimBias += (this.aimGoal - this.aimBias) * 0.12;
    const speedK = 1 + Math.min(2, targetSpeed / 1.5);
    return this.aimBias * speedK;
  }
}
