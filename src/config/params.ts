import { Cell } from '@/sim/CellType';
import type {
  GameParams,
  GlobalParams,
  MaterialParams,
  PostFxSettings,
  SpellId,
  SpellParams,
} from '@/core/types';

/**
 * Live-tunable game balance. These objects are intentionally MUTABLE:
 * the inspector UI writes straight into them and the simulation reads them
 * every tick. Treat them as the game's dials, not constants.
 */

export const GLOBAL_PARAMS: GlobalParams = {
  simSpeed: 1.0,
  maxBrightness: 3.5,
  // Raised from the original 0.14: with the squared light curve, 0.18 keeps
  // the caves moody while letting shadowed rock read as silhouette.
  ambient: 0.18,
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
  // Brewed elixirs: inert viscous liquids whose glow (bloomWeight) is the in-world discovery tell.
  [Cell.ElixirLife]: { name: 'Elixir of Life', flowRate: 0.6, viscosity: 0.5, bloomWeight: 0.35 },
  [Cell.ElixirLevity]: { name: 'Elixir of Levity', flowRate: 0.6, viscosity: 0.5, bloomWeight: 0.45 },
  [Cell.ElixirStone]: { name: 'Elixir of Stone', flowRate: 0.45, viscosity: 0.5, bloomWeight: 0.2 },
  // Upgrade port: 10 new materials + Stone made inspectable (remapped ids).
  // Crystal's dead 'resonance' param was dropped (vestige of a cut feature).
  [Cell.Stone]: { name: 'Stone' },
  [Cell.Toxic]: { name: 'Toxic Sludge', flowRate: 0.5, flammability: 0.3, bloomWeight: 0.2 },
  [Cell.Healium]: { name: 'Healium', flowRate: 0.55, evaporationSpeed: 0.004, bloomWeight: 0.35 },
  [Cell.Teleportium]: { name: 'Teleportium', flowRate: 0.6, bloomWeight: 0.4 },
  [Cell.Snow]: { name: 'Snow', friction: 0.3 },
  [Cell.Coal]: { name: 'Coal', friction: 0.45, burnDuration: 170, igniteChance: 0.08 },
  [Cell.Crystal]: { name: 'Mana Crystal', bloomWeight: 0.45 },
  [Cell.Glowshroom]: { name: 'Glowshroom', flammability: 0.3, bloomWeight: 0.4 },
  [Cell.Fungus]: { name: 'Glowcap Fungus', flammability: 0.5, bloomWeight: 0.3 },
  [Cell.Glass]: { name: 'Glass' },
  [Cell.Ash]: { name: 'Ash', friction: 0.2 },
  [Cell.Moss]: { name: 'Cave Moss', flammability: 0.25, bloomWeight: 0.08 },
  [Cell.Wall]: { name: 'Structural Wall' },
  [Cell.Empty]: { name: 'Eraser' },
};

export const SPELL_PARAMS: Record<SpellId, SpellParams> = {
  bolt: { name: 'Spark Bolt', velocityForce: 13, explosionRadius: 14, manaCost: 12, cooldown: 12 },
  scatter: { name: 'Scatter Hex', pellets: 5, velocityForce: 9.5, spread: 0.42, explosionRadius: 6, manaCost: 15, cooldown: 20 },
  bomb: { name: 'Cast Bomb', velocityForce: 7.5, fuseTicks: 120, explosionRadius: 52, manaCost: 28, cooldown: 40 },
  lightning: { name: 'Chain Lightning', range: 340, branches: 2, damage: 28, manaCost: 30, cooldown: 30 },
  flame: { name: 'Flamethrower', heat: 22, spread: 0.35, manaCost: 1.4, cooldown: 0 },
  emberstorm: { name: 'Ember Storm', count: 16, manaCost: 18, cooldown: 30 },
  vitriol: { name: 'Vitriol Spray', spread: 0.30, manaCost: 1.7, cooldown: 0 },
  frostshard: { name: 'Frost Shard', velocityForce: 11, freezeRadius: 7, damage: 16, manaCost: 16, cooldown: 16 },
  icelance: { name: 'Ice Lance', velocityForce: 16, damage: 30, manaCost: 22, cooldown: 35 },
  wisp: { name: 'Seeker Wisp', velocityForce: 4.5, damage: 13, manaCost: 8, cooldown: 8 },
  dig: { name: 'Excavate Ray', range: 160, manaCost: 1.2, cooldown: 0 },
  conjure: { name: 'Conjure Stone', radius: 6, range: 130, manaCost: 18, cooldown: 24 },
  warp: { name: 'Warp Bolt', velocityForce: 12, manaCost: 32, cooldown: 55 },
  meteor: { name: 'Meteor', velocityForce: 6.5, explosionRadius: 40, manaCost: 70, cooldown: 140 },
  blackhole: { name: 'Black Hole', baseRadius: 24, chargeRate: 0.9, collapseLimit: 140, manaCost: 55, cooldown: 90 },
};

export const SPELL_ORDER: SpellId[] = [
  'bolt',
  'scatter',
  'bomb',
  'lightning',
  'flame',
  'emberstorm',
  'vitriol',
  'frostshard',
  'icelance',
  'wisp',
  'dig',
  'conjure',
  'warp',
  'meteor',
  'blackhole',
];

export function createGameParams(): GameParams {
  return {
    global: GLOBAL_PARAMS,
    materials: MATERIAL_PARAMS,
    spells: SPELL_PARAMS,
  };
}

export function createDefaultPostFxSettings(): PostFxSettings {
  return {
    enabled: true,
    bloomEnabled: true,
    bloomStrength: 0.35,
    bloomRadius: 0.2,
    bloomThreshold: 0.85,
    bloomKickScale: 1.0,
    lensEnabled: true,
    aberration: 0.0005,
    aberrationKick: 0.006,
    shakeAberration: 0.05,
    grain: 0.028,
    hurtPulse: 1.0,
    exposure: 1.05,
  };
}
