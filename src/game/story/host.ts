import type { Ctx, BiomeId } from '@/core/types';
import type { KitId } from '@/core/run';
import type { StoryRunSave, StorySpeakOptions, StorySpokenLine } from '@/core/story';
import type { StoryMetaData } from './storyMeta';

/**
 * What Pell can read off the run: state the game already keeps (RunDirector's
 * phials and deaths, the player's hp, purse and boons, the difficulty). Nothing
 * here is new bookkeeping; the director gathers it so Pell never reaches
 * into another system.
 */
export interface PellFacts {
  /** 1-based floor of the current level. */
  floor: number;
  kit: KitId | null;
  phials: number;
  deaths: number;
  /** Health as a fraction of the maximum (0..1). */
  hpFrac: number;
  gold: number;
  /** The boons struck so far (PerkIds). */
  boons: readonly string[];
  /** 1 (Apprentice) … 4 (Archmage). */
  difficulty: number;
  daily: boolean;
}

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
  /** The line has a recording (else it runs silently, at reading pace: text-first lines). */
  voiced(line: StorySpokenLine): boolean;
  /** What the run holds that Pell may notice (read-only). */
  facts(): PellFacts;
  /** The wand is holding a corpse (Telekinesis). */
  carryingCorpse(): boolean;
  /** An unbroken line of sight between two world points (creatures/perception). */
  sees(x0: number, y0: number, x1: number, y1: number): boolean;
}
