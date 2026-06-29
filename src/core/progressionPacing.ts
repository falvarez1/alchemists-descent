import { PROGRESSION_PACING } from '@/config/pacing';
import { clamp } from '@/core/math';
import type { Ctx } from '@/core/types';

function currentDepth(ctx: Ctx): number {
  const depth = ctx.state.mode === 'play' ? ctx.levels.current?.def.depth : undefined;
  return Math.max(1, Math.floor(depth ?? 1));
}

export function playerMovementPace(ctx: Ctx): number {
  const t = PROGRESSION_PACING;
  const depthPace = clamp(t.playerStart + (currentDepth(ctx) - 1) * t.playerDepthStep, t.playerStart, t.playerMax);
  const mobilityBonus = (ctx.player.status.swift > 0 ? 0.08 : 0) + (ctx.player.perks.swiftfoot ? 0.05 : 0);
  return clamp(depthPace + mobilityBonus, t.playerStart, t.playerBonusMax);
}

export function playerVerticalPace(ctx: Ctx): number {
  const t = PROGRESSION_PACING;
  const depthPace = clamp(t.verticalStart + (currentDepth(ctx) - 1) * t.verticalDepthStep, t.verticalStart, t.verticalMax);
  const mobilityBonus =
    (ctx.player.status.swift > 0 ? 0.025 : 0) +
    (ctx.player.status.levity > 0 ? 0.025 : 0) +
    (ctx.player.perks.featherweight ? 0.025 : 0) +
    (ctx.player.maxLevit > 100 ? 0.015 : 0);
  return clamp(depthPace + mobilityBonus, t.verticalStart, t.verticalBonusMax);
}

export function enemyMovementPace(ctx: Ctx): number {
  const t = PROGRESSION_PACING;
  return clamp(t.enemyStart + (currentDepth(ctx) - 1) * t.enemyDepthStep, t.enemyStart, t.enemyMax);
}
