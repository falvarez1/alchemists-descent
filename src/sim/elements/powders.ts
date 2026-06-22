import type { Ctx, MaterialParams } from '@/core/types';
import { Cell, isGas, isLiquid } from '@/sim/CellType';
import { fireColor, glassColor } from '@/sim/colors';
import { IGNITION_OFFSETS } from '@/sim/neighborOffsets';

/* ===================== Element Physics Behaviors ===================== */

const DEFAULT_GUNPOWDER_CLUMP_SCAN_RADIUS = 4;
const DEFAULT_GUNPOWDER_CLUMP_MIN_MASS = 13; // a radius-2 dot, not a radius-1 brush trail
const DEFAULT_GUNPOWDER_CLUMP_MIN_SPAN = 5;
const DEFAULT_GUNPOWDER_CLUMP_MAX_ANISOTROPY = 2.5;
const DEFAULT_GUNPOWDER_FUSE_CADENCE = 4;
const DEFAULT_GUNPOWDER_BLAST_RADIUS = 38;

function powderCanPass(t: number): boolean {
  return t === Cell.Empty || (isLiquid(t) && t !== Cell.Lava) || isGas(t);
}

function gunpowderNumberParam(ctx: Ctx, key: keyof MaterialParams, fallback: number): number {
  const value = ctx.params.materials[Cell.Gunpowder]?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function gunpowderIntParam(ctx: Ctx, key: keyof MaterialParams, fallback: number, min = 1): number {
  return Math.max(min, Math.round(gunpowderNumberParam(ctx, key, fallback)));
}

function countLocalGunpowder(ctx: Ctx, x: number, y: number): number {
  const w = ctx.world;
  const scanRadius = gunpowderIntParam(ctx, 'clumpScanRadius', DEFAULT_GUNPOWDER_CLUMP_SCAN_RADIUS);
  let count = 0;
  for (let oy = -scanRadius; oy <= scanRadius; oy++) {
    for (let ox = -scanRadius; ox <= scanRadius; ox++) {
      const nx = x + ox;
      const ny = y + oy;
      if (w.inBounds(nx, ny) && w.types[w.idx(nx, ny)] === Cell.Gunpowder) count++;
    }
  }
  return count;
}

function gunpowderBlastRadius(ctx: Ctx, localMass: number): number {
  const cap = gunpowderNumberParam(ctx, 'blastRadius', DEFAULT_GUNPOWDER_BLAST_RADIUS);
  return Math.min(cap, 12 + localMass * 4);
}

function isPackedGunpowderClump(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  const scanRadius = gunpowderIntParam(ctx, 'clumpScanRadius', DEFAULT_GUNPOWDER_CLUMP_SCAN_RADIUS);
  const minMass = gunpowderIntParam(ctx, 'clumpMinMass', DEFAULT_GUNPOWDER_CLUMP_MIN_MASS);
  const minSpan = gunpowderIntParam(ctx, 'clumpMinSpan', DEFAULT_GUNPOWDER_CLUMP_MIN_SPAN);
  const maxAnisotropy = Math.max(
    1,
    gunpowderNumberParam(ctx, 'clumpMaxAnisotropy', DEFAULT_GUNPOWDER_CLUMP_MAX_ANISOTROPY),
  );
  let mass = 0;
  let minX = x;
  let maxX = x;
  let minY = y;
  let maxY = y;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  for (let oy = -scanRadius; oy <= scanRadius; oy++) {
    for (let ox = -scanRadius; ox <= scanRadius; ox++) {
      const nx = x + ox;
      const ny = y + oy;
      if (!w.inBounds(nx, ny) || w.types[w.idx(nx, ny)] !== Cell.Gunpowder) continue;
      mass++;
      if (nx < minX) minX = nx;
      if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny;
      if (ny > maxY) maxY = ny;
      sumX += nx;
      sumY += ny;
      sumXX += nx * nx;
      sumYY += ny * ny;
      sumXY += nx * ny;
    }
  }

  if (mass < minMass) return false;
  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  if (spanX < minSpan || spanY < minSpan) return false;

  const invMass = 1 / mass;
  const meanX = sumX * invMass;
  const meanY = sumY * invMass;
  const varX = sumXX * invMass - meanX * meanX;
  const varY = sumYY * invMass - meanY * meanY;
  const cov = sumXY * invMass - meanX * meanY;
  const trace = varX + varY;
  const determinant = varX * varY - cov * cov;
  const root = Math.sqrt(Math.max(0, trace * trace * 0.25 - determinant));
  const major = trace * 0.5 + root;
  const minor = trace * 0.5 - root;
  if (minor <= 0.01) return false;

  return major / minor <= maxAnisotropy;
}

export function igniteGunpowder(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return;
  const i = w.idx(x, y);
  if (w.types[i] !== Cell.Gunpowder) return;

  const localMass = countLocalGunpowder(ctx, x, y);
  if (isPackedGunpowderClump(ctx, x, y)) {
    ctx.explosions.trigger(x, y, gunpowderBlastRadius(ctx, localMass));
    return;
  }

  // Thin trails should burn as a visible fuse, not flash-convert the whole line
  // in one frame. Stagger by cell coordinate so a brush stroke catches in a
  // rolling front while packed clumps above still detonate immediately.
  const frame = ctx.state?.frameCount;
  const cadence = gunpowderIntParam(ctx, 'fuseCadence', DEFAULT_GUNPOWDER_FUSE_CADENCE);
  if (frame !== undefined && cadence > 1 && (frame + x + y) % cadence !== 0) return;

  w.replaceCellAt(i, Cell.Fire, fireColor());
  w.life[i] = 34 + localMass * 8 + Math.floor(Math.random() * 16);
  w.moved[i] = w.movedTick;
}

/** Falling-powder behavior shared by SAND and GOLD (type selects the params). */
export function handleSand(ctx: Ctx, x: number, y: number, type: Cell): void {
  const w = ctx.world;
  // Intense heat or a strong electrical charge fuses sand into glass
  if (type === Cell.Sand) {
    const i = w.idx(x, y);
    if (w.charge[i] > 6 && Math.random() < 0.22) {
      w.replaceCellAt(i, Cell.Glass, glassColor());
      return;
    }
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!w.inBounds(nx, ny)) continue;
      const ni = w.idx(nx, ny);
      const n = w.types[ni];
      const fuseChance =
        n === Cell.Lava ? 0.22 :
        n === Cell.Fire || n === Cell.Ember ? 0.08 :
        n === Cell.Coal && w.life[ni] > 0 ? 0.12 :
        0;
      if (fuseChance > 0 && Math.random() < fuseChance) {
        w.replaceCellAt(i, Cell.Glass, glassColor());
        return;
      }
    }
  }
  const passRate = ctx.params.materials[type].densityWeight!;
  if (w.inBounds(x, y + 1) && powderCanPass(w.types[w.idx(x, y + 1)]) && Math.random() < passRate) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[type].friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && powderCanPass(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
    if (w.inBounds(x - dir, y + 1) && powderCanPass(w.types[w.idx(x - dir, y + 1)])) {
      w.swap(x, y, x - dir, y + 1);
      return;
    }
  }
}

export function handleGunpowder(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Indexed loop over the offset constant — hot per-cell path.
  for (let k = 0; k < IGNITION_OFFSETS.length; k++) {
    const o = IGNITION_OFFSETS[k];
    const tx = x + o[0];
    const ty = y + o[1];
    if (
      w.inBounds(tx, ty) &&
      (w.types[w.idx(tx, ty)] === Cell.Fire || w.charge[w.idx(tx, ty)] > 0)
    ) {
      igniteGunpowder(ctx, x, y);
      return;
    }
  }
  if (w.inBounds(x, y + 1) && powderCanPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[Cell.Gunpowder].friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && powderCanPass(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
    if (w.inBounds(x - dir, y + 1) && powderCanPass(w.types[w.idx(x - dir, y + 1)])) {
      w.swap(x, y, x - dir, y + 1);
      return;
    }
  }
}
