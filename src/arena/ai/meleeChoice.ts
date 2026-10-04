import type { StockAttackKind } from '@/core/stockAttacks';
import type { AdaptiveMemory } from '@/arena/ai/adaptiveMemory';
import type { Rng } from '@/core/rng';

export interface MeleeOption { kind: StockAttackKind; value: number }

/** Weighted choices are made at attack commitments, never rerolled in the movement loop. */
export function chooseMelee(options: readonly MeleeOption[], context: string, memory: AdaptiveMemory, strength: number, rng: Rng): StockAttackKind | null {
  const choices = options.filter(option => memory.ready(context, option.kind)).map(option => ({
    kind: option.kind, weight: Math.exp(3 * (option.value + memory.bias(context, option.kind, strength))),
  }));
  let pick = rng.next() * choices.reduce((sum, choice) => sum + choice.weight, 0);
  for (const choice of choices) { pick -= choice.weight; if (pick < 0) return choice.kind; }
  return choices[choices.length - 1]?.kind ?? null;
}
