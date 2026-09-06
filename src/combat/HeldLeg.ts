import type { Ctx, Enemy, HeldLegPoint, HeldLegRig } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';
import type { World } from '@/sim/World';
import { pointHitsCreature } from '@/creatures/body';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { sightClear } from '@/creatures/perception';

const STEPS = 6, DT = 1 / STEPS;
const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const copy = (to: HeldLegPoint, from: HeldLegPoint): void => { to.x = from.x; to.y = from.y; };

function clearRod(world: World, anchor: HeldLegPoint, angle: number, length: number): boolean {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (let d = 2; d <= length; d += 1) {
    const x = Math.floor(anchor.x + dx * d), y = Math.floor(anchor.y + dy * d);
    if (!world.inBounds(x, y) || blocksEntity(world.type(x, y))) return false;
  }
  return true;
}

function contactAngle(world: World, anchor: HeldLegPoint, desired: number, length: number, reference: number, limit = Math.PI): number {
  const bounded = reference + Math.max(-limit, Math.min(limit, angleDelta(desired, reference)));
  if (clearRod(world, anchor, bounded, length)) return bounded;
  // Collision is uncommon and confined to one carried item. Rotate out of a
  // wall/floor while preserving the joint length, never stretch through it.
  for (let i = 1; i <= 26; i++) for (const side of [-1, 1]) {
    const candidate = bounded + side * i * .12;
    if (Math.abs(angleDelta(candidate, reference)) <= limit && clearRod(world, anchor, candidate, length)) return candidate;
  }
  return reference;
}

/** The ankle is gripped. A spring drives the thin shank; the heavier severed
 * thigh hangs from its knee. Its position/velocity solve only on fixed ticks. */
export function updateHeldLeg(ctx: Ctx): HeldLegRig | null {
  const p = ctx.player, club = p.legClub;
  if (!club || p.dead) return null;
  const hand = { x: p.x + p.facing * 4, y: p.y - (p.crawling ? 4 : 10) };
  const shank = club.length * .55, thigh = club.length * .45;
  const rest = p.facing > 0 ? -1.12 : -2.02;
  let rig = club.rig;
  if (!rig || Math.hypot(hand.x - rig.hand.x, hand.y - rig.hand.y) > 60) {
    const knee = { x: hand.x + Math.cos(rest) * shank, y: hand.y + Math.sin(rest) * shank };
    const folded = rest + p.facing * 2.5;
    const hip = { x: knee.x + Math.cos(folded) * thigh, y: knee.y + Math.sin(folded) * thigh };
    rig = club.rig = { hand, knee, hip, previousHand: { ...hand }, previousKnee: { ...knee }, previousHip: { ...hip },
      wrist: rest, wristVelocity: 0, vx: p.vx, vy: p.vy };
  }
  copy(rig.previousHand, rig.hand); copy(rig.previousKnee, rig.knee); copy(rig.previousHip, rig.hip);
  const swinging = club.swingT > 0, elapsed = 18 - club.swingT;
  // Five ticks to gather the limb, then a quick wrist stroke and follow-through.
  const stroke = Math.max(0, Math.min(1, (elapsed - 4) / 8));
  const desired = swinging ? club.angle + p.facing * (-1.65 + stroke * 3.3) : rest;
  const stiffness = swinging ? .62 : .15, damping = swinging ? .30 : .24;
  for (let substep = 1; substep <= STEPS; substep++) {
    const t = substep / STEPS;
    rig.hand.x = rig.previousHand.x + (hand.x - rig.previousHand.x) * t;
    rig.hand.y = rig.previousHand.y + (hand.y - rig.previousHand.y) * t;
    rig.wristVelocity += (angleDelta(desired, rig.wrist) * stiffness - rig.wristVelocity * damping) * DT;
    rig.wristVelocity = Math.max(-.8, Math.min(.8, rig.wristVelocity));
    const target = rig.wrist + rig.wristVelocity * DT;
    const wrist = contactAngle(ctx.world, rig.hand, target, shank, rig.wrist);
    if (Math.abs(angleDelta(wrist, target)) > .05) rig.wristVelocity *= .25;
    rig.wrist = wrist;
    rig.knee.x = rig.hand.x + Math.cos(wrist) * shank; rig.knee.y = rig.hand.y + Math.sin(wrist) * shank;
    const oldX = rig.hip.x, oldY = rig.hip.y;
    const drag = p.inLiquid ? .955 : .996;
    rig.vx *= drag; rig.vy = rig.vy * drag + .42 * DT;
    const x = oldX + rig.vx * DT, y = oldY + rig.vy * DT;
    const angle = contactAngle(ctx.world, rig.knee, Math.atan2(y - rig.knee.y, x - rig.knee.x), thigh, wrist, 2.8);
    rig.hip.x = rig.knee.x + Math.cos(angle) * thigh; rig.hip.y = rig.knee.y + Math.sin(angle) * thigh;
    rig.vx = Math.max(-18, Math.min(18, (rig.hip.x - oldX) / DT));
    rig.vy = Math.max(-18, Math.min(18, (rig.hip.y - oldY) / DT));
  }
  return rig;
}

/** Sweep the visible thigh between solved poses. The handle itself cannot hit
 * a foe that the flopping striking segment never reaches. */
export function heldLegContact(ctx: Ctx, enemy: Enemy, rig: Pick<HeldLegRig,
  'hand' | 'knee' | 'hip' | 'previousHand' | 'previousKnee' | 'previousHip'>): HeldLegPoint | null {
  const speed = Math.hypot(rig.hip.x - rig.previousHip.x, rig.hip.y - rig.previousHip.y);
  const steps = Math.max(1, Math.ceil(speed));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, kx = rig.previousKnee.x + (rig.knee.x - rig.previousKnee.x) * t,
      ky = rig.previousKnee.y + (rig.knee.y - rig.previousKnee.y) * t;
    const hx = rig.previousHip.x + (rig.hip.x - rig.previousHip.x) * t,
      hy = rig.previousHip.y + (rig.hip.y - rig.previousHip.y) * t;
    const span = Math.ceil(Math.hypot(hx - kx, hy - ky));
    for (let j = 0; j <= span; j++) {
      const x = kx + (hx - kx) * j / span, y = ky + (hy - ky) * j / span;
      if (pointHitsCreature(enemy, ENEMY_DEFS[enemy.kind], x, y, 2)
        && sightClear(ctx.world, rig.hand.x, rig.hand.y, x, y)) return { x, y };
    }
  }
  return null;
}
