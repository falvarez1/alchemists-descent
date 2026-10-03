/** What a score cue is for; the music director picks cues by role. */
export type ScoreRole = 'title' | 'explore' | 'tension' | 'boss' | 'sanctum' | 'tea' | 'workshop' | 'victory' | 'fallen' | 'escape' | 'ending' | 'arena';

/** One mastered track of the score (written by scripts/audio/gen-music.mjs). */
export interface ScoreTrack {
  id: string;
  /** Relative to the site base (import.meta.env.BASE_URL). */
  url: string;
  label: string;
  group: string;
  role: ScoreRole;
  /** Campaign floor id for exploration/tension cues. */
  floor: string | null;
  loop: boolean;
  /** Authored whole-bar loop with an offline seam. Let the media clock wrap it. */
  gaplessLoop?: boolean;
  key: string;
  bpm: number;
  seconds: number;
  /** Near-silence at the head: where a loop re-enters. */
  headSec: number;
  /** Near-silence at the tail: the loop crossfade finishes before it. */
  tailSec: number;
  lufs: number;
  bytes: number;
  /** The composition plan in one breath (the audition page shows it). */
  summary: string;
}
