import type { EnemyKind } from '@/core/types';

/**
 * MARA QUELL's rules as plain functions and small state machines, so the maths can be tested in node
 * without a world: how a foe's footfalls are told apart (Keen Resonance), where a bell may hang and how
 * the pair of bells is kept (Resonance Bell), how the Dead Chime's wave grows and who it touches.
 * Everything that touches the engine (the grid, the foes, the sounds, the drawing) is in `mara-quell.ts`
 * and `mara-quell-draw.ts`. All times are fixed ticks (60 Hz); distances are cells.
 */

export const TUNING = {
  /** Keen Resonance: foes that walk, climb or land out of her sight line. */
  resonance: {
    /** How far she feels a footfall. */
    range: 200,
    /** Ticks between ripples while a foe keeps moving. */
    every: 14,
    /** A ripple's life. */
    life: 54,
    /** Smoothed cells/tick a foe must be making to count as walking (a golem's slow plod is ~0.25). */
    minSpeed: 0.08,
    /** Smoothing of the measured speed (a foe's position moves in whole cells). */
    smooth: 0.15,
    /** Ticks in the air before a touchdown counts as a landing (not a stair-step). */
    landAir: 4,
    /** More than this many cells in one tick is a jump of the record (a foe came into range, was thrown), not a stride. */
    maxStride: 12,
    /** Brightness of a ripple at the edge of her range (1 at point blank). */
    faint: 0.16,
    /** Most ripples alive at once (the oldest is dropped). */
    maxRipples: 40,
    /** A foe not felt for this long is "new" again and may ping. */
    newAfter: 240,
    /** At most one ping this often (ticks), and its loudness before distance scales it. */
    pingGap: 150,
    pingGain: 0.34,
  },
  /** Resonance Bell (Z). */
  bell: {
    cooldown: 14 * 60,
    /** Bells out at once: the third retires the oldest. */
    max: 2,
    lifetime: 30 * 60,
    /** The farthest from her a bell may be hung. */
    reach: 70,
    /** A cursor nearer than this means "at my feet". */
    feetRadius: 10,
    /** How far from where she aims the spot search may wander. */
    search: 14,
    /** A foe this close (centre to centre) rings it. */
    triggerRadius: 70,
    /** Every foe this close to the bell is shown when it rings. */
    revealRadius: 100,
    revealTicks: 4 * 60,
    /** After ringing it is deaf for this long. */
    rearm: 6 * 60,
    /** A new bell swings still for this long before it listens. */
    settle: 18,
    /** The fade of a bell being retired (a third placed, its lifetime out, its support dug away). */
    retireTicks: 26,
    /** The ring's pulse and the light that goes with it. */
    ringTicks: 30,
    lightTicks: 34,
    /** How often the support under a bell is looked at. */
    supportEvery: 10,
  },
  /** Dead Chime (T). */
  chime: {
    radius: 150,
    expandTicks: 20,
    slowFactor: 0.45,
    slowTicks: 6 * 60,
    stunTicks: 3 * 60,
    /** The ultimate's own clock = the slow's, so the chip shows the effect running. */
    duration: 6 * 60,
    /** The wave's light, for as long as it is going. */
    lightTicks: 30,
  },
} as const;

/** Violet, as the reveal outline and every ring of hers are drawn. */
export const PURPLE: readonly [number, number, number] = [0.66, 0.38, 1.0];

// ------------------------------------------------------------------------------------------ kinds

/** Foes whose boots do not make footfalls: they fly, hover or are a clutch of eggs. */
const NO_FOOTFALL: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['bat', 'imp', 'wisp', 'eggs', 'lenswright']);
/** Casters and machines the Dead Chime stuns as well as slows. */
const CASTERS: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['mage', 'spitter', 'wisp', 'bomber']);
/**
 * Foes the Dead Chime leaves alone: the bosses (their phases and their locomotion are authored; a
 * stunned one would wedge) and the egg clutch (it does not move, and "destroy it or it hatches" is
 * somebody else's rule). Nothing she does may change what a gate asks of the player.
 */
const CHIME_EXEMPT: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['colossus', 'leviathan', 'rimewarden', 'lenswright', 'eggs']);

export function makesFootfalls(kind: EnemyKind): boolean {
  return !NO_FOOTFALL.has(kind);
}

export interface ChimeEffect {
  slow: boolean;
  stun: boolean;
}

export function chimeEffectFor(kind: EnemyKind): ChimeEffect {
  if (CHIME_EXEMPT.has(kind)) return { slow: false, stun: false };
  return { slow: true, stun: CASTERS.has(kind) };
}

// ------------------------------------------------------------------------------------- Keen Resonance

export type FootEvent = 'step' | 'land' | null;

/** What is remembered of one foe's feet between ticks. */
export interface FootTrack {
  x: number;
  y: number;
  /** Smoothed cells moved per tick. */
  speed: number;
  /** Ticks until the next ripple may be made. */
  cooldown: number;
  /** Consecutive ticks off a surface. */
  air: number;
  onSurface: boolean;
  /** The frame of the last ripple (for the "new foe" ping). */
  last: number;
}

export function newFootTrack(x: number, y: number, onSurface: boolean): FootTrack {
  return { x, y, speed: 0, cooldown: 0, air: 0, onSurface, last: -100000 };
}

/**
 * One tick of a foe's feet. 'land' is a touchdown after a real fall or hop; 'step' is a foe that keeps
 * walking or climbing, once per `every` ticks. A foe that stands, hangs in the air or is held still
 * makes nothing. `onSurface` is true on the ground, and for a crawler on a wall or ceiling.
 */
export function stepFoot(t: FootTrack, x: number, y: number, onSurface: boolean): FootEvent {
  const R = TUNING.resonance;
  const jump = Math.hypot(x - t.x, y - t.y);
  // A foe not watched for a while (out of her range) or thrown across the room has not "walked" that far.
  const moved = jump > R.maxStride ? 0 : jump;
  t.x = x;
  t.y = y;
  t.speed += (moved - t.speed) * R.smooth;
  if (t.cooldown > 0) t.cooldown--;
  let ev: FootEvent = null;
  if (onSurface) {
    if (!t.onSurface && t.air >= R.landAir) {
      ev = 'land';
      t.cooldown = R.every;
    }
    t.air = 0;
  } else t.air++;
  t.onSurface = onSurface;
  if (ev === null && onSurface && t.speed >= R.minSpeed && t.cooldown <= 0) {
    ev = 'step';
    t.cooldown = R.every;
  }
  return ev;
}

/** 1 at point blank, `faint` at the edge of her range: nearer is brighter. */
export function ripplePower(distance: number): number {
  const R = TUNING.resonance;
  const u = Math.min(1, Math.max(0, distance / R.range));
  return R.faint + (1 - R.faint) * Math.pow(1 - u, 1.4);
}

export interface Ripple {
  x: number;
  y: number;
  born: number;
  power: number;
  /** A landing: wider and a little brighter than a step. */
  big: boolean;
}

/** An ellipse on the ground (rx wide, ry deep) and how bright, or null once it has faded. */
export function rippleShape(r: Ripple, now: number): { rx: number; ry: number; a: number } | null {
  const age = now - r.born;
  const life = TUNING.resonance.life;
  if (age < 0 || age >= life) return null;
  const u = age / life;
  const open = 1 - (1 - u) * (1 - u);
  const rx = (r.big ? 4 : 3) + (r.big ? 20 : 14) * open;
  return { rx, ry: rx * 0.34, a: r.power * (r.big ? 1.25 : 1) * Math.pow(1 - u, 1.5) };
}

/** The live ripples, oldest first, capped. Ripples are only ever made from a foe's own feet. */
export class RippleBook {
  readonly list: Ripple[] = [];
  /** How many have ever been made (the probe counts births, not what is left on screen). */
  births = 0;

  add(x: number, y: number, now: number, power: number, big: boolean): Ripple {
    const r: Ripple = { x, y, born: now, power, big };
    this.list.push(r);
    this.births++;
    if (this.list.length > TUNING.resonance.maxRipples) this.list.shift();
    return r;
  }

  prune(now: number): void {
    const life = TUNING.resonance.life;
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      if (now - this.list[i].born < life) this.list[w++] = this.list[i];
    }
    this.list.length = w;
  }

  clear(): void {
    this.list.length = 0;
  }
}

// ------------------------------------------------------------------------------------ Resonance Bell

export type BellMode = 'post' | 'hang';

/** Where a bell hangs and what of the grid it needs. `cx, cy` is the middle of the bell itself. */
export interface BellSpot {
  mode: BellMode;
  /** The anchor: the cell above the floor a post stands on, or the first open cell under the ceiling it hangs from. */
  x: number;
  y: number;
  /** Which way a post's arm reaches. */
  side: 1 | -1;
  cx: number;
  cy: number;
  /** The row of the bell's crown (its body is 9 rows). */
  top: number;
}

export interface SpotProbe {
  /** Rock, metal, anything a body cannot enter; out of bounds counts. */
  solid(x: number, y: number): boolean;
  /** A cell a bell may occupy: not solid and not liquid. */
  open(x: number, y: number): boolean;
}

/** The bell's body, rows top..top+8, 7 wide. */
export const BELL_ROWS = 9;
export const BELL_HALF_W = 3;
/** A post's height above the floor row, and how far its arm reaches. */
export const POST_H = 13;
export const ARM_LEN = 5;
/** A ceiling mount: links of chain between the plate and the crown. */
export const CHAIN_LEN = 3;

function boxOpen(p: SpotProbe, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!p.open(x, y)) return false;
  return true;
}

/** A bracket post standing on the floor at (x, y), its arm reaching `side`. Null when it will not fit. */
export function postSpot(p: SpotProbe, x: number, y: number, side: 1 | -1): BellSpot | null {
  if (!p.open(x, y) || !p.solid(x, y + 1)) return null;
  if (!boxOpen(p, x, y - POST_H, x, y)) return null; // the post
  const cx = x + side * ARM_LEN;
  const lo = Math.min(x, cx), hi = Math.max(x, cx);
  if (!boxOpen(p, lo, y - POST_H, hi, y - POST_H)) return null; // the arm
  const top = y - POST_H + 2;
  if (!boxOpen(p, cx - BELL_HALF_W, top - 1, cx + BELL_HALF_W, top + BELL_ROWS - 1)) return null; // chain and bell
  return { mode: 'post', x, y, side, cx, cy: top + 4, top };
}

/** A bell on a short chain from the ceiling over (x, y): (x, y - 1) is rock, (x, y) the first open cell. */
export function hangSpot(p: SpotProbe, x: number, y: number): BellSpot | null {
  if (!p.open(x, y) || !p.solid(x, y - 1)) return null;
  const top = y + CHAIN_LEN + 1;
  if (!boxOpen(p, x, y, x, top - 1)) return null; // the chain
  if (!boxOpen(p, x - BELL_HALF_W, top, x + BELL_HALF_W, top + BELL_ROWS - 1)) return null;
  return { mode: 'hang', x, y, side: 1, cx: x, cy: top + 4, top };
}

/** A straight line between two cells that never crosses rock (the spot must be reachable from where she aimed). */
export function lineOpen(p: SpotProbe, x0: number, y0: number, x1: number, y1: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 1; i < steps; i++) {
    if (p.solid(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps))) return false;
  }
  return true;
}

export interface SpotQuery {
  /** The farthest the bell's middle may be from (tx, ty). */
  search: number;
  /** The side a post prefers (the way she faces). */
  prefSide: 1 | -1;
  /** A last say: within her reach, in sight of where she aimed. */
  accept?(s: BellSpot): boolean;
}

/**
 * The open place nearest (tx, ty) where a bell will hang: a post on the floor or a chain from the
 * ceiling, whichever puts the bell's middle closer to the aim. Deterministic: ties go to the post, then
 * to the preferred side, then to the scan order.
 */
export function findBellSpot(p: SpotProbe, tx: number, ty: number, q: SpotQuery): BellSpot | null {
  const reach = Math.ceil(q.search) + POST_H;
  const bx = Math.round(tx), by = Math.round(ty);
  let best: BellSpot | null = null;
  let bestD = Infinity;
  let bestRank = Infinity;
  // Closer wins; a tie goes to a post over a chain, then to the side she faces; after that the scan order.
  const consider = (s: BellSpot | null): void => {
    if (!s) return;
    const d = Math.hypot(s.cx - tx, s.cy - ty);
    if (d > q.search || d > bestD + 1e-9) return;
    const rank = (s.mode === 'post' ? 0 : 2) + (s.side === q.prefSide ? 0 : 1);
    if (d >= bestD - 1e-9 && rank >= bestRank) return;
    if (q.accept && !q.accept(s)) return;
    best = s;
    bestD = d;
    bestRank = rank;
  };
  const other: 1 | -1 = q.prefSide === 1 ? -1 : 1;
  for (let y = by - reach; y <= by + reach; y++) {
    for (let x = bx - reach; x <= bx + reach; x++) {
      if (!p.open(x, y)) continue;
      if (p.solid(x, y + 1)) {
        consider(postSpot(p, x, y, q.prefSide));
        consider(postSpot(p, x, y, other));
      }
      if (p.solid(x, y - 1)) consider(hangSpot(p, x, y));
    }
  }
  return best;
}

/** How far to place: the cursor's distance, within her reach. A cursor at her feet means "here". */
export function aimDistance(cursorDistance: number): number {
  const B = TUNING.bell;
  if (!Number.isFinite(cursorDistance)) return B.reach;
  return Math.min(B.reach, Math.max(0, cursorDistance));
}

export interface Bell extends BellSpot {
  id: number;
  born: number;
  expires: number;
  /** It listens from this frame on (a new bell swings still first). */
  armedAt: number;
  /** ... and again from this frame on after it has rung. */
  rearmAt: number;
  /** The frame it last rang (-1000 = never). */
  rungAt: number;
  /** The frame it began to be retired, or -1 while it stands. */
  retiredAt: number;
}

export type BellEnd = 'replaced' | 'expired' | 'fell' | 'cleared';

/** The pair of bells and their clocks: pure bookkeeping, no world. */
export class BellBook {
  readonly bells: Bell[] = [];
  private nextId = 1;

  /** The bells that still stand (a retiring one is on its way out and listens to nothing). */
  live(): Bell[] {
    return this.bells.filter((b) => b.retiredAt < 0);
  }

  count(): number {
    let n = 0;
    for (const b of this.bells) if (b.retiredAt < 0) n++;
    return n;
  }

  /** Hang a bell; when two already stand the oldest is retired and returned. */
  place(spot: BellSpot, now: number): { bell: Bell; retired: Bell | null } {
    const B = TUNING.bell;
    let retired: Bell | null = null;
    const standing = this.live();
    if (standing.length >= B.max) {
      retired = standing[0];
      retired.retiredAt = now;
    }
    const bell: Bell = {
      ...spot, id: this.nextId++, born: now, expires: now + B.lifetime,
      armedAt: now + B.settle, rearmAt: now + B.settle, rungAt: -1000, retiredAt: -1,
    };
    this.bells.push(bell);
    return { bell, retired };
  }

  retire(bell: Bell, now: number): void {
    if (bell.retiredAt < 0) bell.retiredAt = now;
  }

  /** Bells whose time is up are retired (returned, for their farewell); finished retirements are dropped. */
  tick(now: number): Bell[] {
    const out: Bell[] = [];
    for (const b of this.bells) {
      if (b.retiredAt < 0 && now >= b.expires) {
        b.retiredAt = now;
        out.push(b);
      }
    }
    const keep = TUNING.bell.retireTicks;
    let w = 0;
    for (let i = 0; i < this.bells.length; i++) {
      const b = this.bells[i];
      if (b.retiredAt < 0 || now - b.retiredAt < keep) this.bells[w++] = b;
    }
    this.bells.length = w;
    return out;
  }

  listening(b: Bell, now: number): boolean {
    return b.retiredAt < 0 && now >= b.armedAt && now >= b.rearmAt;
  }

  ring(b: Bell, now: number): void {
    b.rungAt = now;
    b.rearmAt = now + TUNING.bell.rearm;
  }

  clear(): void {
    this.bells.length = 0;
  }
}

/** True when a foe at (fx, fy) is within `r` of the bell's middle. */
export function within(bell: { cx: number; cy: number }, fx: number, fy: number, r: number): boolean {
  const dx = fx - bell.cx, dy = fy - bell.cy;
  return dx * dx + dy * dy <= r * r;
}

/** 1 at the moment of ringing, easing to 0 over `ringTicks`; the swing of the bell and the brightness of its ring. */
export function ringAge(bell: Bell, now: number): number {
  return now - bell.rungAt;
}

/** The bell's visible life: 1 while it stands, fading over its last second and over a retirement. */
export function bellVisibility(bell: Bell, now: number): number {
  const B = TUNING.bell;
  if (bell.retiredAt >= 0) return Math.max(0, 1 - (now - bell.retiredAt) / B.retireTicks);
  const left = bell.expires - now;
  return left >= 90 ? 1 : Math.max(0, left / 90);
}

// -------------------------------------------------------------------------------------- Dead Chime

/** The wave's radius `elapsed` ticks after the strike: fast at first, easing to its full reach. */
export function waveRadius(elapsed: number): number {
  const C = TUNING.chime;
  const u = Math.min(1, Math.max(0, elapsed / C.expandTicks));
  return C.radius * (1 - Math.pow(1 - u, 1.7));
}
