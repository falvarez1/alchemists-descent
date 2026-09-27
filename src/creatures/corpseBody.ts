import type { Enemy, EnemyKind } from '@/core/types';
import type { RigPoint } from './rig/physics';
import { impulse } from './rig/physics';
import type { CreatureRig } from './rig/types';

/**
 * One view of a dead body, whatever it was built from. A corpse is a verlet
 * rig (chunks, chains, a gel ring), a Weaver's silhouette riding its
 * locomotion, or a serpent's spine — three shapes of the same thing: mass the
 * world can push. Everything that handles remains as a physical object (the
 * wand's grip, a boot, a blast, a splash, a struck creature) goes through here,
 * so each kind of body answers the same way.
 */

/**
 * What the remains weigh, in slimes (a slime's body is 1). Heavier bodies lift
 * slowly and cost more to hold, fly shorter and strike harder; a bat is barely
 * there. Chosen by eye against each body's drawn bulk, not its hit box.
 */
export const CORPSE_MASS: Readonly<Partial<Record<EnemyKind, number>>> = {
  bat: 0.4, eggs: 0.3, wisp: 0.6, slime: 1, acidslime: 1, bomber: 1, imp: 1.2, spitter: 1.3,
  mage: 1.6, rillback: 1.8, rootloper: 2, weaver: 2.6, stonemaw: 3.2, golem: 4.5,
  leviathan: 14, colossus: 30,
};

/** The heaviest remains the wand can lift (the dead Leviathan is past it: it can only be nudged). */
export const LIFT_MASS_MAX = 6;

export function corpseMass(kind: EnemyKind): number {
  return CORPSE_MASS[kind] ?? 1.5;
}

/** Every verlet point of a rig: chunks, then chain links, then the gel ring. Order is stable. */
export function allPoints(rig: CreatureRig): RigPoint[] {
  const pts: RigPoint[] = [...rig.pts];
  for (const c of rig.chains) pts.push(...c.pts);
  if (rig.soft) pts.push(...rig.soft.pts);
  return pts;
}

export type CorpseFrame = 'rig' | 'weaver' | 'chain';

/** Which of the three body shapes these remains are. */
export function corpseFrame(e: Enemy): CorpseFrame {
  if (e.kind === 'weaver' && e.weaverLoco) return 'weaver';
  const rig = e.rig;
  if (e.body && (!rig || (rig.pts.length === 0 && rig.chains.length === 0 && !rig.soft))) return 'chain';
  return 'rig';
}

/** A gel body is only its ring: no chunk to hold, so the whole blob is gripped. */
function softOnly(rig: CreatureRig): boolean {
  return rig.pts.length === 0 && rig.chains.length === 0 && rig.soft !== null;
}

export interface BodySample {
  /** Centroid. */
  x: number;
  y: number;
  /** Mean velocity, cells per tick. */
  vx: number;
  vy: number;
  /** Farthest point from the centroid (the body's reach). */
  r: number;
  /** Points averaged. */
  n: number;
}

export function emptySample(): BodySample {
  return { x: 0, y: 0, vx: 0, vy: 0, r: 0, n: 0 };
}

/** Weaver remains read as a body of this radius around their locomotion centre. */
const WEAVER_BODY_R = 7;

/** Centroid, mean velocity and reach of the remains. */
export function sampleBody(e: Enemy, out: BodySample): BodySample {
  out.x = 0; out.y = 0; out.vx = 0; out.vy = 0; out.r = 0; out.n = 0;
  const frame = corpseFrame(e);
  if (frame === 'weaver') {
    const loco = e.weaverLoco!;
    out.x = loco.px; out.y = loco.py; out.vx = loco.vx; out.vy = loco.vy; out.r = WEAVER_BODY_R; out.n = 1;
    return out;
  }
  if (frame === 'chain') {
    const nodes = e.body!.nodes;
    for (const n of nodes) { out.x += n.x; out.y += n.y; out.vx += n.x - n.previousX; out.vy += n.y - n.previousY; }
    const k = nodes.length || 1;
    out.x /= k; out.y /= k; out.vx /= k; out.vy /= k; out.n = nodes.length;
    for (const n of nodes) out.r = Math.max(out.r, Math.hypot(n.x - out.x, n.y - out.y) + n.radius);
    return out;
  }
  const rig = e.rig;
  if (!rig) { out.x = e.x; out.y = e.y - 3; out.n = 1; out.r = 3; return out; }
  const pts = allPoints(rig);
  for (const p of pts) { out.x += p.x; out.y += p.y; out.vx += p.x - p.px; out.vy += p.y - p.py; }
  const k = pts.length || 1;
  out.x /= k; out.y /= k; out.vx /= k; out.vy /= k; out.n = pts.length;
  for (const p of pts) out.r = Math.max(out.r, Math.hypot(p.x - out.x, p.y - out.y) + p.r);
  if (pts.length === 0) { out.x = e.x; out.y = e.y - 3; out.r = 3; out.n = 1; }
  return out;
}

/**
 * Visit every mass point of the remains in world space: (x, y, radius, index).
 * Weaver remains report their centre and each foot; a spine, its nodes.
 */
export function forEachBodyPoint(e: Enemy, fn: (x: number, y: number, r: number, i: number) => void): void {
  const frame = corpseFrame(e);
  if (frame === 'weaver') {
    const loco = e.weaverLoco!;
    fn(loco.px, loco.py, WEAVER_BODY_R, -1);
    // Fore and aft of the abdomen (the drawn body is long), then the feet.
    const tx = -loco.ny * loco.face, ty = loco.nx * loco.face;
    fn(loco.px + tx * 6, loco.py + ty * 6, 4, -2);
    fn(loco.px - tx * 6, loco.py - ty * 6, 4, -3);
    loco.legs.forEach((leg, i) => { if (!leg.missing) fn(leg.x, leg.y, 1.2, 100 + i); });
    return;
  }
  if (frame === 'chain') {
    e.body!.nodes.forEach((n, i) => fn(n.x, n.y, n.radius, i));
    return;
  }
  if (!e.rig) { fn(e.x, e.y - 3, 3, 0); return; }
  allPoints(e.rig).forEach((p, i) => fn(p.x, p.y, p.r, i));
}

/** Add a velocity (cells per tick) to the whole body. */
export function pushBody(e: Enemy, vx: number, vy: number): void {
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
  const frame = corpseFrame(e);
  if (frame === 'weaver') {
    const loco = e.weaverLoco!;
    loco.vx += vx; loco.vy += vy;
    return;
  }
  if (frame === 'chain') {
    for (const n of e.body!.nodes) { n.previousX -= vx; n.previousY -= vy; }
    return;
  }
  if (!e.rig) return;
  for (const p of allPoints(e.rig)) impulse(p, vx, vy);
}

/**
 * A velocity kick that falls off with distance from (x, y): each point of a rig
 * takes its own share (a blast turns the body over, a boot folds it), while a
 * Weaver or a spine takes it whole at its centre. `at(dx, dy, d)` returns the
 * velocity for a point at offset (dx, dy), distance d, or null to skip it.
 * Returns how many points were pushed.
 */
export function pushField(e: Enemy, x: number, y: number, at: (dx: number, dy: number, d: number) => readonly [number, number] | null): number {
  const frame = corpseFrame(e);
  if (frame !== 'rig' || !e.rig) {
    const s = sampleBody(e, emptySample());
    const dx = s.x - x, dy = s.y - y, v = at(dx, dy, Math.hypot(dx, dy));
    if (!v) return 0;
    pushBody(e, v[0], v[1]);
    return 1;
  }
  let n = 0;
  for (const p of allPoints(e.rig)) {
    const dx = p.x - x, dy = p.y - y, v = at(dx, dy, Math.hypot(dx, dy));
    if (!v) continue;
    impulse(p, v[0], v[1]);
    n++;
  }
  return n;
}

/**
 * The point a grip holds: an index into allPoints for a rig with chunks, or -1
 * for the whole body (a gel ring, a Weaver's shell, a spine held by its head).
 * `gap` is how far (x, y) is from the body's surface there.
 */
export function nearestGrip(e: Enemy, x: number, y: number): { index: number; gap: number } {
  const frame = corpseFrame(e);
  let best = { index: -1, gap: Infinity };
  if (frame === 'rig' && e.rig && !softOnly(e.rig)) {
    allPoints(e.rig).forEach((p, i) => {
      const gap = Math.hypot(p.x - x, p.y - y) - Math.max(0.8, p.r);
      if (gap < best.gap) best = { index: i, gap };
    });
    return best;
  }
  forEachBodyPoint(e, (px, py, r) => {
    const gap = Math.hypot(px - x, py - y) - Math.max(0.8, r);
    if (gap < best.gap) best = { index: -1, gap };
  });
  return best;
}

export interface GripPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Where the grip is on the body right now, and how fast it moves. */
export function gripPoint(e: Enemy, index: number, out: GripPoint): GripPoint {
  const frame = corpseFrame(e);
  if (frame === 'rig' && e.rig && index >= 0) {
    const pts = allPoints(e.rig);
    const p = pts[Math.min(index, pts.length - 1)];
    if (p) { out.x = p.x; out.y = p.y; out.vx = p.x - p.px; out.vy = p.y - p.py; return out; }
  }
  if (frame === 'chain') {
    const head = e.body!.nodes[0];
    out.x = head.x; out.y = head.y; out.vx = head.x - head.previousX; out.vy = head.y - head.previousY;
    return out;
  }
  const s = sampleBody(e, emptySample());
  out.x = s.x; out.y = s.y; out.vx = s.vx; out.vy = s.vy;
  return out;
}
