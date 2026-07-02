// ===================== Weaver locomotion (surface crawler) =====================
// The Weaver is not a gravity box with painted legs — it is a SURFACE CRAWLER.
// One model owns body position, orientation and feet, at tick rate:
//
//   - The body is suspended from planted feet. Feet grip real cells (solids or
//     soft growth/webs). While attached, gravity is irrelevant: the body rides
//     a spring above a surface anchor S that slides along the terrain contour.
//   - Movement is marching S along the contour ("advance + re-snap"): walk a
//     floor, up a wall, across a ceiling, around a platform lip — one code
//     path, no climb/crest/dismount special cases.
//   - Crossing open space is a deliberate ballistic LEAP (real integration,
//     knockback composes); any surface a leg can catch re-attaches it.
//   - If the terrain under it is destroyed (web burned, floor dug away) the
//     grip is genuinely gone: it detaches and falls. The grid explains it.
//
// The renderer draws this state; it never decides where feet go.
//
// Frames and conventions (screen y grows DOWN):
//   normal N = unit vector out of the surface into the air.
//   tangent basis T = rotate90CW(N): floor N=(0,-1) -> T=(+1,0); a wall to the
//     body's right N=(-1,0) -> T=(0,-1) i.e. up-screen. One consistent winding.
//   dir  = crawl direction along T (+1 follows T, -1 opposes it).
//   face = which way the head points along T, same ±1 space as dir.
//   arc offsets (leg rests) are in the FACING frame: positive = toward the head.

import { clamp, lerp } from '@/core/math';
import type { Ctx, Enemy, EnemyDef, WeaverIntent, WeaverLegState, WeaverLocoState } from '@/core/types';
import { blocksEntity, Cell, isSoftGrowth } from '@/sim/CellType';

// ---------------------------------------------------------------- tuning ----
const RIDE_HEIGHT = 11.5; // preferred body height above the surface (tall stance)
const RIDE_MIN = 4; // squeezed through a tight tunnel
const BODY_HALF_W = 5; // compact core box used for airborne collision
const BODY_H = 9;
const SNAP_RADIUS = 5; // how far the anchor re-snap searches for the surface
const ATTACH_RADIUS = 16; // how far a falling body's legs can catch a surface (leg reach, not body size)
const DETACH_GRACE = 8; // ticks without any grip before it truly falls
const GRAVITY = 0.32; // matches the walker integrator it replaced
const MAX_FALL = 3.2;
const LEAP_NO_GRAB = 9; // a fresh leap must actually leave the wall
const SPRING_K = 0.26; // body spring toward the ride point
const SPRING_DAMP = 0.62;
const MAX_BODY_LAG = 7; // body may trail the anchor at most this far
const ACCEL = 0.085; // arc-speed easing toward the commanded speed
const BASE_SPEED = 0.62; // calm crawl (cells/tick)
const URGENT_SPEED = 2.6; // flat-out cranky pursuit (pre difficulty/pacing scale)
const WEB_SPEED_BONUS = 0.3; // webs under the feet are a highway
const CONTOUR_SPAN = 40; // sampled contour half-length (cells of arc)
const NAV_COMMIT_TICKS = 26; // direction hysteresis: how long a choice is latched
const NAV_SWITCH_MARGIN = 0.86; // other dir must beat this fraction of current score
// Deep probe: when the greedy window sees no approach (the route gets worse
// before it gets better — around a platform lip, over a crest), march much
// farther and trust the direction whose FULL path comes closest. Refreshed on
// a cadence, so the expensive march isn't paid every tick.
const DEEP_SPAN = 200;
const DEEP_REFRESH_TICKS = 12;
const STEP_DEADBAND = 3.4; // a planted foot tolerates this much displacement
const SWING_MIN_TICKS = 4;
const SWING_MAX_TICKS = 9;
const MAX_AIRBORNE_LEGS = 4; // gait may not lift more than half the legs
const LEG_PLANT_MIN = 2; // fewer planted than this (and no surface) = falling

// Rest pose in the surface frame: arc = offset along the contour (positive =
// toward the head), hipOut = hip height above the feet line. Mirrors the
// renderer's classic splayed stance so the silhouette carries over.
interface LegRest {
  arc: number;
  hipArc: number;
  hipOut: number;
  group: 0 | 1;
  ripple: number;
}
// Wide, splayed fan (reference art: long needle legs dwarfing a compact
// body) — feet plant far out; generous slack keeps the bones long and the
// knees arched high instead of the old bunched, stubby stance.
// TENT stance (reference art): feet plant FAR out in a wide fan; moderate
// slack plus an up-pole spends the extra bone length on knee height, so the
// knees arch above the compact body instead of the legs bunching into columns.
export const WEAVER_LOCO_REST: readonly LegRest[] = [
  { arc: -30, hipArc: -6, hipOut: 15, group: 0, ripple: 0.0 },
  { arc: -37, hipArc: -9, hipOut: 13, group: 1, ripple: Math.PI },
  { arc: -44, hipArc: -9, hipOut: 10, group: 0, ripple: Math.PI * 0.5 },
  { arc: -35, hipArc: -6, hipOut: 7, group: 1, ripple: Math.PI * 1.5 },
  { arc: 30, hipArc: 6, hipOut: 15, group: 1, ripple: Math.PI },
  { arc: 37, hipArc: 9, hipOut: 13, group: 0, ripple: 0.0 },
  { arc: 44, hipArc: 9, hipOut: 10, group: 1, ripple: Math.PI * 1.5 },
  { arc: 35, hipArc: 6, hipOut: 7, group: 0, ripple: Math.PI * 0.5 },
];
export const WEAVER_LEG_REACH_LOCO = WEAVER_LOCO_REST.map((r) =>
  Math.hypot(r.arc - r.hipArc, r.hipOut) * 1.5,
);

// ------------------------------------------------------------- predicates ----
export function weaverGrips(t: number): boolean {
  return blocksEntity(t) || isSoftGrowth(t) || t === Cell.Slime;
}

function gripAt(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  if (x < 1 || x >= w.width - 1 || y < 1 || y >= w.height - 1) return false;
  return weaverGrips(w.types[x + y * w.width]);
}

function lethalAt(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return false;
  const t = w.types[w.idx(x, y)];
  return t === Cell.Fire || t === Cell.Lava || t === Cell.Acid || t === Cell.Toxic;
}

/** Occupancy gradient over a 5x5: points AWAY from solid mass (out of the
 *  surface, into the air). Near-zero magnitude = enclosed or straddling
 *  (chimney) — the caller keeps its previous normal (hysteresis). */
function surfaceNormal(ctx: Ctx, x: number, y: number): { nx: number; ny: number; mag: number } {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let gx = 0;
  let gy = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (gripAt(ctx, cx + dx, cy + dy)) {
        const inv = 1 / (dx * dx + dy * dy);
        gx -= dx * inv;
        gy -= dy * inv;
      }
    }
  }
  const mag = Math.hypot(gx, gy);
  if (mag < 0.001) return { nx: 0, ny: -1, mag: 0 };
  return { nx: gx / mag, ny: gy / mag, mag };
}

interface SurfaceSnap {
  sx: number; // surface point: just off the grip cell's exposed face
  sy: number;
  gx: number; // the grip cell itself
  gy: number;
  d: number;
}

/** Nearest grip cell with an exposed face, spiralling out from (x, y).
 *  `alignN` biases the search toward surfaces facing the way the body already
 *  faces — this keeps a chimney climb on ONE wall instead of zig-zagging.
 *  `avoid` penalizes re-snapping to where the march just was, so silk bumps
 *  and rough cells can't ping-pong the contour in place. */
function snapToSurface(
  ctx: Ctx,
  x: number,
  y: number,
  maxR: number,
  alignNx = 0,
  alignNy = 0,
  avoidX = Infinity,
  avoidY = Infinity,
): SurfaceSnap | null {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best: SurfaceSnap | null = null;
  let bestScore = Infinity;
  const rMax = Math.ceil(maxR);
  for (let r = 0; r <= rMax; r++) {
    // alignment bonus is bounded by 1.4, so once the closest possible ring
    // distance can no longer win even with full bonus, stop.
    if (best && bestScore + 1.4 < (r - 1) * (r - 1)) break;
    for (let dy = -r; dy <= r; dy++) {
      const ax = r - Math.abs(dy);
      for (let s = ax === 0 ? 0 : -1; s <= 1; s += 2) {
        const dx = s * ax;
        const gx = cx + dx;
        const gy = cy + dy;
        if (!gripAt(ctx, gx, gy)) continue;
        if (gripAt(ctx, gx, gy - 1) && gripAt(ctx, gx, gy + 1) && gripAt(ctx, gx - 1, gy) && gripAt(ctx, gx + 1, gy)) {
          if (ax === 0) break;
          continue; // buried — not a surface
        }
        const consider = (fx: number, fy: number): void => {
          const px = gx + 0.5 + fx * 0.6;
          const py = gy + 0.5 + fy * 0.6;
          const ddx = px - x;
          const ddy = py - y;
          let score = ddx * ddx + ddy * ddy - (fx * alignNx + fy * alignNy) * 1.4;
          if (avoidX !== Infinity) {
            const back = Math.hypot(px - avoidX, py - avoidY);
            if (back < 1.2) score += (1.2 - back) * 5;
          }
          if (score < bestScore) {
            bestScore = score;
            best = { sx: px, sy: py, gx, gy, d: Math.sqrt(ddx * ddx + ddy * ddy) };
          }
        };
        if (!gripAt(ctx, gx, gy - 1)) consider(0, -1);
        if (!gripAt(ctx, gx, gy + 1)) consider(0, 1);
        if (!gripAt(ctx, gx - 1, gy)) consider(-1, 0);
        if (!gripAt(ctx, gx + 1, gy)) consider(1, 0);
        if (ax === 0) break;
      }
    }
  }
  return best;
}

// ------------------------------------------------------- contour sampling ----
export interface ContourSample {
  x: number;
  y: number;
  nx: number;
  ny: number;
  lethal: boolean;
  web: boolean;
}

function tangentOf(nx: number, ny: number, dir: 1 | -1): { tx: number; ty: number } {
  return { tx: -ny * dir, ty: nx * dir };
}

/** March along the surface from (x,y,n) in `dir`, re-snapping each substep.
 *  Fills `out` with one sample per ~1 cell of arc (mutating pooled entries).
 *  Stops at a gap (no surface within snap radius) or a lethal surface. */
export function marchContour(
  ctx: Ctx,
  x: number,
  y: number,
  nx: number,
  ny: number,
  dir: 1 | -1,
  maxCells: number,
  out: ContourSample[],
): { count: number; endedAtGap: boolean; endedAtLethal: boolean } {
  let px = x;
  let py = y;
  let prev1X = Infinity; // last two march positions: revisiting either one
  let prev1Y = Infinity; // means a bump/corner cycle, not progress
  let prev2X = Infinity;
  let prev2Y = Infinity;
  let cnx = nx;
  let cny = ny;
  let count = 0;
  const w = ctx.world;
  for (let i = 0; i < maxCells; i++) {
    const { tx, ty } = tangentOf(cnx, cny, dir);
    // one march substep: snap the candidate, refresh the normal, re-seat
    const attempt = (
      mult: number,
    ): { snap: SurfaceSnap; nx2: number; ny2: number; anx: number; any: number } | null => {
      const snap = snapToSurface(ctx, px + tx * mult, py + ty * mult, 3.2, cnx, cny, prev1X, prev1Y);
      if (!snap) return null;
      const grad = surfaceNormal(ctx, snap.sx, snap.sy);
      // ambiguous gradient (chimney): keep marching with the previous normal
      const anx = grad.mag >= 0.35 ? grad.nx : cnx;
      const any = grad.mag >= 0.35 ? grad.ny : cny;
      return { snap, nx2: snap.sx + anx * 0.4, ny2: snap.sy + any * 0.4, anx, any };
    };
    const stalled = (qx: number, qy: number): boolean =>
      Math.hypot(qx - px, qy - py) < 0.2 ||
      Math.hypot(qx - prev1X, qy - prev1Y) < 0.45 ||
      Math.hypot(qx - prev2X, qy - prev2Y) < 0.45;
    let step = attempt(1);
    if (!step) return { count, endedAtGap: true, endedAtLethal: false };
    if (stalled(step.nx2, step.ny2)) {
      // Fixed point or bump cycle (a convex corner whose diagonal normal
      // re-snaps to itself; silk/rubble bumps that ping-pong the snap):
      // push a double step to jump past it. Still pinned = a real dead end.
      step = attempt(2.2);
      if (!step) return { count, endedAtGap: true, endedAtLethal: false };
      if (stalled(step.nx2, step.ny2)) {
        return { count, endedAtGap: true, endedAtLethal: false };
      }
    }
    const snap = step.snap;
    cnx = step.anx;
    cny = step.any;
    prev2X = prev1X;
    prev2Y = prev1Y;
    prev1X = px;
    prev1Y = py;
    px = step.nx2;
    py = step.ny2;
    const t = w.types[w.idx(snap.gx, snap.gy)];
    const lethal =
      lethalAt(ctx, snap.gx, snap.gy) || lethalAt(ctx, Math.round(px), Math.round(py));
    const web = isSoftGrowth(t) || t === Cell.Slime;
    let sample = out[count];
    if (!sample) {
      sample = { x: 0, y: 0, nx: 0, ny: 0, lethal: false, web: false };
      out[count] = sample;
    }
    sample.x = px;
    sample.y = py;
    sample.nx = cnx;
    sample.ny = cny;
    sample.lethal = lethal;
    sample.web = web;
    count++;
    if (lethal) return { count, endedAtGap: false, endedAtLethal: true };
  }
  return { count, endedAtGap: false, endedAtLethal: false };
}

// ------------------------------------------------------------- leg helpers ----
function makeLeg(): WeaverLegState {
  return {
    x: 0,
    y: 0,
    planted: false,
    stepT: -1,
    fromX: 0,
    fromY: 0,
    targetX: 0,
    targetY: 0,
    lift: 0,
    strain: 0,
  };
}

export function makeWeaverLoco(x: number, y: number): WeaverLocoState {
  return {
    mode: 'airborne',
    px: x,
    py: y - BODY_H,
    vx: 0,
    vy: 0,
    fx: 0,
    fy: 0,
    sx: x,
    sy: y,
    nx: 0,
    ny: -1,
    orient: 0,
    dir: 1,
    face: 1,
    speed: 0,
    stride: 0,
    ride: RIDE_HEIGHT,
    fallT: 0,
    recoverT: 0,
    leapT: 0,
    navCommit: 0,
    blocked: 0,
    detachGrace: 0,
    webGrip: 0,
    gapAhead: 0,
    deepDir: 1,
    deepBest: Infinity,
    deepArc: 0,
    deepAge: 999,
    deepHold: 0,
    legs: Array.from({ length: WEAVER_LOCO_REST.length }, makeLeg),
    ex: x,
    ey: y,
  };
}

function plantedCount(loco: WeaverLocoState): number {
  let n = 0;
  for (const leg of loco.legs) if (leg.planted) n++;
  return n;
}

/** Verify a planted foot still has grip within a whisker of its anchor. */
function footStillGrips(ctx: Ctx, x: number, y: number): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (gripAt(ctx, cx + dx, cy + dy)) return true;
    }
  }
  return false;
}

/** Hip world position, built from the surface frame (tangent/normal), so it
 *  can never disagree with where the feet actually are. */
export function weaverHipWorld(loco: WeaverLocoState, i: number): { x: number; y: number } {
  const rest = WEAVER_LOCO_REST[i];
  const { tx, ty } = tangentOf(loco.nx, loco.ny, 1);
  const along = rest.hipArc * loco.face;
  const outw = rest.hipOut - loco.ride; // hips sit around the body centre
  return {
    x: loco.px + tx * along + loco.nx * outw,
    y: loco.py + ty * along + loco.ny * outw,
  };
}

// --------------------------------------------------------------- the tick ----
const CONTOUR_A: ContourSample[] = [];
const CONTOUR_B: ContourSample[] = [];
const DEEP_SCRATCH: ContourSample[] = [];

/** March far in both directions and report which one's full path comes
 *  closest to (tx, ty). This is what routes a crawl AROUND obstacles whose
 *  contour initially leads away from the target. */
function deepProbe(
  ctx: Ctx,
  loco: WeaverLocoState,
  tx: number,
  ty: number,
): { dir: 1 | -1; best: number; arc: number } {
  let bestDir: 1 | -1 = loco.dir;
  let best = Infinity;
  let bestArc = 0;
  for (const dir of [loco.dir, (loco.dir * -1) as 1 | -1]) {
    const res = marchContour(ctx, loco.sx, loco.sy, loco.nx, loco.ny, dir, DEEP_SPAN, DEEP_SCRATCH);
    for (let i = 0; i < res.count; i++) {
      const s = DEEP_SCRATCH[i];
      if (s.lethal) break;
      const d = Math.hypot(tx - s.x, ty - s.y);
      if (d < best) {
        best = d;
        bestDir = dir;
        bestArc = i;
      }
    }
  }
  return { dir: bestDir, best, arc: bestArc };
}

export interface WeaverLocoReadout {
  /** ticks the commanded direction has made no real progress */
  blocked: number;
  /** arc distance to the gap/lethal edge ahead in the crawl dir (0 = none) */
  gapAhead: number;
  planted: number;
  mode: WeaverLocoState['mode'];
}

export function tickWeaverLocomotion(
  ctx: Ctx,
  e: Enemy,
  def: EnemyDef,
  intent: WeaverIntent,
): WeaverLocoReadout {
  let loco = e.weaverLoco;
  if (!loco) {
    loco = makeWeaverLoco(e.x, e.y);
    e.weaverLoco = loco;
  }

  // External displacement (knockback landing, teleportium, debug drag): resync
  // the body and let attachment be re-earned rather than assumed.
  const movedExternally = Math.abs(e.x - loco.ex) > 0.6 || Math.abs(e.y - loco.ey) > 0.6;
  if (movedExternally) {
    const dx = e.x - loco.ex;
    const dy = e.y - loco.ey;
    loco.px = e.x;
    loco.py = e.y - BODY_H;
    if (loco.mode === 'attached') {
      detach(loco, clamp(dx * 0.4, -2.5, 2.5), clamp(dy * 0.4, -2.5, 2.5));
    }
  }

  if (ctx.debug?.dragRef === e) {
    tickDragged(ctx, e, loco);
    writeBack(e, loco);
    return readout(loco);
  }

  if (loco.mode === 'attached') tickAttached(ctx, loco, intent);
  else tickAirborne(ctx, e, def, loco, intent);

  writeBack(e, loco);
  return readout(loco);
}

function readout(loco: WeaverLocoState): WeaverLocoReadout {
  return {
    blocked: loco.blocked,
    gapAhead: loco.gapAhead,
    planted: plantedCount(loco),
    mode: loco.mode,
  };
}

/** e.x/e.y stay "bottom-centre of the notional AABB", integer cells (the grid
 *  movers and every hit test assume integers) — the float body pose lives on
 *  the loco state and the renderer draws from it. */
function writeBack(e: Enemy, loco: WeaverLocoState): void {
  const bx = Math.round(loco.px);
  const by = Math.round(loco.py + BODY_H);
  e.x = bx;
  e.y = by;
  e.fx = loco.px - bx;
  e.fy = loco.py + BODY_H - by;
  e.grounded = loco.mode === 'attached';
  // mirror real velocity for generic readers (sprites, slam checks, sounds)
  e.vx = loco.vx;
  e.vy = loco.vy;
  loco.ex = e.x;
  loco.ey = e.y;
  e.weaverOrient = loco.orient; // probes/inspector read this
  e.weaverFallT = loco.fallT;
}

// ------------------------------------------------------------ debug drag ----
function tickDragged(ctx: Ctx, e: Enemy, loco: WeaverLocoState): void {
  loco.px = e.x;
  loco.py = e.y - BODY_H;
  loco.vx = 0;
  loco.vy = 0;
  loco.speed = 0;
  loco.mode = 'airborne';
  loco.fallT = 0;
  loco.leapT = 0;
  // legs keep grabbing at whatever passes within reach, so a held Weaver
  // rotates onto a nearby surface exactly like the old drag behavior
  for (let i = 0; i < loco.legs.length; i++) {
    const leg = loco.legs[i];
    const rest = WEAVER_LOCO_REST[i];
    const hip = weaverHipWorld(loco, i);
    if (
      leg.planted &&
      Math.hypot(leg.x - hip.x, leg.y - hip.y) <= WEAVER_LEG_REACH_LOCO[i] * 1.15 &&
      footStillGrips(ctx, leg.x, leg.y)
    ) {
      continue;
    }
    const snap = snapToSurface(ctx, hip.x + rest.arc * 0.4 * loco.face, hip.y + 6, ATTACH_RADIUS);
    if (snap && Math.hypot(snap.sx - hip.x, snap.sy - hip.y) <= WEAVER_LEG_REACH_LOCO[i]) {
      leg.x = snap.sx;
      leg.y = snap.sy;
      leg.planted = true;
      leg.stepT = -1;
      leg.lift = 0;
    } else {
      leg.planted = false;
      leg.stepT = -1;
      // dangle below the hip
      leg.x = lerp(leg.x, hip.x + rest.arc * 0.25 * loco.face, 0.15);
      leg.y = lerp(leg.y, hip.y + 13, 0.15);
    }
  }
  updateOrientFromLegs(loco);
}

// -------------------------------------------------------------- attached ----
function tickAttached(ctx: Ctx, loco: WeaverLocoState, intent: WeaverIntent): void {
  // 1) Re-snap the anchor: terrain may have changed under the body.
  const snap = snapToSurface(ctx, loco.sx, loco.sy, SNAP_RADIUS, loco.nx, loco.ny);
  if (!snap) {
    loco.detachGrace++;
    if (loco.detachGrace > DETACH_GRACE || plantedCount(loco) < LEG_PLANT_MIN) {
      detach(loco, loco.vx, loco.vy + 0.2);
      return;
    }
  } else {
    loco.detachGrace = 0;
    loco.sx = snap.sx;
    loco.sy = snap.sy;
    const grad = surfaceNormal(ctx, snap.sx, snap.sy);
    if (grad.mag >= 0.35) {
      // smooth the normal; hysteresis keeps a chimney climb on one wall
      const bx = loco.nx + (grad.nx - loco.nx) * 0.3;
      const by = loco.ny + (grad.ny - loco.ny) * 0.3;
      const m = Math.hypot(bx, by) || 1;
      loco.nx = bx / m;
      loco.ny = by / m;
    }
  }

  // 2) Sample the contour both ways (nav lookahead + foot targets).
  let fwdList = CONTOUR_A;
  let backList = CONTOUR_B;
  let fwd = marchContour(ctx, loco.sx, loco.sy, loco.nx, loco.ny, loco.dir, CONTOUR_SPAN, fwdList);
  let back = marchContour(
    ctx,
    loco.sx,
    loco.sy,
    loco.nx,
    loco.ny,
    (loco.dir * -1) as 1 | -1,
    CONTOUR_SPAN,
    backList,
  );

  // 3) Navigation: choose crawl direction + speed from the intent.
  let targetSpeed = 0;
  if (intent.move === 'toward') {
    const scoreDir = (samples: ContourSample[], count: number): number => {
      // best (smallest) distance-to-target achievable within the window
      let best = Math.hypot(intent.tx - loco.sx, intent.ty - loco.sy);
      for (let i = 0; i < count; i++) {
        const s = samples[i];
        if (s.lethal) break;
        const d = Math.hypot(intent.tx - s.x, intent.ty - s.y);
        if (d < best) best = d;
      }
      return best;
    };
    const here = Math.hypot(intent.tx - loco.sx, intent.ty - loco.sy);
    const fwdScore = scoreDir(fwdList, fwd.count);
    const backScore = scoreDir(backList, back.count);
    if (loco.navCommit > 0) loco.navCommit--;
    const flip = (): void => {
      loco.dir = (loco.dir * -1) as 1 | -1;
      // the sampled contours swap roles with the direction
      const tmpList = fwdList;
      fwdList = backList;
      backList = tmpList;
      const tmp = fwd;
      fwd = back;
      back = tmp;
    };
    let progressPossible = false;
    if (loco.deepHold > 0) {
      // Committed to a deep route that gets worse before it gets better
      // (around a lip, over a crest). Greedy must NOT interrupt it — the
      // euclidean window always prefers crawling back to the local minimum
      // and would oscillate forever. The hold is ARC CELLS REMAINING on the
      // route (paid down as the anchor actually slides, below), and it only
      // yields early when the window already sees a spot as good as the
      // route's own promised payoff, or when the route breaks.
      progressPossible = true;
      if (fwdScore < loco.deepBest + 2) {
        loco.deepHold = 0;
        loco.deepAge = 999;
      } else if (loco.blocked > 15) {
        // the committed route broke (terrain changed, gap appeared) — let go
        loco.deepHold = 0;
        loco.deepAge = 999;
      }
    } else if (fwdScore < here - 0.5) {
      // greedy fast path: the CURRENT direction approaches within the window
      progressPossible = true;
      if (backScore < fwdScore * NAV_SWITCH_MARGIN && loco.navCommit === 0) {
        flip();
        loco.navCommit = NAV_COMMIT_TICKS;
        progressPossible = scoreDir(fwdList, fwd.count) < here - 0.5;
      }
    } else if (backScore < here - 0.5 && loco.navCommit === 0) {
      // only the other direction approaches within the window
      flip();
      loco.navCommit = NAV_COMMIT_TICKS;
      loco.deepAge = 999;
      progressPossible = true;
    } else {
      // neither window approaches: ask the deep probe for a full-path route
      loco.deepAge++;
      if (loco.deepAge > DEEP_REFRESH_TICKS) {
        const probe = deepProbe(ctx, loco, intent.tx, intent.ty);
        loco.deepDir = probe.dir;
        loco.deepBest = probe.best;
        loco.deepArc = probe.arc;
        loco.deepAge = 0;
      }
      if (loco.deepBest < here - 2) {
        if (loco.dir !== loco.deepDir) flip();
        loco.deepHold = loco.deepArc + 6; // crawl the whole detour, plus slack
        progressPossible = true;
      }
    }
    targetSpeed = progressPossible
      ? BASE_SPEED + intent.urgency * (URGENT_SPEED - BASE_SPEED) + loco.webGrip * WEB_SPEED_BONUS
      : 0;
  } else if (intent.move === 'drift') {
    targetSpeed = BASE_SPEED * 0.55;
  }
  loco.gapAhead = fwd.endedAtGap || fwd.endedAtLethal ? fwd.count : 0;
  if (intent.stance === 'sleep' || intent.stance === 'crouch') targetSpeed = 0;

  // stop short of a gap/lethal edge — a firm halt a few cells back, so the
  // "blocked" counter trips and the AI decides whether to leap it
  if (loco.gapAhead > 0 && loco.gapAhead <= 7) {
    targetSpeed = Math.max(0, Math.min(targetSpeed, (loco.gapAhead - 4) * 0.2));
  }
  if (loco.recoverT > 0) {
    loco.recoverT--;
    targetSpeed *= 0.3;
  }
  targetSpeed *= intent.speedScale ?? 1;
  // "blocked" = the chase wants to move but the crawl can't deliver — whether
  // no route exists or a gap lip has braked it to a standstill. This is what
  // arms the pounce/thread-spit fallbacks in the AI.
  loco.blocked = intent.move === 'toward' && targetSpeed < 0.05 ? loco.blocked + 1 : 0;
  loco.speed += clamp(targetSpeed - loco.speed, -ACCEL * 3, ACCEL);

  // 4) Slide the anchor along the sampled contour by speed — measured as NET
  // displacement, not raw arc. Silk fuzz, rubble and erosion pocks make the
  // micro-contour zigzag; a real crawler glides over that, so zigzag samples
  // inside the step are simply skipped instead of eating the whole stride.
  if (loco.speed > 0.01) {
    const startX = loco.sx;
    const startY = loco.sy;
    let prevX = loco.sx;
    let prevY = loco.sy;
    for (let idx = 0; idx < fwd.count; idx++) {
      const s = fwdList[idx];
      if (s.lethal) break;
      const net = Math.hypot(s.x - startX, s.y - startY);
      if (net >= loco.speed) {
        // ease between the last under-step point and this sample
        const prevNet = Math.hypot(prevX - startX, prevY - startY);
        const span = Math.max(0.001, net - prevNet);
        const f = clamp((loco.speed - prevNet) / span, 0, 1);
        loco.sx = prevX + (s.x - prevX) * f;
        loco.sy = prevY + (s.y - prevY) * f;
        const bnx = loco.nx + (s.nx - loco.nx) * Math.max(0.35, f);
        const bny = loco.ny + (s.ny - loco.ny) * Math.max(0.35, f);
        const m = Math.hypot(bnx, bny) || 1;
        loco.nx = bnx / m;
        loco.ny = bny / m;
        break;
      }
      prevX = s.x;
      prevY = s.y;
      loco.sx = s.x;
      loco.sy = s.y;
      loco.nx = s.nx;
      loco.ny = s.ny;
    }
    loco.stride += loco.speed * 0.17;
    // a committed deep route is paid down by travel
    if (loco.deepHold > 0) loco.deepHold = Math.max(0, loco.deepHold - loco.speed);
  } else {
    loco.stride += 0.004; // idle micro-shift
  }

  // web confidence: how much of the local contour is growth
  let webN = 0;
  const webSpan = Math.min(10, fwd.count);
  for (let i = 0; i < webSpan; i++) if (fwdList[i].web) webN++;
  loco.webGrip = lerp(loco.webGrip, webSpan > 0 ? webN / webSpan : 0, 0.1);

  // 5) Ride height: clearance-probed so tight tunnels squeeze the body down.
  let clear = RIDE_HEIGHT + 4;
  for (let d = 2; d <= RIDE_HEIGHT + 4; d++) {
    if (gripAt(ctx, Math.round(loco.sx + loco.nx * d), Math.round(loco.sy + loco.ny * d))) {
      clear = d - 1;
      break;
    }
  }
  const stanceRide =
    intent.stance === 'sleep'
      ? RIDE_MIN
      : intent.stance === 'crouch'
        ? RIDE_MIN + 1.5
        : intent.stance === 'rear'
          ? RIDE_HEIGHT + 4
          : RIDE_HEIGHT - intent.urgency * 1.6;
  const gaitBob = loco.speed > 0.05 ? Math.sin(loco.stride * 2) * 0.7 : 0;
  loco.ride = lerp(
    loco.ride,
    clamp(Math.min(stanceRide, clear - 1.5), RIDE_MIN, RIDE_HEIGHT + 4) + gaitBob,
    0.14,
  );

  // 6) Body spring toward the ride point (organic lag, never trailing far).
  const targetX = loco.sx + loco.nx * loco.ride;
  const targetY = loco.sy + loco.ny * loco.ride;
  loco.vx = (loco.vx + (targetX - loco.px) * SPRING_K) * SPRING_DAMP;
  loco.vy = (loco.vy + (targetY - loco.py) * SPRING_K) * SPRING_DAMP;
  loco.px += loco.vx;
  loco.py += loco.vy;
  const lagX = loco.px - targetX;
  const lagY = loco.py - targetY;
  const lag = Math.hypot(lagX, lagY);
  if (lag > MAX_BODY_LAG) {
    loco.px = targetX + (lagX / lag) * MAX_BODY_LAG;
    loco.py = targetY + (lagY / lag) * MAX_BODY_LAG;
  }

  // 7) Facing: while moving, the head leads the crawl; at rest it turns to
  // whatever the intent is watching.
  if (loco.speed > 0.12) {
    loco.face = loco.dir;
  } else if (intent.move === 'toward' || intent.stance === 'rear') {
    const { tx, ty } = tangentOf(loco.nx, loco.ny, 1);
    const dot = (intent.tx - loco.px) * tx + (intent.ty - loco.py) * ty;
    if (Math.abs(dot) > 8) loco.face = dot >= 0 ? 1 : -1;
  }

  // 8) Gait: step feet toward their contour rest offsets.
  tickLegs(ctx, loco, intent, fwdList, fwd.count, backList, back.count);

  // 9) Attachment check: enough grip left?
  if (plantedCount(loco) < LEG_PLANT_MIN && !snap) {
    detach(loco, loco.vx, loco.vy + 0.2);
    return;
  }
  loco.fallT = Math.max(0, loco.fallT - 3);

  // 10) Orientation for the renderer (chimney straddle pins upright).
  updateOrientFromLegs(loco);
}

/** Foot target for a leg: the contour sample nearest its (facing-frame) arc
 *  offset. Returns null at a gap — the leg reaches instead of planting. */
function contourAt(
  loco: WeaverLocoState,
  fwdList: ContourSample[],
  fwdCount: number,
  backList: ContourSample[],
  backCount: number,
  arc: number,
): ContourSample | null {
  const along = arc * loco.face * loco.dir; // + = crawl direction (fwd list)
  const idx = Math.round(Math.abs(along));
  if (along >= 0) return idx < fwdCount ? fwdList[Math.max(0, idx)] : null;
  return idx < backCount ? backList[idx] : null;
}

function tickLegs(
  ctx: Ctx,
  loco: WeaverLocoState,
  intent: WeaverIntent,
  fwdList: ContourSample[],
  fwdCount: number,
  backList: ContourSample[],
  backCount: number,
): void {
  const urgency = intent.urgency;
  const rippleAmt = clamp(0.36 - urgency * 0.22, 0.12, 0.4);
  const lead = loco.speed * 6 * loco.dir * loco.face; // step where the body is going
  let airborne = 0;
  for (const leg of loco.legs) if (!leg.planted) airborne++;

  for (let i = 0; i < loco.legs.length; i++) {
    const leg = loco.legs[i];
    const rest = WEAVER_LOCO_REST[i];
    const hip = weaverHipWorld(loco, i);
    // desired foothold = the contour sample at this leg's arc offset — walked
    // inward if corner-wrapped geometry puts that sample beyond the leg's real
    // reach (planting an unreachable hold would just thrash a re-step).
    const reach = WEAVER_LEG_REACH_LOCO[i];
    let sample: ContourSample | null = null;
    for (const arcScale of [0.82, 0.55, 0.32]) {
      const cand = contourAt(loco, fwdList, fwdCount, backList, backCount, rest.arc * arcScale + lead);
      if (cand && Math.hypot(cand.x - hip.x, cand.y - hip.y) <= reach * 0.95) {
        sample = cand;
        break;
      }
    }

    // swing in progress: fly the foot along its arc
    if (leg.stepT >= 0) {
      const dur = Math.round(
        clamp(SWING_MAX_TICKS - loco.speed * 3.2 - urgency * 1.5, SWING_MIN_TICKS, SWING_MAX_TICKS),
      );
      leg.stepT += 1 / dur;
      // chase a moving target so fast walks don't land feet behind the body
      if (sample) {
        leg.targetX = sample.x;
        leg.targetY = sample.y;
      }
      const t = clamp(leg.stepT, 0, 1);
      const smooth = t * t * (3 - 2 * t);
      leg.x = leg.fromX + (leg.targetX - leg.fromX) * smooth;
      leg.y = leg.fromY + (leg.targetY - leg.fromY) * smooth;
      leg.lift = Math.sin(t * Math.PI) * 0.72; // swing phase; render scales to cells
      if (leg.stepT >= 1) {
        leg.stepT = -1;
        leg.x = leg.targetX;
        leg.y = leg.targetY;
        leg.lift = 0;
        leg.planted = footStillGrips(ctx, leg.x, leg.y);
        if (leg.planted) airborne = Math.max(0, airborne - 1);
      }
      continue;
    }

    // planted: hold grip unless the surface is gone or displacement demands a step
    if (leg.planted) {
      if (!footStillGrips(ctx, leg.x, leg.y)) {
        leg.planted = false;
        airborne++;
      } else {
        const hipDist = Math.hypot(leg.x - hip.x, leg.y - hip.y);
        leg.strain = clamp(hipDist / reach, 0, 1);
        const disp = sample ? Math.hypot(sample.x - leg.x, sample.y - leg.y) : 0;
        const phase = Math.sin(
          loco.stride * Math.PI +
            (rest.group === 0 ? 0 : Math.PI) * (1 - rippleAmt) +
            rest.ripple * rippleAmt,
        );
        const overReached = hipDist > reach * 0.96;
        const wantStep =
          overReached ||
          (sample !== null &&
            disp > STEP_DEADBAND + loco.speed * 3.6 &&
            (phase > 0.15 || loco.speed < 0.05));
        if (wantStep && sample && airborne < MAX_AIRBORNE_LEGS) {
          leg.stepT = 0;
          leg.fromX = leg.x;
          leg.fromY = leg.y;
          leg.targetX = sample.x;
          leg.targetY = sample.y;
          leg.planted = false;
          airborne++;
        }
        continue;
      }
    }

    // unplanted, not swinging: swing to grip near the desired spot
    if (sample) {
      leg.stepT = 0;
      leg.fromX = leg.x;
      leg.fromY = leg.y;
      leg.targetX = sample.x;
      leg.targetY = sample.y;
    } else {
      // nothing to grip at this offset (a gap): reach toward it, telegraphing
      const reachSide = (Math.sign(rest.arc * loco.face * loco.dir) || 1) as 1 | -1;
      const { tx, ty } = tangentOf(loco.nx, loco.ny, reachSide);
      const rx = hip.x + tx * Math.abs(rest.arc) * 0.5 - loco.nx * 2;
      const ry = hip.y + ty * Math.abs(rest.arc) * 0.5 - loco.ny * 2;
      leg.x = lerp(leg.x, rx, 0.18);
      leg.y = lerp(leg.y, ry, 0.18);
      leg.strain = 1;
      leg.lift = 0;
    }
  }
}

/** Body angle from the planted-foot cloud: PCA line fit -> surface tangent ->
 *  normal, with the chimney straddle pinned upright. Locomotion-owned now, so
 *  render and AI can never disagree about which way the creature leans. */
function updateOrientFromLegs(loco: WeaverLocoState): void {
  let fW = 0;
  let fSx = 0;
  let fSy = 0;
  let fSxx = 0;
  let fSyy = 0;
  let fSxy = 0;
  for (const leg of loco.legs) {
    if (!leg.planted) continue;
    fW += 1;
    fSx += leg.x;
    fSy += leg.y;
    fSxx += leg.x * leg.x;
    fSyy += leg.y * leg.y;
    fSxy += leg.x * leg.y;
  }
  // fallback: lean the body per the surface normal it is riding
  let target = Math.atan2(-loco.nx, -loco.ny) + Math.PI;
  if (target > Math.PI) target -= Math.PI * 2;
  if (loco.mode !== 'attached' && fW < 3) target = 0; // falling: relax upright
  if (fW >= 3) {
    const mx = fSx / fW;
    const my = fSy / fW;
    const offX = mx - loco.px;
    const offY = my - loco.py;
    const vxx = fSxx / fW - mx * mx;
    const vyy = fSyy / fW - my * my;
    const vxy = fSxy / fW - mx * my;
    const tr = vxx + vyy;
    const det = vxx * vyy - vxy * vxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const lMin = Math.max(0, tr / 2 - disc);
    const tang = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
    const nx = -Math.sin(tang);
    const ny = Math.cos(tang);
    const proj = offX * nx + offY * ny;
    if (Math.abs(proj) < Math.sqrt(lMin) * 0.85) {
      target = 0; // feet straddle the body (chimney): pin upright
    } else {
      const gx = proj >= 0 ? nx : -nx;
      const gy = proj >= 0 ? ny : -ny;
      target = Math.atan2(gx, gy);
    }
  }
  let d = target - loco.orient;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  loco.orient += d * 0.16;
  if (loco.orient > Math.PI) loco.orient -= Math.PI * 2;
  else if (loco.orient < -Math.PI) loco.orient += Math.PI * 2;
}

// -------------------------------------------------------------- airborne ----
function detach(loco: WeaverLocoState, vx: number, vy: number): void {
  loco.mode = 'airborne';
  loco.vx = clamp(vx, -3.4, 3.4);
  loco.vy = clamp(vy, -3.4, 3.4);
  loco.fx = 0;
  loco.fy = 0;
  loco.speed = 0;
  loco.detachGrace = 0;
  for (const leg of loco.legs) {
    leg.planted = false;
    leg.stepT = -1;
  }
}

/** A deliberate ballistic leap at (tx, ty). Solves v0 for a modest arc and
 *  detaches; the regular airborne catch re-attaches on any surface a leg
 *  reaches. Fail-open by construction: a missed pounce is just a fall. */
export function weaverLeap(e: Enemy, tx: number, ty: number): void {
  const loco = e.weaverLoco;
  if (!loco) return;
  let dx = tx - loco.px;
  let dy = ty - loco.py;
  let dist = Math.hypot(dx, dy) || 1;
  // a leap has real range: an out-of-reach mark is jumped AT, not teleported
  // to — it lands short (often on the far lip/wall) and re-attaches there.
  const LEAP_RANGE = 120;
  if (dist > LEAP_RANGE) {
    dx *= LEAP_RANGE / dist;
    dy *= LEAP_RANGE / dist;
    dist = LEAP_RANGE;
  }
  const T = clamp(Math.round(dist / 2.4), 10, 26); // flight ticks
  const vx = dx / T;
  const vy = dy / T - 0.5 * GRAVITY * T;
  detach(loco, clamp(vx, -3.0, 3.0), clamp(vy, -3.4, 2.4));
  loco.leapT = LEAP_NO_GRAB;
  loco.fallT = 0;
}

/** External impulse (knockback while attached): tear the grip loose. */
export function weaverShove(e: Enemy, vx: number, vy: number): void {
  const loco = e.weaverLoco;
  if (!loco) return;
  detach(loco, vx, vy);
  loco.leapT = 4;
}

/** Called every tick a gust-launch (tickKnock) owns the body: the knock moves
 *  e.x/e.y itself, so keep the rig in tow — grip torn, legs trailing — and let
 *  the normal airborne catch take over when the launch ends. */
export function weaverKnockSync(e: Enemy): void {
  const loco = e.weaverLoco;
  if (!loco) return;
  loco.mode = 'airborne';
  loco.leapT = Math.max(loco.leapT, 2);
  loco.px = e.x;
  loco.py = e.y - BODY_H;
  loco.ex = e.x;
  loco.ey = e.y;
  loco.vx = e.knockVx ?? 0;
  loco.vy = e.knockVy ?? 0;
  loco.fx = 0;
  loco.fy = 0;
  trailLegsAirborne(loco);
  updateOrientFromLegs(loco);
}

/** Legs trail/reach toward travel while the body flies (pure presentation). */
function trailLegsAirborne(loco: WeaverLocoState): void {
  for (let i = 0; i < loco.legs.length; i++) {
    const leg = loco.legs[i];
    const rest = WEAVER_LOCO_REST[i];
    const hip = weaverHipWorld(loco, i);
    leg.planted = false;
    leg.stepT = -1;
    leg.x = lerp(leg.x, hip.x + rest.arc * 0.35 * loco.face + loco.vx * 3, 0.2);
    leg.y = lerp(leg.y, hip.y + 10 + Math.abs(rest.arc) * 0.12 + loco.vy * 1.5, 0.2);
    leg.strain = 0.8;
    leg.lift = 0;
  }
}

function tickAirborne(
  ctx: Ctx,
  e: Enemy,
  def: EnemyDef,
  loco: WeaverLocoState,
  intent: WeaverIntent,
): void {
  void def;
  if (loco.leapT > 0) loco.leapT--;
  loco.vy = Math.min(MAX_FALL, loco.vy + GRAVITY);
  loco.fallT = Math.min(90, loco.fallT + 1);

  // integrate through the grid with the shared entity mover: integer steps on
  // a bottom-centre box, fractional remainder carried on the loco accumulators
  const mover = { x: e.x, y: e.y };
  loco.fx += loco.vx;
  loco.fy += loco.vy;
  while (loco.fx >= 1) {
    if (!ctx.physics.tryMoveEntity(mover, 1, 0, BODY_HALF_W, BODY_H, 2, 2)) {
      loco.vx = 0;
      loco.fx = 0;
      break;
    }
    loco.fx -= 1;
  }
  while (loco.fx <= -1) {
    if (!ctx.physics.tryMoveEntity(mover, -1, 0, BODY_HALF_W, BODY_H, 2, 2)) {
      loco.vx = 0;
      loco.fx = 0;
      break;
    }
    loco.fx += 1;
  }
  while (loco.fy >= 1) {
    if (!ctx.physics.tryMoveEntity(mover, 0, 1, BODY_HALF_W, BODY_H, 0, 2)) {
      loco.vy = 0;
      loco.fy = 0;
      break;
    }
    loco.fy -= 1;
  }
  while (loco.fy <= -1) {
    if (!ctx.physics.tryMoveEntity(mover, 0, -1, BODY_HALF_W, BODY_H, 0, 2)) {
      loco.vy = 0;
      loco.fy = 0;
      break;
    }
    loco.fy += 1;
  }
  if (mover.y > ctx.world.height - 2) {
    mover.y = ctx.world.height - 2;
    loco.vy = 0;
  }
  loco.px = mover.x + loco.fx;
  loco.py = mover.y - BODY_H + loco.fy;

  // falling: the surface frame relaxes toward plain gravity-down
  loco.nx = lerp(loco.nx, 0, 0.1);
  loco.ny = lerp(loco.ny, -1, 0.1);
  const m = Math.hypot(loco.nx, loco.ny) || 1;
  loco.nx /= m;
  loco.ny /= m;

  trailLegsAirborne(loco);

  // catch: any surface within reach of the body re-attaches it
  if (loco.leapT <= 0) {
    const snap = snapToSurface(ctx, loco.px, loco.py + 3, ATTACH_RADIUS);
    if (snap) {
      loco.mode = 'attached';
      loco.sx = snap.sx;
      loco.sy = snap.sy;
      const grad = surfaceNormal(ctx, snap.sx, snap.sy);
      if (grad.mag > 0.001) {
        loco.nx = grad.nx;
        loco.ny = grad.ny;
      } else {
        loco.nx = 0;
        loco.ny = -1;
      }
      loco.recoverT = Math.round(clamp(loco.fallT * 0.35, 4, 22));
      loco.speed = 0;
      loco.vx *= 0.3;
      loco.vy *= 0.3;
      loco.detachGrace = 0;
      loco.fx = 0;
      loco.fy = 0;
      // the catch: the nearest legs slap onto the surface at once, the rest
      // step in over the following ticks via the normal gait
      let plantedNow = 0;
      for (let i = 0; i < loco.legs.length && plantedNow < 3; i++) {
        const leg = loco.legs[i];
        const hip = weaverHipWorld(loco, i);
        const legSnap = snapToSurface(ctx, hip.x - loco.nx * 2, hip.y - loco.ny * 2, ATTACH_RADIUS);
        if (
          legSnap &&
          Math.hypot(legSnap.sx - hip.x, legSnap.sy - hip.y) <= WEAVER_LEG_REACH_LOCO[i] * 1.1
        ) {
          leg.x = legSnap.sx;
          leg.y = legSnap.sy;
          leg.planted = true;
          leg.stepT = -1;
          plantedNow++;
        }
      }
      loco.fallT = 0;
    }
  }
  void intent;
  updateOrientFromLegs(loco);
}
