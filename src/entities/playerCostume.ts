import type { Ctx, PlayerRagdollRig, PlayerState } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import type { Chain } from '@/creatures/rig/chain';
import { makeSkeleton, poseAlchemist, poseRagdoll } from './playerPose';
import type { Skeleton } from './playerPose';

/**
 * The alchemist's costume physics: two split coat tails, the mantle's hem
 * and the hat's crooked crown are verlet chains hung off the posed skeleton.
 * They drag behind a sprint, flare in a fall, puddle in a crouch, whip on a
 * kick — and stay on the body when it ragdolls. Presentation only: movement
 * and collision never read it; it is not saved.
 */
export interface PlayerCostume {
  tails: [Chain, Chain];
  mantle: Chain;
  crown: Chain;
  skel: Skeleton;
  tick: number;
  /** Vial bounce spring (cells) and velocity. */
  vial: number;
  vialV: number;
}

function build(s: Skeleton): PlayerCostume {
  const f = s.facing;
  return {
    tails: [makeChain(5, s.hip.x - f * 1.5, s.hip.y, -f * 0.3, 1, 1.25, 1.3, 0.8, 0.45),
      makeChain(5, s.hip.x + f * 1.0, s.hip.y, f * 0.2, 1, 1.2, 1.2, 0.7, 0.45)],
    mantle: makeChain(4, s.chest.x - f * 2.5, s.chest.y, -f * 0.5, 1, 1.0, 1.4, 0.8, 0.4),
    crown: makeChain(4, s.crown.x, s.crown.y, -f * 0.4, -1, 1.25, 1.2, 0.35, 0),
    skel: s, tick: -1, vial: 0, vialV: 0,
  };
}

/** Advance the costume one tick (alive: hung off the pose; dead: off the ragdoll). */
export function stepPlayerCostume(ctx: Ctx, a: PlayerState, ragdoll: PlayerRagdollRig | null): void {
  if (ctx.state.mode !== 'play') return;
  const tick = ctx.state.frameCount;
  const skel = a.costume?.skel ?? makeSkeleton();
  if (a.dead) {
    if (!ragdoll) return;
    poseRagdoll(ragdoll.parts, ragdoll.facing, skel);
  } else poseAlchemist(ctx, a, skel);
  const c = a.costume ??= build(skel);
  if (c.tick === tick) return;
  c.tick = tick;
  const f = skel.facing, world = ctx.world;
  // Keep the cloth with the body across respawns/teleports.
  const t0 = c.tails[0].pts[0];
  if (Math.abs(t0.x - skel.hip.x) + Math.abs(t0.y - skel.hip.y) > 30) {
    const dx = skel.hip.x - t0.x, dy = skel.hip.y - t0.y;
    for (const ch of [c.tails[0], c.tails[1], c.mantle, c.crown]) shiftChain(ch, dx, dy);
  }
  // Torso axis (down the back toward the hip) for rooting the cloth.
  const ax = skel.hip.x - skel.chest.x, ay = skel.hip.y - skel.chest.y, al = Math.hypot(ax, ay) || 1;
  const dx = ax / al, dy = ay / al; // points down the spine
  const bx = -dy * f, by = dx * f; // points "back" (away from facing) perpendicular to the spine
  const vx = a.dead ? 0 : a._svx, vy = a.dead ? 0 : a._svy;
  const flare = skel.flare, crouch = skel.crouch;
  const cloth = {
    gravity: 0.16 - flare * 0.22 - skel.lift * 0.12, damping: 0.86, wetDamping: 0.7, buoyancy: -0.2,
    friction: 0.5, collide: true, iterations: 2,
    forceX: -vx * 0.035, forceY: -vy * 0.03 + skel.lift * -0.04,
  };
  // Split tails: the rear one hangs from the back seam, the front one from the hip.
  stepChain(world, c.tails[0], skel.hip.x + bx * 1.6, skel.hip.y + by * 1.6, dx + bx * (0.35 + Math.abs(vx) * 0.25), dy + by * 0.15, {
    ...cloth, stiffness: 0.3 - crouch * 0.15, rootStiffness: 0.65, curl: -f * (0.04 + Math.abs(vx) * 0.05),
  });
  stepChain(world, c.tails[1], skel.hip.x - bx * 0.9, skel.hip.y - by * 0.9, dx - bx * 0.15, dy, {
    ...cloth, stiffness: 0.34 - crouch * 0.15, rootStiffness: 0.7, curl: -f * 0.03,
  });
  // Mantle hem: short, heavier, lifts off the shoulders at speed.
  stepChain(world, c.mantle, skel.chest.x + bx * 2.4, skel.chest.y + by * 2.4 - 0.4, dx * 0.6 + bx * (0.5 + Math.abs(vx) * 0.3), dy * 0.6, {
    ...cloth, gravity: cloth.gravity * 0.8, stiffness: 0.45, rootStiffness: 0.8, curl: -f * 0.05,
  });
  // Crooked crown: the hat's tip flops back against motion and bends at the fold.
  const up = { x: -dx, y: -dy };
  stepChain(world, c.crown, skel.crown.x, skel.crown.y, up.x + bx * 0.4, up.y + by * 0.4, {
    gravity: a.dead ? 0.18 : 0.05, damping: 0.8, stiffness: a.dead ? 0.2 : 0.55, rootStiffness: 0.92,
    curl: -f * 0.26, collide: false, forceX: -vx * 0.03 - f * 0.008, forceY: -vy * 0.02,
  });
  // Vial on the bandolier: a stiff little spring that jolts with the stride.
  const jolt = a.dead ? 0 : (a.landTimer > 0 ? 0.15 : 0) + vy * -0.05;
  c.vialV = c.vialV * 0.72 + (-c.vial * 0.3) + jolt;
  c.vial = Math.max(-1, Math.min(1, c.vial + c.vialV));
}
