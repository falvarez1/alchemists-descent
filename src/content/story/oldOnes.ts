import type { Beat, StoryBiome } from './types';

/**
 * THE OLD ONES — Guild workers who breathed the Works' air and became part
 * of it: patient, half-fungal, polite traders who keep the Sanctum between
 * floors. MATRON ASH speaks for them (voice: old, whispery, kind, a hint of
 * chorus — the recordings are doubled offline). She calls the apprentice
 * "little breath".
 *
 * A greeting as the Sanctum opens (keyed by the floor just left), and a line
 * for each door below (keyed by the door's biome — the Biomes workstream's
 * door choice asks for it by biome).
 */

/** Greetings, keyed by the 1-based floor the apprentice has just finished. */
export const ASH_GREETINGS: Readonly<Record<number, Beat>> = {
  1: {
    id: 'ash.greet.1',
    first: 'Come in, little breath. We are the Old Ones. We were the Guild, once. Now we are what the Works kept.',
    again: 'Back again, little breath. We kept your chair warm.',
  },
  2: {
    id: 'ash.greet.2',
    first: 'You smell of rot and smoke. Good. The Works are learning your name.',
    again: 'Rest, little breath. The Works are glad of you.',
  },
  3: {
    id: 'ash.greet.3',
    first: 'The Heart is close. We can hear it through the floor. Rest. Then go, and be kind to it.',
    again: 'Nearly home, little breath. Nearly home.',
  },
};

/** One line for each door, keyed by the biome beyond it. */
export const ASH_DOORS: Readonly<Partial<Record<StoryBiome, Beat>>> = {
  fungal: { id: 'ash.door.fungal', first: 'The Gardens. Some of us grew up there. Quite literally.', again: null },
  frozen: { id: 'ash.door.frozen', first: 'The Cold Store. Take a scarf. We cannot; we are mostly moss.', again: null },
  flooded: { id: 'ash.door.flooded', first: 'The Cisterns. Mind the one in the sump. It was never unkind. Only large.', again: null },
  crystal: { id: 'ash.door.crystal', first: 'The Galleries. The glass remembers every face. Show it a kind one.', again: null },
  volcanic: { id: 'ash.door.volcanic', first: 'The Heart. Go gently, little breath. It is only frightened.', again: 'Go gently, little breath.' },
};

/* ---------------------------------------------------------------------------
 * THE OLD ONES READ THE RUN (polish 2026-09). Matron Ash remarks on what the
 * apprentice has been through (a third line after her greeting), answers each
 * boon struck and each purchase made, and the Clerk of Works' notices go up
 * (content/story/clerk). All of it is TEXT-FIRST: it types on in her panel and
 * runs silently until recorded, and none of it is in `storyVoiceLines` — the
 * story's voice budget (tests/story.test.ts, 14,000 characters) is shared with
 * every other stream. Register a line there (content/story/index) when it is
 * commissioned.
 * ------------------------------------------------------------------------- */

/** What the Sanctum can tell about the run as the apprentice arrives. */
export interface AshRunFacts {
  /** The floor just finished (1-3; she has nothing to say after the first). */
  floor: number;
  /** Return phials in the glass on arrival, before the old ones top one up. */
  phialsOnArrival: number;
  maxPhials: number;
  /** Gold carried (oz). */
  gold: number;
}

/** Gold a remark is worth (oz). */
export const ASH_FLUSH_GOLD = 120;

/** One line each for the Sanctum after floor 2 and after floor 3 (index 0, 1). */
export const ASH_NOTES = {
  /** He came down with no phial in the glass at all. */
  dire: [
    'Not a drop left in the glass, little breath. We have poured one. Please do not spend it on anything clever.',
    'The glass was empty when you came. We have filled it once. That is all we have, and all you may ask.',
  ],
  /** A phial or two short. */
  lean: [
    'A phial short on the stairs. We have poured another. Try to keep this one.',
    'The glass runs thinner each time you visit. We keep pouring. Neither of us will say who tires first.',
  ],
  /** Gold enough to be worth a remark. */
  flush: [
    'A great deal of gold to carry downstairs. We do trade, little breath. We have never been seen to spend it.',
    'You carry a great deal of gold, and the Heart takes no payment. We do.',
  ],
  /** Every phial still in the glass and a light purse. */
  clean: [
    'Not a phial spent. We are impressed, little breath, and a little worried for you.',
    'Not a scratch on the glass. The Works will have noticed. It notices everything; it simply does not say.',
  ],
} as const;

/**
 * The one remark the Sanctum may make about the run, or null (after floor 1 she only greets; a floor
 * with nothing to remark on is quiet). Hard going outranks a full purse, which outranks a clean record.
 */
export function ashRunNote(f: AshRunFacts): { id: string; text: string } | null {
  if (f.floor < 2 || f.floor > 3) return null;
  const at = f.floor - 2;
  const kind = f.phialsOnArrival <= 0 ? 'dire'
    : f.phialsOnArrival < f.maxPhials ? 'lean'
      : f.gold >= ASH_FLUSH_GOLD ? 'flush'
        : 'clean';
  return { id: `ash.note.${kind}.${f.floor}`, text: ASH_NOTES[kind][at] };
}

/** Her answer to each boon struck, by the boon's id (said once ever: a reply twice is a lecture). */
export const ASH_BOONS: Readonly<Record<string, string>> = {
  vitality: 'Thirty more of you. Do try to bring them all back.',
  might: 'Sharper. The Guild called that overtime, and did not pay it.',
  vampirism: 'You take what you need from what you meet. We approve, and will not be looking.',
  featherweight: 'Longer in the air. Do come down eventually, little breath. Everyone does.',
  manafont: 'Faster to refill. We envy you. Nobody ever refilled us.',
  swiftfoot: 'Quicker feet. Do use them for leaving, as well as arriving.',
  ironhide: 'Padded, then. Good. The Heart is a great one for noise.',
  flameward: 'Skin that declines to burn. We had something similar once. It was bark, and it did burn.',
  toxinward: 'You will not mind the acid so much. We stopped minding years ago. That is not a recommendation.',
  goldmagnet: 'The gold will come to you now. It was always a little keen.',
  stronggrip: 'The sextons would approve. They always did like a helpful pair of hands.',
  rimesoles: 'You will walk on the pools. The pools will be cross about it.',
  longfuse: 'Patience, made into a weapon. Some of us have been at it a century, with less flair.',
  velvethood: 'A hood. Very sensible. The dark is easier to live in when it likes you.',
  grounded: 'The Cisterns are rude to the unshod. You will be the exception, for a while.',
  warmblood: 'Warm blood. A rare thing down here. We have moss instead. It does not help.',
};

/** Her answer to each purchase, by shop item (once per item per run; the shop rows themselves stay plain). */
export const ASH_PURCHASES: Readonly<Record<string, string>> = {
  mend: 'Hold still. There. Good as slightly used.',
  toughen: 'A little sturdier. We have plenty more where that came from. It is mostly moss.',
  brew: 'You might have sat down first.',
  brass: 'A finer frame. We will find a use for the old one. Kindling, probably.',
  void: 'The Void Lattice. We do not ask where it came from. It would only upset the moss.',
  pages: 'Mislaid by better alchemists. Take care of it.',
};

/** The return-phial note under the glass when the old ones can only pour the one (the last phial, poured). */
export const ASH_ONE_PHIAL_NOTE = 'The old ones top up a phial, and look at you for a while. One is not many.';
