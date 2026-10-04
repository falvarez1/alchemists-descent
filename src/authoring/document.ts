import type { BackdropSettings, BiomeId } from '@/core/types';
import type { SpriteAsset } from '@/authoring/sprites';
import type { AnyWorldPaint } from '@/sim/worldPaint';

/**
 * EditorDocument v2 (docs/BUILDER.md): the durable authoring layer. The
 * document stores design intent; runtime/playtest compiles disposable worlds
 * from it.
 */

export const EDITOR_OBJECT_KINDS = [
  'spawn',
  'enemy',
  'pickup',
  'exitPortal',
  'waystone',
  'exitWell',
  'cauldron',
  'door',
  'plate',
  'lever',
  'brazier',
  'scale',
  'buoy',
  'chargeLatch',
  'runeGlyph',
  'runeDoor',
  'bossMarker',
  'terrainStamp',
  'vegetationStamp',
  'hazardEmitter',
  'decor',
  'valve',
  'plug',
  'sensor',
  'counterweight',
  'relay',
] as const;

export type EditorObjectKind = (typeof EDITOR_OBJECT_KINDS)[number];

export const EDITOR_LINK_KINDS = ['triggerDoor', 'runeDoor', 'keyPortal', 'bossGate', 'logic'] as const;
export type EditorLinkKind = (typeof EDITOR_LINK_KINDS)[number];

export interface EditorObject {
  id: string;
  kind: EditorObjectKind;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  locked: boolean;
  hidden: boolean;
  /** Group membership: selecting one member selects the whole group. */
  group?: string;
  params: Record<string, unknown>;
}

export interface EditorLink {
  id: string;
  fromId: string;
  toId: string;
  kind: EditorLinkKind;
  logic?: 'and' | 'or' | 'sequence';
}

export interface EditorLight {
  id: string;
  x: number;
  y: number;
  color: string;
  intensity: number;
  radius: number;
  bloom: number;
  flicker: number;
  falloff: 'soft' | 'linear' | 'sharp';
  occluded: boolean;
  locked: boolean;
  hidden: boolean;
}

/**
 * A world's cells (authoring/worldLayer). Version 2 (has `paint`): the cells'
 * colours are `paint` applied to the grid, then `tints`, with `scars` flagged.
 * Version 1 (no `paint`): the frozen version-1 repaint from `biome` and
 * `paintSeed`, then a full `colors` plane or `colorOverrides` pairs.
 */
export interface EditorWorldLayer {
  rle: string;
  /** The world's biome (its identity; version 1 also painted from it). */
  biome?: BiomeId;
  /** World seed at capture time (identity; version 1's fallback paint seed). */
  seed?: number;
  /** Version 2: what the colours were painted from (sim/worldPaint), or a version-1 descriptor kept on re-save. */
  paint?: AnyWorldPaint;
  /** Version 2: packed runs of the cells whose colour differs from the paint (core/rle packColorDiffs). */
  tints?: string;
  /** Version 2: packed runs of the cells flagged as colour scars (core/rle packIndexRuns). */
  scars?: string;
  /** Version 2: packed runs of the non-zero life plane (core/rle packValueRuns). */
  lifeRuns?: string;
  /** Version 2: packed runs of the non-zero charge plane. */
  chargeRuns?: string;
  /** Version 1: CaveGenerator's material/crown paint seed. */
  paintSeed?: number;
  /** Version 1: [index, life] pairs. */
  life?: Array<[number, number]>;
  /** Version 1: [index, charge] pairs. */
  charge?: Array<[number, number]>;
  /** Version 1: a full packed-color plane, for a layer whose differences were not sparse. */
  colors?: string;
  /** Version 1: [index, colour] cells that differed from the repaint, each flagged as a scar. */
  colorOverrides?: Array<[number, number]>;
}

export interface ProceduralPass {
  id: string;
  pass: string;
  seed: number;
  params: Record<string, unknown>;
  appliedAt: string;
}

export interface EditorDocument {
  v: 2;
  id: string;
  name: string;
  biome: BiomeId;
  size: { w: number; h: number };
  world: EditorWorldLayer | null;
  objects: EditorObject[];
  links: EditorLink[];
  lights: EditorLight[];
  proceduralHistory: ProceduralPass[];
  validation: { at: string; errors: number; warnings: number } | null;
  /** Aesthetics metadata: ambient override (null = game default) and a free-form ambience tag. */
  mood?: { ambient: number | null; ambience: string };
  /** Document-owned parallax backdrop tuning; exported/shared with the level. */
  backdrop?: BackdropSettings;
  /** Optional level profile id used by Builder playtests of this document. */
  backdropProfileId?: string | null;
  /** Embedded assets referenced by visual decor objects. */
  assets?: { sprites: SpriteAsset[] };
}

let idCounter = 0;
export function freshId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
}

/** Read a numeric object param with a per-kind fallback. */
export function paramNum(o: EditorObject, key: string, fallback: number): number {
  const v = o.params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Largest an axis-aligned mechanism slab may span. */
const MAX_SLAB_DIM = 64;

function slabDim(o: EditorObject, key: string, fallback: number): number {
  return Math.max(1, Math.min(MAX_SLAB_DIM, Math.floor(paramNum(o, key, fallback))));
}

/**
 * World-cell bounding box of an object's structural footprint. Point objects
 * return null.
 */
export function objectFootprint(
  o: EditorObject,
): { x0: number; y0: number; x1: number; y1: number } | null {
  switch (o.kind) {
    case 'door':
      return { x0: o.x, y0: o.y, x1: o.x + slabDim(o, 'w', 3) - 1, y1: o.y + slabDim(o, 'h', 13) - 1 };
    case 'runeDoor':
      return { x0: o.x, y0: o.y, x1: o.x + slabDim(o, 'w', 2) - 1, y1: o.y + slabDim(o, 'h', 11) - 1 };
    case 'plate': {
      const hw = Math.floor(paramNum(o, 'w', 5) / 2);
      return { x0: o.x - hw, y0: o.y - 1, x1: o.x - hw + paramNum(o, 'w', 5) - 1, y1: o.y };
    }
    case 'scale': {
      const hw = Math.floor(paramNum(o, 'w', 7) / 2);
      return { x0: o.x - hw - 1, y0: o.y - 7, x1: o.x - hw + paramNum(o, 'w', 7), y1: o.y };
    }
    case 'buoy': {
      const half = Math.max(2, Math.floor(paramNum(o, 'w', 13) / 2));
      return { x0: o.x - half, y0: o.y - paramNum(o, 'depth', 4), x1: o.x + half, y1: o.y };
    }
    case 'exitWell': {
      const hw = paramNum(o, 'halfW', 14);
      return { x0: o.x - hw - 3, y0: o.y - 14, x1: o.x + hw + 3, y1: o.y + 13 };
    }
    case 'cauldron':
      return { x0: o.x - 4, y0: o.y - 5, x1: o.x + 4, y1: o.y };
    case 'valve':
      return { x0: o.x, y0: o.y, x1: o.x + slabDim(o, 'w', 5) - 1, y1: o.y + slabDim(o, 'h', 2) - 1 };
    case 'plug':
      return { x0: o.x, y0: o.y, x1: o.x + slabDim(o, 'w', 3) - 1, y1: o.y + slabDim(o, 'h', 3) - 1 };
    case 'counterweight': {
      const hw = Math.floor(paramNum(o, 'w', 7) / 2);
      return { x0: o.x - hw - 1, y0: o.y - 7, x1: o.x - hw + paramNum(o, 'w', 7), y1: o.y };
    }
    default:
      return null;
  }
}

export const AUTHORED_LIGHT_RADIUS_MIN = 4;
export const AUTHORED_LIGHT_RADIUS_MAX = 160;
export const AUTHORED_LIGHT_INTENSITY_MAX = 4;
export const AUTHORED_LIGHT_BLOOM_MAX = 2;
export const AUTHORED_LIGHT_FLICKER_MAX = 1;
export const AUTHORED_LIGHT_RUNTIME_CAP = 128;
