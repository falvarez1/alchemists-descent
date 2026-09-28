import type { Chain } from './chain';
import type { Leg } from './limb';
import type { RigPoint } from './physics';
import type { SoftBody } from './softbody';

/**
 * A creature's physical body (the Rain World layer): verlet chunks, chains,
 * gripping legs and an optional soft body, plus a small scalar store for the
 * species' springs and phases. Tick-owned and never saved — like the Weaver's
 * locomotion it rebuilds from the gameplay body after a load.
 */
export interface CreatureRig {
  /** Which species builder made it; a mismatch rebuilds. */
  species: string;
  /** Simulation tick of the last step (render never steps). */
  tick: number;
  pts: RigPoint[];
  chains: Chain[];
  legs: Leg[];
  soft: SoftBody | null;
  /** Species scalars: each species names its own indices. */
  f: Float64Array;
  /** Frame of the last hit already answered physically. */
  hitSeen: number;
}

export function makeRig(species: string, scalars = 32): CreatureRig {
  return { species, tick: -1, pts: [], chains: [], legs: [], soft: null, f: new Float64Array(scalars), hitSeen: -1 };
}
