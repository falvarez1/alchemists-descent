import type { World } from '@/sim/World';
import { createCellPatch, type CellPatch } from '@/authoring/cellPatch';

/** Tracks the last SENT grid, not the last rendered grid. Transport backpressure
 * must be checked before capture. A full baseline recovers any missing delta. */
export class TerrainReplicator {
  private types = new Uint8Array(0);
  private colors = new Uint32Array(0);
  private life = new Int16Array(0);
  private charge = new Uint16Array(0);
  capture(world: World, baseline: boolean): CellPatch {
    const size = world.types.length;
    if (this.types.length !== size) {
      this.types = new Uint8Array(size);
      this.colors = new Uint32Array(size);
      this.life = new Int16Array(size);
      this.charge = new Uint16Array(size);
      baseline = true;
    }
    const patch = createCellPatch();
    const { types, colors, life, charge } = world;
    // Keep raw plane writes observable: simulation hot loops may bypass activity
    // tracking. Unchanged cells need no shadow writes or patch allocations.
    for (let i = 0; i < size; i++) {
      const t = types[i], c = colors[i], l = life[i], q = charge[i];
      if (
        baseline
          ? t === 0 && l === 0 && q === 0
          : t === this.types[i] && c === this.colors[i] && l === this.life[i] && q === this.charge[i]
      ) continue;
      patch.idxs.push(i);
      patch.types.push(t);
      patch.colors.push(c);
      patch.life.push(l);
      patch.charge.push(q);
      this.types[i] = t;
      this.colors[i] = c;
      this.life[i] = l;
      this.charge[i] = q;
    }
    if (baseline) {
      this.types.set(types);
      this.colors.set(colors);
      this.life.set(life);
      this.charge.set(charge);
    }
    return patch;
  }
}
