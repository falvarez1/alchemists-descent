// ===================== Sim-sampled entity status (Wave C) =====================
// DESIGN.md pillar 5: WET / OILED / BURNING / FROZEN / ELECTRIFIED are read
// straight from the cells touching a body, and write cells back where it
// matters (burning sheds real Fire into the grid). One status struct is shared
// by the player, every enemy, and the potion timers — a potion is just a timed
// rewrite of entity-vs-cell rules.

import type { Ctx, EntityStatus } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { fireColor, packRGB, steamColor } from '@/sim/colors';

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
  charged: number;
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
}

export interface StatusSampleResult {
  damage: number;
  toxicDamage: number;
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
export function rollCatchFire(status: EntityStatus, fireCells: number, lavaCells: number, immune = false): boolean {
  if (immune) return false;
  const heat = (fireCells * FIRE_IGNITE_CHANCE + lavaCells * LAVA_IGNITE_CHANCE) * (status.oiled > 0 ? OIL_IGNITE_MULT : 1);
  if (heat <= 0) return status.burning > 0;
  if (status.burning > 0 || heat >= IGNITE_HOT_ENOUGH || Math.random() < heat) {
    // staying in the flames refreshes the burn; a fresh catch lights it.
    status.burning = status.oiled > 0 ? 300 : 90;
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
    charged: 0,
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
        t === Cell.Teleportium
      ) {
        sample.liquid++;
        if (sample.sampledSplashColor === null || t === Cell.Water || t === Cell.Blood) {
          sample.sampledSplashColor = world.colors[i];
        }
        if (t === Cell.Water || t === Cell.Blood) sample.waterOrBlood++;
      }
      if (t === Cell.Fungus || t === Cell.Glowshroom) sample.fungus++;
      if (world.charge[i] > 0) sample.charged++;
    }
  }
  // Standing on a charged conductor (a zapped metal floor / electrified water)
  // counts as contact — sense the cells just underfoot, not only the body box.
  for (let dx = -halfW; dx <= halfW; dx += 2) {
    const X = bx + dx;
    const Y = by + 1;
    if (world.inBounds(X, Y) && world.charge[world.idx(X, Y)] > 0) sample.charged++;
  }
  return sample;
}

/** Random cell on the body's AABB perimeter (where flames lick off the skin). */
function randomEdgeCell(body: StatusBody, halfW: number, h: number): { x: number; y: number } {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: body.x - halfW, y: body.y - Math.floor(Math.random() * h) };
  if (side === 1) return { x: body.x + halfW, y: body.y - Math.floor(Math.random() * h) };
  const ex = body.x - halfW + Math.floor(Math.random() * (halfW * 2 + 1));
  return { x: ex, y: side === 2 ? body.y - h + 1 : body.y };
}

/** Random cell one step OUTSIDE the body's AABB (where shed fire lands). */
function randomAdjacentCell(body: StatusBody, halfW: number, h: number): { x: number; y: number } {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: body.x - halfW - 1, y: body.y - Math.floor(Math.random() * h) };
  if (side === 1) return { x: body.x + halfW + 1, y: body.y - Math.floor(Math.random() * h) };
  const ex = body.x - halfW + Math.floor(Math.random() * (halfW * 2 + 1));
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
  if (sample.water >= 3) {
    if (!immune?.wet) st.wet = 120;
    st.oiled = 0;
    if (st.burning > 0) {
      // Doused: the fire dies in a one-time hiss of steam
      st.burning = 0;
      for (let j = 0; j < 3; j++) {
        ctx.particles.spawn(
          body.x + (Math.random() - 0.5) * halfW * 2,
          body.y - Math.random() * h,
          (Math.random() - 0.5) * 0.5,
          -0.7 - Math.random() * 0.6,
          null,
          steamColor(),
          18 + Math.floor(Math.random() * 10),
          { grav: -0.03 },
        );
      }
    }
  }
  if (sample.oil >= 3 && st.wet === 0 && !immune?.oiled) st.oiled = 600;
  // CATCH FIRE (percentage-based): hotter flame + more cells + oil all raise the
  // per-sample odds, and sustained exposure re-rolls until it catches.
  if (!immune?.burning) rollCatchFire(st, sample.fire, sample.lava);
  if (sample.nitrogen >= 2 && !immune?.frozen) st.frozen = Math.max(st.frozen, 100);
  // Touching a live conductor electrocutes for 1-2s. While still in the current
  // it tops back up (decays to ~1s, re-rolls), so a body stuck to charged metal
  // stays locked the whole time it conducts and convulses ~1-2s after it fades.
  if (sample.charged >= 1 && !immune?.electrified && st.electrified < 60) {
    st.electrified = 60 + ((Math.random() * 61) | 0); // 60-120 frames @ 60fps
  }
  // The instant a body goes live (0 -> charged) gets a one-time zap + a crack.
  const justShocked = electrifiedBefore === 0 && st.electrified > 0;
  if (justShocked) ctx.audio.zap();

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
        (Math.random() - 0.5) * 0.5,
        -0.5 - Math.random() * 0.7,
        null,
        fireColor(),
        12 + Math.floor(Math.random() * 8),
        { grav: -0.02, glow: 2.2 },
      );
      // A body alight crackles — soft and globally throttled so a bonfire of foes
      // never firehoses the mix. Guarded (`?.`) for status-only test stubs.
      ctx.audio.sizzle?.();
      // ...and now and then it spits a brighter ember that leaps and glows, so a
      // burning body reads HOT at a glance (and a pyre-crit target is unmistakable).
      if (Math.random() < 0.3) {
        const s = randomEdgeCell(body, halfW, h);
        ctx.particles.spawn(
          s.x,
          s.y,
          (Math.random() - 0.5) * 0.8,
          -1.0 - Math.random() * 0.9,
          null,
          packRGB(255, 196 + ((Math.random() * 50) | 0), 70),
          20 + Math.floor(Math.random() * 12),
          { grav: -0.04, glow: 2.7 },
        );
      }
    }
    // Burning sheds REAL fire — the grid must be able to explain the flames
    if (Math.random() < 0.02) {
      const a = randomAdjacentCell(body, halfW, h);
      if (world.inBounds(a.x, a.y)) {
        const i = world.idx(a.x, a.y);
        if (world.types[i] === Cell.Empty) {
          world.replaceCellAt(i, Cell.Fire, fireColor());
          world.life[i] = 25 + Math.floor(Math.random() * 10);
        }
      }
    }
  }
  if (st.frozen > 0 && frame % 6 === 0) {
    const e = randomEdgeCell(body, halfW, h);
    ctx.particles.spawn(
      e.x,
      e.y,
      (Math.random() - 0.5) * 0.3,
      -0.15 - Math.random() * 0.25,
      null,
      packRGB(205 + Math.floor(Math.random() * 30), 235, 255),
      16,
      { grav: -0.005, glow: 0.7 },
    );
  }
  if (st.electrified > 0) {
    if (frame % 5 === 0) {
      const e = randomEdgeCell(body, halfW, h);
      const sa = Math.random() * Math.PI * 2;
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
  if (st.wet > 0 && frame % 9 === 0 && Math.random() < 0.7) {
    const e = randomEdgeCell(body, halfW, h);
    ctx.particles.spawn(e.x, e.y, (Math.random() - 0.5) * 0.25, 0.2 + Math.random() * 0.4, null,
      packRGB(120, 185, 240), 13 + Math.floor(Math.random() * 8), { grav: 0.08, glow: 0.45 });
  }
  // OILED: a dark, glossy slick weeping a heavy drip — reads "coated, flammable"
  // (an ignite waiting to happen, and it burns 5x faster once lit).
  if (st.oiled > 0 && frame % 12 === 0) {
    const e = randomEdgeCell(body, halfW, h);
    ctx.particles.spawn(e.x, e.y, (Math.random() - 0.5) * 0.2, 0.12 + Math.random() * 0.3, null,
      packRGB(70, 58, 40), 15 + Math.floor(Math.random() * 8), { grav: 0.05, glow: 0.5 });
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
      if (Math.random() < 0.12 * tickFrames) world.clearCellAt(i);
    }
  }

  const shock = ctx.params.global.shockDamage;
  const damage =
    (st.burning > 0 ? 0.12 : 0) +
    (st.electrified > 0 ? shock * (st.wet > 0 ? SHOCK_WET_MULT : 1) : 0) +
    (justShocked ? SHOCK_ZAP : 0) +
    toxicDamage;
  // Electrified bodies stutter (a mild slow), short of the deep frozen lock.
  const slowFactor = st.frozen > 0 ? 0.55 : st.electrified > 0 ? 0.82 : 1;
  return {
    damage,
    toxicDamage,
    healing,
    teleportTouch: !immune?.teleportium && sample.teleportium > 0,
    slowFactor,
  };
}
