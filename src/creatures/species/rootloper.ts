import type { Ctx, Enemy } from '@/core/types';
import { makeChain, reachChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { integrate, point, translate } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';

/**
 * Root Loper — a long-legs of the overgrowth. A gnarled seed-bulb slung
 * between six root tentacles; each tentacle is a real rope that hauls itself
 * to the grip its foot found (e.feet, planted by the pose tick) and hangs
 * slack when it loses one. A seventh root is the whip it lashes you with.
 */
export const RL = { face: 0, lastX: 1, lastY: 2, sway: 3, lash: 4, frond: 5, panic: 6, blink: 7 } as const;
export const RL_BODY = 0;
export const RL_WHIP = 6;

export function buildRootLoper(e: Enemy): CreatureRig {
  const rig = makeRig('rootloper');
  const cx = e.x, cy = e.y - 9;
  rig.pts.push(point(cx, cy, 2.5));
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    rig.chains.push(makeChain(8, cx + side * 2, cy + 2, side * 0.7, 1, 2.2, 1.3, 0.35, 0.5));
  }
  rig.chains.push(makeChain(10, cx, cy - 2, 1, -0.4, 2.2, 1.1, 0.3, 0.4));
  rig.f[RL.face] = e.mind?.facing ?? 1; rig.f[RL.lastX] = e.x; rig.f[RL.lastY] = e.y;
  return rig;
}

export function stepRootLoper(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const world = ctx.world, F = rig.f, tick = ctx.state.frameCount;
  const x = e.x + e.fx, y = e.y + e.fy;
  const vx = x - F[RL.lastX];
  F[RL.lastX] = x; F[RL.lastY] = y;
  F[RL.face] += ((e.mind?.facing ?? 1) - F[RL.face]) * 0.1;
  const fs = F[RL.face];
  F[RL.panic] += (((e.rootPanic ?? 0) > 0 ? 1 : 0) - F[RL.panic]) * 0.15;
  const body = rig.pts[RL_BODY];
  if (Math.abs(body.x - x) + Math.abs(body.y - y + 9) > 40) {
    const dx = x - body.x, dy = y - 9 - body.y;
    translate(body, dx, dy);
    for (const c of rig.chains) shiftChain(c, dx, dy);
  }
  // The bulb hangs in its tentacles: it sags, sways, and rides the step.
  F[RL.sway] = Math.sin(tick * 0.05 + e.bobPhase) * 0.8 + vx * 2;
  const support = e.rootSupport ?? 0.5;
  integrate(world, body, { gravity: 0.05, damping: 0.8 });
  body.x += (x + F[RL.sway] * 0.3 - body.x) * 0.3;
  body.y += (y - 9 + (1 - support) * 1.2 + F[RL.panic] * Math.sin(tick * 0.6) * 0.4 - body.y) * 0.3;
  // Root tentacles reach for the grips the feet found.
  const feet = e.feet;
  for (let i = 0; i < 6; i++) {
    const c = rig.chains[i];
    const side = i < 3 ? -1 : 1, k = i % 3;
    const rx = body.x + side * (1.2 + k * 0.9), ry = body.y + 2.2;
    stepChain(world, c, rx, ry, side * (0.6 + k * 0.2), 1, {
      gravity: 0.14, damping: 0.85, stiffness: 0.12, rootStiffness: 0.5,
      curl: side * -0.08 + Math.sin(tick * 0.07 + i) * 0.05, collide: true, friction: 0.6,
    });
    const foot = feet?.[i];
    if (foot) {
      // Planted roots haul taut toward their grip; loose ones only feel for it.
      reachChain(world, c, foot.x, foot.y, foot.planted ? 0.55 : 0.12);
    }
  }
  // The whip: coiled over the back, drawn back on the windup, cracked out on the lash.
  const whip = rig.chains[RL_WHIP];
  const lashT = e.rootLashT ?? 0, winding = (e.windup ?? 0) > 0;
  F[RL.lash] += ((lashT > 0 ? 1 : 0) - F[RL.lash]) * 0.5;
  stepChain(world, whip, body.x + fs * 1.2, body.y - 2.5, winding ? -fs * 0.6 : fs * 0.4, -1, {
    gravity: winding ? -0.05 : 0.06, damping: 0.84, stiffness: winding ? 0.35 : 0.2, rootStiffness: 0.8,
    curl: winding ? fs * 0.32 : -fs * 0.18 + Math.sin(tick * 0.04) * 0.08, collide: false,
  });
  if (lashT > 0 && e.rootLashX !== undefined && e.rootLashY !== undefined) {
    const t = Math.sin(Math.PI * (1 - lashT / 10));
    reachChain(world, whip, e.rootLashX, e.rootLashY, 0.35 + t * 0.6);
  }
  F[RL.frond] += 0.04 + Math.abs(vx) * 0.2;
}
