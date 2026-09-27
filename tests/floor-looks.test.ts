import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { FLOOR_LOOKS, crownReach, masonryPanel } from '@/config/floorLooks';
import type { BiomeId } from '@/core/types';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { loadTerrainArt, terrainAlbedo, terrainArtPixels } from '@/render/TerrainArt';
import { TerrainArtPlane } from '@/render/terrainArtPlane';

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(url));
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const terrain = (await blob.text()).includes('terrain-atlas');
    return { width: terrain ? 256 : 192, height: terrain ? 256 : 96, close() {} };
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    drawImage() {}, getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).map((_, i) => (i * 7) & 255),
    }),
  }) }) });
  loadTerrainArt();
  await vi.waitFor(() => expect(terrainArtPixels()).not.toBeNull());
});
afterAll(() => vi.unstubAllGlobals());

describe('floor looks', () => {
  it('keeps the hand-built Works on the atlas identity', () => {
    const d1 = FLOOR_LOOKS.earthen;
    expect(d1.gain).toEqual([1.28, 1.28, 1.28]);
    expect(d1.lift).toEqual([15, 20, 21]);
    expect(d1.lip).toEqual([115, 111, 94]);
    expect(d1.crownStrength).toBe(0);
    expect(d1.masonryPanels).toBe(16);
    expect(d1.backdropMul).toEqual([1, 1, 1]);
    expect(d1.backdropMirror).toBe(false);
  });

  it('gives the spine floors distinct grades within the shader limits', () => {
    const spine: BiomeId[] = ['earthen', 'fungal', 'flooded', 'volcanic'];
    const grades = new Set(spine.map((biome) => FLOOR_LOOKS[biome].gain.join(',') + FLOOR_LOOKS[biome].backdropMul.join(',')));
    expect(grades.size).toBe(spine.length);
    for (const look of Object.values(FLOOR_LOOKS)) {
      expect(look.crownDepth).toBeLessThanOrEqual(3); // the renderer's dirty halo covers three cells
      expect(look.masonryPanels).toBeGreaterThanOrEqual(0);
      expect(look.masonryPanels).toBeLessThanOrEqual(16);
      expect(look.epigraph.length).toBeGreaterThan(0);
    }
  });

  it('draws the same masonry panels for a given layout, with the requested share', () => {
    let masonry = 0;
    for (let py = 0; py < 16; py++) for (let px = 0; px < 25; px++) if (masonryPanel(px, py, 5)) masonry++;
    expect(masonry / 400).toBeGreaterThan(0.2);
    expect(masonry / 400).toBeLessThan(0.45);
    expect(masonryPanel(3, 4, 16)).toBe(true);
    expect(masonryPanel(-1, 0, 5)).toBe(masonryPanel(-1, 0, 5));
    for (let x = 0; x < 64; x++) {
      expect(crownReach(x, 3)).toBeGreaterThanOrEqual(1);
      expect(crownReach(x, 3)).toBeLessThanOrEqual(3);
    }
  });
});

describe('floor-graded terrain albedo', () => {
  /** The pre-floor-look sampler, verbatim, for the D1 identity check. */
  function shippedAlbedo(world: World, index: number, x: number, y: number): number {
    const terrain = terrainArtPixels()!;
    const type = world.types[index];
    const rock = type === Cell.Stone && y > 810;
    const tileX = type === Cell.Metal || rock ? 128 : 0;
    const tileY = type === Cell.Wood || rock ? 128 : 0;
    const offset = ((tileY + (y & 127)) * 256 + tileX + (x & 127)) * 4;
    let r = terrain[offset] * 1.28 + 15, g = terrain[offset + 1] * 1.28 + 20, b = terrain[offset + 2] * 1.28 + 21;
    const blocks = (t: number): boolean => t === Cell.Wall || t === Cell.Stone || t === Cell.Wood || t === Cell.Metal;
    const top = y > 0 && !blocks(world.types[index - world.width]);
    const left = x > 0 && !blocks(world.types[index - 1]);
    const bottom = y + 1 < world.height && !blocks(world.types[index + world.width]);
    if (top || left) {
      const chip = ((x * 17 + y * 29) & 7) < 2 ? 0.76 : 1;
      r = r * 0.55 + 115 * chip; g = g * 0.55 + 111 * chip; b = b * 0.55 + 94 * chip;
    } else if (bottom) { r *= 0.62; g *= 0.62; b *= 0.67; }
    return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
  }

  function slab(): World {
    const world = new World(200, 140);
    for (let y = 40; y < 120; y++) for (let x = 10; x < 190; x++) {
      world.types[world.idx(x, y)] = (x + y) % 17 === 0 ? Cell.Stone : x > 150 ? Cell.Wood : Cell.Wall;
    }
    return world;
  }

  it('reproduces the shipped D1 sampler exactly under the earthen look', () => {
    const world = slab();
    for (let y = 38; y < 122; y += 3) for (let x = 8; x < 192; x += 5) {
      const i = world.idx(x, y);
      if (world.types[i] === Cell.Empty) continue;
      expect(terrainAlbedo(world, i, x, y, true, FLOOR_LOOKS.earthen)).toBe(shippedAlbedo(world, i, x, y));
    }
  });

  it('grades the same cells differently on each spine floor', () => {
    const world = slab();
    const i = world.idx(60, 80);
    const seen = new Set(['earthen', 'fungal', 'flooded', 'volcanic'].map((biome) =>
      terrainAlbedo(world, i, 60, 80, true, FLOOR_LOOKS[biome as BiomeId])));
    expect(seen.size).toBe(4);
  });

  it('keeps the Works on the classic sampler even when an art plane exists', () => {
    const world = slab();
    const plane = new TerrainArtPlane(world, { builtRun: 24, lining: 8, zones: [] });
    for (let y = 38; y < 122; y += 3) for (let x = 8; x < 192; x += 5) {
      const i = world.idx(x, y);
      if (world.types[i] === Cell.Empty) continue;
      expect(terrainAlbedo(world, i, x, y, true, FLOOR_LOOKS.earthen, plane)).toBe(shippedAlbedo(world, i, x, y));
    }
  });

  it('still honours colour scars over any floor grade', () => {
    const world = slab();
    const i = world.idx(60, 80);
    world.colors[i] = 0x781223; world.colorOverrides.add(i);
    expect(terrainAlbedo(world, i, 60, 80, true, FLOOR_LOOKS.fungal)).toBe(0x781223);
  });
});

describe('shape-aware floor looks', () => {
  const luma = (c: number): number => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;

  /** Wall below row 60 with a long straight floor; a 45° rise on the right. */
  function cave(): World {
    const world = new World(256, 192);
    for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
      if (y >= 60 || (x >= 160 && y >= 60 - (x - 160))) world.types[world.idx(x, y)] = Cell.Wall;
    }
    return world;
  }

  it('gives every spine floor below the Works a natural look, and the Works none', () => {
    expect(FLOOR_LOOKS.earthen.natural).toBeNull();
    const tiles = new Set<number>();
    for (const biome of ['fungal', 'flooded', 'volcanic'] as BiomeId[]) {
      const natural = FLOOR_LOOKS[biome].natural;
      expect(natural).not.toBeNull();
      tiles.add(natural!.tile);
      expect(natural!.contact).toBeGreaterThan(0);
      expect(natural!.contact).toBeLessThan(1);
      expect(natural!.backdropSat).toBeLessThan(1);
    }
    expect(tiles.size).toBe(3);
  });

  it('dresses built faces in masonry and the cave in the floor rock, and sinks cores', () => {
    const world = cave();
    for (const biome of ['fungal', 'flooded', 'volcanic'] as BiomeId[]) {
      const look = FLOOR_LOOKS[biome], natural = look.natural!;
      const plane = new TerrainArtPlane(world, { builtRun: natural.builtRun > 30 ? 30 : natural.builtRun, lining: natural.lining, zones: [] });
      // Built (straight floor lining) vs natural (the diagonal rise) come from different kits.
      const builtCell = world.idx(40, 62), rockCell = world.idx(200, 24);
      expect(plane.data[builtCell] & 0x40).toBe(0x40);
      expect(plane.data[rockCell] & 0x40).toBe(0);
      // A core cell is darker than the same material near its face.
      const near = terrainAlbedo(world, world.idx(40, 64), 40, 64, true, look, plane);
      const core = terrainAlbedo(world, world.idx(40, 150), 40, 150, true, look, plane);
      expect(luma(core)).toBeLessThan(luma(near));
      // The backdrop right against a face carries the darkest contact shade.
      const air = terrainAlbedo(world, world.idx(40, 59), 40, 59, true, look, plane);
      expect(air >> 16).toBe(Math.round(natural.contact * 255));
      const far = terrainAlbedo(world, world.idx(40, 20), 40, 20, true, look, plane);
      expect(far >> 16).toBe(255);
    }
  });
});
