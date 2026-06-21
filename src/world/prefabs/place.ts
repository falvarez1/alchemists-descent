import { HEIGHT, WIDTH } from '@/config/constants';
import type { PrefabBudget } from '@/config/gen';
import type { Rng } from '@/core/rng';
import type { Ctx, PlacedPrefab, RegionGraph } from '@/core/types';
import { decodePrefabCells } from '@/authoring/prefab';
import type { PrefabAnchor, PrefabDef } from '@/authoring/prefab';
import type { CellSetter } from '@/authoring/stamps';
import { instantiateObjects } from '@/game/instantiate';
import type { InstantiationSink } from '@/game/instantiate';
import type { ResolvedSprite } from '@/authoring/spriteRuntime';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import type { World } from '@/sim/World';
import { carvePocket, connectToCaves } from '@/world/connect';
import type { PlacementLedger } from '@/world/connect';
import { queryPrefabs } from '@/world/prefabs/registry';
import { breachSkinCell, breachSkinColorFn } from '@/world/secrets';

/**
 * Authored prefabs in worldgen: seeded stamping of built-in PrefabDef chunks
 * into a freshly generated level, tunneled to the cave network through their
 * anchors, objects instantiated through the SAME pass the Builder compiler
 * uses. All randomness flows through the caller's FORKED rng stream, so the
 * main generation stream keeps byte-identical output per seed.
 *
 * Slots are optional: site search relaxes progressively (the Wave E house
 * convention) and an exhausted slot logs loudly in DEV and moves on — a
 * missing setpiece is acceptable, a buried lock is not (anchors + ledger
 * keep what IS placed honest).
 */

const DIRS: Record<PrefabAnchor['dir'], [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

/** Footprint margin (cells) sampled around a candidate site. */
const SITE_MARGIN = 4;
/** Minimum |centerX - exit well column| at tier 1. */
const WELL_CLEARANCE = 160;
/** Carved connector cross-section radius (matches connectToCaves pockets). */
const PLUG_RADIUS = 4;
/** Connector steps resealed behind a 'sealed' anchor. */
const PLUG_STEPS = 5;

export function placePrefabs(
  ctx: Ctx,
  rng: Rng,
  graph: RegionGraph,
  ledger: PlacementLedger,
  sink: InstantiationSink,
  budget: PrefabBudget,
  site: { spawn: { x: number; y: number }; wellX: number },
  fits?: Uint8Array,
): PlacedPrefab[] {
  const world = ctx.world;
  const placed: PlacedPrefab[] = [];
  const candidates = queryPrefabs(budget.tags);
  if (candidates.length === 0) return placed;

  const [lo, hi] = budget.count;
  const slots = lo + rng.int(Math.max(1, hi - lo + 1));

  // Structural object stamps (door slabs, rune doors, basins) write factory
  // colors; bedrock/casing Metal is never overwritten by a prefab.
  const set: CellSetter = (x, y, t) => {
    if (!world.inBounds(x, y)) return;
    const i = world.idx(x, y);
    if (world.types[i] === Cell.Metal) return;
    world.types[i] = t;
    const fn = COLOR_FN[t];
    world.colors[i] = fn ? fn() : EMPTY_COLOR;
    world.life[i] = 0;
    world.charge[i] = 0;
  };

  const usedIds = new Set<string>();
  // One decode cache across every prefab in the level: sprite decor in two
  // placed prefabs referencing the same asset shares one set of frame
  // buffers (resolution falls back to the local sprite library; built-in
  // prefabs that reference no sprites never touch it).
  const spriteCache = new Map<string, ResolvedSprite | null>();
  for (let slot = 0; slot < slots; slot++) {
    // Avoid repeating a prefab id within the level while alternatives remain.
    const fresh = candidates.filter((p) => !usedIds.has(p.id));
    const pool = fresh.length > 0 ? fresh : candidates;
    const prefab = pool[rng.int(pool.length)];

    const at = findSite(world, rng, ledger, prefab, budget, site, placed);
    if (!at) {
      if (import.meta.env.DEV) {
        console.warn(
          `[prefabs] skipped ${prefab.id} (slot ${slot + 1}/${slots}) — no site after 9000 tries`,
        );
      }
      continue;
    }
    usedIds.add(prefab.id);

    stampPrefab(world, prefab, at.x0, at.y0);
    ledger.reserve(
      at.x0 - 2,
      at.y0 - 2,
      at.x0 + prefab.w + 1,
      at.y0 + prefab.h + 1,
      'prefab:' + prefab.id,
    );
    openAnchors(ctx, rng, graph, prefab, at.x0, at.y0, fits);
    instantiateObjects(
      ctx,
      sink,
      prefab.objects,
      prefab.links,
      prefab.lights,
      at.x0,
      at.y0,
      set,
      { spriteCache, spriteLookup: () => null },
    );
    placed.push({
      id: prefab.id,
      x0: at.x0,
      y0: at.y0,
      x1: at.x0 + prefab.w - 1,
      y1: at.y0 + prefab.h - 1,
    });
  }
  return placed;
}

/**
 * Progressive-relaxation site search (mirrors structures' Wave E loop):
 *   tier 1 (tries <4000): footprint+margin >=80% solid rock, zero Metal,
 *     off reserved ground, full spawn/well/spacing clearances;
 *   tier 2 (<7000): rock >=50%, clearances x0.65;
 *   tier 3 (<9000): only Metal-free + ledger + half clearances.
 */
function findSite(
  world: World,
  rng: Rng,
  ledger: PlacementLedger,
  prefab: PrefabDef,
  budget: PrefabBudget,
  site: { spawn: { x: number; y: number }; wellX: number },
  placed: PlacedPrefab[],
): { x0: number; y0: number } | null {
  const w = prefab.w,
    h = prefab.h;
  const xSpan = WIDTH - w - 12;
  const ySpan = HEIGHT - 60 - h - 24;
  if (xSpan < 1 || ySpan < 1) return null;

  for (let tries = 0; tries < 9000; tries++) {
    const rockMin = tries < 4000 ? 0.8 : tries < 7000 ? 0.5 : 0;
    const distK = tries < 4000 ? 1 : tries < 7000 ? 0.65 : 0.5;
    const x0 = 6 + rng.int(xSpan);
    const y0 = 24 + rng.int(ySpan);
    const cx = x0 + w / 2,
      cy = y0 + h / 2;

    if (Math.hypot(cx - site.spawn.x, cy - site.spawn.y) < budget.minSpawnDist * distK) continue;
    if (Math.abs(cx - site.wellX) < WELL_CLEARANCE * distK) continue;
    let crowded = false;
    for (const p of placed) {
      const pcx = (p.x0 + p.x1) / 2,
        pcy = (p.y0 + p.y1) / 2;
      if (Math.hypot(cx - pcx, cy - pcy) < budget.minSpacing * distK) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;
    if (
      ledger.intersects(
        x0 - SITE_MARGIN,
        y0 - SITE_MARGIN,
        x0 + w - 1 + SITE_MARGIN,
        y0 + h - 1 + SITE_MARGIN,
      )
    )
      continue;

    // Rock scan over footprint+margin, 2-cell sampling (Metal here is only
    // bedrock / well casing — both far thicker than the sample stride).
    let rock = 0,
      cells = 0,
      metal = false;
    for (let yy = y0 - SITE_MARGIN; yy <= y0 + h - 1 + SITE_MARGIN && !metal; yy += 2) {
      for (let xx = x0 - SITE_MARGIN; xx <= x0 + w - 1 + SITE_MARGIN; xx += 2) {
        if (!world.inBounds(xx, yy)) {
          metal = true;
          break;
        }
        const t = world.types[world.idx(xx, yy)];
        if (t === Cell.Metal) {
          metal = true;
          break;
        }
        cells++;
        if (t === Cell.Wall || t === Cell.Stone) rock++;
      }
    }
    if (metal || cells === 0 || rock / cells < rockMin) continue;
    return { x0, y0 };
  }
  return null;
}

/**
 * Write the full authored block — INCLUDING authored Empty (pastePrefab
 * semantics) — with factory colors, then overlay authored life / charge /
 * color overrides. Metal (bedrock, casings) is never overwritten.
 */
function stampPrefab(world: World, prefab: PrefabDef, x0: number, y0: number): void {
  const cells = decodePrefabCells(prefab);
  for (let y = 0; y < prefab.h; y++) {
    for (let x = 0; x < prefab.w; x++) {
      const X = x0 + x,
        Y = y0 + y;
      if (!world.inBounds(X, Y)) continue;
      const i = world.idx(X, Y);
      if (world.types[i] === Cell.Metal) continue;
      const t = cells[x + y * prefab.w];
      world.types[i] = t;
      const fn = COLOR_FN[t];
      world.colors[i] = fn ? fn() : EMPTY_COLOR;
      world.life[i] = 0;
      world.charge[i] = 0;
    }
  }
  const overlay = (
    pairs: Array<[number, number]> | undefined,
    apply: (wi: number, v: number) => void,
  ): void => {
    for (const [li, v] of pairs ?? []) {
      const X = x0 + (li % prefab.w),
        Y = y0 + Math.floor(li / prefab.w);
      if (!world.inBounds(X, Y)) continue;
      const wi = world.idx(X, Y);
      if (world.types[wi] === Cell.Metal) continue; // preserved bedrock
      apply(wi, v);
    }
  };
  overlay(prefab.life, (i, v) => {
    world.life[i] = v;
  });
  overlay(prefab.charge, (i, v) => {
    world.charge[i] = v;
  });
  overlay(prefab.colorOverrides, (i, v) => {
    world.colors[i] = v;
  });
}

/**
 * Tunnel every anchor to the cave network: breach the prefab perimeter with
 * a disc at the anchor, carve the mouth one disc-step outward along the
 * anchor's direction, then connectToCaves from the mouth. 'sealed' anchors
 * reseal the connector steps nearest the mouth with the biome's breach skin
 * (the secrets table) — breachable, non-Metal, entity-blocking cells.
 */
function openAnchors(
  ctx: Ctx,
  rng: Rng,
  graph: RegionGraph,
  prefab: PrefabDef,
  x0: number,
  y0: number,
  fits?: Uint8Array,
): void {
  const world = ctx.world;
  for (const a of prefab.anchors ?? []) {
    const halfW = a.halfW ?? 4;
    const [dx, dy] = DIRS[a.dir];
    const ax = x0 + a.x,
      ay = y0 + a.y;
    // ellipse law: a 9x17 box needs (4.5/rx)^2 + (8.5/ry)^2 <= 1 — circular
    // mouths at the anchor gauge are marginal, so stretch them vertically
    carvePocket(world, ax, ay, halfW, halfW + 2);
    const mx = Math.min(WIDTH - 7, Math.max(6, ax + dx * (halfW + 1)));
    const my = Math.min(HEIGHT - 12, Math.max(26, ay + dy * (halfW + 1)));
    carvePocket(world, mx, my, halfW, halfW + 2);
    // the connector inherits the anchor's gauge: the player's collision box
    // is 9x17, so a WALK-IN anchor (halfW >= 9) gets a walk-in tunnel
    const steps = connectToCaves(world, rng, graph, mx, my, Math.max(4, halfW + 1), fits);

    if (a.kind === 'sealed') {
      const skin = breachSkinCell(ctx.state.currentBiome);
      const skinColor = breachSkinColorFn(ctx.state.currentBiome, rng);
      // the reseal plug scales with the mouth — a wide tunnel needs a wide
      // skin or the BFS (and the player's eye) slips around it
      const plugR = Math.max(PLUG_RADIUS, halfW + 1);
      const plug: Array<[number, number]> =
        steps.length > 0 ? steps.slice(0, PLUG_STEPS) : [[mx, my]];
      for (const [sx, sy] of plug) {
        for (let oy = -plugR; oy <= plugR; oy++) {
          for (let ox = -plugR; ox <= plugR; ox++) {
            if (ox * ox + oy * oy > plugR * plugR) continue;
            const X = sx + ox,
              Y = sy + oy;
            if (!world.inBounds(X, Y)) continue;
            const i = world.idx(X, Y);
            if (world.types[i] !== Cell.Empty) continue; // only reseal carved air
            world.types[i] = skin;
            world.colors[i] = skinColor();
          }
        }
      }
    }
  }
}
