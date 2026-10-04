import type { Ctx } from '@/core/types';
import type { FighterId } from '@/content/fighters';
import { DEFAULT_STOCK_STAGE, STOCK_STAGES, type StockStageId } from '@/config/stockStage';
import { resetDuelStage } from '@/world/duelStage';

/** One match construction path for couch versus and network play. Never loads or
 * overwrites an expedition save. The caller owns cancellation and input drivers.
 * `stage` is the lobby's choice; network play has no stage choice yet, so host and
 * replica both build the default (the Foundry) and stay identical. */
export async function prepareDuel(
  ctx: Ctx,
  fighters: readonly FighterId[],
  playReady: () => Promise<boolean>,
  valid: () => boolean,
  stageId: StockStageId = DEFAULT_STOCK_STAGE,
): Promise<boolean> {
  if (!(await playReady())) throw new Error('The game could not finish loading. Try again.');
  if (!valid() || !ctx.arena) return false;
  const result = ctx.levels.startRun(ctx, {
    mode: 'test',
    worldSource: 'campaign-level',
    levelId: 'fighter-duel',
    fighter: fighters[0],
    loadout: 'advanced',
    difficulty: 3,
    presentation: 'versus',
  });
  ctx.state.paused = true;
  if (!result.ok) throw new Error(result.message);
  await ctx.fighters?.whenReady();
  if (!valid()) return false;
  const stage = STOCK_STAGES[stageId];
  ctx.arena.selectStockStage?.(stage.id);
  ctx.arena.configureStocks(stage.zone);
  resetDuelStage(ctx);
  ctx.arena.setSpawns(stage.spawns);
  const spawn = stage.spawns[1];
  const joined = await ctx.arena.addRival(fighters[1], spawn.x, spawn.y);
  if (!valid()) return false;
  if (joined < 0) throw new Error('The rival could not join. Try the match again.');
  // The match countdown and respawn protection own invulnerability here.
  ctx.state.arrivalGraceUntil = 0;
  ctx.arena.reset();
  return true;
}
