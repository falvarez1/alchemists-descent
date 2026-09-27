import type { Ctx, Enemy } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { integrate, point, translate } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';

/**
 * Wisp — a frost jellyfish. The bell swims in beats (contract, glide,
 * relax); tentacles and frilled oral arms drift behind every beat with real
 * inertia and snag on the rock they brush.
 */
export const WSP = { pulse: 0, face: 1, lastX: 2, lastY: 3, vx: 4, vy: 5, squeeze: 6, glow: 7, charge: 8, lastCd: 9 } as const;
export const WSP_BELL = 0;
export const WSP_TENTACLES = 7;

export function bellRim(F: Float64Array): { rx: number; ry: number } {
  const s = F[WSP.squeeze];
  return { rx: 5.4 * (1 - s * 0.24), ry: 4.2 * (1 + s * 0.2) };
}

export function buildWisp(e: Enemy): CreatureRig {
  const rig = makeRig('wisp');
  const cx = e.x, cy = e.y - 6;
  rig.pts.push(point(cx, cy, 1.5));
  for (let i = 0; i < WSP_TENTACLES; i++) {
    const t = i / (WSP_TENTACLES - 1);
    rig.chains.push(makeChain(9, cx - 4.5 + t * 9, cy + 2, 0, 1, 1.35, 0.42, 0.14, 0.3));
  }
  // Two frilled oral arms from the centre.
  rig.chains.push(makeChain(6, cx - 0.8, cy + 2, 0, 1, 1.6, 0.9, 0.35, 0.4));
  rig.chains.push(makeChain(6, cx + 0.8, cy + 2, 0, 1, 1.6, 0.9, 0.35, 0.4));
  rig.f[WSP.face] = e.mind?.facing ?? 1;
  rig.f[WSP.lastX] = e.x; rig.f[WSP.lastY] = e.y;
  rig.f[WSP.pulse] = (e.bobPhase * 0.3) % 1;
  rig.f[WSP.lastCd] = e.attackCd;
  return rig;
}

export function stepWisp(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const world = ctx.world, F = rig.f, tick = ctx.state.frameCount;
  const x = e.x + e.fx, y = e.y + e.fy;
  const vx = x - F[WSP.lastX], vy = y - F[WSP.lastY];
  F[WSP.lastX] = x; F[WSP.lastY] = y;
  const jump = Math.abs(vx) + Math.abs(vy) > 24;
  F[WSP.vx] = jump ? 0 : F[WSP.vx] * 0.85 + vx * 0.15; F[WSP.vy] = jump ? 0 : F[WSP.vy] * 0.85 + vy * 0.15;
  if (Math.abs(F[WSP.vx]) > 0.1) F[WSP.face] += (Math.sign(F[WSP.vx]) - F[WSP.face]) * 0.08;
  // Swim beats: faster when it flees or presses; a slow drift when calm.
  const urgency = Math.min(1, Math.hypot(F[WSP.vx], F[WSP.vy]) * 0.9 + (e.fear ?? 0) * 0.5);
  F[WSP.pulse] = (F[WSP.pulse] + 0.012 + urgency * 0.018) % 1;
  const p = F[WSP.pulse];
  // Contract hard (0..0.25), glide (..0.55), relax/refill (..1).
  const squeeze = p < 0.25 ? Math.sin(p / 0.25 * Math.PI * 0.5) : p < 0.55 ? 1 - (p - 0.25) / 0.3 * 0.3 : 0.7 * (1 - (p - 0.55) / 0.45);
  F[WSP.squeeze] = squeeze;
  const aiming = e.alerted === true && (e.mind?.visible ?? false) && e.attackCd > 0 && e.attackCd < 24;
  F[WSP.charge] += ((aiming ? 1 - e.attackCd / 24 : 0) - F[WSP.charge]) * 0.2;
  F[WSP.glow] += ((0.55 + squeeze * 0.25 + F[WSP.charge] * 0.6) - F[WSP.glow]) * 0.2;
  F[WSP.lastCd] = e.attackCd;
  const bell = rig.pts[WSP_BELL];
  if (Math.abs(bell.x - x) + Math.abs(bell.y - y + 6) > 40) {
    const dx = x - bell.x, dy = y - 6 - bell.y;
    translate(bell, dx, dy);
    for (const c of rig.chains) shiftChain(c, dx, dy);
  }
  // The bell rides the flight line but each contraction is a little surge.
  integrate(world, bell, { gravity: 0, damping: 0.8 });
  const surge = (p < 0.25 ? 1 : 0) * 0.5;
  bell.x += (x - bell.x) * 0.22; bell.y += (y - 6 - surge - bell.y) * 0.22;
  const { rx } = bellRim(F);
  const n = WSP_TENTACLES;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), s = t * 2 - 1;
    const rootX = bell.x + s * rx * 0.9, rootY = bell.y + 1.6 + (1 - Math.abs(s)) * 0.4;
    // Contraction flicks the tentacles outward; gliding lets them stream.
    const flick = p < 0.25 ? s * 0.7 : s * 0.15;
    stepChain(world, rig.chains[i], rootX, rootY, flick - F[WSP.vx] * 0.5, 1, {
      gravity: 0.03, damping: 0.88, wetDamping: 0.8, buoyancy: 0.5, stiffness: 0.06, rootStiffness: 0.4,
      curl: Math.sin(tick * 0.05 + i * 1.3) * 0.08, collide: true, friction: 0.1,
    });
  }
  for (let k = 0; k < 2; k++) {
    const s = k === 0 ? -1 : 1;
    stepChain(world, rig.chains[n + k], bell.x + s * 0.8, bell.y + 1.8, s * 0.2 - F[WSP.vx] * 0.4, 1, {
      gravity: 0.04, damping: 0.86, stiffness: 0.18, rootStiffness: 0.6,
      curl: Math.sin(tick * 0.06 + k * 2) * 0.18, collide: true, friction: 0.1,
    });
  }
}
