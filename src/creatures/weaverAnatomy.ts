import type { Enemy } from '@/core/types';
import { weaverHipWorld, WEAVER_LEG_REACH_LOCO, WEAVER_LOCO_REST } from '@/entities/weaverLocomotion';

export interface LimbPoint { x: number; y: number }

/** The same continuous skeleton supplies visible chitin and projectile contact.
 * Sockets remain in body space; feet stay in the simulation's surface space. */
export function weaverLegGeometry(e: Readonly<Enemy>, index: number): LimbPoint[] {
  const loco = e.weaverLoco, rest = WEAVER_LOCO_REST[index];
  const nx = loco?.nx ?? 0, ny = loco?.ny ?? -1, tx = -ny, ty = nx, face = loco?.face ?? 1;
  const hip = loco ? weaverHipWorld(loco, index) : { x: e.x + rest.hipArc * face, y: e.y - 9 - rest.hipOut };
  const footState = loco?.legs[index];
  const foot = { x: (footState?.x ?? e.x + rest.arc * .7) + nx * (footState?.lift ?? 0),
    y: (footState?.y ?? e.y) + ny * (footState?.lift ?? 0) };
  const side = Math.sign(rest.arc) * face;
  const coxa = { x: hip.x + tx * side * 2 + nx * .7, y: hip.y + ty * side * 2 + ny * .7 };
  const dx = foot.x - coxa.x, dy = foot.y - coxa.y, d = Math.max(.01, Math.hypot(dx, dy));
  const reach = Math.max(WEAVER_LEG_REACH_LOCO[index] - 2, d + .01), upper = reach * .48, lower = reach * .52;
  const along = Math.max(0, Math.min(d, (upper * upper - lower * lower + d * d) / (2 * d)));
  const arch = Math.sqrt(Math.max(0, upper * upper - along * along));
  const pole = (-dy * nx + dx * ny) >= 0 ? 1 : -1;
  const knee = { x: coxa.x + dx / d * along - dy / d * arch * pole,
    y: coxa.y + dy / d * along + dx / d * arch * pole };
  const ankle = { x: knee.x + (foot.x - knee.x) * .83, y: knee.y + (foot.y - knee.y) * .83 };
  return [hip, coxa, knee, ankle, foot];
}

export function pointOnSegment(x: number, y: number, a: LimbPoint, b: LimbPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
  const t = d2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / d2)) : 0;
  return Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
}

export function weaverBodyHit(e: Readonly<Enemy>, x: number, y: number, padding = 0): boolean {
  const loco = e.weaverLoco, nx = loco?.nx ?? 0, ny = loco?.ny ?? -1, face = loco?.face ?? 1;
  const dx = x - (loco?.px ?? e.x), dy = y - (loco?.py ?? e.y - 9);
  const along = (-ny * dx + nx * dy) * face, out = nx * dx + ny * dy;
  return ((along + 8) / (12.5 + padding)) ** 2 + ((out - 2) / (8.5 + padding)) ** 2 <= 1 ||
    ((along - 2) / (7.5 + padding)) ** 2 + (out / (6 + padding)) ** 2 <= 1 ||
    ((along - 10) / (7 + padding)) ** 2 + ((out - 1) / (5 + padding)) ** 2 <= 1;
}

/** Body overlap wins over occluded legs. No random limb is chosen by a torso hit. */
export function weaverLegAt(e: Readonly<Enemy>, x: number, y: number, padding = 1): number {
  if (e.kind !== 'weaver' || !e.weaverLoco || weaverBodyHit(e, x, y, padding)) return -1;
  let nearest = padding + 1, index = -1;
  for (let i = 0; i < 8; i++) {
    if ((e.weaverMissingLegs ?? 0) & (1 << i)) continue;
    const points = weaverLegGeometry(e, i);
    for (let j = 1; j < points.length; j++) {
      const distance = pointOnSegment(x, y, points[j - 1], points[j]);
      if (distance < nearest) { nearest = distance; index = i; }
    }
  }
  return index;
}

/** Jointed salvage, centred about its two ground contacts. */
export function looseLegGeometry(x: number, y: number, length: number, angle: number, curl = 0): LimbPoint[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-.5, 0], [-.12, -.24 - curl], [.36, -.045], [.5, 0]].map(([a, b]) => ({
    x: x + length * (a * cos - b * sin), y: y + length * (a * sin + b * cos),
  }));
}
