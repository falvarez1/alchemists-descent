import { describe, expect, it } from 'vitest';

import { BIOMES } from '@/config/biomes';
import { Cell } from '@/sim/CellType';
import {
  biomeIndexFromId,
  createDefaultVirtualWorldDef,
  getDefaultPixelSceneLibrary,
  VIRTUAL_BIOME_IDS,
  VIRTUAL_SCENE_KINDS,
} from '@/world/virtual/defaults';
import { generateVirtualChunk, generateVirtualWindow } from '@/world/virtual/ChunkGenerator';
import { resolveTile, validateTileset } from '@/world/virtual/HerringboneTiles';
import { materializeChunks } from '@/world/virtual/WindowMaterializer';
import { fnv1aByteArrays, hashCoord } from '@/world/virtual/hash';
import { stampPixelScenes } from '@/world/virtual/PixelSceneStamper';
import { fromTransferableChunk, toTransferableChunk } from '@/world/virtual/transfer';
import type {
  HerringboneTileDef,
  HerringboneTilesetDef,
  PixelScenePlacementDef,
  VirtualSceneBudget,
  VirtualWorldDef,
} from '@/world/virtual/types';

function allPlaneHash(chunk: ReturnType<typeof generateVirtualChunk>): string {
  return fnv1aByteArrays([
    chunk.types,
    new Uint8Array(chunk.colors.buffer),
    new Uint8Array(chunk.life.buffer),
    chunk.charge,
  ]);
}

function openCellCount(types: Uint8Array): number {
  let open = 0;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === Cell.Empty) open++;
  }
  return open;
}

function countMaterials(types: Uint8Array, materials: readonly number[]): number {
  const set = new Set(materials);
  let count = 0;
  for (let i = 0; i < types.length; i++) {
    if (set.has(types[i])) count++;
  }
  return count;
}

function edgeColorsFor(seed: number, tx: number, ty: number): HerringboneTileDef['edges'] {
  return {
    n: desiredEdgeColor(hashCoord(seed, 'edge-h', tx, ty) % 4),
    s: desiredEdgeColor(hashCoord(seed, 'edge-h', tx, ty + 1) % 4),
    w: desiredEdgeColor(hashCoord(seed, 'edge-v', tx, ty) % 4),
    e: desiredEdgeColor(hashCoord(seed, 'edge-v', tx + 1, ty) % 4),
  };
}

function desiredEdgeColor(edgeBias: number): string {
  if (edgeBias <= 1) return 'open';
  if (edgeBias === 2) return 'narrow';
  return 'wall';
}

function oppositeEdges(edges: HerringboneTileDef['edges']): HerringboneTileDef['edges'] {
  return {
    n: edges.n === 'open' ? 'wall' : 'open',
    e: edges.e === 'open' ? 'wall' : 'open',
    s: edges.s === 'open' ? 'wall' : 'open',
    w: edges.w === 'open' ? 'wall' : 'open',
  };
}

describe('virtual world prototype', () => {
  it('generates deterministic chunks by seed and coordinate', () => {
    const def = createDefaultVirtualWorldDef(1234);
    const a = generateVirtualChunk(def, 0, 0);
    const b = generateVirtualChunk(def, 0, 0);

    expect(allPlaneHash(b)).toBe(allPlaneHash(a));
    expect(b.meta.hash).toBe(a.meta.hash);
  });

  it('changes chunk output when the seed changes', () => {
    const a = generateVirtualChunk(createDefaultVirtualWorldDef(1234), 0, 0);
    const b = generateVirtualChunk(createDefaultVirtualWorldDef(5678), 0, 0);

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
  });

  it('changes chunk output when organic shaping changes', () => {
    const plain = createDefaultVirtualWorldDef(2468);
    plain.generation.edgeRoughness = 0;
    plain.generation.pocketDensity = 0;
    plain.generation.crackDensity = 0;
    plain.generation.shapeWarp = 0;
    plain.generation.cornerRounding = 0;
    plain.generation.organicSmoothingPasses = 0;
    const organic = createDefaultVirtualWorldDef(2468);

    expect(allPlaneHash(generateVirtualChunk(organic, 0, 0))).not.toBe(allPlaneHash(generateVirtualChunk(plain, 0, 0)));
  });

  it('has a virtual material palette for every campaign biome', () => {
    const def = createDefaultVirtualWorldDef(4321);

    expect(new Set(VIRTUAL_BIOME_IDS)).toEqual(new Set(Object.keys(BIOMES)));
    for (const biome of VIRTUAL_BIOME_IDS) {
      expect(def.materialProfile.palettes[biome]).toBeTruthy();
      expect(def.materialProfile.palettes[biome].wall).not.toBe(0);
    }
  });

  it('has virtual dressing recipes for every campaign biome', () => {
    const def = createDefaultVirtualWorldDef(4321);

    expect(new Set(Object.keys(def.dressing.biomes))).toEqual(new Set(VIRTUAL_BIOME_IDS));
    for (const biome of VIRTUAL_BIOME_IDS) {
      const recipe = def.dressing.biomes[biome];
      expect(recipe.ore).toBeGreaterThan(0);
      expect(recipe.glowDensity).toBeGreaterThanOrEqual(0);
    }
  });

  it('ships scene budgets and a built-in pixel scene library for every scene kind', () => {
    const def = createDefaultVirtualWorldDef(4322);
    const sceneKinds = new Set(getDefaultPixelSceneLibrary().map((scene) => scene.kind));

    expect(sceneKinds).toEqual(new Set(VIRTUAL_SCENE_KINDS));
    expect(new Set(Object.keys(def.dressing.scenes.biomes))).toEqual(new Set(VIRTUAL_BIOME_IDS));
    for (const biome of VIRTUAL_BIOME_IDS) {
      for (const kind of VIRTUAL_SCENE_KINDS) {
        expect(Number.isFinite(def.dressing.scenes.biomes[biome][kind])).toBe(true);
      }
    }
  });

  it('uses the virtual biome map to change generated profile chunks', () => {
    const earthen = createDefaultVirtualWorldDef(8642);
    earthen.map.cells.fill(biomeIndexFromId('earthen'));
    const volcanic = createDefaultVirtualWorldDef(8642);
    volcanic.map.cells.fill(biomeIndexFromId('volcanic'));

    const a = generateVirtualChunk(earthen, 0, 0);
    const b = generateVirtualChunk(volcanic, 0, 0);

    expect(a.meta.biome).toBe('earthen');
    expect(b.meta.biome).toBe('volcanic');
    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
  });

  it('rounds cave silhouettes without collapsing open space', () => {
    const blocky = createDefaultVirtualWorldDef(13579);
    blocky.generation.baseCellSize = 3;
    blocky.generation.organicSmoothingPasses = 0;
    blocky.generation.cornerRounding = 0;
    blocky.generation.shapeWarp = 0.2;

    const rounded = createDefaultVirtualWorldDef(13579);
    rounded.generation.baseCellSize = 3;
    rounded.generation.organicSmoothingPasses = 0;
    rounded.generation.cornerRounding = 1;
    rounded.generation.shapeWarp = 0.2;

    const a = generateVirtualChunk(blocky, 0, 0);
    const b = generateVirtualChunk(rounded, 0, 0);
    const openDelta = Math.abs(openCellCount(a.types) - openCellCount(b.types)) / a.types.length;

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
    expect(openDelta).toBeLessThan(0.12);
  });

  it('applies tunable surface dressing to exposed terrain', () => {
    const bare = createDefaultVirtualWorldDef(97531);
    bare.generation.surfaceCover = 0;
    bare.generation.vegetationDensity = 0;
    const dressed = createDefaultVirtualWorldDef(97531);
    dressed.generation.surfaceCover = 1;
    dressed.generation.surfaceDepth = 3;
    dressed.generation.vegetationDensity = 1;

    const a = generateVirtualChunk(bare, 0, 4);
    const b = generateVirtualChunk(dressed, 0, 4);
    const surfaceCells = b.types.filter((type) => type === Cell.Moss || type === Cell.Fungus || type === Cell.Ice).length;

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
    expect(surfaceCells).toBeGreaterThan(80);
  });

  it('applies tunable rich biome dressing to chunks', () => {
    const bare = createDefaultVirtualWorldDef(97532);
    bare.map.cells.fill(biomeIndexFromId('earthen'));
    Object.assign(bare.dressing.controls, {
      detailDensity: 0,
      materialRichness: 0,
      liquidRichness: 0,
      glowDensity: 0,
      floorDebris: 0,
      hangingGrowth: 0,
    });

    const rich = createDefaultVirtualWorldDef(97532);
    rich.map.cells.fill(biomeIndexFromId('earthen'));
    Object.assign(rich.dressing.controls, {
      detailDensity: 2,
      materialRichness: 2,
      liquidRichness: 2,
      glowDensity: 2,
      floorDebris: 2,
      hangingGrowth: 2,
    });

    const a = generateVirtualChunk(bare, 0, 2);
    const b = generateVirtualChunk(rich, 0, 2);
    const richCells = countMaterials(b.types, [Cell.Gold, Cell.Coal, Cell.Glowshroom, Cell.Vines, Cell.Water]);

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
    expect(richCells).toBeGreaterThan(20);
  });

  it('uses biome-specific dressing recipes for material signatures', () => {
    const fungal = createDefaultVirtualWorldDef(86420);
    fungal.map.cells.fill(biomeIndexFromId('fungal'));
    const frozen = createDefaultVirtualWorldDef(86420);
    frozen.map.cells.fill(biomeIndexFromId('frozen'));

    const a = generateVirtualChunk(fungal, 0, 0);
    const b = generateVirtualChunk(frozen, 0, 0);
    const fungalSignature = countMaterials(a.types, [Cell.Fungus, Cell.Glowshroom, Cell.Toxic, Cell.Vines]);
    const frozenSignature = countMaterials(b.types, [Cell.Ice, Cell.Snow, Cell.Crystal, Cell.Nitrogen]);

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
    expect(fungalSignature).toBeGreaterThan(40);
    expect(frozenSignature).toBeGreaterThan(40);
  });

  it('handles negative chunk coordinates deterministically', () => {
    const def = createDefaultVirtualWorldDef(99);
    const a = generateVirtualChunk(def, -2, 3);
    const b = generateVirtualChunk(def, -2, 3);

    expect(a.originX).toBe(-512);
    expect(a.originY).toBe(768);
    expect(allPlaneHash(b)).toBe(allPlaneHash(a));
  });

  it('produces identical chunks whether generated alone or inside a window', () => {
    const def = createDefaultVirtualWorldDef(4242);
    const alone = generateVirtualChunk(def, 1, -1);
    const window = generateVirtualWindow(def, -1, -1, 1, 1).find((chunk) => chunk.cx === 1 && chunk.cy === -1);

    expect(window).toBeTruthy();
    expect(allPlaneHash(window!)).toBe(allPlaneHash(alone));
  });

  it('is stable when the same world area is generated at a larger chunk size', () => {
    const tiled = createDefaultVirtualWorldDef(246813);
    const wide = createDefaultVirtualWorldDef(246813);
    wide.chunkSize = tiled.chunkSize * 2;

    const tiledWorld = materializeChunks(generateVirtualWindow(tiled, 0, 0, 1, 1)).world;
    const wideChunk = generateVirtualChunk(wide, 0, 0);

    expect(tiledWorld.width).toBe(wideChunk.size);
    expect(tiledWorld.height).toBe(wideChunk.size);
    expect(tiledWorld.types).toEqual(wideChunk.types);
    expect(tiledWorld.colors).toEqual(wideChunk.colors);
  });

  it('does not artificially seal horizontal chunk seams', () => {
    const def = createDefaultVirtualWorldDef(777);
    const left = generateVirtualChunk(def, 0, 0);
    const right = generateVirtualChunk(def, 1, 0);
    const xL = left.size - 1;
    let openTouches = 0;

    for (let y = 0; y < left.size; y++) {
      const li = xL + y * left.size;
      const ri = y * right.size;
      if (left.types[li] === Cell.Empty || right.types[ri] === Cell.Empty) openTouches++;
    }
    expect(openTouches).toBeGreaterThan(12);
  });

  it('does not artificially seal vertical chunk seams', () => {
    const def = createDefaultVirtualWorldDef(888);
    const top = generateVirtualChunk(def, 0, 0);
    const bottom = generateVirtualChunk(def, 0, 1);
    const yT = top.size - 1;
    let openTouches = 0;

    for (let x = 0; x < top.size; x++) {
      const ti = x + yT * top.size;
      const bi = x;
      if (top.types[ti] === Cell.Empty || bottom.types[bi] === Cell.Empty) openTouches++;
    }
    expect(openTouches).toBeGreaterThan(12);
  });

  it('stamps the default boundary pixel scene across all four neighboring chunks', () => {
    const def = createDefaultVirtualWorldDef(31337);
    const chunks = [
      generateVirtualChunk(def, 0, 0),
      generateVirtualChunk(def, 1, 0),
      generateVirtualChunk(def, 0, 1),
      generateVirtualChunk(def, 1, 1),
    ];

    for (const chunk of chunks) {
      expect(chunk.meta.scenes).toContain('boundary-ruin-0');
      expect(chunk.meta.scenePlacements.map((placement) => placement.id)).toContain('boundary-ruin-0');
      expect(chunk.types.some((type) => type === Cell.Stone)).toBe(true);
    }

    const materialized = materializeChunks(chunks);

    const boundaryObjects = materialized.sceneObjects.filter((object) => object.id.startsWith('boundary-ruin-0:'));
    const boundaryLights = materialized.sceneLights.filter((light) => light.id.startsWith('boundary-ruin-0:'));

    expect(boundaryObjects).toHaveLength(1);
    expect(boundaryObjects[0]).toMatchObject({
      id: 'boundary-ruin-0:ruin-waystone',
      kind: 'waystone',
      x: 264,
      y: 274,
    });
    expect(boundaryLights).toHaveLength(1);
    expect(boundaryLights[0]).toMatchObject({
      id: 'boundary-ruin-0:ruin-glow',
      x: 264,
      y: 264,
      color: '#f6c76d',
    });
  });

  it('uses tile scene slots and biome budgets to stamp generated pixel scenes', () => {
    const def = createDefaultVirtualWorldDef(60606);
    def.pixelScenes = [];
    def.map.cells.fill(biomeIndexFromId('volcanic'));
    def.tileset = {
      v: 1,
      tileSize: 64,
      constraints: {
        edgeColors: ['open'],
        vertexColors: ['solid'],
      },
      tiles: [
        {
          id: 'lava-slot-h',
          orientation: 'horizontal',
          biomeTags: ['volcanic'],
          weight: 1,
          edges: { n: 'open', e: 'open', s: 'open', w: 'open' },
          vertices: { nw: 'solid', ne: 'solid', se: 'solid', sw: 'solid' },
          carve: [{ kind: 'chamber', x: 0.5, y: 0.5, rx: 30, ry: 22 }],
          sceneSlots: [{ id: 'lava-feature', x: 0.5, y: 0.5, tags: ['lavaVents'] }],
        },
        {
          id: 'lava-slot-v',
          orientation: 'vertical',
          biomeTags: ['volcanic'],
          weight: 1,
          edges: { n: 'open', e: 'open', s: 'open', w: 'open' },
          vertices: { nw: 'solid', ne: 'solid', se: 'solid', sw: 'solid' },
          carve: [{ kind: 'chamber', x: 0.5, y: 0.5, rx: 22, ry: 30 }],
          sceneSlots: [{ id: 'lava-feature', x: 0.5, y: 0.5, tags: ['lavaVents'] }],
        },
      ],
    };
    def.dressing.scenes.controls.density = 2;
    def.dressing.scenes.controls.maxPerTile = 4;
    const volcanicBudget = def.dressing.scenes.biomes.volcanic as VirtualSceneBudget;
    for (const kind of VIRTUAL_SCENE_KINDS) volcanicBudget[kind] = kind === 'lavaVents' ? 2 : 0;

    const chunks = generateVirtualWindow(def, -1, -1, 1, 1);
    const generated = chunks.flatMap((chunk) =>
      chunk.meta.scenePlacements.filter((placement) => placement.id.includes('scene-lava-vent')),
    );

    expect(generated.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => chunk.types.some((type) => type === Cell.Lava))).toBe(true);
  });

  it('lets masked pixel scenes carve explicit empty cells without treating all empty pixels as writes', () => {
    const types = new Uint8Array(16).fill(Cell.Wall);
    const colors = new Uint32Array(16).fill(0x222222);
    const life = new Int16Array(16);
    const charge = new Uint8Array(16);
    const material = new Uint8Array(4);
    material[0] = Cell.Empty;
    material[1] = Cell.Wood;
    material[2] = Cell.Empty;
    material[3] = Cell.Wood;
    const colorOverrides = new Uint32Array(4);
    colorOverrides[1] = 0x6a4426;
    colorOverrides[3] = 0x997755;
    const sceneLife = new Int16Array([0, 120, 0, 240]);
    const sceneCharge = new Uint8Array([0, 7, 0, 9]);
    const mask = new Uint8Array([1, 1, 0, 0]);
    const placements: PixelScenePlacementDef[] = [
      {
        id: 'masked-carve',
        x: 1,
        y: 1,
        priority: 0,
        scene: {
          v: 1,
          id: 'masked-scene',
          name: 'Masked Scene',
          w: 2,
          h: 2,
          mask,
          material,
          colorOverrides,
          life: sceneLife,
          charge: sceneCharge,
          objects: [],
          links: [],
          lights: [],
        },
      },
    ];

    stampPixelScenes({ originX: 0, originY: 0, size: 4, types, colors, life, charge }, placements);

    expect(types[1 + 1 * 4]).toBe(Cell.Empty);
    expect(types[2 + 1 * 4]).toBe(Cell.Wood);
    expect(colors[2 + 1 * 4]).toBe(0x6a4426);
    expect(life[2 + 1 * 4]).toBe(120);
    expect(charge[2 + 1 * 4]).toBe(7);
    expect(types[1 + 2 * 4]).toBe(Cell.Wall);
    expect(types[2 + 2 * 4]).toBe(Cell.Wall);
    expect(life[2 + 2 * 4]).toBe(0);
    expect(charge[2 + 2 * 4]).toBe(0);
  });

  it('keeps default volcanic liquid hazard dressing within a bounded budget', () => {
    const def = createDefaultVirtualWorldDef(9090);
    def.map.cells.fill(biomeIndexFromId('volcanic'));
    const chunks = generateVirtualWindow(def, -1, -1, 1, 1);
    const lava = chunks.reduce((sum, chunk) => sum + countMaterials(chunk.types, [Cell.Lava]), 0);

    expect(lava).toBeGreaterThan(20);
    expect(lava).toBeLessThan(3000);
  });

  it('normalizes stale virtual defs before chunk generation', () => {
    const stale = createDefaultVirtualWorldDef(12345) as VirtualWorldDef & {
      generation?: Partial<VirtualWorldDef['generation']>;
      dressing?: Partial<VirtualWorldDef['dressing']>;
      pixelScenes?: PixelScenePlacementDef[];
    };
    delete stale.generation;
    delete stale.pixelScenes;
    stale.dressing = {
      controls: { detailDensity: 1 } as Partial<VirtualWorldDef['dressing']['controls']>,
      biomes: {
        earthen: { ore: Cell.Gold } as Partial<VirtualWorldDef['dressing']['biomes']['earthen']>,
      } as Partial<VirtualWorldDef['dressing']['biomes']>,
      scenes: {
        controls: {
          density: 1.5,
          maxPerChunk: 3,
        } as Partial<VirtualWorldDef['dressing']['scenes']['controls']> & { maxPerChunk: number },
        biomes: {
          earthen: { shrines: 1.2 } as Partial<VirtualSceneBudget>,
        } as Partial<VirtualWorldDef['dressing']['scenes']['biomes']>,
      } as Partial<VirtualWorldDef['dressing']['scenes']>,
    };

    const chunk = generateVirtualChunk(stale, 0, 0);

    expect(chunk.types.length).toBe(stale.chunkSize * stale.chunkSize);
    expect(stale.generation.halo).toBe(32);
    expect(stale.dressing.biomes.earthen.glow).toBeGreaterThan(0);
    expect(stale.pixelScenes).toEqual([]);
    expect(stale.dressing.scenes.controls.maxPerTile).toBe(3);
    expect(stale.dressing.scenes.biomes.earthen.shrines).toBe(1.2);
    expect(stale.dressing.scenes.biomes.earthen.collapsedShafts).toBeGreaterThanOrEqual(0);
  });

  it('materializes a rectangular chunk window into a normal World instance', () => {
    const def = createDefaultVirtualWorldDef(5150);
    const chunks = generateVirtualWindow(def, 0, 0, 1, 1);
    const materialized = materializeChunks(chunks);

    expect(materialized.originX).toBe(0);
    expect(materialized.originY).toBe(0);
    expect(materialized.world.width).toBe(def.chunkSize * 2);
    expect(materialized.world.height).toBe(def.chunkSize * 2);
    expect(materialized.world.simBounds).toEqual({ x0: 0, x1: def.chunkSize * 2, y0: 0, y1: def.chunkSize * 2 });
    expect(materialized.chunks.length).toBe(4);
    expect(materialized.world.types[0]).toBe(chunks[0].types[0]);
  });

  it('rejects sparse virtual materialization windows', () => {
    const def = createDefaultVirtualWorldDef(5151);
    const chunks = generateVirtualWindow(def, 0, 0, 1, 1).filter((chunk) => chunk.cx !== 1 || chunk.cy !== 1);

    expect(() => materializeChunks(chunks)).toThrow(/sparse chunk window/);
  });

  it('serializes only requested chunk planes for worker transfer', () => {
    const def = createDefaultVirtualWorldDef(123);
    const source = generateVirtualChunk(def, 0, 0);
    const { chunk } = toTransferableChunk(source, ['types', 'previewRgba']);

    expect(chunk.types).toBeTruthy();
    expect(chunk.previewRgba).toBeTruthy();
    expect(chunk.colors).toBeUndefined();
    expect(chunk.life).toBeUndefined();
    expect(chunk.charge).toBeUndefined();
    expect(chunk.metrics.generatedBytes).toBe(source.types.byteLength + source.colors.byteLength + source.life.byteLength + source.charge.byteLength);
    expect(chunk.metrics.transferBytes).toBe(source.types.byteLength + source.size * source.size * 4);

    const restored = fromTransferableChunk(chunk);
    expect(restored.types.length).toBe(def.chunkSize * def.chunkSize);
    expect(restored.colors.length).toBe(def.chunkSize * def.chunkSize);
  });

  it('ships a valid minimal herringbone tileset', () => {
    const def = createDefaultVirtualWorldDef(1);
    const issues = validateTileset(def.tileset).filter((issue) => issue.severity === 'error');

    expect(issues).toEqual([]);
  });

  it('constrains herringbone resolution to the best edge signature match before weighting', () => {
    const seed = 424242;
    const tx = 8;
    const ty = 4;
    const matchedEdges = edgeColorsFor(seed, tx, ty);
    const mismatchedEdges = oppositeEdges(matchedEdges);
    const tile = (
      id: string,
      edges: HerringboneTileDef['edges'],
      weight: number,
    ): HerringboneTileDef => ({
      id,
      orientation: 'horizontal',
      biomeTags: ['earthen'],
      weight,
      edges,
      vertices: { nw: 'solid', ne: 'solid', se: 'solid', sw: 'solid' },
      carve: [],
      sceneSlots: [],
    });
    const tileset: HerringboneTilesetDef = {
      v: 1,
      tileSize: 32,
      constraints: {
        edgeColors: ['open', 'narrow', 'wall'],
        vertexColors: ['solid'],
      },
      tiles: [
        tile('matched-low-weight', matchedEdges, 0.001),
        tile('mismatched-heavy', mismatchedEdges, 10_000),
      ],
    };

    expect(resolveTile(tileset, seed, tx, ty, 'earthen').tile.id).toBe('matched-low-weight');
  });
});
