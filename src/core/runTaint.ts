import type { GameStateData } from '@/core/types';
import type { StoryApi } from '@/core/story';

/**
 * TAINT: a run that used a debug tool (god mode, a console teleport, a level
 * jump, the runtime inspector's freeze) is a test run. The game keeps it apart
 * from real play: it is never autosaved over a real expedition (Levels), never
 * written to the ledger or credited to the meta profile (RunDirector), and the
 * story hears it from a scratch memory (StoryDirector.untrack).
 */

type TaintState = Pick<GameStateData, 'debugGodMode' | 'debugTainted'>;

export function isRunTainted(state: Partial<TaintState>): boolean {
  return state.debugGodMode === true || state.debugTainted === true;
}

/**
 * Mark the running expedition a test run. Idempotent. Returns true when this call
 * is what tainted it (so a command can say so once). `debugTainted` rather than
 * `debugGodMode`: god mode also refills the kit at every arrival, which a
 * console travel must not do to a run it only means to move around in.
 */
export function taintRun(ctx: { state: TaintState; story?: Pick<StoryApi, 'untrack'> }): boolean {
  const was = isRunTainted(ctx.state);
  ctx.state.debugTainted = true;
  ctx.story?.untrack?.();
  return !was;
}
