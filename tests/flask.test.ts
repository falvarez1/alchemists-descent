import { describe, expect, it } from 'vitest';

import { Flask } from '@/combat/Flask';
import type { Ctx, RunTestKitConfig } from '@/core/types';
import { Levels } from '@/game/Levels';
import { Cell } from '@/sim/CellType';

function makeFlaskCtx(flask = new Flask()): Ctx {
  return {
    flask,
    state: { mode: 'play', score: 0, frameCount: 0 },
    player: {
      dead: false,
      climbing: false,
      maxHp: 100,
      hp: 100,
      maxLevit: 100,
      levit: 100,
      perks: {},
    },
    input: { mouse: { x: 32, y: 12 } },
    spells: { wandTip: () => ({ x: 12, y: 12 }) },
    params: {
      materials: {
        [Cell.Water]: { name: 'Water' },
      },
    },
    audio: {
      tone: () => undefined,
      dryFire: () => undefined,
    },
    telemetry: { count: () => undefined },
    events: { emit: () => undefined },
    wands: {
      collection: [],
      wands: [],
      grantCard: () => undefined,
    },
  } as unknown as Ctx;
}

describe('Flask runtime state', () => {
  it('clears an in-flight thrown bottle when slots are reset', () => {
    const flask = new Flask();
    flask.setSlot(0, Cell.Water, 50);
    const ctx = makeFlaskCtx(flask);

    flask.throwFlask(ctx);
    expect(flask.bottleView()).toMatchObject({ material: Cell.Water, count: 50 });

    flask.clearSlots();

    expect(flask.bottleView()).toBeNull();
  });
});

describe('run test kit flask setup', () => {
  it('honors an explicit active flask index for legacy single-flask setup', () => {
    const ctx = makeFlaskCtx();
    const levels = new Levels(ctx);
    const internals = levels as unknown as {
      applyTestKit(ctx: Ctx, kit: RunTestKitConfig): void;
    };

    internals.applyTestKit(ctx, {
      flask: { material: Cell.Water, count: 75 },
      activeFlaskIndex: 2,
    });

    expect(ctx.flask.activeIndex).toBe(2);
    expect(ctx.flask.slots[2]).toMatchObject({ material: Cell.Water, count: 75 });
    expect(ctx.flask.state).toMatchObject({ material: Cell.Water, count: 75 });
  });

  it('drops invalid flask materials when restoring saved inventory', () => {
    const ctx = makeFlaskCtx();
    const levels = new Levels(ctx);
    const internals = levels as unknown as {
      restoreFlasks(
        ctx: Ctx,
        save: { activeIndex: number; slots: Array<{ material: number | null; count: number; capacity?: number }> } | unknown,
      ): void;
    };

    internals.restoreFlasks(ctx, {
      activeIndex: 0,
      slots: [{ material: 9999, count: 50, capacity: 600 }],
    });

    expect(ctx.flask.slots[0]).toMatchObject({ material: null, count: 0 });

    ctx.flask.setSlot(0, Cell.Water, 25);
    internals.restoreFlasks(ctx, {
      activeIndex: 0,
      slots: null,
    });

    expect(ctx.flask.slots[0]).toMatchObject({ material: null, count: 0 });
  });
});
