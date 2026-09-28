import type { BiomeId } from '@/core/types';
import type { StorySpeaker } from '@/core/story';

/**
 * The narrative spine's shared shapes (Breathing Works, wave 3 WS-S). Content
 * only — the story director (game/story) decides WHEN a line is said, the
 * narrator (audio/Narrator) finds its recording by speaker and text, and the
 * dialogue box / captions show it. Nothing here imports a system.
 *
 * First run rich, repeat runs light: every beat has a stable id, the story
 * meta remembers which ids a player has ever heard, and a heard beat falls
 * back to its (shorter, different) `again` variant — or to silence.
 */

/** Who is talking. Each speaker has its own ElevenLabs voice (scripts/audio/gen-voice.mjs). */
export type Speaker = StorySpeaker;

export const SPEAKER_NAMES: Readonly<Record<Speaker, string>> = {
  docent: 'The Docent',
  pell: 'Pell',
  ash: 'Matron Ash',
};

/** One spoken line. */
export interface StoryLine {
  speaker: Speaker;
  text: string;
}

/** A beat's line on a first hearing, and what it becomes once heard (null: quiet). */
export interface Beat {
  /** Stable id: the meta's "heard" flag (never rename a shipped id). */
  id: string;
  first: string;
  again: string | null;
}

/** The biomes a floor can be (new biomes slot in by adding a key). */
export type StoryBiome = BiomeId;
