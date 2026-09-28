import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';

/** Established habitat plants are mature. Freshly cast/planted cells keep the
 * normal energy-driven growth rules; generation is not a giant growth spell. */
export function matureVegetation(world: World): void {
  const types = world.types, life = world.life;
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    if (type === Cell.Vines || type === Cell.Moss || type === Cell.Fungus || type === Cell.Grass) life[i] = -1;
  }
}
