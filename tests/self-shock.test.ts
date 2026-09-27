import { describe, expect, it } from 'vitest';

import {
  conductorPath,
  createSelfShockState,
  fairShockDamage,
  SELF_SHOCK_CAST_TICKS,
  SELF_SHOCK_FULL_CHARGE,
  SELF_SHOCK_MIN_SCALE,
  SELF_SHOCK_WINDOW_CAP,
  SELF_SHOCK_WINDOW_TICKS,
  shockFalloff,
} from '@/combat/SelfShock';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

describe('self-shock fairness', () => {
  it('scales the jolt with the current that actually reaches the body', () => {
    expect(shockFalloff(0)).toBe(SELF_SHOCK_MIN_SCALE);
    expect(shockFalloff(SELF_SHOCK_FULL_CHARGE / 2)).toBeCloseTo(0.5);
    expect(shockFalloff(SELF_SHOCK_FULL_CHARGE * 3)).toBe(1);
  });

  it('leaves other currents alone: a Rillback pulse keeps its full bite', () => {
    const s = createSelfShockState();
    expect(fairShockDamage(s, 3.6, 5, 1000)).toBe(3.6);
  });

  it('caps the alchemist’s own current per window and forgets it after', () => {
    const s = createSelfShockState();
    s.lastCast = 1000;
    // A faint current arrives as a tingle.
    expect(fairShockDamage(s, 3.6, 4, 1001)).toBeCloseTo(3.6 * SELF_SHOCK_MIN_SCALE);
    // A strong one hits hard, but never past the window cap in total.
    let total = 3.6 * SELF_SHOCK_MIN_SCALE;
    for (let f = 1002; f < 1000 + SELF_SHOCK_WINDOW_TICKS; f += 2) total += fairShockDamage(s, 3.6, 200, f);
    expect(total).toBeCloseTo(SELF_SHOCK_WINDOW_CAP);
    // A fresh window after it lapses (the cast is still recent).
    expect(fairShockDamage(s, 3.6, 200, 1000 + SELF_SHOCK_WINDOW_TICKS + 5)).toBeCloseTo(3.6);
    // Long after the last cast, the current is no longer "his".
    expect(fairShockDamage(s, 3.6, 4, 1000 + SELF_SHOCK_CAST_TICKS + 1)).toBe(3.6);
  });

  it('traces the current back up the conductor toward its source, locally', () => {
    const world = new World(80, 40);
    // A water channel along y=30; charge rises toward x=70 (the strike).
    for (let x = 0; x < 80; x++) {
      const i = world.idx(x, 30);
      world.replaceCellAt(i, Cell.Water, 0x2a6fb0);
      world.setChargeAt(i, Math.max(0, x - 5));
    }
    const path = conductorPath(world, 10, 30, 4, 17);
    expect(path.length).toBeGreaterThan(4);
    expect(path[0].x).toBe(14); // the body's hottest touching cell
    for (let i = 1; i < path.length; i++) expect(path[i].x).toBeGreaterThan(path[i - 1].x);
    expect(path.length).toBeLessThanOrEqual(17);
    expect(conductorPath(new World(40, 40), 10, 30, 4, 17)).toEqual([]);
  });
});
