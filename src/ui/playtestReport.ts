import { difficultyMods } from '@/config/difficulty';
import type { Ctx } from '@/core/types';
import { recapRows } from '@/combat/wands/buildRecap';
import { buildNotesReport } from '@/ui/runNotes';

/** Commit hash + build time, baked in by vite.config's `define`. */
export const BUILD_STAMP = __BUILD_STAMP__;

/**
 * One-shot playtest report: everything needed to act on a tester's "something
 * felt wrong" — the exact build, the run's seeds (reproduce the world), where
 * they were, and the full local telemetry counters. Serialized JSON so it
 * pastes cleanly into an issue or chat message. Purely local data; nothing is
 * sent anywhere unless the tester pastes it somewhere.
 */
export function buildPlaytestReport(ctx: Ctx): string {
  const status = ctx.levels.runStatus(ctx);
  return JSON.stringify(
    {
      build: BUILD_STAMP,
      at: new Date().toISOString(),
      difficulty: difficultyMods(ctx.state).name,
      level: status.level,
      worldSeed: status.worldSeed,
      expeditionSeed: status.expeditionSeed,
      gold: ctx.state.score,
      player: status.player,
      debugTainted: status.debugTainted,
      // What this run asked of the build: the wands as sentences, and the decision notes (offers shown and
      // taken, altars, dead-card captions, frames, seconds on each floor) — the answer to "what happens at minute five".
      choices: {
        wands: (ctx.wands ? recapRows(ctx.wands.wands) : []).map((r) => ({ wand: r.numeral, frame: r.frameName, slots: r.capacity, casts: r.sentence })),
        notes: ctx.wands?.buildNotes ? buildNotesReport(ctx.wands.buildNotes()) : null,
      },
      counters: ctx.telemetry.all(),
    },
    null,
    2,
  );
}
