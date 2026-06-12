import type { BiomeId, Ctx } from '@/core/types';
import { base64ToBytes, bytesToBase64, rleDecode, rleEncode, sparsePairs } from '@/core/rle';
import { HEIGHT, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { sanitizeSpriteAsset } from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';

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
  | 'decor'
  // machine primitives (docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md):
  // valve/relay receive links like doors; sensor/counterweight/plug emit
  | 'valve'
  | 'plug'
  | 'sensor'
  | 'counterweight'
  | 'relay';

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
  /** Aesthetics metadata: ambient override (null = game default) and a
   *  free-form ambience tag. Compiled playtests apply the ambient. */
  mood?: { ambient: number | null; ambience: string };
  /** Embedded assets (additive, v stays 2 — old loaders ignore the field).
   *  SAVE/EXPORT/SHARE embed exactly the sprites referenced by decor
   *  objects (spritelib.embedSprites); IMPORT merges them into the local
   *  library. Old builds open such docs fine — sprite decor compiles to
   *  nothing there, which is safe: decor is visual-only by invariant. */
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

/**
 * World-cell bounding box of an object's structural footprint (door slabs,
 * sensor basins, the well shaft mouth...). Point objects return null.
 * Shared by the editor canvas (hit test + outline boxes), validation
 * (closed-door stamping), and anything that needs "how big is this thing".
 */
export function objectFootprint(
  o: EditorObject,
): { x0: number; y0: number; x1: number; y1: number } | null {
  switch (o.kind) {
    case 'door':
      return { x0: o.x, y0: o.y, x1: o.x + paramNum(o, 'w', 3) - 1, y1: o.y + paramNum(o, 'h', 13) - 1 };
    case 'runeDoor':
      return { x0: o.x, y0: o.y, x1: o.x + paramNum(o, 'w', 2) - 1, y1: o.y + paramNum(o, 'h', 11) - 1 };
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
      return { x0: o.x, y0: o.y, x1: o.x + paramNum(o, 'w', 5) - 1, y1: o.y + paramNum(o, 'h', 2) - 1 };
    case 'plug':
      return { x0: o.x, y0: o.y, x1: o.x + paramNum(o, 'w', 3) - 1, y1: o.y + paramNum(o, 'h', 3) - 1 };
    case 'counterweight': {
      // mirrors makeCounterweight: pan row + 4-tall lips at both ends
      const hw = Math.floor(paramNum(o, 'w', 7) / 2);
      return { x0: o.x - hw - 1, y0: o.y - 7, x1: o.x - hw + paramNum(o, 'w', 7), y1: o.y };
    }
    default:
      return null;
  }
}

/**
 * Cells the playtest-scar BAKE must never fossilize into terrain: the
 * compiler re-stamps every mechanism, so a baked door slab would outlive a
 * deleted door. Footprinted kinds use their structural box; the exit well
 * extends to the world floor (its cased shaft runs all the way down, plus
 * the approach pocket above the footprint); footprint-less mechanism
 * fixtures (lever bracket, brazier bowl, charge pedestal, rune pedestal)
 * get a small box around their stamped bodies.
 */
export function bakeExclusionMask(
  objects: EditorObject[],
  width: number,
  height: number,
): Uint8Array {
  const skip = new Uint8Array(width * height);
  const mark = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) {
        skip[x + y * width] = 1;
      }
    }
  };
  for (const o of objects) {
    if (o.hidden) continue;
    const f = objectFootprint(o);
    if (f) {
      // stampExitWell carves/cases from the approach pocket to the bottom
      if (o.kind === 'exitWell') mark(f.x0, f.y0 - 4, f.x1, height - 1);
      else mark(f.x0, f.y0, f.x1, f.y1);
    } else if (
      o.kind === 'lever' ||
      o.kind === 'brazier' ||
      o.kind === 'chargeLatch' ||
      o.kind === 'runeGlyph' ||
      o.kind === 'relay'
    ) {
      mark(o.x - 3, o.y - 2, o.x + 3, o.y + 1);
    }
  }
  return skip;
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
    mood: { ambient: null, ambience: '' },
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

/**
 * One localStorage key per document. A captured world layer serializes to
 * several hundred KB, so a single monolithic blob would hit the ~5MB quota
 * after a handful of documents — and one corrupt byte would eat the whole
 * library. Per-doc keys make quota failures and corruption per-document.
 */
const LEGACY_DOCS_KEY = 'noita-builder-docs';
const DOC_PREFIX = 'noita-builder-doc:';

function migrateLegacyLibrary(): void {
  try {
    const raw = localStorage.getItem(LEGACY_DOCS_KEY);
    if (!raw) return;
    const lib = JSON.parse(raw) as Record<string, EditorDocument>;
    for (const [id, doc] of Object.entries(lib)) {
      if (!localStorage.getItem(DOC_PREFIX + id)) {
        localStorage.setItem(DOC_PREFIX + id, JSON.stringify(doc));
      }
    }
    localStorage.removeItem(LEGACY_DOCS_KEY);
  } catch {
    // a corrupt legacy blob stays where it is; per-doc keys still work
  }
}

export function loadDocLibrary(): Record<string, EditorDocument> {
  migrateLegacyLibrary();
  const lib: Record<string, EditorDocument> = {};
  try {
    for (let n = 0; n < localStorage.length; n++) {
      const storageKey = localStorage.key(n);
      if (!storageKey || !storageKey.startsWith(DOC_PREFIX)) continue;
      try {
        const doc = JSON.parse(localStorage.getItem(storageKey)!) as EditorDocument;
        if (doc && doc.v === 2) lib[doc.id] = doc;
      } catch {
        // one corrupt document must not take the library down
      }
    }
  } catch {
    return lib;
  }
  return lib;
}

export function saveDocToLibrary(doc: EditorDocument): boolean {
  try {
    localStorage.setItem(DOC_PREFIX + doc.id, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate-then-accept for imported JSON: defaults for optional families,
 * and the terrain layer must decode cleanly into a scratch buffer BEFORE
 * the document is allowed to replace the open one. Returns null on garbage.
 */
export function sanitizeImportedDoc(parsed: unknown): EditorDocument | null {
  const doc = parsed as EditorDocument;
  if (!doc || doc.v !== 2 || !Array.isArray(doc.objects)) return null;
  doc.name = typeof doc.name === 'string' && doc.name.trim() ? doc.name : 'imported';
  doc.id = typeof doc.id === 'string' && doc.id ? doc.id : freshId('doc');
  doc.biome = (doc.biome ?? 'earthen') as BiomeId;
  doc.size = doc.size ?? { w: WIDTH, h: HEIGHT };
  doc.links = Array.isArray(doc.links) ? doc.links : [];
  doc.lights = Array.isArray(doc.lights) ? doc.lights : [];
  doc.proceduralHistory = Array.isArray(doc.proceduralHistory) ? doc.proceduralHistory : [];
  doc.validation = doc.validation ?? null;
  doc.mood = doc.mood && typeof doc.mood === 'object' ? doc.mood : { ambient: null, ambience: '' };
  // Embedded sprite assets: validate-then-accept each one; garbage entries
  // drop out individually, an empty/invalid block drops the field entirely.
  if (doc.assets && Array.isArray((doc.assets as { sprites?: unknown }).sprites)) {
    const sprites = ((doc.assets as { sprites: unknown[] }).sprites)
      .map(sanitizeSpriteAsset)
      .filter((s): s is SpriteAsset => s !== null);
    if (sprites.length > 0) doc.assets = { sprites };
    else delete doc.assets;
  } else {
    delete doc.assets;
  }
  if (doc.world) {
    if (typeof doc.world.rle !== 'string') return null;
    if (doc.size.w !== WIDTH || doc.size.h !== HEIGHT) return null;
    try {
      rleDecode(doc.world.rle, new Uint8Array(WIDTH * HEIGHT));
    } catch {
      return null;
    }
  } else {
    doc.world = null;
  }
  return doc;
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

/* ---------------- shareable level codes ---------------- */

const SHARE_PREFIX = 'PLLD1.';

/** Compress the document into a pasteable code (deflate + base64). */
export async function docToShareCode(doc: EditorDocument): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  return SHARE_PREFIX + bytesToBase64(packed);
}

/** Decode + sanitize a share code; null on anything malformed. */
export async function shareCodeToDoc(code: string): Promise<EditorDocument | null> {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(SHARE_PREFIX)) return null;
    const bin = atob(trimmed.slice(SHARE_PREFIX.length));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const json = await new Response(stream).text();
    return sanitizeImportedDoc(JSON.parse(json));
  } catch {
    return null;
  }
}

/* ---------------- explicit world-index helpers for probes/tests ---------------- */

export function decodeTypes(layer: EditorWorldLayer): Uint8Array {
  const out = new Uint8Array(WIDTH * HEIGHT);
  rleDecode(layer.rle, out);
  return out;
}

export { base64ToBytes };
