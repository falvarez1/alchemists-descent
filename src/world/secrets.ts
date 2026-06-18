import type { Rng } from '@/core/rng';
import type { BiomeId, Ctx, Region, RegionGraph } from '@/core/types';
import type { PlacementLedger } from '@/world/connect';
import { Cell, blocksEntity } from '@/sim/CellType';
import {
  EMPTY_COLOR,
  goldColor,
  gunpowderColor,
  iceColor,
  nitrogenColor,
  oilColor,
  packRGB,
  sandColor,
  slimeColor,
  unpackB,
  unpackG,
  unpackR,
  wallColor,
  woodColor,
} from '@/sim/colors';
import type { World } from '@/sim/World';

/* ===================== Secrets That Obey the Sim (Wave C) ===================== */

/**
 * March from a projectile impact INTO the wall along the impact direction:
 * if open space lies behind at most 8 blocking cells, return that first open
 * cell (the hollow), else null. Allocation-free until the hit itself — callers
 * use a non-null result to play the hollowKnock tell.
 */
export function probeHollow(
  world: World,
  hitX: number,
  hitY: number,
  dirX: number,
  dirY: number,
): { x: number; y: number } | null {
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-4 || !world.inBounds(hitX, hitY)) return null;
  // Half-cell DDA increments so a diagonal march cannot tunnel past a cell.
  const sx = (dirX / len) * 0.5;
  const sy = (dirY / len) * 0.5;
  let fx = hitX + 0.5;
  let fy = hitY + 0.5;
  let px = hitX;
  let py = hitY;
  let solids = blocksEntity(world.types[hitX + hitY * world.width]) ? 1 : 0;
  for (let it = 0; it < 40; it++) {
    fx += sx;
    fy += sy;
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    if (cx === px && cy === py) continue;
    px = cx;
    py = cy;
    if (!world.inBounds(cx, cy)) return null;
    if (blocksEntity(world.types[cx + cy * world.width])) {
      if (++solids > 8) return null;
    } else if (solids > 0) {
      return { x: cx, y: cy };
    }
  }
  return null;
}

/**
 * Thin breachable skin material, per biome — the shared "secret wall" table.
 * Also consumed by sealed prefab anchors (world/prefabs/place.ts), so a
 * resealed prefab tunnel reads exactly like a secret connector.
 */
export function breachSkinCell(biome: BiomeId): Cell {
  return biome === 'frozen'
    ? Cell.Ice
    : biome === 'timber' || biome === 'flooded'
      ? Cell.Wood
      : biome === 'scorched'
        ? Cell.Wall
        : Cell.Sand;
}

/** Color factory for the breach skin; scorched draws rng per call (gold flecks). */
export function breachSkinColorFn(biome: BiomeId, rng: Rng): () => number {
  return (): number => {
    if (biome === 'frozen') return iceColor();
    if (biome === 'timber' || biome === 'flooded') return woodColor();
    if (biome === 'scorched') return rng.next() < 0.12 ? goldColor() : wallColor();
    return sandColor();
  };
}

function isSecretHostTerrain(t: number): boolean {
  return blocksEntity(t) && t !== Cell.Metal;
}

/**
 * Stamp 4-7 sealed secret chambers into the rock flanking the main path.
 * Every secret is real cells (THE ONE COMMANDMENT): an elliptical hollow, a
 * 5-wide connector whose last stretch is refilled with the biome's breachable
 * skin (sand/wood/ice/flecked wall), a faint recolored tell beside the skin,
 * and a payload pile that obeys gravity the moment the wall opens.
 * All layout randomness flows through the passed rng. Returns the count placed.
 * Reserved-ledger ground (prefab footprints etc.) is rejected; the guard is
 * inert while the ledger is empty or absent.
 */
export function stampSecrets(ctx: Ctx, rng: Rng, graph: RegionGraph, biome: BiomeId, ledger?: PlacementLedger): number {
  const world = ctx.world;
  const W = world.width;
  const H = world.height;

  // Candidate anchors: the spawn->exit spine, else any region at all.
  const pool: Region[] = [];
  for (const id of graph.mainPath) {
    for (const r of graph.regions) {
      if (r.id === id) {
        pool.push(r);
        break;
      }
    }
  }
  if (pool.length === 0) for (const r of graph.regions) pool.push(r);
  if (pool.length === 0) return 0;

  // Thin breachable skin material, per biome (shared table above).
  const breachCell: Cell = breachSkinCell(biome);
  const breachColor = breachSkinColorFn(biome, rng);

  const allHostTerrainEllipse = (cx: number, cy: number, rx: number, ry: number): boolean => {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
        const X = cx + dx,
          Y = cy + dy;
        if (X < 2 || X >= W - 2 || Y < 2 || Y >= H - 2) return false;
        if (!isSecretHostTerrain(world.types[X + Y * W])) return false;
      }
    }
    return true;
  };

  const target = 4 + rng.int(4); // 4-7 secrets
  let placedCount = 0;

  for (let attempt = 0; attempt < target * 80 && placedCount < target; attempt++) {
    const region = pool[rng.int(pool.length)];
    const ang = rng.next() * Math.PI * 2;
    const reach = rng.range(40, 160);
    const cx = Math.floor(region.cx + Math.cos(ang) * reach);
    const cy = Math.floor(region.cy + Math.sin(ang) * reach);
    const rx = 14 + rng.int(9); // 14-22
    const ry = 9 + rng.int(6); // 9-14
    if (cx - rx < 3 || cx + rx >= W - 3 || cy - ry < 3 || cy + ry >= H - 8) continue;
    if (ledger && ledger.intersects(cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2)) continue;
    if (!allHostTerrainEllipse(cx, cy, rx, ry)) continue;

    const touched = new Map<number, { type: number; color: number; life: number; charge: number; colorOverride: boolean }>();
    const remember = (i: number): void => {
      if (touched.has(i)) return;
      touched.set(i, {
        type: world.types[i],
        color: world.colors[i],
        life: world.life[i],
        charge: world.charge[i],
        colorOverride: world.colorOverrides.has(i),
      });
    };
    const rollback = (): void => {
      for (const [i, cell] of touched) {
        world.types[i] = cell.type;
        world.colors[i] = cell.color;
        world.life[i] = cell.life;
        world.setChargeAt(i, cell.charge);
        if (cell.colorOverride) world.colorOverrides.add(i);
        else world.colorOverrides.delete(i);
      }
    };

    // Chamber: elliptical hollow (bedrock metal is never carved).
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
        const i = cx + dx + (cy + dy) * W;
        if (world.types[i] === Cell.Metal) continue;
        remember(i);
        world.types[i] = Cell.Empty;
        world.colors[i] = EMPTY_COLOR;
        world.life[i] = 0;
        world.clearChargeAt(i);
      }
    }

    // Connector: 5-wide dig from the chamber edge toward the anchor region's
    // centroid, stopping once open space is within 4 cells of the dig face.
    let ux = region.cx - cx;
    let uy = region.cy - cy;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul;
    uy /= ul;
    const stepXs: number[] = [];
    const stepYs: number[] = [];
    let hx = cx + ux * rx; // exactly on the ellipse boundary along u
    let hy = cy + uy * ry;
    let reachedOpen = false; // did the bore actually get within reach of open space?
    for (let s = 0; s < 300; s++) {
      hx += ux;
      hy += uy;
      const ix = Math.floor(hx);
      const iy = Math.floor(hy);
      if (ix < 4 || ix >= W - 4 || iy < 4 || iy >= H - 8) break;
      // Probe ahead of the dig face (k starts past the carve radius so the
      // freshly dug tunnel behind the face can never read as "open").
      let reached = false;
      for (let k = 3; k <= 6 && !reached; k++) {
        for (let l = -2; l <= 2 && !reached; l++) {
          const aX = Math.floor(hx + ux * k - uy * l);
          const aY = Math.floor(hy + uy * k + ux * l);
          if (!world.inBounds(aX, aY)) continue;
          if (!blocksEntity(world.types[aX + aY * W])) reached = true;
        }
      }
      if (reached) {
        reachedOpen = true;
        break;
      }
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue; // 5-wide bore
          const i = ix + dx + (iy + dy) * W;
          if (world.types[i] === Cell.Metal) continue;
          remember(i);
          world.types[i] = Cell.Empty;
          world.colors[i] = EMPTY_COLOR;
          world.life[i] = 0;
          world.clearChargeAt(i);
        }
      }
      stepXs.push(ix);
      stepYs.push(iy);
    }

    // If the bore never reached open space (ran into deep rock / out of bounds),
    // the chamber would be a SEALED, undiscoverable pocket. Don't dress it with a
    // breach skin + tell (which would falsely advertise reachable treasure) or
    // count it — roll the trial back and try another candidate. (This path only
    // diverges from the old behavior when a connector actually fails, so seeds
    // where every bore reaches are byte-identical.)
    if (!reachedOpen) {
      rollback();
      continue;
    }

    // Reseal the last 5 steps with the breach skin (only cells we just dug).
    const skinX: number[] = [];
    const skinY: number[] = [];
    for (let s = Math.max(0, stepXs.length - 5); s < stepXs.length; s++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          const X = stepXs[s] + dx;
          const Y = stepYs[s] + dy;
          const i = X + Y * W;
          if (world.types[i] !== Cell.Empty) continue;
          world.types[i] = breachCell;
          world.colors[i] = breachColor();
          skinX.push(X);
          skinY.push(Y);
        }
      }
    }

    // TELL: three skin-adjacent wall cells recolored ~25% lighter.
    let tells = 0;
    for (let t = 0; t < 60 && tells < 3 && skinX.length > 0; t++) {
      const s = rng.int(skinX.length);
      const ox = rng.int(3) - 1;
      const oy = rng.int(3) - 1;
      if (ox === 0 && oy === 0) continue;
      const nx = skinX[s] + ox;
      const ny = skinY[s] + oy;
      if (nx < 1 || nx >= W - 1 || ny < 1 || ny >= H - 1) continue;
      const i = nx + ny * W;
      if (world.types[i] !== Cell.Wall) continue;
      const c = world.colors[i];
      world.colors[i] = packRGB(
        Math.min(255, Math.round(unpackR(c) * 1.25)),
        Math.min(255, Math.round(unpackG(c) * 1.25)),
        Math.min(255, Math.round(unpackB(c) * 1.25)),
      );
      tells++;
    }

    // CONTENTS: a pile of real cells settled low on the chamber floor.
    const fillPile = (count: number, t: Cell, colorOf: () => number): void => {
      let left = count;
      for (let dy = ry; dy >= -ry && left > 0; dy--) {
        for (let dx = -rx; dx <= rx && left > 0; dx++) {
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
          const i = cx + dx + (cy + dy) * W;
          if (world.types[i] !== Cell.Empty) continue;
          world.types[i] = t;
          world.colors[i] = colorOf();
          left--;
        }
      }
    };
    const roll = rng.next();
    if (roll < 0.5) {
      fillPile(80 + rng.int(71), Cell.Gold, goldColor); // gold hoard
    } else if (roll < 0.8) {
      // material cache, themed by biome
      const cache: Cell = biome === 'frozen' ? Cell.Nitrogen : biome === 'scorched' ? Cell.Gunpowder : Cell.Oil;
      const cacheColor = cache === Cell.Nitrogen ? nitrogenColor : cache === Cell.Gunpowder ? gunpowderColor : oilColor;
      fillPile(60 + rng.int(41), cache, cacheColor);
    } else {
      fillPile(90, Cell.Slime, slimeColor); // slime nest
    }

    placedCount++;
  }

  return placedCount;
}
