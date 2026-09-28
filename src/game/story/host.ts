import type { Ctx, BiomeId } from '@/core/types';
import type { StoryRunSave, StorySpeakOptions, StorySpokenLine } from '@/core/story';
import type { StoryMetaData } from './storyMeta';

/**
 * What the story's parts (the pipes, Pell, the echoes, the prologues, the
 * escape, the cinematics) share: the game, the story's memory across runs and
 * within this one, and one way to speak. The director (StoryDirector) is the
 * only implementation; the parts never reach each other except through it.
 */
export interface StoryHost {
  readonly ctx: Ctx;
  /** The story meta (across runs). Untracked runs (tests, the Builder) read and write a session copy. */
  meta(): Readonly<StoryMetaData>;
  updateMeta(fn: (meta: StoryMetaData) => StoryMetaData): void;
  /** This run's story state. */
  run(): StoryRunSave;
  setRun(next: StoryRunSave): void;
  /**
   * Say lines (the narrator's speak). `beats` are marked heard (meta) and
   * spoken (this run) when the lines are accepted. Returns whether they were.
   */
  say(lines: readonly StorySpokenLine[], opts: StorySpeakOptions & { beats?: readonly string[] }): boolean;
  /** Seconds a line will take: its recording's length, else its reading time. */
  lineSeconds(line: StorySpokenLine): number;
  unlockJournal(...ids: string[]): void;
  /** The current campaign level (null in the Sandbox, the Builder, a test arena). */
  levelId(): string | null;
  biome(): BiomeId | null;
  /** 1-based floor of the current level (0 off the spine). */
  floor(): number;
  /** Wall-clock seconds (story beats run on real time: pauses and slow motion must not stall a voice). */
  now(): number;
}
