import type { Ctx, Enemy } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { findFloor, makeLeg, shiftLeg, solveKnee, stepLeg } from '@/creatures/rig/limb';
import { integrate, point, translate } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';

/**
 * Mage — a masked scavenger shaman. Long digitigrade legs pick their way over
 * real ground, a tattered cape swings behind, one hand works a walking staff,
 * and when it reaches for the level both arms rise and the mask's glyph
 * ignites.
 */
export const MG = {
  face: 0, lastX: 1, lastY: 2, speed: 3, cast: 4, bob: 5, staffX: 6, staffY: 7, lookX: 8, lookY: 9,
  hover: 10, blinkFx: 11, lastJet: 12,
} as const;
export const MG_PELVIS = 0, MG_CHEST = 1, MG_HEAD = 2;
export const MG_NEAR_ARM = 2, MG_FAR_ARM = 3;
export const MG_CAPE = 0; // chains 0..2

const HIP = 7.2, CHEST = 11.2, NECK = 3.2;

export function buildMage(e: Enemy): CreatureRig {
  const rig = makeRig('mage');
  const f = e.mind?.facing ?? 1, g = e.y + 1;
  rig.pts.push(point(e.x, g - HIP, 1.2), point(e.x + f * 0.8, g - CHEST, 1.2), point(e.x + f * 1.6, g - CHEST - NECK, 0));
  rig.legs.push(makeLeg(3.9, 4.3, -f, e.x + f, g), makeLeg(3.9, 4.3, -f, e.x - f, g));
  rig.legs.push(makeLeg(3.6, 3.8, f, e.x + f * 3, g - 6), makeLeg(3.6, 3.8, f, e.x - f * 2, g - 6));
  for (let i = 0; i < 3; i++) rig.chains.push(makeChain(7, e.x - f * (0.5 + i * 0.9), g - CHEST + 0.5, -f * 0.3, 1, 1.45, 0.6, 0.4, 0.4));
  rig.f[MG.face] = f; rig.f[MG.lastX] = e.x; rig.f[MG.lastY] = e.y;
  rig.f[MG.staffX] = e.x - f * 3; rig.f[MG.staffY] = g;
  return rig;
}

export function stepMage(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const world = ctx.world, F = rig.f, tick = ctx.state.frameCount;
  const x = e.x + e.fx, y = e.y + e.fy, ground = e.y + 1;
  const vx = x - F[MG.lastX], vy = y - F[MG.lastY];
  F[MG.lastX] = x; F[MG.lastY] = y;
  const jump = Math.abs(vx) + Math.abs(vy) > 20;
  const pelvis = rig.pts[MG_PELVIS], chest = rig.pts[MG_CHEST], head = rig.pts[MG_HEAD];
  if (jump || Math.abs(pelvis.x - x) > 30) {
    const dx = x - pelvis.x, dy = ground - HIP - pelvis.y;
    for (const p of rig.pts) translate(p, dx, dy);
    for (const l of rig.legs) shiftLeg(l, dx, dy);
    for (const c of rig.chains) shiftChain(c, dx, dy);
    F[MG.staffX] += dx; F[MG.staffY] += dy;
    if (jump) F[MG.blinkFx] = 1;
  }
  F[MG.blinkFx] *= 0.9;
  const mv = jump ? 0 : vx;
  F[MG.speed] += (Math.abs(mv) - F[MG.speed]) * 0.2;
  const tgtFace = e.mind?.visible ? Math.sign((e.mind.targetX - x) || 1) : (e.mind?.facing ?? 1);
  F[MG.face] += (tgtFace - F[MG.face]) * 0.1;
  const fs = F[MG.face], fsign = fs >= 0 ? 1 : -1;
  // e.blink is the telekinesis telegraph (20 frames): the cast pose.
  F[MG.cast] += ((e.blink > 0 ? 1 : 0) - F[MG.cast]) * 0.18;
  F[MG.hover] += ((e.blink > 0 ? 1.2 : 0) - F[MG.hover]) * 0.08;
  // Head bob with each step, like a wading bird (and a scavenger).
  F[MG.bob] = Math.sin(tick * 0.18) * Math.min(1, F[MG.speed] * 3) * 0.5;
  const g = e.grounded ? (findFloor(world, x, ground - 5, ground + 3)?.y ?? ground) : ground;
  const hunch = 1 - F[MG.cast];
  const pTX = x - fs * 0.4, pTY = g - HIP + F[MG.bob] * 0.5 - F[MG.hover];
  const cTX = x + fs * (1.6 * hunch + 0.2), cTY = g - CHEST + hunch * 0.9 - F[MG.hover] - F[MG.cast] * 0.6;
  integrate(world, pelvis, { gravity: 0.06, damping: 0.75 }); integrate(world, chest, { gravity: 0.06, damping: 0.75 });
  pelvis.x += (pTX - pelvis.x) * 0.35; pelvis.y += (pTY - pelvis.y) * 0.35;
  chest.x += (cTX - chest.x) * 0.3; chest.y += (cTY - chest.y) * 0.3;
  // Head: looks at what it hunts, the mask tilting with interest.
  const tx = e.mind?.targetX ?? x + fsign * 40, ty = (e.mind?.targetY ?? y) - 9;
  const sensed = (e.mind?.confidence ?? 0) > 0.12;
  F[MG.lookX] += ((sensed ? Math.max(-1, Math.min(1, (tx - chest.x) / 50)) : fs * 0.5 + Math.sin(tick * 0.02 + e.bobPhase) * 0.4) - F[MG.lookX]) * 0.1;
  F[MG.lookY] += ((sensed ? Math.max(-1, Math.min(1, (ty - chest.y) / 50)) : Math.sin(tick * 0.017) * 0.3) - F[MG.lookY]) * 0.1;
  const hx = chest.x + fs * (1.4 * hunch + 0.3) + F[MG.lookX] * 0.8, hy = chest.y - NECK + F[MG.bob] + F[MG.lookY] * 0.6 + hunch * 0.6;
  head.x += (hx - head.x) * 0.4; head.y += (hy - head.y) * 0.4;
  // Legs: a careful, high-stepping walk.
  for (let i = 0; i < 2; i++) {
    const leg = rig.legs[i];
    leg.bend = -fsign; // digitigrade: knees forward
    const hx2 = pelvis.x + (i === 0 ? fs * 0.5 : -fs * 0.5), hy2 = pelvis.y + 0.4;
    const other = rig.legs[1 - i];
    stepLeg(world, leg, hx2, hy2, hx2 + fs * (1.2 + Math.min(3, F[MG.speed] * 6)) + mv * 5, g, {
      stepDist: 2.6, stepTicks: 9, lift: 2.4, search: 3, canLift: other.swing < 0 && e.grounded, floorOnly: true, floorDepth: 5,
      hangX: fs * 1, hangY: 7,
    });
  }
  // Staff: planted ahead of the rear hand, re-planted as the body passes it.
  const staffReach = x - fs * 1.5;
  if (Math.abs(F[MG.staffX] - (staffReach + fs * 2)) > 4.5 || !e.grounded) {
    F[MG.staffX] = staffReach + fs * (2.5 + Math.min(2, F[MG.speed] * 5));
    F[MG.staffY] = g;
  }
  // Arms.
  const castUp = F[MG.cast];
  for (let i = 0; i < 2; i++) {
    const arm = rig.legs[2 + i];
    const near = i === 0;
    arm.bend = near ? fsign : -fsign;
    const sx = chest.x + (near ? fs * 0.6 : -fs * 0.4), sy = chest.y + 0.8;
    let ax: number, ay: number;
    if (castUp > 0.05) {
      // Arms spread and raised, palms toward the target.
      const up = near ? -1 : 1;
      ax = sx + fs * 3.2 * castUp + up * -1.5 * castUp + (near ? 0 : -fs * 2 * castUp);
      ay = sy - 5.8 * castUp + Math.sin(tick * 0.3 + i) * 0.4 * castUp;
      if (!near) { ax = ax * castUp + (F[MG.staffX] + fs * 0.2) * (1 - castUp); ay = ay * castUp + (F[MG.staffY] - 8) * (1 - castUp); }
    } else if (near) {
      // Free hand swings loosely, opposite the front leg.
      const swing = Math.sin(tick * 0.18) * Math.min(1, F[MG.speed] * 3);
      ax = sx + fs * (1.6 + swing * 1.4); ay = sy + 5.6;
    } else {
      ax = F[MG.staffX] - fs * 0.3; ay = F[MG.staffY] - 7.6;
    }
    arm.x += (ax - arm.x) * 0.35; arm.y += (ay - arm.y) * 0.35;
    const dx = arm.x - sx, dy = arm.y - sy, d = Math.hypot(dx, dy), reach = arm.upper + arm.lower;
    if (d > reach) { arm.x = sx + dx / d * reach; arm.y = sy + dy / d * reach; }
    solveKnee(arm, sx, sy);
  }
  // Tattered cape hanging from the shoulders.
  for (let i = 0; i < 3; i++) {
    const c = rig.chains[i];
    stepChain(world, c, chest.x - fs * (0.2 + i * 1.1), chest.y - 0.4 - i * 0.1, -fs * (0.35 + i * 0.25) - mv * 0.6, 1, {
      gravity: 0.1, damping: 0.86, stiffness: 0.08 + i * 0.03, rootStiffness: 0.4, curl: fs * 0.04 * i,
      collide: true, friction: 0.3, forceX: -mv * 0.05,
    });
  }
}
