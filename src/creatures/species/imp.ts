import type { Ctx, Enemy } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { integrate, point, translate } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';

/**
 * Imp — an ember cicada. A charred thorax hangs under a blur of four wings,
 * three ember tentacles whip behind every change of direction, and a fireball
 * gathers between its claws in the beats before it throws.
 */
export const IMP = {
  buzz: 0, face: 1, lastX: 2, lastY: 3, vx: 4, vy: 5, charge: 6, throwT: 7, lastCd: 8, tilt: 9,
} as const;
export const IMP_BODY = 0, IMP_HEAD = 1;

export function buildImp(e: Enemy): CreatureRig {
  const rig = makeRig('imp');
  const cx = e.x, cy = e.y - 7;
  rig.pts.push(point(cx, cy, 1.2), point(cx, cy - 3, 0));
  for (let i = 0; i < 3; i++) rig.chains.push(makeChain(8, cx - 1 + i, cy + 3, 0, 1, 1.7, 0.9 - i * 0.1, 0.25, 0.3));
  // Two little clawed arms.
  rig.chains.push(makeChain(3, cx + 1, cy, 1, 0.5, 1.4, 0.55, 0.35, 0));
  rig.chains.push(makeChain(3, cx - 1, cy, -1, 0.5, 1.4, 0.55, 0.35, 0));
  rig.f[IMP.face] = e.mind?.facing ?? 1;
  rig.f[IMP.lastX] = e.x; rig.f[IMP.lastY] = e.y;
  rig.f[IMP.lastCd] = e.attackCd;
  return rig;
}

export function stepImp(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const world = ctx.world, F = rig.f, tick = ctx.state.frameCount;
  const x = e.x + e.fx, y = e.y + e.fy;
  const vx = x - F[IMP.lastX], vy = y - F[IMP.lastY];
  F[IMP.lastX] = x; F[IMP.lastY] = y;
  const jump = Math.abs(vx) + Math.abs(vy) > 24;
  F[IMP.vx] = jump ? 0 : F[IMP.vx] * 0.8 + vx * 0.2; F[IMP.vy] = jump ? 0 : F[IMP.vy] * 0.8 + vy * 0.2;
  const facing = (e.mind?.visible ? Math.sign((e.mind.targetX - e.x) || 1) : e.mind?.facing) ?? 1;
  F[IMP.face] += (facing - F[IMP.face]) * 0.12;
  F[IMP.buzz] = (F[IMP.buzz] + 0.9) % (Math.PI * 2);
  F[IMP.tilt] += (Math.max(-0.45, Math.min(0.45, F[IMP.vx] * 0.35)) - F[IMP.tilt]) * 0.12;
  // Charge-up read from the attack clock; the throw is the cooldown resetting.
  const aiming = e.alerted === true && (e.mind?.visible ?? false) && e.attackCd > 0 && e.attackCd < 26;
  F[IMP.charge] += ((aiming ? 1 - e.attackCd / 26 : 0) - F[IMP.charge]) * 0.25;
  if (e.attackCd > F[IMP.lastCd] + 40) F[IMP.throwT] = 12;
  F[IMP.lastCd] = e.attackCd;
  if (F[IMP.throwT] > 0) F[IMP.throwT]--;
  const body = rig.pts[IMP_BODY], head = rig.pts[IMP_HEAD];
  if (Math.abs(body.x - x) + Math.abs(body.y - y + 7) > 40) {
    const dx = x - body.x, dy = y - 7 - body.y;
    for (const p of rig.pts) translate(p, dx, dy);
    for (const c of rig.chains) shiftChain(c, dx, dy);
  }
  // Wingbeat micro-bob and a hover that leans into its travel.
  const bob = Math.sin(tick * 0.21 + e.bobPhase) * 0.6;
  integrate(world, body, { gravity: 0.02, damping: 0.75 });
  body.x += (x - body.x) * 0.3; body.y += (y - 7 + bob - body.y) * 0.3;
  const hx = body.x + F[IMP.face] * 1.2 + F[IMP.tilt] * 1.5, hy = body.y - 3.2 + F[IMP.charge] * 0.6 - F[IMP.throwT] * 0.05;
  head.x += (hx - head.x) * 0.5; head.y += (hy - head.y) * 0.5;
  // Ember tentacles trail from the abdomen: they lag and whip on turns.
  const ax = -F[IMP.vx] * 0.9, ay = 1;
  for (let i = 0; i < 3; i++) {
    const s = i - 1;
    stepChain(world, rig.chains[i], body.x - F[IMP.face] * 0.6 + s * 0.8, body.y + 2.6, ax + s * 0.25 - F[IMP.face] * 0.25, ay, {
      gravity: 0.05, damping: 0.9, stiffness: 0.12, rootStiffness: 0.5,
      curl: Math.sin(tick * 0.08 + i * 2.1) * 0.12, collide: true, friction: 0.2,
    });
  }
  // Arms reach toward the target while charging; claws cup the fireball.
  const tx = e.mind?.targetX ?? x + F[IMP.face] * 30, ty = (e.mind?.targetY ?? y) - 9;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const c = rig.chains[3 + i];
    const rootX = body.x + F[IMP.face] * 0.8 + s * 0.9, rootY = body.y - 0.6;
    let dx = F[IMP.face] * 1 + s * 0.4, dy = 0.9;
    const ch = F[IMP.charge];
    if (ch > 0.05 || F[IMP.throwT] > 0) {
      const ddx = tx - rootX, ddy = ty - rootY, d = Math.hypot(ddx, ddy) || 1;
      dx = dx * (1 - ch) + ddx / d * ch * 1.4; dy = dy * (1 - ch) + ddy / d * ch * 1.4 - ch * 0.3;
    }
    stepChain(world, c, rootX, rootY, dx, dy, { gravity: 0.04, damping: 0.7, stiffness: 0.55, rootStiffness: 0.8, curl: s * 0.3, collide: false });
  }
}
