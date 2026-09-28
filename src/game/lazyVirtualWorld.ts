import type * as VirtualWorld from '@/world/virtual';

export type VirtualWorldModule = typeof VirtualWorld;

/**
 * The chunked virtual world prototype (world/virtual, ~55 KB), loaded on
 * demand. Only authoring surfaces reach it — the run launcher's virtual-world
 * test runs and the Builder's virtual preview — so a player build never
 * fetches it; an authoring build asks for it at boot (game/Game), long before
 * anyone can pick it. Levels reads the module synchronously from here.
 */
let loaded: VirtualWorldModule | null = null;
let pending: Promise<VirtualWorldModule | null> | null = null;

export function loadVirtualWorld(): Promise<VirtualWorldModule | null> {
  pending ??= import('@/world/virtual').then(
    (mod) => (loaded = mod),
    (error: unknown) => {
      console.warn('[levels] the virtual world could not load', error);
      return null;
    },
  );
  return pending;
}

/** The loaded module, or null (asking starts the load). */
export function virtualWorldModule(): VirtualWorldModule | null {
  if (!loaded) void loadVirtualWorld();
  return loaded;
}
