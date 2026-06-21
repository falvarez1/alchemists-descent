import { Cell } from '@/sim/CellType';

/**
 * Shared structural stamps for authored objects that become real cells at
 * compile time.
 */

export type CellSetter = (x: number, y: number, t: number) => void;

export function stampExitWell(
  set: CellSetter,
  x: number,
  sealY: number,
  halfW: number,
  worldH: number,
): void {
  for (let y = sealY - 6; y < worldH; y++) {
    for (let dx = -halfW; dx <= halfW; dx++) set(x + dx, y, Cell.Empty);
  }
  for (let y = sealY; y < worldH; y++) {
    for (let t = 1; t <= 3; t++) {
      set(x - halfW - t, y, Cell.Metal);
      set(x + halfW + t, y, Cell.Metal);
    }
  }
  for (let y = sealY; y < Math.min(worldH, sealY + 14); y++) {
    for (let dx = -halfW; dx <= halfW; dx++) set(x + dx, y, Cell.Stone);
  }
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const py = sealY - 8 + dy;
      if (dx * dx + dy * dy <= 100 && py < sealY) set(x + dx, py, Cell.Empty);
    }
  }
}

export function stampCauldron(set: CellSetter, x: number, baseY: number): void {
  for (let dy = 1; dy <= 5; dy++) {
    for (let dx = -4; dx <= 4; dx++) set(x + dx, baseY - dy, Cell.Empty);
  }
  for (let dx = -4; dx <= 4; dx++) set(x + dx, baseY, Cell.Stone);
  for (let t = 1; t <= 2; t++) {
    set(x - 4, baseY - t, Cell.Stone);
    set(x + 4, baseY - t, Cell.Stone);
  }
}

export function stampBuoyBasin(
  set: CellSetter,
  x: number,
  floorY: number,
  w: number,
  depth: number,
): { body: Array<[number, number]>; zone: { x0: number; y0: number; x1: number; y1: number } } {
  const half = Math.max(2, Math.floor(w / 2));
  const body: Array<[number, number]> = [];
  for (let dy = 1; dy <= depth; dy++) {
    for (let dx = -half + 1; dx <= half - 1; dx++) set(x + dx, floorY - dy, Cell.Empty);
  }
  for (let dx = -half; dx <= half; dx++) {
    set(x + dx, floorY, Cell.Stone);
    body.push([x + dx, floorY]);
  }
  for (const dx of [-half, half]) {
    for (let dy = 1; dy <= depth; dy++) {
      set(x + dx, floorY - dy, Cell.Stone);
      body.push([x + dx, floorY - dy]);
    }
  }
  return {
    body,
    zone: { x0: x - half + 1, y0: floorY - depth, x1: x + half - 1, y1: floorY - 1 },
  };
}

export function stampRunePedestal(set: CellSetter, x: number, y: number): void {
  for (let dx = -2; dx <= 2; dx++) set(x + dx, y, Cell.Metal);
}

export function stampRuneDoor(
  set: CellSetter,
  x: number,
  y: number,
  w: number,
  h: number,
): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      set(x + dx, y + dy, Cell.Stone);
      cells.push([x + dx, y + dy]);
    }
  }
  return cells;
}

