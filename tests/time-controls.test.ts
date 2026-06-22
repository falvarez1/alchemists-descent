import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import { TimeControls } from '@/game/TimeControls';
import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR } from '@/sim/colors';
import { World } from '@/sim/World';

function makeCtx(world = new World(8, 8)): Ctx {
  return {
    world,
    events: new EventBus(),
    state: {
      mode: 'build',
      frameCount: 12,
      paused: true,
      debugTainted: false,
    },
    fx: { bloomKick: 0.4, screenShake: 0.2, digBeam: null, hitstop: 3, deathSlowMo: 7 },
    simulation: { accumulator: 0.5, update: vi.fn(), processFrame: vi.fn() },
    projectiles: [],
    shockwaves: [],
    particles: { clear: vi.fn() },
    lightning: { clear: vi.fn() },
    wands: { clearTransientState: vi.fn() },
    input: {},
  } as unknown as Ctx;
}

describe('TimeControls', () => {
  it('queues manual ticks and emits a world edit after they run', () => {
    const ctx = makeCtx();
    const time = new TimeControls(ctx);
    const edits: string[] = [];
    ctx.events.on('worldEdited', (edit) => edits.push(`${edit.source}:${edit.command}:${edit.cells}`));

    expect(time.queueTicks(5)).toBe(5);
    expect(time.manual).toBe(true);
    expect(time.queuedTicks).toBe(5);
    expect(time.takeQueuedTicks(2)).toBe(2);
    expect(time.queuedTicks).toBe(3);

    time.afterManualTicks(2);

    expect(edits).toEqual(['time-controls:time step:128']);
    expect(time.status().lastAction).toBe('STEPPED 2');
  });

  it('rewinds a captured grid window including charge and color override metadata', () => {
    const world = new World(8, 8);
    world.simBounds.x0 = 1;
    world.simBounds.x1 = 6;
    world.simBounds.y0 = 1;
    world.simBounds.y1 = 6;
    const ctx = makeCtx(world);
    const time = new TimeControls(ctx);
    const index = world.idx(3, 4);
    world.replaceCellAt(index, Cell.Gunpowder, 0x332211);
    world.life[index] = 44;
    world.moved[index] = 9;
    world.setChargeAt(index, 123);
    world.colorOverrides.add(index);

    expect(time.captureCheckpoint()).toBe(true);

    world.clearCellAt(index);
    world.moved[index] = 0;
    world.movedTick = 33;
    ctx.state.frameCount = 99;
    ctx.simulation.accumulator = 0.1;
    ctx.fx.bloomKick = 0;
    expect(world.types[index]).toBe(Cell.Empty);
    expect(world.colors[index]).toBe(EMPTY_COLOR);
    expect(world.activeCharges.has(index)).toBe(false);

    expect(time.rewindTicks(1)).toBe(1);

    expect(world.types[index]).toBe(Cell.Gunpowder);
    expect(world.colors[index]).toBe(0x332211);
    expect(world.life[index]).toBe(44);
    expect(world.moved[index]).toBe(9);
    expect(world.charge[index]).toBe(123);
    expect(world.activeCharges.has(index)).toBe(true);
    expect(world.colorOverrides.has(index)).toBe(true);
    expect(world.movedTick).toBe(1);
    expect(ctx.state.frameCount).toBe(12);
    expect(ctx.simulation.accumulator).toBe(0.5);
    expect(ctx.fx.bloomKick).toBe(0.4);
  });

  it('marks play sessions debug-tainted when manual time controls are used', () => {
    const ctx = makeCtx();
    ctx.state.mode = 'play';
    const time = new TimeControls(ctx);

    time.setManual(true);

    expect(ctx.state.debugTainted).toBe(true);
  });
});
