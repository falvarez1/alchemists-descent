import type { KitId } from '@/core/run';
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
 * A visit is a greeting (said line by line as the text types on), maybe a
 * NOTICE (one line about how the run is going), up to three choices, a reply,
 * and a farewell. Talking never pauses the run.
 *
 * The lines in PELL and PELL_LAST_PAGE that were recorded stay word for word
 * (their clips are keyed by the text); storyVoiceLines registers PELL for the
 * voice budget. The NOTICES, BARKS, second-talk lines, tea refusals and the
 * last page's P.S. are text first: they ship without a clip (the dialogue box
 * or a caption carries the words) and are not in the registry.
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
  /**
   * What he says instead when the gift is not needed (the tea, offered to someone
   * in rude health): the gift is not spent and the menu stays open.
   */
  refuse?: readonly string[];
  /** Offered only once this memory echo has played this run (the choice answers it). */
  requires?: { echo: string };
  /** A choice that can be made once a run (a reply that would not bear repeating). */
  once?: string;
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
const COLD = 'You look cold.';

/**
 * The tea is refused to someone who does not need it (from 90% health up). The
 * label is the apprentice's "You look cold.", so he answers it.
 */
const TEA_REFUSE_FIRST = ['Do I? I’m fine, it’s only the coat. You, though, are the picture of health. Ask me again once something has had a bite.'] as const;
const TEA_REFUSE_AGAIN = ['Not yet. You’re far too pink. I’ll keep the tin warm for when you’ve been bitten.'] as const;

/** The echo's answer (floor 2, once the apprentice has watched the surveyor come down on his rope). */
const ROPE: PellChoice = {
  label: 'I saw you come down.',
  reply: ['The rope. Yes. I’d like it noted that it was a very good rope, and that I did not scream. I made a noise. It was a wheeze, scientifically speaking.'],
  requires: { echo: 'echo.rot' },
  once: 'rope',
};

const ROT_AGAIN: readonly PellChoice[] = [
  { label: PIN, reply: ['Marked. Same as last time, probably.'], gift: 'pin' },
  { label: PAGE, reply: ['Another page. The mushrooms keep eating them. Take it before they do.'], gift: 'page' },
  ROPE,
];
const COLD_AGAIN: readonly PellChoice[] = [
  { label: PIN, reply: ['Marked it. Mind the ice.'], gift: 'pin' },
  { label: PAGE, reply: ['Frozen page. Same as always. Thaw gently.'], gift: 'page' },
];
const CISTERNS_AGAIN: readonly PellChoice[] = [
  { label: PIN, reply: ['Marked. Behind the valves, as ever.'], gift: 'pin' },
  { label: PAGE, reply: ['A floating page. Dry it off.'], gift: 'page' },
  { label: COLD, reply: ['Tea. Take it. I insist, every time.'], gift: 'tea', refuse: TEA_REFUSE_AGAIN },
];
const GLASS_AGAIN: readonly PellChoice[] = [
  { label: PIN, reply: ['Behind the mirrors. Marked.'], gift: 'pin' },
  { label: PAGE, reply: ['A moving page. Hold it still.'], gift: 'page' },
  { label: COLD, reply: ['Tea. Take it.'], gift: 'tea', refuse: TEA_REFUSE_AGAIN },
];

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
    // A regular gets one line of greeting (the second, about the kettle, became his
    // same-floor second-talk line) and the whole menu back.
    veteran: {
      id: 'pell.bellows.veteran',
      greet: [
        'You again! Right. Rot Gardens, flammable, I go ahead, you save the day. Same as always.',
      ],
      choices: [
        { label: 'What’s below?', reply: ['Rot Gardens. Flammable. I go ahead, you follow. Same as always, and I still say it like it’s news.'] },
        { label: 'Come with me.', reply: ['Ha! You ask every time. The answer is a very fond, very frightened no.'] },
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
        ROPE,
      ],
      farewell: 'Cisterns next. Bring a towel. I didn’t.',
    },
    again: {
      id: 'pell.rot.again',
      greet: ['There you are. I kept a path clear for you. Mostly clear. Some of it is on fire.'],
      choices: ROT_AGAIN,
      farewell: 'Cisterns next. Towel!',
    },
    veteran: {
      id: 'pell.rot.veteran',
      greet: ['You again. I’ve cleared the path. By which I mean I’ve stopped looking at the bits that are on fire.'],
      choices: ROT_AGAIN,
      farewell: 'Cisterns. Towel. You know.',
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
      choices: COLD_AGAIN,
      farewell: 'Somewhere warmer next!',
    },
    veteran: {
      id: 'pell.cold.veteran',
      greet: ['Still cold. You’ve stopped noticing, haven’t you? I haven’t stopped noticing for one second.'],
      choices: COLD_AGAIN,
      farewell: 'Somewhere warmer. Please.',
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
        { label: COLD, reply: ['My last tin of tea. No, take it. Don’t argue. You need it more than I do.'], gift: 'tea', refuse: TEA_REFUSE_FIRST },
      ],
      farewell: 'I’m going on to the Kiln. Someone has to map it. Don’t worry about me. I’ve got a lantern.',
    },
    again: {
      id: 'pell.cisterns.again',
      greet: ['The sump again. Drain it, remember? You do remember. You’ve got the look.'],
      choices: CISTERNS_AGAIN,
      farewell: 'Kiln next. I’ll go ahead. I always go ahead.',
    },
    veteran: {
      id: 'pell.cisterns.veteran',
      greet: ['The sump. You know the drill. I’ve stopped saying it, in case it’s rude. Drain it.'],
      choices: CISTERNS_AGAIN,
      farewell: 'Kiln next. You could go ahead this time. No? Quite right.',
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
        { label: COLD, reply: ['My last tin of tea. Take it. The glass doesn’t drink.'], gift: 'tea', refuse: TEA_REFUSE_FIRST },
      ],
      farewell: 'Kiln next. I’ll go ahead. The glass says I shouldn’t. I’m ignoring the glass.',
    },
    again: {
      id: 'pell.glass.again',
      greet: ['The glass remembers you. I do too, somehow.'],
      choices: GLASS_AGAIN,
      farewell: 'Kiln next. Ahead, as always.',
    },
    veteran: {
      id: 'pell.glass.veteran',
      greet: ['The glass has stopped humming at you. I can’t decide if that’s affection or a grudge.'],
      choices: GLASS_AGAIN,
      farewell: 'Kiln next. The glass has views. I’m not listening.',
    },
  },
};

/** What each gift is, in a word, beside its button (the apprentice's line stays in his voice; this is the instruction). */
export const PELL_GIFT_HINTS: Readonly<Record<PellGift, string>> = {
  seeds: 'Glowseeds',
  pin: 'Compass mark',
  page: 'A spell page',
  tea: 'Restores health',
};
/** The tea's button when the apprentice would not need it. */
export const PELL_TEA_UNNEEDED_HINT = 'You’re unhurt';

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
 * Added under his last page when the mark he gave on the way down led the
 * apprentice to a pickup. Hedged ("if you opened"): he went ahead, and never saw.
 */
export const PELL_PIN_PS = {
  first: 'P.S. If you opened the marked room, I hope it was gold. I did not open it. There was a noise, and I have a policy.',
  again: 'P.P.S. The marked room. Gold, I hope. I still haven’t opened it. The noise is still there.',
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

/* ---------------- text first: the notices, the barks, the second talk ---------------- */

/**
 * NOTICES: one line after his greeting, about how the run is going — read off
 * facts the game already keeps. At most one a visit, each at most once a run.
 * `ever` ones (kit, tier, boon jokes) are said at most once ever; the rest
 * answer a situation and may come round on another run. Lower `priority` first.
 * Every condition given must hold. Not voiced yet.
 */
export interface PellNotice {
  id: string;
  text: string;
  priority: number;
  ever?: boolean;
  kit?: readonly KitId[];
  biomes?: readonly StoryBiome[];
  /** Not on the first floor (the Refuge visit is the introduction). */
  minFloor?: number;
  /** Exactly this many return phials left. */
  phials?: number;
  minDeaths?: number;
  hp?: 'low' | 'high';
  minGold?: number;
  boon?: string;
  tier?: 'hard' | 'easy';
  daily?: true;
  /** His mark, given on an earlier floor, led the apprentice to a pickup. */
  pinPaid?: true;
}

/** Health fractions for the notices ("wearing rather more of yourself on the outside") and the tea. */
export const PELL_HP_LOW = 0.35;
export const PELL_HP_HIGH = 0.98;
/** At this fraction of health or more the tea is not needed (his refusal). */
export const PELL_TEA_REFUSE_AT = 0.9;
/** A purse worth remarking on (oz). */
export const PELL_GOLD_LOT = 250;

export const PELL_NOTICES: readonly PellNotice[] = [
  // The situation first.
  { id: 'hurt', priority: 0, hp: 'low',
    text: 'Oh dear. You’re wearing rather more of yourself on the outside than is usual. Sit. There’s a crate. It’s not load-bearing, I’ve checked.' },
  { id: 'pinpaid', priority: 1, pinPaid: true,
    text: 'You opened it, didn’t you? The marked room. I can always tell; you’ve the look of somebody who’s found something. Don’t tell me what. I’d only wish I’d been braver.' },
  { id: 'lastphial', priority: 2, phials: 1, minFloor: 2,
    text: 'One phial left. One’s plenty, so long as you don’t need it. That’s the whole trick with phials.' },
  { id: 'deaths3', priority: 3, minDeaths: 3,
    text: 'You’ve been put back together more than most. I keep your tally in pencil, in case you’d rather I rubbed it out.' },
  // The kit, where it meets the floor.
  { id: 'ember.fungal', priority: 4, ever: true, kit: ['ember'], biomes: ['fungal'],
    text: 'A Flame Jet. In the Rot Gardens. I’m going to stand a little further away, if that’s all right. Further. Yes, that’s better.' },
  { id: 'storm.flooded', priority: 4, ever: true, kit: ['storm'], biomes: ['flooded'],
    text: 'Chain Lightning, in the Cisterns. I’ve put the kettle down. I’d put myself down, but there’s nowhere dry.' },
  { id: 'frost.frozen', priority: 4, ever: true, kit: ['frost'], biomes: ['frozen'],
    text: 'A Frost Shard, in the Cold Store. Coals to Newcastle, the other way round. There must be a word for that.' },
  { id: 'ember.frozen', priority: 4, ever: true, kit: ['ember'], biomes: ['frozen'],
    text: 'A Flame Jet, in the Cold Store. Everyone else brings a scarf. I like your thinking.' },
  // The bargains struck in the Sanctum (by what they do: names may change).
  { id: 'boon.vampirism', priority: 5, ever: true, boon: 'vampirism', minFloor: 2,
    text: 'You’ve taken the bargain that drinks. I’m not going to ask what from. I’m going to stand over here.' },
  { id: 'boon.warmblood', priority: 5, ever: true, boon: 'warmblood', minFloor: 2,
    text: 'Warm blood. Lucky you. Mine’s mostly tea and worry.' },
  { id: 'boon.rimesoles', priority: 5, ever: true, boon: 'rimesoles', minFloor: 2,
    text: 'Rime on your soles, I see. You’ll walk on the water. I have only ever managed to walk in it.' },
  // The terms of the descent.
  { id: 'tier.hard', priority: 6, ever: true, tier: 'hard',
    text: 'Archmage terms. On purpose? I’d like it noted that I’d have ticked whichever box said “lie down”.' },
  { id: 'daily', priority: 7, ever: true, daily: true,
    text: 'Same Works for everyone today, I’m told. Does everybody get a duck? I do hope everybody gets a duck.' },
  // What you carry, and how you look.
  { id: 'gold', priority: 8, ever: true, minGold: PELL_GOLD_LOT, minFloor: 2,
    text: 'All that gold. It jingles, you know. Nothing down here can read, but everything can hear.' },
  { id: 'well', priority: 9, ever: true, hp: 'high', minFloor: 2,
    text: 'You look well! Horribly well. It’s suspicious. What have you been doing?' },
  { id: 'spark', priority: 10, ever: true, kit: ['spark'],
    text: 'The regulation case. I trust regulation. It has never once trusted me back.' },
];

/**
 * BARKS: a short line, through the caption channel, when something happens near
 * his camp. Once a run each. Not voiced.
 */
export interface PellBark {
  id: string;
  text: string;
}

export const PELL_BARKS = {
  fire: { id: 'fire', text: 'Is that — it’s fine. That’s fine. That is, I expect, what fire is like.' },
  corpse: { id: 'corpse', text: 'Is that — did you know them? Put them down. Gently. Not on the map.' },
  linger: { id: 'linger', text: 'Sorry, were you waiting for me to say something? I never can tell. Hello. Again.' },
  hurt: { id: 'hurt', text: 'You’re bleeding on the map. It’s fine. It’s a bit of colour.' },
  /** A hostile in sight: one line for its kind, else the general one. */
  hostile: {
    any: { id: 'hostile', text: 'Don’t look at it. If it doesn’t know I’m looking, it can’t know I’m here. It’s a new theory.' },
    slime: { id: 'hostile.slime', text: 'It’s just a slime. It’s just a slime. Tell me it’s just a slime.' },
    bat: { id: 'hostile.bat', text: 'Bats. They’re only ears with opinions.' },
    weaver: { id: 'hostile.weaver', text: 'Eight legs. I counted. Then I counted again, hoping.' },
  },
} as const;

/**
 * Said when the apprentice talks to him again on the same floor, instead of the
 * farewell over again: never the same as the last one said. `bye` ends the
 * talk; `menu` opens the choices he still has. Not voiced (except the kettle:
 * it was a veteran's greeting once, and its recording still fits).
 */
export const PELL_SECOND_TALK = {
  bye: [
    'Still here.',
    'Yes? Yes. Hello.',
    'I’ve nothing new. I have a great many old things.',
    'Don’t mind me. I’m only redrawing the same wall.',
    'Go on, then. I’ll be here. It’s rather the point of me.',
  ],
  menu: [
    'Changed your mind? Do say.',
    'Yes? Was there something else?',
    'Anything else? I’ve been practising saying that.',
  ],
  /** Added to `bye` on his own floor. */
  floor: {
    earthen: ['I’ve started leaving the kettle on for you.'],
    fungal: ['Mind the spores. And the other spores.'],
    frozen: ['I’d say something warm, but it would freeze.'],
    flooded: ['Mind the sump. I say that to everyone. There’s only you.'],
    crystal: ['Don’t look at the glass. I’m looking at it, so you needn’t.'],
  } as Readonly<Partial<Record<StoryBiome, readonly string[]>>>,
} as const;
