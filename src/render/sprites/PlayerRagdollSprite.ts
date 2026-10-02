import type { Ctx, RigidBody } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { makeSkeleton, poseRagdoll } from '@/entities/playerPose';
import { drawAlchemistBody, drawDroppedWand } from '@/render/player/AlchemistArt';
import { drawFighterFallen } from '@/render/player/FighterArt';

type Point = { x: number; y: number };

export function ragdollPoint(body: RigidBody, x: number, y: number, alpha = 1): Point {
  const px = body.previousX ?? body.x, py = body.previousY ?? body.y, pa = body.previousAngle ?? body.angle;
  const angle = pa + Math.atan2(Math.sin(body.angle - pa), Math.cos(body.angle - pa)) * alpha;
  return { x: px + (body.x - px) * alpha + x * Math.cos(angle) - y * Math.sin(angle),
    y: py + (body.y - py) * alpha + x * Math.sin(angle) + y * Math.cos(angle) };
}

const SKEL = makeSkeleton();

/**
 * The fallen alchemist: the same body and costume as the living one, read off
 * the ragdoll's solved joints (eyes shut, coat tails and crown still hanging
 * on their chains, the hat tumbling as its own body), and the wand that left
 * his hand, its light guttering out.
 */
export function drawPlayerRagdollSprite(out: PixelSurface, field: LightField, ctx: Ctx, alpha: number): void {
  const rig = ctx.rigidBodies.playerRagdoll;
  if (!rig || ctx.state.mode !== 'play') return;
  poseRagdoll(rig.parts, rig.facing, SKEL, alpha);
  if (ctx.player.dead) {
    const t = ctx.fx.deathTime ?? 0;
    const glow = Math.max(0, Math.min(1, 1 - (t - 0.5) / 1.4));
    for (const b of ctx.rigidBodies.bodies) if (b.tag === 'player-corpse-wand') drawDroppedWand(out, field, b, glow, alpha);
  }
  if (ctx.fighters?.id && drawFighterFallen(out, field, ctx, SKEL, rig.parts.hat, alpha)) return;
  drawAlchemistBody(out, field, ctx, ctx.player, SKEL, ctx.player.costume, rig.parts.hat, alpha);
}
