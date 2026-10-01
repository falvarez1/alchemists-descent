import type { EnemyKind } from '@/core/types';
import type { Beat, StoryBiome } from './types';

/**
 * THE DOCENT — Master Aldous Wren, the Guild's old docent, who stayed behind
 * to catalogue the Works' new life. Dry, fond, unhurried. He speaks from the
 * Works' brass speaking-pipes (voice: "Daniel"). The late reveal, kept light:
 * he never left. His voice is an echo the Works kept, like the others.
 *
 * Pipes: a floor's pipes speak in the order the player passes them (so the
 * floor reads as one thought whatever the route), except where a line
 * belongs to a place (floor 1's hand-placed pipes name their rooms). Each
 * pipe speaks once per run. A heard beat plays its `again` line on later
 * runs, or keeps quiet.
 */
export interface PipeScript {
  /** Lines pinned to a named pipe site (floor 1's hand-placed pipes). */
  sites?: Readonly<Record<string, Beat>>;
  /** Everything else, in the order the pipes are passed. */
  sequence: readonly Beat[];
}

export const DOCENT_PIPES: Readonly<Partial<Record<StoryBiome, PipeScript>>> = {
  // Floor 1 — THE BELLOWS (the hand-built Works). Sites: world/breathingWorks WORKS_PIPES.
  earthen: {
    sites: {
      intake: {
        id: 'pipe.bellows.intake',
        first: 'The Bellows. The lungs of the Works. They have breathed for a hundred years, and never once asked permission.',
        again: 'The Bellows again. They remember you. I would not take it personally.',
      },
      gallery: {
        id: 'pipe.bellows.gallery',
        first: 'The Guild built the Tea Engine to settle an argument. Nobody remembers the argument. The tea was excellent.',
        again: 'Mind the duck. I say it every time, and it has never once been unnecessary.',
      },
      refuge: {
        id: 'pipe.bellows.refuge',
        first: 'The Warm Refuge. Sit a while. The Works have always been kinder to those who sit still.',
        again: null,
      },
      undertow: {
        id: 'pipe.bellows.undertow',
        first: 'The lamps never reached the Undertow. The Guild called it thrift. I call it an oversight with a view.',
        again: null,
      },
      bell: {
        id: 'pipe.bellows.bell',
        first: 'The Lower Bell. Every floor below is hungrier than this one. Carry the bell; the gates still answer to it.',
        again: 'Down you go. You know the way. So, I suspect, does the way.',
      },
    },
    sequence: [],
  },
  // Floor 2 — THE ROT GARDENS (the gut).
  fungal: {
    sequence: [
      {
        id: 'pipe.rot.1',
        first: 'The Rot Gardens. The gut of the Works, where the Guild’s leftovers learned to grow. Everything here is food, or hoping to be.',
        again: 'The Gardens have grown since your last visit. It is their only hobby.',
      },
      {
        id: 'pipe.rot.2',
        first: 'Marsh gas gathers under the ceilings. It is perfectly harmless, right up until it is the opposite.',
        again: null,
      },
      {
        id: 'pipe.rot.3',
        first: 'Somewhere down here the Old Ones keep their beds. Tread softly. They tread softly around yours.',
        again: null,
      },
    ],
  },
  // Floor 2 (the other door) — THE COLD STORE. First draft; the Biomes workstream owns the floor.
  frozen: {
    sequence: [
      {
        id: 'pipe.cold.1',
        first: 'The Cold Store. The Guild kept the Works’ temper here, in ice. Also the milk.',
        again: 'Still cold. The milk, I am told, is still perfectly fine.',
      },
      {
        id: 'pipe.cold.2',
        first: 'Everything down here keeps. Food, water, grudges. Keep moving, and you will not join them.',
        again: null,
      },
    ],
  },
  // Floor 3 — THE DROWNED CISTERNS (the veins).
  flooded: {
    sequence: [
      {
        id: 'pipe.cisterns.1',
        first: 'The Cisterns carried the Works’ water, once. Now the water carries itself, and a good deal else besides.',
        again: 'Still wet, I’m afraid. It is a cistern. We did try.',
      },
      {
        id: 'pipe.cisterns.2',
        first: 'Water carries a current. So will you, if you are careless with a spark. Stand somewhere dry, and be clever.',
        again: null,
      },
      {
        id: 'pipe.cisterns.3',
        first: 'The thing in the sump was a pump, originally. I suspect it has forgotten. I suspect it is happier that way.',
        again: null,
      },
    ],
  },
  // Floor 3 (the other door) — THE GLASS GALLERIES. First draft; the Biomes workstream owns the floor.
  crystal: {
    sequence: [
      {
        id: 'pipe.glass.1',
        first: 'The Glass Galleries. The Guild ground its lenses here, to watch the Heart. The glass, it turns out, watched back.',
        again: 'The glass remembers you. Try not to squint at it.',
      },
      {
        id: 'pipe.glass.2',
        first: 'Light behaves oddly in the Galleries. It has had a great deal of time to practise.',
        again: null,
      },
    ],
  },
  // Floor 4 — THE KILN HEART (the heart).
  volcanic: {
    sequence: [
      {
        id: 'pipe.kiln.1',
        first: 'The Kiln Heart. Listen. That beat is not yours. It is slower than yours, and it is failing.',
        again: 'The Heart remembers you. It has been counting.',
      },
      {
        id: 'pipe.kiln.2',
        first: 'Its stoker is still at its post. It was always the most loyal thing down here. That is rather the difficulty.',
        again: null,
      },
      {
        id: 'pipe.kiln.3',
        first: 'When the Heart stops fighting, it will heave, and everything below will come up to meet you. When it does: climb.',
        again: 'When it heaves, climb. You know this. I simply enjoy saying it.',
      },
    ],
  },
};

/**
 * BOSS PROLOGUES (Nine Sols weight, not length): one line as the arena comes
 * into view, under a short camera reveal and the name card. Keyed by the
 * boss kind so a new biome's guardian slots in.
 */
export const BOSS_PROLOGUES: Readonly<Partial<Record<EnemyKind, Beat>>> = {
  leviathan: {
    id: 'prologue.leviathan',
    first: 'The sump. It was a pump, once. It has not been one for a very long time.',
    again: 'The sump. You remember the way it looks at you.',
  },
  colossus: {
    id: 'prologue.colossus',
    first: 'The Kiln, and its stoker, still at its post after all these years. Go gently. It will not.',
    again: 'The Kiln. It has kept the fire in for you.',
  },
};

/** THE KILN ESCAPE: the Heart's last great heave. */
export const ESCAPE_LINES = {
  heave: {
    id: 'escape.heave',
    first: 'The Heart is heaving. Up, apprentice! The flue! Now!',
    again: 'Up! You know the way!',
  },
  climb: {
    id: 'escape.climb',
    first: 'Do not look down. It is only lava. It is only everything.',
    again: null,
  },
  top: {
    id: 'escape.top',
    first: 'Nearly there. I can hear the town.',
    again: null,
  },
  /** A fall in the climb sends him back to the flue's foot (said once a run, the first time he is sent back). */
  retry: {
    id: 'escape.retry',
    first: 'Again, apprentice. The flue is patient. It has had a hundred years of practice.',
    again: 'Again. The flue is patient.',
  },
} as const satisfies Readonly<Record<string, Beat>>;

/**
 * BOSS EPILOGUES: one line as a guardian falls (said once ever: a joke told
 * twice is a lecture). The Colossus's goes out with the Heart's heave (the
 * escape's first line follows it in the same breath); the Leviathan's after
 * the sump goes quiet. Keyed by boss kind.
 */
export const BOSS_EPILOGUES: Readonly<Partial<Record<EnemyKind, Beat>>> = {
  leviathan: {
    id: 'epilogue.leviathan',
    first: 'Quiet. Somebody has switched the pump off at last. It took forty years and a stranger.',
    again: null,
  },
  colossus: {
    id: 'epilogue.colossus',
    first: 'It has stopped shovelling. Nobody thought to tell it that it could.',
    again: null,
  },
};

/** The escape's objective line (the HUD shows it; the narrator does not read it). */
export const ESCAPE_OBJECTIVE = 'Climb the flue. Up and out.';

/**
 * One-time asides: said once ever, the first time the apprentice does the
 * thing (then never again — a joke told twice is a lecture).
 */
export const DOCENT_ASIDES = {
  /** The first corpse lifted on the wand's brass thread (combat/Telekinesis). */
  telekinesis: {
    id: 'aside.telekinesis',
    first: 'Guild regulations forbid that, strictly. The Guild, however, is not here.',
    again: null,
  },
  /** The first creature the cellar (not the wand) killed: any `alchemyKill`. */
  alchemy: {
    id: 'aside.alchemy',
    first: 'That was not the wand, apprentice. That was the cellar, doing as it was told. The Guild called it yield. The insurers had another word.',
    again: null,
  },
  /** An alchemical chain of three (`alchemyKill`, chain 3). */
  chain: {
    id: 'aside.chain',
    first: 'Three in a chain. The Guild gave medals for less. They were tin, and for punctuality.',
    again: null,
  },
  /** The alchemist alight (status.burning, read once a tick in the director). */
  burning: {
    id: 'aside.burning',
    first: 'You are on fire. I mention it only because nobody else will.',
    again: null,
  },
  /** The first waystone lit (`waystoneLit`). */
  waystone: {
    id: 'aside.waystone',
    first: 'A waystone, lit. The Guild installed them so that nobody would get lost, and then mislaid the map.',
    again: null,
  },
  /** The first cauldron brew (`recipeBrewed`). */
  brew: {
    id: 'aside.brew',
    first: 'An elixir. Do not call it soup. The Guild was very sensitive on the point.',
    again: null,
  },
  /** The first cauldron come upon (`cauldronView`): floor 1's Refuge Kettle, lit before the alchemist arrives. */
  kettle: {
    id: 'aside.kettle',
    first: 'A kettle, already lit. Pour in what you find; the book will say how close you came. Pell would call it tea. Pell calls most things tea.',
    again: null,
  },
  /** The first empty flask (`flaskDry`). */
  flask: {
    id: 'aside.flask',
    first: 'An empty flask. There is no elegant way to be disappointed by one, and yet you have found it.',
    again: null,
  },
  /** The lantern hooded by choice (`lanternHooded`). */
  hood: {
    id: 'aside.hood',
    first: 'Hooded. Discretion, at last. The Works are watching you learn it, and taking notes.',
    again: null,
  },
  /** Eyes in the wand's beam (`eyeshineCaught`). */
  eyeshine: {
    id: 'aside.eyeshine',
    first: 'Eyes in the dark. Do not wave. They take it as an invitation.',
    again: null,
  },
  /** A stand of living wood brought down (`treeFelled`). */
  tree: {
    id: 'aside.tree',
    first: 'A tree has come down. The Guild forbade shouting “timber” on safety grounds. I suggest you disregard them.',
    again: null,
  },
  /** A creature felled by a thrown or kicked body (`alchemyKill`, cause bowled). */
  bowled: {
    id: 'aside.bowled',
    first: 'You have hit one thing with another thing. The Guild had a word for that, and the word was “don’t”.',
    again: null,
  },
  /** The floor's lock first seen (`lockChanged` 'seen', world/locks): one aside per lock, said once ever. */
  lockGasBell: {
    id: 'aside.lock.gasbell',
    first: 'A bell hung full of marsh gas. The Guild called it a lock; I call it a fuse with a good address. Light it from a long way off.',
    again: null,
  },
  lockWeir: {
    id: 'aside.lock.weir',
    first: 'The Weir. Water carries a current, apprentice, which the Guild’s engineers called a convenience. Open the sluice, then stand on something dry.',
    again: null,
  },
  lockCrucible: {
    id: 'aside.lock.crucible',
    first: 'The Crucible, kept at heat for the gate’s sake. Quench it, and from a distance: the steam has never once been introduced.',
    again: null,
  },
  /** A lock cracked open by the Works themselves (`lockChanged` 'relented'). */
  lockRelent: {
    id: 'aside.lock.relent',
    first: 'The Works relent. They do, you know, if you wait. It is their one concession to visitors.',
    again: null,
  },
} as const satisfies Readonly<Record<string, Beat>>;

/**
 * Asides keep a rest between them and never cut in over another line (game/story/StoryDirector):
 * the first few minutes of a run can set off half a dozen of them, and he is a docent, not a commentator.
 */
export const ASIDE_REST_S = 22;
