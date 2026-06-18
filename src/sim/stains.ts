import { Cell } from '@/sim/CellType';
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import type { World } from '@/sim/World';

const BLOOD_DRY_SURFACE_SCAN_LIMIT = 24;
const drySurfaceScanX = new Int32Array(BLOOD_DRY_SURFACE_SCAN_LIMIT);
const drySurfaceScanY = new Int32Array(BLOOD_DRY_SURFACE_SCAN_LIMIT);

const DRY_SURFACE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function isBloodDrySurface(t: number): boolean {
  return t === Cell.Wall || t === Cell.Wood || t === Cell.Stone || t === Cell.Ice || t === Cell.Metal;
}

/**
 * Blood should dry on real terrain, not on a single airborne stone fleck that a
 * gore particle happened to deposit. Metal is treated as engineered support;
 * other materials must be part of a substantial connected surface.
 */
export function canDryBloodOnSurface(world: World, x: number, y: number): boolean {
  if (!world.inBounds(x, y)) return false;
  const startType = world.types[world.idx(x, y)];
  if (!isBloodDrySurface(startType)) return false;
  if (startType === Cell.Metal || y >= world.height - 1) return true;

  drySurfaceScanX[0] = x;
  drySurfaceScanY[0] = y;
  let head = 0;
  let tail = 1;

  while (head < tail) {
    const cx = drySurfaceScanX[head];
    const cy = drySurfaceScanY[head];
    head++;

    for (const [dx, dy] of DRY_SURFACE_DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!world.inBounds(nx, ny)) continue;
      const nt = world.types[world.idx(nx, ny)];
      if (!isBloodDrySurface(nt)) continue;
      if (nt === Cell.Metal || ny >= world.height - 1) return true;

      let dup = false;
      for (let q = 0; q < tail; q++) {
        if (drySurfaceScanX[q] === nx && drySurfaceScanY[q] === ny) {
          dup = true;
          break;
        }
      }
      if (dup) continue;

      drySurfaceScanX[tail] = nx;
      drySurfaceScanY[tail] = ny;
      tail++;
      if (tail >= BLOOD_DRY_SURFACE_SCAN_LIMIT) return true;
    }
  }

  return false;
}

/**
 * Blood (and other splatter) soaks into terrain as a permanent tint.
 * Only sturdy materials hold a stain; everything else churns too much.
 */
export function stainCell(
  world: World,
  x: number,
  y: number,
  sr: number,
  sg: number,
  sb: number,
  k: number,
): void {
  if (!world.inBounds(x, y)) return;
  const i = world.idx(x, y);
  const t = world.types[i];
  if (t !== Cell.Wall && t !== Cell.Wood && t !== Cell.Stone && t !== Cell.Ice) return;
  const c = world.colors[i];
  world.colors[i] = packRGB(
    Math.floor(unpackR(c) + (sr - unpackR(c)) * k),
    Math.floor(unpackG(c) + (sg - unpackG(c)) * k),
    Math.floor(unpackB(c) + (sb - unpackB(c)) * k),
  );
  world.colorOverrides.add(i);
}

/** Spray a disc of blood stains with density falling off toward the rim. */
export function splatterStain(world: World, cx: number, cy: number, r: number): void {
  cx = Math.floor(cx);
  cy = Math.floor(cy);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      if (Math.random() > 0.55 * (1 - d2 / (r * r))) continue;
      stainCell(world, cx + dx, cy + dy, 118, 14, 20, 0.3 + Math.random() * 0.3);
    }
  }
}
