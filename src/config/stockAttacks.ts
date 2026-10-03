import type { FighterId } from '@/content/fighters';
import type { StockAttackKind, StockAttackSpec } from '@/core/stockAttacks';

export type StockMoveset = Readonly<Record<StockAttackKind, StockAttackSpec>>;
/** Fixed-tick prototypes. Raw damage is reduced by arena tempo and fighter armor. */
export const STOCK_ATTACKS: Readonly<Partial<Record<FighterId, StockMoveset>>> = {
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
/** The other seven fighters retain a common prototype until their authored attack pass. */
export function stockMoveset(fighter: FighterId | null): StockMoveset {
  return (fighter ? STOCK_ATTACKS[fighter] : undefined) ?? STOCK_ATTACKS['ilyra-voss']!;
}
