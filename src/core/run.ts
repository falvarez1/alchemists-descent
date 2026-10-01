import type { Difficulty, EnemyKind } from '@/core/types';

/**
 * Cross-workstream run contracts (Breathing Works overhaul). Types only —
 * the run structure (game/RunDirector, meta profile), alchemical kills
 * (combat/AlchemyKills), clips (app/Clips) and audio all meet here so none
 * of them imports another's concrete class.
 */

/**
 * How the world — not the wand directly — finished a creature. A kill is
 * "alchemical" when the killing blow came from a material or physical
 * consequence the player set up: the grid did it.
 */
export type AlchemyCause =
  | 'burned'      // fire / ember / burning status
  | 'rendered'    // lava contact
  | 'steeped'     // steam / boiling water
  | 'shorted'     // electricity carried by a conductor (wet body, water, metal)
  | 'drowned'     // out of breath in liquid
  | 'dissolved'   // acid
  | 'shattered'   // frozen, then broken
  | 'flattened'   // crushed by falling debris, a rigid body or a collapse
  | 'detonated'   // gunpowder, marsh gas or another explosion the player did not cast
  | 'poisoned'    // toxic material
  | 'impaled'     // kicked or knocked into a hazard at speed
  | 'bowled';     // struck down by a body the alchemist threw, kicked or swung (combat/Telekinesis)

/** Where a run ended. `abandoned` = the player started a new run over it. */
export type RunOutcome = 'victory' | 'fallen' | 'abandoned';

/** Starting kits. Unlocked across runs by the meta profile. */
export type KitId = 'spark' | 'frost' | 'ember' | 'storm';

/** What a finished run hands the summary screen, the share text and the meta profile. */
import type { FighterId } from '@/content/fighters';

export interface RunSummary {
  outcome: RunOutcome;
  seed: number;
  /** YYYY-MM-DD when this was the daily seeded descent; null for a normal run. */
  daily: string | null;
  /** The player chose this seed on the title: the ledger and the share line name it. Absent on an ordinary run. */
  seedChosen?: boolean;
  kit: KitId;
  /** Who the run descended as; absent for the classic Alchemist (the ledger and the share line stay as they were). */
  fighter?: FighterId;
  /** 1-based floor reached (the floor the run ended on). */
  floor: number;
  floorName: string;
  floorsTotal: number;
  /** Real play time, excluding pauses and menus. */
  timeMs: number;
  kills: number;
  alchemicalKills: number;
  /** Longest chain of alchemical kills inside one chain window. */
  bestChain: number;
  deaths: number;
  gold: number;
  cardsFound: number;
  /** Short epitaph line: cause of the final death, or the victory line. */
  epitaph: string;
  /** The doors the run took, floor by floor (campaign level ids); absent on old ledgers. */
  path?: string[];
  /** The Sanctum boons the run struck, in the order taken (PerkId names); absent on old ledgers and boonless runs. */
  boons?: string[];
  /** The difficulty tier the run was played at (1 Apprentice … 4 Archmage); absent on ledgers from before the ladder. */
  difficulty?: Difficulty;
}

/** One alchemical kill, as announced to callouts, audio, stats and clips. */
export interface AlchemyKillInfo {
  kind: EnemyKind;
  cause: AlchemyCause;
  x: number;
  y: number;
  /** 1 for a lone kill; n for the nth alchemical kill inside the chain window. */
  chain: number;
  /** Extra gold the kill paid on top of the creature's normal bounty. */
  bonusGold: number;
}
