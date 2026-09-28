import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import { Cell } from '@/sim/CellType';
import { crystalColor, glassColor, goldColor, mirrorColor, packRGB, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import type { PlacementLedger } from '@/world/connect';
import type { ColdStoreSite } from '@/world/coldStore';

/* ============================================================
 * THE GLASS GALLERIES — the glassworks' dressing (wave 3).
 *
 * Real cells only, written into open space a body never needs (every stamp
 * keeps a body's clearance), on the level's own forked stream:
 *
 *  - SILVERED PANELS: tall mirrors let into the gallery walls. The wand's
 *    beam banks off them (sim/beam), so a dark gallery can be lit round a
 *    corner — and a Lenswright's lance can too.
 *  - CHANDELIERS: a brass chain from the vault and a spray of crystal drops,
 *    each drop a prism the beam splits in.
 *  - VITRINES: glass display cases on stone plinths, a specimen inside (a
 *    crystal, or gold) — glass shatters to a blast, and the case is yours.
 *  - WINDOWS: leaded glass let into thin rock between two open spaces — the
 *    light passes; a blast opens a way.
 *
 * Candidates are scanned once (every 3rd column) and walked in a shuffled
 * order, as the Cold Store's dressing does — never blind random probes.
 * ============================================================ */

interface Spot { x: number; y: number }

function t(world: World, x: number, y: number): number {
  return world.inBounds(x, y) ? world.types[x + y * WIDTH] : Cell.Wall;
}

function isRock(v: number): boolean {
  return v === Cell.Wall || v === Cell.Stone || v === Cell.RawOre || v === Cell.Crystal;
}

function put(world: World, x: number, y: number, type: number, color: number): void {
  if (x < 2 || y < 2 || x >= WIDTH - 2 || y >= HEIGHT - 8) return;
  const i = x + y * WIDTH;
  if (world.types[i] === Cell.Metal) return;
  world.types[i] = type;
  world.colors[i] = color;
  world.life[i] = 0;
  world.charge[i] = 0;
}

function openRun(world: World, x: number, y: number, dx: number, dy: number, cap: number): number {
  let k = 0;
  while (k < cap && t(world, x + dx * (k + 1), y + dy * (k + 1)) === Cell.Empty) k++;
  return k;
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
  }
  return list;
}

function clearOf(site: ColdStoreSite, ledger: PlacementLedger, x0: number, y0: number, x1: number, y1: number, pad = 6): boolean {
  if (ledger.intersects(x0 - pad, y0 - pad, x1 + pad, y1 + pad)) return false;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (Math.abs(cx - site.spawn.x) < 50 + (x1 - x0) / 2 && Math.abs(cy - site.spawn.y) < 50 + (y1 - y0) / 2) return false;
  if (Math.abs(cx - site.wellX) < 30 + (x1 - x0) / 2) return false;
  return !site.avoid.some((a) => Math.hypot(cx - a.x, cy - a.y) < a.r * 0.8 + Math.max(x1 - x0, y1 - y0) / 2);
}

function scan(world: World): { ceilings: Spot[]; floors: Spot[]; faces: Array<Spot & { side: number }> } {
  const ceilings: Spot[] = [], floors: Spot[] = [], faces: Array<Spot & { side: number }> = [];
  for (let x = 16; x < WIDTH - 16; x += 3) {
    for (let y = 24; y < HEIGHT - 20; y++) {
      if (world.types[x + y * WIDTH] !== Cell.Empty) continue;
      if (isRock(world.types[x + (y - 1) * WIDTH])) ceilings.push({ x, y });
      if (isRock(world.types[x + (y + 1) * WIDTH])) floors.push({ x, y });
      if (y % 4 === 0) {
        if (isRock(world.types[x - 1 + y * WIDTH])) faces.push({ x, y, side: -1 });
        else if (isRock(world.types[x + 1 + y * WIDTH])) faces.push({ x, y, side: 1 });
      }
    }
  }
  return { ceilings, floors, faces };
}

/* ---------------- silvered panels ---------------- */

/** A tall mirror silvered into a rock face: the face cells and one behind turn to Mirror. */
function silverPanels(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, faces: Array<Spot & { side: number }>, count: number): number {
  let placed = 0;
  const taken: Spot[] = [];
  for (const { x, y, side } of faces) {
    if (placed >= count) break;
    if (taken.some((p) => Math.abs(p.x - x) < 60 && Math.abs(p.y - y) < 40)) continue;
    const hgt = 10 + rng.int(10);
    // A flat face the whole height, a gallery's width of air in front of it.
    let flat = true;
    for (let k = 0; k < hgt && flat; k++) {
      if (t(world, x, y + k) !== Cell.Empty || !isRock(t(world, x + side, y + k)) || !isRock(t(world, x + side * 2, y + k))) flat = false;
    }
    if (!flat || openRun(world, x, y + (hgt >> 1), -side, 0, 60) < 26) continue;
    if (!clearOf(site, ledger, x - 3, y, x + 3, y + hgt, 1)) continue;
    for (let k = 0; k < hgt; k++) {
      put(world, x + side, y + k, Cell.Mirror, mirrorColor());
      put(world, x + side * 2, y + k, Cell.Mirror, mirrorColor());
    }
    // A brass frame top and bottom.
    for (const Y of [y - 1, y + hgt]) {
      if (isRock(t(world, x + side, Y))) put(world, x + side, Y, Cell.Gold, packRGB(168, 128, 56));
    }
    taken.push({ x, y });
    placed++;
  }
  return placed;
}

/* ---------------- chandeliers ---------------- */

function chandeliers(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, ceilings: Spot[], count: number): number {
  let placed = 0;
  const taken: Spot[] = [];
  for (const { x, y } of ceilings) {
    if (placed >= count) break;
    if (taken.some((p) => Math.abs(p.x - x) < 80 && Math.abs(p.y - y) < 60)) continue;
    if (t(world, x, y) !== Cell.Empty || !isRock(t(world, x, y - 1))) continue;
    const drop = openRun(world, x, y - 1, 0, 1, 90);
    const chain = 4 + rng.int(6);
    if (drop < chain + 8 + 28) continue; // a body always passes under
    if (openRun(world, x, y + chain, -1, 0, 20) < 12 || openRun(world, x, y + chain, 1, 0, 20) < 12) continue;
    if (!clearOf(site, ledger, x - 7, y, x + 7, y + chain + 8, 1)) continue;
    for (let k = 0; k < chain; k++) put(world, x, y + k, Cell.Metal, k % 2 ? packRGB(150, 116, 52) : packRGB(110, 84, 40));
    // The ring and the drops: a crown of crystal prisms hanging from it.
    const ry = y + chain;
    for (let dx = -4; dx <= 4; dx++) put(world, x + dx, ry, Cell.Metal, packRGB(172, 134, 60));
    for (let dx = -4; dx <= 4; dx += 2) {
      const len = 2 + ((dx + 4) % 4 === 0 ? 3 : 1) + rng.int(2);
      for (let k = 1; k <= len; k++) put(world, x + dx, ry + k, Cell.Crystal, k === len ? packRGB(240, 236, 255) : crystalColor());
    }
    taken.push({ x, y });
    placed++;
  }
  return placed;
}

/* ---------------- vitrines ---------------- */

function vitrines(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, floors: Spot[], count: number): number {
  let placed = 0;
  const taken: Spot[] = [];
  const W = 5, H = 6;
  for (const { x, y } of floors) {
    if (placed >= count) break;
    if (taken.some((p) => Math.abs(p.x - x) < 70 && Math.abs(p.y - y) < 40)) continue;
    // A long flat floor (a gallery's), the case well inside it, headroom above.
    let flat = true;
    for (let dx = -W - 12; dx <= W + 12 && flat; dx++) {
      if (t(world, x + dx, y) !== Cell.Empty || !isRock(t(world, x + dx, y + 1))) flat = false;
    }
    if (!flat || openRun(world, x, y + 1, 0, -1, 60) < 40) continue;
    if (!clearOf(site, ledger, x - W - 2, y - H - 2, x + W + 2, y + 1, 2)) continue;
    // Plinth, glass case, specimen.
    for (let dx = -W; dx <= W; dx++) put(world, x + dx, y, Cell.Stone, stoneColor());
    for (let k = 1; k <= H; k++) {
      for (let dx = -W; dx <= W; dx++) {
        const edge = Math.abs(dx) === W || k === H;
        if (edge) put(world, x + dx, y - k, Cell.Glass, glassColor());
      }
    }
    if (rng.next() < 0.45) {
      put(world, x, y - 1, Cell.Gold, goldColor());
      put(world, x - 1, y - 1, Cell.Gold, goldColor());
      put(world, x + 1, y - 1, Cell.Gold, goldColor());
      put(world, x, y - 2, Cell.Gold, goldColor());
    } else {
      put(world, x, y - 1, Cell.Crystal, crystalColor());
      put(world, x, y - 2, Cell.Crystal, crystalColor());
      put(world, x - 1, y - 1, Cell.Crystal, crystalColor());
      put(world, x + 1, y - 2, Cell.Crystal, packRGB(236, 230, 255));
    }
    taken.push({ x, y });
    placed++;
  }
  return placed;
}

/* ---------------- windows ---------------- */

/** Leaded glass let into thin rock between two open spaces (a wall 3..7 thick). */
function windows(world: World, rng: Rng, site: ColdStoreSite, ledger: PlacementLedger, faces: Array<Spot & { side: number }>, count: number): number {
  let placed = 0;
  const taken: Spot[] = [];
  for (const { x, y, side } of faces) {
    if (placed >= count) break;
    if (taken.some((p) => Math.abs(p.x - x) < 120 && Math.abs(p.y - y) < 80)) continue;
    let thick = 0;
    while (thick < 9 && isRock(t(world, x + side * (thick + 1), y))) thick++;
    if (thick < 3 || thick > 7) continue;
    if (t(world, x + side * (thick + 1), y) !== Cell.Empty) continue;
    const hgt = 8 + rng.int(6);
    // The same thin wall the whole height, air both sides.
    let ok = true;
    for (let k = 0; k < hgt && ok; k++) {
      if (t(world, x, y + k) !== Cell.Empty || t(world, x + side * (thick + 1), y + k) !== Cell.Empty) ok = false;
      for (let d = 1; d <= thick && ok; d++) if (!isRock(t(world, x + side * d, y + k))) ok = false;
    }
    if (!ok) continue;
    const X0 = Math.min(x + side, x + side * thick), X1 = Math.max(x + side, x + side * thick);
    if (!clearOf(site, ledger, X0 - 2, y, X1 + 2, y + hgt, 1)) continue;
    for (let k = 0; k < hgt; k++) {
      for (let X = X0; X <= X1; X++) {
        // Leading: a darker came every fourth row.
        const lead = k % 4 === 0 && X !== X0 && X !== X1;
        put(world, X, y + k, Cell.Glass, lead ? packRGB(120, 132, 140) : glassColor());
      }
    }
    taken.push({ x, y });
    placed++;
  }
  return placed;
}

export interface GalleriesDressing {
  panels: number;
  chandeliers: number;
  vitrines: number;
  windows: number;
}

/** The Glass Galleries' dressing, on the level's own forked stream. */
export function dressGlassGalleries(world: World, rng: Rng, ledger: PlacementLedger, site: ColdStoreSite): GalleriesDressing {
  const found = scan(world);
  shuffle(found.ceilings, rng);
  shuffle(found.floors, rng);
  shuffle(found.faces, rng);
  return {
    windows: windows(world, rng, site, ledger, found.faces, 8),
    panels: silverPanels(world, rng, site, ledger, found.faces, 22),
    vitrines: vitrines(world, rng, site, ledger, found.floors, 14),
    chandeliers: chandeliers(world, rng, site, ledger, found.ceilings, 18),
  };
}
