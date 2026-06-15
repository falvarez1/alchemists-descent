import type { EditorDocument, EditorObject } from '@/builder/document';
import type { RuntimeSprite } from '@/core/types';
import {
  decodeRuntimeSprite,
  freshSpriteId,
  sanitizeSpriteAsset,
  spriteContentSig,
} from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';

/**
 * Sprite asset storage + document embedding. Per-key localStorage (one key
 * per sprite — the document-library convention: quota failures and
 * corruption stay per-asset), and the SAVE/EXPORT/SHARE embedding contract:
 * a document carries EXACTLY the sprites its decor objects reference, so a
 * share code or .json is self-contained on another machine, while unused
 * library sprites never bloat it. IMPORT merges embedded sprites back into
 * the local library (id collision with different content re-ids the
 * incoming sprite and remaps the document's references).
 */

const SPRITE_PREFIX = 'noita-builder-sprite:';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSprites(): SpriteAsset[] {
  const store = storage();
  const out: SpriteAsset[] = [];
  if (!store) return out;
  try {
    for (let n = 0; n < store.length; n++) {
      const key = store.key(n);
      if (!key || !key.startsWith(SPRITE_PREFIX)) continue;
      try {
        const got = sanitizeSpriteAsset(JSON.parse(store.getItem(key)!));
        if (got) out.push(got);
      } catch {
        // one corrupt sprite must not take the library down
      }
    }
  } catch {
    return out;
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return out;
}

export function saveSprite(s: SpriteAsset): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(SPRITE_PREFIX + s.id, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function deleteSprite(id: string): void {
  try {
    storage()?.removeItem(SPRITE_PREFIX + id);
  } catch {
    // nothing to do — the key is already unreachable
  }
}

export function getStoredSprite(id: string): SpriteAsset | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SPRITE_PREFIX + id);
    return raw ? sanitizeSpriteAsset(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** The decor object's sprite reference, or null for legacy note decor. */
export function decorSpriteId(o: EditorObject): string | null {
  if (o.kind !== 'decor') return null;
  const id = o.params.spriteId;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * Exactly the sprites this document's decor objects reference, resolved
 * library-first (the library copy is the freshest — emissive edits land
 * there) with the document's own embedded copies as fallback.
 */
export function collectReferencedSprites(
  doc: EditorDocument,
  library: SpriteAsset[],
  options: { preferEmbedded?: boolean } = {},
): SpriteAsset[] {
  const wanted = new Set<string>();
  for (const o of doc.objects) {
    const id = decorSpriteId(o);
    if (id) wanted.add(id);
  }
  const out: SpriteAsset[] = [];
  for (const id of wanted) {
    const fromLib = library.find((s) => s.id === id);
    const fromDoc = doc.assets?.sprites.find((s) => s.id === id);
    const hit = options.preferEmbedded === true ? fromDoc ?? fromLib : fromLib ?? fromDoc;
    if (hit) out.push(hit);
    // a dangling reference embeds nothing — compile skips it the same way
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** SAVE/EXPORT/SHARE step: embed referenced sprites (or drop the field). */
export function embedSprites(doc: EditorDocument, library: SpriteAsset[], options: { preferEmbedded?: boolean } = {}): number {
  const sprites = collectReferencedSprites(doc, library, options);
  if (sprites.length > 0) doc.assets = { sprites };
  else delete doc.assets;
  return sprites.length;
}

/**
 * IMPORT step: merge embedded sprites into the local library. Same id +
 * same content = already here; same id + DIFFERENT content = the incoming
 * sprite gets a fresh id and every decor reference in the document is
 * remapped (the local sprite is never clobbered).
 */
export function mergeEmbeddedSprites(doc: EditorDocument): { added: number; reIded: number } {
  let added = 0,
    reIded = 0;
  const sprites = doc.assets?.sprites ?? [];
  for (let i = 0; i < sprites.length; i++) {
    let sprite = sprites[i];
    const existing = getStoredSprite(sprite.id);
    if (existing && spriteContentSig(existing) === spriteContentSig(sprite)) continue;
    if (existing) {
      const oldId = sprite.id;
      sprite = { ...sprite, id: freshSpriteId() };
      sprites[i] = sprite;
      for (const o of doc.objects) {
        if (decorSpriteId(o) === oldId) o.params.spriteId = sprite.id;
      }
      reIded++;
    }
    if (saveSprite(sprite)) added++;
  }
  return { added, reIded };
}

/* ---------------- instantiation-time resolution ---------------- */

export interface ResolvedSprite {
  asset: SpriteAsset;
  sprite: RuntimeSprite;
}

/**
 * Resolve a decor's spriteId for instantiation: local library first (the
 * freshest copy for Builder-side sprite edits), then document-embedded assets
 * as the shared/imported fallback. Decoded ONCE per cache — thirty torches
 * share one set of frame buffers. Unresolvable ids cache null: a missing
 * visual must never break compile or generation.
 */
export function resolveRuntimeSprite(
  spriteId: string,
  docSprites: SpriteAsset[] | undefined,
  cache: Map<string, ResolvedSprite | null>,
): ResolvedSprite | null {
  const hit = cache.get(spriteId);
  if (hit !== undefined) return hit;
  const asset = getStoredSprite(spriteId) ?? docSprites?.find((s) => s.id === spriteId);
  const resolved = asset ? { asset, sprite: decodeRuntimeSprite(asset) } : null;
  cache.set(spriteId, resolved);
  return resolved;
}
