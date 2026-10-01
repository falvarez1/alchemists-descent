import type { FighterId } from '@/content/fighters';
import type { FighterKitDef } from '@/fighters/kit';

/**
 * The ten kits, one module per fighter (`kits/<id>.ts`, exporting `kit: FighterKitDef`). They are loaded
 * on demand, one small chunk each, so a player who never picks a fighter downloads none of them; the
 * roster preloads the one that was chosen (`kitFor` returns the cached definition synchronously once it
 * has loaded). A fighter whose kit file does not exist yet still equips (its look, no abilities), which is
 * how the roster lands before every kit does; tests/fighters-roster.test.ts requires all ten.
 */
const loaders = import.meta.glob<{ kit?: FighterKitDef }>(['./*.ts', '!./index.ts']);

const cache = new Map<FighterId, FighterKitDef>();

export function kitFor(id: FighterId): FighterKitDef | Promise<FighterKitDef | undefined> | undefined {
  const hit = cache.get(id);
  if (hit) return hit;
  const load = loaders[`./${id}.ts`];
  if (!load) return undefined;
  return load().then((m) => {
    if (m.kit) cache.set(id, m.kit);
    return m.kit;
  });
}

/** The ids that have a kit module on disk (the roster test and the console read this). */
export function kitIds(): FighterId[] {
  return Object.keys(loaders).map((p) => p.replace(/^\.\//, '').replace(/\.ts$/, '') as FighterId);
}
