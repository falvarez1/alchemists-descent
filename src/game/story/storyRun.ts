import type { EscapePhase, StoryPipeSite, StoryRunSave } from '@/core/story';
import type { Beat, PipeScript } from '@/content/story';
import { beatLine, type StoryMetaData } from './storyMeta';

/**
 * The story's per-run rules, pure (tests/story.test.ts): a run's fresh state,
 * the save's sanitizer, and which line a speaking-pipe says. RunDirector owns
 * the run's ledger; this owns what the Works have already told you this run.
 */

export function freshStoryRun(runIndex: number): StoryRunSave {
  return { v: 1, runIndex: Math.max(0, Math.floor(runIndex)), pipes: [], spoken: [], pell: {}, echoes: [], prologues: [], escape: 'none', told: [], pin: null, pinsPaid: [] };
}

const strings = (v: unknown, max = 200): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 160))].slice(0, max) : [];

/** A save's story slice, or a fresh one when it is missing or malformed. Never throws. */
export function sanitizeStoryRun(save: unknown, fallbackIndex = 0): StoryRunSave {
  if (!save || typeof save !== 'object') return freshStoryRun(fallbackIndex);
  const s = save as Partial<StoryRunSave>;
  if (s.v !== 1) return freshStoryRun(fallbackIndex);
  const pell: StoryRunSave['pell'] = {};
  if (s.pell && typeof s.pell === 'object') {
    for (const [id, v] of Object.entries(s.pell)) {
      if (typeof id !== 'string' || id.length > 40 || !v || typeof v !== 'object') continue;
      pell[id] = { met: (v as { met?: unknown }).met === true, gift: typeof (v as { gift?: unknown }).gift === 'string' ? (v as { gift: string }).gift : null };
    }
  }
  const escape: EscapePhase = s.escape === 'active' || s.escape === 'done' ? s.escape : 'none';
  // Older saves (before Pell read the run) carry none of these: empty defaults, the save stays valid.
  const rawPin = s.pin as Partial<NonNullable<StoryRunSave['pin']>> | null | undefined;
  const pin = rawPin && typeof rawPin === 'object' && typeof rawPin.level === 'string' && rawPin.level.length < 40 && Number.isFinite(rawPin.x) && Number.isFinite(rawPin.y)
    ? { level: rawPin.level, x: Math.round(rawPin.x as number), y: Math.round(rawPin.y as number), taken: typeof rawPin.taken === 'number' && Number.isFinite(rawPin.taken) ? Math.max(0, Math.floor(rawPin.taken)) : 0 }
    : null;
  return {
    v: 1,
    runIndex: typeof s.runIndex === 'number' && Number.isFinite(s.runIndex) ? Math.max(0, Math.floor(s.runIndex)) : fallbackIndex,
    pipes: strings(s.pipes),
    spoken: strings(s.spoken, 400),
    pell,
    echoes: strings(s.echoes, 20),
    prologues: strings(s.prologues, 20),
    escape,
    told: strings(s.told, 80),
    pin,
    pinsPaid: strings(s.pinsPaid, 10),
  };
}

/** A pipe's once-per-run key. */
export function pipeKey(levelId: string, pipe: Pick<StoryPipeSite, 'id'>): string {
  return `${levelId}:${pipe.id}`;
}

export interface PipeLine {
  beat: Beat;
  text: string;
  /** A first hearing (the meta marks it heard once it is said). */
  fresh: boolean;
}

/**
 * What a speaking-pipe says as the apprentice passes, or null (it keeps quiet):
 * - a pipe already spoken this run is quiet;
 * - a pinned site (floor 1's rooms) says its own beat: the rich line until it
 *   has been heard, then its `again` line once a run, or nothing;
 * - any other pipe says the floor's next beat in order: the first sequence
 *   beat never heard, else the first `again` line not yet said this run.
 * So a first run hears the floor as one thought in the order walked, and a
 * repeat run hears a line or two it has not heard, or a light `again`.
 */
export function pipeLine(script: PipeScript | undefined, pipe: Pick<StoryPipeSite, 'id'>, levelId: string,
  run: Pick<StoryRunSave, 'pipes' | 'spoken'>, meta: Pick<StoryMetaData, 'heard'>): PipeLine | null {
  if (!script || run.pipes.includes(pipeKey(levelId, pipe))) return null;
  const pinned = script.sites?.[pipe.id];
  if (pinned) {
    if (run.spoken.includes(pinned.id)) return null;
    const line = beatLine(meta, pinned);
    return line ? { beat: pinned, text: line.text, fresh: line.fresh } : null;
  }
  for (const beat of script.sequence) {
    if (run.spoken.includes(beat.id)) continue;
    const line = beatLine(meta, beat);
    if (line?.fresh) return { beat, text: line.text, fresh: true };
  }
  for (const beat of script.sequence) {
    if (run.spoken.includes(beat.id) || !beat.again) continue;
    const line = beatLine(meta, beat);
    if (line && !line.fresh) return { beat, text: line.text, fresh: false };
  }
  return null;
}

/** Record a pipe as spoken this run (returns a new state). */
export function withPipeSpoken(run: StoryRunSave, levelId: string, pipe: Pick<StoryPipeSite, 'id'>, beatId: string | null): StoryRunSave {
  const key = pipeKey(levelId, pipe);
  return {
    ...run,
    pipes: run.pipes.includes(key) ? run.pipes : [...run.pipes, key],
    spoken: beatId && !run.spoken.includes(beatId) ? [...run.spoken, beatId] : run.spoken,
  };
}

/**
 * Pell's ending: waiting at the top if the apprentice sat with him on at least
 * two floors this run (he trusted you with the flue); otherwise only his
 * lantern by the hatch, still lit, and the finished map.
 */
export function pellWaits(run: Pick<StoryRunSave, 'pell'>): boolean {
  return Object.values(run.pell).filter(v => v.met).length >= 2;
}
