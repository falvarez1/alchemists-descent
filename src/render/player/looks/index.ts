import type { FighterId } from '@/content/fighters';
import type { FighterLook } from '@/render/player/fighterLook';

/**
 * The ten looks, one module per fighter (`looks/<id>.ts`, exporting `look: FighterLook`). They are small and
 * the renderer needs them the moment a fighter is on screen, so they load with the render layer. A fighter
 * with no look file draws as the classic Alchemist until its look lands.
 */
const modules = import.meta.glob<{ look?: FighterLook }>(['./*.ts', '!./index.ts'], { eager: true });

const LOOKS = new Map<FighterId, FighterLook>();
for (const mod of Object.values(modules)) if (mod.look) LOOKS.set(mod.look.id, mod.look);

export function lookFor(id: FighterId): FighterLook | undefined {
  return LOOKS.get(id);
}

export function lookIds(): FighterId[] {
  return [...LOOKS.keys()];
}
