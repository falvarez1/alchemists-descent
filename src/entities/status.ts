// ===================== Sim-sampled entity status (Wave C) =====================
// DESIGN.md pillar 5: WET / OILED / BURNING / FROZEN / ELECTRIFIED are read
// straight from the cells touching a body, and write cells back where it
// matters (burning sheds real Fire into the grid). One status struct is shared
// by the player, every enemy, and the potion timers — a potion is just a timed
// rewrite of entity-vs-cell rules.

import type { Ctx, EntityStatus } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { fireColor, packRGB, steamColor } from '@/sim/colors';

/** Statuses the grid can inflict (potion timers can't be "immune"-blocked). */
type ElementalStatus = 'burning' | 'frozen' | 'electrified' | 'wet' | 'oiled';

const SHOCK_WET_MULT = 3; // a wet body conducts — far more shock damage (the combo)
const SHOCK_ZAP = 3; // one-time hit the instant a dry/wet body becomes electrified

interface StatusBody {
  x: number;
  y: number;
  status: EntityStatus;
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

/** Death/respawn clears grid-inflicted transient harm but preserves potion boons. */
export function clearElementalStatus(status: EntityStatus): void {
  status.wet = 0;
  status.oiled = 0;
  status.burning = 0;
  status.frozen = 0;
  status.electrified = 0;
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
): { damage: number; slowFactor: number } {
  const world = ctx.world;
  const st = body.status;
  const electrifiedBefore = st.electrified;
  const tickFrames = Math.max(1, Math.floor(elapsedFrames));

  // --- Sample: what is the grid touching this body right now? ---
  let water = 0,
    oil = 0,
    fire = 0,
    nitrogen = 0,
    charged = 0;
  for (let dy = 0; dy < h; dy += 2) {
    for (let dx = -halfW; dx <= halfW; dx += 2) {
      const X = body.x + dx,
        Y = body.y - dy;
      if (!world.inBounds(X, Y)) continue;
      const i = world.idx(X, Y);
      const t = world.types[i];
      if (t === Cell.Water) water++;
      else if (t === Cell.Oil) oil++;
      else if (t === Cell.Fire || t === Cell.Lava) fire++;
      else if (t === Cell.Nitrogen) nitrogen++;
      if (world.charge[i] > 0) charged++;
    }
  }

  // --- Transitions (immune statuses never rise above 0) ---
  if (water >= 3) {
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
  if (oil >= 3 && st.wet === 0 && !immune?.oiled) st.oiled = 600;
  if (fire >= 1 && !immune?.burning) st.burning = Math.max(st.burning, st.oiled > 0 ? 300 : 90);
  if (nitrogen >= 2 && !immune?.frozen) st.frozen = Math.max(st.frozen, 100);
  if (charged >= 1 && !immune?.electrified) st.electrified = Math.max(st.electrified, 45);
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
    }
    // Burning sheds REAL fire — the grid must be able to explain the flames
    if (Math.random() < 0.02) {
      const a = randomAdjacentCell(body, halfW, h);
      if (world.inBounds(a.x, a.y)) {
        const i = world.idx(a.x, a.y);
        if (world.types[i] === Cell.Empty) {
          world.types[i] = Cell.Fire;
          world.colors[i] = fireColor();
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

  // Shock is now a real, tunable threat (global.shockDamage), with wet amplified
  // and a one-time zap the instant a body is electrified.
  const shock = ctx.params.global.shockDamage;
  const damage =
    (st.burning > 0 ? 0.12 : 0) +
    (st.electrified > 0 ? shock * (st.wet > 0 ? SHOCK_WET_MULT : 1) : 0) +
    (justShocked ? SHOCK_ZAP : 0);
  // Electrified bodies stutter (a mild slow), short of the deep frozen lock.
  const slowFactor = st.frozen > 0 ? 0.55 : st.electrified > 0 ? 0.82 : 1;
  return { damage, slowFactor };
}
