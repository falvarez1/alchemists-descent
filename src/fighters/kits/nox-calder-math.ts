import type { DarkZone } from '@/core/types';

/**
 * NOX CALDER, the Lampblack: the pure rules (no engine imports beyond a type), so they are unit-tested
 * in node (tests/fighters-nox.test.ts) and the kit (nox-calder.ts) is only wiring. Every number the kit
 * reads is here, in one live-tunable object.
 *
 *  - Soot Sight: when she is in the dark or in smoke, foes within 160 cells are drawn as faint silhouettes.
 *  - Blackglass: a thrown canister (the Flask's bottle kinematics) bursts into a dense cloud of real Smoke
 *    cells that a vent keeps fed for a few seconds; cover is read off the Smoke cells around her.
 *  - Long Night: the lamps in 260 cells are snuffed and a large dark zone falls around her.
 */
export const TUNING = {
  soot: {
    id: 'soot-sight',
    /** Foes this close (cells, body centre to her eye) are shown. */
    range: 160,
    /** `lightQuery.darkness` above this counts as being in the dark. */
    darkness: 0.5,
    /** A (2 x boxR + 1) square of cells around her eye... */
    boxR: 4,
    /** ...holding at least this many Smoke cells counts as being in smoke. */
    smokeCells: 6,
    /** Ticks the sense must be lost for before it goes out (smoke flickers cell by cell). */
    offDelay: 14,
    /** The foes are looked over this often (ticks). */
    every: 3,
    /** How long a silhouette lasts past the last look (ticks): they leave promptly when she steps out. */
    hold: 7,
    /** The pulse that goes out when the sense comes on: ticks to reach `range`. */
    sweepTicks: 24,
    /** A foe is shown as the pulse passes it, and never again for this many ticks of rest (no re-pulsing in a flickering mist). */
    pulseRest: 150,
    /** Silhouette colour (a pale, cool white) and how bright it is near (k = 1) and at the edge of her sight. */
    rgb: [0.62, 0.68, 0.8] as readonly [number, number, number],
    nearK: 1,
    farK: 0.4,
    /** How many distinct brightness steps (each a shared tuple: a reveal's colour is stored per foe). */
    shades: 6,
  },
  glass: {
    id: 'blackglass',
    cooldown: 720,
    /** The Flask's own bottle (combat/Flask.ts): launch speed and gravity per tick. */
    speed: 6.5,
    gravity: 0.18,
    /** Bursts after this many ticks in the air if nothing was struck. */
    fuse: 45,
    /** How far along the aim the canister leaves her hand (the wand tip). */
    handReach: 9,
    /** A canister that would burst within this many cells of her hand is refused (a wall at her nose). */
    minRoom: 4,
    /** A foe's body is struck within this many cells of its box. */
    foePad: 1.5,
    cloud: {
      /** Cells written by the burst (a disc of radius ~20 in open air; fewer where rock takes the room). */
      cells: 1250,
      /** The cloud never reaches further than this from the burst, however it is boxed in. */
      reach: 34,
      /** Each cell's life in ticks (`world.life`): the cloud thins unevenly and is gone by itself. */
      lifeMin: 240,
      lifeMax: 420,
      /** The cloud blooms outward over this many ticks. */
      bloomTicks: 10,
      /** Then a vent keeps the nearest `ventCells` cells fed for this long, at most `ventPerTick` cells a tick. */
      ventTicks: 240,
      ventCells: 760,
      ventPerTick: 10,
    },
    cover: {
      /** The most the smoke alone will hide her. */
      max: 0.85,
      /** The box read around her chest: (2 x rx + 1) x (2 x ry + 1) cells. */
      rx: 7,
      ry: 9,
      /** Fraction of the open cells in the box that must be smoke for the first trace of cover, and for all of it. */
      lo: 0.12,
      hi: 0.5,
      /** A box with fewer open cells than this reads as if it had this many (a cramped crack cannot be "full"). */
      minOpen: 90,
      /** Cover rises quickly into the cloud and fades slowly out of it. */
      rise: 0.2,
      fall: 0.045,
    },
    /** Flame in the cloud: smoke within `radius` of a Fire / Lava / Ember cell burns away. */
    burn: { every: 3, radius: 2, chance: 0.6, cap: 500 },
  },
  night: {
    id: 'long-night',
    duration: 720,
    /** How unseen she is while it lasts. */
    concealment: 0.5,
    /** Lamps this close to her (cells) are snuffed. */
    lampRange: 260,
    /** Ticks from the press to the dark falling (the lamps are going out). */
    windup: 14,
    /** Each lamp goes out this many ticks later per cell of distance, over `fade` ticks. */
    wave: 0.1,
    fade: 10,
    /** The lamps come back over the last `dawn` ticks, nearest first, over `dawnFade` ticks each. */
    dawn: 40,
    dawnWave: 0.08,
    dawnFade: 12,
    zone: { rx: 210, ry: 130, strength: 1 },
    /** The dark's rim: a ring that goes out ahead of it. */
    ringReach: 190,
  },
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ======================================================================== cover (Blackglass)

/**
 * How unseen the smoke around her makes her: `smoke` Smoke cells in a box with `open` non-solid cells.
 * Nothing below `lo` of the open cells, everything at `hi`, a smooth climb between, never above `max`.
 */
export function smokeCover(smoke: number, open: number): number {
  const C = TUNING.glass.cover;
  const density = smoke / Math.max(open, C.minOpen);
  return C.max * smoothstep(C.lo, C.hi, density);
}

/** Cover eases up fast and down slowly, so a wisp of gap in the cloud does not flicker her sight line. */
export function easeCover(current: number, target: number): number {
  const C = TUNING.glass.cover;
  const k = target > current ? C.rise : C.fall;
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.004 ? target : next;
}

// ======================================================================== Soot Sight

/**
 * The sense's on/off: it comes on at once in the dark or in smoke, and goes out only after it has been
 * lost for `offDelay` ticks, so a cloud that flickers cell by cell does not strobe the silhouettes.
 */
export class SootSense {
  on = false;
  private lost = 0;

  /** Returns 1 on the tick it comes on, -1 on the tick it goes out, else 0. */
  update(darkness: number, smokeCells: number): -1 | 0 | 1 {
    const S = TUNING.soot;
    const sensed = darkness > S.darkness || smokeCells >= S.smokeCells;
    if (sensed) {
      this.lost = 0;
      if (!this.on) { this.on = true; return 1; }
      return 0;
    }
    if (!this.on) return 0;
    if (++this.lost >= S.offDelay) { this.on = false; this.lost = 0; return -1; }
    return 0;
  }

  reset(): void {
    this.on = false;
    this.lost = 0;
  }
}

/** 1 for a foe in her near sight, falling to `farK` at the edge of it (0 beyond). */
export function sightBrightness(dist: number): number {
  const S = TUNING.soot;
  if (dist > S.range) return 0;
  const t = smoothstep(S.range * 0.4, S.range, dist);
  return S.nearK + (S.farK - S.nearK) * t;
}

/** Quantise a brightness (farK..nearK) to one of `shades` steps, 0 = dimmest. */
export function shadeIndex(k: number): number {
  const S = TUNING.soot;
  const t = clamp((k - S.farK) / Math.max(1e-6, S.nearK - S.farK), 0, 1);
  return Math.min(S.shades - 1, Math.floor(t * S.shades));
}

/**
 * A straight sight line from (x0, y0) to (x1, y1) through the grid: false when anything solid stands
 * between. The last `skipEnd` cells are not tested, so a foe pressed against a wall is still seen.
 */
export function lineClear(
  solidAt: (x: number, y: number) => boolean,
  x0: number, y0: number, x1: number, y1: number,
  skipEnd = 3,
): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 1; i < steps - skipEnd; i++) {
    if (solidAt(Math.floor(x0 + (dx * i) / steps), Math.floor(y0 + (dy * i) / steps))) return false;
  }
  return true;
}

// ======================================================================== the canister

export interface Canister {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export interface CanisterBurst {
  /** The last free cell: where the smoke starts. */
  x: number;
  y: number;
  why: 'solid' | 'fuse' | 'foe' | 'bounds';
}

export function newCanister(x: number, y: number, angle: number): Canister {
  return { x, y, vx: Math.cos(angle) * TUNING.glass.speed, vy: Math.sin(angle) * TUNING.glass.speed, age: 0 };
}

/**
 * One tick of the canister's flight, the Flask's bottle (combat/Flask.ts flyBottle) step for step: gravity,
 * then sub-steps along the velocity so a fast one cannot tunnel a wall, bursting in the last free cell
 * before the first solid. Also bursts on a foe's body and when the fuse runs out. Returns where it burst,
 * or null while it flies.
 */
export function stepCanister(
  c: Canister,
  solidAt: (x: number, y: number) => boolean,
  inBounds: (x: number, y: number) => boolean,
  foeAt: ((x: number, y: number) => boolean) | null = null,
): CanisterBurst | null {
  c.vy += TUNING.glass.gravity;
  const steps = Math.max(1, Math.ceil(Math.hypot(c.vx, c.vy)));
  for (let s = 0; s < steps; s++) {
    const px = c.x, py = c.y;
    c.x += c.vx / steps;
    c.y += c.vy / steps;
    const gx = Math.floor(c.x), gy = Math.floor(c.y);
    if (!inBounds(gx, gy)) return { x: Math.floor(px), y: Math.floor(py), why: 'bounds' };
    if (solidAt(gx, gy)) return { x: Math.floor(px), y: Math.floor(py), why: 'solid' };
    if (foeAt && foeAt(gx, gy)) return { x: gx, y: gy, why: 'foe' };
  }
  c.age++;
  if (c.age >= TUNING.glass.fuse) return { x: Math.floor(c.x), y: Math.floor(c.y), why: 'fuse' };
  return null;
}

/** How many cells of room a throw has: marches the launch line and counts the free cells before a solid (up to `limit`). */
export function throwRoom(
  solidAt: (x: number, y: number) => boolean,
  x: number, y: number, dx: number, dy: number, limit: number,
): number {
  for (let d = 1; d <= limit; d++) {
    if (solidAt(Math.round(x + dx * d), Math.round(y + dy * d))) return d - 1;
  }
  return limit;
}

// ======================================================================== the cloud

/**
 * Plan a cloud: the cells it will fill, nearest the burst first. A 4-connected flood from (cx, cy) through
 * the open cells within `reach` (so smoke fills the room it is in, and does not leak through rock or a
 * one-cell crack), sorted by distance, the first `cells` kept with a ragged rim (the outer part of the
 * disc is kept less often, so the edge is a billow and not a ruled circle). In open air this is a disc of
 * radius about sqrt(cells / pi); in a corridor it runs along it up to `reach`.
 *
 * `rand` is the seeded stream (entityRandom in the game, a fixed sequence in tests).
 */
export function planCloud(
  openAt: (x: number, y: number) => boolean,
  cx: number, cy: number,
  rand: () => number,
  cells = TUNING.glass.cloud.cells,
  reach = TUNING.glass.cloud.reach,
): { xs: Int16Array; ys: Int16Array } {
  const side = reach * 2 + 1;
  const seen = new Uint8Array(side * side);
  const qx: number[] = [], qy: number[] = [];
  const found: Array<{ d2: number; x: number; y: number }> = [];
  const at = (x: number, y: number): number => (y - cy + reach) * side + (x - cx + reach);
  if (!openAt(cx, cy)) return { xs: new Int16Array(0), ys: new Int16Array(0) };
  seen[at(cx, cy)] = 1;
  qx.push(cx); qy.push(cy);
  for (let h = 0; h < qx.length; h++) {
    const x = qx[h], y = qy[h];
    found.push({ d2: (x - cx) * (x - cx) + (y - cy) * (y - cy), x, y });
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      const ddx = nx - cx, ddy = ny - cy;
      if (ddx * ddx + ddy * ddy > reach * reach) continue;
      const i = at(nx, ny);
      if (seen[i]) continue;
      seen[i] = 1;
      if (!openAt(nx, ny)) continue;
      qx.push(nx); qy.push(ny);
    }
  }
  found.sort((a, b) => a.d2 - b.d2);
  const rEst = Math.sqrt(cells / Math.PI);
  const xs: number[] = [], ys: number[] = [];
  for (const f of found) {
    if (xs.length >= cells) break;
    const t = Math.sqrt(f.d2) / rEst;
    // whole inside 70% of the disc; the rim is kept 1 time in 2 at the very edge
    const keep = t <= 0.7 ? 1 : Math.max(0.5, 1 - (t - 0.7) * 1.5);
    if (keep < 1 && rand() >= keep) continue;
    xs.push(f.x); ys.push(f.y);
  }
  return { xs: Int16Array.from(xs), ys: Int16Array.from(ys) };
}

/** How many of the planned cells have been written `t` ticks into the bloom (a fast start that settles). */
export function bloomCount(total: number, t: number): number {
  const u = clamp(t / TUNING.glass.cloud.bloomTicks, 0, 1);
  return Math.ceil(total * (1 - (1 - u) * (1 - u)));
}

/** The box a cloud's smoke can be in `age` ticks after the burst: it rises about half a cell a tick and never leaves the reach sideways. */
export function cloudBox(x: number, y: number, age: number): { x0: number; y0: number; x1: number; y1: number } {
  const R = TUNING.glass.cloud.reach;
  const rise = Math.min(360, Math.ceil(age * 0.6) + R);
  return { x0: x - R - 6, x1: x + R + 6, y0: y - rise, y1: y + R };
}

// ======================================================================== Long Night

/** 1 = lit .. 0 = out, for a lamp `dist` cells away, `t` ticks after the press: the nearest go out first. */
export function duskLevel(t: number, dist: number): number {
  const N = TUNING.night;
  const u = (t - dist * N.wave) / N.fade;
  return u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
}

/** 0 = out .. 1 = lit, for a lamp `dist` cells away, `t` ticks after the dawn began. */
export function dawnLevel(t: number, dist: number): number {
  const N = TUNING.night;
  const u = (t - dist * N.dawnWave) / N.dawnFade;
  return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
}

/** The zone that falls around (x, y). */
export function nightZone(x: number, y: number): DarkZone {
  const Z = TUNING.night.zone;
  return { x, y, rx: Z.rx, ry: Z.ry, strength: Z.strength, shape: 'ellipse' };
}

/**
 * The zone list with the night's zone added, as a NEW array: the bake keys on the array's identity
 * (core/darkness darkMapFor), so mutating the level's own array would never be noticed.
 */
export function withZone(original: readonly DarkZone[] | undefined, zone: DarkZone): DarkZone[] {
  return [...(original ?? []), zone];
}
