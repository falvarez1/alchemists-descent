// ===================== Sim-sampled entity status (Wave C) =====================
// DESIGN.md pillar 5: WET / OILED / BURNING / FROZEN / ELECTRIFIED are read
// straight from the cells touching a body, and write cells back where it
// matters (burning sheds real Fire into the grid). One status struct is shared
// by the player, every enemy, and the potion timers — a potion is just a timed
// rewrite of entity-vs-cell rules.

import type { Ctx, EntityStatus } from '@/core/types';
import { Cell, isLiquid } from '@/sim/CellType';
import { fireColor, packRGB, steamColor } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';

/** Statuses/contact effects the grid can inflict (potion timers can't be "immune"-blocked). */
type ElementalStatus = 'burning' | 'frozen' | 'electrified' | 'wet' | 'oiled' | 'toxic' | 'healium' | 'teleportium';

const SHOCK_WET_MULT = 3; // a wet body conducts — far more shock damage (the combo)
const SHOCK_ZAP = 3; // one-time hit the instant a dry/wet body becomes electrified
const TOXIC_DAMAGE_PER_CELL = 0.2;
const HEALIUM_HEAL_PER_CELL = 0.14;

// CATCH FIRE — ignition is percentage-based and scales with HEAT (how many flame
// cells lick the body, weighted by how hot they are) and EXPOSURE TIME (each
// status sample re-rolls, so a sustained lick eventually catches). Sampled every
// 2nd frame (~30×/s), so with these odds an open Fire cell lights a bare body in
// ~1s, a Lava cell in a blink, and being engulfed (or oiled) crosses the
// deterministic "hot enough" line and ignites at once. Fire-immune bodies (imps,
// the flameward player) never roll.
const FIRE_IGNITE_CHANCE = 0.03; // per Fire cell, per sample
const LAVA_IGNITE_CHANCE = 0.16; // per Lava cell, per sample — a furnace next to open flame
const OIL_IGNITE_MULT = 5; // an oiled body goes up fast
const IGNITE_HOT_ENOUGH = 1; // accumulated heat ≥ this ignites with certainty
/** Ticks a fresh catch burns (an oiled body burns longer); refreshed while in the flames. */
export const IGNITE_TICKS = 90;
export const IGNITE_OILED_TICKS = 300;
/** Brine cells touching a body before it chills (a toe in a gutter does not). */
const BRINE_CHILL_CELLS = 3;
/** The frozen slow a brine soak keeps topped up (short: it thaws a beat after you climb out). */
const BRINE_CHILL_TICKS = 36;
/** Frostbite: hp per tick while soaking in brine (~1.8 hp/s at scale 1). */
const FROSTBITE_PER_TICK = 0.03;

/** Burning damage per status sample before any per-body scale. */
const BURN_DAMAGE = 0.12;

interface StatusBody {
  x: number;
  y: number;
  status: EntityStatus;
}

export interface BodyCellSample {
  water: number;
  oil: number;
  fire: number;
  lava: number;
  acid: number;
  nitrogen: number;
  /** Brine cells touching the body (the Cold Store's coolant: it chills, it bites). */
  brine: number;
  charged: number;
  /** Charged WATER / METAL / LAVA cells touching the body or underfoot: a current
   *  that reached it through a conductor (blood is left out — a creature's own
   *  spatter from the wand's hit must not turn the wand's current into the world's). */
  conductorCharged: number;
  /** Charged cells of any OTHER liquid (blood, slime, oil, acid...) touching or underfoot. */
  liquidCharged: number;
  /** Strongest charge on any sampled cell (0 when none): how hot the current is HERE. */
  maxCharge: number;
  toxic: number;
  healium: number;
  teleportium: number;
  liquid: number;
  waterOrBlood: number;
  fungus: number;
  sampledSplashColor: number | null;
  healiumCells: number[];
}

export interface StatusSampleOptions {
  toxicScale?: number;
  healiumScale?: number;
  /** Multiplies the burning status's damage (creatures burn harder than the alchemist). */
  burnScale?: number;
  /** Ticks a fresh catch burns (default IGNITE_TICKS / IGNITE_OILED_TICKS). */
  igniteTicks?: number;
  igniteOiledTicks?: number;
  /**
   * FROSTBITE (the Cold Store): hp per tick while wading in brine, times this
   * scale. 0 by default — only the alchemist opts in;
   * creatures still take the chill (the frozen slow) but not the bite.
   */
  frostbiteScale?: number;
}

export interface StatusSampleResult {
  damage: number;
  toxicDamage: number;
  /** The burning share of `damage` (kill attribution reads the parts). */
  burnDamage: number;
  /** The electrical share of `damage`, one-time zap included. */
  shockDamage: number;
  /** The frostbite share of `damage` (brine soaking the body). */
  frostbiteDamage: number;
  /** Strongest charge touching the body this sample (0 = none). */
  maxCharge: number;
  /** Kill attribution's grid facts (see StatusBlow in core/types). */
  fueled: boolean;
  heatContact: boolean;
  conducted: boolean;
  liquidCharge: boolean;
  chargeContact: boolean;
  healing: number;
  teleportTouch: boolean;
  slowFactor: number;
}

/** Every timer at zero: dry, clean, unlit, unenchanted. */
export function createDefaultStatus(): EntityStatus {
  return {
    wet: 0,
    oiled: 0,
    burning: 0,
    frozen: 0,
    electrified: 0,
    regen: 0,
    levity: 0,
    stoneskin: 0,
    swift: 0,
    torch: 0,
  };
}

/**
 * Percentage-based catch-fire roll. `fireCells` / `lavaCells` are how much open
 * flame vs molten lava is touching the body for this hit; hotter (lava) + more
 * cells + oil all raise the odds, and crossing the "hot enough" heat line
 * (engulfed / oiled / a lava bath) ignites for certain. Sustained exposure just
 * re-rolls until it catches. Returns true if the body is alight afterward; a
 * no-op for fire-immune bodies. Shared by passive exposure (sampleAndTickStatus)
 * and direct splash hits so the two stay consistent.
 */
export function rollCatchFire(
  status: EntityStatus,
  fireCells: number,
  lavaCells: number,
  immune = false,
  igniteTicks = IGNITE_TICKS,
  igniteOiledTicks = IGNITE_OILED_TICKS,
): boolean {
  if (immune) return false;
  const heat = (fireCells * FIRE_IGNITE_CHANCE + lavaCells * LAVA_IGNITE_CHANCE) * (status.oiled > 0 ? OIL_IGNITE_MULT : 1);
  if (heat <= 0) return status.burning > 0;
  if (status.burning > 0 || heat >= IGNITE_HOT_ENOUGH || entityRandom() < heat) {
    // staying in the flames refreshes the burn; a fresh catch lights it.
    status.burning = status.oiled > 0 ? igniteOiledTicks : igniteTicks;
    return true;
  }
  return false;
}

/** Death/respawn clears grid-inflicted transient harm but preserves potion boons. */
export function clearElementalStatus(status: EntityStatus): void {
  status.wet = 0;
  status.oiled = 0;
  status.burning = 0;
  status.frozen = 0;
  status.electrified = 0;
}

export function sampleBodyCells(
  ctx: Ctx,
  body: { x: number; y: number },
  halfW: number,
  h: number,
): BodyCellSample {
  const world = ctx.world;
  const bx = Math.floor(body.x);
  const by = Math.floor(body.y);
  const sample: BodyCellSample = {
    water: 0,
    oil: 0,
    fire: 0,
    lava: 0,
    acid: 0,
    nitrogen: 0,
    brine: 0,
    charged: 0,
    conductorCharged: 0,
    liquidCharged: 0,
    maxCharge: 0,
    toxic: 0,
    healium: 0,
    teleportium: 0,
    liquid: 0,
    waterOrBlood: 0,
    fungus: 0,
    sampledSplashColor: null,
    healiumCells: [],
  };

  for (let dy = 0; dy < h; dy += 2) {
    for (let dx = -halfW; dx <= halfW; dx += 2) {
      const X = bx + dx,
        Y = by - dy;
      if (!world.inBounds(X, Y)) continue;
      const i = world.idx(X, Y);
      const t = world.types[i];
      if (t === Cell.Water) sample.water++;
      else if (t === Cell.Oil) sample.oil++;
      else if (t === Cell.Fire) sample.fire++;
      else if (t === Cell.Lava) sample.lava++;
      else if (t === Cell.Acid) sample.acid++;
      else if (t === Cell.Nitrogen) sample.nitrogen++;
      else if (t === Cell.Brine) sample.brine++;
      else if (t === Cell.Toxic) sample.toxic++;
      else if (t === Cell.Healium) {
        sample.healium++;
        sample.healiumCells.push(i);
      } else if (t === Cell.Teleportium) sample.teleportium++;
      if (
        t === Cell.Water ||
        t === Cell.Oil ||
        t === Cell.Acid ||
        t === Cell.Lava ||
        t === Cell.Nitrogen ||
        t === Cell.Blood ||
        t === Cell.Slime ||
        t === Cell.ElixirLife ||
        t === Cell.ElixirLevity ||
        t === Cell.ElixirStone ||
        t === Cell.Toxic ||
        t === Cell.Healium ||
        t === Cell.Teleportium ||
        t === Cell.Brine
      ) {
        sample.liquid++;
        if (sample.sampledSplashColor === null || t === Cell.Water || t === Cell.Blood) {
          sample.sampledSplashColor = world.colors[i];
        }
        if (t === Cell.Water || t === Cell.Blood) sample.waterOrBlood++;
      }
      if (t === Cell.Fungus || t === Cell.Glowshroom) sample.fungus++;
      if (world.charge[i] > 0) {
        sample.charged++;
        if (t === Cell.Water || t === Cell.Metal || t === Cell.Lava || t === Cell.Brine) sample.conductorCharged++;
        else if (isLiquid(t)) sample.liquidCharged++;
        if (world.charge[i] > sample.maxCharge) sample.maxCharge = world.charge[i];
      }
    }
  }
  // Standing on a charged conductor (a zapped metal floor / electrified water)
  // counts as contact — sense the cells just underfoot, not only the body box.
  for (let dx = -halfW; dx <= halfW; dx += 2) {
    const X = bx + dx;
    const Y = by + 1;
    if (!world.inBounds(X, Y)) continue;
    const ui = world.idx(X, Y);
    const c = world.charge[ui];
    if (c > 0) {
      sample.charged++;
      const ut = world.types[ui];
      if (ut === Cell.Water || ut === Cell.Metal || ut === Cell.Lava || ut === Cell.Brine) sample.conductorCharged++;
      else if (isLiquid(ut)) sample.liquidCharged++;
      if (c > sample.maxCharge) sample.maxCharge = c;
    }
  }
  return sample;
}

/** Random cell on the body's AABB perimeter (where flames lick off the skin). */
function randomEdgeCell(body: StatusBody, halfW: number, h: number): { x: number; y: number } {
  const side = Math.floor(entityRandom() * 4);
  if (side === 0) return { x: body.x - halfW, y: body.y - Math.floor(entityRandom() * h) };
  if (side === 1) return { x: body.x + halfW, y: body.y - Math.floor(entityRandom() * h) };
  const ex = body.x - halfW + Math.floor(entityRandom() * (halfW * 2 + 1));
  return { x: ex, y: side === 2 ? body.y - h + 1 : body.y };
}

/** Random cell one step OUTSIDE the body's AABB (where shed fire lands). */
function randomAdjacentCell(body: StatusBody, halfW: number, h: number): { x: number; y: number } {
  const side = Math.floor(entityRandom() * 4);
  if (side === 0) return { x: body.x - halfW - 1, y: body.y - Math.floor(entityRandom() * h) };
  if (side === 1) return { x: body.x + halfW + 1, y: body.y - Math.floor(entityRandom() * h) };
  const ex = body.x - halfW + Math.floor(entityRandom() * (halfW * 2 + 1));
  return { x: ex, y: side === 2 ? body.y - h : body.y + 1 };
}

/**
 * Sample the cells touching a body, run the status transitions, tick timers in
 * real frames, and emit the per-status side effects. Callers that sample less
 * often pass the elapsed frame count so "600 frames" still means 600 frames.
 *
 * Returns the per-call status damage (applied by the caller, bypassing
 * invulnerability like hazard DPS) and the horizontal slow factor.
 */
export function sampleAndTickStatus(
  ctx: Ctx,
  body: { x: number; y: number; status: EntityStatus },
  halfW: number,
  h: number,
  immune?: Partial<Record<ElementalStatus, boolean>>,
  elapsedFrames = 1,
  options: StatusSampleOptions = {},
): StatusSampleResult {
  const world = ctx.world;
  const st = body.status;
  const electrifiedBefore = st.electrified;
  const tickFrames = Math.max(1, Math.floor(elapsedFrames));

  // --- Sample: what is the grid touching this body right now? ---
  const sample = sampleBodyCells(ctx, body, halfW, h);

  // --- Transitions (immune statuses never rise above 0) ---
  // Brine soaks like water (it douses a fire) and CHILLS: a body wading in it
  // stiffens (the frozen slow, topped up while it stays in) — the Cold Store's
  // frostbite. It never freezes solid the way nitrogen does.
  if (sample.brine >= BRINE_CHILL_CELLS && !immune?.frozen) st.frozen = Math.max(st.frozen, BRINE_CHILL_TICKS);
  if (sample.water + sample.brine >= 3) {
    if (!immune?.wet) st.wet = 120;
    st.oiled = 0;
    if (st.burning > 0) {
      // Doused: the fire dies in a one-time hiss of steam
      st.burning = 0;
      for (let j = 0; j < 3; j++) {
        ctx.particles.spawn(
          body.x + (entityRandom() - 0.5) * halfW * 2,
          body.y - entityRandom() * h,
          (entityRandom() - 0.5) * 0.5,
          -0.7 - entityRandom() * 0.6,
          null,
          steamColor(),
          18 + Math.floor(entityRandom() * 10),
          { grav: -0.03 },
        );
      }
    }
  }
  if (sample.oil >= 3 && st.wet === 0 && !immune?.oiled) st.oiled = 600;
  // CATCH FIRE (percentage-based): hotter flame + more cells + oil all raise the
  // per-sample odds, and sustained exposure re-rolls until it catches.
  if (!immune?.burning) rollCatchFire(st, sample.fire, sample.lava, false, options.igniteTicks, options.igniteOiledTicks);
  if (sample.nitrogen >= 2 && !immune?.frozen) st.frozen = Math.max(st.frozen, 100);
  // Touching a live conductor electrocutes for 1-2s. While still in the current
  // it tops back up (decays to ~1s, re-rolls), so a body stuck to charged metal
  // stays locked the whole time it conducts and convulses ~1-2s after it fades.
  if (sample.charged >= 1 && !immune?.electrified && st.electrified < 60) {
    st.electrified = 60 + ((entityRandom() * 61) | 0); // 60-120 frames @ 60fps
  }
  // The instant a body goes live (0 -> charged) gets a one-time zap + a crack.
  const justShocked = electrifiedBefore === 0 && st.electrified > 0;
  if (justShocked) ctx.audio.zap(body.x, body.y - h / 2);

  // --- Tick every timer ---
  if (st.wet > 0) st.wet = Math.max(0, st.wet - tickFrames);
  if (st.oiled > 0) st.oiled = Math.max(0, st.oiled - tickFrames);
  if (st.burning > 0) st.burning = Math.max(0, st.burning - tickFrames);
  if (st.frozen > 0) st.frozen = Math.max(0, st.frozen - tickFrames);
  if (st.electrified > 0) st.electrified = Math.max(0, st.electrified - tickFrames);
  if (st.regen > 0) st.regen = Math.max(0, st.regen - tickFrames);
  if (st.levity > 0) st.levity = Math.max(0, st.levity - tickFrames);
  if (st.stoneskin > 0) st.stoneskin = Math.max(0, st.stoneskin - tickFrames);
  if (st.swift > 0) st.swift = Math.max(0, st.swift - tickFrames);
  if (st.torch > 0) st.torch = Math.max(0, st.torch - tickFrames);

  // --- Active side effects: statuses write back into the world ---
  const frame = ctx.state.frameCount;
  if (st.burning > 0) {
    if (frame % 4 === 0) {
      const e = randomEdgeCell(body, halfW, h);
      ctx.particles.spawn(
        e.x,
        e.y,
        (entityRandom() - 0.5) * 0.5,
        -0.5 - entityRandom() * 0.7,
        null,
        fireColor(),
        12 + Math.floor(entityRandom() * 8),
        { grav: -0.02, glow: 2.2 },
      );
      // A body alight crackles — soft and globally throttled so a bonfire of foes
      // never firehoses the mix. Guarded (`?.`) for status-only test stubs.
      ctx.audio.sizzle?.();
      // ...and now and then it spits a brighter ember that leaps and glows, so a
      // burning body reads HOT at a glance (and a pyre-crit target is unmistakable).
      if (entityRandom() < 0.3) {
        const s = randomEdgeCell(body, halfW, h);
        ctx.particles.spawn(
          s.x,
          s.y,
          (entityRandom() - 0.5) * 0.8,
          -1.0 - entityRandom() * 0.9,
          null,
          packRGB(255, 196 + ((entityRandom() * 50) | 0), 70),
          20 + Math.floor(entityRandom() * 12),
          { grav: -0.04, glow: 2.7 },
        );
      }
    }
    // Burning sheds REAL fire — the grid must be able to explain the flames
    if (entityRandom() < 0.02) {
      const a = randomAdjacentCell(body, halfW, h);
      if (world.inBounds(a.x, a.y)) {
        const i = world.idx(a.x, a.y);
        if (world.types[i] === Cell.Empty) {
          world.replaceCellAt(i, Cell.Fire, fireColor());
          world.life[i] = 25 + Math.floor(entityRandom() * 10);
        }
      }
    }
  }
  if (st.frozen > 0 && frame % 6 === 0) {
    const e = randomEdgeCell(body, halfW, h);
    ctx.particles.spawn(
      e.x,
      e.y,
      (entityRandom() - 0.5) * 0.3,
      -0.15 - entityRandom() * 0.25,
      null,
      packRGB(205 + Math.floor(entityRandom() * 30), 235, 255),
      16,
      { grav: -0.005, glow: 0.7 },
    );
  }
  if (st.electrified > 0) {
    if (frame % 5 === 0) {
      const e = randomEdgeCell(body, halfW, h);
      const sa = entityRandom() * Math.PI * 2;
      ctx.particles.spawn(e.x, e.y, Math.cos(sa) * 1.4, Math.sin(sa) * 1.4, null, packRGB(80, 240, 255), 7, {
        grav: 0,
        glow: 2.6,
      });
    }
    // Lightning crawls over the shocked body: a short arc between two points on
    // its perimeter each sample (~2 frames). Lives on the lightning arc list, so
    // it both draws and seeds light. Guarded for status-only test stubs.
    const a = randomEdgeCell(body, halfW, h);
    const b = randomEdgeCell(body, halfW, h);
    ctx.lightning?.spark?.(a.x, a.y, b.x, b.y);
  }
  // WET: a glistening body sheds the odd runnel — the readable tell that a target
  // is soaked (primes Wet-Crit, conducts shock). Kept sparse so a doused crowd
  // doesn't fizz. Enemies had no wet tell at all before this; the player's sprite
  // sheen (PlayerSprite) layers on top.
  if (st.wet > 0 && frame % 9 === 0 && entityRandom() < 0.7) {
    const e = randomEdgeCell(body, halfW, h);
    ctx.particles.spawn(e.x, e.y, (entityRandom() - 0.5) * 0.25, 0.2 + entityRandom() * 0.4, null,
      packRGB(120, 185, 240), 13 + Math.floor(entityRandom() * 8), { grav: 0.08, glow: 0.45 });
  }
  // OILED: a dark, glossy slick weeping a heavy drip — reads "coated, flammable"
  // (an ignite waiting to happen, and it burns 5x faster once lit).
  if (st.oiled > 0 && frame % 12 === 0) {
    const e = randomEdgeCell(body, halfW, h);
    ctx.particles.spawn(e.x, e.y, (entityRandom() - 0.5) * 0.2, 0.12 + entityRandom() * 0.3, null,
      packRGB(70, 58, 40), 15 + Math.floor(entityRandom() * 8), { grav: 0.05, glow: 0.5 });
  }

  // Shock is now a real, tunable threat (global.shockDamage), with wet amplified
  // and a one-time zap the instant a body is electrified.
  const toxicDamage =
    immune?.toxic || sample.toxic === 0
      ? 0
      : sample.toxic * TOXIC_DAMAGE_PER_CELL * tickFrames * (options.toxicScale ?? 1);
  const healing =
    immune?.healium || sample.healium === 0
      ? 0
      : sample.healium * HEALIUM_HEAL_PER_CELL * tickFrames * (options.healiumScale ?? 1);
  if (healing > 0 && sample.healiumCells.length > 0) {
    for (const i of sample.healiumCells) {
      if (entityRandom() < 0.12 * tickFrames) world.clearCellAt(i);
    }
  }

  const shock = ctx.params.global.shockDamage;
  const burnDamage = st.burning > 0 ? BURN_DAMAGE * (options.burnScale ?? 1) : 0;
  const shockDamage = (st.electrified > 0 ? shock * (st.wet > 0 ? SHOCK_WET_MULT : 1) : 0) + (justShocked ? SHOCK_ZAP : 0);
  const frostbiteDamage = sample.brine >= BRINE_CHILL_CELLS && !immune?.frozen
    ? FROSTBITE_PER_TICK * tickFrames * (options.frostbiteScale ?? 0)
    : 0;
  const damage = burnDamage + shockDamage + toxicDamage + frostbiteDamage;
  // Electrified bodies stutter (a mild slow), short of the deep frozen lock.
  const slowFactor = st.frozen > 0 ? 0.55 : st.electrified > 0 ? 0.82 : 1;
  return {
    damage,
    toxicDamage,
    burnDamage,
    shockDamage,
    frostbiteDamage,
    maxCharge: sample.maxCharge,
    fueled: st.oiled > 0 || sample.oil > 0 || sample.lava > 0,
    heatContact: sample.fire > 0 || sample.lava > 0,
    conducted: st.wet > 0 || sample.conductorCharged > 0,
    liquidCharge: sample.liquidCharged > 0,
    chargeContact: sample.charged > 0,
    healing,
    teleportTouch: !immune?.teleportium && sample.teleportium > 0,
    slowFactor,
  };
}
