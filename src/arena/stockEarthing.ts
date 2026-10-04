import { type StockStageDef } from '@/config/stockStage';
import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

/**
 * A competitive stage is earthed (IMPLEMENTATION-PLAN.md: "competitive variants have stable collision and hazards off").
 * Its hull is blast-proof Metal, and Metal conducts: one lightning cast would otherwise electrify the whole deck under
 * both fighters (status.ts counts a charged conductor underfoot as contact). Charge that reaches a stage hull cell drains
 * at the end of the tick, before the next tick's bodies sample their contact; every other conductor (a puddle, a loose
 * plate, blood) keeps its current. Walks only the sparse charged index. Returns how many cells it drained.
 */
export function earthStockStage(world: World, stage: StockStageDef): number {
  const charged = world.activeCharges;
  if (!charged || charged.size === 0) return 0;
  const slabs = [stage.main, ...stage.platforms], width = world.width;
  let drained = 0;
  for (const i of [...charged]) {
    if (world.types[i] !== Cell.Metal) continue;
    const x = i % width, y = (i - x) / width;
    if (!slabs.some(s => x >= s.x0 && x <= s.x1 && y >= s.y && y < s.y + s.depth)) continue;
    world.clearChargeAt(i); drained++;
  }
  return drained;
}
