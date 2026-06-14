import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type {
  HerringboneTileDef,
  HerringboneTilesetDef,
  PixelSceneDef,
  PixelScenePlacementDef,
  VirtualBiomeId,
  VirtualMaterialProfile,
  VirtualWorldDef,
} from '@/world/virtual/types';
import {
  VIRTUAL_BIOME_CHUNK_SIZE,
  VIRTUAL_CHUNK_SIZE,
  VIRTUAL_TILE_SIZE,
} from '@/world/virtual/types';

const BIOME_IDS: VirtualBiomeId[] = ['earthen', 'fungal', 'frozen'];

export function createDefaultVirtualWorldDef(seed = 0x4e4f4954): VirtualWorldDef {
  const map = createDefaultBiomeMap();
  return {
    v: 1,
    id: 'prototype-virtual-world',
    name: 'Prototype Virtual World',
    seed: seed >>> 0,
    chunkSize: VIRTUAL_CHUNK_SIZE,
    biomeChunkSize: VIRTUAL_BIOME_CHUNK_SIZE,
    herringboneCellSize: VIRTUAL_TILE_SIZE,
    map,
    tileset: createDefaultHerringboneTileset(),
    pixelScenes: createDefaultPixelScenePlacements(),
    materialProfile: createDefaultMaterialProfile(),
    generation: {
      halo: 32,
      smoothingPasses: 1,
      noiseScale: 0.035,
      noiseThreshold: 0.54,
      borderSeal: 2,
      edgeRoughness: 0.38,
      pocketDensity: 0.3,
      crackDensity: 0.2,
    },
  };
}

function createDefaultBiomeMap(): VirtualWorldDef['map'] {
  const widthChunks = 24;
  const heightChunks = 24;
  const cells = new Uint8Array(widthChunks * heightChunks);
  for (let y = 0; y < heightChunks; y++) {
    for (let x = 0; x < widthChunks; x++) {
      let biome = 0;
      if (y > 14 || (y > 10 && x < 8)) biome = 1;
      if (y < 6 || (y < 10 && x > 15)) biome = 2;
      cells[x + y * widthChunks] = biome;
    }
  }
  return {
    widthChunks,
    heightChunks,
    originChunkX: Math.floor(widthChunks / 2),
    originChunkY: 4,
    cells,
  };
}

export function biomeIdFromIndex(index: number): VirtualBiomeId {
  return BIOME_IDS[index] ?? 'earthen';
}

export function biomeIndexFromId(id: VirtualBiomeId): number {
  const index = BIOME_IDS.indexOf(id);
  return index >= 0 ? index : 0;
}

function createDefaultMaterialProfile(): VirtualMaterialProfile {
  return {
    palettes: {
      earthen: {
        wall: packRGB(67, 57, 48),
        accent: packRGB(92, 70, 44),
        crown: packRGB(48, 118, 40),
        deep: packRGB(27, 30, 34),
      },
      fungal: {
        wall: packRGB(50, 62, 54),
        accent: packRGB(60, 98, 72),
        crown: packRGB(60, 150, 112),
        deep: packRGB(22, 30, 30),
      },
      frozen: {
        wall: packRGB(62, 76, 92),
        accent: packRGB(102, 130, 150),
        crown: packRGB(162, 205, 226),
        deep: packRGB(28, 34, 46),
      },
    },
  };
}

function createDefaultHerringboneTileset(): HerringboneTilesetDef {
  const mk = (
    id: string,
    orientation: HerringboneTileDef['orientation'],
    edges: HerringboneTileDef['edges'],
    carve: HerringboneTileDef['carve'],
    biomeTags: VirtualBiomeId[] = ['earthen', 'fungal', 'frozen'],
    weight = 1,
  ): HerringboneTileDef => ({
    id,
    orientation,
    biomeTags,
    weight,
    edges,
    vertices: { nw: 'solid', ne: 'junction', se: 'solid', sw: 'junction' },
    carve,
    sceneSlots: [],
  });

  const open = { n: 'wall', e: 'open', s: 'wall', w: 'open' };
  const vertical = { n: 'open', e: 'wall', s: 'open', w: 'wall' };
  const cross = { n: 'open', e: 'open', s: 'open', w: 'open' };
  const drop = { n: 'narrow', e: 'wall', s: 'open', w: 'wall' };

  return {
    v: 1,
    tileSize: VIRTUAL_TILE_SIZE,
    constraints: {
      edgeColors: ['open', 'narrow', 'wall', 'drop'],
      vertexColors: ['solid', 'junction', 'void'],
    },
    tiles: [
      mk('h-open-a', 'horizontal', open, [
        { kind: 'spline', from: 'w', to: 'e', radius: 15, jitter: 14 },
        { kind: 'chamber', x: 0.5, y: 0.52, rx: 34, ry: 22 },
      ]),
      mk('h-open-b', 'horizontal', open, [
        { kind: 'spline', from: 'w', to: 'e', radius: 12, jitter: 28 },
        { kind: 'chamber', x: 0.32, y: 0.45, rx: 22, ry: 17 },
      ]),
      mk('h-fungal', 'horizontal', open, [
        { kind: 'spline', from: 'w', to: 'e', radius: 18, jitter: 20 },
        { kind: 'chamber', x: 0.67, y: 0.58, rx: 42, ry: 32 },
      ], ['fungal'], 1.5),
      mk('v-open-a', 'vertical', vertical, [
        { kind: 'spline', from: 'n', to: 's', radius: 14, jitter: 18 },
        { kind: 'chamber', x: 0.45, y: 0.62, rx: 20, ry: 34 },
      ]),
      mk('v-open-b', 'vertical', vertical, [
        { kind: 'spline', from: 'n', to: 's', radius: 11, jitter: 26 },
        { kind: 'shaft', x: 0.56, radius: 9, roughness: 0.45 },
      ]),
      mk('cross-a', 'horizontal', cross, [
        { kind: 'spline', from: 'w', to: 'e', radius: 12, jitter: 12 },
        { kind: 'spline', from: 'n', to: 's', radius: 10, jitter: 16 },
        { kind: 'chamber', x: 0.5, y: 0.5, rx: 28, ry: 28 },
      ], ['earthen', 'fungal'], 0.7),
      mk('drop-a', 'vertical', drop, [
        { kind: 'spline', from: 'n', to: 's', radius: 10, jitter: 14 },
        { kind: 'chamber', x: 0.5, y: 0.78, rx: 24, ry: 18 },
      ], ['frozen', 'earthen'], 0.8),
    ],
  };
}

function createDefaultPixelScenePlacements(): PixelScenePlacementDef[] {
  return [
    {
      id: 'boundary-ruin-0',
      scene: createBoundaryRuinScene(),
      x: VIRTUAL_CHUNK_SIZE - 38,
      y: VIRTUAL_CHUNK_SIZE - 30,
      priority: 10,
    },
  ];
}

function createBoundaryRuinScene(): PixelSceneDef {
  const w = 92;
  const h = 60;
  const material = new Uint8Array(w * h);
  const colorOverrides = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      const base = y >= h - 9 && x > 4 && x < w - 5;
      const leftPillar = x >= 12 && x <= 17 && y >= 17;
      const rightPillar = x >= w - 18 && x <= w - 13 && y >= 17;
      const arch = y >= 13 && y <= 18 && x >= 14 && x <= w - 15;
      if (!base && !leftPillar && !rightPillar && !arch) continue;
      material[i] = Cell.Stone;
      const chip = (x * 17 + y * 31) % 18;
      colorOverrides[i] = packRGB(80 + chip, 76 + Math.floor(chip / 2), 74 + Math.floor(chip / 3));
    }
  }
  return {
    v: 1,
    id: 'scene-boundary-ruin',
    name: 'Boundary Ruin',
    w,
    h,
    material,
    colorOverrides,
    objects: [],
    links: [],
    lights: [],
  };
}
