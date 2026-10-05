import { FIGHTER_ORDER } from '@/content/fighters';
import type { FighterId } from '@/content/fighters';
import type { CoreStockAttackKind, StockAttackKind, StockAttackSpec } from '@/core/stockAttacks';

export type StockMoveset = Readonly<Record<StockAttackKind, StockAttackSpec>>;
/** Fixed-tick prototypes. Raw damage is reduced by arena tempo and fighter armor. */
const AUTHORED: Readonly<Partial<Record<FighterId, Readonly<Record<CoreStockAttackKind, StockAttackSpec>>>>> = {
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
/** Brann's additional attacks. The forward aerial remains Air bulwark. */
const BRANN_EXTRAS: Readonly<Record<Exclude<StockAttackKind, CoreStockAttackKind>, StockAttackSpec>> = {
  neutral_air: { name: 'Boiler spin', startup: 6, active: 9, recovery: 18, damage: 21, minReach: -18, reach: 18, top: -22, bottom: 4, knockX: 2, knockY: -1.4, growth: .8, stun: .8 },
  back_air: { name: 'Backplate strike', startup: 10, active: 6, recovery: 23, damage: 34, minReach: -29, reach: -4, top: -23, bottom: 1, knockX: -4.2, knockY: -1, growth: 1.3, stun: 1 },
  up_air: { name: 'Chimney sweep', startup: 7, active: 7, recovery: 20, damage: 27, minReach: -14, reach: 14, top: -42, bottom: -15, knockX: .5, knockY: -4.2, growth: 1.1, stun: 1 },
  down_air: { name: 'Iron plummet', startup: 13, active: 6, recovery: 26, damage: 32, minReach: -12, reach: 12, top: -2, bottom: 24, knockX: .35, knockY: 5.5, growth: 1.25, stun: 1 },
  up_smash: { name: 'Boiler uppercut', startup: 22, active: 6, recovery: 30, damage: 48, minReach: -14, reach: 18, top: -48, bottom: -4, knockX: .5, knockY: -6, growth: 1.65, stun: 1.1 },
  down_smash: { name: 'Foundry sweep', startup: 20, active: 7, recovery: 28, damage: 42, minReach: -29, reach: 29, top: -13, bottom: 4, knockX: 5.4, knockY: -.8, growth: 1.4, stun: 1 },
};

const ILYRA_EXTRAS: typeof BRANN_EXTRAS = {
  neutral_air: { name: 'Cinder wheel', startup: 4, active: 8, recovery: 14, damage: 18, minReach: -18, reach: 18, top: -23, bottom: 3, knockX: 1.8, knockY: -1.2, growth: .7, stun: .75 },
  back_air: { name: 'Recoil heel', startup: 7, active: 5, recovery: 18, damage: 28, minReach: -27, reach: -4, top: -22, bottom: 1, knockX: -4, knockY: -1, growth: 1.2, stun: .9 },
  up_air: { name: 'Ember arc', startup: 5, active: 6, recovery: 15, damage: 22, minReach: -13, reach: 13, top: -40, bottom: -14, knockX: .4, knockY: -3.8, growth: .95, stun: .9 },
  down_air: { name: 'Cinder heel', startup: 10, active: 5, recovery: 22, damage: 27, minReach: -11, reach: 11, top: -2, bottom: 23, knockX: .3, knockY: 5, growth: 1.1, stun: 1 },
  up_smash: { name: 'Phoenix uppercut', startup: 16, active: 5, recovery: 24, damage: 39, minReach: -13, reach: 16, top: -46, bottom: -4, knockX: .5, knockY: -5.5, growth: 1.5, stun: 1.05 },
  down_smash: { name: 'Ash sweep', startup: 15, active: 6, recovery: 23, damage: 35, minReach: -27, reach: 27, top: -13, bottom: 3, knockX: 4.8, knockY: -.9, growth: 1.3, stun: 1 },
};
export function hasExpandedMoves(fighter: FighterId | null | undefined): boolean { return fighter === 'brann-rook' || fighter === 'ilyra-voss'; }
interface AttackKeys { left: boolean; right: boolean; up: boolean; down: boolean }
/** Input intent is resolved once, before movement can turn the body. Other kits keep their four-move controls. */
export function selectStockAttack(fighter: FighterId | null, grounded: boolean, keys: AttackKeys, bodyFacing: number,
  requested?: StockAttackKind, requestedFacing?: number): { kind: StockAttackKind; facing: number } {
  const facing = requestedFacing || (keys.left !== keys.right ? (keys.left ? -1 : 1) : bodyFacing);
  if (!hasExpandedMoves(fighter)) {
    const legacy = requested === 'up_smash' ? 'launcher' : requested === 'down_smash' ? 'finisher' : requested;
    return { kind: grounded ? legacy ?? (keys.up ? 'launcher' : keys.down ? 'finisher' : 'opener') : 'aerial', facing };
  }
  if (grounded) return { kind: requested?.endsWith('_air') || requested === 'aerial' ? 'opener' : requested ?? (keys.up ? 'launcher' : keys.down ? 'finisher' : 'opener'), facing };
  const direction = requestedFacing || Number(keys.right) - Number(keys.left);
  const explicitAir = requested === 'aerial' || requested?.endsWith('_air');
  const kind = explicitAir ? requested! : requested === 'up_smash' || keys.up ? 'up_air'
    : requested === 'down_smash' || keys.down ? 'down_air'
      : direction ? direction * bodyFacing < 0 ? 'back_air' : 'aerial' : 'neutral_air';
  return { kind, facing: bodyFacing < 0 ? -1 : 1 };
}
/**
 * Every fighter's LIVE moveset: intentionally mutable live-tuning data (like config/params), so a balance run can turn
 * one fighter's blow (`stock.<id>.<kind>.<field>` in the fight harness's parameter registry) and put it back. The three
 * authored sets, and for the other seven a COPY of the shared prototype (Ilyra's) until their authored attack pass: the
 * copies start identical, but tuning one fighter never moves another.
 */
export const STOCK_ATTACKS: Readonly<Record<FighterId, StockMoveset>> = Object.fromEntries(FIGHTER_ORDER.map(id => {
  const set = AUTHORED[id] ?? AUTHORED['ilyra-voss']!;
  // Unselected aliases keep the tuning/AI contract total for older kits; only Ilyra and Brann's input selects the extra moves.
  const extras = id === 'brann-rook' ? BRANN_EXTRAS : id === 'ilyra-voss' ? ILYRA_EXTRAS : {
    neutral_air: set.aerial, back_air: set.aerial, up_air: set.aerial, down_air: set.aerial,
    up_smash: set.launcher, down_smash: set.finisher,
  };
  return [id, Object.fromEntries(Object.entries({ ...set, ...extras }).map(([kind, spec]) => [kind, { minReach: 1, ...spec }]))];
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
  reach: { min: -60, max: 60, step: 1 },
  minReach: { min: -60, max: 60, step: 1 },
  top: { min: -70, max: 0, step: 1 },
  bottom: { min: -20, max: 40, step: 1 },
  knockX: { min: -10, max: 10, step: 0.05 },
  knockY: { min: -10, max: 10, step: 0.05 },
  growth: { min: 0, max: 3, step: 0.05 },
  stun: { min: 0, max: 3, step: 0.05 },
};
