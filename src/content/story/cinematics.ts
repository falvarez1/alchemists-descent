import type { StoryLine } from './types';
import { PELL_ENDING } from './pell';

/**
 * The OPENING and the ENDING: short, skippable plates drawn in the house style
 * (ui/story/StoryCinema paints them — lantern-slide silhouettes, no art files).
 *
 * The opening plays once, on a player's first descent, and never costs the
 * "first fire within ~10 s of control" goal: control starts when it ends
 * (≤ 12 s, any key skips). The title's "The opening" replays it.
 *
 * The ending plays after the Kiln escape and before the Ledger: clean air
 * rising up the flue, Kettleby breathing, Pell (waiting at the top, or only
 * his lantern), and the Docent's farewell — with, the first time, the late
 * reveal, kept light.
 */

/** Which painted plate a beat stands on. */
export type PlateArt = 'town' | 'lift' | 'works' | 'flue' | 'window' | 'pell' | 'lantern' | 'farewell';

export interface Plate {
  art: PlateArt;
  /** Seconds the plate holds at least (the voice may hold it longer). */
  seconds: number;
  line: StoryLine | null;
}

/** The opening: Kettleby, the cage lift, the mouth of the Works. */
export const OPENING: readonly Plate[] = [
  { art: 'town', seconds: 3.4, line: { speaker: 'docent', text: 'Kettleby. A town with one breath left.' } },
  { art: 'lift', seconds: 3.6, line: { speaker: 'docent', text: 'The Guild sent what it had left. You.' } },
  { art: 'works', seconds: 3.4, line: { speaker: 'docent', text: 'Welcome to the Works, apprentice.' } },
];

/** Opening plates never run longer than this in total, whatever the voice does. */
export const OPENING_MAX_SECONDS = 12;

export interface EndingScript {
  rise: Plate;
  town: Plate;
  /** Pell made it up ahead of you. */
  pellWaiting: Plate;
  /** Only his lantern at the hatch. */
  pellLantern: Plate;
  farewell: Plate;
}

/** The first victory: the whole ending, with the reveal. */
export const ENDING_FIRST: EndingScript = {
  rise: { art: 'flue', seconds: 4, line: { speaker: 'docent', text: 'The Heart has stopped fighting. Listen. The Works are breathing easy.' } },
  town: { art: 'window', seconds: 4, line: { speaker: 'docent', text: 'Up in Kettleby, someone opens a window, and leaves it open.' } },
  pellWaiting: { art: 'pell', seconds: 3.5, line: { speaker: 'pell', text: PELL_ENDING.first.text } },
  pellLantern: { art: 'lantern', seconds: 4.5, line: { speaker: 'docent', text: 'Pell’s lantern is here by the hatch, still lit. The map beside it is finished. Of Pell himself, there is no sign.' } },
  farewell: { art: 'farewell', seconds: 5, line: { speaker: 'docent', text: 'I never did leave, you know. The Works keep what they love, and they kept my voice. Go on up, apprentice. Breathe for me.' } },
};

/** Later victories: lighter. */
export const ENDING_AGAIN: EndingScript = {
  rise: { art: 'flue', seconds: 3, line: { speaker: 'docent', text: 'Clean air again. Well done, apprentice.' } },
  town: { art: 'window', seconds: 2.6, line: null },
  pellWaiting: { art: 'pell', seconds: 3, line: { speaker: 'pell', text: PELL_ENDING.again.text } },
  pellLantern: { art: 'lantern', seconds: 3, line: { speaker: 'docent', text: 'His lantern, still lit. The map, finished.' } },
  farewell: { art: 'farewell', seconds: 3, line: { speaker: 'docent', text: 'Go on up. Breathe for me.' } },
};

/** Captions written on the plates under the spoken line (small, in the house serif). */
export const PLATE_TITLES: Readonly<Record<PlateArt, string>> = {
  town: 'Kettleby, above the Works',
  lift: 'The Guild lift',
  works: 'The Intake',
  flue: 'The old flue',
  window: 'Kettleby, morning',
  pell: 'The top of the flue',
  lantern: 'The top of the flue',
  farewell: 'The Works',
};
