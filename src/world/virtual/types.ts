import type { BiomeId } from '@/core/types';

export const VIRTUAL_CHUNK_SIZE = 256 as const;
export const VIRTUAL_BIOME_CHUNK_SIZE = 512 as const;
export const VIRTUAL_TILE_SIZE = 256 as const;

/**
 * Sentinel value in a pixel scene's `material` plane meaning "fill this pixel with
 * the surrounding biome's rock + colour" (Noita's `FFFFFF`). It is NOT a real Cell
 * (Cell ids go to ~37); the stamper resolves it to the biome wall at stamp time, so
 * it never reaches the output grid. Lets a scene carve a real room — solid biome
 * rock around its authored materials + carved (transparent) space — instead of
 * floating a few cells in open cave.
 */
export const PIXEL_SCENE_BIOME_FILL = 255 as const;

export type VirtualBiomeId = BiomeId;

export type HerringboneOrientation = 'horizontal' | 'vertical';
export type TileAnchor = 'n' | 'e' | 's' | 'w';

export interface VirtualWorldDef {
  v: 1;
  id: string;
  name: string;
  seed: number;
  chunkSize: number;
  biomeChunkSize: number;
  herringboneCellSize: number;
  map: BiomeMapDef;
  tileset: HerringboneTilesetDef;
  pixelScenes: PixelScenePlacementDef[];
  materialProfile: VirtualMaterialProfile;
  dressing: VirtualDressingProfile;
  generation: VirtualGenerationParams;
}

export interface BiomeMapDef {
  widthChunks: number;
  heightChunks: number;
  originChunkX: number;
  originChunkY: number;
  cells: Uint8Array;
}

export interface HerringboneTilesetDef {
  v: 1;
  tileSize: number;
  constraints: {
    edgeColors: string[];
    vertexColors: string[];
  };
  tiles: HerringboneTileDef[];
}

export interface HerringboneTileDef {
  id: string;
  orientation: HerringboneOrientation;
  biomeTags: VirtualBiomeId[];
  weight: number;
  edges: Record<TileAnchor, string>;
  vertices: {
    nw: string;
    ne: string;
    se: string;
    sw: string;
  };
  carve: TileCarveInstruction[];
  sceneSlots: TileSceneSlot[];
}

export type TileCarveInstruction =
  | {
      kind: 'spline';
      from: TileAnchor;
      to: TileAnchor;
      radius: number;
      jitter: number;
    }
  | {
      kind: 'chamber';
      x: number;
      y: number;
      rx: number;
      ry: number;
    }
  | {
      kind: 'shaft';
      x: number;
      radius: number;
      roughness: number;
    };

export interface TileSceneSlot {
  id: string;
  x: number;
  y: number;
  tags: string[];
}

export interface PixelSceneDef {
  v: 1;
  id: string;
  name: string;
  kind?: VirtualSceneKind;
  tags?: string[];
  w: number;
  h: number;
  mask?: Uint8Array;
  material: Uint8Array;
  /** The "visual" layer — per-pixel packed RGB painted on top of the material
   *  (Noita's visual_file). 0 falls back to the material's representative colour. */
  colorOverrides?: Uint32Array;
  life?: Int16Array;
  charge?: Uint8Array;
  /** Decorative per-pixel packed-RGB layer rendered BEHIND the materials, visible
   *  through transparent/empty cells (Noita's background_file). 0 = transparent. */
  background?: Uint32Array;
  objects: VirtualSceneObject[];
  links: VirtualSceneLink[];
  lights: VirtualSceneLight[];
}

export interface PixelScenePlacementDef {
  id: string;
  scene: PixelSceneDef;
  x: number;
  y: number;
  priority: number;
}

export interface VirtualScenePlacementInstance {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  objects: VirtualSceneObject[];
  links: VirtualSceneLink[];
  lights: VirtualSceneLight[];
}

export interface VirtualSceneObject {
  id: string;
  kind: string;
  x: number;
  y: number;
  params: Record<string, unknown>;
}

export interface VirtualSceneLink {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
}

export interface VirtualSceneLight {
  id: string;
  x: number;
  y: number;
  color: string;
  intensity: number;
  radius: number;
  bloom?: number;
  flicker?: number;
  falloff?: 'soft' | 'linear' | 'sharp';
  occluded?: boolean;
}

export interface VirtualMaterialPalette {
  wall: number;
  accent: number;
  crown: number;
  deep: number;
}

export interface VirtualMaterialProfile {
  palettes: Record<VirtualBiomeId, VirtualMaterialPalette>;
}

export interface VirtualDressingControls {
  detailDensity: number;
  materialRichness: number;
  liquidRichness: number;
  glowDensity: number;
  floorDebris: number;
  hangingGrowth: number;
}

export type VirtualSceneKind =
  | 'timberBraces'
  | 'ruinedRooms'
  | 'bridgeFragments'
  | 'shrines'
  | 'fungalPockets'
  | 'crystalClusters'
  | 'lavaVents'
  | 'collapsedShafts';

export interface VirtualSceneControls {
  density: number;
  maxPerTile: number;
}

export type VirtualSceneBudget = Record<VirtualSceneKind, number>;

export interface VirtualSceneDressingProfile {
  controls: VirtualSceneControls;
  biomes: Record<VirtualBiomeId, VirtualSceneBudget>;
}

export interface VirtualBiomeDressingRecipe {
  ore: number;
  oreDensity: number;
  secondary: number;
  secondaryDensity: number;
  pocket: number;
  pocketDensity: number;
  liquid: number;
  liquidDensity: number;
  glow: number;
  glowDensity: number;
  rubble: number;
  rubbleDensity: number;
  hanging: number;
  hangingDensity: number;
}

export interface VirtualDressingProfile {
  controls: VirtualDressingControls;
  biomes: Record<VirtualBiomeId, VirtualBiomeDressingRecipe>;
  scenes: VirtualSceneDressingProfile;
}

export interface VirtualGenerationParams {
  halo: number;
  baseCellSize: number;
  smoothingPasses: number;
  organicSmoothingPasses: number;
  noiseScale: number;
  noiseThreshold: number;
  borderSeal: number;
  shapeWarp: number;
  cornerRounding: number;
  surfaceCover: number;
  surfaceDepth: number;
  vegetationDensity: number;
  edgeRoughness: number;
  pocketDensity: number;
  crackDensity: number;
  /** Multiplier on the chunk gen's carve radii (pockets, cracks, spline/shaft
   *  tunnels) — the virtual-gen analog of GEN_TUNE.caveScale, carried in the def
   *  so it survives the worker boundary. Undefined = 1.5 (the shipped grand-cave
   *  default). The World Map panel mirrors GEN_TUNE.caveScale into this. */
  caveScale?: number;
  /** Walk-surface "sink"/notch fill (parity with the legacy terrain polish). These
   *  mirror GEN_TUNE.{fillSurfacePits,surfacePitWidth,surfacePitDepth,notchPasses}
   *  onto the def so the global Look-tuning sink-fill sliders drive the chunked gen
   *  too. Run per-chunk on the haloed scratch, so cross-chunk pits up to the halo
   *  width stay seamless. Undefined = the shipped defaults (on, 6/4/2). */
  fillSurfacePits?: boolean;
  surfacePitWidth?: number;
  surfacePitDepth?: number;
  notchPasses?: number;
  /** Fill small ENCLOSED air pockets with cave rock — mostly stone/coal, ~16%
   *  hidden RawOre (dark until lit), a rare crystal geode (parity with the legacy
   *  fillMineralVugs). Only halo-bounded enclosed pockets are touched, never the
   *  traversable caves. Undefined = on. */
  mineralVugs?: boolean;
}

export interface VirtualChunkMeta {
  biome: VirtualBiomeId;
  tileIds: string[];
  scenes: string[];
  scenePlacements: VirtualScenePlacementInstance[];
  hash: string;
  generatedMs: number;
}

export interface VirtualChunk {
  cx: number;
  cy: number;
  originX: number;
  originY: number;
  size: number;
  types: Uint8Array;
  colors: Uint32Array;
  life: Int16Array;
  charge: Uint8Array;
  meta: VirtualChunkMeta;
}

export interface VirtualWindow {
  chunks: VirtualChunk[];
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

export type VirtualChunkPlane = 'types' | 'colors' | 'life' | 'charge' | 'previewRgba';

export interface GenerateChunkRequest {
  jobId: number;
  cx: number;
  cy: number;
  requestedPlanes: VirtualChunkPlane[];
}

export interface GenerateWindowRequest {
  jobId: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  centerCx: number;
  centerCy: number;
  requestedPlanes: VirtualChunkPlane[];
}

export interface ChunkMetrics {
  cx: number;
  cy: number;
  generatedMs: number;
  generatedBytes: number;
  transferBytes: number;
  materialCells: number;
  liquidCells: number;
  glowCells: number;
  sceneCount: number;
  /** @deprecated Use generatedBytes for full-cell payload size or transferBytes for actual posted payload size. */
  bytes: number;
}

export interface WindowMetrics {
  chunks: number;
  generatedMs: number;
  generatedBytes: number;
  transferBytes: number;
  materialCells: number;
  liquidCells: number;
  glowCells: number;
  sceneCount: number;
  /** @deprecated Use generatedBytes or transferBytes. */
  bytes: number;
}

export interface TransferableVirtualChunk {
  cx: number;
  cy: number;
  originX: number;
  originY: number;
  size: number;
  types?: ArrayBufferLike;
  colors?: ArrayBufferLike;
  life?: ArrayBufferLike;
  charge?: ArrayBufferLike;
  previewRgba?: ArrayBufferLike;
  meta: VirtualChunkMeta;
  metrics: ChunkMetrics;
}
