import { aiTier } from '@/config/aiTiers';
import type { AiLevel, AiTier } from '@/config/aiTiers';
import type { Rng } from '@/core/rng';
import type { FoeView, WorldView } from '@/arena/ai/worldView';

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
 *  - MISTAKES: at each decision a `mistake` chance of a lapse: a hesitation (keeps the old plan), a whiff (no shot, kick
 *    or ability for an interval), or a misstep (a few ticks of walking the wrong way).
 */

const RING = 64;
const RING_MASK = RING - 1;
const MAX_SNAP = 16;
const DEG = Math.PI / 180;

interface SnapFoe {
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

export type LapseKind = 'hesitate' | 'whiff' | 'misstep';

export interface Lapse {
  kind: LapseKind;
  until: number;
  /** For a misstep: which way it walks (+-1). */
  dir: number;
}

export class Execution {
  private readonly ring: Snap[] = [];
  private readonly seen: PerceivedFoe[] = [];
  private nextDecision = 0;
  private aimBias = 0;
  private aimGoal = 0;
  lapse: Lapse | null = null;
  /** How many lapses have happened: the probes and the tests read it. */
  lapses = 0;

  constructor(
    private readonly rng: Rng,
    public level: AiLevel,
  ) {
    for (let i = 0; i < RING; i++) {
      const foes: SnapFoe[] = [];
      for (let k = 0; k < MAX_SNAP; k++) foes.push({ ref: null, x: 0, y: 0, cx: 0, cy: 0, vx: 0, vy: 0 });
      this.ring.push({ tick: -1, n: 0, foes });
    }
  }

  /** The live numbers for this bot's level (re-read every call: the tuner may move them). */
  get tier(): AiTier {
    return aiTier(this.level);
  }

  /** Forget everything that was seen and planned (a respawn, a new floor). */
  reset(): void {
    for (const s of this.ring) { s.tick = -1; s.n = 0; }
    this.seen.length = 0;
    this.nextDecision = 0;
    this.aimBias = 0;
    this.aimGoal = 0;
    this.lapse = null;
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
      d.ref = f.ref;
      d.x = f.x;
      d.y = f.y;
      d.cx = f.cx;
      d.cy = f.cy;
      d.vx = f.vx;
      d.vy = f.vy;
    }
  }

  /**
   * The foes as the bot sees them: those that existed `reaction` ticks ago AND still do, at their old positions. A foe that
   * appeared inside the window is unseen for the rest of it (reaction time to something new); one that has died is gone at
   * once (the kill is on the bot's own screen).
   */
  perceive(view: WorldView): readonly PerceivedFoe[] {
    const seen = this.seen;
    seen.length = 0;
    const delay = Math.max(0, Math.round(this.tier.reaction));
    const want = view.tick - delay;
    const snap = this.ring[want & RING_MASK];
    const live = snap.tick === want;
    const me = view.me;
    for (const f of view.foes) {
      let x = f.x, y = f.y, cx = f.cx, cy = f.cy, vx = f.vx, vy = f.vy, age = 0;
      if (live) {
        let found: SnapFoe | null = null;
        for (let i = 0; i < snap.n; i++) if (snap.foes[i].ref === f.ref) { found = snap.foes[i]; break; }
        if (!found) continue; // it was not there `reaction` ticks ago: not yet noticed
        x = found.x; y = found.y; cx = found.cx; cy = found.cy; vx = found.vx; vy = found.vy;
        age = delay;
      }
      const dx = cx - me.x;
      const dy = cy - me.sy;
      seen.push({ foe: f, x, y, cx, cy, vx, vy, age, dist: Math.hypot(dx, dy) });
    }
    return seen;
  }

  /** Is it time to decide again? (The first call always is.) */
  decisionDue(tick: number): boolean {
    return tick >= this.nextDecision;
  }

  /** A decision was made at `tick`: schedule the next, and roll for a lapse. */
  decided(tick: number): void {
    const t = this.tier;
    const gap = Math.max(2, Math.round(t.decision * (0.85 + 0.3 * this.rng.next())));
    this.nextDecision = tick + gap;
    if (this.lapse && tick >= this.lapse.until) this.lapse = null;
    if (!this.lapse && t.mistake > 0 && this.rng.next() < t.mistake) {
      const roll = this.rng.next();
      const kind: LapseKind = roll < 0.4 ? 'hesitate' : roll < 0.8 ? 'whiff' : 'misstep';
      this.lapse = { kind, until: tick + (kind === 'misstep' ? 8 : gap), dir: this.rng.next() < 0.5 ? -1 : 1 };
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
