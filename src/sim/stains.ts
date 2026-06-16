import { Cell } from '@/sim/CellType';
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import type { World } from '@/sim/World';

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
