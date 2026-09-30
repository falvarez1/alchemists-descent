import type { StoryBiome } from './types';

/**
 * MEMORY ECHOES (Hollow Knight's dream-nail, Nine Sols' flashbacks). One
 * resonant valve per floor, off the main path. Turn it (E) and translucent
 * silhouettes of Guild workers enact a short scene where it happened while
 * the Docent narrates. The player keeps control; walking away ends it. The
 * scene is written into the Journal, where it can be heard again.
 *
 * Choreography is keyframed per actor in seconds on the echo's own clock:
 * between keys an actor slides from one `dx` (cells from the stage centre,
 * `dy` up/down) to the next — walking or running if it moved — and holds the
 * key's action. Actions are the story figure rig's (render/story/figure).
 */
export type FigureAct =
  | 'stand' | 'walk' | 'run' | 'crank' | 'carry' | 'write' | 'point' | 'wave' | 'kneel' | 'lookup'
  | 'shovel' | 'holdup' | 'warm' | 'sketch' | 'startle' | 'bell' | 'climb' | 'sit' | 'pat';

/** Silhouettes: the Guild's working dress, and the few who were not workers. */
export type FigureCostume = 'worker' | 'foreman' | 'docent' | 'surveyor' | 'stoker' | 'clerk' | 'grinder';

export interface EchoKey {
  /** Seconds on the echo clock. */
  t: number;
  /** Cells from the stage centre (+ right). */
  dx: number;
  /** Cells above the stage floor (a climber on a rope, a lift). */
  dy?: number;
  act: FigureAct;
  face: 1 | -1;
}

export interface EchoActor {
  costume: FigureCostume;
  keys: readonly EchoKey[];
  /** Stays after the others fade (the one who stayed). */
  lingers?: boolean;
}

export interface EchoScript {
  /** Stable id (Journal + meta). */
  id: string;
  title: string;
  /** The workers the Docent names (Hobb, Dunmore and Wick recur); each is named in the narration below. */
  cast?: readonly string[];
  /** The Docent's narration, said in order from the start of the echo. */
  lines: readonly string[];
  /** Length of the choreography in seconds (the echo lasts until this or the narration, whichever is later). */
  seconds: number;
  actors: readonly EchoActor[];
}

const k = (t: number, dx: number, act: FigureAct, face: 1 | -1, dy?: number): EchoKey => (dy === undefined ? { t, dx, act, face } : { t, dx, dy, act, face });

export const ECHOES: Readonly<Partial<Record<StoryBiome, EchoScript>>> = {
  // Floor 1 — the evening the Guild sealed the Bellows. One man stays.
  earthen: {
    id: 'echo.bellows',
    title: 'The Last Shift',
    cast: ['Hobb', 'Dunmore', 'Wick'],
    lines: [
      'The Bellows. The evening the Guild sealed them.',
      'Hobb on the wheel. Dunmore with the last crate. Wick on the bell, thanked by no one.',
      'We closed the valves by hand. The Works breathed out, and would not breathe in again.',
      'Everyone went up the lift that night. Nearly everyone.',
      'Someone had to stay and write it all down. I volunteered. It seemed the polite thing.',
    ],
    seconds: 27,
    actors: [
      // A fitter at the valve wheel, then away up the lift.
      { costume: 'worker', keys: [k(0, -34, 'crank', 1), k(7, -34, 'crank', 1), k(8, -34, 'stand', 1), k(13, 62, 'walk', 1), k(15, 62, 'stand', 1)] },
      // A porter with the last crate.
      { costume: 'worker', keys: [k(0, -12, 'carry', 1), k(2, -12, 'carry', 1), k(9, 58, 'carry', 1), k(11, 58, 'stand', 1)] },
      // The foreman rings the end of the shift, waves them on, follows.
      { costume: 'foreman', keys: [k(0, 22, 'bell', -1), k(5, 22, 'bell', -1), k(6, 22, 'wave', 1), k(11, 22, 'wave', -1), k(12, 22, 'stand', 1), k(16, 66, 'walk', 1), k(18, 66, 'stand', 1)] },
      // The docent, writing. He watches them go, and stays.
      { costume: 'docent', lingers: true, keys: [k(0, -58, 'write', 1), k(12, -58, 'write', 1), k(13, -58, 'lookup', 1), k(17, -58, 'lookup', 1), k(18, -52, 'walk', 1), k(20, -46, 'stand', 1), k(22, -46, 'write', 1), k(27, -46, 'write', 1)] },
    ],
  },
  // Floor 2 — a year ago, a surveyor with a lantern on a pole.
  fungal: {
    id: 'echo.rot',
    title: 'The Surveyor',
    lines: [
      'A year ago. A surveyor, coming down, with a lantern on a pole and a great deal of paper.',
      'He was frightened of nearly everything. He came down anyway.',
      'I did try to send him home. He was very polite about not listening.',
    ],
    seconds: 22,
    actors: [
      {
        costume: 'surveyor', lingers: true,
        keys: [
          k(0, -40, 'climb', 1, 46), k(4, -40, 'climb', 1, 4), k(4.6, -40, 'stand', 1), k(6, -40, 'lookup', 1), k(8, -40, 'stand', 1),
          k(8.4, -40, 'startle', -1), k(9.4, -40, 'stand', -1), k(11, -18, 'walk', 1), k(12, -18, 'sketch', 1), k(16, -18, 'sketch', 1),
          k(17, -18, 'lookup', -1), k(19, -18, 'stand', 1), k(22, 30, 'walk', 1),
        ],
      },
    ],
  },
  // Floor 2 (the other door) — the Cold Store's last delivery. First draft.
  frozen: {
    id: 'echo.cold',
    title: 'Dunmore’s Last Delivery',
    cast: ['Dunmore', 'Hobb'],
    lines: [
      'The Cold Store, on its last day. The ice for the Heart went down in blocks, on trolleys.',
      'Dunmore and Hobb had the trolleys, and were paid nothing extra for the cold.',
      'The final delivery never left. It is still here, perfectly preserved. So is the clerk’s temper.',
    ],
    seconds: 18,
    actors: [
      { costume: 'worker', keys: [k(0, -50, 'carry', 1), k(6, 10, 'carry', 1), k(7, 10, 'stand', 1), k(9, 10, 'warm', 1), k(18, 10, 'warm', 1)] },
      { costume: 'worker', keys: [k(0, -70, 'carry', 1), k(7, -8, 'carry', 1), k(8, -8, 'stand', 1), k(18, -8, 'stand', 1)] },
      { costume: 'clerk', lingers: true, keys: [k(0, 40, 'write', -1), k(9, 40, 'write', -1), k(10, 40, 'point', -1), k(12, 40, 'startle', -1), k(13, 40, 'write', -1), k(18, 40, 'write', -1)] },
    ],
  },
  // Floor 3 — the morning the Heart missed its first beat.
  flooded: {
    id: 'echo.cisterns',
    title: 'The Day the Heart Faltered',
    cast: ['Hobb', 'Dunmore', 'Wick'],
    lines: [
      'The Cisterns, on the morning the Heart missed its first beat.',
      'Every pipe in the Works went quiet at once. For a moment, you could hear the town above.',
      'Then the Works coughed, and the water ran the wrong way. We took that as a sign.',
      'Hobb and Dunmore ran for the lift. Wick knelt to listen at the pipe, which was the sort of thing Wick did.',
    ],
    seconds: 22,
    actors: [
      { costume: 'worker', keys: [k(0, -30, 'crank', 1), k(5, -30, 'crank', 1), k(5.5, -30, 'lookup', 1), k(10, -30, 'lookup', 1), k(10.3, -30, 'startle', -1), k(11.5, -30, 'stand', -1), k(15, -80, 'run', -1)] },
      { costume: 'worker', keys: [k(0, 10, 'crank', -1), k(5.2, 10, 'crank', -1), k(5.8, 10, 'lookup', -1), k(10, 10, 'lookup', -1), k(10.2, 10, 'startle', 1), k(11.2, 10, 'point', -1), k(13, 10, 'point', -1), k(16, -80, 'run', -1)] },
      { costume: 'foreman', lingers: true, keys: [k(0, 44, 'write', -1), k(5, 44, 'write', -1), k(5.4, 44, 'lookup', -1), k(10, 44, 'lookup', -1), k(10.4, 44, 'kneel', -1), k(13, 44, 'kneel', -1), k(14, 44, 'stand', -1), k(15, 44, 'wave', -1), k(18, 44, 'wave', -1), k(22, 10, 'walk', -1)] },
    ],
  },
  // Floor 3 (the other door) — the Great Lens. First draft.
  crystal: {
    id: 'echo.glass',
    title: 'The Great Lens',
    lines: [
      'The Glass Galleries, on the day the Great Lens was finished.',
      'Everyone stopped work to look through it. It showed the Heart, beating.',
      'Nobody wrote down what else it showed. I did ask.',
    ],
    seconds: 19,
    actors: [
      { costume: 'grinder', lingers: true, keys: [k(0, 0, 'kneel', 1), k(3, 0, 'kneel', 1), k(4, 0, 'holdup', 1), k(19, 0, 'holdup', 1)] },
      { costume: 'grinder', keys: [k(0, -50, 'write', 1), k(4, -50, 'write', 1), k(4.5, -50, 'lookup', 1), k(7, -18, 'walk', 1), k(8, -18, 'lookup', 1), k(19, -18, 'lookup', 1)] },
      { costume: 'clerk', keys: [k(0, 46, 'write', -1), k(5, 46, 'write', -1), k(8, 22, 'walk', -1), k(9, 22, 'lookup', -1), k(19, 22, 'lookup', -1)] },
    ],
  },
  // Floor 4 — the Guild's first stoker, a hundred years ago.
  volcanic: {
    id: 'echo.kiln',
    title: 'The First Stoker',
    cast: ['Wick'],
    lines: [
      'The Kiln, a hundred years ago. The Guild’s first stoker, on its very first morning.',
      'It was built to shovel coal, and not to think. It thought anyway. Mostly about coal.',
      'Wick, the foreman, patted its shoulder and told it well done. It had not been built for praise. It kept the sound.',
      'When the Heart began to fail, it would not leave it. It still hasn’t.',
      'Be kind to it, if you can. It is only doing its job.',
    ],
    seconds: 28,
    actors: [
      { costume: 'stoker', lingers: true, keys: [k(0, 26, 'shovel', 1), k(9, 26, 'shovel', 1), k(9.5, 26, 'stand', -1), k(12, 26, 'wave', -1), k(14, 26, 'stand', -1), k(15, 26, 'shovel', 1), k(28, 26, 'shovel', 1)] },
      { costume: 'foreman', keys: [k(0, -20, 'write', 1), k(5, -20, 'write', 1), k(7, 14, 'walk', 1), k(8, 14, 'pat', 1), k(10, 14, 'pat', 1), k(11, 8, 'walk', -1), k(12, 8, 'wave', 1), k(14, 8, 'wave', 1), k(19, -70, 'walk', -1)] },
    ],
  },
};
