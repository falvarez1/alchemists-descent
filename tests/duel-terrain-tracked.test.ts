import { describe, expect, it } from 'vitest';
import { TerrainReplicator, TERRAIN_SWEEP_CHUNKS } from '@/net/duel/TerrainReplicator';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { applyCellPatch } from '@/authoring/cellPatch';
import { reseedAllStreams, reseedTickStreams } from '@/core/simRandom';
import { buildLargeScene, makeSimCtx } from './fixtures/largeSimScene';

/** The first cell where the guest's planes differ from the host's, or -1. */
function firstDifference(host: World, guest: World): number {
  for (let i = 0; i < host.types.length; i++) {
    if (host.types[i] !== guest.types[i] || host.colors[i] !== guest.colors[i] || host.life[i] !== guest.life[i] || host.charge[i] !== guest.charge[i]) return i;
  }
  return -1;
}

describe('Duel terrain capture compares only what can have changed', () => {
  it('keeps a replica identical to a live simulation every tick while comparing a fraction of the grid', () => {
    const width = 320, height = 256, seed = 1234;
    const host = new World(width, height), guest = new World(width, height);
    buildLargeScene(host);
    host.simBounds.x0 = 0; host.simBounds.x1 = width; host.simBounds.y0 = 0; host.simBounds.y1 = height;
    reseedAllStreams(seed);
    const ctx = makeSimCtx(host, seed), sim = new Simulation(), writer = new TerrainReplicator();
    guest.clear();
    applyCellPatch(guest, writer.capture(host, true));
    let compared = 0, captures = 0;
    for (let tick = 1; tick <= 240; tick++) {
      ctx.state.frameCount = tick;
      reseedTickStreams(seed, tick);
      sim.processFrame(ctx);
      applyCellPatch(guest, writer.capture(host, false));
      expect(firstDifference(host, guest), `tick ${tick}`).toBe(-1);
      if (tick > 2) { compared += writer.compared; captures++; }
    }
    // Every chunk of this scene is busy every tick: the capture costs what a full comparison does, never more.
    expect(compared / captures).toBeLessThanOrEqual(width * height * 1.02);
  });

  it('compares a small fraction of a quiet stage with one fire burning on it', () => {
    const width = 640, height = 384, seed = 99;
    const host = new World(width, height), guest = new World(width, height);
    host.clear();
    for (let y = 330; y < height; y++) for (let x = 0; x < width; x++) host.types[host.idx(x, y)] = Cell.Stone;
    for (let y = 120; y < 130; y++) for (let x = 60; x < 260; x++) host.types[host.idx(x, y)] = Cell.Wall;
    for (let y = 320; y < 330; y++) for (let x = 150; x < 170; x++) host.types[host.idx(x, y)] = Cell.Oil;
    for (let x = 150; x < 170; x += 3) { host.types[host.idx(x, 319)] = Cell.Fire; host.life[host.idx(x, 319)] = 200; }
    host.activity.invalidateAll();
    host.simBounds.x0 = 0; host.simBounds.x1 = width; host.simBounds.y0 = 0; host.simBounds.y1 = height;
    reseedAllStreams(seed);
    const ctx = makeSimCtx(host, seed), sim = new Simulation(), writer = new TerrainReplicator();
    guest.clear();
    applyCellPatch(guest, writer.capture(host, true));
    let compared = 0, captures = 0;
    for (let tick = 1; tick <= 120; tick++) {
      ctx.state.frameCount = tick;
      reseedTickStreams(seed, tick);
      sim.processFrame(ctx);
      applyCellPatch(guest, writer.capture(host, false));
      expect(firstDifference(host, guest), `tick ${tick}`).toBe(-1);
      if (tick > 2) { compared += writer.compared; captures++; }
    }
    expect(compared / captures).toBeLessThan(width * height * 0.2);
  });

  it('sees tracked writes, in-place rewrites of live cells, charge, colour overrides and a discharge to zero', () => {
    const host = new World(256, 192), guest = new World(256, 192), writer = new TerrainReplicator();
    host.activity.beginStep(host);
    guest.clear();
    applyCellPatch(guest, writer.capture(host, true));
    const at = (x: number, y: number): number => host.idx(x, y);
    host.replaceCellAt(at(10, 10), Cell.Stone, 0x777777); // tracked: moves the chunk's version
    host.replaceCellAt(at(100, 50), Cell.Fire, 0xff0000);
    applyCellPatch(guest, writer.capture(host, false));
    expect(guest.types[at(10, 10)]).toBe(Cell.Stone);
    // A hot loop rewrites a live cell in place: no touch, no version change.
    host.colors[at(100, 50)] = 0xff8800; host.life[at(100, 50)] = 33;
    host.setChargeAt(at(200, 150), 500); // charge on an untouched empty cell
    host.colorOverrides.add(at(20, 20)); host.colors[at(20, 20)] = 0x112233;
    applyCellPatch(guest, writer.capture(host, false));
    expect([guest.colors[at(100, 50)], guest.life[at(100, 50)]]).toEqual([0xff8800, 33]);
    expect(guest.charge[at(200, 150)]).toBe(500);
    expect(guest.colors[at(20, 20)]).toBe(0x112233);
    host.setChargeAt(at(200, 150), 0);
    applyCellPatch(guest, writer.capture(host, false));
    expect(guest.charge[at(200, 150)]).toBe(0);
    expect(firstDifference(host, guest)).toBe(-1);
    expect(writer.capture(host, false).idxs).toHaveLength(0);
  });

  it('repairs an untracked write to a steady cell within one sweep of the world', () => {
    const host = new World(256, 192), guest = new World(256, 192), writer = new TerrainReplicator();
    host.activity.beginStep(host);
    guest.clear();
    applyCellPatch(guest, writer.capture(host, true));
    const i = host.idx(250, 190);
    host.types[i] = Cell.Wall; host.colors[i] = 0x445566; // raw, untracked
    const chunks = host.activity.columns * host.activity.rows;
    for (let n = 0; n < Math.ceil(chunks / TERRAIN_SWEEP_CHUNKS); n++) applyCellPatch(guest, writer.capture(host, false));
    expect([guest.types[i], guest.colors[i]]).toEqual([Cell.Wall, 0x445566]);
  });

  it('compares every cell before the activity grid is ready and after it is invalidated', () => {
    const host = new World(130, 70), guest = new World(130, 70), writer = new TerrainReplicator();
    applyCellPatch(guest, writer.capture(host, true));
    host.types[5] = Cell.Wall; // raw write, grid not ready
    applyCellPatch(guest, writer.capture(host, false));
    expect(guest.types[5]).toBe(Cell.Wall);
    host.activity.beginStep(host);
    writer.capture(host, false);
    host.activity.invalidateAll();
    host.colors[6] = 0x010203; // raw write to an empty cell after invalidation
    applyCellPatch(guest, writer.capture(host, false));
    expect(guest.colors[6]).toBe(0x010203);
  });
});
