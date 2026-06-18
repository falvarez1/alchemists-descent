import { BIOMES } from '@/config/biomes';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type {
  HerringboneTileDef,
  HerringboneTilesetDef,
  PixelSceneDef,
  PixelScenePlacementDef,
  VirtualBiomeId,
  VirtualBiomeDressingRecipe,
  VirtualDressingProfile,
  VirtualMaterialPalette,
  VirtualMaterialProfile,
  VirtualSceneBudget,
  VirtualSceneKind,
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

export const VIRTUAL_SCENE_KINDS: VirtualSceneKind[] = [
  'timberBraces',
  'ruinedRooms',
  'bridgeFragments',
  'shrines',
  'fungalPockets',
  'crystalClusters',
  'lavaVents',
  'collapsedShafts',
];

let defaultPixelSceneLibrary: PixelSceneDef[] | null = null;

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
    dressing: createDefaultDressingProfile(),
    generation: createDefaultVirtualGenerationParams(),
  };
}

export function createDefaultVirtualGenerationParams(): VirtualWorldDef['generation'] {
  return {
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
    // Neutral = the shipped grand-cave look (GEN_TUNE_DEFAULTS.caveScale). The
    // World Map mirrors the live GEN_TUNE.caveScale onto this per generation;
    // caveMultiplier() in ChunkGenerator normalizes 1.5 -> x1.0.
    caveScale: 1.5,
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

export function createDefaultDressingProfile(): VirtualDressingProfile {
  const biomes = Object.fromEntries(
    VIRTUAL_BIOME_IDS.map((id) => [id, dressingRecipeForBiome(id)]),
  ) as Record<VirtualBiomeId, VirtualBiomeDressingRecipe>;
  return {
    controls: {
      detailDensity: 1,
      materialRichness: 1,
      liquidRichness: 1,
      glowDensity: 1,
      floorDebris: 1,
      hangingGrowth: 1,
    },
    biomes,
    scenes: {
      controls: {
        density: 1,
        maxPerTile: 2,
      },
      biomes: Object.fromEntries(
        VIRTUAL_BIOME_IDS.map((id) => [id, sceneBudgetForBiome(id)]),
      ) as Record<VirtualBiomeId, VirtualSceneBudget>,
    },
  };
}

function dressingRecipeForBiome(id: VirtualBiomeId): VirtualBiomeDressingRecipe {
  switch (id) {
    case 'fungal':
      return recipe(Cell.Gold, 0.35, Cell.Fungus, 1.2, Cell.Glowshroom, 0.78, Cell.Toxic, 0.34, Cell.Glowshroom, 1.25, Cell.Moss, 1.15, Cell.Vines, 1.15);
    case 'frozen':
      return recipe(Cell.Crystal, 0.72, Cell.Ice, 1.05, Cell.Snow, 0.9, Cell.Nitrogen, 0.18, Cell.Crystal, 0.85, Cell.Ice, 0.95, Cell.Ice, 0.38);
    case 'flooded':
      return recipe(Cell.Gold, 0.34, Cell.Moss, 1.1, Cell.Fungus, 0.58, Cell.Water, 1.1, Cell.Glowshroom, 0.55, Cell.Moss, 1.25, Cell.Vines, 1.4);
    case 'timber':
      return recipe(Cell.Coal, 0.46, Cell.Wood, 1.25, Cell.Moss, 0.8, Cell.Water, 0.2, Cell.Glowshroom, 0.38, Cell.Wood, 1.4, Cell.Vines, 1.35);
    case 'crystal':
      return recipe(Cell.Crystal, 1.65, Cell.Glass, 0.58, Cell.Crystal, 1.25, Cell.Water, 0.16, Cell.Crystal, 1.65, Cell.Stone, 0.5, Cell.Crystal, 1.1);
    case 'scorched':
      return recipe(Cell.Coal, 1.1, Cell.Ash, 0.75, Cell.Stone, 0.62, Cell.Lava, 0.24, Cell.Gold, 0.34, Cell.Ash, 1.1, Cell.Stone, 0.2);
    case 'volcanic':
      return recipe(Cell.Coal, 0.82, Cell.Stone, 0.72, Cell.Lava, 0.8, Cell.Lava, 0.86, Cell.Lava, 0.48, Cell.Stone, 0.7, Cell.Stone, 0.24);
    case 'gilded':
      return recipe(Cell.Gold, 1.6, Cell.Catalyst, 0.46, Cell.Gold, 1.1, Cell.Acid, 0.3, Cell.Gold, 0.88, Cell.Stone, 0.6, Cell.Gold, 0.28);
    case 'earthen':
    default:
      return recipe(Cell.Gold, 0.62, Cell.Coal, 0.44, Cell.Stone, 0.52, Cell.Water, 0.18, Cell.Glowshroom, 0.34, Cell.Moss, 0.92, Cell.Vines, 0.62);
  }
}

function recipe(
  ore: number,
  oreDensity: number,
  secondary: number,
  secondaryDensity: number,
  pocket: number,
  pocketDensity: number,
  liquid: number,
  liquidDensity: number,
  glow: number,
  glowDensity: number,
  rubble: number,
  rubbleDensity: number,
  hanging: number,
  hangingDensity: number,
): VirtualBiomeDressingRecipe {
  return {
    ore,
    oreDensity,
    secondary,
    secondaryDensity,
    pocket,
    pocketDensity,
    liquid,
    liquidDensity,
    glow,
    glowDensity,
    rubble,
    rubbleDensity,
    hanging,
    hangingDensity,
  };
}

function sceneBudgetForBiome(id: VirtualBiomeId): VirtualSceneBudget {
  const zero = Object.fromEntries(VIRTUAL_SCENE_KINDS.map((kind) => [kind, 0])) as VirtualSceneBudget;
  switch (id) {
    case 'fungal':
      return { ...zero, fungalPockets: 1.6, shrines: 0.24, timberBraces: 0.28, collapsedShafts: 0.42 };
    case 'frozen':
      return { ...zero, crystalClusters: 0.9, collapsedShafts: 0.54, shrines: 0.22, ruinedRooms: 0.22 };
    case 'flooded':
      return { ...zero, bridgeFragments: 0.74, fungalPockets: 0.76, timberBraces: 0.42, collapsedShafts: 0.26 };
    case 'timber':
      return { ...zero, timberBraces: 1.45, bridgeFragments: 0.82, ruinedRooms: 0.3, shrines: 0.16 };
    case 'crystal':
      return { ...zero, crystalClusters: 1.65, shrines: 0.34, collapsedShafts: 0.38 };
    case 'scorched':
      return { ...zero, lavaVents: 0.58, collapsedShafts: 0.72, ruinedRooms: 0.32, bridgeFragments: 0.22 };
    case 'volcanic':
      return { ...zero, lavaVents: 1.6, collapsedShafts: 0.86, bridgeFragments: 0.18 };
    case 'gilded':
      return { ...zero, shrines: 0.82, ruinedRooms: 0.52, crystalClusters: 0.34, collapsedShafts: 0.24 };
    case 'earthen':
    default:
      return { ...zero, ruinedRooms: 0.58, bridgeFragments: 0.44, shrines: 0.26, collapsedShafts: 0.44, timberBraces: 0.28 };
  }
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
    sceneSlots: HerringboneTileDef['sceneSlots'] = [],
  ): HerringboneTileDef => ({
    id,
    orientation,
    biomeTags,
    weight,
    edges,
    vertices: { nw: 'solid', ne: 'junction', se: 'solid', sw: 'junction' },
    carve,
    sceneSlots,
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
      ], VIRTUAL_BIOME_IDS, 1, [
        { id: 'mid-bridge', x: 0.5, y: 0.56, tags: ['bridgeFragments', 'timberBraces', 'shrines'] },
      ]),
      mk('h-open-b', 'horizontal', open, [
        { kind: 'spline', from: 'w', to: 'e', radius: 12, jitter: 28 },
        { kind: 'chamber', x: 0.32, y: 0.45, rx: 22, ry: 17 },
      ], VIRTUAL_BIOME_IDS, 1, [
        { id: 'side-room', x: 0.34, y: 0.5, tags: ['ruinedRooms', 'fungalPockets', 'crystalClusters'] },
      ]),
      mk('h-fungal', 'horizontal', open, [
        { kind: 'spline', from: 'w', to: 'e', radius: 18, jitter: 20 },
        { kind: 'chamber', x: 0.67, y: 0.58, rx: 42, ry: 32 },
      ], ['fungal', 'flooded', 'timber'], 1.5, [
        { id: 'growth-pocket', x: 0.66, y: 0.58, tags: ['fungalPockets', 'timberBraces'] },
      ]),
      mk('v-open-a', 'vertical', vertical, [
        { kind: 'spline', from: 'n', to: 's', radius: 14, jitter: 18 },
        { kind: 'chamber', x: 0.45, y: 0.62, rx: 20, ry: 34 },
      ], VIRTUAL_BIOME_IDS, 1, [
        { id: 'shaft-wall', x: 0.46, y: 0.58, tags: ['collapsedShafts', 'crystalClusters', 'lavaVents'] },
      ]),
      mk('v-open-b', 'vertical', vertical, [
        { kind: 'spline', from: 'n', to: 's', radius: 11, jitter: 26 },
        { kind: 'shaft', x: 0.56, radius: 9, roughness: 0.45 },
      ], VIRTUAL_BIOME_IDS, 1, [
        { id: 'shaft-brace', x: 0.56, y: 0.48, tags: ['collapsedShafts', 'timberBraces'] },
      ]),
      mk('cross-a', 'horizontal', cross, [
        { kind: 'spline', from: 'w', to: 'e', radius: 12, jitter: 12 },
        { kind: 'spline', from: 'n', to: 's', radius: 10, jitter: 16 },
        { kind: 'chamber', x: 0.5, y: 0.5, rx: 28, ry: 28 },
      ], ['earthen', 'fungal', 'flooded', 'timber', 'crystal', 'gilded'], 0.7, [
        { id: 'junction-scene', x: 0.5, y: 0.5, tags: ['shrines', 'bridgeFragments', 'ruinedRooms'] },
      ]),
      mk('drop-a', 'vertical', drop, [
        { kind: 'spline', from: 'n', to: 's', radius: 10, jitter: 14 },
        { kind: 'chamber', x: 0.5, y: 0.78, rx: 24, ry: 18 },
      ], ['frozen', 'crystal', 'scorched', 'volcanic', 'earthen'], 0.8, [
        { id: 'drop-feature', x: 0.5, y: 0.76, tags: ['lavaVents', 'collapsedShafts', 'crystalClusters'] },
      ]),
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

export function getDefaultPixelSceneLibrary(): readonly PixelSceneDef[] {
  defaultPixelSceneLibrary ??= [
    createTimberBracesScene(),
    createRuinedRoomScene(),
    createBridgeFragmentScene(),
    createShrineScene(),
    createFungalPocketScene(),
    createCrystalClusterScene(),
    createLavaVentScene(),
    createCollapsedShaftScene(),
    // Biome-identity variants (chosen per biome by chooseSceneForSlot's biome-preferred filter).
    createMushroomGroveScene(),
    createGlowcapHollowScene(),
    createFrozenGeodeScene(),
    createCrystalSpireScene(),
    createMineScaffoldScene(),
    createMagmaFissureScene(),
    createCinderVentScene(),
    createGildedVaultScene(),
    createScorchedRuinScene(),
    createCrystalAltarScene(),
    createEmberShrineScene(),
    createFloodedShaftScene(),
  ];
  return defaultPixelSceneLibrary;
}

function createSceneCanvas(w: number, h: number): {
  material: Uint8Array;
  mask: Uint8Array;
  colorOverrides: Uint32Array;
  paint(x: number, y: number, material: number, color: number): void;
  clear(x: number, y: number): void;
  rect(x0: number, y0: number, x1: number, y1: number, material: number, color: number): void;
} {
  const material = new Uint8Array(w * h);
  const mask = new Uint8Array(w * h);
  const colorOverrides = new Uint32Array(w * h);
  const paint = (x: number, y: number, cell: number, color: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = x + y * w;
    material[i] = cell;
    mask[i] = 1;
    colorOverrides[i] = color;
  };
  const clear = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = x + y * w;
    material[i] = Cell.Empty;
    mask[i] = 1;
    colorOverrides[i] = 0;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, cell: number, color: number): void => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) paint(x, y, cell, color);
    }
  };
  return { material, mask, colorOverrides, paint, clear, rect };
}

function createTimberBracesScene(): PixelSceneDef {
  const w = 84;
  const h = 52;
  const c = createSceneCanvas(w, h);
  const wood = packRGB(92, 58, 32);
  const moss = packRGB(74, 120, 42);
  c.rect(9, 36, 75, 40, Cell.Wood, wood);
  c.rect(15, 12, 20, 43, Cell.Wood, packRGB(78, 48, 28));
  c.rect(63, 12, 68, 43, Cell.Wood, packRGB(78, 48, 28));
  for (let n = 0; n < 30; n++) {
    const x = 18 + n;
    c.paint(x, 35 - Math.floor(n * 0.42), Cell.Wood, packRGB(86, 54, 30));
    c.paint(66 - n, 35 - Math.floor(n * 0.42), Cell.Wood, packRGB(86, 54, 30));
  }
  for (let x = 12; x <= 72; x += 6) c.paint(x, 35, Cell.Moss, moss);
  return sceneDef('scene-timber-braces', 'Timber Braces', 'timberBraces', ['timber', 'flooded', 'fungal', 'bridge', 'support'], w, h, c);
}

function createRuinedRoomScene(): PixelSceneDef {
  const w = 96;
  const h = 64;
  const c = createSceneCanvas(w, h);
  const stone = packRGB(86, 82, 78);
  const dark = packRGB(54, 50, 48);
  for (let y = 16; y < 50; y++) {
    for (let x = 14; x < 82; x++) c.clear(x, y);
  }
  c.rect(10, 48, 86, 54, Cell.Stone, stone);
  c.rect(10, 12, 18, 54, Cell.Stone, dark);
  c.rect(78, 12, 86, 54, Cell.Stone, dark);
  c.rect(16, 10, 80, 16, Cell.Stone, stone);
  for (let x = 24; x < 72; x += 9) c.paint(x, 47, Cell.Gold, packRGB(206, 158, 44));
  return sceneDef('scene-ruined-room', 'Ruined Room', 'ruinedRooms', ['earthen', 'frozen', 'timber', 'ruin', 'room', 'shrine'], w, h, c, [
    { id: 'room-pickup', kind: 'pickup', x: Math.floor(w / 2), y: 43, params: { kind: 'gold', amount: 16 } },
  ]);
}

function createBridgeFragmentScene(): PixelSceneDef {
  const w = 112;
  const h = 46;
  const c = createSceneCanvas(w, h);
  const wood = packRGB(96, 62, 34);
  const rope = packRGB(92, 86, 46);
  c.rect(10, 24, 94, 29, Cell.Wood, wood);
  for (let x = 10; x <= 96; x += 12) c.rect(x, 18, x + 4, 33, Cell.Wood, packRGB(82, 52, 30));
  for (let n = 0; n < 82; n++) {
    c.paint(12 + n, 16 + Math.floor(Math.sin(n * 0.18) * 2), Cell.Vines, rope);
    if (n % 9 === 0) c.paint(12 + n, 30, Cell.Moss, packRGB(70, 112, 42));
  }
  return sceneDef('scene-bridge-fragment', 'Bridge Fragment', 'bridgeFragments', ['earthen', 'flooded', 'timber', 'scorched', 'volcanic', 'bridge'], w, h, c);
}

function createShrineScene(): PixelSceneDef {
  const w = 76;
  const h = 66;
  const c = createSceneCanvas(w, h);
  const stone = packRGB(94, 88, 82);
  c.rect(16, 48, 60, 55, Cell.Stone, stone);
  c.rect(24, 24, 30, 50, Cell.Stone, packRGB(74, 70, 68));
  c.rect(46, 24, 52, 50, Cell.Stone, packRGB(74, 70, 68));
  c.rect(24, 20, 52, 26, Cell.Stone, stone);
  c.rect(34, 34, 42, 48, Cell.Crystal, packRGB(108, 220, 238));
  return sceneDef('scene-shrine', 'Small Shrine', 'shrines', ['earthen', 'fungal', 'timber', 'gilded', 'shrine', 'light', 'treasure'], w, h, c, [
    { id: 'shrine-pickup', kind: 'pickup', x: 38, y: 45, params: { kind: 'tome', card: 'spark' } },
  ], [
    { id: 'shrine-light', x: 38, y: 35, color: '#7df9ff', intensity: 0.86, radius: 96, bloom: 1.1, flicker: 0.08, falloff: 'soft', occluded: true },
  ]);
}

function createFungalPocketScene(): PixelSceneDef {
  const w = 88;
  const h = 58;
  const c = createSceneCanvas(w, h);
  for (let y = 18; y < 48; y++) {
    for (let x = 14; x < 74; x++) {
      const nx = (x - 44) / 32;
      const ny = (y - 34) / 18;
      if (nx * nx + ny * ny < 1) c.clear(x, y);
    }
  }
  for (let x = 18; x < 72; x += 7) {
    c.paint(x, 45, Cell.Fungus, packRGB(52, 156, 114));
    c.paint(x + 1, 44, Cell.Glowshroom, packRGB(126, 228, 142));
  }
  c.rect(30, 48, 58, 51, Cell.Moss, packRGB(56, 118, 50));
  return sceneDef('scene-fungal-pocket', 'Fungal Pocket', 'fungalPockets', ['fungal', 'flooded', 'growth', 'light'], w, h, c, [], [
    { id: 'fungal-glow', x: 45, y: 39, color: '#7ef58e', intensity: 0.54, radius: 76, bloom: 0.82, flicker: 0.18, falloff: 'soft', occluded: true },
  ]);
}

function createCrystalClusterScene(): PixelSceneDef {
  const w = 86;
  const h = 70;
  const c = createSceneCanvas(w, h);
  for (let x = 20; x <= 66; x += 8) {
    const height = 18 + ((x * 17) % 24);
    for (let y = 56; y > 56 - height; y--) {
      const taper = Math.abs(x - 43) / 28;
      const width = Math.max(1, Math.floor(3 - taper));
      c.rect(x - width, y, x + width, y, Cell.Crystal, packRGB(90, 198, 226));
    }
  }
  c.rect(14, 57, 72, 62, Cell.Ice, packRGB(126, 176, 214));
  return sceneDef('scene-crystal-cluster', 'Crystal Cluster', 'crystalClusters', ['crystal', 'frozen', 'light'], w, h, c, [], [
    { id: 'crystal-glow', x: 43, y: 42, color: '#83f4ff', intensity: 0.68, radius: 86, bloom: 1.2, flicker: 0.04, falloff: 'soft', occluded: true },
  ]);
}

function createLavaVentScene(): PixelSceneDef {
  const w = 84;
  const h = 78;
  const c = createSceneCanvas(w, h);
  for (let y = 16; y < 66; y++) {
    const half = Math.max(3, Math.floor(13 - Math.abs(y - 42) * 0.18));
    for (let x = 42 - half; x <= 42 + half; x++) c.clear(x, y);
  }
  c.rect(28, 58, 56, 66, Cell.Lava, packRGB(242, 72, 14));
  c.rect(33, 48, 51, 58, Cell.Lava, packRGB(238, 84, 20));
  c.rect(22, 64, 62, 68, Cell.Stone, packRGB(70, 64, 62));
  return sceneDef('scene-lava-vent', 'Lava Vent', 'lavaVents', ['volcanic', 'scorched', 'hazard', 'light'], w, h, c, [], [
    { id: 'lava-light', x: 42, y: 53, color: '#ff6b1a', intensity: 1.08, radius: 110, bloom: 1.25, flicker: 0.22, falloff: 'soft', occluded: true },
  ]);
}

function createCollapsedShaftScene(): PixelSceneDef {
  const w = 74;
  const h = 120;
  const c = createSceneCanvas(w, h);
  for (let y = 6; y < 112; y++) {
    const drift = Math.floor(Math.sin(y * 0.11) * 5);
    const half = 8 + Math.floor(Math.sin(y * 0.07 + 1.7) * 3);
    for (let x = 37 + drift - half; x <= 37 + drift + half; x++) c.clear(x, y);
  }
  for (let y = 18; y < 108; y += 18) {
    c.rect(24, y, 50, y + 4, Cell.Wood, packRGB(76, 48, 28));
    c.paint(25, y + 5, Cell.Vines, packRGB(46, 124, 54));
  }
  c.rect(20, 110, 56, 116, Cell.Stone, packRGB(76, 72, 72));
  return sceneDef('scene-collapsed-shaft', 'Collapsed Shaft', 'collapsedShafts', ['earthen', 'fungal', 'frozen', 'crystal', 'scorched', 'volcanic', 'gilded', 'shaft', 'drop', 'ruin'], w, h, c);
}

function createMushroomGroveScene(): PixelSceneDef {
  const w = 92;
  const h = 64;
  const c = createSceneCanvas(w, h);
  const moss = packRGB(54, 116, 48);
  const stalk = packRGB(196, 182, 150);
  const cap = packRGB(126, 232, 150);
  c.rect(8, 54, 84, 58, Cell.Moss, moss);
  for (const sx of [18, 34, 52, 70]) {
    const top = 26 + ((sx * 13) % 12);
    c.rect(sx - 1, top, sx + 1, 54, Cell.Fungus, stalk);
    for (let dx = -5; dx <= 5; dx++) {
      const cy = top - 3 + Math.floor(Math.abs(dx) * 0.5);
      c.paint(sx + dx, cy, Cell.Glowshroom, cap);
      c.paint(sx + dx, cy + 1, Cell.Glowshroom, cap);
    }
  }
  for (let x = 12; x < 82; x += 9) c.paint(x, 53, Cell.Glowshroom, packRGB(150, 240, 168));
  return sceneDef('scene-mushroom-grove', 'Mushroom Grove', 'fungalPockets', ['fungal', 'growth', 'light'], w, h, c, [], [
    { id: 'grove-glow', x: 46, y: 36, color: '#88f59a', intensity: 0.6, radius: 92, bloom: 0.9, flicker: 0.16, falloff: 'soft', occluded: true },
  ]);
}

function createGlowcapHollowScene(): PixelSceneDef {
  const w = 84;
  const h = 60;
  const c = createSceneCanvas(w, h);
  for (let y = 14; y < 50; y++) {
    for (let x = 12; x < 72; x++) {
      const nx = (x - 42) / 30;
      const ny = (y - 32) / 18;
      if (nx * nx + ny * ny < 1) c.clear(x, y);
    }
  }
  for (let a = 0; a < 28; a++) {
    const t = (a / 28) * Math.PI * 2;
    c.paint(Math.round(42 + Math.cos(t) * 29), Math.round(32 + Math.sin(t) * 17), Cell.Glowshroom, packRGB(130, 232, 150));
  }
  c.rect(28, 47, 56, 50, Cell.Toxic, packRGB(120, 196, 70));
  c.rect(20, 50, 64, 52, Cell.Moss, packRGB(52, 112, 46));
  return sceneDef('scene-glowcap-hollow', 'Glowcap Hollow', 'fungalPockets', ['fungal', 'flooded', 'growth', 'light', 'hazard'], w, h, c, [], [
    { id: 'hollow-glow', x: 42, y: 34, color: '#7ef58e', intensity: 0.66, radius: 84, bloom: 0.95, flicker: 0.2, falloff: 'soft', occluded: true },
  ]);
}

function createFrozenGeodeScene(): PixelSceneDef {
  const w = 80;
  const h = 72;
  const c = createSceneCanvas(w, h);
  const ice = packRGB(150, 196, 224);
  const core = packRGB(120, 214, 234);
  for (let y = 8; y < 64; y++) {
    for (let x = 10; x < 70; x++) {
      const nx = (x - 40) / 28;
      const ny = (y - 36) / 26;
      const d = nx * nx + ny * ny;
      if (d < 1 && d > 0.62) c.paint(x, y, Cell.Ice, ice);
      else if (d <= 0.62 && d > 0.5) c.clear(x, y);
    }
  }
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    for (let r = 0; r < 7; r++) {
      c.paint(Math.round(40 + Math.cos(t) * (16 - r)), Math.round(36 + Math.sin(t) * (15 - r)), Cell.Crystal, core);
    }
  }
  return sceneDef('scene-frozen-geode', 'Frozen Geode', 'crystalClusters', ['frozen', 'crystal', 'light'], w, h, c, [], [
    { id: 'geode-glow', x: 40, y: 36, color: '#9fe8ff', intensity: 0.62, radius: 80, bloom: 1.1, flicker: 0.05, falloff: 'soft', occluded: true },
  ]);
}

function createCrystalSpireScene(): PixelSceneDef {
  const w = 70;
  const h = 96;
  const c = createSceneCanvas(w, h);
  const crystal = packRGB(98, 206, 230);
  const deep = packRGB(64, 150, 188);
  c.rect(14, 84, 56, 90, Cell.Ice, packRGB(120, 168, 206));
  for (const s of [{ x: 35, top: 10, ww: 6 }, { x: 22, top: 40, ww: 3 }, { x: 48, top: 34, ww: 4 }]) {
    for (let y = 84; y >= s.top; y--) {
      const k = (y - s.top) / (84 - s.top);
      const half = Math.max(0, Math.round(s.ww * k));
      c.rect(s.x - half, y, s.x + half, y, Cell.Crystal, k > 0.5 ? crystal : deep);
    }
  }
  return sceneDef('scene-crystal-spire', 'Crystal Spire', 'crystalClusters', ['crystal', 'frozen', 'light'], w, h, c, [], [
    { id: 'spire-glow', x: 35, y: 40, color: '#83f4ff', intensity: 0.7, radius: 96, bloom: 1.2, flicker: 0.04, falloff: 'soft', occluded: true },
  ]);
}

function createMineScaffoldScene(): PixelSceneDef {
  const w = 88;
  const h = 78;
  const c = createSceneCanvas(w, h);
  const wood = packRGB(96, 62, 34);
  const dark = packRGB(74, 46, 26);
  c.rect(16, 8, 20, 70, Cell.Wood, dark);
  c.rect(66, 8, 70, 70, Cell.Wood, dark);
  for (let y = 18; y < 70; y += 17) c.rect(16, y, 70, y + 3, Cell.Wood, wood);
  c.rect(41, 8, 45, 70, Cell.Wood, dark);
  for (let y = 12; y < 70; y += 5) c.rect(38, y, 48, y + 1, Cell.Wood, wood);
  c.paint(24, 64, Cell.Gold, packRGB(206, 158, 44));
  c.paint(62, 30, Cell.Gold, packRGB(206, 158, 44));
  c.paint(60, 64, Cell.Coal, packRGB(40, 40, 44));
  return sceneDef('scene-mine-scaffold', 'Mine Scaffold', 'timberBraces', ['timber', 'mine', 'support', 'earthen'], w, h, c);
}

function createMagmaFissureScene(): PixelSceneDef {
  const w = 104;
  const h = 70;
  const c = createSceneCanvas(w, h);
  for (let y = 10; y < 60; y++) {
    const half = Math.round(10 + (y - 10) * 0.5);
    for (let x = 52 - half; x <= 52 + half; x++) c.clear(x, y);
  }
  // A thin magma channel, not a pool: keep volcanic hazard dressing bounded and survivable.
  c.rect(40, 58, 64, 61, Cell.Lava, packRGB(242, 80, 16));
  c.rect(46, 54, 58, 57, Cell.Lava, packRGB(236, 96, 24));
  for (let x = 18; x <= 86; x += 4) c.paint(x, 63, Cell.Stone, packRGB(58, 50, 48));
  return sceneDef('scene-magma-fissure', 'Magma Fissure', 'lavaVents', ['volcanic', 'scorched', 'hazard', 'light'], w, h, c, [], [
    { id: 'fissure-glow', x: 52, y: 56, color: '#ff5a14', intensity: 1.15, radius: 124, bloom: 1.3, flicker: 0.26, falloff: 'soft', occluded: true },
  ]);
}

function createCinderVentScene(): PixelSceneDef {
  const w = 72;
  const h = 58;
  const c = createSceneCanvas(w, h);
  const ash = packRGB(96, 86, 80);
  for (let x = 10; x < 62; x++) {
    const top = 44 - Math.round(Math.max(0, 14 - Math.abs(x - 36)) * 0.9);
    c.rect(x, top, x, 50, Cell.Ash, ash);
  }
  c.rect(30, 46, 42, 50, Cell.Lava, packRGB(238, 92, 22));
  c.paint(26, 49, Cell.Coal, packRGB(40, 40, 44));
  c.paint(46, 49, Cell.Coal, packRGB(40, 40, 44));
  return sceneDef('scene-cinder-vent', 'Cinder Vent', 'lavaVents', ['scorched', 'volcanic', 'hazard', 'light'], w, h, c, [], [
    { id: 'cinder-glow', x: 36, y: 47, color: '#ff7a2a', intensity: 0.82, radius: 92, bloom: 1.05, flicker: 0.3, falloff: 'soft', occluded: true },
  ]);
}

function createGildedVaultScene(): PixelSceneDef {
  const w = 98;
  const h = 64;
  const c = createSceneCanvas(w, h);
  const stone = packRGB(92, 84, 70);
  const gold = packRGB(212, 168, 56);
  for (let y = 16; y < 50; y++) for (let x = 14; x < 84; x++) c.clear(x, y);
  c.rect(10, 48, 88, 54, Cell.Stone, stone);
  c.rect(10, 12, 18, 54, Cell.Stone, stone);
  c.rect(80, 12, 88, 54, Cell.Stone, stone);
  c.rect(16, 10, 82, 16, Cell.Stone, stone);
  for (let y = 14; y < 52; y += 5) { c.paint(14, y, Cell.Gold, gold); c.paint(85, y + 2, Cell.Gold, gold); }
  for (let x = 28; x < 70; x += 3) c.rect(x, 45 - ((x * 7) % 4), x + 1, 47, Cell.Gold, gold);
  return sceneDef('scene-gilded-vault', 'Gilded Vault', 'ruinedRooms', ['gilded', 'treasure', 'room'], w, h, c, [
    { id: 'vault-pickup', kind: 'pickup', x: Math.floor(w / 2), y: 43, params: { kind: 'gold', amount: 40 } },
  ], [
    { id: 'vault-glow', x: 49, y: 30, color: '#f6c76d', intensity: 0.7, radius: 88, bloom: 1.0, flicker: 0.06, falloff: 'soft', occluded: true },
  ]);
}

function createScorchedRuinScene(): PixelSceneDef {
  const w = 96;
  const h = 60;
  const c = createSceneCanvas(w, h);
  const charred = packRGB(58, 52, 50);
  const stone = packRGB(78, 70, 66);
  for (let y = 14; y < 46; y++) for (let x = 12; x < 82; x++) c.clear(x, y);
  c.rect(8, 44, 86, 50, Cell.Stone, charred);
  c.rect(8, 10, 16, 50, Cell.Stone, stone);
  c.rect(78, 10, 86, 40, Cell.Stone, stone);
  c.rect(14, 8, 80, 14, Cell.Stone, charred);
  for (let x = 20; x < 76; x += 5) c.paint(x, 43, Cell.Ash, packRGB(92, 84, 78));
  c.paint(30, 43, Cell.Coal, packRGB(38, 38, 42));
  c.paint(58, 43, Cell.Coal, packRGB(38, 38, 42));
  return sceneDef('scene-scorched-ruin', 'Scorched Ruin', 'ruinedRooms', ['scorched', 'ruin', 'room'], w, h, c);
}

function createCrystalAltarScene(): PixelSceneDef {
  const w = 74;
  const h = 64;
  const c = createSceneCanvas(w, h);
  c.rect(18, 50, 56, 56, Cell.Stone, packRGB(86, 92, 102));
  c.rect(28, 40, 46, 51, Cell.Stone, packRGB(70, 76, 86));
  for (let y = 22; y < 42; y++) {
    const half = Math.max(1, Math.round((42 - y) * 0.4));
    c.rect(37 - half, y, 37 + half, y, Cell.Crystal, packRGB(120, 222, 240));
  }
  return sceneDef('scene-crystal-altar', 'Crystal Altar', 'shrines', ['crystal', 'frozen', 'shrine', 'light', 'treasure'], w, h, c, [
    { id: 'altar-pickup', kind: 'pickup', x: 37, y: 47, params: { kind: 'tome', card: 'spark' } },
  ], [
    { id: 'altar-glow', x: 37, y: 30, color: '#9af0ff', intensity: 0.92, radius: 100, bloom: 1.2, flicker: 0.05, falloff: 'soft', occluded: true },
  ]);
}

function createEmberShrineScene(): PixelSceneDef {
  const w = 74;
  const h = 64;
  const c = createSceneCanvas(w, h);
  const stone = packRGB(72, 60, 56);
  c.rect(16, 50, 58, 56, Cell.Stone, stone);
  c.rect(24, 26, 30, 52, Cell.Stone, packRGB(58, 48, 46));
  c.rect(44, 26, 50, 52, Cell.Stone, packRGB(58, 48, 46));
  c.rect(24, 22, 50, 28, Cell.Stone, stone);
  c.rect(32, 40, 42, 46, Cell.Lava, packRGB(240, 96, 26));
  return sceneDef('scene-ember-shrine', 'Ember Shrine', 'shrines', ['scorched', 'volcanic', 'shrine', 'light'], w, h, c, [
    { id: 'ember-pickup', kind: 'pickup', x: 37, y: 47, params: { kind: 'gold', amount: 18 } },
  ], [
    { id: 'ember-light', x: 37, y: 40, color: '#ff7b2c', intensity: 0.9, radius: 96, bloom: 1.1, flicker: 0.24, falloff: 'soft', occluded: true },
  ]);
}

function createFloodedShaftScene(): PixelSceneDef {
  const w = 70;
  const h = 116;
  const c = createSceneCanvas(w, h);
  for (let y = 6; y < 104; y++) {
    const drift = Math.floor(Math.sin(y * 0.1) * 4);
    const half = 9 + Math.floor(Math.sin(y * 0.06 + 1.2) * 3);
    for (let x = 35 + drift - half; x <= 35 + drift + half; x++) c.clear(x, y);
  }
  c.rect(18, 98, 52, 106, Cell.Water, packRGB(46, 96, 150));
  c.rect(14, 104, 56, 110, Cell.Stone, packRGB(72, 70, 72));
  for (let y = 24; y < 96; y += 22) {
    c.rect(24, y, 46, y + 2, Cell.Wood, packRGB(72, 46, 26));
    c.paint(25, y + 3, Cell.Moss, packRGB(50, 116, 50));
  }
  return sceneDef('scene-flooded-shaft', 'Flooded Shaft', 'collapsedShafts', ['flooded', 'shaft', 'drop'], w, h, c);
}

function sceneDef(
  id: string,
  name: string,
  kind: VirtualSceneKind,
  tags: string[],
  w: number,
  h: number,
  canvas: ReturnType<typeof createSceneCanvas>,
  objects: PixelSceneDef['objects'] = [],
  lights: PixelSceneDef['lights'] = [],
): PixelSceneDef {
  return {
    v: 1,
    id,
    name,
    kind,
    tags,
    w,
    h,
    mask: canvas.mask,
    material: canvas.material,
    colorOverrides: canvas.colorOverrides,
    objects,
    links: [],
    lights,
  };
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
    kind: 'ruinedRooms',
    tags: ['ruin', 'waystone', 'boundary'],
    w,
    h,
    material,
    colorOverrides,
    objects: [
      {
        id: 'ruin-waystone',
        kind: 'waystone',
        x: Math.floor(w / 2),
        y: h - 12,
        params: { lit: false },
      },
    ],
    links: [],
    lights: [
      {
        id: 'ruin-glow',
        x: Math.floor(w / 2),
        y: h - 22,
        color: '#f6c76d',
        intensity: 0.72,
        radius: 78,
        bloom: 0.95,
        flicker: 0.12,
        falloff: 'soft',
        occluded: true,
      },
    ],
  };
}
