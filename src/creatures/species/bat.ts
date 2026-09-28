import type { Ctx, Enemy } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { integrate, place, point, solidAt, translate } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { idleEnvelope } from '@/creatures/idle';

/**
 * Bat: a furred body that lags its flight line, jointed wings whose finger
 * tips ride springs (so a downstroke whips and an upstroke folds), dangling
 * hind legs, and a real pendulum roost from the ceiling it grips.
 */
export const BAT = {
  flap: 0, flapRate: 1, face: 2, lastX: 3, lastY: 4, vx: 5, vy: 6,
  roostX: 7, roostY: 8, roosted: 9, ear: 10, spread: 11, fold: 12, bank: 13,
} as const;

/** Rig point slots: body, head, then 3 finger tips + elbow per wing. */
export const BAT_BODY = 0, BAT_HEAD = 1;
export const batTip = (side: number, finger: number): number => 2 + (side < 0 ? 0 : 4) + finger; // finger 0..2 tips, 3 = elbow

export function buildBat(e: Enemy): CreatureRig {
  const rig = makeRig('bat');
  const cx = e.x, cy = e.y - 3;
  rig.pts.push(point(cx, cy, 1.0), point(cx, cy - 2.5, 0));
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) rig.pts.push(point(cx + s * (6 + k * 2), cy - 1 + k, 0));
  // Hind legs.
  rig.chains.push(makeChain(3, cx - 1, cy + 2, 0, 1, 1.2, 0.5, 0.35, 0));
  rig.chains.push(makeChain(3, cx + 1, cy + 2, 0, 1, 1.2, 0.5, 0.35, 0));
  rig.f[BAT.face] = e.mind?.facing ?? 1;
  rig.f[BAT.lastX] = e.x; rig.f[BAT.lastY] = e.y;
  rig.f[BAT.flap] = (e.bobPhase * 0.37) % 1;
  return rig;
}

/** Wing pose targets for one side in body space (+x outward), phase-driven. */
export function batWingTargets(F: Float64Array, side: number, bx: number, by: number, out: Float64Array): void {
  const p = F[BAT.flap];
  // Asymmetric stroke: a fast, powerful downstroke then a slower folded recovery.
  const w = p < 0.42 ? Math.cos(Math.PI * p / 0.42) : -Math.cos(Math.PI * (p - 0.42) / 0.58);
  const spread = F[BAT.spread], fold = F[BAT.fold];
  const theta = (0.2 + 0.72 * w) * spread + (1 - spread) * 1.25; // radians above horizontal
  const recovery = p >= 0.42 ? Math.sin(Math.PI * (p - 0.42) / 0.58) : 0;
  const bend = 0.35 + recovery * 0.7 + fold * 1.1;
  const shX = bx + side * 1.4, shY = by - 1.2;
  const L1 = 4.4 * (1 - fold * 0.45), L2 = 4.6 * (1 - fold * 0.5);
  const a1 = -theta, a2 = -theta + bend;
  const ex = shX + side * Math.cos(a1) * L1, ey = shY + Math.sin(a1) * L1;
  const wx = ex + side * Math.cos(a2) * L2, wy = ey + Math.sin(a2) * L2;
  out[0] = shX; out[1] = shY; out[2] = ex; out[3] = ey; out[4] = wx; out[5] = wy;
  // Three fingers fan down from the wrist; they splay open on the downstroke.
  const fan = (0.55 + (1 - recovery) * 0.35) * (1 - fold * 0.6);
  for (let k = 0; k < 3; k++) {
    const a = a2 + 0.45 + k * fan * 0.62;
    const L = (5.4 - k * 0.9) * (1 - fold * 0.55);
    out[6 + k * 2] = wx + side * Math.cos(a) * L;
    out[7 + k * 2] = wy + Math.sin(a) * L;
  }
}

const WT = new Float64Array(12);

export function stepBat(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const world = ctx.world, F = rig.f;
  const x = e.x + e.fx, y = e.y + e.fy;
  const vx = x - F[BAT.lastX], vy = y - F[BAT.lastY];
  F[BAT.lastX] = x; F[BAT.lastY] = y;
  const jump = Math.abs(vx) + Math.abs(vy) > 24;
  F[BAT.vx] = jump ? 0 : F[BAT.vx] * 0.7 + vx * 0.3; F[BAT.vy] = jump ? 0 : F[BAT.vy] * 0.7 + vy * 0.3;
  if (Math.abs(F[BAT.vx]) > 0.15) F[BAT.face] += (Math.sign(F[BAT.vx]) - F[BAT.face]) * 0.2;
  const body = rig.pts[BAT_BODY], head = rig.pts[BAT_HEAD];
  if (Math.abs(body.x - x) + Math.abs(body.y - y) > 40) {
    const dx = x - body.x, dy = y - 3 - body.y;
    for (const p of rig.pts) translate(p, dx, dy);
    for (const c of rig.chains) shiftChain(c, dx, dy);
  }
  const slimed = (e.slimed ?? 0) > 0, tumbling = (e.tumble ?? 0) > 0;
  const roost = e.sleeping === true && !slimed;
  // Wing drive: effort from climbing, the flare before a dart, a folded dive.
  let rate = 0.085 + Math.min(0.05, Math.max(0, -F[BAT.vy]) * 0.04) + Math.min(0.03, Math.abs(F[BAT.vx]) * 0.012);
  let spread = 1, fold = 0;
  if ((e.windup ?? 0) > 0) { rate = 0.14; spread = 1.1; }
  if ((e.swoop ?? 0) > 0) { rate = 0.03; fold = 0.75; }
  if (tumbling) { rate = 0.2; spread = 0.7 + Math.sin(ctx.state.frameCount * 0.9) * 0.3; }
  if (slimed) { rate = 0.02; fold = 0.4; spread = 0.35; }
  if (roost) { rate = 0; fold = 1; spread = 0; }
  F[BAT.flapRate] += (rate - F[BAT.flapRate]) * 0.2;
  F[BAT.flap] = (F[BAT.flap] + F[BAT.flapRate]) % 1;
  F[BAT.spread] += (spread - F[BAT.spread]) * 0.2;
  F[BAT.fold] += (fold - F[BAT.fold]) * 0.2;
  F[BAT.bank] += (Math.max(-0.5, Math.min(0.5, F[BAT.vx] * 0.25)) - F[BAT.bank]) * 0.15;
  F[BAT.ear] += ((e.expression?.alert ?? 0) - F[BAT.ear]) * 0.1;

  if (roost) {
    // Grip the ceiling above and hang from it as a pendulum.
    if (F[BAT.roosted] === 0) {
      let cy = y - 5;
      while (cy > y - 30 && !solidAt(world, x, cy - 1)) cy--;
      F[BAT.roostX] = x; F[BAT.roostY] = cy; F[BAT.roosted] = 1;
    }
    const ax = F[BAT.roostX], ay = F[BAT.roostY];
    integrate(world, body, { gravity: 0.12, damping: 0.97 });
    const dx = body.x - ax, dy = body.y - ay, d = Math.hypot(dx, dy) || 1;
    body.x = ax + dx / d * 4.2; body.y = ay + dy / d * 4.2;
    place(head, body.x + dx / d * 3, body.y + dy / d * 3);
  } else {
    F[BAT.roosted] = 0;
    // The body hangs off the flight line: each downstroke lifts it.
    const p = F[BAT.flap];
    const lift = (p < 0.42 ? Math.sin(Math.PI * p / 0.42) : 0) * 0.9 * F[BAT.spread];
    const tx = x, ty = y - 3 - lift;
    integrate(world, body, { gravity: 0.05, damping: 0.72 });
    body.x += (tx - body.x) * 0.45; body.y += (ty - body.y) * 0.45;
    const hx = body.x + F[BAT.face] * 0.6 + (e.expression?.gazeX ?? 0) * 0.5, hy = body.y - 2.6 + Math.abs(F[BAT.bank]) * 0.3;
    head.x += (hx - head.x) * 0.5; head.y += (hy - head.y) * 0.5;
  }
  // Wing tips: spring-driven toward the stroke targets so they lag and whip.
  // Idle life on the roost: one wing unfolds all the way, holds, and folds back.
  const stretch = roost && e.idle?.act === 'stretch' ? idleEnvelope(e.idle) : 0;
  for (const side of [-1, 1]) {
    if (stretch > 0 && side === e.idle?.side) {
      const fo = F[BAT.fold], sp = F[BAT.spread];
      F[BAT.fold] = fo * (1 - stretch * 0.85); F[BAT.spread] = sp + stretch * 0.95;
      batWingTargets(F, side, body.x, body.y, WT);
      F[BAT.fold] = fo; F[BAT.spread] = sp;
    } else batWingTargets(F, side, body.x, body.y, WT);
    const k = roost ? 0.6 : 0.42;
    const el = rig.pts[batTip(side, 3)];
    integrate(world, el, { gravity: 0, damping: 0.55 });
    el.x += (WT[2] - el.x) * 0.6; el.y += (WT[3] - el.y) * 0.6;
    for (let f = 0; f < 3; f++) {
      const tp = rig.pts[batTip(side, f)];
      integrate(world, tp, { gravity: 0.04, damping: 0.62 });
      tp.x += (WT[6 + f * 2] - tp.x) * k; tp.y += (WT[7 + f * 2] - tp.y) * k;
    }
  }
  // Hind legs trail from the hips (upward when roosting: they hold the ceiling).
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    const c = rig.chains[i];
    if (roost) {
      stepChain(world, c, body.x + s * 0.8, body.y - 1.6, (F[BAT.roostX] + s * 0.8 - body.x), (F[BAT.roostY] - body.y), {
        gravity: -0.1, damping: 0.8, stiffness: 0.8, collide: false,
      });
    } else {
      stepChain(world, c, body.x + s * 0.9, body.y + 1.8, -F[BAT.vx] * 0.5 + s * 0.2, 1, {
        gravity: 0.12, damping: 0.85, stiffness: 0.35, curl: s * 0.2, collide: false,
      });
    }
  }
}
