import { FIGHTER_ORDER } from '@/content/fighters';
import type { FighterId } from '@/content/fighters';
import type { StockAttackKind, StockAttackSpec } from '@/core/stockAttacks';

export type StockMoveset = Readonly<Record<StockAttackKind, StockAttackSpec>>;
/** Fixed-tick prototypes. Raw damage is reduced by arena tempo and fighter armor. */
const AUTHORED: Readonly<Partial<Record<FighterId, StockMoveset>>> = {
  'ilyra-voss': {
    opener: { name: 'Brass jab', startup: 4, active: 3, recovery: 10, damage: 18, reach: 22, top: -18, bottom: -5, knockX: 1.4, knockY: -.4, growth: .35, stun: .65 },
    launcher: { name: 'Rising spark', startup: 7, active: 5, recovery: 14, damage: 23, reach: 20, top: -33, bottom: -7, knockX: .65, knockY: -2.8, growth: .7, stun: 1.2 },
    aerial: { name: 'Air sweep', startup: 5, active: 5, recovery: 15, damage: 24, reach: 25, top: -23, bottom: 0, knockX: 2.4, knockY: -.7, growth: .85, stun: .85 },
    finisher: { name: 'Furnace thrust', startup: 18, active: 4, recovery: 28, damage: 42, reach: 30, top: -20, bottom: -3, knockX: 5.2, knockY: -1.2, growth: 1.45, stun: 1 },
  },
  'brann-rook': {
    opener: { name: 'Shield butt', startup: 6, active: 4, recovery: 14, damage: 25, reach: 21, top: -21, bottom: -2, knockX: 2, knockY: -.5, growth: .45, stun: .8 },
    launcher: { name: 'Iron rise', startup: 10, active: 5, recovery: 18, damage: 29, reach: 20, top: -35, bottom: -3, knockX: .7, knockY: -3.5, growth: .8, stun: 1.2 },
    aerial: { name: 'Air bulwark', startup: 8, active: 7, recovery: 19, damage: 30, reach: 25, top: -25, bottom: 2, knockX: 3.2, knockY: -.5, growth: 1, stun: 1 },
    finisher: { name: 'Foundry slam', startup: 23, active: 5, recovery: 33, damage: 55, reach: 31, top: -22, bottom: 3, knockX: 6, knockY: -1.3, growth: 1.6, stun: 1.1 },
  },
  'mara-quell': {
    opener: { name: 'Bell tap', startup: 5, active: 4, recovery: 12, damage: 17, reach: 25, top: -19, bottom: -3, knockX: 1.5, knockY: -.5, growth: .4, stun: .75 },
    launcher: { name: 'Ascending toll', startup: 9, active: 6, recovery: 16, damage: 22, reach: 24, top: -36, bottom: -5, knockX: .4, knockY: -3, growth: .65, stun: 1.25 },
    aerial: { name: 'Hanging chime', startup: 6, active: 8, recovery: 17, damage: 23, reach: 29, top: -27, bottom: 1, knockX: 2.1, knockY: -1, growth: .85, stun: 1 },
    finisher: { name: 'Last toll', startup: 21, active: 6, recovery: 30, damage: 40, reach: 34, top: -29, bottom: -2, knockX: 4.3, knockY: -2.6, growth: 1.4, stun: 1.1 },
  },
};
/**
 * Every fighter's LIVE moveset: intentionally mutable live-tuning data (like config/params), so a balance run can turn
 * one fighter's blow (`stock.<id>.<kind>.<field>` in the fight harness's parameter registry) and put it back. The three
 * authored sets, and for the other seven a COPY of the shared prototype (Ilyra's) until their authored attack pass: the
 * copies start identical, but tuning one fighter never moves another.
 */
export const STOCK_ATTACKS: Readonly<Record<FighterId, StockMoveset>> = Object.fromEntries(FIGHTER_ORDER.map(id => {
  const set = AUTHORED[id] ?? AUTHORED['ilyra-voss']!;
  return [id, Object.fromEntries(Object.entries(set).map(([kind, spec]) => [kind, { ...spec }]))];
})) as Record<FighterId, StockMoveset>;

/** True for the fighters with an authored set (the rest share the prototype's numbers). */
export function hasAuthoredMoveset(fighter: FighterId): boolean { return AUTHORED[fighter] !== undefined; }

export function stockMoveset(fighter: FighterId | null): StockMoveset {
  return (fighter ? STOCK_ATTACKS[fighter] : undefined) ?? STOCK_ATTACKS['ilyra-voss'];
}

/** Guardrails for the tuner (not balance targets): frame data in whole ticks, distances in cells. */
export const STOCK_ATTACK_RANGES: Readonly<Record<Exclude<keyof StockAttackSpec, 'name'>, { min: number; max: number; step: number; integer?: boolean }>> = {
  startup: { min: 1, max: 40, step: 1, integer: true },
  active: { min: 1, max: 20, step: 1, integer: true },
  recovery: { min: 1, max: 60, step: 1, integer: true },
  damage: { min: 0, max: 90, step: 0.5 },
  reach: { min: 4, max: 60, step: 1 },
  top: { min: -70, max: 0, step: 1 },
  bottom: { min: -20, max: 20, step: 1 },
  knockX: { min: -10, max: 10, step: 0.05 },
  knockY: { min: -10, max: 10, step: 0.05 },
  growth: { min: 0, max: 3, step: 0.05 },
  stun: { min: 0, max: 3, step: 0.05 },
};
