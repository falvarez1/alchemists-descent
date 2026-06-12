import { Rng } from '@/core/rng';
import { blocksEntity, Cell, isLiquid, isSolid } from '@/sim/CellType';
import type { World } from '@/sim/World';
import type { BiomeId } from '@/core/types';
import { BIOMES } from '@/config/biomes';
import {
  crownDeepTint,
  crownFringeTint,
  crownTopColor,
  mossUnderColor,
} from '@/world/crownPalette';
import { writeCell } from '@/builder/terrain';
import type { PatchRecorder, Region } from '@/builder/terrain';

/**
 * Procedural authoring passes (docs/BUILDER.md Phase 8): named, seeded,
 * region-bounded. Cell passes run through the PatchRecorder so a pass is one
 * undoable patch with a preview/apply/discard lifecycle; population passes
 * return object placements the Builder lands as one composite command.
 *
 * Every pass is deterministic for (seed, region, density, material) — the
 * applied history entry in the document is enough to reproduce it.
 */

export interface PassInput {
  world: World;
  rec: PatchRecorder;
  rng: Rng;
  /** The raw seed, for passes that hash coordinates (crownTint) instead of
   *  consuming the stream. */
  seed: number;
  region: Region;
  /** True when (x, y) is inside the target (bbox + optional polygon/magic mask). */
  inRegion(x: number, y: number): boolean;
  /** 0..1 strength/coverage knob. */
  density: number;
  /** Current sandbox material, for passes that paint one. */
  material: number;
  /** Document biome — drives biome-aware paints (crown palette). */
  biome: BiomeId;
}

export interface PassResult {
  summary: string;
  objects?: Array<{
    kind: 'enemy' | 'pickup';
    x: number;
    y: number;
    params: Record<string, unknown>;
  }>;
}

export interface PassDef {
  id: string;
  label: string;
  usesMaterial: boolean;
  /** Cell passes preview/discard; object passes apply directly (undoable). */
  cells: boolean;
  run(p: PassInput): PassResult;
}

const area = (r: Region): number => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);

/** Editable terrain only: caves remodel rock and air, never authored materials. */
const remodelable = (t: number): boolean => t === Cell.Wall || t === Cell.Empty;

function cavesPass(p: PassInput): PassResult {
  const { world, rec, rng, region, density } = p;
  const w = region.x1 - region.x0 + 1;
  const h = region.y1 - region.y0 + 1;
  // 1 = solid. Locked cells (authored materials) read as their blocking state
  // and are never written.
  const grid = new Uint8Array(w * h);
  const locked = new Uint8Array(w * h);
  const solidChance = 1 - (0.3 + density * 0.32);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = world.types[world.idx(region.x0 + x, region.y0 + y)];
      const i = x + y * w;
      if (!p.inRegion(region.x0 + x, region.y0 + y) || !remodelable(t)) {
        locked[i] = 1;
        grid[i] = blocksEntity(t) ? 1 : 0;
      } else {
        grid[i] = rng.next() < solidChance ? 1 : 0;
      }
    }
  }
  // cellular-automata smoothing: 4 passes of majority rule
  const scratch = new Uint8Array(w * h);
  for (let it = 0; it < 4; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = x + y * w;
        if (locked[i]) {
          scratch[i] = grid[i];
          continue;
        }
        let solid = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx,
              ny = y + dy;
            // outside the region counts as solid: caves seal at their borders
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) solid++;
            else solid += grid[nx + ny * w];
          }
        }
        scratch[i] = solid >= 5 ? 1 : solid <= 2 ? 0 : grid[i];
      }
    }
    grid.set(scratch);
  }
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (locked[i]) continue;
      const X = region.x0 + x,
        Y = region.y0 + y;
      const want = grid[i] === 1 ? Cell.Wall : Cell.Empty;
      if (world.types[world.idx(X, Y)] !== want) {
        writeCell(world, rec, X, Y, want);
        changed++;
      }
    }
  }
  return { summary: `caves: remodeled ${changed} cells` };
}

function veinsPass(p: PassInput): PassResult {
  const { world, rec, rng, region, density, material } = p;
  const count = Math.max(1, Math.round((area(region) / 4000) * (0.4 + density * 2)));
  let placed = 0;
  for (let v = 0; v < count; v++) {
    // find a solid start
    let sx = -1,
      sy = -1;
    for (let t = 0; t < 60; t++) {
      const x = region.x0 + rng.int(region.x1 - region.x0 + 1);
      const y = region.y0 + rng.int(region.y1 - region.y0 + 1);
      if (p.inRegion(x, y) && isSolid(world.types[world.idx(x, y)])) {
        sx = x;
        sy = y;
        break;
      }
    }
    if (sx < 0) continue;
    let x = sx,
      y = sy,
      ang = rng.next() * Math.PI * 2;
    const len = 30 + rng.int(60);
    for (let s = 0; s < len; s++) {
      ang += (rng.next() - 0.5) * 0.9;
      x += Math.cos(ang) * 1.4;
      y += Math.sin(ang) * 1.4;
      const ix = Math.round(x),
        iy = Math.round(y);
      if (ix < region.x0 || ix > region.x1 || iy < region.y0 || iy > region.y1) break;
      for (let dy = 0; dy <= (rng.next() < 0.4 ? 1 : 0); dy++) {
        for (let dx = 0; dx <= (rng.next() < 0.4 ? 1 : 0); dx++) {
          if (p.inRegion(ix + dx, iy + dy) && isSolid(world.types[world.idx(ix + dx, iy + dy)])) {
            writeCell(world, rec, ix + dx, iy + dy, material);
            placed++;
          }
        }
      }
    }
  }
  return { summary: `veins: ${count} veins, ${placed} cells` };
}

function pocketsPass(p: PassInput): PassResult {
  const { world, rec, rng, region, density, material } = p;
  const count = Math.max(1, Math.round((area(region) / 9000) * (0.4 + density * 2)));
  let placed = 0;
  for (let b = 0; b < count; b++) {
    let cx = -1,
      cy = -1;
    for (let t = 0; t < 60; t++) {
      const x = region.x0 + rng.int(region.x1 - region.x0 + 1);
      const y = region.y0 + rng.int(region.y1 - region.y0 + 1);
      if (p.inRegion(x, y) && isSolid(world.types[world.idx(x, y)])) {
        cx = x;
        cy = y;
        break;
      }
    }
    if (cx < 0) continue;
    const r = 3 + rng.int(6);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d > 1 - rng.next() * 0.25) continue;
        const X = cx + dx,
          Y = cy + dy;
        if (X < region.x0 || X > region.x1 || Y < region.y0 || Y > region.y1) continue;
        if (p.inRegion(X, Y) && isSolid(world.types[world.idx(X, Y)])) {
          writeCell(world, rec, X, Y, material);
          placed++;
        }
      }
    }
  }
  return { summary: `pockets: ${count} pockets, ${placed} cells` };
}

function vegetationPass(p: PassInput): PassResult {
  const { world, rec, rng, region, density } = p;
  let moss = 0,
    vines = 0;
  for (let y = Math.max(1, region.y0); y <= Math.min(world.height - 2, region.y1); y++) {
    for (let x = Math.max(1, region.x0); x <= Math.min(world.width - 2, region.x1); x++) {
      const i = world.idx(x, y);
      if (!p.inRegion(x, y) || world.types[i] !== Cell.Empty) continue;
      // moss carpets sunlit floors
      const below = world.types[world.idx(x, y + 1)];
      if ((below === Cell.Wall || below === Cell.Stone) && rng.next() < density * 0.4) {
        writeCell(world, rec, x, y + 1, Cell.Moss);
        moss++;
        continue;
      }
      // vines hang from ceilings
      const above = world.types[world.idx(x, y - 1)];
      if ((above === Cell.Wall || above === Cell.Stone) && rng.next() < density * 0.12) {
        const len = 2 + rng.int(5);
        for (let d = 0; d < len; d++) {
          if (y + d >= world.height - 1) break;
          if (world.types[world.idx(x, y + d)] !== Cell.Empty) break;
          writeCell(world, rec, x, y + d, Cell.Vines);
          vines++;
        }
      }
    }
  }
  return { summary: `vegetation: ${moss} moss, ${vines} vine cells` };
}

function scatterPass(p: PassInput): PassResult {
  const { world, rec, rng, region, density, material } = p;
  let placed = 0;
  for (let y = Math.max(1, region.y0); y <= Math.min(world.height - 2, region.y1); y++) {
    for (let x = Math.max(1, region.x0); x <= Math.min(world.width - 2, region.x1); x++) {
      if (!p.inRegion(x, y) || world.types[world.idx(x, y)] !== Cell.Empty) continue;
      if (!blocksEntity(world.types[world.idx(x, y + 1)])) continue;
      if (rng.next() < density * 0.18) {
        writeCell(world, rec, x, y, material);
        placed++;
      }
    }
  }
  return { summary: `scatter: ${placed} cells` };
}

/** Floor spots with standing headroom, spaced out so spawns don't clump. */
function floorSpots(
  world: World,
  region: Region,
  rng: Rng,
  spacing: number,
  inRegion: (x: number, y: number) => boolean,
): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  const xs: number[] = [];
  for (let x = Math.max(4, region.x0); x <= Math.min(world.width - 5, region.x1); x++) xs.push(x);
  // deterministic shuffle
  for (let i = xs.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  for (const x of xs) {
    for (let y = Math.max(12, region.y0 + 10); y <= Math.min(world.height - 3, region.y1); y++) {
      if (!inRegion(x, y)) continue;
      if (!blocksEntity(world.types[world.idx(x, y + 1)])) continue;
      if (world.types[world.idx(x, y)] !== Cell.Empty) continue;
      let clear = true;
      for (let d = 1; d <= 10 && clear; d++) {
        if (blocksEntity(world.types[world.idx(x, y - d)])) clear = false;
      }
      if (!clear) continue;
      let spaced = true;
      for (const [fx, fy] of found) {
        if (Math.abs(fx - x) + Math.abs(fy - y) < spacing) {
          spaced = false;
          break;
        }
      }
      if (spaced) found.push([x, y]);
      break; // one spot per column
    }
  }
  return found;
}

function enemiesPass(p: PassInput): PassResult {
  const { world, rng, region, density } = p;
  const spots = floorSpots(world, region, rng, 40, p.inRegion);
  const want = Math.max(1, Math.min(30, Math.round((area(region) / 30000) * (0.5 + density * 3))));
  const kinds: Array<[string, number]> = [
    ['slime', 3],
    ['bat', 2],
    ['imp', 2],
    ['acidslime', 1],
    ['spitter', 1],
  ];
  const total = kinds.reduce((s, k) => s + k[1], 0);
  const objects: PassResult['objects'] = [];
  for (const [x, y] of spots.slice(0, want)) {
    let roll = rng.next() * total;
    let kind = 'slime';
    for (const [k, wgt] of kinds) {
      roll -= wgt;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    objects.push({ kind: 'enemy', x, y: y - 1, params: { kind } });
  }
  return { summary: `enemies: ${objects.length} placed (${spots.length} candidate spots)`, objects };
}

function pickupsPass(p: PassInput): PassResult {
  const { world, rng, region, density } = p;
  const spots = floorSpots(world, region, rng, 55, p.inRegion);
  const want = Math.max(1, Math.min(20, Math.round((area(region) / 40000) * (0.5 + density * 3))));
  const objects: PassResult['objects'] = [];
  for (const [x, y] of spots.slice(0, want)) {
    const roll = rng.next();
    if (roll < 0.6) {
      objects.push({
        kind: 'pickup',
        x,
        y: y - 1,
        params: { kind: 'goldpile', amount: 15 + rng.int(40) },
      });
    } else if (roll < 0.8) {
      objects.push({ kind: 'pickup', x, y: y - 1, params: { kind: 'heart' } });
    } else {
      objects.push({ kind: 'pickup', x, y: y - 1, params: { kind: 'potion' } });
    }
  }
  return { summary: `pickups: ${objects.length} placed`, objects };
}

/**
 * Material crowns: seeded-chance writes of the ARMED material onto the open
 * cell above each solid top surface (Moss carpets, Snow caps, Ember rims —
 * grid-honest: the crown is real cells). A crowned left neighbor raises the
 * chance so growth clumps into patches instead of lone freckles; surfaces
 * sitting under liquid are skipped (nothing grows at the bottom of a pond).
 */
function crownsPass(p: PassInput): PassResult {
  const { world, rec, rng, region, density, material } = p;
  let placed = 0;
  for (let y = Math.max(1, region.y0); y <= Math.min(world.height - 2, region.y1); y++) {
    for (let x = Math.max(1, region.x0); x <= Math.min(world.width - 2, region.x1); x++) {
      if (!p.inRegion(x, y)) continue;
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Empty) continue;
      const below = world.types[world.idx(x, y + 1)];
      if (!isSolid(below) || below === material) continue; // solid top surfaces only
      if (isLiquid(world.types[world.idx(x, y - 1)])) continue; // submerged surface
      // clump bonus: rows scan left-to-right, so the left neighbor is decided
      const clump = world.types[world.idx(x - 1, y)] === material;
      if (rng.next() < density * 0.35 + (clump ? 0.3 : 0)) {
        writeCell(world, rec, x, y, material);
        placed++;
      }
    }
  }
  return { summary: `crowns: ${placed} cells` };
}

/** Top-surface rock for the crown passes: the generator only crowns Wall;
 *  authored levels are often built from Stone, so both count as rock here. */
const crownRock = (t: number): boolean => t === Cell.Wall || t === Cell.Stone;

/**
 * Crown tint: COLOR-ONLY recolor of top-surface rock with the biome crown
 * palette (src/world/crownPalette.ts — the transcription of CaveGenerator's
 * crown stage). Cell types never change; undo restores the old colors.
 * The topish/neighbor-top gates mirror the generator's exactly.
 */
function crownTintPass(p: PassInput): PassResult {
  const { world, rec, region, seed } = p;
  const B = BIOMES[p.biome] ?? BIOMES.earthen;
  const tint = (x: number, y: number, color: number): void => {
    const i = world.idx(x, y);
    rec.touch(i);
    world.colors[i] = color;
  };
  let tinted = 0;
  for (let y = Math.max(1, region.y0); y <= Math.min(world.height - 2, region.y1); y++) {
    for (let x = Math.max(1, region.x0); x <= Math.min(world.width - 1, region.x1); x++) {
      if (!p.inRegion(x, y)) continue;
      if (!crownRock(world.types[world.idx(x, y)])) continue;
      const topish =
        world.types[world.idx(x, y - 1)] === Cell.Empty &&
        (y < 2 || world.types[world.idx(x, y - 2)] === Cell.Empty);
      const nbTop = (xx: number): boolean =>
        xx >= 0 &&
        xx < world.width &&
        crownRock(world.types[world.idx(xx, y)]) &&
        world.types[world.idx(xx, y - 1)] === Cell.Empty;
      if (topish && (nbTop(x - 1) || nbTop(x + 1))) {
        tint(x, y, crownTopColor(x, y, seed, B.crown, B.flowerChance));
        tinted++;
        // underlayers, exactly as the generator stacks them (mask-gated)
        if (B.crown === 'moss') {
          if (crownRock(world.types[world.idx(x, y + 1)]) && p.inRegion(x, y + 1)) {
            tint(x, y + 1, mossUnderColor(x, seed));
          }
          if (
            y + 2 < world.height &&
            crownRock(world.types[world.idx(x, y + 2)]) &&
            p.inRegion(x, y + 2)
          ) {
            const c = crownDeepTint(world.colors[world.idx(x, y + 2)], x, y, seed, B.crown);
            if (c !== null) tint(x, y + 2, c);
          }
        } else if (B.crown === 'frost') {
          if (crownRock(world.types[world.idx(x, y + 1)]) && p.inRegion(x, y + 1)) {
            const c = crownDeepTint(world.colors[world.idx(x, y + 1)], x, y, seed, B.crown);
            if (c !== null) tint(x, y + 1, c);
          }
        }
      } else if (
        world.types[world.idx(x, y + 1)] === Cell.Empty &&
        world.types[world.idx(x, Math.min(world.height - 1, y + 2))] === Cell.Empty
      ) {
        const c = crownFringeTint(world.colors[world.idx(x, y)], x, y, seed, B.crown);
        if (c !== null) {
          tint(x, y, c);
          tinted++;
        }
      }
    }
  }
  return { summary: `crown tint: ${tinted} surfaces recolored (${B.crown})` };
}

export const PASSES: PassDef[] = [
  { id: 'caves', label: 'Caves (CA remodel)', usesMaterial: false, cells: true, run: cavesPass },
  { id: 'veins', label: 'Material veins', usesMaterial: true, cells: true, run: veinsPass },
  { id: 'pockets', label: 'Material pockets', usesMaterial: true, cells: true, run: pocketsPass },
  { id: 'vegetation', label: 'Moss & vines', usesMaterial: false, cells: true, run: vegetationPass },
  { id: 'scatter', label: 'Floor scatter', usesMaterial: true, cells: true, run: scatterPass },
  { id: 'crowns', label: 'Surface crowns (material)', usesMaterial: true, cells: true, run: crownsPass },
  { id: 'crownTint', label: 'Crown tint (color only)', usesMaterial: false, cells: true, run: crownTintPass },
  { id: 'enemies', label: 'Enemy population', usesMaterial: false, cells: false, run: enemiesPass },
  { id: 'pickups', label: 'Pickup distribution', usesMaterial: false, cells: false, run: pickupsPass },
];

export function runPass(
  def: PassDef,
  world: World,
  rec: PatchRecorder,
  seed: number,
  region: Region,
  density: number,
  material: number,
  mask: Uint8Array | null = null,
  biome: BiomeId = 'earthen',
): PassResult {
  const rw = region.x1 - region.x0 + 1;
  const inRegion = (x: number, y: number): boolean => {
    if (x < region.x0 || x > region.x1 || y < region.y0 || y > region.y1) return false;
    return !mask || mask[x - region.x0 + (y - region.y0) * rw] === 1;
  };
  return def.run({
    world,
    rec,
    rng: new Rng(seed >>> 0),
    seed: seed >>> 0,
    region,
    inRegion,
    density,
    material,
    biome,
  });
}
