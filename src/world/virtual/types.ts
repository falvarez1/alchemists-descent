import type { BiomeId } from '@/core/types';

export const VIRTUAL_CHUNK_SIZE = 256 as const;
export const VIRTUAL_BIOME_CHUNK_SIZE = 512 as const;
export const VIRTUAL_TILE_SIZE = 256 as const;

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
  w: number;
  h: number;
  material: Uint8Array;
  colorOverrides?: Uint32Array;
  visual?: Uint8ClampedArray;
  background?: Uint8ClampedArray;
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
}

export interface VirtualChunkMeta {
  biome: VirtualBiomeId;
  tileIds: string[];
  scenes: string[];
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
  /** @deprecated Use generatedBytes for full-cell payload size or transferBytes for actual posted payload size. */
  bytes: number;
}

export interface WindowMetrics {
  chunks: number;
  generatedMs: number;
  generatedBytes: number;
  transferBytes: number;
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
