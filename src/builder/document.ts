import type { BiomeId, Ctx } from '@/core/types';
import { base64ToBytes, bytesToBase64, rleDecode, rleEncode } from '@/core/rle';
import {
  applyWorldLayer as applyNeutralWorldLayer,
  captureWorldLayer as captureNeutralWorldLayer,
  decodeColorPlaneInto,
  encodeColorPlane,
  isBiomeId,
} from '@/authoring/worldLayer';
import { HEIGHT, WIDTH } from '@/config/constants';
import { BIOMES } from '@/config/biomes';
import { createDefaultBackdropSettings, sanitizeBackdropSettings } from '@/config/backdrop';
import { Cell, CELL_COUNT } from '@/sim/CellType';
import {
  AUTHORED_LIGHT_BLOOM_MAX,
  AUTHORED_LIGHT_FLICKER_MAX,
  AUTHORED_LIGHT_INTENSITY_MAX,
  AUTHORED_LIGHT_RADIUS_MAX,
  AUTHORED_LIGHT_RADIUS_MIN,
  EDITOR_LINK_KINDS,
  EDITOR_OBJECT_KINDS,
  freshId,
  objectFootprint,
} from '@/authoring/document';
import type {
  EditorDocument,
  EditorLight,
  EditorLink,
  EditorObject,
  EditorObjectKind,
  EditorWorldLayer,
  ProceduralPass,
} from '@/authoring/document';
import { sanitizeSpriteAsset } from '@/authoring/sprites';
import type { SpriteAsset } from '@/authoring/sprites';
export {
  AUTHORED_LIGHT_BLOOM_MAX,
  AUTHORED_LIGHT_FLICKER_MAX,
  AUTHORED_LIGHT_INTENSITY_MAX,
  AUTHORED_LIGHT_RADIUS_MAX,
  AUTHORED_LIGHT_RADIUS_MIN,
  AUTHORED_LIGHT_RUNTIME_CAP,
  EDITOR_LINK_KINDS,
  EDITOR_OBJECT_KINDS,
  freshId,
  objectFootprint,
  paramNum,
} from '@/authoring/document';
export type {
  EditorDocument,
  EditorLight,
  EditorLink,
  EditorObject,
  EditorObjectKind,
  EditorWorldLayer,
  ProceduralPass,
} from '@/authoring/document';

/**
 * Builder compatibility module. The durable authored-content contracts live in
 * `authoring/document`; this file owns Builder-specific capture, persistence,
 * and share-code sanitization.
 */

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
    backdrop: createDefaultBackdropSettings(),
    backdropProfileId: null,
  };
}

/**
 * Ctx-shaped wrappers over the neutral world-layer codec.
 *
 * The codec itself moved to `src/authoring/worldLayer.ts` because AuthorLink
 * needs it too and `src/net` may not import `src/builder`. These wrappers keep
 * every existing Builder call site (capture, save, share code, playtest
 * compile) on the same signature it always had.
 */

/** Snapshot the LIVE world cells into the document's terrain layer. */
export function captureWorldLayer(ctx: Ctx): EditorWorldLayer {
  const paintSeed = ctx.worldgen?.paintSeed;
  return captureNeutralWorldLayer({
    world: ctx.world,
    biome: ctx.state.currentBiome,
    seed: ctx.state.worldSeed >>> 0,
    paintSeed: typeof paintSeed === 'number' && Number.isFinite(paintSeed) ? paintSeed : null,
  });
}

/** Decode the document terrain into the LIVE world (colors regenerate). */
export function applyWorldLayer(ctx: Ctx, layer: EditorWorldLayer): void {
  applyNeutralWorldLayer(
    { world: ctx.world, biome: ctx.state.currentBiome, seed: ctx.state.worldSeed >>> 0 },
    layer,
  );
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
const DOC_OBJECT_CAP = 4_096;
const DOC_LINK_CAP = 8_192;
const DOC_LIGHT_CAP = 1_024;
const DOC_PROCEDURAL_CAP = 256;
const DOC_SPRITE_CAP = 512;
const DOC_SPARSE_CAP = 500_000;
const SHARE_COMPRESSED_MAX_BYTES = 2_000_000;
const SHARE_JSON_MAX_BYTES = 12_000_000;

const OBJECT_KINDS = new Set<EditorObjectKind>(EDITOR_OBJECT_KINDS);
const LINK_KINDS = new Set<EditorLink['kind']>(EDITOR_LINK_KINDS);
const LINK_LOGICS = new Set<NonNullable<EditorLink['logic']>>(['and', 'or', 'sequence']);
const LIGHT_FALLOFFS = new Set<EditorLight['falloff']>(['soft', 'linear', 'sharp']);

const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(value)));
const clampNum = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function safeId(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().slice(0, 96).replace(/[^\w:.-]/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function safeName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;
}

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
        const doc = sanitizeImportedDoc(JSON.parse(localStorage.getItem(storageKey)!));
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

function uniqueId(raw: unknown, fallbackPrefix: string, used: Set<string>): string {
  const base = safeId(raw, `${fallbackPrefix}-${used.size}`).replace(/[^\w:.-]/g, '-');
  let id = base;
  let n = 1;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, 128).map((item) => sanitizeJsonValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, 128)) {
      out[key.slice(0, 80)] = sanitizeJsonValue(nested, depth + 1);
    }
    return out;
  }
  return null;
}

function sanitizeParams(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (sanitizeJsonValue(value) as Record<string, unknown>)
    : {};
}

function sanitizeSparsePairs(
  pairs: unknown,
  maxEntries: number,
  minValue: number,
  maxValue: number,
): Array<[number, number]> | undefined {
  if (!Array.isArray(pairs)) return undefined;
  const out: Array<[number, number]> = [];
  const seen = new Set<number>();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || !num(pair[0]) || !num(pair[1])) continue;
    const i = Math.floor(pair[0]);
    if (i < 0 || i >= WIDTH * HEIGHT || seen.has(i)) continue;
    seen.add(i);
    out.push([i, clampInt(pair[1], minValue, maxValue)]);
    if (out.length >= maxEntries) break;
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeWorldLayer(value: unknown): EditorWorldLayer | null {
  const layer = value as EditorWorldLayer;
  if (!layer || typeof layer !== 'object' || typeof layer.rle !== 'string') return null;
  const decoded = new Uint8Array(WIDTH * HEIGHT);
  let claimed: number;
  try {
    claimed = rleDecode(layer.rle, decoded);
  } catch {
    return null;
  }
  // Reject a terrain layer whose run total doesn't cover exactly the grid (the
  // prefab path guards this too) — a mismatch means corrupt/foreign data that
  // would silently mis-decode into a half-empty world.
  if (claimed !== WIDTH * HEIGHT) return null;
  // Drop any off-palette id (>= CELL_COUNT) so a hostile/stale rle can't smuggle
  // a value whose high bit corrupts the GPU-compose charge channel. Re-encode
  // ONLY when something changed, so a clean doc keeps its exact rle (and the
  // content signature derived from it).
  let dirty = false;
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i] >= CELL_COUNT) {
      decoded[i] = Cell.Empty;
      dirty = true;
    }
  }
  return {
    rle: dirty ? rleEncode(decoded) : layer.rle,
    ...(isBiomeId(layer.biome) ? { biome: layer.biome } : {}),
    ...(num(layer.seed) ? { seed: Math.floor(layer.seed) >>> 0 } : {}),
    ...(num(layer.paintSeed) ? { paintSeed: clampInt(layer.paintSeed, 0, 99999) } : {}),
    life: sanitizeSparsePairs(layer.life, DOC_SPARSE_CAP, -32768, 32767),
    charge: sanitizeSparsePairs(layer.charge, DOC_SPARSE_CAP, 0, 65535),
    colors: sanitizeColorPlane(layer.colors),
    colorOverrides: sanitizeSparsePairs(layer.colorOverrides, DOC_SPARSE_CAP, 0, 0xffffff),
  };
}

function sanitizeColorPlane(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const colors = new Uint32Array(WIDTH * HEIGHT);
  return decodeColorPlaneInto(value, colors) ? encodeColorPlane(colors) : undefined;
}

function sanitizeObject(raw: unknown, usedIds: Set<string>): EditorObject | null {
  const o = raw as EditorObject;
  if (!o || typeof o !== 'object' || !OBJECT_KINDS.has(o.kind) || !num(o.x) || !num(o.y)) return null;
  return {
    id: uniqueId(o.id, o.kind, usedIds),
    kind: o.kind,
    x: clampInt(o.x, 0, WIDTH - 1),
    y: clampInt(o.y, 0, HEIGHT - 1),
    rotation: o.rotation === 90 || o.rotation === 180 || o.rotation === 270 ? o.rotation : 0,
    locked: o.locked === true,
    hidden: o.hidden === true,
    ...(typeof o.group === 'string' && o.group.trim() ? { group: o.group.trim().slice(0, 96) } : {}),
    params: sanitizeParams(o.params),
  };
}

function sanitizeLink(raw: unknown, objectIds: ReadonlySet<string>, usedIds: Set<string>): EditorLink | null {
  const l = raw as EditorLink;
  if (
    !l ||
    typeof l !== 'object' ||
    !LINK_KINDS.has(l.kind) ||
    !objectIds.has(l.fromId) ||
    !objectIds.has(l.toId)
  ) {
    return null;
  }
  return {
    id: uniqueId(l.id, 'link', usedIds),
    fromId: l.fromId,
    toId: l.toId,
    kind: l.kind,
    ...(l.logic && LINK_LOGICS.has(l.logic) ? { logic: l.logic } : {}),
  };
}

function sanitizeLight(raw: unknown, usedIds: Set<string>): EditorLight | null {
  const light = raw as EditorLight;
  if (!light || typeof light !== 'object' || !num(light.x) || !num(light.y)) return null;
  if (light.radius !== undefined && (!num(light.radius) || light.radius <= 0)) return null;
  const color = typeof light.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(light.color) ? light.color : '#ffb060';
  return {
    id: uniqueId(light.id, 'light', usedIds),
    x: clampInt(light.x, 0, WIDTH - 1),
    y: clampInt(light.y, 0, HEIGHT - 1),
    color,
    intensity: num(light.intensity) ? clampNum(light.intensity, 0, AUTHORED_LIGHT_INTENSITY_MAX) : 1,
    radius: num(light.radius) ? clampNum(light.radius, AUTHORED_LIGHT_RADIUS_MIN, AUTHORED_LIGHT_RADIUS_MAX) : 60,
    bloom: num(light.bloom) ? clampNum(light.bloom, 0, AUTHORED_LIGHT_BLOOM_MAX) : 0,
    flicker: num(light.flicker) ? clampNum(light.flicker, 0, AUTHORED_LIGHT_FLICKER_MAX) : 0,
    falloff: LIGHT_FALLOFFS.has(light.falloff) ? light.falloff : 'soft',
    occluded: light.occluded !== false,
    locked: light.locked === true,
    hidden: light.hidden === true,
  };
}

function sanitizeProceduralPass(raw: unknown, usedIds: Set<string>): ProceduralPass | null {
  const pass = raw as ProceduralPass;
  if (!pass || typeof pass !== 'object' || typeof pass.pass !== 'string' || !pass.pass.trim()) return null;
  return {
    id: uniqueId(pass.id, 'proc', usedIds),
    pass: pass.pass.trim().slice(0, 80),
    seed: num(pass.seed) ? pass.seed >>> 0 : 0,
    params: sanitizeParams(pass.params),
    appliedAt: typeof pass.appliedAt === 'string' && pass.appliedAt ? pass.appliedAt.slice(0, 64) : new Date(0).toISOString(),
  };
}

/**
 * Validate-then-accept for imported JSON: defaults for optional families,
 * and the terrain layer must decode cleanly into a scratch buffer BEFORE
 * the document is allowed to replace the open one. Returns null on garbage.
 */
export function sanitizeImportedDoc(parsed: unknown): EditorDocument | null {
  const raw = parsed as EditorDocument;
  if (!raw || typeof raw !== 'object' || raw.v !== 2 || !Array.isArray(raw.objects)) return null;
  const size = raw.size && num(raw.size.w) && num(raw.size.h)
    ? { w: Math.floor(raw.size.w), h: Math.floor(raw.size.h) }
    : { w: WIDTH, h: HEIGHT };
  if (size.w !== WIDTH || size.h !== HEIGHT) return null;

  // ONE id namespace across every record family — validateDocument pools
  // object/link/light ids into a single set and flags any cross-family
  // collision as a playtest-blocker, so the importer must enforce the same
  // global uniqueness (per-family sets would let an object and a light share an
  // id that then fails validation). `objectIds` stays separate: it is the set
  // of final OBJECT ids used to verify link endpoints actually exist.
  const usedIds = new Set<string>();
  const objects = raw.objects
    .slice(0, DOC_OBJECT_CAP)
    .map((object) => sanitizeObject(object, usedIds))
    .filter((object): object is EditorObject => object !== null);
  const objectIds = new Set<string>(objects.map((o) => o.id));
  const links = Array.isArray(raw.links)
    ? raw.links
        .slice(0, DOC_LINK_CAP)
        .map((link) => sanitizeLink(link, objectIds, usedIds))
        .filter((link): link is EditorLink => link !== null)
    : [];
  const lights = Array.isArray(raw.lights)
    ? raw.lights
        .slice(0, DOC_LIGHT_CAP)
        .map((light) => sanitizeLight(light, usedIds))
        .filter((light): light is EditorLight => light !== null)
    : [];
  const proceduralHistory = Array.isArray(raw.proceduralHistory)
    ? raw.proceduralHistory
        .slice(0, DOC_PROCEDURAL_CAP)
        .map((pass) => sanitizeProceduralPass(pass, usedIds))
        .filter((pass): pass is ProceduralPass => pass !== null)
    : [];

  const mood = raw.mood && typeof raw.mood === 'object'
    ? {
        ambient: num(raw.mood.ambient) ? clampNum(raw.mood.ambient, 0.02, 0.6) : null,
        ambience: typeof raw.mood.ambience === 'string' ? raw.mood.ambience.slice(0, 80) : '',
      }
    : { ambient: null, ambience: '' };
  const validation = raw.validation && typeof raw.validation === 'object'
    ? {
        at: typeof raw.validation.at === 'string' ? raw.validation.at.slice(0, 64) : '',
        errors: num(raw.validation.errors) ? Math.max(0, Math.floor(raw.validation.errors)) : 0,
        warnings: num(raw.validation.warnings) ? Math.max(0, Math.floor(raw.validation.warnings)) : 0,
      }
    : null;

  const doc: EditorDocument = {
    v: 2,
    id: safeId(raw.id, freshId('doc')),
    name: safeName(raw.name, 'imported'),
    biome: BIOMES[raw.biome as BiomeId] ? raw.biome as BiomeId : 'earthen',
    size,
    world: raw.world ? sanitizeWorldLayer(raw.world) : null,
    objects,
    links,
    lights,
    proceduralHistory,
    validation,
    mood,
    backdrop: sanitizeBackdropSettings(raw.backdrop),
    backdropProfileId: typeof raw.backdropProfileId === 'string' && raw.backdropProfileId ? raw.backdropProfileId.slice(0, 96) : null,
  };
  if (raw.world && !doc.world) return null;
  // Embedded sprite assets: validate-then-accept each one; garbage entries
  // drop out individually, an empty/invalid block drops the field entirely.
  if (raw.assets && Array.isArray((raw.assets as { sprites?: unknown }).sprites)) {
    const sprites = ((raw.assets as { sprites: unknown[] }).sprites)
      .slice(0, DOC_SPRITE_CAP)
      .map(sanitizeSpriteAsset)
      .filter((s): s is SpriteAsset => s !== null);
    if (sprites.length > 0) doc.assets = { sprites };
  } else {
    delete doc.assets;
  }
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
    if (trimmed.length > SHARE_COMPRESSED_MAX_BYTES) return null;
    const bin = atob(trimmed.slice(SHARE_PREFIX.length));
    if (bin.length > SHARE_COMPRESSED_MAX_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const json = await new Response(stream).text();
    if (json.length > SHARE_JSON_MAX_BYTES) return null;
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
