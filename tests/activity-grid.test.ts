import { describe, expect, it } from 'vitest';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { matureVegetation } from '@/world/vegetation';
import { PatchRecorder, writeCell } from '@/builder/terrain';
import { handleOil } from '@/sim/elements/liquids';

describe('material activity', () => {
  it('sleeps enclosed oil but promotes ignition across a distant chunk seam', () => {
    const world = new World(192, 128), interest = { x0: 0, y0: 0, x1: 32, y1: 32 };
    world.types.fill(Cell.Wall);
    for (let y = 50; y < 90; y++) for (let x = 40; x < 100; x++) world.types[world.idx(x, y)] = Cell.Oil;
    world.activity.beginStep(world, interest, 1);
    expect(world.activity.activeChunks).toBe(0);
    const index = world.idx(63, 70), neighbor = world.idx(64, 70);
    world.life[index] = 90; world.activity.touchIndex(index);
    const params = createGameParams(); params.materials[Cell.Oil].igniteChance = 1;
    const ctx = { world, params, particles: { spawn() {} } } as unknown as Ctx;
    handleOil(ctx, 63, 70);
    expect(world.life[neighbor]).toBeGreaterThan(0);
    for (let tick = 1; tick <= 8; tick++) {
      world.activity.beginStep(world, interest, tick);
      expect(world.activity.eligible[neighbor]).toBe(1);
      expect(world.activity.scheduled[3]).toBe(1);
      expect(world.activity.scheduled[4]).toBe(1);
    }
  });

  it('wakes enclosed fuel beside a charged diagonal contact', () => {
    const world = new World(128, 96);
    world.types.fill(Cell.Oil);
    world.activity.beginStep(world);
    const index = world.idx(63, 70);
    expect(world.activity.eligible[index]).toBe(0);
    world.setChargeAt(world.idx(62, 69), 200);
    world.activity.beginStep(world);
    expect(world.activity.eligible[index]).toBe(1);
  });

  it('keeps the render scar mask consistent through staining, swaps and clears', () => {
    const world = new World(128, 16);
    const a = world.idx(63, 8), b = world.idx(64, 8);
    world.replaceCellAt(a, Cell.Stone, 0x442222);
    world.colorOverrides.add(a);
    const before = world.mutationVersion;
    world.colorOverrides.add(a); // another stain on the same cell
    expect(world.mutationVersion).toBeGreaterThan(before);
    expect(world.colorOverrides.mask[a]).toBe(255);
    world.swap(63, 8, 64, 8);
    expect([...world.colorOverrides]).toEqual([b]);
    expect(world.colorOverrides.mask[a]).toBe(0);
    expect(world.colorOverrides.mask[b]).toBe(255);
    world.clearCellAt(b);
    expect(world.colorOverrides.mask[b]).toBe(0);
    world.colorOverrides.add(a).add(b);
    world.colorOverrides.clear();
    expect(world.colorOverrides.size).toBe(0);
    expect(world.colorOverrides.mask.some(value => value !== 0)).toBe(false);
  });

  it('wakes painted material in an already settled Builder world', () => {
    const world = new World(128, 128);
    world.activity.beginStep(world);
    expect(world.activity.activeChunks).toBe(0);
    const index = world.idx(63, 70);
    world.colorOverrides.add(index);
    const recorder = new PatchRecorder(world);
    writeCell(world, recorder, 63, 70, Cell.Water);
    world.activity.beginStep(world);
    expect(world.activity.eligible[index]).toBe(1);
    expect(world.activity.scheduled[2]).toBe(1);
    expect(world.colorOverrides.has(index)).toBe(false);
    expect(recorder.finish()?.before.types).toEqual([Cell.Empty]);
  });

  it('starts established plants dormant without changing thermal material lifetimes', () => {
    const world = new World(16, 16);
    [Cell.Vines, Cell.Moss, Cell.Fungus, Cell.Grass, Cell.Fire, Cell.Ice].forEach((type, i) => {
      world.replaceCellAt(i, type, 0); world.life[i] = 80;
    });
    matureVegetation(world);
    expect([...world.life.slice(0, 6)]).toEqual([-1, -1, -1, -1, 80, 80]);
  });
  it('conserves reservoir mass through a newly opened chunk seam', () => {
    const world = new World(128, 96);
    world.types.fill(Cell.Wall);
    for (let y = 35; y < 80; y++) for (let x = 40; x < 96; x++) {
      if (x !== 64) world.types[world.idx(x, y)] = x < 64 && y >= 56 ? Cell.Water : Cell.Empty;
    }
    const countWater = () => world.types.reduce((sum, t) => sum + (t === Cell.Water ? 1 : 0), 0);
    const before = countWater();
    const ctx = { world, state: { mode: 'play', frameCount: 0, worldSeed: 222 }, params: createGameParams(),
      player: { dead: true, perks: {}, status: {} }, projectileCtl: { update() {} }, shockwaves: [],
      particles: { spawn() {} }, events: { emit() {} } } as unknown as Ctx;
    const sim = new Simulation();
    sim.processFrame(ctx);
    world.clearCell(64, 70);
    for (let tick = 1; tick <= 120; tick++) { ctx.state.frameCount = tick; sim.processFrame(ctx); }
    expect(countWater()).toBe(before);
    let crossed = 0;
    for (let y = 35; y < 80; y++) for (let x = 65; x < 96; x++) if (world.type(x, y) === Cell.Water) crossed++;
    expect(crossed).toBeGreaterThan(30);
    expect(world.type(64, 71)).toBe(Cell.Wall);
  });

  it('retains a dormant growth wake until its background step and separates render damage', () => {
    const world = new World(256, 128), interest = { x0: 0, y0: 0, x1: 64, y1: 64 };
    world.replaceCellAt(world.idx(220, 80), Cell.Moss, 0);
    world.activity.beginStep(world, interest);
    const key = 7;
    world.activity.growthChanged[key] = 0;
    world.clearCell(220, 81);
    world.activity.renderMinX[key] = 32767; world.activity.renderMaxX[key] = 0;
    world.activity.beginStep(world, interest);
    expect(world.activity.growthChanged[key]).toBe(1);
    world.activity.beginStep(world, interest);
    expect(world.activity.growthChanged[key]).toBe(1);
    expect(world.activity.growthCells[key]).toContain(world.idx(220, 80));
  });
  it('removes enclosed pool cells from the frontier and wakes a cut across its seam', () => {
    const world = new World(192, 128);
    world.types.fill(Cell.Wall);
    for (let y = 20; y < 100; y++) for (let x = 20; x < 170; x++) world.types[world.idx(x, y)] = Cell.Water;
    world.activity.beginStep(world);
    expect(world.activity.activeChunks).toBe(0);
    const index = world.idx(63, 70);
    expect(world.activity.eligible[index]).toBe(0);
    world.clearCell(64, 70);
    world.activity.beginStep(world);
    expect(world.activity.eligible[index]).toBe(1);
    expect(world.activity.rowMasks[70 * world.activity.wordsPerRow + 1] >>> 31).toBe(1);
    expect(world.activity.scheduled[3]).toBe(1);
    expect(world.activity.scheduled[4]).toBe(1);
  });

  it('stagger-steps distant fluids while keeping nearby cells and remote heat live', () => {
    const world = new World(512, 128), interest = { x0: 0, y0: 0, x1: 64, y1: 64 };
    world.replaceCellAt(world.idx(20, 20), Cell.Water, 0);
    world.replaceCellAt(world.idx(220, 80), Cell.Water, 0);
    world.replaceCellAt(world.idx(480, 80), Cell.Fire, 0);
    const counts = [0, 0, 0];
    for (let tick = 0; tick < 8; tick++) {
      world.activity.beginStep(world, interest);
      [0, 11, 15].forEach((key, i) => counts[i] += world.activity.scheduled[key]);
    }
    expect(counts).toEqual([8, 2, 8]);
    world.setChargeAt(world.idx(220, 80), 200);
    world.activity.beginStep(world, interest);
    expect(world.activity.scheduled[11]).toBe(1);
  });
  it('sleeps settled water and wakes both sides of a broken chunk boundary', () => {
    const world = new World(192, 128);
    world.types[world.idx(63, 70)] = Cell.Water;
    world.types[world.idx(64, 70)] = Cell.Stone;
    world.activity.beginStep(world);
    expect(world.activity.activeChunks).toBe(1);
    for (let i = 0; i < 91; i++) world.activity.beginStep(world);
    expect(world.activity.activeChunks).toBe(0);
    const old = world.activity.versions[4];
    world.clearCell(64, 70);
    world.activity.beginStep(world);
    expect(world.activity.scheduled[3]).toBe(1);
    expect(world.activity.versions[4]).toBeGreaterThan(old);
  });

  it('keeps reactive material awake outside the camera interest region', () => {
    const world = new World(256, 128);
    Object.assign(world.simBounds, { x0: 0, y0: 0, x1: 64, y1: 64 });
    world.replaceCellAt(world.idx(220, 80), Cell.Fire, 0xff6622);
    for (let i = 0; i < 200; i++) world.activity.beginStep(world);
    expect(world.activity.scheduled[7]).toBe(1);
    expect(world.activity.bounds.x1).toBe(256);
  });

  it('tracks sparse growth separately and invalidates after bulk world replacement', () => {
    const world = new World(128, 128);
    const index = world.idx(20, 30);
    world.replaceCellAt(index, Cell.Moss, 0x446655);
    world.activity.beginStep(world);
    expect(world.activity.activeChunks).toBe(0);
    expect(world.activity.growthCells[0]).toEqual([index]);
    world.clear(); world.activity.beginStep(world);
    expect(world.activity.growthCells.flat()).toEqual([]);
  });
});
