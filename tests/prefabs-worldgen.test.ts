import { describe, expect, it } from 'vitest';
import { WIDTH } from '@/config/constants';
import type { PrefabBudget } from '@/config/gen';
import { Rng, hashSeed } from '@/core/rng';
import type { Ctx, RegionGraph } from '@/core/types';
import { decodePrefabCells } from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';
import { objectFootprint } from '@/builder/document';
import { Cell, blocksEntity } from '@/sim/CellType';
import { World } from '@/sim/World';
import { PlacementLedger } from '@/world/connect';
import { makeInstantiationSink } from '@/game/instantiate';
import { placePrefabs } from '@/world/prefabs/place';
import { builtinPrefabs, queryPrefabs } from '@/world/prefabs/registry';
import { breachSkinCell } from '@/world/secrets';

/**
 * Worldgen prefab suite: the builtin registry loads sanitized, every builtin
 * passes an EARNABILITY audit (anchors reach triggers, triggers earn doors,
 * doors expose loot — a BFS fixpoint that mirrors validateFindability's
 * "mechanism-correct is NOT player-findable" rule), and the placement pass
 * is deterministic, ledger-respecting, and reseals sealed anchors with
 * breachable (non-Metal, entity-blocking) skin.
 */

/* ---------------- registry ---------------- */

describe('builtin prefab registry', () => {
  it('loads the three builtins, sanitized and filename-sorted', () => {
    const all = builtinPrefabs();
    expect(all.map((p) => p.id)).toEqual([
      'builtin-brazier-shrine',
      'builtin-plate-vault',
      'builtin-ruin-gallery',
    ]);
    for (const p of all) {
      expect(p.v).toBe(1);
      expect(p.kind).toBe('prefab');
      expect(decodePrefabCells(p).length).toBe(p.w * p.h);
      expect(p.anchors && p.anchors.length).toBeGreaterThan(0);
      expect(p.tags).toContain('builtin');
    }
  });

  it('queryPrefabs filters by tag and requires anchors', () => {
    expect(queryPrefabs(['vault']).map((p) => p.id)).toEqual(['builtin-plate-vault']);
    expect(queryPrefabs(['shrine']).map((p) => p.id)).toEqual(['builtin-brazier-shrine']);
    expect(queryPrefabs(['vault', 'shrine', 'setpiece']).length).toBe(3);
    expect(queryPrefabs(['no-such-tag']).length).toBe(0);
  });
});

/* ---------------- earnability ---------------- */

/** BFS over !blocksEntity cells of the prefab-local grid; closed doors are
 *  stamped solid (their metal IS solid until earned). */
function earnabilityAudit(p: PrefabDef): {
  triggersReachable: boolean;
  doorsEarned: boolean;
  pickupReachable: boolean;
} {
  const cells = decodePrefabCells(p);
  const doors = p.objects.filter((o) => o.kind === 'door' || o.kind === 'runeDoor');
  const trigLinks = p.links.filter((l) => l.kind === 'triggerDoor');
  const openDoors = new Set<string>();

  const buildBlocked = (): Uint8Array => {
    const blocked = new Uint8Array(p.w * p.h);
    for (let i = 0; i < cells.length; i++) blocked[i] = blocksEntity(cells[i]) ? 1 : 0;
    for (const d of doors) {
      if (openDoors.has(d.id)) continue;
      const fp = objectFootprint(d);
      if (!fp) continue;
      for (let y = Math.max(0, fp.y0); y <= Math.min(p.h - 1, fp.y1); y++) {
        for (let x = Math.max(0, fp.x0); x <= Math.min(p.w - 1, fp.x1); x++) {
          blocked[x + y * p.w] = 1;
        }
      }
    }
    return blocked;
  };

  const bfs = (): Uint8Array => {
    const blocked = buildBlocked();
    const seen = new Uint8Array(p.w * p.h);
    const queue: number[] = [];
    for (const a of p.anchors ?? []) {
      const i = a.x + a.y * p.w;
      if (!blocked[i] && !seen[i]) {
        seen[i] = 1;
        queue.push(i);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % p.w,
        y = (i - x) / p.w;
      for (const [dx, dy] of [
        [1, 0], [-1, 0], [0, 1], [0, -1],
      ] as const) {
        const X = x + dx,
          Y = y + dy;
        if (X < 0 || X >= p.w || Y < 0 || Y >= p.h) continue;
        const j = X + Y * p.w;
        if (seen[j] || blocked[j]) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    return seen;
  };

  const near = (seen: Uint8Array, x: number, y: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const X = Math.floor(x) + dx,
          Y = Math.floor(y) + dy;
        if (X >= 0 && Y >= 0 && X < p.w && Y < p.h && seen[X + Y * p.w]) return true;
      }
    }
    return false;
  };

  // Fixpoint: triggers reachable -> their doors open -> repeat until stable.
  let seen = bfs();
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of doors) {
      if (openDoors.has(d.id)) continue;
      const trigs = trigLinks
        .filter((l) => l.toId === d.id)
        .map((l) => p.objects.find((o) => o.id === l.fromId));
      if (trigs.length === 0 || trigs.some((t) => t === undefined)) continue;
      if (trigs.every((t) => near(seen, t!.x, t!.y - 2, 4))) {
        openDoors.add(d.id);
        seen = bfs();
        changed = true;
      }
    }
  }

  const triggersReachable = trigLinks.every((l) => {
    const t = p.objects.find((o) => o.id === l.fromId);
    return t !== undefined && near(seen, t.x, t.y - 2, 4);
  });
  const doorsEarned = doors.every((d) => openDoors.has(d.id));
  const pickupReachable = p.objects
    .filter((o) => o.kind === 'pickup')
    .some((o) => near(seen, o.x, o.y - 1, 3));
  return { triggersReachable, doorsEarned, pickupReachable };
}

describe('builtin prefab earnability', () => {
  for (const p of builtinPrefabs()) {
    it(`${p.id}: anchors open, triggers reach, doors earn, loot exposed`, () => {
      // every anchor must sit on an authored-open cell (the throat)
      const cells = decodePrefabCells(p);
      for (const a of p.anchors ?? []) {
        expect(blocksEntity(cells[a.x + a.y * p.w])).toBe(false);
      }
      const audit = earnabilityAudit(p);
      expect(audit.triggersReachable).toBe(true);
      expect(audit.doorsEarned).toBe(true);
      expect(audit.pickupReachable).toBe(true);
    });
  }
});

/* ---------------- placement ---------------- */

function stubCtx(world: World): Ctx {
  return {
    world,
    enemies: [],
    player: { x: -500, y: -500 },
    state: { mode: 'build', currentBiome: 'earthen' },
  } as unknown as Ctx;
}

function stubGraph(cx: number, cy: number): RegionGraph {
  return {
    scale: 4,
    w: 400,
    h: 266,
    labels: new Int32Array(0),
    regions: [{ id: 0, area: 5000, cx, cy, onMainPath: true, isPocket: false }],
    edges: [],
    mainPath: [0],
    spawnRegion: 0,
    exitRegion: 0,
  };
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const SITE = { spawn: { x: 100, y: 100 }, wellX: 100 };

describe('placePrefabs', () => {
  const budget: PrefabBudget = {
    count: [2, 3],
    tags: ['vault', 'shrine', 'setpiece'],
    minSpacing: 150,
    minSpawnDist: 150,
  };

  function run(seed: number): {
    placed: ReturnType<typeof placePrefabs>;
    hash: string;
    mechs: Array<[string, number, number, number]>;
  } {
    const world = new World();
    world.types.fill(Cell.Wall);
    const ctx = stubCtx(world);
    const sink = makeInstantiationSink();
    const placed = placePrefabs(
      ctx,
      new Rng(hashSeed(seed, 'prefabs')),
      stubGraph(800, 500),
      new PlacementLedger(),
      sink,
      budget,
      SITE,
    );
    return {
      placed,
      hash: fnv1a(world.types),
      mechs: sink.mechanisms.map((m) => [m.kind, m.x, m.y, m.targetId]),
    };
  }

  it('same seed + same graph -> identical placements, cells, mechanisms', () => {
    const a = run(42);
    const b = run(42);
    expect(a.placed.length).toBeGreaterThan(0);
    expect(b.placed).toEqual(a.placed);
    expect(b.hash).toBe(a.hash);
    expect(b.mechs).toEqual(a.mechs);
  });

  it('placed prefabs respect the ledger and their own spacing', () => {
    const a = run(7);
    const ledger = new PlacementLedger();
    ledger.reserve(SITE.spawn.x - 60, SITE.spawn.y - 60, SITE.spawn.x + 60, SITE.spawn.y + 60, 'spawn');
    for (const p of a.placed) {
      expect(ledger.intersects(p.x0, p.y0, p.x1, p.y1)).toBe(false);
      expect(p.x0).toBeGreaterThanOrEqual(0);
      expect(p.x1).toBeLessThan(WIDTH);
    }
  });

  it('reseals sealed anchors with breachable non-Metal skin near the mouth', () => {
    const world = new World();
    world.types.fill(Cell.Wall);
    const ctx = stubCtx(world);
    const sink = makeInstantiationSink();
    const sealBudget: PrefabBudget = {
      count: [1, 1],
      tags: ['vault'],
      minSpacing: 150,
      minSpawnDist: 150,
    };
    const placed = placePrefabs(
      ctx,
      new Rng(hashSeed(9, 'prefabs')),
      stubGraph(800, 500),
      new PlacementLedger(),
      sink,
      sealBudget,
      SITE,
    );
    expect(placed.length).toBe(1);
    const vault = builtinPrefabs().find((p) => p.id === 'builtin-plate-vault')!;
    const sealed = vault.anchors!.find((a) => a.kind === 'sealed')!;
    const ax = placed[0].x0 + sealed.x,
      ay = placed[0].y0 + sealed.y;
    const skin = breachSkinCell('earthen');
    expect(skin).toBe(Cell.Sand);
    // the plug fills carved air around the first connector steps — skin cells
    // must appear near the mouth, and every one must block entities without
    // being Metal (breachable: dig it, blast it, drown it in fire)
    let plugCells = 0;
    for (let dy = -14; dy <= 14; dy++) {
      for (let dx = -14; dx <= 14; dx++) {
        const X = ax + dx,
          Y = ay + dy;
        if (!world.inBounds(X, Y)) continue;
        const t = world.types[world.idx(X, Y)];
        if (t === skin) {
          plugCells++;
          expect(blocksEntity(t)).toBe(true);
          expect(t).not.toBe(Cell.Metal);
        }
      }
    }
    expect(plugCells).toBeGreaterThan(5);
  });
});

/* ---------------- ledger ---------------- */

describe('PlacementLedger', () => {
  it('intersects on overlap and touch, not on clear separation', () => {
    const ledger = new PlacementLedger();
    expect(ledger.intersects(0, 0, 1000, 1000)).toBe(false); // empty = inert
    ledger.reserve(100, 100, 200, 200, 'a');
    expect(ledger.intersects(150, 150, 160, 160)).toBe(true); // contained
    expect(ledger.intersects(50, 50, 100, 100)).toBe(true); // corner touch
    expect(ledger.intersects(200, 100, 300, 200)).toBe(true); // edge touch
    expect(ledger.intersects(201, 100, 300, 200)).toBe(false); // 1 cell clear
    expect(ledger.intersects(0, 0, 99, 99)).toBe(false);
    // reversed corners normalize
    ledger.reserve(400, 400, 300, 300, 'b');
    expect(ledger.intersects(350, 350, 350, 350)).toBe(true);
    expect(ledger.rects().length).toBe(2);
    expect(ledger.rects()[1]).toEqual({ x0: 300, y0: 300, x1: 400, y1: 400, label: 'b' });
  });
});
