import type { Ctx, Enemy } from '@/core/types';
import { makeChain, shiftChain, stepChain } from '@/creatures/rig/chain';
import { findFloor, makeLeg, shiftLeg, stepLeg } from '@/creatures/rig/limb';
import { integrate, place, point, solidAt, translate, wrapAngle } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';

/**
 * The lizard body plan (Rain World): three chunks — hips, chest, head — slung
 * between four legs that grip real ground, a long physical tail and a head
 * that aims independently of the body with a hinged jaw. The Spitter is the
 * first lizard; the plan is parameterised so other long, low hunters can reuse
 * it.
 */

// Scalar slots.
export const LZ = {
  face: 0, // smoothed facing (-1..1): a turn swings the head over the chest
  headAng: 1, headAngV: 2,
  jaw: 3, jawV: 4,
  throat: 5, // acid sac swell 0..1
  breath: 6,
  lookX: 7, lookY: 8,
  rear: 9, // 0..1 head raised (anticipation)
  gait: 10,
  lastX: 11, lastY: 12,
  speed: 13,
  tongue: 14,
  blinkT: 15,
  sway: 16,
  land: 17, // landing squash
  airY: 18,
} as const;

export const LZ_HEAD = 0, LZ_CHEST = 1, LZ_HIPS = 2;
export const LZ_FRONT_NEAR = 0, LZ_FRONT_FAR = 1, LZ_BACK_NEAR = 2, LZ_BACK_FAR = 3;

export interface LizardSpec {
  /** Distance chest→hips. */
  body: number;
  /** Chest ride height over the ground. */
  ride: number;
  neck: number;
  upper: number;
  lower: number;
  tailLinks: number;
  tailSeg: number;
  tailR0: number;
}

export const SPITTER_LIZARD: LizardSpec = {
  body: 9.5, ride: 5.6, neck: 5.2, upper: 3.9, lower: 4.1, tailLinks: 10, tailSeg: 2.35, tailR0: 2.6,
};

function face(e: Enemy): number {
  return e.mind?.facing ?? (e.vx < 0 ? -1 : 1);
}

export function buildLizard(e: Enemy, spec: LizardSpec = SPITTER_LIZARD): CreatureRig {
  const rig = makeRig('lizard');
  const f = face(e), ground = e.y + 1;
  const chestX = e.x + f * spec.body * 0.4, hipsX = chestX - f * spec.body;
  rig.pts.push(point(chestX + f * spec.neck, ground - spec.ride - 1.5, 1.6));
  rig.pts.push(point(chestX, ground - spec.ride, 1.8));
  rig.pts.push(point(hipsX, ground - spec.ride + 0.4, 1.8));
  const hipOff = [f * 1.2, f * 2.2, -f * 0.2, f * 0.8];
  for (let i = 0; i < 4; i++) {
    const hx = (i < 2 ? chestX : hipsX) + hipOff[i];
    const leg = makeLeg(spec.upper, spec.lower, i < 2 ? f : -f, hx + f * 1.5, ground);
    leg.planted = false;
    rig.legs.push(leg);
  }
  rig.chains.push(makeChain(spec.tailLinks, hipsX - f * 1.5, ground - spec.ride + 0.8, -f, 0.25, spec.tailSeg, spec.tailR0, 0.45, 0.8));
  rig.f[LZ.face] = f;
  rig.f[LZ.headAng] = f > 0 ? 0.15 : Math.PI - 0.15;
  rig.f[LZ.lastX] = e.x; rig.f[LZ.lastY] = e.y;
  return rig;
}

/** Keep the rig with its body across teleports/respawns. */
function followTeleport(rig: CreatureRig, e: Enemy): void {
  const chest = rig.pts[LZ_CHEST];
  const dx = e.x - chest.x, dy = e.y - 4 - chest.y;
  if (Math.abs(dx) + Math.abs(dy) < 36) return;
  for (const p of rig.pts) translate(p, dx, dy);
  for (const leg of rig.legs) shiftLeg(leg, dx, dy);
  for (const c of rig.chains) shiftChain(c, dx, dy);
}

export function stepLizard(ctx: Ctx, e: Enemy, rig: CreatureRig, spec: LizardSpec = SPITTER_LIZARD): void {
  const world = ctx.world, tick = ctx.state.frameCount, F = rig.f;
  followTeleport(rig, e);
  const rig0 = e.expression;
  const target = face(e);
  // A turn is a swing, not a flip: the facing scalar eases through zero.
  F[LZ.face] += (target - F[LZ.face]) * 0.14;
  const fs = F[LZ.face];
  const fsign = fs >= 0 ? 1 : -1;
  const vx = e.x + e.fx - F[LZ.lastX], vy = e.y + e.fy - F[LZ.lastY];
  F[LZ.lastX] = e.x + e.fx; F[LZ.lastY] = e.y + e.fy;
  const moved = Math.abs(vx) < 8 ? vx : 0;
  F[LZ.speed] += (Math.abs(moved) - F[LZ.speed]) * 0.2;
  // Landing: remember the fall, spend it as squash.
  if (!e.grounded) F[LZ.airY] = Math.max(F[LZ.airY], vy);
  else if (F[LZ.airY] > 1.2) { F[LZ.land] = Math.min(1, F[LZ.airY] / 4); F[LZ.airY] = 0; }
  else F[LZ.airY] = 0;
  F[LZ.land] *= 0.86;
  F[LZ.breath] = Math.sin(tick * 0.055 + e.bobPhase) * (0.3 + (rig0?.fear ?? 0) * 0.4);

  // --- Anticipation read straight from the attack clock (no AI change) ---
  const aiming = e.alerted === true && (e.mind?.visible ?? false) && e.attackCd > 0 && e.attackCd < 18;
  const recoil = Math.min(1, (e.recoil ?? 0) / 14);
  F[LZ.throat] += ((aiming ? 1 - e.attackCd / 18 : 0) + recoil * 0.25 - F[LZ.throat]) * 0.25;
  F[LZ.rear] += ((aiming ? 1 : 0) - F[LZ.rear]) * 0.18;

  // --- Body chunks: springs toward a terrain-aware stance ---
  const ground = e.y + 1;
  const chestTX = e.x + fs * spec.body * 0.4 + moved * 1.5;
  const hipsTX = chestTX - fs * spec.body;
  const floorAt = (x: number): number => {
    const g = findFloor(world, x, ground - 7, ground + 5);
    return g ? g.y : ground;
  };
  const gChest = e.grounded ? floorAt(chestTX) : ground, gHips = e.grounded ? floorAt(hipsTX) : ground;
  const squash = F[LZ.land] * 1.6;
  const chestTY = Math.min(gChest, ground + 2) - spec.ride - F[LZ.breath] * 0.5 + squash - F[LZ.rear] * 2.4 + recoil * 0.8;
  const hipsTY = Math.min(gHips, ground + 2) - spec.ride + 0.5 + squash * 0.7;
  const chest = rig.pts[LZ_CHEST], hips = rig.pts[LZ_HIPS], head = rig.pts[LZ_HEAD];
  const body = { gravity: 0.08, damping: 0.8, wetDamping: 0.7, buoyancy: 0.2, friction: 0.5 };
  integrate(world, chest, body);
  integrate(world, hips, body);
  chest.x += (chestTX - chest.x) * 0.38; chest.y += (chestTY - chest.y) * 0.38;
  hips.x += (hipsTX - hips.x) * 0.3; hips.y += (hipsTY - hips.y) * 0.3;
  // Body length constraint (the spine does not stretch).
  {
    const dx = chest.x - hips.x, dy = chest.y - hips.y, d = Math.hypot(dx, dy) || 1;
    const err = (d - spec.body) / d;
    chest.x -= dx * err * 0.5; chest.y -= dy * err * 0.5; hips.x += dx * err * 0.5; hips.y += dy * err * 0.5;
  }

  // --- Head aim: the head hunts independently of the body ---
  const tx = e.mind?.targetX ?? e.x + fsign * 40, ty = (e.mind?.targetY ?? e.y) - 9;
  const sensed = (e.mind?.confidence ?? 0) > 0.12;
  let want: number;
  if (sensed) want = Math.atan2(ty - chest.y, tx - chest.x);
  else want = Math.atan2(Math.sin(tick * 0.011 + e.bobPhase * 3) * 0.35 + 0.1, fsign);
  // Keep the aim within a forward cone of the body; rear back while aiming.
  const bodyAng = Math.atan2(chest.y - hips.y, chest.x - hips.x);
  let rel = wrapAngle(want - bodyAng);
  rel = Math.max(-1.0, Math.min(0.75, rel));
  if (F[LZ.rear] > 0.02) rel = rel * (1 - F[LZ.rear]) + (-0.75 * fsign) * F[LZ.rear];
  if (recoil > 0) rel += 0.5 * recoil * fsign;
  const aimAng = bodyAng + rel;
  const dA = wrapAngle(aimAng - F[LZ.headAng]);
  F[LZ.headAngV] = F[LZ.headAngV] * 0.72 + dA * (sensed ? 0.16 : 0.07);
  F[LZ.headAng] = wrapAngle(F[LZ.headAng] + F[LZ.headAngV]);
  const neckX = chest.x + Math.cos(F[LZ.headAng]) * spec.neck, neckY = chest.y + Math.sin(F[LZ.headAng]) * spec.neck;
  integrate(world, head, { gravity: 0, damping: 0.7 });
  head.x += (neckX - head.x) * 0.55; head.y += (neckY - head.y) * 0.55;
  if (solidAt(world, head.x, head.y)) place(head, neckX, Math.min(neckY, chest.y));

  // --- Jaw: spit gape on recoil, idle pant, snap when hurt ---
  const jawWant = recoil > 0.05 ? 0.85 * recoil + 0.2 : Math.max(rig0?.jaw ?? 0, aiming ? 0.05 : 0) * 0.8
    + (sensed ? 0.04 + Math.max(0, Math.sin(tick * 0.09 + e.bobPhase)) * 0.06 : 0);
  F[LZ.jawV] = F[LZ.jawV] * 0.6 + (jawWant - F[LZ.jaw]) * 0.35;
  F[LZ.jaw] = Math.max(0, Math.min(1, F[LZ.jaw] + F[LZ.jawV]));

  // --- Legs: diagonal gait, each foot gripping real ground ---
  const legs = rig.legs;
  const lead = fs * (2.2 + Math.min(3, F[LZ.speed] * 7)) + moved * 5;
  const hipOff = [fs * 1.2, fs * 2.2, -fs * 0.2, fs * 0.8];
  for (let i = 0; i < 4; i++) {
    const leg = legs[i];
    // Elbows point back, knees point forward (a sprawling reptile).
    leg.bend = (i < 2 ? 1 : -1) * fsign;
    const anchor = i < 2 ? chest : hips;
    const hx = anchor.x + hipOff[i], hy = anchor.y + 0.6;
    const partnerA = legs[i === 0 ? 3 : i === 3 ? 0 : i === 1 ? 2 : 1];
    const sameSide = legs[i ^ 2];
    const canLift = partnerA.swing < 0 && sameSide.swing < 0 && e.grounded;
    const idealX = hx + lead + (i % 2 === 1 ? fs * 1.2 : 0);
    stepLeg(world, leg, hx, hy, idealX, ground, {
      stepDist: 3.0 + (i % 2) * 0.6, stepTicks: 7, lift: 2.2, search: 4, canLift, floorOnly: true, floorDepth: 6,
      hangX: fs * 1.5 - vx * 3, hangY: spec.upper + spec.lower - 1.5,
    });
  }

  // --- Tail: rooted behind the hips, dragging, swishing with the gait ---
  const tail = rig.chains[0];
  const bx = hips.x - chest.x, by = hips.y - chest.y, bl = Math.hypot(bx, by) || 1;
  const swish = Math.sin(tick * 0.045 + e.bobPhase) * 0.05 + Math.sin(tick * 0.21) * Math.min(0.08, F[LZ.speed] * 0.3);
  stepChain(world, tail, hips.x + bx / bl * 1.4, hips.y + by / bl * 1.4 - 0.4, bx / bl, by / bl - 0.12, {
    gravity: 0.24, damping: 0.9, wetDamping: 0.75, buoyancy: -0.3, friction: 0.45,
    stiffness: 0.24, rootStiffness: 0.6, curl: swish * -fsign, iterations: 2,
  });
  rig.tick = tick;
}
