import type { StoryLine } from './types';
import { PELL_ENDING } from './pell';

/**
 * The OPENING and the ENDING: short, skippable plates drawn in the house style
 * (ui/story/StoryCinema paints them — lantern-slide silhouettes, no art files).
 *
 * The opening plays once, on a player's first descent, and never costs the
 * "first fire within ~10 s of control" goal: control starts when it ends
 * (≈ 8 s — two plates, voice-paced with a short breath; any key skips). The
 * title's "The opening" replays it. (It was three plates and 12.5 s; the third,
 * "Welcome to the Works, apprentice.", gave way to the floor's own arrival.)
 *
 * The ending plays after the Kiln escape and before the Ledger: clean air
 * rising up the flue, Kettleby breathing, Pell (waiting at the top, or only
 * his lantern), and the Docent's farewell — with, the first time, the late
 * reveal, kept light.
 */

/** Which painted plate a beat stands on. */
export type PlateArt = 'town' | 'lift' | 'works' | 'flue' | 'window' | 'pell' | 'pellcup' | 'lantern' | 'farewell';

export interface Plate {
  art: PlateArt;
  /** Seconds the plate holds at least (the voice may hold it longer). */
  seconds: number;
  line: StoryLine | null;
}

/** The opening: Kettleby, then the cage lift down into the Works. */
export const OPENING: readonly Plate[] = [
  { art: 'town', seconds: 3.4, line: { speaker: 'docent', text: 'Kettleby. A town with one breath left.' } },
  { art: 'lift', seconds: 3.4, line: { speaker: 'docent', text: 'The Guild sent what it had left. You.' } },
];

/** Opening plates never run longer than this in total, whatever the voice does. */
export const OPENING_MAX_SECONDS = 8;
/** The opening's pace: a short breath after each line, and a brief black before the first plate. */
export const OPENING_BREATH_SECONDS = 0.12;
export const OPENING_LEAD_SECONDS = 0.25;

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

/* ---------------------------------------------------------------------------
 * THE ENDING READS THE RUN (polish 2026-09). Four facts of the descent shade
 * it: whether Pell waits at the top with a cup (the apprentice took his tea),
 * and, on a later victory, the hardest tier and today's shared descent. Text
 * only: these plates run silent and captioned until they are recorded, and
 * none of them is in `storyVoiceLines` (the voice budget is shared).
 * ------------------------------------------------------------------------- */

export interface EndingFacts {
  /** Pell made it up ahead (met on at least two floors). */
  waiting: boolean;
  /** The apprentice took Pell's tea at his camp, on some floor. */
  tookTea: boolean;
  /** Today's descent (the daily seed). */
  daily: boolean;
  /** Won on the hardest tier. */
  archmage: boolean;
}

/** Pell, waiting at the top with the kettle. */
export const PELL_CUP_ENDING = {
  first: 'You made it! So did I. I brought the kettle. Don’t ask how. I have only mostly scalded myself.',
  again: 'Top of the flue, and the kettle’s on. I did say I was good at further.',
} as const;

/** A later victory on the hardest tier. */
export const ENDING_ARCHMAGE_RISE = 'Archmage, at the last. The Guild would have held a banquet. It has me, and the clean air, which I am assured is better.';
/** A later victory on today's shared descent. */
export const ENDING_DAILY_TOWN = 'Up in Kettleby, someone opens a window. Somewhere else, this very morning, a stranger opens the same one.';

/**
 * The plates of the ending for a run: the first victory keeps its reveal whole (only Pell's cup
 * shades it); a later one is lighter and reads the tier and the day too.
 */
export function endingPlates(first: boolean, facts: EndingFacts): Plate[] {
  const script = first ? ENDING_FIRST : ENDING_AGAIN;
  let pell = facts.waiting ? script.pellWaiting : script.pellLantern;
  if (facts.waiting && facts.tookTea) {
    pell = { art: 'pellcup', seconds: first ? 4 : 3, line: { speaker: 'pell', text: first ? PELL_CUP_ENDING.first : PELL_CUP_ENDING.again } };
  }
  let rise = script.rise;
  let town = script.town;
  if (!first && facts.archmage) rise = { ...rise, seconds: 4, line: { speaker: 'docent', text: ENDING_ARCHMAGE_RISE } };
  if (!first && facts.daily) town = { ...town, seconds: 3.6, line: { speaker: 'docent', text: ENDING_DAILY_TOWN } };
  return [rise, town, pell, script.farewell];
}

/** Captions written on the plates under the spoken line (small, in the house serif). */
export const PLATE_TITLES: Readonly<Record<PlateArt, string>> = {
  town: 'Kettleby, above the Works',
  lift: 'The Guild lift',
  works: 'The Intake',
  flue: 'The old flue',
  window: 'Kettleby, morning',
  pell: 'The top of the flue',
  pellcup: 'The top of the flue',
  lantern: 'The top of the flue',
  farewell: 'The Works',
};
