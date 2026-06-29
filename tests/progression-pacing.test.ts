import { afterEach, describe, expect, it } from 'vitest';

import type { Ctx } from '@/core/types';
import { PROGRESSION_PACING, PROGRESSION_PACING_DEFAULTS } from '@/config/pacing';
import { createPlayer } from '@/entities/Player';
import { enemyMovementPace, playerMovementPace, playerVerticalPace } from '@/core/progressionPacing';

function ctxAtDepth(depth: number): Ctx {
  return {
    player: createPlayer(),
    state: { mode: 'play' },
    levels: { current: { def: { depth } } },
  } as unknown as Ctx;
}

describe('progression pacing', () => {
  afterEach(() => {
    Object.assign(PROGRESSION_PACING, PROGRESSION_PACING_DEFAULTS);
  });

  it('starts D1 deliberately below the old baseline', () => {
    const ctx = ctxAtDepth(1);

    expect(playerMovementPace(ctx)).toBeCloseTo(0.74);
    expect(playerVerticalPace(ctx)).toBeCloseTo(0.84);
    expect(enemyMovementPace(ctx)).toBeCloseTo(0.55);
  });

  it('ramps movement back toward baseline over early depths', () => {
    expect(playerMovementPace(ctxAtDepth(2))).toBeCloseTo(0.805);
    expect(playerMovementPace(ctxAtDepth(3))).toBeCloseTo(0.87);
    expect(playerMovementPace(ctxAtDepth(5))).toBeCloseTo(1);

    expect(enemyMovementPace(ctxAtDepth(2))).toBeCloseTo(0.64);
    expect(enemyMovementPace(ctxAtDepth(4))).toBeCloseTo(0.82);
    expect(enemyMovementPace(ctxAtDepth(6))).toBeCloseTo(1);
  });

  it('lets real mobility upgrades break out of the slower start', () => {
    const ctx = ctxAtDepth(1);
    ctx.player.status.swift = 600;
    ctx.player.status.levity = 600;
    ctx.player.perks.swiftfoot = true;
    ctx.player.perks.featherweight = true;
    ctx.player.maxLevit = 125;

    expect(playerMovementPace(ctx)).toBeCloseTo(0.87);
    expect(playerVerticalPace(ctx)).toBeCloseTo(0.93);
    expect(enemyMovementPace(ctx)).toBeCloseTo(0.55);
  });

  it('reads live Builder pacing tuning from the canonical singleton', () => {
    PROGRESSION_PACING.playerStart = 0.62;
    PROGRESSION_PACING.enemyStart = 0.42;

    expect(playerMovementPace(ctxAtDepth(1))).toBeCloseTo(0.62);
    expect(enemyMovementPace(ctxAtDepth(1))).toBeCloseTo(0.42);
  });
});
