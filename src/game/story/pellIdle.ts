/**
 * PELL between visits (presentation only, pure): a seeded, weighted pick of
 * what he does next. The rig's acts are the figure's (render/story/figurePose);
 * the weights make a sketching man who also sips, checks the map against the
 * wall, rubs his hands when the floor is cold, crouches to look at the floor
 * and, rarely, sneezes.
 */

export interface IdleAct {
  act: string;
  /** Relative weight (bigger = more often). */
  w: number;
  /** How long he does it (s): [min, max]. */
  secs: readonly [number, number];
  /** Extra weight on the cold floors. */
  cold?: number;
}

/** Floors where the air bites (the Cold Store, the Glass Galleries' chill). */
const COLD_BIOMES: ReadonlySet<string> = new Set(['frozen', 'crystal']);

export const IDLE_ACTS: readonly IdleAct[] = [
  { act: 'sketch', w: 4, secs: [6, 10] },
  { act: 'warm', w: 2.4, secs: [4, 6] },
  { act: 'rock', w: 2, secs: [2.5, 4] },
  { act: 'lookup', w: 1.5, secs: [2.5, 3.5] },
  { act: 'check', w: 1.6, secs: [3.5, 5] },
  { act: 'sip', w: 1.6, secs: [4, 5.5] },
  { act: 'rub', w: 0.9, secs: [3, 4.5], cold: 3.2 },
  { act: 'sneeze', w: 0.45, secs: [2.2, 2.2] },
  { act: 'kneel', w: 0.5, secs: [2.5, 3.5], cold: 1.3 },
];

/** A small seeded generator (mulberry32): the same camp idles the same way for a given run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What he does next and for how long: a weighted pick, never the act he has just done. */
export function pickIdle(previous: string, biome: string, rand: () => number, acts: readonly IdleAct[] = IDLE_ACTS): { act: string; seconds: number } {
  const cold = COLD_BIOMES.has(biome);
  const options = acts.filter(a => a.act !== previous);
  const weight = (a: IdleAct): number => (cold && a.cold !== undefined ? a.cold : a.w);
  let total = 0;
  for (const a of options) total += weight(a);
  let r = rand() * total;
  let chosen = options[options.length - 1]!;
  for (const a of options) {
    r -= weight(a);
    if (r < 0) { chosen = a; break; }
  }
  return { act: chosen.act, seconds: chosen.secs[0] + rand() * (chosen.secs[1] - chosen.secs[0]) };
}
