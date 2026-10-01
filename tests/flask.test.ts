import { describe, expect, it } from 'vitest';

import { Flask, lobToBowl } from '@/combat/Flask';
import type { Ctx, RunTestKitConfig } from '@/core/types';
import { PlayerControl } from '@/entities/Player';
import { createDefaultStatus } from '@/entities/status';
import { Levels } from '@/game/Levels';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

function makeFlaskCtx(flask = new Flask()): Ctx {
  const world = new World(64, 64);
  return {
    flask,
    world,
    state: { mode: 'play', score: 0, frameCount: 0 },
    player: {
      x: 12,
      y: 21,
      dead: false,
      climbing: false,
      maxHp: 100,
      hp: 100,
      maxLevit: 100,
      levit: 100,
      status: createDefaultStatus(),
      perks: {},
    },
    input: { mouse: { x: 32, y: 12 } },
    spells: { wandTip: () => ({ x: 12, y: 12 }) },
    params: {
      materials: {
        [Cell.Water]: { name: 'Water' },
      },
    },
    audio: { sfx: () => undefined, creature: () => undefined,
      tone: () => undefined,
      dryFire: () => undefined,
      noiseBurst: () => undefined,
    },
    telemetry: { count: () => undefined },
    events: { emit: () => undefined },
    particles: { spawn: () => undefined },
    wands: {
      collection: [],
      wands: [],
      resetLoadout: () => undefined,
      applyStarterLoadout: () => undefined,
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

  it('does not siphon material through blocking cells', () => {
    const flask = new Flask();
    const ctx = makeFlaskCtx(flask);
    ctx.input.siphonHeld = true;
    ctx.world.types[ctx.world.idx(20, 12)] = Cell.Stone;
    ctx.world.types[ctx.world.idx(32, 12)] = Cell.Water;

    flask.update(ctx);

    expect(flask.state.count).toBe(0);
    expect(ctx.world.types[ctx.world.idx(32, 12)]).toBe(Cell.Water);
  });

  it('siphons visible material after the path is opened', () => {
    const flask = new Flask();
    const ctx = makeFlaskCtx(flask);
    ctx.input.siphonHeld = true;
    ctx.world.types[ctx.world.idx(32, 12)] = Cell.Water;

    flask.update(ctx);

    expect(flask.state).toMatchObject({ material: Cell.Water, count: 1 });
    expect(ctx.world.types[ctx.world.idx(32, 12)]).toBe(Cell.Empty);
  });
});

describe('run test kit flask setup', () => {
  it('seeds fresh expeditions with a water starter flask', () => {
    const ctx = makeFlaskCtx();
    const levels = new Levels(ctx);
    const internals = levels as unknown as {
      applyLoadoutPreset(ctx: Ctx, preset: 'fresh'): void;
    };

    internals.applyLoadoutPreset(ctx, 'fresh');

    expect(ctx.flask.activeIndex).toBe(0);
    expect(ctx.flask.state).toMatchObject({ material: Cell.Water, count: 300 });
  });

  it('keeps thrown flask inventory full in god mode', () => {
    const flask = new Flask();
    flask.setSlot(0, Cell.Water, 50);
    const ctx = makeFlaskCtx(flask);
    ctx.state.debugGodMode = true;

    flask.throwFlask(ctx);

    expect(flask.bottleView()).toMatchObject({ material: Cell.Water, count: 50 });
    expect(flask.state).toMatchObject({ material: Cell.Water, count: 50 });
  });

  it('keeps poured and drunk flask contents from depleting in god mode', () => {
    const flask = new Flask();
    flask.setSlot(0, Cell.Water, 30);
    const ctx = makeFlaskCtx(flask);
    ctx.state.debugGodMode = true;
    ctx.input.pourHeld = true;

    flask.update(ctx);

    expect(flask.state).toMatchObject({ material: Cell.Water, count: 30 });

    flask.setSlot(0, Cell.ElixirLife, 5);
    const playerCtl = new PlayerControl(ctx) as unknown as { drink(ctx: Ctx): void };
    playerCtl.drink(ctx);

    expect(flask.state).toMatchObject({ material: Cell.ElixirLife, count: 5 });
    // one sip is one cell, worth the elixir table's 120 frames of mending (it was two cells of 10 frames: the old 2 s)
    expect(ctx.player.status.regen).toBe(120);
  });

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

describe('the lob into a bowl', () => {
  /** A cauldron at (60, 40): stone base row at 41 on solid ground, walls 2 tall at 56 and 64. */
  function basin(): World {
    const w = new World(128, 96);
    for (let y = 41; y < 96; y++) for (let x = 0; x < 128; x++) w.types[w.idx(x, y)] = Cell.Stone; // the ground it stands on (a droplet moves three cells a frame: a one-cell floor over air is skipped)
    for (const y of [39, 40]) { w.types[w.idx(56, y)] = Cell.Stone; w.types[w.idx(64, y)] = Cell.Stone; }
    return w;
  }
  /** Fly a droplet as Particles does (vy += g; x += vx; y += vy) to the first cell it meets; the cell before it is where it deposits. */
  function land(w: World, x0: number, y0: number, vx: number, vy: number, g: number): { x: number; y: number } {
    let x = x0, y = y0, px = x0, py = y0;
    for (let n = 0; n < 200; n++) {
      vy += g; x += vx; y += vy;
      if (w.types[w.idx(Math.floor(x), Math.floor(y))] !== Cell.Empty) break;
      px = x; py = y;
    }
    return { x: Math.floor(px), y: Math.floor(py) };
  }

  it('lands in the bowl from either side, near or far, high or low', () => {
    const w = basin();
    for (const [x0, y0] of [[48, 32], [42, 30], [34, 36], [72, 32], [80, 30], [60, 18], [50, 38]]) {
      const lob = lobToBowl(w, x0, y0, 60, 39, 0.11);
      expect(lob, `a lob from ${x0},${y0}`).not.toBeNull();
      const at = land(w, x0, y0, lob!.vx, lob!.vy, 0.11);
      expect(at.x, `from ${x0},${y0} it lands at ${at.x},${at.y}`).toBeGreaterThanOrEqual(57);
      expect(at.x, `from ${x0},${y0} it lands at ${at.x},${at.y}`).toBeLessThanOrEqual(63);
      expect(at.y, `from ${x0},${y0} it lands at ${at.x},${at.y}`).toBeGreaterThanOrEqual(38);
    }
  });

  it('gives up where no arc reaches (the wall in the way)', () => {
    const w = basin();
    for (let y = 0; y < 96; y++) for (let x = 51; x <= 54; x++) w.types[w.idx(x, y)] = Cell.Stone; // a rock face (a droplet moves three cells a frame: a thin one is skipped) between the wand and the bowl, floor to sky
    expect(lobToBowl(w, 48, 33, 60, 39, 0.11)).toBeNull();
  });
});
