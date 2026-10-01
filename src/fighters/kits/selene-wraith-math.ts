/**
 * The maths of Selene Wraith's kit (docs/fighters/selene-wraith.md), kept free of the world, the Ctx and the
 * renderer so it can be tested on its own (tests/fighters-selene.test.ts) and so the kit file is only rules.
 * Nothing here draws a random number; the kit does (entityRandom) and passes the rolls in.
 *
 * Three groups, one per ability:
 *  - Liquid Momentum: the slide's per-tick model (speed with a 3 % decay, the floor it follows, why it ends);
 *  - Quicksilver Echo: which distance along the aim to blink to, and the cooldown a recall leaves her;
 *  - Mirror Hunt: where the two echoes ride, how they glide, and which of the real body and the echoes a
 *    foe believes in.
 *
 * Numbers are first-pass tuning, live-tunable like config/params; the probe (scripts/verify-fighter-selene.mjs)
 * and the tests decide the final values.
 */
export const TUNING = {
  slide: {
    /** A crouch while grounded and at least this fast starts the slide (cells/tick; a full run is 2.85). */
    minSpeed: 2.2,
    /** Speed kept each tick. */
    decay: 0.97,
    /** Ticks at most. */
    maxTicks: 45,
    /** Share of the speed she leaves with. */
    exitK: 0.8,
    /** Below this she has stopped. */
    stopSpeed: 0.45,
    /** A tap is a slide: it is held at least this long even when S is let go. After that, S held is the slide. */
    minHold: 14,
    /** How far down a floor may fall away under her and still be followed (cells; a run's own step-up is 5). */
    snap: 5,
    /** Ticks before another slide may start. */
    rearm: 12,
    /** The mercury she sheds: a spark burst every this many ticks. */
    sparkEvery: 2,
  },
  echo: {
    id: 'quicksilver-echo',
    cooldown: 480,
    /** The blink: at most this far along the aim, at least this far from where she stood. */
    range: 40,
    minRange: 8,
    /** Steps back along the aim when the farthest point has nowhere to stand. */
    backoff: 4,
    /** How far from the aimed point a standable spot is looked for (cells). */
    landReach: 14,
    /** Of the 9 columns under her boots, this many must be on something: she does not land on a lip. */
    minFooting: 5,
    /** i-frames after a blink or a recall (ticks). */
    invuln: 8,
    /** Z again inside this many ticks returns her to the echo. */
    window: 180,
    /** What is left of the cooldown after a recall (x). */
    recallKeep: 0.4,
    /** The recall spot is looked for this far from where the echo stands (the floor may have changed). */
    recallReach: 6,
    /** The echo thins and flickers over its last this many ticks. */
    fadeTicks: 40,
  },
  mirror: {
    id: 'mirror-hunt',
    duration: 540,
    /** Cells ahead and behind her. */
    offset: 28,
    /** Closer than this and an echo has no room (a wall, a pit) and is not out. */
    minOffset: 8,
    /** Cells per tick an echo may glide toward its slot. */
    glide: 2.6,
    /** How fast an echo follows the ground up and down (cells/tick). */
    rise: 3,
    /** A foe within this many cells (plus its own half-width) of an echo has reached it. */
    popReach: 3,
    /** The foe is stunned this long (ticks). */
    stun: 30,
    /** A foe makes up its mind again this often (ticks). */
    reroll: 20,
    /** A foe farther than this from an echo does not see it. */
    lureRange: 230,
    /** How much a foe's guess at a distance may be out (+-noise/2). */
    noise: 0.24,
    /** Ticks an echo takes to dissolve when the ultimate ends, and to form when it begins. */
    fade: 18,
    form: 14,
    /** The echoes flicker over the last this many ticks. */
    warnTicks: 60,
  },
};

export type SeleneTuning = typeof TUNING;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ======================================================================== Liquid Momentum

/** Speed (cells/tick) she keeps `tick` ticks into a slide that began at `v0`. */
export function slideSpeedAt(v0: number, tick: number, decay: number = TUNING.slide.decay): number {
  return v0 * Math.pow(decay, tick);
}

/** The whole slide on flat ground: the cells it covers, the ticks it lasts and the speed she leaves with. A model, for the tests and the doc. */
export function slideTotals(v0: number, t = TUNING.slide): { distance: number; ticks: number; exitSpeed: number } {
  let v = Math.abs(v0), distance = 0, ticks = 0;
  while (ticks < t.maxTicks && v >= t.stopSpeed) {
    distance += v;
    v *= t.decay;
    ticks++;
  }
  return { distance, ticks, exitSpeed: v * t.exitK };
}

/**
 * The speed a slide begins at, signed. The crouch key edge lands in a tick where the player's own
 * stance has already clamped the run to a crawl, so the speed that counts is the better of this tick's and the
 * last one's; 0 when she is not going fast enough in one direction.
 */
export function slideStartSpeed(prevVx: number, vx: number, minSpeed = TUNING.slide.minSpeed): number {
  const best = Math.abs(prevVx) >= Math.abs(vx) ? prevVx : vx;
  if (Math.abs(best) < minSpeed) return 0;
  // A body that was running one way and is now going the other (a skid, a bounce) is not sliding anywhere.
  if (prevVx * vx < 0 && Math.abs(vx) > 0.3) return 0;
  return best;
}

/**
 * How many cells down the floor under column `x` is from `y` (0 = she stands on it), within `snap`; null when
 * there is none, which is a ledge. `floored(x, y)` answers "is there something to stand on right below a body
 * whose feet are at y".
 */
export function groundDrop(floored: (x: number, y: number) => boolean, x: number, y: number, snap: number): number | null {
  for (let d = 0; d <= snap; d++) if (floored(x, y + d)) return d;
  return null;
}

/** What the slide asks of the world each tick. */
export interface SlideEnv {
  x: number;
  y: number;
  /** The jump key is down. */
  jump: boolean;
  /** The crouch key is down. */
  down: boolean;
  /** A blow landed. */
  hurt: boolean;
  floored(x: number, y: number): boolean;
}

export type SlideEnd = 'jump' | 'hurt' | 'released' | 'stopped' | 'ledge';

/**
 * One slide, as the per-tick plan `FighterSystem.startMove` carries out. She keeps her speed with a small
 * decay, follows the floor down a slope or a step (the system's own whole-cell move climbs a lip up to 5), and
 * leaves the slide when she jumps, is hit, lets go of the crouch after a tap's worth, stops, or runs out of
 * floor. `step` answers null to end it.
 */
export class SlideModel {
  /** Signed speed, cells/tick. */
  v: number;
  age = 0;
  distance = 0;
  end: SlideEnd | null = null;
  /** Mirrors the system's whole-cell accumulator, so the floor is looked at where the body will actually be. */
  private acc = 0;

  constructor(v0: number, private readonly t = TUNING.slide) {
    this.v = v0;
  }

  /** The velocity she leaves with (an end by a blow keeps whatever the blow gave her: the kit reads the body then). */
  get exitVx(): number {
    return this.v * this.t.exitK;
  }

  step(e: SlideEnv): { dx: number; dy: number } | null {
    const t = this.t;
    if (e.jump) return this.finish('jump');
    if (e.hurt) return this.finish('hurt');
    if (this.age >= t.minHold && !e.down) return this.finish('released');
    if (Math.abs(this.v) < t.stopSpeed) return this.finish('stopped');
    const dx = this.v;
    const total = this.acc + dx;
    const cells = Math.trunc(total);
    let dy = 0;
    if (cells !== 0) {
      const drop = groundDrop(e.floored, e.x + cells, e.y, t.snap);
      if (drop === null) return this.finish('ledge');
      dy = drop;
    }
    this.acc = total - cells;
    this.distance += Math.abs(dx);
    this.v *= t.decay;
    this.age++;
    return { dx, dy };
  }

  private finish(why: SlideEnd): null {
    this.end = why;
    return null;
  }
}

// ======================================================================== Quicksilver Echo

/** The distances along the aim to try, farthest first: `range`, then back in `backoff` steps while at least `min`. */
export function blinkDistances(clear: number, range: number, min: number, backoff: number): number[] {
  const far = Math.min(range, Math.floor(clear));
  const out: number[] = [];
  if (far < min) return out;
  for (let d = far; d >= min; d -= backoff) out.push(d);
  return out;
}

export interface BlinkSpec {
  /** Where she stands (feet). */
  x: number;
  y: number;
  /** Unit aim. */
  ax: number;
  ay: number;
  /** Cells of open air along the aim from the shoulder before the first solid. */
  clear: number;
  /** True when she may be put there: room for the body, firm footing under it, nothing burning in it. */
  ok(x: number, y: number): boolean;
}

/**
 * The nearest spot to (x, y) within `reach` that `ok` accepts, searched in square rings outward and, inside
 * a ring, by true distance (so a floor three cells below beats a ledge four cells above). Null when there is none.
 */
export function nearestSpot(ok: (x: number, y: number) => boolean, x: number, y: number, reach: number): { x: number; y: number } | null {
  const bx = Math.round(x), by = Math.round(y);
  if (ok(bx, by)) return { x: bx, y: by };
  for (let r = 1; r <= reach; r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD && ok(bx + dx, by + dy)) { best = { x: bx + dx, y: by + dy }; bestD = d; }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Where a blink along the aim ends: the farthest point up to `range` cells out (never past the first solid) that
 * has a standable, safe spot near it and is at least `minRange` from where she stood. Null when there is none:
 * the press is refused and costs nothing.
 */
export function chooseBlink(s: BlinkSpec, t = TUNING.echo): { x: number; y: number; dist: number } | null {
  for (const d of blinkDistances(s.clear, t.range, t.minRange, t.backoff)) {
    // The point on the aim, at the height her feet would be there.
    const px = s.x + s.ax * d, py = s.y + s.ay * d;
    const land = nearestSpot(s.ok, px, py, t.landReach);
    if (!land) continue;
    if (Math.hypot(land.x - s.x, land.y - s.y) < t.minRange) continue;
    return { x: land.x, y: land.y, dist: d };
  }
  return null;
}

/** What is left of a cooldown after a recall. */
export function recallCooldown(remaining: number, keep = TUNING.echo.recallKeep): number {
  return remaining > 0 ? Math.ceil(remaining * clamp(keep, 0, 1)) : 0;
}

/** 1 while the echo stands, thinning to 0 over its last `fade` ticks (the recall window's end). */
export function echoFade(age: number, window = TUNING.echo.window, fade = TUNING.echo.fadeTicks): number {
  if (age >= window) return 0;
  const left = window - age;
  return left >= fade ? 1 : left / fade;
}

// ======================================================================== Mirror Hunt

/**
 * Where an echo rides: `side` (+1 to her right, -1 to her left; the pair is the same whichever way she faces, so
 * turning round never makes them cross) at `offset` cells, shortened in 4s while there is no ground for it,
 * down to `minOffset`. `groundAt(x)` is the standing y for the column, or null. Null when neither the full
 * offset nor any shorter one has ground: the echo is not out.
 */
export function echoSlot(
  px: number,
  side: number,
  groundAt: (x: number) => number | null,
  offset = TUNING.mirror.offset,
  minOffset = TUNING.mirror.minOffset,
): { x: number; y: number } | null {
  for (let o = offset; o >= minOffset; o -= 4) {
    const x = Math.round(px + side * o);
    const y = groundAt(x);
    if (y !== null) return { x, y };
  }
  return null;
}

/** Move `cur` toward `target` by at most `step`. */
export function approach(cur: number, target: number, step: number): number {
  const d = target - cur;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}

/**
 * Which of the real body (-1) and the echoes (their index) a foe hunts. Each candidate is judged by its
 * distance times a guess: `rolls` are 0..1, one for the body then one per echo, and the guess is
 * 1 +- noise/2. The nearer wins. An echo beyond `range` is not seen. Equal-ish distances are settled by the
 * rolls; a clear difference is not.
 */
export function lureChoice(dReal: number, dEchoes: readonly number[], rolls: readonly number[], noise = TUNING.mirror.noise, range = TUNING.mirror.lureRange): number {
  const guess = (r: number): number => 1 + (r - 0.5) * noise;
  let best = -1;
  let bestScore = dReal * guess(rolls[0] ?? 0.5);
  for (let i = 0; i < dEchoes.length; i++) {
    const d = dEchoes[i];
    if (!(d >= 0) || d > range) continue;
    const score = d * guess(rolls[i + 1] ?? 0.5);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}
