import type { Critter, CritterKind } from '@/core/types';
import { LIGHT_RESPONSE } from '@/config/darkness';

/**
 * Breathing Works wave 2 (WS-N): organisms — ambient life with behaviour.
 *
 * They ride the critter layer (`Critter` records in `CrittersApi.list`, saved
 * with the level's `fauna`), so persistence, the debug tool and the inspector
 * already see them. What makes them organisms is that each one has a small
 * state machine that reads and writes the grid: a glow-worm's thread snares
 * what flies into it, a puffer bursts into real marsh gas, a snapjaw bites
 * whatever brushes it and can be fed or burned, an isopod curls into a ball
 * and rolls, a leech latches onto a wading alchemist.
 */

/** Kinds handled by game/organisms (the rest keep Critters' original rules). */
export const ORGANISM_KINDS: ReadonlySet<CritterKind> = new Set<CritterKind>([
  'glowworm', 'puffer', 'snapjaw', 'isopod', 'leech', 'emberbeetle', 'ashmoth',
  'frostmite', 'snowmoth', 'brineskater', 'glassbeetle', 'prismmoth', 'lensmite',
]);

/** Wall crawlers (game/organisms/crawler): the hand-on-the-wall walkers. */
export const CRAWLER_KINDS: ReadonlySet<CritterKind> = new Set<CritterKind>([
  'isopod', 'emberbeetle', 'frostmite', 'glassbeetle', 'lensmite',
]);

export function isOrganism(kind: CritterKind): boolean {
  return ORGANISM_KINDS.has(kind);
}

/** Sessile bodies never drift; they live where they are rooted. */
export const SESSILE_KINDS: ReadonlySet<CritterKind> = new Set<CritterKind>(['glowworm', 'puffer', 'snapjaw']);

/** Small fliers a glow-worm thread or a spider web can hold. */
export const SNARE_PREY: ReadonlySet<CritterKind> = new Set<CritterKind>(['moth', 'fly', 'firefly', 'ashmoth', 'snowmoth', 'prismmoth']);

/** What a snapjaw will close on and swallow whole. */
export const SNAPJAW_PREY: ReadonlySet<CritterKind> = new Set<CritterKind>([
  'moth', 'fly', 'firefly', 'beetle', 'isopod', 'ashmoth', 'emberbeetle', 'fish', 'leech',
]);

/* ---- per-kind states (Critter.state) ---- */

export const GLOW = { FISH: 0, REEL: 1, RETRACT: 2 } as const;
export const PUFF = { GROW: 0, SPENT: 1 } as const;
export const SNAP = { OPEN: 0, TELL: 1, SNAP: 2, CHEW: 3, REOPEN: 4 } as const;
export const CRAWL = { WALK: 0, BALL: 1, UNCURL: 2, FEED: 3 } as const;
export const LEECH = { SWIM: 0, LATCHED: 1, BEACHED: 2 } as const;

/* ---- tuning (FEEL.md §7 "Organisms" records these) ---- */

/** Glow-worm: thread lowering speed (cells/tick), reel speed with prey, retract speed. */
export const GLOW_LOWER = 0.05;
export const GLOW_REEL = 0.14;
export const GLOW_RETRACT = 0.9;
/** Glow-worm: beam coverage on its body that makes it haul its lure up — the
 *  light wave's photophobe threshold (config/darkness LIGHT_RESPONSE.flinchAt). */
export const GLOW_LIGHT_SHY = LIGHT_RESPONSE.flinchAt;
/** Glow-worm: ticks it stays hidden after a disturbance (plus a per-individual spread). */
export const GLOW_HIDE = 260;
/** Glow-worm: how long a meal glows in its belly. */
export const GLOW_MEAL = 900;

/** Puffer: inflation per tick (full in ~35 s) and the minimum that bursts. */
export const PUFF_GROW = 1 / 2100;
export const PUFF_RIPE = 0.4;
/** Puffer: marsh gas written into empty cells, radius 3 + 4·inflation. */
export const PUFF_RADIUS = 3;
export const PUFF_RADIUS_K = 4;

/** Snapjaw: trigger reach from the jaw, bite reach at the snap, tell length (ticks). */
export const SNAP_TRIGGER = 10;
export const SNAP_BITE = 7.5;
export const SNAP_TELL = 12;
/** Snapjaw: damage to the alchemist, to a creature; digestion of a swallowed meal. */
export const SNAP_DMG_PLAYER = 11;
export const SNAP_DMG_CREATURE = 16;
export const SNAP_DIGEST = 780;
/** Snapjaw: heat it soaks before it catches, and the char that kills it (heat units,
 *  sampled every 3 ticks: ~1 per sample once alight, up to 4 per sample from outside flame). */
export const SNAP_IGNITE = 10;
export const SNAP_BURN = 44;
export const SNAP_HP = 32;

/** Crawlers (isopods, ember beetles): ticks per cell step; ball rest before uncurling. */
export const CRAWL_STEP_TICKS = 5;
export const BALL_REST = 170;

/** Leech: swim speed toward a wading target, drain cadence, meal that sates it. */
export const LEECH_SPEED = 0.34;
export const LEECH_DRAIN_TICKS = 150;
export const LEECH_DRAIN = 2;
export const LEECH_SATED = 5;
/** Leech: ticks out of water (on a dry alchemist) before it lets go. */
export const LEECH_DRY = 300;
export const LEECH_MAX_LATCHED = 3;

let transientKeys = 0;

/** Stable handle for cross-references (snares, jaws, latches). */
export function critterKey(c: Critter): string {
  if (!c.id) c.id = `t-${c.kind}-${++transientKeys}`;
  return c.id;
}
