import type { BiomeId, Ctx } from '@/core/types';
import { base64ToBytes, rleDecode, rleEncode, sparsePairs } from '@/core/rle';
import { HEIGHT, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';

/**
 * EditorDocument v2 (docs/BUILDER.md): the durable authoring layer. The
 * document stores design INTENT — terrain as a layer, every non-cell thing
 * as an object record, links/lights as their own records. Playtest compiles
 * a runtime from it; runtime scars never flow back unless explicitly baked.
 *
 * Phase status: objects (spawn/enemy/pickup/portal/waystone) are live;
 * links (Phase 6), lights (Phase 7), and procedural history (Phase 8) are
 * carried in the schema so later phases slot in without migration.
 */

export type EditorObjectKind =
  | 'spawn'
  | 'enemy'
  | 'pickup'
  | 'exitPortal'
  | 'waystone'
  // reserved for later phases (schema-stable, not yet placeable)
  | 'exitWell'
  | 'cauldron'
  | 'door'
  | 'plate'
  | 'lever'
  | 'brazier'
  | 'scale'
  | 'buoy'
  | 'chargeLatch'
  | 'runeGlyph'
  | 'runeDoor'
  | 'bossMarker'
  | 'terrainStamp'
  | 'vegetationStamp'
  | 'hazardEmitter'
  | 'decor';

export interface EditorObject {
  id: string;
  kind: EditorObjectKind;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  locked: boolean;
  hidden: boolean;
  params: Record<string, unknown>;
}

export interface EditorLink {
  id: string;
  fromId: string;
  toId: string;
  kind: 'triggerDoor' | 'runeDoor' | 'keyPortal' | 'bossGate' | 'logic';
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

export interface EditorWorldLayer {
  rle: string;
  life?: Array<[number, number]>;
  charge?: Array<[number, number]>;
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
}

let idCounter = 0;
export function freshId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
}

export function createEmptyDocument(name: string, biome: BiomeId): EditorDocument {
  return {
    v: 2,
    id: freshId('doc'),
    name,
    biome,
    size: { w: WIDTH, h: HEIGHT },
    world: null,
    objects: [],
    links: [],
    lights: [],
    proceduralHistory: [],
    validation: null,
  };
}

/** Snapshot the LIVE world cells into the document's terrain layer. */
export function captureWorldLayer(ctx: Ctx): EditorWorldLayer {
  const w = ctx.world;
  // Transient life on fire/smoke is noise; keep authored life (wells, fungus energy).
  const life: Array<[number, number]> = [];
  for (let i = 0; i < w.life.length && life.length < 60000; i++) {
    if (w.life[i] === 0) continue;
    const t = w.types[i];
    if (t === Cell.Fire || t === Cell.Ember || t === Cell.Smoke || t === Cell.Steam) continue;
    life.push([i, w.life[i]]);
  }
  return {
    rle: rleEncode(w.types),
    life,
    charge: sparsePairs(w.charge, 20000),
  };
}

/** Decode the document terrain into the LIVE world (colors regenerate). */
export function applyWorldLayer(ctx: Ctx, layer: EditorWorldLayer): void {
  const w = ctx.world;
  w.clear();
  rleDecode(layer.rle, w.types);
  for (let i = 0; i < w.types.length; i++) {
    const t = w.types[i];
    if (t === Cell.Empty) continue;
    const fn = COLOR_FN[t];
    w.colors[i] = fn ? fn() : EMPTY_COLOR;
  }
  for (const [i, v] of layer.life ?? []) w.life[i] = v;
  for (const [i, v] of layer.charge ?? []) w.charge[i] = v;
  for (const [i, c] of layer.colorOverrides ?? []) w.colors[i] = c;
}

/* ---------------- document library (localStorage) ---------------- */

const DOCS_KEY = 'noita-builder-docs';

export function loadDocLibrary(): Record<string, EditorDocument> {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, EditorDocument>) : {};
  } catch {
    return {};
  }
}

export function saveDocLibrary(lib: Record<string, EditorDocument>): boolean {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}

/** Migrate a Sandbox raw-grid save (LevelStore v1) into a Builder document. */
export function migrateSandboxSave(
  name: string,
  save: { v: 1; biome: string; rle: string; life: Array<[number, number]>; charge: Array<[number, number]> },
): EditorDocument {
  const doc = createEmptyDocument(name, save.biome as BiomeId);
  doc.world = { rle: save.rle, life: save.life, charge: save.charge };
  return doc;
}

/* ---------------- explicit world-index helpers for probes/tests ---------------- */

export function decodeTypes(layer: EditorWorldLayer): Uint8Array {
  const out = new Uint8Array(WIDTH * HEIGHT);
  rleDecode(layer.rle, out);
  return out;
}

export { base64ToBytes };
