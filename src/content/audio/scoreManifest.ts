import { SCORE_TRACKS } from '@/content/audio/score.generated';
import { ARENA_SCORE_TRACKS } from '@/content/audio/arenaScore.generated';
import { NARRATION_LINES, NARRATOR_CANDIDATES, NARRATOR_SAMPLE, NARRATOR_VOICE } from '@/content/audio/narration.generated';

/**
 * The score and the narrator, for the dev audition page (which discovers every
 * `src/content/audio/*Manifest.ts` exporting AUDITION_ENTRIES). Nothing in the
 * game imports this module, so none of it reaches the player bundle.
 */
export interface AuditionEntry {
  id: string;
  group: string;
  label: string;
  /** What was asked for: the cue's composition plan in brief, or the words the narrator read. */
  prompt: string;
  urls: string[];
  loop?: boolean;
}

const base = import.meta.env.BASE_URL;
const minutes = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export const AUDITION_ENTRIES: AuditionEntry[] = [
  ...[...SCORE_TRACKS, ...ARENA_SCORE_TRACKS].map(t => ({
    id: `score-${t.id}`,
    group: t.group,
    label: `${t.label} · ${minutes(t.seconds)}`,
    prompt: `${t.key}, ${t.bpm} BPM. ${t.summary}`,
    urls: [base + t.url],
    loop: t.loop,
  })),
  ...NARRATOR_CANDIDATES.map(c => ({
    id: `narrator-${c.id}`,
    group: 'Narrator · candidates (same line)',
    label: c.id === NARRATOR_VOICE.key ? `${c.label} — the voice in the game` : c.label,
    prompt: NARRATOR_SAMPLE,
    urls: [base + c.url],
  })),
  ...NARRATION_LINES.map(l => ({
    id: `narration-${l.key}`,
    group: `Narration · ${l.group}`,
    label: l.text,
    prompt: l.say,
    urls: l.urls.map(u => base + u),
  })),
];
