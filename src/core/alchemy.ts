/**
 * THE EXPERIMENT (alchemy as a discovery game): the types the cauldron, the
 * Grimoire, the bowl panel and the potion chips share. Plain data, no imports,
 * so the store, the events and the UI can all name them without a cycle.
 */

/**
 * How a reagent sits in a mix that is close to something undiscovered, said the
 * way the children's game says it WITHOUT spelling the answer: `hot` = it belongs
 * and there is enough, `warm` = it belongs and wants more, `cold` = it has no
 * part in whatever this is.
 */
export type MixFeel = 'hot' | 'warm' | 'cold';

/**
 * What came of a mix after the fire had been on it a moment: `inert` = nothing
 * in it answers anything, `close` = the right ingredients are in but the amounts
 * are short, `muddy` = the amounts are met but something foreign spoils it.
 */
export type MixVerdict = 'inert' | 'close' | 'muddy';

/** One reagent in the bowl: its cell id, how many cells, and (once judged) how it feels. */
export interface BowlReagent {
  cell: number;
  n: number;
  feel: MixFeel | null;
}

/** What the bowl panel shows: the live contents of the cauldron basin and where its brew stands. */
export interface CauldronView {
  /** False when nobody is near enough to read it (the panel hides). */
  visible: boolean;
  /** The basin's bottom-middle cell (the panel anchors above it). */
  x: number;
  y: number;
  reagents: BowlReagent[];
  /** Reagent cells in the bowl (elixir already in it is not counted). */
  mass: number;
  /** True while flame hugs the cauldron. */
  heated: boolean;
  /** 0..1 of a running brew; 0 when nothing is simmering. */
  progress: number;
  /** A recipe's amounts are met right now (the simmer has begun, or waits on fire). Names nothing. */
  matched: boolean;
  /** The verdict on the mix as it stands, once it has been heated long enough to judge; else null. */
  verdict: MixVerdict | null;
  /** An unnamed ingredient is missing from an otherwise close mix (3-ingredient recipes). */
  missing: number;
  /** The potion in the bowl, finished and waiting to be siphoned (its cell and how many). */
  elixir: { cell: number; n: number } | null;
}

/** A failed attempt, as the Grimoire's experiment log keeps it. */
export interface ExperimentEntry {
  /** The mix's signature: its reagent counts, sorted ("2:9,18:4"). The log's identity for "the same mix". */
  sig: string;
  counts: Record<string, number>;
  verdict: MixVerdict;
  /** The recipe a `close`/`muddy` mix leaned towards (its id). */
  closeTo?: string;
  feel?: Record<string, MixFeel>;
  /** How many times this exact mix has been tried. */
  tries: number;
}

/** The `brewAttempt` event: a mix that was heated and answered nothing, with what the cauldron made of it. */
export interface BrewAttemptInfo {
  counts: Record<number, number>;
  verdict: MixVerdict;
  /** The recipe it leans towards, when close or muddy. */
  closeTo: string | null;
  /** That recipe is already in the Grimoire (so the verdict may name it). */
  closeToKnown: boolean;
  feel: Record<number, MixFeel>;
  missing: number;
  /** First time this exact mix has been tried (the log gains a line). */
  first: boolean;
  /** How many times, counting this one. */
  tries: number;
}

/** The cauldron, read-only (ctx.brewing): what the panel and the probes look at. */
export interface BrewingApi {
  view(): CauldronView;
}
