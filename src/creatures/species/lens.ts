import type { Ctx, Enemy } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { integrate, point, translate } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';

/** Pose beats of the Lenswright's lance (mirrors creatures/bosses/lenswright LENS). */
const LANCE_POSE = { LOCK: 38, FIRE: 54, FIRE_END: 70, SWEEP_END: 94 } as const;

/**
 * The Lenswright — a floating great lens. One body point rides the flight
 * line with a little lag (it hangs, it does not fly); five crystal drops swing
 * beneath it on real chains that lag every drift and snag on what they brush.
 * The rig's scalars carry the reads the art needs: the iris (shut → open on the
 * lance's tell, wide while it burns), the lock, the dazzle.
 */
export const LNS = { face: 0, lastX: 1, lastY: 2, vx: 3, vy: 4, iris: 5, lock: 6, fire: 7, dazzle: 8, spin: 9, glow: 10 } as const;
export const LNS_BODY = 0;
export const LNS_DROPS = 5;

export function buildLens(e: Enemy): CreatureRig {
  const rig = makeRig('lens');
  const cx = e.x, cy = e.y - 11;
  rig.pts.push(point(cx, cy, 2));
  for (let i = 0; i < LNS_DROPS; i++) {
    const s = i / (LNS_DROPS - 1) * 2 - 1;
    rig.chains.push(makeChain(4 + (i % 2), cx + s * 7, cy + 7 - Math.abs(s) * 2, 0, 1, 1.6, 0.8, 0.5, 0.5));
  }
  rig.f[LNS.face] = e.mind?.facing ?? 1;
  rig.f[LNS.lastX] = e.x; rig.f[LNS.lastY] = e.y;
  return rig;
}

export function stepLens(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const world = ctx.world, F = rig.f, tick = ctx.state.frameCount;
  const x = e.x + e.fx, y = e.y + e.fy;
  const vx = x - F[LNS.lastX], vy = y - F[LNS.lastY];
  F[LNS.lastX] = x; F[LNS.lastY] = y;
  const jump = Math.abs(vx) + Math.abs(vy) > 24;
  F[LNS.vx] = jump ? 0 : F[LNS.vx] * 0.85 + vx * 0.15; F[LNS.vy] = jump ? 0 : F[LNS.vy] * 0.85 + vy * 0.15;
  F[LNS.face] += ((e.mind?.facing ?? 1) - F[LNS.face]) * 0.06;
  // The iris and the lance, from the boss brain's clock (the tell IS the timer).
  const b = e.boss, m = b?.move, t = b?.moveT ?? 0;
  const lancing = m === 'lance' || m === 'sweep';
  const end = m === 'sweep' ? LANCE_POSE.SWEEP_END : LANCE_POSE.FIRE_END;
  const irisT = lancing ? (t < LANCE_POSE.FIRE ? 0.25 + 0.6 * (t / LANCE_POSE.FIRE) : t < end ? 1 : 0.2) : m === 'flare' ? 0.9 : m === 'dazzled' ? 0 : 0.18;
  F[LNS.iris] += (irisT - F[LNS.iris]) * 0.2;
  F[LNS.lock] += (((lancing && t >= LANCE_POSE.LOCK && t < end) ? 1 : 0) - F[LNS.lock]) * 0.3;
  F[LNS.fire] += (((lancing && t >= LANCE_POSE.FIRE && t < end) ? 1 : 0) - F[LNS.fire]) * 0.5;
  F[LNS.dazzle] += ((m === 'dazzled' ? 1 : 0) - F[LNS.dazzle]) * 0.15;
  F[LNS.spin] += 0.01 + F[LNS.iris] * 0.03;
  F[LNS.glow] += ((0.5 + F[LNS.iris] * 0.8 + F[LNS.fire] * 1.2) * (1 - F[LNS.dazzle] * 0.8) - F[LNS.glow]) * 0.2;
  const body = rig.pts[LNS_BODY];
  const hy = y - 11 + Math.sin(tick * 0.05 + e.bobPhase) * 0.8;
  if (Math.abs(body.x - x) + Math.abs(body.y - hy) > 40) {
    const dx = x - body.x, dy = hy - body.y;
    translate(body, dx, dy);
    for (const c of rig.chains) shiftChain(c, dx, dy);
  }
  integrate(world, body, { gravity: 0, damping: 0.8 });
  body.x += (x - body.x) * 0.25; body.y += (hy - body.y) * 0.25;
  for (let i = 0; i < LNS_DROPS; i++) {
    const s = i / (LNS_DROPS - 1) * 2 - 1;
    stepChain(world, rig.chains[i], body.x + s * 7, body.y + 7 - Math.abs(s) * 2, -F[LNS.vx] * 0.6, 1, {
      gravity: 0.12, damping: 0.9, stiffness: 0.08, rootStiffness: 0.5,
      curl: Math.sin(tick * 0.04 + i * 1.7) * 0.05, collide: true, friction: 0.2,
    });
  }
}
