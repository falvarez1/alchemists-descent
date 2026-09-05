import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import type { Ctx } from '@/core/types';
import { loadTerrainArt, prepareTerrainColors, terrainArtPixels } from '@/render/TerrainArt';

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(url));
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const terrain = (await blob.text()).includes('terrain-atlas');
    return { width: terrain ? 256 : 192, height: terrain ? 256 : 96, close() {} };
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    drawImage() {}, getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(100),
    }),
  }) }) });
  loadTerrainArt();
  await vi.waitFor(() => expect(terrainArtPixels()).not.toBeNull());
});
afterAll(() => vi.unstubAllGlobals());

function scene(world: World): Ctx {
  return { world, state: { mode: 'play', frameCount: 1, playtestSource: null },
    camera: { renderX: 0, renderY: 0 } } as unknown as Ctx;
}

describe('authoritative material presentation', () => {
  it('refreshes edits made to a paused world before its first simulation step', () => {
    const world = new World(128, 96), ctx = scene(world), index = world.idx(63, 40);
    world.replaceCellAt(index, Cell.Stone, 0x555555);
    expect(prepareTerrainColors(ctx)[index]).not.toBe(world.colors[index]);
    world.clearCellAt(index);
    expect(prepareTerrainColors(ctx)[index]).toBe(world.colors[index]);
  });

  it('moves a water surface without leaving bright interior bands across a chunk seam', () => {
    const world = new World(128, 128), ctx = scene(world);
    for (let y = 61; y < 70; y++) world.replaceCellAt(world.idx(63, y), Cell.Water, 0x123456);
    world.activity.beginStep(world);
    const first = prepareTerrainColors(ctx);
    const surface = first[world.idx(63, 61)], interior = first[world.idx(63, 64)];
    expect(surface).not.toBe(interior);
    for (let y = 61; y < 65; y++) world.clearCell(63, y);
    ctx.state.frameCount++;
    const drained = prepareTerrainColors(ctx);
    expect(drained[world.idx(63, 65)]).toBe(surface);
    expect(drained[world.idx(63, 66)]).toBe(interior);
    expect(drained[world.idx(63, 69)]).toBe(interior);
  });

  it('preserves saved color scars until the underlying cell is replaced', () => {
    const world = new World(128, 96), ctx = scene(world), index = world.idx(40, 40);
    world.replaceCellAt(index, Cell.Stone, 0x781223); world.colorOverrides.add(index);
    world.activity.beginStep(world);
    expect(prepareTerrainColors(ctx)[index]).toBe(0x781223);
    world.replaceCellAt(index, Cell.Stone, 0x555555);
    expect(prepareTerrainColors(ctx)[index]).not.toBe(0x781223);
  });
});
