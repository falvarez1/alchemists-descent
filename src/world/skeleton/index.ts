import { HEIGHT, WIDTH } from '@/config/constants';
import type { SkeletonSpec } from '@/config/gen';
import { hashSeed } from '@/core/rng';
import type { Rng } from '@/core/rng';
import {
  carveBubbleChains,
  carveChambers,
  carveDisc,
  carveEllipse,
  carveNoiseField,
  carveShafts,
  carveSineArtery,
  carveStalactites,
  carveStroke,
  carveRoomGrid,
  carveWalkTunnels,
  ensureConnectivity,
  fillNoise,
  fillSolid,
  removeSpecks,
  sealBorders,
  smoothCA,
} from '@/world/carve';

/**
 * Skeleton strategies: each turns an empty work buffer into the carved cave
 * skeleton for one biome family. The shared paint + decoration stages in
 * CaveGenerator run on the result.
 *
 * CONTRACT (every skeleton):
 * - work is `x + y * WIDTH` (1 = wall, 0 = open) and arrives zeroed; the
 *   skeleton owns filling it. Rows >= floorBand must END fully open (the
 *   floor strip), and rows never get filled back in there.
 * - Borders stay intact: nothing writes outside the buffer, and non-baseline
 *   skeletons leave columns 0-1 / WIDTH-2..WIDTH-1 solid above the floor band
 *   (baseline is exempt — its noise field has always reached the edges).
 * - spawnHint must be the center of a carved chamber of radius >= 24 open
 *   cells with generous headroom (the wizard is 17 cells tall).
 * - All randomness comes from io.rng (one stream, strict order) or from
 *   hashSeed(io.worldSeed, label) forks; never Math.random.
 * - Non-baseline skeletons MUST end with ensureConnectivity (fail-open:
 *   physics chaos may never hard-lock progression). Baseline is exempt —
 *   its artery/shaft lattice is the original, golden-locked guarantee.
 * - baseline returns the primary artery's tunnelY profile; all others return
 *   null and downstream consumers must fall back to spawnHint.
 */

export interface SkeletonIO {
  work: Uint8Array;
  rng: Rng;
  floorBand: number;
  minY: number;
  worldSeed: number;
}

export interface SkeletonResult {
  spawnHint: { x: number; y: number };
  /** Primary artery row per column (baseline only); null otherwise. */
  tunnelY: number[] | null;
}

export type SkeletonFn = (io: SkeletonIO, spec: SkeletonSpec) => SkeletonResult;

/** Carve the guaranteed spawn chamber and return its center. */
function carveSpawnChamber(
  work: Uint8Array,
  x: number,
  y: number,
  r: number,
  minY: number,
): { x: number; y: number } {
  carveDisc(work, WIDTH, HEIGHT, x, y, r, minY);
  return { x: Math.floor(x), y: Math.floor(y) };
}

/* ============================================================
 * baseline — the original earthen generator, moved verbatim.
 * Golden-hash locked: same literals (via GEN params), same rng
 * draw order, same arithmetic. See tests/gen-golden.test.ts.
 * ============================================================ */

const baseline: SkeletonFn = (io, spec) => {
  if (spec.kind !== 'baseline') throw new Error(`baseline skeleton got '${spec.kind}' spec`);
  const p = spec.params;
  const { work, rng, floorBand, minY } = io;

  // 1) Noise field (true = wall), floor band open.
  fillNoise(work, WIDTH, HEIGHT, rng, p.noiseDensity, floorBand);

  // 2) Cellular automata smoothing passes.
  smoothCA(work, WIDTH, HEIGHT, p.caPasses, floorBand);

  // 3) Carve the guaranteed traversable tunnel network. The primary artery
  //    records tunnelY; the spawn chamber sits dead center on it.
  const tunnelY: number[] = new Array<number>(WIDTH).fill(0);
  for (const artery of p.arteries) {
    carveSineArtery(work, WIDTH, HEIGHT, rng, artery, floorBand, minY, artery.primary ? tunnelY : null);
  }
  carveShafts(work, WIDTH, HEIGHT, rng, p.shafts, floorBand, minY);
  carveChambers(work, WIDTH, rng, p.chambers, floorBand, minY);
  carveDisc(work, WIDTH, HEIGHT, WIDTH / 2, tunnelY[Math.floor(WIDTH / 2)], p.spawnRadius, minY);
  const spawnHint = { x: Math.floor(WIDTH / 2), y: tunnelY[Math.floor(WIDTH / 2)] };
  carveStalactites(work, WIDTH, rng, p.stalactites, floorBand, minY);
  removeSpecks(work, WIDTH, HEIGHT, rng, p.speckPasses, p.speckLoneChance);

  return { spawnHint, tunnelY };
};

/* ============================================================
 * New skeletons (complete + deterministic; wired to no biome yet)
 * ============================================================ */

const fungalPockets: SkeletonFn = (io, spec) => {
  if (spec.kind !== 'fungalPockets') throw new Error(`fungalPockets skeleton got '${spec.kind}' spec`);
  const p = spec.params;
  const { work, rng, floorBand, minY } = io;
  fillNoise(work, WIDTH, HEIGHT, rng, p.fillDensity, floorBand);
  // CA BEFORE carving: blends the raw block noise into organic blobs.
  // (After carving it erodes the bubble throats — thousands of severed
  // pockets, which the connectivity pass then drills with parallel
  // tunnels. The audit caught exactly that on d2.)
  smoothCA(work, WIDTH, HEIGHT, p.caPasses, floorBand);
  carveBubbleChains(work, WIDTH, HEIGHT, rng, {
    chains: p.chains,
    links: p.links,
    rMin: p.rMin,
    rMax: p.rMax,
    throatW: p.throatW,
    floorBand,
    minY,
  });
  carveSineArtery(work, WIDTH, HEIGHT, rng, p.artery, floorBand, minY, null);
  const spawnHint = carveSpawnChamber(work, WIDTH / 2, Math.floor(HEIGHT * 0.42), p.spawnRadius, minY);
  sealBorders(work, WIDTH, floorBand, minY);
  ensureConnectivity(work, WIDTH, HEIGHT, {
    minArea: p.minArea,
    tunnelRadius: p.tunnelRadius,
    floorBand,
    minY,
  });
  return { spawnHint, tunnelY: null };
};

const frozenCrevasses: SkeletonFn = (io, spec) => {
  if (spec.kind !== 'frozenCrevasses') throw new Error(`frozenCrevasses skeleton got '${spec.kind}' spec`);
  const p = spec.params;
  const { work, rng, floorBand, minY } = io;
  fillSolid(work, WIDTH, floorBand);
  // Vertical-grain FBM field on a forked seed (consumes no rng stream).
  carveNoiseField(work, WIDTH, hashSeed(io.worldSeed, 'crevasse-field'), {
    scaleX: p.field.scaleX,
    scaleY: p.field.scaleY,
    octaves: p.field.octaves,
    threshold: p.field.threshold,
    floorBand,
    minY,
  });
  // Near-vertical high-jitter crevasse tunnels spanning most of the height.
  const t = p.tunnels;
  const count = t.countMin + rng.int(t.countMax - t.countMin + 1);
  const starts: Array<{ x: number; y: number }> = [];
  const span = WIDTH - 2 * t.xMargin;
  for (let i = 0; i < count; i++) {
    starts.push({
      x: t.xMargin + ((i + 0.5) / count) * span + (rng.next() - 0.5) * 60,
      y: minY + 14 + rng.next() * 40,
    });
  }
  carveWalkTunnels(work, WIDTH, HEIGHT, rng, {
    starts,
    steps: t.steps,
    radiusMin: t.radiusMin,
    radiusMax: t.radiusMax,
    turn: t.turn,
    gravityBias: t.gravityBias,
    branchChance: t.branchChance,
    maxBranches: t.maxBranches,
    floorBand,
    minY,
  });
  // Short horizontal shelf carves linking neighboring crevasses.
  for (let i = 0; i < p.shelves.count; i++) {
    const len = p.shelves.lenMin + rng.next() * (p.shelves.lenMax - p.shelves.lenMin);
    const sx = 60 + rng.next() * (WIDTH - 120 - len);
    const sy = 80 + rng.next() * (floorBand - 160);
    carveStroke(work, WIDTH, HEIGHT, sx, sy, sx + len, sy, p.shelves.radius, minY);
  }
  const spawnHint = carveSpawnChamber(work, WIDTH / 2, Math.floor(HEIGHT * 0.35), p.spawnRadius, minY);
  sealBorders(work, WIDTH, floorBand, minY);
  ensureConnectivity(work, WIDTH, HEIGHT, {
    minArea: p.minArea,
    tunnelRadius: p.tunnelRadius,
    floorBand,
    minY,
  });
  return { spawnHint, tunnelY: null };
};

const floodedGalleries: SkeletonFn = (io, spec) => {
  if (spec.kind !== 'floodedGalleries') throw new Error(`floodedGalleries skeleton got '${spec.kind}' spec`);
  const p = spec.params;
  const { work, rng, floorBand, minY } = io;
  fillNoise(work, WIDTH, HEIGHT, rng, p.fillDensity, floorBand);
  smoothCA(work, WIDTH, HEIGHT, p.fillCAPasses, floorBand);
  // Stacked wide low-amplitude galleries.
  for (const g of p.galleries) carveSineArtery(work, WIDTH, HEIGHT, rng, g, floorBand, minY, null);
  // Flattened chambers off the galleries.
  carveChambers(work, WIDTH, rng, p.chambers, floorBand, minY);
  // Sump bulbs below the lower galleries.
  for (let i = 0; i < p.sumps.count; i++) {
    const sx = 80 + rng.next() * (WIDTH - 160);
    const sy = HEIGHT * (p.sumps.yFracMin + rng.next() * (p.sumps.yFracMax - p.sumps.yFracMin));
    const r = p.sumps.rMin + rng.next() * (p.sumps.rMax - p.sumps.rMin);
    carveDisc(work, WIDTH, HEIGHT, sx, Math.min(sy, floorBand - 14), Math.floor(r), minY);
  }
  carveShafts(work, WIDTH, HEIGHT, rng, p.shafts, floorBand, minY);
  const spawnHint = carveSpawnChamber(work, WIDTH / 2, Math.floor(HEIGHT * 0.44), p.spawnRadius, minY);
  sealBorders(work, WIDTH, floorBand, minY);
  ensureConnectivity(work, WIDTH, HEIGHT, {
    minArea: p.minArea,
    tunnelRadius: p.tunnelRadius,
    floorBand,
    minY,
  });
  return { spawnHint, tunnelY: null };
};

const timberScaffold: SkeletonFn = (io, spec) => {
  if (spec.kind !== 'timberScaffold') throw new Error(`timberScaffold skeleton got '${spec.kind}' spec`);
  const p = spec.params;
  const { work, rng, floorBand, minY } = io;
  fillSolid(work, WIDTH, floorBand);
  const grid = carveRoomGrid(work, WIDTH, rng, { ...p.grid, floorBand, minY });
  // Sprinkle + CA roughening so the scaffold reads hewn, not CAD-drawn.
  for (let y = minY + 1; y < floorBand; y++) {
    const row = y * WIDTH;
    for (let x = 2; x < WIDTH - 2; x++) {
      if (rng.next() < p.sprinkle) work[x + row] ^= 1;
    }
  }
  smoothCA(work, WIDTH, HEIGHT, p.caPasses, floorBand);
  // Vertical shafts at grid columns down to the floor strip.
  for (let gx = 0; gx < grid.cols; gx += p.shaftEvery) {
    const sx = grid.originX + gx * p.grid.cellW + p.grid.cellW / 2;
    carveStroke(work, WIDTH, HEIGHT, sx, grid.originY + 10, sx, floorBand + 4, p.shaftHalfW, minY);
  }
  // Spawn in the room nearest the world center.
  let best = { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT * 0.42) };
  let bestD = Infinity;
  for (const c of grid.centers) {
    const d = Math.abs(c.x - WIDTH / 2) + Math.abs(c.y - floorBand * 0.45);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const spawnHint = carveSpawnChamber(work, best.x, best.y, p.spawnRadius, minY);
  sealBorders(work, WIDTH, floorBand, minY);
  ensureConnectivity(work, WIDTH, HEIGHT, {
    minArea: p.minArea,
    tunnelRadius: p.tunnelRadius,
    floorBand,
    minY,
  });
  return { spawnHint, tunnelY: null };
};

const crystalVaults: SkeletonFn = (io, spec) => {
  if (spec.kind !== 'crystalVaults') throw new Error(`crystalVaults skeleton got '${spec.kind}' spec`);
  const p = spec.params;
  const { work, rng, floorBand, minY } = io;
  fillNoise(work, WIDTH, HEIGHT, rng, p.fillDensity, floorBand);
  smoothCA(work, WIDTH, HEIGHT, p.caPasses, floorBand);
  // Tall vault ellipses mid-band, each colonnaded with pillar strips.
  const v = p.vaults;
  const count = v.countMin + rng.int(v.countMax - v.countMin + 1);
  for (let i = 0; i < count; i++) {
    const vx = v.xMargin + rng.next() * (WIDTH - 2 * v.xMargin);
    const vy = HEIGHT * (v.yFracMin + rng.next() * (v.yFracMax - v.yFracMin));
    const rx = v.rxMin + rng.next() * (v.rxMax - v.rxMin);
    const ry = v.ryMin + rng.next() * (v.ryMax - v.ryMin);
    carveEllipse(work, WIDTH, vx, vy, rx, ry, minY, floorBand);
    // Re-fill pillar strips inside the vault (leaving head/foot gaps so the
    // vault interior stays continuous).
    let px = vx - rx + p.pillars.spacingMin + rng.next() * (p.pillars.spacingMax - p.pillars.spacingMin);
    while (px < vx + rx - 4) {
      const wid = p.pillars.wMin + rng.int(p.pillars.wMax - p.pillars.wMin + 1);
      for (let dx = 0; dx < wid; dx++) {
        const X = Math.floor(px) + dx;
        if (X <= 1 || X >= WIDTH - 2) continue;
        const nx = (X - vx) / rx;
        const span = 1 - nx * nx;
        if (span <= 0) continue;
        const dyMax = Math.floor(ry * Math.sqrt(span) * p.pillars.heightFrac);
        for (let dy = -dyMax; dy <= dyMax; dy++) {
          const Y = Math.floor(vy) + dy;
          if (Y > minY && Y < floorBand) work[X + Y * WIDTH] = 1;
        }
      }
      px += p.pillars.spacingMin + rng.next() * (p.pillars.spacingMax - p.pillars.spacingMin);
    }
  }
  for (const artery of p.arteries) carveSineArtery(work, WIDTH, HEIGHT, rng, artery, floorBand, minY, null);
  carveShafts(work, WIDTH, HEIGHT, rng, p.shafts, floorBand, minY);
  const spawnHint = carveSpawnChamber(work, WIDTH / 2, Math.floor(HEIGHT * 0.4), p.spawnRadius, minY);
  sealBorders(work, WIDTH, floorBand, minY);
  ensureConnectivity(work, WIDTH, HEIGHT, {
    minArea: p.minArea,
    tunnelRadius: p.tunnelRadius,
    floorBand,
    minY,
  });
  return { spawnHint, tunnelY: null };
};

const volcanicTubes: SkeletonFn = (io, spec) => {
  if (spec.kind !== 'volcanicTubes') throw new Error(`volcanicTubes skeleton got '${spec.kind}' spec`);
  const p = spec.params;
  const { work, rng, floorBand, minY } = io;
  fillNoise(work, WIDTH, HEIGHT, rng, p.fillDensity, floorBand);
  smoothCA(work, WIDTH, HEIGHT, p.caPasses, floorBand);
  // Gravity-pulled lava-tube walkers from the upper band.
  const wk = p.walkers;
  const count = wk.countMin + rng.int(wk.countMax - wk.countMin + 1);
  const starts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    starts.push({
      x: wk.xMargin + rng.next() * (WIDTH - 2 * wk.xMargin),
      y: HEIGHT * (wk.yFracMin + rng.next() * (wk.yFracMax - wk.yFracMin)),
    });
  }
  carveWalkTunnels(work, WIDTH, HEIGHT, rng, {
    starts,
    steps: wk.steps,
    radiusMin: wk.radiusMin,
    radiusMax: wk.radiusMax,
    turn: wk.turn,
    gravityBias: wk.gravityBias,
    branchChance: wk.branchChance,
    maxBranches: wk.maxBranches,
    floorBand,
    minY,
  });
  // Jagged chambers: a core disc plus offset lobes.
  const ch = p.chambers;
  for (let i = 0; i < ch.count; i++) {
    const cx = ch.xMargin + rng.next() * (WIDTH - 2 * ch.xMargin);
    const cy = ch.yMin + rng.next() * (floorBand - ch.ySpanOff);
    const r = ch.rMin + rng.next() * (ch.rMax - ch.rMin);
    carveDisc(work, WIDTH, HEIGHT, cx, cy, Math.floor(r), minY);
    for (let l = 0; l < ch.lobes; l++) {
      const a = rng.next() * Math.PI * 2;
      const lr = r * (0.35 + rng.next() * 0.4);
      carveDisc(work, WIDTH, HEIGHT, cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8, Math.floor(lr), minY);
    }
  }
  const spawnHint = carveSpawnChamber(work, WIDTH / 2, Math.floor(HEIGHT * 0.32), p.spawnRadius, minY);
  sealBorders(work, WIDTH, floorBand, minY);
  ensureConnectivity(work, WIDTH, HEIGHT, {
    minArea: p.minArea,
    tunnelRadius: p.tunnelRadius,
    floorBand,
    minY,
  });
  return { spawnHint, tunnelY: null };
};

export const SKELETONS: Record<SkeletonSpec['kind'], SkeletonFn> = {
  baseline,
  fungalPockets,
  frozenCrevasses,
  floodedGalleries,
  timberScaffold,
  crystalVaults,
  volcanicTubes,
};
