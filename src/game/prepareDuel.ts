import type { Ctx } from '@/core/types';
import type { FighterId } from '@/content/fighters';
import { STOCK_STAGE } from '@/config/stockStage';
import { resetDuelStage } from '@/world/duelStage';

/** One match construction path for couch versus and network play. Never loads or
 * overwrites an expedition save. The caller owns cancellation and input drivers. */
export async function prepareDuel(
  ctx: Ctx,
  fighters: readonly FighterId[],
  playReady: () => Promise<boolean>,
  valid: () => boolean,
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
  ctx.arena.configureStocks(STOCK_STAGE.zone);
  resetDuelStage(ctx);
  ctx.arena.setSpawns(STOCK_STAGE.spawns);
  const spawn = STOCK_STAGE.spawns[1];
  const joined = await ctx.arena.addRival(fighters[1], spawn.x, spawn.y);
  if (!valid()) return false;
  if (joined < 0) throw new Error('The rival could not join. Try the match again.');
  // The match countdown and respawn protection own invulnerability here.
  ctx.state.arrivalGraceUntil = 0;
  ctx.arena.reset();
  return true;
}
