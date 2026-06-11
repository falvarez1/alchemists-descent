import { Cell } from '@/sim/CellType';

/**
 * Shared structural stamps for Builder objects that become real cells at
 * compile time (exit well, cauldron basin, buoy basin, rune pedestal/door).
 *
 * Both consumers go through the same functions so they can never drift:
 *  - compile.ts stamps into the live World (color-aware setter)
 *  - validate.ts stamps into a types-only scratch grid for reachability
 */

export type CellSetter = (x: number, y: number, t: number) => void;

/**
 * Exit well: open cased shaft from just above the seal down to the world
 * floor, stone plug (the lock — dig/blast it), approach pocket above the
 * mouth. Mirrors CaveGenerator's well exactly (halfW default 14, 14-row plug).
 */
export function stampExitWell(
  set: CellSetter,
  x: number,
  sealY: number,
  halfW: number,
  worldH: number,
): void {
  // shaft: cleared from a head-height mouth above the plug to the bottom
  for (let y = sealY - 6; y < worldH; y++) {
    for (let dx = -halfW; dx <= halfW; dx++) set(x + dx, y, Cell.Empty);
  }
  // indestructible casing so the plug cannot simply be walked around
  for (let y = sealY; y < worldH; y++) {
    for (let t = 1; t <= 3; t++) {
      set(x - halfW - t, y, Cell.Metal);
      set(x + halfW + t, y, Cell.Metal);
    }
  }
  // the plug: 14 rows of diggable/blastable stone — that IS the lock
  for (let y = sealY; y < Math.min(worldH, sealY + 14); y++) {
    for (let dx = -halfW; dx <= halfW; dx++) set(x + dx, y, Cell.Stone);
  }
  // approach pocket so the mouth is standable and findable
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const py = sealY - 8 + dy;
      if (dx * dx + dy * dy <= 100 && py < sealY) set(x + dx, py, Cell.Empty);
    }
  }
}

/**
 * Brewing basin: 9-wide stone base on the ground row, 2-tall side walls,
 * open 7x5 interior. Mirrors CaveGenerator's cauldron stamp; the runtime
 * cauldron point is (x, baseY - 1).
 */
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

/**
 * Sluice basin for a buoy: stone floor row with raised end walls, interior
 * cleared so poured liquid pools. Returns the structural body cells (the
 * fail-open skeleton) and the liquid sensing zone.
 */
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

/** Rune glyph pedestal: a short metal sill; the glyph hovers 2 cells above. */
export function stampRunePedestal(set: CellSetter, x: number, y: number): void {
  for (let dx = -2; dx <= 2; dx++) set(x + dx, y, Cell.Metal);
}

/**
 * Rune vault door: a solid stone slab (top-left anchored) that dissolves
 * bottom-up when the linked glyph is struck. Returns the door cells in the
 * order RuneVault dissolution expects (pop() takes the bottom rows first).
 */
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
