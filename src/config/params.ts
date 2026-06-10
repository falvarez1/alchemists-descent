import { Cell } from '@/sim/CellType';
import type { GameParams, GlobalParams, MaterialParams, SpellId, SpellParams } from '@/core/types';

/**
 * Live-tunable game balance. These objects are intentionally MUTABLE:
 * the inspector UI writes straight into them and the simulation reads them
 * every tick. Treat them as the game's dials, not constants.
 */

export const GLOBAL_PARAMS: GlobalParams = {
  simSpeed: 1.0,
  maxBrightness: 3.5,
  ambient: 0.14,
};

export const MATERIAL_PARAMS: Record<number, MaterialParams> = {
  [Cell.Sand]: { name: 'Sand', friction: 0.5, densityWeight: 0.9 },
  [Cell.Gunpowder]: { name: 'Gunpowder', friction: 0.4, blastRadius: 38 },
  [Cell.Wood]: { name: 'Wood', flammability: 0.2, carbonSmokeGen: 0.4 },
  [Cell.Vines]: { name: 'Vines', flammability: 0.45, climbRate: 0.15, hangRate: 0.25 },
  [Cell.Water]: { name: 'Water', flowRate: 0.85, poolingFactor: 0.95 },
  [Cell.Oil]: { name: 'Oil', flowRate: 0.7, burnDuration: 75 },
  [Cell.Nitrogen]: { name: 'Liquid Nitrogen', flowRate: 0.8, evaporationSpeed: 0.05 },
  [Cell.Lava]: { name: 'Lava', flowRate: 0.3, meltRange: 0.7, bloomWeight: 0.6 },
  [Cell.Acid]: { name: 'Acid', flowRate: 0.65, corrosiveSpeed: 0.8, bloomWeight: 0.3 },
  [Cell.Fire]: { name: 'Fire', particleLife: 30, upwardSpread: 0.55, bloomWeight: 0.9 },
  [Cell.Smoke]: { name: 'Smoke', floatSpeed: 0.5, dispersion: 0.05, bloomWeight: 0.1 },
  [Cell.Steam]: { name: 'Steam', bloomWeight: 0.15 },
  [Cell.Ice]: { name: 'Ice', insulationRating: 0.85 },
  [Cell.Metal]: { name: 'Metal', conductivity: 0.95 },
  [Cell.Gold]: { name: 'Gold Powder', friction: 0.55, densityWeight: 0.98, bloomWeight: 0.15 },
  [Cell.Blood]: { name: 'Blood', flowRate: 0.55, coagulation: 0.002 },
  [Cell.Slime]: { name: 'Slime', flowRate: 0.15, viscosity: 0.85, bloomWeight: 0.2 },
  [Cell.Ember]: { name: 'Ember', fallChance: 0.4, igniteChance: 0.015, bloomWeight: 0.7 },
  [Cell.Wall]: { name: 'Structural Wall' },
  [Cell.Empty]: { name: 'Eraser' },
};

export const SPELL_PARAMS: Record<SpellId, SpellParams> = {
  bolt: { name: 'Spark Bolt', velocityForce: 13, explosionRadius: 14, manaCost: 12, cooldown: 12 },
  bomb: { name: 'Cast Bomb', velocityForce: 7.5, fuseTicks: 120, explosionRadius: 52, manaCost: 28, cooldown: 40 },
  lightning: { name: 'Chain Lightning', range: 340, branches: 2, damage: 28, manaCost: 30, cooldown: 30 },
  flame: { name: 'Flamethrower', heat: 22, spread: 0.35, manaCost: 1.4, cooldown: 0 },
  dig: { name: 'Excavate Ray', range: 160, manaCost: 1.2, cooldown: 0 },
  warp: { name: 'Warp Bolt', velocityForce: 12, manaCost: 32, cooldown: 55 },
  blackhole: { name: 'Black Hole', baseRadius: 24, chargeRate: 0.9, collapseLimit: 140, manaCost: 55, cooldown: 90 },
};

export const SPELL_ORDER: SpellId[] = ['bolt', 'bomb', 'lightning', 'flame', 'dig', 'warp', 'blackhole'];

export function createGameParams(): GameParams {
  return {
    global: GLOBAL_PARAMS,
    materials: MATERIAL_PARAMS,
    spells: SPELL_PARAMS,
  };
}
