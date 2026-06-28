import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type { Ctx, EnemyKind, LevelDef, PlacedPrefab, RegionGraph } from '@/core/types';
import type { InstantiationSink } from '@/game/instantiate';
import { Cell } from '@/sim/CellType';
import {
  bloodColor,
  coalColor,
  fungusColor,
  glowshroomColor,
  goldColor,
  mossColor,
  rawOreColor,
  slimeColor,
  stoneColor,
  vineColor,
  waterColor,
  woodColor,
} from '@/sim/colors';
import type { World } from '@/sim/World';
import { PlacementLedger, carvePocket, carveRect, connectToCaves } from '@/world/connect';

interface LairSpec {
  id: string;
  kind: EnemyKind;
  w: number;
  h: number;
  minSpawnDist: number;
  maxMainPathDist: number;
}

interface LairSite {
  x0: number;
  y0: number;
}

interface LairStamp {
  spawn: { x: number; y: number };
  mouth: { x: number; y: number };
}

const LAIR_MARGIN = 12;

export function placeEncounterLairs(
  ctx: Ctx,
  rng: Rng,
  graph: RegionGraph,
  ledger: PlacementLedger,
  sink: InstantiationSink,
  def: LevelDef,
  site: { spawn: { x: number; y: number }; wellX: number },
  fits?: Uint8Array,
): PlacedPrefab[] {
  const specs = specsForLevel(def);
  if (specs.length === 0) return [];

  const placed: PlacedPrefab[] = [];
  for (const spec of specs) {
    const at = findLairSite(ctx.world, rng, graph, ledger, spec, site, placed);
    if (!at) {
      console.warn(`[encounter-lairs] skipped ${spec.id} for ${def.id} - no safe site`);
      continue;
    }

    const rollback = snapshotWorld(ctx.world);
    const stamp = stampLair(ctx.world, rng, spec, at);
    carvePocket(ctx.world, stamp.mouth.x, stamp.mouth.y, 11, 13);
    const steps = connectToCaves(ctx.world, rng, graph, stamp.mouth.x, stamp.mouth.y, 12, fits, { halfW: 7, up: 21, down: 9 });
    if (steps.length === 0) {
      restoreWorld(ctx.world, rollback);
      console.warn(`[encounter-lairs] skipped ${spec.id} for ${def.id} - connector failed`);
      continue;
    }
    if (spec.kind === 'rillback') {
      sealRillbackPool(ctx.world, at, spec);
      carveRillbackDryAccess(ctx.world, at, spec);
    }

    ledger.reserve(
      at.x0 - LAIR_MARGIN,
      at.y0 - LAIR_MARGIN,
      at.x0 + spec.w - 1 + LAIR_MARGIN,
      at.y0 + spec.h - 1 + LAIR_MARGIN,
      spec.id,
    );
    sink.enemies.push({ kind: spec.kind, x: stamp.spawn.x, y: stamp.spawn.y, sourceId: spec.id });
    placed.push({
      id: spec.id,
      x0: at.x0,
      y0: at.y0,
      x1: at.x0 + spec.w - 1,
      y1: at.y0 + spec.h - 1,
    });
  }
  return placed;
}

function snapshotWorld(world: World): {
  types: Uint8Array;
  colors: Uint32Array;
  life: Int16Array;
  charge: Uint16Array;
  activeCharges: number[];
  colorOverrides: number[];
} {
  return {
    types: world.types.slice(),
    colors: world.colors.slice(),
    life: world.life.slice(),
    charge: world.charge.slice(),
    activeCharges: [...world.activeCharges],
    colorOverrides: [...world.colorOverrides],
  };
}

function restoreWorld(world: World, snapshot: ReturnType<typeof snapshotWorld>): void {
  world.types.set(snapshot.types);
  world.colors.set(snapshot.colors);
  world.life.set(snapshot.life);
  world.charge.set(snapshot.charge);
  world.activeCharges.clear();
  for (const i of snapshot.activeCharges) world.activeCharges.add(i);
  world.colorOverrides.clear();
  for (const i of snapshot.colorOverrides) world.colorOverrides.add(i);
}

function specsForLevel(def: LevelDef): LairSpec[] {
  if (def.branch) return [];
  switch (def.biome) {
    case 'fungal':
      return [{ id: 'encounter-lair-rootloper-grove', kind: 'rootloper', w: 78, h: 48, minSpawnDist: 150, maxMainPathDist: 430 }];
    case 'timber':
      return [{ id: 'encounter-lair-rootloper-grove', kind: 'rootloper', w: 78, h: 48, minSpawnDist: 170, maxMainPathDist: 430 }];
    case 'flooded':
      return [{ id: 'encounter-lair-rillback-pool', kind: 'rillback', w: 86, h: 50, minSpawnDist: 170, maxMainPathDist: 460 }];
    case 'crystal':
      return [{ id: 'encounter-lair-stonemaw-seam', kind: 'stonemaw', w: 86, h: 52, minSpawnDist: 190, maxMainPathDist: 460 }];
    case 'volcanic':
      return [{ id: 'encounter-lair-stonemaw-seam', kind: 'stonemaw', w: 86, h: 52, minSpawnDist: 210, maxMainPathDist: 480 }];
    default:
      return [];
  }
}

function findLairSite(
  world: World,
  rng: Rng,
  graph: RegionGraph,
  ledger: PlacementLedger,
  spec: LairSpec,
  site: { spawn: { x: number; y: number }; wellX: number },
  placed: readonly PlacedPrefab[],
): LairSite | null {
  const xSpan = WIDTH - spec.w - 24;
  const ySpan = HEIGHT - spec.h - 110;
  if (xSpan <= 0 || ySpan <= 0) return null;

  for (let tries = 0; tries < 9000; tries++) {
    const distK = tries < 3500 ? 1 : tries < 6500 ? 0.7 : 0.45;
    const rockMin = tries < 3500 ? 0.55 : tries < 6500 ? 0.38 : 0.22;
    const mainPathMax = spec.maxMainPathDist * (tries < 6500 ? 1 : 1.35);
    const x0 = 12 + rng.int(xSpan);
    const y0 = 42 + rng.int(ySpan);
    const cx = x0 + spec.w / 2;
    const cy = y0 + spec.h / 2;

    if (Math.hypot(cx - site.spawn.x, cy - site.spawn.y) < spec.minSpawnDist * distK) continue;
    if (Math.abs(cx - site.wellX) < 130 * distK) continue;
    if (distanceToMainPath(graph, cx, cy) > mainPathMax) continue;
    if (ledger.intersects(x0 - LAIR_MARGIN, y0 - LAIR_MARGIN, x0 + spec.w + LAIR_MARGIN, y0 + spec.h + LAIR_MARGIN)) continue;
    if (placed.some((p) => Math.hypot(cx - (p.x0 + p.x1) / 2, cy - (p.y0 + p.y1) / 2) < 140 * distK)) continue;

    let cells = 0;
    let rock = 0;
    let openOrTreasure = 0;
    let metal = false;
    for (let y = y0 - 4; y <= y0 + spec.h + 4 && !metal; y += 3) {
      for (let x = x0 - 4; x <= x0 + spec.w + 4; x += 3) {
        if (!world.inBounds(x, y)) {
          metal = true;
          break;
        }
        const t = world.types[world.idx(x, y)];
        if (t === Cell.Metal) {
          metal = true;
          break;
        }
        cells++;
        if (t === Cell.Wall || t === Cell.Stone || t === Cell.RawOre || t === Cell.Coal) rock++;
        if (
          t === Cell.Empty ||
          t === Cell.Water ||
          t === Cell.Blood ||
          t === Cell.Slime ||
          t === Cell.Gold ||
          t === Cell.Lava ||
          t === Cell.Acid ||
          t === Cell.Toxic
        ) {
          openOrTreasure++;
        }
      }
    }
    if (metal || cells === 0 || rock / cells < rockMin) continue;
    const openLimit = spec.kind === 'rootloper' ? 0.48 : tries < 6500 ? 0.12 : 0.18;
    if (openOrTreasure / cells > openLimit) continue;
    if (containsMetal(world, x0 - 2, y0 - 2, x0 + spec.w + 1, y0 + spec.h + 1)) continue;
    return { x0, y0 };
  }

  return null;
}

function containsMetal(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!world.inBounds(x, y) || world.types[world.idx(x, y)] === Cell.Metal) return true;
    }
  }
  return false;
}

function distanceToMainPath(graph: RegionGraph, x: number, y: number): number {
  let best = Infinity;
  for (const onlyMain of [true, false]) {
    for (const reg of graph.regions) {
      if (onlyMain && !reg.onMainPath) continue;
      if (!onlyMain && reg.area < 80) continue;
      best = Math.min(best, Math.hypot(reg.cx - x, reg.cy - y));
    }
    if (Number.isFinite(best)) break;
  }
  return best;
}

function stampLair(world: World, rng: Rng, spec: LairSpec, at: LairSite): LairStamp {
  if (spec.kind === 'rootloper') return stampRootLoperGrove(world, rng, at, spec);
  if (spec.kind === 'stonemaw') return stampStoneMawSeam(world, rng, at, spec);
  return stampRillbackPool(world, rng, at, spec);
}

function setCell(world: World, x: number, y: number, t: Cell, color: number): void {
  if (!world.inBounds(x, y)) return;
  const i = world.idx(x, y);
  if (world.types[i] === Cell.Metal) return;
  world.types[i] = t;
  world.colors[i] = color;
  world.life[i] = 0;
  world.clearChargeAt(i);
}

function stampRootLoperGrove(world: World, rng: Rng, at: LairSite, spec: LairSpec): LairStamp {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - 10;
  carvePocket(world, at.x0 + Math.floor(spec.w / 2), at.y0 + Math.floor(spec.h / 2), 34, 18);
  carveRect(world, at.x0 + 8, at.y0 + 10, x1 - 8, floorY - 1);

  for (let y = floorY; y <= floorY + 4; y++) {
    for (let x = at.x0 + 7; x <= x1 - 7; x++) {
      const woodBand = (x + y + Math.floor(rng.next() * 3)) % 9 === 0;
      setCell(world, x, y, woodBand ? Cell.Wood : Cell.Stone, woodBand ? woodColor() : stoneColor());
    }
  }

  for (let x = at.x0 + 10; x <= x1 - 10; x += 3) {
    const vineLen = 4 + rng.int(11);
    for (let k = 0; k < vineLen; k++) {
      const y = at.y0 + 10 + k;
      if (y >= floorY - 3) break;
      setCell(world, x + rng.int(3) - 1, y, Cell.Vines, vineColor());
    }
  }
  for (let n = 0; n < 90; n++) {
    const x = at.x0 + 9 + rng.int(Math.max(1, spec.w - 18));
    const y = floorY - 1 - rng.int(8);
    const moss = rng.next() < 0.68;
    setCell(world, x, y, moss ? Cell.Moss : Cell.Fungus, moss ? mossColor() : fungusColor());
  }
  for (let n = 0; n < 8; n++) {
    const x = at.x0 + 16 + rng.int(Math.max(1, spec.w - 32));
    const y = at.y0 + 14 + rng.int(12);
    setCell(world, x, y, Cell.Glowshroom, glowshroomColor());
  }
  for (let n = 0; n < 18; n++) {
    setCell(world, at.x0 + 14 + rng.int(Math.max(1, spec.w - 28)), floorY - 1, Cell.Gold, goldColor());
  }

  const spawn = { x: at.x0 + Math.floor(spec.w / 2), y: floorY - 1 };
  return { spawn, mouth: { x: spawn.x, y: spawn.y - 8 } };
}

function stampStoneMawSeam(world: World, rng: Rng, at: LairSite, spec: LairSpec): LairStamp {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - 10;
  carvePocket(world, at.x0 + Math.floor(spec.w / 2) - 8, at.y0 + Math.floor(spec.h / 2), 34, 17);
  carveRect(world, at.x0 + 8, at.y0 + 11, x1 - 24, floorY - 1);

  for (let y = floorY; y <= floorY + 4; y++) {
    for (let x = at.x0 + 7; x <= x1 - 7; x++) setCell(world, x, y, Cell.Stone, stoneColor());
  }
  for (let y = at.y0 + 11; y <= floorY - 2; y++) {
    for (let x = x1 - 25; x <= x1 - 8; x++) {
      const r = rng.next();
      if (r < 0.18) setCell(world, x, y, Cell.RawOre, rawOreColor());
      else if (r < 0.34) setCell(world, x, y, Cell.Coal, coalColor());
      else setCell(world, x, y, Cell.Stone, stoneColor());
    }
  }
  for (let n = 0; n < 22; n++) {
    const x = x1 - 24 + rng.int(16);
    const y = floorY - 2 - rng.int(Math.max(1, spec.h - 20));
    const ore = rng.next() < 0.55;
    setCell(world, x, y, ore ? Cell.RawOre : Cell.Coal, ore ? rawOreColor() : coalColor());
  }

  const spawn = { x: x1 - 38, y: floorY - 1 };
  return { spawn, mouth: { x: spawn.x, y: spawn.y - 8 } };
}

function stampRillbackPool(world: World, rng: Rng, at: LairSite, spec: LairSpec): LairStamp {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - 9;
  carvePocket(world, at.x0 + Math.floor(spec.w / 2), at.y0 + Math.floor(spec.h / 2), 36, 18);
  carveRect(world, at.x0 + 8, at.y0 + 9, x1 - 8, floorY - 1);

  for (let y = floorY; y <= floorY + 5; y++) {
    for (let x = at.x0 + 8; x <= x1 - 8; x++) setCell(world, x, y, Cell.Stone, stoneColor());
  }
  const pool = rillbackPoolRect(at, spec);
  sealRillbackPool(world, at, spec);
  for (let x = at.x0 + 11; x <= x1 - 11; x++) {
    if (rng.next() < 0.7) setCell(world, x, pool.top - 1, Cell.Moss, mossColor());
  }
  for (let n = 0; n < 12; n++) {
    setCell(world, pool.x1 + 3 + rng.int(Math.max(1, x1 - pool.x1 - 12)), floorY - 1, Cell.Gold, goldColor());
  }

  const spawn = { x: at.x0 + Math.floor(spec.w / 2), y: floorY - 5 };
  return { spawn, mouth: { x: at.x0 + 15, y: floorY - 30 } };
}

function rillbackPoolRect(at: LairSite, spec: LairSpec): { x0: number; x1: number; top: number; bottom: number } {
  const x1 = at.x0 + spec.w - 1;
  const floorY = at.y0 + spec.h - 9;
  return { x0: at.x0 + 25, x1: x1 - 18, top: floorY - 14, bottom: floorY - 1 };
}

function sealRillbackPool(world: World, at: LairSite, spec: LairSpec): void {
  const pool = rillbackPoolRect(at, spec);
  for (let y = pool.top; y <= pool.bottom; y++) {
    for (let x = pool.x0 - 2; x <= pool.x0; x++) setCell(world, x, y, Cell.Stone, stoneColor());
    for (let x = pool.x1; x <= pool.x1 + 2; x++) setCell(world, x, y, Cell.Stone, stoneColor());
  }
  for (let y = pool.bottom + 1; y <= pool.bottom + 6; y++) {
    for (let x = pool.x0 - 2; x <= pool.x1 + 2; x++) setCell(world, x, y, Cell.Stone, stoneColor());
  }
  for (let y = pool.top; y <= pool.bottom; y++) {
    for (let x = pool.x0; x <= pool.x1; x++) {
      const sideWall = x === pool.x0 || x === pool.x1;
      if (sideWall) {
        setCell(world, x, y, Cell.Stone, stoneColor());
        continue;
      }
      const r = Math.abs((x * 31 + y * 17 + x * y) % 100);
      if (r < 5) setCell(world, x, y, Cell.Blood, bloodColor());
      else if (r < 12) setCell(world, x, y, Cell.Slime, slimeColor());
      else setCell(world, x, y, Cell.Water, waterColor());
    }
  }
}

function carveRillbackDryAccess(world: World, at: LairSite, spec: LairSpec): void {
  const floorY = at.y0 + spec.h - 9;
  carveRect(world, at.x0 + 8, at.y0 + 9, at.x0 + 22, floorY + 42);
  carveRect(world, at.x0 + 8, floorY + 9, at.x0 + 34, floorY + 42);
}
