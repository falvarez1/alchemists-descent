import type { StoryBiome } from './types';

/**
 * PELL — a Guild surveyor who came down a year ago "to finish the map" and
 * stayed. Hollow Knight's Quirrel/Cornifer register: met again and again,
 * frightened of nearly everything, braver than he thinks. Voice: younger,
 * warm, a little anxious, British, crisp.
 *
 * A run's arc: floor 1, the introduction and the worry; floors 2 and 3, help
 * (a map pin to a secret, a page, his last tea); floor 4, gone ahead (his camp
 * abandoned, his last map page on the bedroll); the ending, waiting at the top
 * — or only his lantern. Across runs he recognises you, a little more each
 * time ("the I've-done-this-before look").
 *
 * A visit is a greeting (said line by line as the text types on), up to three
 * choices, a reply, and a farewell. Talking never pauses the run.
 */

/** What Pell can hand over. */
export type PellGift =
  /** A compass mark on the floor's best sealed secret. */
  | 'pin'
  /** A spell page from the reward pool. */
  | 'page'
  /** His last tin of tea: health restored in full. */
  | 'tea'
  /** Glowseeds (the Bellows' lure): the satchel refilled. */
  | 'seeds';

export interface PellChoice {
  /** The button (short, the apprentice's words — the apprentice never speaks aloud). */
  label: string;
  reply: readonly string[];
  gift?: PellGift;
}

export interface PellVisit {
  /** Stable id (the meta remembers visits by it). */
  id: string;
  greet: readonly string[];
  choices: readonly PellChoice[];
  farewell: string;
}

export interface PellFloor {
  /** Never met on this floor before. */
  first: PellVisit;
  /** Met here on an earlier run. */
  again: PellVisit;
  /** Met on three or more runs (recognition deepens). Falls back to `again`. */
  veteran?: PellVisit;
}

const PIN = 'Show me something.';
const PAGE = 'Found anything?';

export const PELL: Readonly<Partial<Record<StoryBiome, PellFloor>>> = {
  // Floor 1 — the Warm Refuge.
  earthen: {
    first: {
      id: 'pell.bellows.first',
      greet: [
        'Oh! Oh, thank goodness. You’re a person. Sorry. I’ve been talking to a duck all week.',
        'Pell. Guild surveyor. I came down a year ago to finish the map, and I have very nearly finished being frightened.',
      ],
      choices: [
        { label: 'What’s below?', reply: ['The Rot Gardens. Everything grows, and all of it burns. I’ll go ahead and mark the safe ways.'] },
        { label: 'Come with me.', reply: ['Ha! No. I mean, I’d only slow you down. I’ll meet you further down. I’m very good at further down.'] },
        { label: 'Anything for the road?', reply: ['Glowseeds. Throw one, and everything hungry looks at it instead of you.'], gift: 'seeds' },
      ],
      farewell: 'Mind the duck!',
    },
    again: {
      id: 'pell.bellows.again',
      greet: [
        'Oh! It’s you. Isn’t it? You’ve got the look. The I’ve-done-this-before look.',
        'Strange. I feel as though I’ve told you all this already.',
      ],
      choices: [
        { label: 'What’s below?', reply: ['Rot Gardens. Flammable. I go ahead. I’m starting to think the Works keep sending you back.'] },
        { label: 'Any glowseeds?', reply: ['Always. Here. Throw them at anything with teeth.'], gift: 'seeds' },
      ],
      farewell: 'See you further down!',
    },
    veteran: {
      id: 'pell.bellows.veteran',
      greet: [
        'You again! Right. Rot Gardens, flammable, I go ahead, you save the day. Same as always.',
        'I’ve started leaving the kettle on for you.',
      ],
      choices: [
        { label: 'Any glowseeds?', reply: ['Already in your satchel. I’m getting good at this.'], gift: 'seeds' },
      ],
      farewell: 'Further down!',
    },
  },
  // Floor 2 — the Rot Gardens.
  fungal: {
    first: {
      id: 'pell.rot.first',
      greet: [
        'You made it! I was worried. I’m always worried, but specifically about you.',
        'The air’s thicker down here. The Old Ones say the Works are holding their breath.',
      ],
      choices: [
        { label: PIN, reply: ['There’s a room sealed up behind the rot. I’ve marked it on your compass. Don’t tell the Old Ones I peeked.'], gift: 'pin' },
        { label: PAGE, reply: ['This page was stuck in a mushroom. I can’t read it. You look like someone who can.'], gift: 'page' },
      ],
      farewell: 'Cisterns next. Bring a towel. I didn’t.',
    },
    again: {
      id: 'pell.rot.again',
      greet: ['There you are. I kept a path clear for you. Mostly clear. Some of it is on fire.'],
      choices: [
        { label: PIN, reply: ['Marked. Same as last time, probably.'], gift: 'pin' },
        { label: PAGE, reply: ['Another page. The mushrooms keep eating them. Take it before they do.'], gift: 'page' },
      ],
      farewell: 'Cisterns next. Towel!',
    },
  },
  // Floor 2 (the other door) — the Cold Store. First draft.
  frozen: {
    first: {
      id: 'pell.cold.first',
      greet: [
        'It’s freezing. I’ve lost the feeling in two fingers and one of my opinions.',
        'Everything in here keeps. Let’s not be one of the things it keeps.',
      ],
      choices: [
        { label: PIN, reply: ['There’s a locker nobody’s opened in years. I’ve marked it.'], gift: 'pin' },
        { label: PAGE, reply: ['A frozen page. Thaw it gently. It might be a spell, or a very old grocery list.'], gift: 'page' },
      ],
      farewell: 'See you further down. Somewhere warmer, please.',
    },
    again: {
      id: 'pell.cold.again',
      greet: ['Still cold. Still here. Still slightly worried about you.'],
      choices: [
        { label: PIN, reply: ['Marked it. Mind the ice.'], gift: 'pin' },
        { label: PAGE, reply: ['Frozen page. Same as always. Thaw gently.'], gift: 'page' },
      ],
      farewell: 'Somewhere warmer next!',
    },
  },
  // Floor 3 — the Drowned Cisterns.
  flooded: {
    first: {
      id: 'pell.cisterns.first',
      greet: [
        'I went down to the sump. I saw it. The Leviathan. I did not scream. Much.',
        'It hates the dry. Drain its pool, and it’s only a very large, very cross fish.',
      ],
      choices: [
        { label: PIN, reply: ['Behind the old valves there’s a room nobody’s opened. It’s marked.'], gift: 'pin' },
        { label: PAGE, reply: ['It was floating. Pages float, you know. It’s the only thing down here that does.'], gift: 'page' },
        { label: 'You look cold.', reply: ['My last tin of tea. No, take it. Don’t argue. You need it more than I do.'], gift: 'tea' },
      ],
      farewell: 'I’m going on to the Kiln. Someone has to map it. Don’t worry about me. I’ve got a lantern.',
    },
    again: {
      id: 'pell.cisterns.again',
      greet: ['The sump again. Drain it, remember? You do remember. You’ve got the look.'],
      choices: [
        { label: PIN, reply: ['Marked. Behind the valves, as ever.'], gift: 'pin' },
        { label: PAGE, reply: ['A floating page. Dry it off.'], gift: 'page' },
        { label: 'You look cold.', reply: ['Tea. Take it. I insist, every time.'], gift: 'tea' },
      ],
      farewell: 'Kiln next. I’ll go ahead. I always go ahead.',
    },
  },
  // Floor 3 (the other door) — the Glass Galleries. First draft.
  crystal: {
    first: {
      id: 'pell.glass.first',
      greet: [
        'Don’t look at your reflection too long. It starts looking back. I’m fairly sure that’s not normal.',
        'The glass hums when the Heart beats. It’s humming faster.',
      ],
      choices: [
        { label: PIN, reply: ['There’s a gallery behind the mirrors. I’ve marked it. Don’t make eye contact.'], gift: 'pin' },
        { label: PAGE, reply: ['This page was under a lens. The writing moves. Good luck.'], gift: 'page' },
        { label: 'You look cold.', reply: ['My last tin of tea. Take it. The glass doesn’t drink.'], gift: 'tea' },
      ],
      farewell: 'Kiln next. I’ll go ahead. The glass says I shouldn’t. I’m ignoring the glass.',
    },
    again: {
      id: 'pell.glass.again',
      greet: ['The glass remembers you. I do too, somehow.'],
      choices: [
        { label: PIN, reply: ['Behind the mirrors. Marked.'], gift: 'pin' },
        { label: PAGE, reply: ['A moving page. Hold it still.'], gift: 'page' },
        { label: 'You look cold.', reply: ['Tea. Take it.'], gift: 'tea' },
      ],
      farewell: 'Kiln next. Ahead, as always.',
    },
  },
};

/**
 * Floor 4: Pell has gone ahead. His camp is cold; his last map page lies on
 * the bedroll (read in his voice).
 */
export const PELL_LAST_PAGE = {
  first: {
    id: 'pell.kiln.page',
    lines: [
      'The Kiln. The stoker is sad, I think. Don’t tell anyone I said that.',
      'The old flue goes up from the Heart. I’m going to make sure it’s open. See you at the top. P.',
    ],
  },
  again: {
    id: 'pell.kiln.page.again',
    lines: ['Gone ahead again. Flue, top, see you there. P. P.S. The stoker is still sad.'],
  },
} as const;

/**
 * Pell's map pages (the Journal): one per floor he was met on, in his voice.
 * The Kiln's is his last page (above).
 */
export const PELL_MAP_PAGES: Readonly<Partial<Record<StoryBiome, { title: string; text: string }>>> = {
  earthen: { title: 'The Bellows', text: 'The Bellows. Breathes every ninety seconds, like clockwork, because it is clockwork. The duck is in charge.' },
  fungal: { title: 'The Rot Gardens', text: 'The Rot Gardens. Do not light anything. Do not light anything at all. I lit something.' },
  frozen: { title: 'The Cold Store', text: 'The Cold Store. Everything keeps. It kept my sandwich for a year. I did not eat it.' },
  flooded: { title: 'The Drowned Cisterns', text: 'The Cisterns. Wet. A large tenant in the sump. Its pool drains through the floor, if you are brave.' },
  crystal: { title: 'The Glass Galleries', text: 'The Glass Galleries. The light bends, and so does your sense of direction. Follow the humming.' },
};

/** The ending, when Pell made it up the flue ahead of you. */
export const PELL_ENDING = {
  first: { id: 'pell.ending', text: 'You made it! So did I. And I finished the map. Well. Nearly.' },
  again: { id: 'pell.ending.again', text: 'Top of the flue. I told you. I’m very good at further.' },
} as const;
