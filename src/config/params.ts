import { Cell } from '@/sim/CellType';
import { loadBackdropSettings } from '@/config/backdrop';
import type {
  GameParams,
  GlobalParams,
  MaterialParams,
  PlayerTuning,
  PostFxSettings,
  RenderSettings,
  SpellId,
  SpellParams,
  WandLightSettings,
} from '@/core/types';

/**
 * Live-tunable game balance. These objects are intentionally MUTABLE:
 * the inspector UI writes straight into them and the simulation reads them
 * every tick. Treat them as the game's dials, not constants.
 */

export const GLOBAL_PARAMS: GlobalParams = {
  simSpeed: 1.0,
  maxBrightness: 2.5,
  // Raised from the original 0.14: with the squared light curve, this floor
  // keeps the caves moody while letting shadowed rock read as silhouette.
  ambient: 0.36,
  bloodAmount: 7.0,
  // Blood-specific gore dialed well above the other channels for a gorier,
  // more Noita-like spray that feeds the corpse pools; other gore channels unchanged.
  goreBlood: 4.0,
  goreSlime: 1.0,
  goreOoze: 0.15,
  // Electrical spark/lightning conduction. Falloff 1 + decay 1 attenuate per
  // hop / per frame; strength scales the injected charge so a current conducts
  // ~ strength·deposit / falloff cells before fading. Strength 2.5 carries a
  // strike ~2-3x as far as the original 1.0 deposits (metal stays the standout).
  chargeFalloff: 1,
  chargeStrength: 2.5,
  chargeDecay: 1,
  // Damage per status tick spent in a charged conductor (wet bodies take ~3×).
  shockDamage: 0.2,
};

/** Frozen baseline captured at load — the Builder section "reset" restores it. */
export const GLOBAL_PARAM_DEFAULTS: Readonly<GlobalParams> = Object.freeze({ ...GLOBAL_PARAMS });

export const MATERIAL_PARAMS: Record<number, MaterialParams> = {
  [Cell.Sand]: { name: 'Sand', friction: 0.5, densityWeight: 0.9 },
  [Cell.Gunpowder]: { name: 'Gunpowder', friction: 0.4, blastRadius: 38 },
  [Cell.Wood]: { name: 'Wood', flammability: 0.2, carbonSmokeGen: 0.4 },
  [Cell.Vines]: { name: 'Vines', flammability: 0.45 },
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
  [Cell.Slime]: { name: 'Slime', flowRate: 0.15, bloomWeight: 0.2 },
  [Cell.Ember]: { name: 'Ember', fallChance: 0.4, igniteChance: 0.015, bloomWeight: 0.7 },
  // Brewed elixirs: inert viscous liquids whose glow (bloomWeight) is the in-world discovery tell.
  [Cell.ElixirLife]: { name: 'Elixir of Life', flowRate: 0.6, bloomWeight: 0.35 },
  [Cell.ElixirLevity]: { name: 'Elixir of Levity', flowRate: 0.6, bloomWeight: 0.45 },
  [Cell.ElixirStone]: { name: 'Elixir of Stone', flowRate: 0.45, bloomWeight: 0.2 },
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
  // The Gilded Vault's philosopher's dust: a heavy glittering powder whose
  // bloom IS the discovery tell (light is information).
  [Cell.Catalyst]: { name: 'Aurum Catalyst', friction: 0.55, densityWeight: 0.96, bloomWeight: 0.5 },
  // Hidden ore: a static rock (no bloom — the WHOLE point is it stays dark until lit).
  [Cell.RawOre]: { name: 'Raw Ore', bloomWeight: 0 },
  [Cell.Wall]: { name: 'Structural Wall' },
  [Cell.Empty]: { name: 'Eraser' },
};

/** Deep snapshot of the shipped material tunings, captured at load before any
 *  live edits mutate MATERIAL_PARAMS — the Builder MATERIAL "reset" restores it. */
export const MATERIAL_PARAM_DEFAULTS: Readonly<Record<number, MaterialParams>> = structuredClone(MATERIAL_PARAMS);

export const SPELL_PARAMS: Record<SpellId, SpellParams> = {
  // velocityForce is the UNMODIFIED base: a starter Spark Bolt lobs slowly (you
  // can read its travel wake). The 'speed' modifier (×1.6 in the wand compiler)
  // scales it back up — one speed card ≈ 12.8, restoring the old snappy feel.
  bolt: { name: 'Spark Bolt', velocityForce: 8, explosionRadius: 14, manaCost: 12, cooldown: 12 },
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

/** Deep snapshot of the shipped spell tunings, captured at load before any live
 *  edits mutate SPELL_PARAMS — the reset target and the persistence diff base. */
export const SPELL_PARAM_DEFAULTS: Readonly<Record<SpellId, SpellParams>> = structuredClone(SPELL_PARAMS);

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

/**
 * Player feel dials (levitation jet + wand recoil). See docs/FEEL.md.
 * Levitation: a gentle t³ spool plus per-frame drag so climb speed ASYMPTOTES
 * to ~3.3 cells/frame (90% by ~f51) instead of snapping to the -4.6 cap.
 * Recoil: flat base + summed muzzle momentum, opposite aim, capped, ground-damped.
 */
export const PLAYER_PARAMS: PlayerTuning = {
  levitThrust0: 0.33,
  // Full thrust 0.33+0.24 = 0.57; with grav 0.28 and drag 0.92 that solves to a
  // terminal climb of ~3.3 cells/frame (well under the old -4.6 cap).
  levitThrustGain: 0.24,
  levitRampFrames: 48,
  levitDrag: 0.92,
  vyCapUp: -4.6,
  // Flight legs are their own thing — base feel (1.0), immune to Swift buffs so
  // god-mode/Swift no longer makes levitation skate sideways while crawling up.
  levitHorizControl: 1.0,
  // Airborne horizontal inertia: 0.985/frame retention means a fast run carries
  // into a jump/levitate and a glide coasts, instead of snapping to a stop.
  airDrag: 0.985,
  // Precision-platformer movement feel (was module consts in Player.ts; live here
  // so the inspector can tune jump/run/air feel without a recompile).
  moveSoftStart: 0.55,
  groundStopDecay: 0.6,
  groundStopSnap: 0.12,
  airGlideSpeed: 1.9,
  airStopDecay: 0.74,
  jumpCut: 0.25,
  jumpHoldWindow: 7,
  maxRunCap: 3.6,
  recoilBase: 6,
  recoilPerMomentum: 0.06,
  recoilMaxImpulse: 4.0,
  recoilGroundDamp: 0.55,
  // Kick (F): a chunky shove. kickImpulse is a momentum (Δv = impulse/mass) so a
  // ~29-mass wood crate gets Δv≈2.6 and a ~127-mass metal one only ≈0.6.
  kickImpulse: 75,
  kickRange: 22,
  kickArc: 0.9, // ~±52° cone around the aim
  kickCooldown: 22,
  kickSelfRecoil: 3.0, // full kick-jump off a wall/heavy body; scaled by what you hit
  kickDamage: 8,
};

/** Frozen baseline captured at load — the Builder "reset" action restores it. */
export const PLAYER_TUNING_DEFAULTS: Readonly<PlayerTuning> = Object.freeze({ ...PLAYER_PARAMS });

export function createGameParams(): GameParams {
  return {
    global: GLOBAL_PARAMS,
    backdrop: loadBackdropSettings(),
    materials: MATERIAL_PARAMS,
    spells: SPELL_PARAMS,
    player: PLAYER_PARAMS,
  };
}

export function createDefaultPostFxSettings(): PostFxSettings {
  return {
    enabled: true,
    // GPU-compose is the default renderer path; keep the runtime toggle for
    // same-session A/B and fallback checks (docs/GPU-COMPOSE-PLAN.md).
    gpuCompose: true,
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
    tonemap: true,
    vignette: 0.52,
  };
}

export function createDefaultRenderSettings(): RenderSettings {
  return {
    backend: 'webgl',
    compose: false,
    lighting: false,
    particles: false,
    post: false,
  };
}

export function createDefaultWandLightSettings(): WandLightSettings {
  return {
    intensity: 4.6,
    radius: 112,
    r: 1.0,
    g: 0.84,
    b: 0.6,
    flicker: 0.24,
    fillR: 0.5,
    fillG: 0.45,
    fillB: 0.36,
    torchIntensity: 5.6,
    torchRadius: 152,
    torchMinFlicker: 1.05,
  };
}
