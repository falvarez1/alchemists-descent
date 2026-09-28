import { Cell, blocksEntity } from '@/sim/CellType';
import type { World } from '@/sim/World';

/**
 * LIGHT THAT TURNS CORNERS (wave 3, the Glass Galleries). The one geometry
 * both the wand's beam (render/Lighting marches it ray by ray) and the
 * Lenswright's lance (a gameplay trace) obey, read straight off the grid:
 *
 * - MIRROR cells reflect. The face is read from the mirror cells around the
 *   hit — the principal axis of their layout is the surface, its normal the
 *   face — so a two-cell line of silvered glass at any angle is a mirror at
 *   that angle, and the player can shatter or paint one.
 * - CRYSTAL is a prism: a beam entering it from outside leaves split into two
 *   tinted beams, bent PRISM_SPLIT either way (warm and cool), and it only
 *   splits again once it has left the crystal.
 * - GLASS and ICE are clear: the beam passes with a little loss.
 * - Anything else that blocks a body stops it. Liquids dim it.
 */

/** A mirror keeps this share of the beam. */
export const MIRROR_REFLECTANCE = 0.9;
/** A prism bends each daughter beam this far off the incoming line (radians). */
export const PRISM_SPLIT = 0.36;
/** Each daughter beam carries this share of the light. */
export const PRISM_SHARE = 0.62;
/** Bounces and splits one beam may take before it is spent. */
export const MAX_BEAM_DEPTH = 5;

/** What the beam does at a cell. */
export const BEAM_OPEN = 0;
export const BEAM_MIRROR = 1;
export const BEAM_PRISM = 2;
export const BEAM_STOP = 3;
export const BEAM_CLEAR = 4;

/** How a cell type treats the beam (air, clear, liquid → open; mirror; prism; stop). */
export function beamKind(t: number): number {
  if (t === Cell.Mirror) return BEAM_MIRROR;
  if (t === Cell.Crystal) return BEAM_PRISM;
  if (t === Cell.Glass || t === Cell.Ice) return BEAM_CLEAR;
  if (blocksEntity(t)) return BEAM_STOP;
  return BEAM_OPEN;
}

/**
 * The outward face normal of the mirror at (cx, cy), facing the incoming
 * beam (dx, dy). The principal axis of the mirror cells in a 7×7 window is
 * the surface; when the cells there are a blob rather than a line, the
 * direction toward open space is used instead. Returns a unit vector.
 */
export function mirrorNormal(world: World, cx: number, cy: number, dx: number, dy: number): [number, number] {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  let ox = 0, oy = 0;
  for (let j = -3; j <= 3; j++) {
    for (let i = -3; i <= 3; i++) {
      const X = cx + i, Y = cy + j;
      if (!world.inBounds(X, Y)) continue;
      const t = world.types[X + Y * world.width];
      if (t === Cell.Mirror) {
        n++; sx += i; sy += j; sxx += i * i; syy += j * j; sxy += i * j;
      } else if (!blocksEntity(t)) {
        ox += i; oy += j;
      }
    }
  }
  let nx = -dx, ny = -dy;
  if (n >= 3) {
    const mx = sx / n, my = sy / n;
    const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    // Eigenvalues of the covariance: a line has one large, one small.
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (l1 > 0.2 && l2 < l1 * 0.55) {
      const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      nx = -Math.sin(theta); ny = Math.cos(theta);
    } else if (ox * ox + oy * oy > 0.5) {
      const d = Math.hypot(ox, oy);
      nx = ox / d; ny = oy / d;
    }
  } else if (ox * ox + oy * oy > 0.5) {
    const d = Math.hypot(ox, oy);
    nx = ox / d; ny = oy / d;
  }
  // Face the beam.
  if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny; }
  const len = Math.hypot(nx, ny) || 1;
  return [nx / len, ny / len];
}

/** Reflect direction (dx, dy) off a face with unit normal (nx, ny). */
export function reflect(dx: number, dy: number, nx: number, ny: number): [number, number] {
  const k = 2 * (dx * nx + dy * ny);
  return [dx - k * nx, dy - k * ny];
}

/** Rotate (dx, dy) by `a` radians. */
export function rotate(dx: number, dy: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dy * s, dx * s + dy * c];
}

/** One straight run of a traced beam. */
export interface BeamSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Share of the source's light left at the segment's start (0..1). */
  power: number;
  /** Bounces and splits taken to get here (0 = the source's own line). */
  depth: number;
  /** 0 white, 1 warm (prism, bent one way), -1 cool (bent the other). */
  tint: number;
  /** How the segment ended. */
  end: 'reach' | 'stop' | 'mirror' | 'prism' | 'edge';
}

interface Ray { x: number; y: number; dx: number; dy: number; power: number; depth: number; tint: number; left: number; inPrism: boolean }

/**
 * Trace a beam through the grid from (x, y) along `angle` for `reach` cells,
 * bouncing off mirrors and splitting in prisms. Appends the segments to `out`
 * (cleared first) and returns it. Deterministic: the grid alone decides.
 */
export function traceBeam(
  world: World, x: number, y: number, angle: number, reach: number, out: BeamSegment[] = [],
  opts: { maxSegments?: number; step?: number; minPower?: number } = {},
): BeamSegment[] {
  out.length = 0;
  const maxSegments = opts.maxSegments ?? 16;
  const step = opts.step ?? 0.5;
  const minPower = opts.minPower ?? 0.08;
  const stack: Ray[] = [{ x, y, dx: Math.cos(angle), dy: Math.sin(angle), power: 1, depth: 0, tint: 0, left: reach, inPrism: false }];
  while (stack.length > 0 && out.length < maxSegments) {
    const r = stack.pop()!;
    let px = r.x, py = r.y, power = r.power, travelled = 0;
    let inPrism = r.inPrism;
    let end: BeamSegment['end'] = 'reach';
    let child: (() => void) | null = null;
    while (travelled < r.left) {
      const nx = px + r.dx * step, ny = py + r.dy * step;
      const cx = Math.floor(nx), cy = Math.floor(ny);
      if (!world.inBounds(cx, cy)) { end = 'edge'; break; }
      const kind = beamKind(world.types[cx + cy * world.width]);
      if (kind === BEAM_MIRROR) {
        end = 'mirror';
        if (r.depth < MAX_BEAM_DEPTH && power * MIRROR_REFLECTANCE >= minPower) {
          const [fx, fy] = mirrorNormal(world, cx, cy, r.dx, r.dy);
          const [rx, ry] = reflect(r.dx, r.dy, fx, fy);
          const sx = px, sy = py, left = r.left - travelled, p = power * MIRROR_REFLECTANCE, depth = r.depth + 1, tint = r.tint;
          child = () => stack.push({ x: sx, y: sy, dx: rx, dy: ry, power: p, depth, tint, left, inPrism: false });
        }
        break;
      }
      if (kind === BEAM_PRISM && !inPrism) {
        end = 'prism';
        if (r.depth < MAX_BEAM_DEPTH && power * PRISM_SHARE >= minPower) {
          const sx = nx, sy = ny, left = r.left - travelled, p = power * PRISM_SHARE, depth = r.depth + 1;
          const [ax, ay] = rotate(r.dx, r.dy, PRISM_SPLIT);
          const [bx, by] = rotate(r.dx, r.dy, -PRISM_SPLIT);
          child = () => {
            stack.push({ x: sx, y: sy, dx: bx, dy: by, power: p, depth, tint: -1, left, inPrism: true });
            stack.push({ x: sx, y: sy, dx: ax, dy: ay, power: p, depth, tint: 1, left, inPrism: true });
          };
        }
        px = nx; py = ny;
        break;
      }
      if (kind !== BEAM_PRISM) inPrism = false;
      if (kind === BEAM_STOP) { end = 'stop'; break; }
      if (kind === BEAM_CLEAR) power *= 0.996;
      else if (kind === BEAM_OPEN && world.types[cx + cy * world.width] !== Cell.Empty) power *= 0.99;
      px = nx; py = ny;
      travelled += step;
      if (power < minPower) { end = 'reach'; break; }
    }
    out.push({ x0: r.x, y0: r.y, x1: px, y1: py, power: r.power, depth: r.depth, tint: r.tint, end });
    child?.();
  }
  return out;
}

/** Distance from (x, y) to a segment. */
export function distanceToSegment(x: number, y: number, s: Pick<BeamSegment, 'x0' | 'y0' | 'x1' | 'y1'>): number {
  const vx = s.x1 - s.x0, vy = s.y1 - s.y0;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - s.x0) * vx + (y - s.y0) * vy) / len2)) : 0;
  return Math.hypot(x - (s.x0 + vx * t), y - (s.y0 + vy * t));
}
