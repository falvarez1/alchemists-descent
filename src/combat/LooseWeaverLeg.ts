import type { Ctx, HeldLegPoint, HeldLegRig, Pickup } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { clamp } from '@/core/math';
import { packRGB } from '@/sim/colors';
import { blocksEntity, isLiquid } from '@/sim/CellType';
import { heldLegContact, updateHeldLeg } from './HeldLeg';
import { recordTrickshot } from './Trickshot';

interface Node extends HeldLegPoint { vx: number; vy: number }
export interface LooseLegPose {
  hand: Node; knee: Node; hip: Node;
  previousHand: HeldLegPoint; previousKnee: HeldLegPoint; previousHip: HeldLegPoint;
}
// Pose and angular velocity are transient. The pickup retains its position,
// linear momentum, joint angles, provenance, durability and armed state in saves.
const poses = new WeakMap<Pickup, LooseLegPose>();
export const looseLegPose = (pickup: Pickup): LooseLegPose | undefined => poses.get(pickup);
const point = (p: HeldLegPoint): HeldLegPoint => ({ x: p.x, y: p.y });
const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

function remember(pose: LooseLegPose): void {
  Object.assign(pose.previousHand, point(pose.hand));
  Object.assign(pose.previousKnee, point(pose.knee));
  Object.assign(pose.previousHip, point(pose.hip));
}

function createPose(p: Pickup, held?: HeldLegRig): LooseLegPose {
  const length = p.data.legLength ?? 34, a = p.data.legAngle ?? -1.12, b = a + (p.data.legBend ?? 2.5);
  const knee = held ? point(held.knee) : { x: p.x, y: p.y };
  const hand = held ? point(held.hand) : { x: knee.x - Math.cos(a) * length * .55, y: knee.y - Math.sin(a) * length * .55 };
  const hip = held ? point(held.hip) : { x: knee.x + Math.cos(b) * length * .45, y: knee.y + Math.sin(b) * length * .45 };
  const pose = { hand: { ...hand, vx: p.vx, vy: p.vy }, knee: { ...knee, vx: p.vx, vy: p.vy },
    hip: { ...hip, vx: p.vx, vy: p.vy }, previousHand: point(hand), previousKnee: point(knee), previousHip: point(hip) };
  if (held) {
    pose.hip.vx += held.vx * .18; pose.hip.vy += held.vy * .18;
    pose.hand.vx -= held.wristVelocity * (hand.y - knee.y) * .3;
    pose.hand.vy += held.wristVelocity * (hand.x - knee.x) * .3;
  }
  poses.set(p, pose); return pose;
}

/** Returns true when the equipped limb owns this action, including a blocked
 * release. The caller must not fall through to throwing a flask or grabbing. */
export function releaseWeaverLeg(ctx: Ctx, throwIt: boolean): boolean {
  const p = ctx.player, club = p.legClub;
  if (!club) return false;
  if (p.dead || ctx.state.mode !== 'play' || ctx.state.paused || !ctx.levels.current) return true;
  const rig = club.rig ?? updateHeldLeg(ctx);
  if (!rig) return true;
  const angle = Math.atan2(ctx.input.mouse.y - rig.hand.y, ctx.input.mouse.x - rig.hand.x);
  const leg = makePickup('weaverleg', rig.knee.x, rig.knee.y, {
    legLength: club.length, legOwner: club.owner, legDurability: club.durability,
    legAngle: Math.atan2(rig.knee.y - rig.hand.y, rig.knee.x - rig.hand.x),
    legBend: wrap(Math.atan2(rig.hip.y - rig.knee.y, rig.hip.x - rig.knee.x) - rig.wrist),
    legThrown: throwIt, legPickupBlocked: true, legAge: 180,
  });
  leg.vx = clamp(p.vx * .7 + (throwIt ? Math.cos(angle) * 10 : p.facing * .4), -12, 12);
  leg.vy = clamp(p.vy * .7 + (throwIt ? Math.sin(angle) * 10 - .5 : 0), -12, 12);
  createPose(leg, rig);
  ctx.levels.current.pickups.push(leg);
  p.legClub = undefined; p.firing = false; p.firePressed = false; p.fireBlockedUntilRelease = true; p.swapT = 12;
  ctx.telemetry.count(throwIt ? 'weaver.legThrown' : 'weaver.legDropped');
  if (throwIt) ctx.audio.noiseBurst(.09, 850, .09, true);
  ctx.events.emit('toast', { text: throwIt ? 'Leg thrown' : 'Leg dropped' });
  return true;
}

function blocked(ctx: Ctx, x: number, y: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  return !ctx.world.inBounds(x, y) || blocksEntity(ctx.world.type(x, y));
}

function move(ctx: Ctx, node: Node, dx: number, dy: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
  let contact = false;
  for (let i = 0; i < steps; i++) {
    if (!blocked(ctx, node.x + dx / steps, node.y)) node.x += dx / steps; else contact = true;
    if (!blocked(ctx, node.x, node.y + dy / steps)) node.y += dy / steps; else contact = true;
  }
  return contact;
}

function freePose(ctx: Ctx, pose: LooseLegPose): boolean {
  for (const [a, b] of [[pose.hand, pose.knee], [pose.knee, pose.hip]]) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= n; i++) if (blocked(ctx, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false;
  }
  return true;
}

/** A recoverable projectile: three mass-weighted nodes, fixed lengths, a loose
 * knee, swept grid contact, and one armed hit per throw. No duplicate projectile. */
export function updateLooseWeaverLeg(ctx: Ctx, p: Pickup): void {
  const rig = poses.get(p) ?? createPose(p), length = p.data.legLength ?? 34;
  remember(rig);
  const nodes = [rig.hand, rig.knee, rig.hip], dt = 1 / 4;
  for (let sub = 0; sub < 4; sub++) {
    const before = nodes.map(point), wasFree = freePose(ctx, rig);
    let terrain = false;
    for (const node of nodes) {
      const wet = isLiquid(ctx.world.type(Math.floor(node.x), Math.floor(node.y)));
      const drag = wet ? .96 : .997;
      node.vx *= drag; node.vy = node.vy * drag + .32 * dt;
      terrain = move(ctx, node, node.vx * dt, node.vy * dt) || terrain;
    }
    for (let pass = 0; pass < 6; pass++) {
      for (const [a, b, span, share] of [[rig.hand, rig.knee, length * .55, .6], [rig.knee, rig.hip, length * .45, .58]] as const) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || .001, k = (d - span) / d;
        terrain = move(ctx, a, dx * k * share, dy * k * share) || terrain;
        terrain = move(ctx, b, -dx * k * (1 - share), -dy * k * (1 - share)) || terrain;
      }
    }
    // Stop a rod catching a thin ledge even if all three endpoints clear it.
    if (wasFree && !freePose(ctx, rig)) {
      nodes.forEach((node, i) => Object.assign(node, before[i])); terrain = true;
    }
    nodes.forEach((node, i) => {
      node.vx = clamp((node.x - before[i].x) / dt, -14, 14) * (terrain ? .65 : 1);
      node.vy = clamp((node.y - before[i].y) / dt, -14, 14) * (terrain ? .65 : 1);
    });
    if (terrain) p.data.legThrown = false;
    if (p.data.legThrown) for (const enemy of ctx.enemies) {
      if (enemy.hp <= 0 || Math.hypot(enemy.x - rig.knee.x, enemy.y - rig.knee.y) > length + 80) continue;
      if (!heldLegContact(ctx, enemy, rig)) continue;
      ctx.enemyCtl.damage(enemy, 24, p.vx * .4, p.vy * .25 - 1);
      recordTrickshot(ctx, enemy, enemy.hp <= 0 ? 'kill' : 'hit');
      p.data.legThrown = false;
      p.data.legDurability = Math.max(0, (p.data.legDurability ?? 6) - 1);
      nodes.forEach(node => { node.vx *= -.22; node.vy = -Math.abs(node.vy) * .2 - .4; });
      ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 3);
      ctx.audio.noiseBurst(.07, 420, .12, true); ctx.telemetry.count('weaver.legThrowHit');
      if (p.data.legDurability === 0) {
        p.taken = true; ctx.particles.burst(rig.knee.x, rig.knee.y, 10, null, () => packRGB(158, 183, 144), 2, { grav: .15 });
      }
      break;
    }
    if (p.taken) break;
  }
  p.x = rig.knee.x; p.y = rig.knee.y; p.vx = rig.knee.vx; p.vy = rig.knee.vy;
  p.data.legAngle = Math.atan2(rig.knee.y - rig.hand.y, rig.knee.x - rig.hand.x);
  p.data.legBend = wrap(Math.atan2(rig.hip.y - rig.knee.y, rig.hip.x - rig.knee.x) - p.data.legAngle);
  if (Math.hypot(ctx.player.x - p.x, ctx.player.y - 8 - p.y) > 38) p.data.legPickupBlocked = false;
  if (Math.hypot(p.vx, p.vy) < .8) p.data.legThrown = false;
}
