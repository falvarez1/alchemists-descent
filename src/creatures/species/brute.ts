import type { Ctx, Enemy } from '@/core/types';
import { findFloor, makeLeg, shiftLeg, solveKnee, stepLeg } from '@/creatures/rig/limb';
import { integrate, point, translate } from '@/creatures/rig/physics';
import { makeRig } from '@/creatures/rig/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { idleEnvelope } from '@/creatures/idle';

/** Pose beats of the Colossus's moves (mirrors creatures/bosses/colossus COL). */
const COL_POSE = { SLAM_HIT: 30, STOMP_HIT: 32, THROW_HIT: 32, VENT_START: 42, VENT_END: 76, DEATH_OVERLOAD: 128 } as const;

/**
 * Brutes — the golem and the Kiln Colossus. Heavy knuckle-walkers: the fists
 * are front feet that plant on real ground, the hind legs are short pillars,
 * and all that stone rides on top with weight — a dip on every plant, a sway
 * through every stride, a wind-up you can read from across the room.
 */
export const BR = {
  face: 0, lastX: 1, lastY: 2, speed: 3, sway: 4, dip: 5,
  punch: 6, throwT: 7, lastCd: 8, slam: 9, heat: 10, airY: 11, land: 12, jet: 13, breath: 14,
  lookX: 15, lookY: 16,
  // Boss poses (the Kiln Colossus reads its BossBrain; see creatures/bosses/colossus).
  rear: 17, vent: 18, kneel: 19, overload: 20, reach: 21,
} as const;
export const BR_HIPS = 0, BR_CHEST = 1, BR_HEAD = 2;
/** Legs: 0 near hind, 1 far hind, 2 near arm, 3 far arm. */
export const BR_NEAR_ARM = 2, BR_FAR_ARM = 3;

export interface BruteSpec {
  scale: number;
  hip: number; // hip height
  shoulder: number; // shoulder height
  body: number; // hips→chest distance
  legU: number; legL: number;
  armU: number; armL: number;
}

export const GOLEM: BruteSpec = { scale: 1, hip: 8, shoulder: 12.8, body: 9.5, legU: 4.5, legL: 4.5, armU: 6.2, armL: 7.0 };
/** The Kiln Colossus: the golem's plan at 2.3x — a head above the alchemist's reach, shoulders like a kiln roof. */
export const COLOSSUS: BruteSpec = { scale: 2.3, hip: 18, shoulder: 29, body: 21, legU: 10.2, legL: 10.2, armU: 14, armL: 16 };

/** The Rime Warden (the Cold Store's guardian): the same plan at 1.75x — a head taller than the alchemist. */
export const RIME: BruteSpec = { scale: 1.75, hip: 14, shoulder: 22.4, body: 16.6, legU: 7.9, legL: 7.9, armU: 10.8, armL: 12.2 };
/** The Rime Warden's thaw clock (creatures/bosses/rimeWarden RIME.THAW_TICKS): its heat reads 0..1 of it. */
const RIME_THAW_TICKS = 80;

export function bruteSpec(e: Enemy): BruteSpec {
  return e.kind === 'colossus' ? COLOSSUS : e.kind === 'rimewarden' ? RIME : GOLEM;
}

export function buildBrute(e: Enemy): CreatureRig {
  const spec = bruteSpec(e), rig = makeRig('brute');
  const f = e.mind?.facing ?? 1, ground = e.y + 1;
  rig.pts.push(point(e.x - f * spec.body * 0.35, ground - spec.hip, 2 * spec.scale));
  rig.pts.push(point(e.x + f * spec.body * 0.65, ground - spec.shoulder, 2.4 * spec.scale));
  rig.pts.push(point(e.x + f * (spec.body * 0.65 + 3 * spec.scale), ground - spec.shoulder + 2 * spec.scale, 0));
  for (let i = 0; i < 4; i++) {
    const arm = i >= 2;
    const leg = makeLeg(arm ? spec.armU : spec.legU, arm ? spec.armL : spec.legL, arm ? f : -f, e.x + f * (arm ? spec.body : -spec.body * 0.3), ground);
    rig.legs.push(leg);
  }
  rig.f[BR.face] = f; rig.f[BR.lastX] = e.x; rig.f[BR.lastY] = e.y; rig.f[BR.lastCd] = e.attackCd;
  rig.f[BR.heat] = 1;
  return rig;
}

export function stepBrute(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  const world = ctx.world, F = rig.f, spec = bruteSpec(e), S = spec.scale, tick = ctx.state.frameCount;
  const x = e.x + e.fx, y = e.y + e.fy, ground = e.y + 1;
  const vx = x - F[BR.lastX], vy = y - F[BR.lastY];
  F[BR.lastX] = x; F[BR.lastY] = y;
  const jump = Math.abs(vx) + Math.abs(vy) > 30;
  const hips = rig.pts[BR_HIPS], chest = rig.pts[BR_CHEST], head = rig.pts[BR_HEAD];
  if (jump || Math.abs(chest.x - x) > 40 * S) {
    const dx = x - chest.x, dy = ground - spec.shoulder - chest.y;
    for (const p of rig.pts) translate(p, dx, dy);
    for (const l of rig.legs) shiftLeg(l, dx, dy);
  }
  const mv = jump ? 0 : vx;
  F[BR.speed] += (Math.abs(mv) - F[BR.speed]) * 0.15;
  // A heavy body turns slowly.
  F[BR.face] += ((e.mind?.facing ?? 1) - F[BR.face]) * 0.07;
  const fs = F[BR.face], fsign = fs >= 0 ? 1 : -1;
  // Landing weight.
  if (!e.grounded) F[BR.airY] = Math.max(F[BR.airY], vy);
  else if (F[BR.airY] > 1) { F[BR.land] = Math.min(1, F[BR.airY] / 3); F[BR.airY] = 0; }
  else F[BR.airY] = 0;
  F[BR.land] *= 0.88;
  F[BR.breath] = Math.sin(tick * 0.04 + e.bobPhase) * 0.35 * S;
  // Attack reads: a wall punch, a rock throw (cooldown reset), a slam.
  const punching = Math.min(1, (e.punching ?? 0) / 16);
  F[BR.punch] += (punching - F[BR.punch]) * 0.35;
  const boss = e.boss;
  if (boss) {
    // A boss poses from the same clock its attacks fire on: the tell IS the timer.
    const m = boss.move, t = boss.moveT;
    const slamT = m === 'slam' ? (t < COL_POSE.SLAM_HIT ? t / COL_POSE.SLAM_HIT : 0) : 0;
    F[BR.slam] += (slamT - F[BR.slam]) * (slamT > F[BR.slam] ? 0.18 : 0.55);
    const rearT = m === 'stomp' ? (t < COL_POSE.STOMP_HIT ? t / COL_POSE.STOMP_HIT : 0) : 0;
    F[BR.rear] += (rearT - F[BR.rear]) * (rearT > F[BR.rear] ? 0.15 : 0.6);
    F[BR.throwT] = m === 'throw' && t >= COL_POSE.THROW_HIT - 8 && t < COL_POSE.THROW_HIT + 18 ? Math.max(0, 26 - (t - (COL_POSE.THROW_HIT - 8))) : 0;
    F[BR.reach] += ((m === 'throw' && t < COL_POSE.THROW_HIT - 8 ? 1 : 0) - F[BR.reach]) * 0.15;
    const ventT = m === 'vent' ? (t < COL_POSE.VENT_START ? t / COL_POSE.VENT_START : t < COL_POSE.VENT_END ? 1 : 0) : 0;
    F[BR.vent] += (ventT - F[BR.vent]) * 0.12;
    const kneelT = m === 'quench' ? (t < 140 ? 1 : 0) : m === 'dying' ? Math.min(1, t / 70) : 0;
    F[BR.kneel] += (kneelT - F[BR.kneel]) * (kneelT > F[BR.kneel] ? 0.12 : 0.05);
    F[BR.overload] = m === 'dying' ? Math.max(0, Math.min(1, (t - COL_POSE.DEATH_OVERLOAD) / 60)) : 0;
    // The Warden's heat is its thaw clock (a plate melts at RIME_THAW_TICKS), read 0..1.
    const heat = e.kind === 'rimewarden' ? boss.heat / RIME_THAW_TICKS : boss.heat * (0.85 + Math.sin(tick * 0.09 + e.bobPhase) * 0.15);
    F[BR.heat] += (heat - F[BR.heat]) * 0.08;
  } else {
    if (e.attackCd > F[BR.lastCd] + 30) F[BR.throwT] = 26;
    if (F[BR.throwT] > 0) F[BR.throwT]--;
    const windup = e.alerted === true && (e.mind?.visible ?? false) && e.attackCd > 0 && e.attackCd < 22;
    F[BR.slam] += ((windup ? 1 - e.attackCd / 22 : 0) - F[BR.slam]) * 0.2;
    const wet = e.status.wet > 0;
    F[BR.heat] += ((wet ? 0.25 : 0.85 + Math.sin(tick * 0.09 + e.bobPhase) * 0.15) - F[BR.heat]) * 0.08;
  }
  F[BR.lastCd] = e.attackCd;
  F[BR.jet] += ((e.jetFuel > 0 ? 1 : 0) - F[BR.jet]) * 0.3;
  // Gait sway: the body rolls onto whichever side is planted.
  const planted0 = rig.legs[0].planted && rig.legs[0].swing < 0, planted1 = rig.legs[1].planted && rig.legs[1].swing < 0;
  F[BR.sway] += (((planted0 ? 1 : 0) - (planted1 ? 1 : 0)) * 0.6 * S * Math.min(1, F[BR.speed] * 4) - F[BR.sway]) * 0.12;
  let dip = 0;
  for (const l of rig.legs) if (l.swing >= 0 && l.swing < 0.25) dip += 0.35 * S;
  F[BR.dip] += (dip - F[BR.dip]) * 0.3;

  // Body chunks.
  const floorAt = (fx: number): number => { const g = findFloor(world, fx, ground - 6 * S, ground + 4 * S); return g ? g.y : ground; };
  const gH = e.grounded ? Math.min(floorAt(hips.x), ground + 2) : ground, gC = e.grounded ? Math.min(floorAt(chest.x + fs * 3 * S), ground + 3) : ground;
  // Idle life: a resting brute shifts its weight down onto its haunches and back up.
  const settle = e.idle?.act === 'settle' ? idleEnvelope(e.idle) : 0;
  const crouch = F[BR.land] * 2.2 * S + F[BR.dip] + F[BR.slam] * -1.5 * S + F[BR.kneel] * 4.2 * S + settle * 1.6 * S;
  const rear = F[BR.rear] * 5 * S; // it rears back on its hind legs before a stomp
  const hipTX = x - fs * spec.body * 0.42 - fs * F[BR.rear] * 1.5 * S, hipTY = gH - spec.hip + crouch * 0.6 + F[BR.breath] * 0.2 + F[BR.kneel] * 1.2 * S;
  const chTX = x + fs * spec.body * (0.58 - F[BR.rear] * 0.3) - F[BR.punch] * fs * -1.5 * S,
    chTY = gC - spec.shoulder + crouch + F[BR.breath] - F[BR.throwT] / 26 * 1.5 * S - rear;
  const heavy = { gravity: 0.1, damping: 0.78, friction: 0.6 };
  integrate(world, hips, heavy); integrate(world, chest, heavy);
  hips.x += (hipTX - hips.x) * 0.3; hips.y += (hipTY - hips.y) * 0.3;
  chest.x += (chTX - chest.x) * 0.25; chest.y += (chTY - chest.y) * 0.25;
  {
    const dx = chest.x - hips.x, dy = chest.y - hips.y, d = Math.hypot(dx, dy) || 1, err = (d - spec.body) / d;
    chest.x -= dx * err * 0.5; chest.y -= dy * err * 0.5; hips.x += dx * err * 0.5; hips.y += dy * err * 0.5;
  }
  // Head: sunk between the shoulders, tracking the target.
  const tx = e.mind?.targetX ?? x + fsign * 50, ty = (e.mind?.targetY ?? y) - 9;
  const sensed = (e.mind?.confidence ?? 0) > 0.12;
  const lx = sensed ? Math.max(-1, Math.min(1, (tx - chest.x) / 60)) : fs * 0.6;
  const ly = sensed ? Math.max(-1, Math.min(1, (ty - chest.y) / 60)) : Math.sin(tick * 0.013 + e.bobPhase) * 0.3;
  F[BR.lookX] += (lx - F[BR.lookX]) * 0.08; F[BR.lookY] += (ly - F[BR.lookY]) * 0.08;
  const hx = chest.x + fs * 2.6 * S + F[BR.lookX] * 1.2 * S, hy = chest.y + 1.2 * S + F[BR.lookY] * 1.2 * S + F[BR.kneel] * 1.6 * S;
  head.x += (hx - head.x) * 0.3; head.y += (hy - head.y) * 0.3;

  // Limbs.
  const legs = rig.legs;
  const lead = fs * (1.5 + Math.min(4, F[BR.speed] * 8)) * S + mv * 6;
  for (let i = 0; i < 4; i++) {
    const leg = legs[i], arm = i >= 2, far = i % 2 === 1;
    const anchor = arm ? chest : hips;
    const hx2 = anchor.x + (far ? fs * 1.2 * S : -fs * 0.4 * S), hy2 = anchor.y + (arm ? 0.5 * S : 0.8 * S);
    leg.bend = arm ? fsign : -fsign;
    // Arms busy with a punch/throw/slam leave the ground entirely.
    const busyArm = arm && !far && (F[BR.punch] > 0.08 || F[BR.throwT] > 0 || F[BR.slam] > 0.1 || F[BR.reach] > 0.1);
    const busyBoth = arm && (F[BR.slam] > 0.1 || F[BR.rear] > 0.1);
    if (busyArm || busyBoth) {
      leg.planted = false; leg.swing = -1;
      let px: number, py: number;
      if (F[BR.slam] > 0.1) {
        // Both fists rise overhead, then come down together.
        px = hx2 + fs * 2 * S; py = hy2 - (spec.armU + spec.armL) * 0.9 * F[BR.slam];
      } else if (F[BR.rear] > 0.1) {
        // Reared back: fists raised out front, ready to drive into the floor.
        px = hx2 + fs * (4 + (far ? 2 : 0)) * S; py = hy2 - (spec.armU + spec.armL) * 0.55 * F[BR.rear];
      } else if (F[BR.reach] > 0.1) {
        // Reaching into its own furnace for the molten gob.
        px = hx2 + fs * 1.2 * S; py = hy2 + 1.5 * S;
      } else if (F[BR.throwT] > 0) {
        const t = 1 - F[BR.throwT] / 26;
        const a = -Math.PI * 0.95 + t * Math.PI * 1.25; // overhead → forward release
        px = hx2 + Math.cos(a) * fs * (spec.armU + spec.armL) * 0.9; py = hy2 + Math.sin(a) * (spec.armU + spec.armL) * 0.85;
      } else {
        const p = F[BR.punch];
        const cock = p > 0.6 ? 1 : p / 0.6;
        px = hx2 + fs * (spec.armU + spec.armL) * (p > 0.6 ? 0.95 : 0.3 - cock * 0.5); py = hy2 + (p > 0.6 ? 2 * S : -4 * S * cock);
      }
      leg.x += (px - leg.x) * 0.45; leg.y += (py - leg.y) * 0.45;
      const dx = leg.x - hx2, dy = leg.y - hy2, d = Math.hypot(dx, dy), reach = leg.upper + leg.lower;
      if (d > reach) { leg.x = hx2 + dx / d * reach; leg.y = hy2 + dy / d * reach; }
      solveKnee(leg, hx2, hy2);
      continue;
    }
    const partner = legs[i === 0 ? 3 : i === 3 ? 0 : i === 1 ? 2 : 1];
    const pair = legs[i ^ 1];
    const canLift = partner.swing < 0 && pair.swing < 0 && e.grounded;
    const ideal = hx2 + lead * (arm ? 1.1 : 0.9) + (arm ? fs * 4.2 * S : -fs * 0.5 * S);
    stepLeg(world, leg, hx2, hy2, ideal, ground, {
      stepDist: (arm ? 4.5 : 3.8) * S, stepTicks: Math.round(11 * Math.sqrt(S)), lift: (arm ? 3.2 : 2.2) * S,
      search: 4, canLift, floorOnly: true, floorDepth: 6 * S,
      hangX: fs * 1.5 * S, hangY: (arm ? spec.armU + spec.armL : spec.legU + spec.legL) - 1.5 * S,
    });
  }
}
