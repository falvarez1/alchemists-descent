import type { RuntimeSprite } from '@/core/types';
import { decodeRuntimeSprite } from '@/authoring/sprites';
import type { SpriteAsset } from '@/authoring/sprites';

export interface ResolvedSprite {
  asset: SpriteAsset;
  sprite: RuntimeSprite;
}

export type SpriteAssetLookup = (id: string) => SpriteAsset | null;

/**
 * Resolve a decor sprite for instantiation. The optional lookup lets Builder
 * pass its local library resolver without making runtime import Builder
 * storage. Document-embedded sprites remain the portable fallback.
 */
export function resolveRuntimeSprite(
  spriteId: string,
  docSprites: SpriteAsset[] | undefined,
  cache: Map<string, ResolvedSprite | null>,
  lookup?: SpriteAssetLookup,
): ResolvedSprite | null {
  const hit = cache.get(spriteId);
  if (hit !== undefined) return hit;
  const asset = lookup?.(spriteId) ?? docSprites?.find((s) => s.id === spriteId);
  const resolved = asset ? { asset, sprite: decodeRuntimeSprite(asset) } : null;
  cache.set(spriteId, resolved);
  return resolved;
}

