import { BIOMES } from '@/config/biomes';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type {
  HerringboneTileDef,
  HerringboneTilesetDef,
  PixelSceneDef,
  PixelScenePlacementDef,
  VirtualBiomeId,
  VirtualMaterialPalette,
  VirtualMaterialProfile,
  VirtualWorldDef,
} from '@/world/virtual/types';
import {
  VIRTUAL_BIOME_CHUNK_SIZE,
  VIRTUAL_CHUNK_SIZE,
  VIRTUAL_TILE_SIZE,
} from '@/world/virtual/types';

export const VIRTUAL_BIOME_IDS: VirtualBiomeId[] = [
  'earthen',
  'fungal',
  'frozen',
  'flooded',
  'timber',
  'crystal',
  'scorched',
  'volcanic',
  'gilded',
];

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
      baseCellSize: 3,
      smoothingPasses: 1,
      organicSmoothingPasses: 0,
      noiseScale: 0.035,
      noiseThreshold: 0.54,
      borderSeal: 2,
      shapeWarp: 0.32,
      cornerRounding: 0.56,
      surfaceCover: 0.64,
      surfaceDepth: 2,
      vegetationDensity: 0.38,
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
  return VIRTUAL_BIOME_IDS[index] ?? 'earthen';
}

export function biomeIndexFromId(id: VirtualBiomeId): number {
  const index = VIRTUAL_BIOME_IDS.indexOf(id);
  return index >= 0 ? index : 0;
}

function createDefaultMaterialProfile(): VirtualMaterialProfile {
  const palettes = Object.fromEntries(
    VIRTUAL_BIOME_IDS.map((id) => [id, materialPaletteForBiome(id)]),
  ) as Record<VirtualBiomeId, VirtualMaterialPalette>;
  return { palettes };
}

function materialPaletteForBiome(id: VirtualBiomeId): VirtualMaterialPalette {
  const biome = BIOMES[id];
  const wall = biome.bands[0] ?? [110, 100, 90];
  const mid = biome.bands[1] ?? wall;
  const accent = biome.bands[2] ?? mid;
  const bright = biome.bands[3] ?? accent;
  return {
    wall: packScaled(wall, 0.52),
    accent: packScaled(mixRgb(mid, accent, 0.58), 0.62),
    crown: packScaled(crownRgb(id, bright), 0.82),
    deep: packScaled(mixRgb(wall, [8, 8, 12], 0.58), 0.46),
  };
}

function crownRgb(id: VirtualBiomeId, bright: [number, number, number]): [number, number, number] {
  const crown = BIOMES[id].crown;
  if (id === 'fungal') return mixRgb(bright, [62, 176, 126], 0.66);
  if (id === 'timber') return mixRgb(bright, [96, 146, 64], 0.56);
  if (id === 'flooded') return mixRgb(bright, [56, 128, 100], 0.6);
  if (id === 'gilded') return mixRgb(bright, [188, 144, 64], 0.72);
  if (crown === 'frost') return mixRgb(bright, [168, 216, 238], 0.62);
  if (crown === 'ember') return mixRgb(bright, [190, 88, 34], 0.66);
  return mixRgb(bright, [54, 138, 48], 0.58);
}

function packScaled(rgb: [number, number, number], k: number): number {
  return packRGB(
    Math.max(0, Math.min(255, Math.round(rgb[0] * k))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * k))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * k))),
  );
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function createDefaultHerringboneTileset(): HerringboneTilesetDef {
  const mk = (
    id: string,
    orientation: HerringboneTileDef['orientation'],
    edges: HerringboneTileDef['edges'],
    carve: HerringboneTileDef['carve'],
    biomeTags: VirtualBiomeId[] = VIRTUAL_BIOME_IDS,
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
      ], ['fungal', 'flooded', 'timber'], 1.5),
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
      ], ['earthen', 'fungal', 'flooded', 'timber', 'crystal', 'gilded'], 0.7),
      mk('drop-a', 'vertical', drop, [
        { kind: 'spline', from: 'n', to: 's', radius: 10, jitter: 14 },
        { kind: 'chamber', x: 0.5, y: 0.78, rx: 24, ry: 18 },
      ], ['frozen', 'crystal', 'scorched', 'volcanic', 'earthen'], 0.8),
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
