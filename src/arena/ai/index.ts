import { BasicBrain } from '@/arena/ai/brains/basic';
import { DummyBrain } from '@/arena/ai/brains/dummy';
import type { Brain, BrainId, BrainOptions } from '@/arena/ai/brain';

/**
 * THE BRAIN REGISTRY. One entry per brain id; a new brain (v2 `playbook`) is a class and a line here. The driver
 * (`driver.ts`) asks for a brain by id and never imports a concrete one.
 */

export { BRAIN_IDS, isBrainId } from '@/arena/ai/brain';
export type { Brain, BrainId, BrainOptions, BrainSelf, BrainStatus, Hands } from '@/arena/ai/brain';

const MAKERS: Readonly<Record<BrainId, (opts: BrainOptions) => Brain>> = {
  dummy: (opts) => new DummyBrain(opts),
  basic: (opts) => new BasicBrain(opts),
};

export function createBrain(id: BrainId, opts: BrainOptions): Brain {
  return MAKERS[id](opts);
}

/** One line for the panel and the console: what each brain is. */
export const BRAIN_BLURBS: Readonly<Record<BrainId, string>> = {
  dummy: 'stands, turns to the nearest foe, presses Z every 4 s and T every 9 s',
  basic: 'fights at weapon range, varies its footwork, dodges shots, saves mana, and uses fighter-specific abilities',
};
