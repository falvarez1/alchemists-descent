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
