import { describe, expect, it } from 'vitest';
import { HEIGHT, WIDTH } from '@/config/constants';
import type { PrefabBudget } from '@/config/gen';
import { Rng, hashSeed } from '@/core/rng';
import type { Ctx, RegionGraph } from '@/core/types';
import { decodePrefabCells } from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';
import { objectFootprint } from '@/builder/document';
import { Cell, blocksEntity } from '@/sim/CellType';
import { World } from '@/sim/World';
import { applyCampaignDressing } from '@/world/biomeExtras';
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
  it('loads the seven builtins, sanitized and filename-sorted', () => {
    const all = builtinPrefabs();
    expect(all.map((p) => p.id)).toEqual([
      'builtin-brazier-shrine',
      'machine-alchemy-clock',
      'machine-crystal-relay-vault',
      'machine-kiln-elevator',
      'machine-powder-mill',
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
    expect(queryPrefabs(['machine']).length).toBe(4);
    expect(queryPrefabs(['powdermill', 'kilnelevator']).length).toBe(2);
    expect(queryPrefabs(['no-such-tag']).length).toBe(0);
  });
});

/* ---------------- earnability ---------------- */

/**
 * WIZARD-CLEARANCE earnability audit. The player's collision box is 9x17
 * cells and entityFree demands EVERY cell of it clear — so cell-BFS
 * reachability is meaningless for walkability (the bug this audit replaces:
 * rooms 12-16 tall passed CI that the wizard could never stand in).
 *
 * The grid gets an open APRON beyond each anchor (worldgen carves a tunnel
 * of the anchor's gauge there). Two masks per round:
 *  - cellSeen: plain open-cell BFS (the medium's view — water/sand/fire);
 *  - feetSeen: positions where the 9x17 box FITS, connected by walking
 *    (1-col steps) and jumps (up to 12 cells of rise per step).
 * Hands-on triggers (plate/lever/brazier/scale/buoy/chargeLatch) and plug
 * faces must be FEET-reachable; sensors/counterweights are machine-fed
 * (cell-reachable); relays chain as logic; gates open per round; pickups
 * must ALL be feet-reachable (loot inside our rooms is earnable, not
 * buried). Mirrors builder/validate.ts semantics, with the body size made
 * honest.
 */
const PW = 4; // player halfW (entities/physics.ts tryMoveEntity calls)
const PH = 17; // player height — all 17 rows must be clear
const JUMP = 12; // conservative standing-jump rise
const APRON = 26; // open exterior carved beyond each anchor

function earnabilityAudit(p: PrefabDef): {
  triggersReachable: boolean;
  doorsEarned: boolean;
  pickupReachable: boolean;
} {
  const cells = decodePrefabCells(p);
  const GW = p.w + APRON * 2,
    GH = p.h + APRON * 2;
  const OX = APRON,
    OY = APRON; // prefab-local -> padded grid offset
  const gates = p.objects.filter(
    (o) => o.kind === 'door' || o.kind === 'runeDoor' || o.kind === 'valve',
  );
  const plugs = p.objects.filter((o) => o.kind === 'plug');
  const relays = p.objects.filter((o) => o.kind === 'relay');
  const trigLinks = p.links.filter((l) => l.kind === 'triggerDoor');
  const HANDS_ON = new Set(['plate', 'lever', 'brazier', 'scale', 'buoy', 'chargeLatch']);
  const openDoors = new Set<string>();
  const firedRelays = new Set<string>();

  const buildBlocked = (): Uint8Array => {
    const blocked = new Uint8Array(GW * GH).fill(1);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        blocked[OX + x + (OY + y) * GW] = blocksEntity(cells[x + y * p.w]) ? 1 : 0;
      }
    }
    // anchor aprons: an open corridor of the anchor's gauge running outward
    for (const a of p.anchors ?? []) {
      const half = a.halfW ?? 4;
      const dx = a.dir === 'e' ? 1 : a.dir === 'w' ? -1 : 0;
      const dy = a.dir === 's' ? 1 : a.dir === 'n' ? -1 : 0;
      for (let step = 0; step <= APRON; step++) {
        const cx = OX + a.x + dx * step,
          cy = OY + a.y + dy * step;
        for (let o = -half; o <= half; o++) {
          const X = cx + (dy !== 0 ? o : 0),
            Y = cy + (dx !== 0 ? o : 0);
          if (X >= 0 && X < GW && Y >= 0 && Y < GH) blocked[X + Y * GW] = 0;
        }
      }
    }
    for (const d of [...gates, ...plugs]) {
      if (openDoors.has(d.id)) continue;
      const fp = objectFootprint(d);
      if (!fp) continue;
      for (let y = fp.y0; y <= fp.y1; y++) {
        for (let x = fp.x0; x <= fp.x1; x++) {
          const X = OX + x,
            Y = OY + y;
          if (X >= 0 && X < GW && Y >= 0 && Y < GH) blocked[X + Y * GW] = 1;
        }
      }
    }
    return blocked;
  };

  /** Feet positions where the full 9x17 body fits (strict erosion). */
  const erodeFeet = (blocked: Uint8Array): Uint8Array => {
    const hRun = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) {
      let run = 0;
      for (let x = 0; x < GW; x++) {
        run = blocked[x + y * GW] ? 0 : run + 1;
        if (run >= PW * 2 + 1) hRun[x - PW + y * GW] = 1; // center of the last 9
      }
    }
    const feet = new Uint8Array(GW * GH);
    for (let x = 0; x < GW; x++) {
      let run = 0;
      for (let y = 0; y < GH; y++) {
        run = hRun[x + y * GW] ? run + 1 : 0;
        if (run >= PH) feet[x + y * GW] = 1; // feet at the bottom of the 17
      }
    }
    return feet;
  };

  const bfsCells = (blocked: Uint8Array): Uint8Array => {
    const seen = new Uint8Array(GW * GH);
    const queue: number[] = [];
    for (const a of p.anchors ?? []) {
      const i = OX + a.x + (OY + a.y) * GW;
      if (!blocked[i] && !seen[i]) {
        seen[i] = 1;
        queue.push(i);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % GW,
        y = (i - x) / GW;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const X = x + dx,
          Y = y + dy;
        if (X < 0 || X >= GW || Y < 0 || Y >= GH) continue;
        const j = X + Y * GW;
        if (seen[j] || blocked[j]) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    return seen;
  };

  /** Walk + jump over the feet mask: 1-col steps, rise up to JUMP, any fall. */
  const bfsFeet = (feet: Uint8Array): Uint8Array => {
    const seen = new Uint8Array(GW * GH);
    const queue: number[] = [];
    // seed every valid feet position inside the anchor aprons
    for (const a of p.anchors ?? []) {
      const dx = a.dir === 'e' ? 1 : a.dir === 'w' ? -1 : 0;
      const dy = a.dir === 's' ? 1 : a.dir === 'n' ? -1 : 0;
      const half = a.halfW ?? 4;
      for (let step = 0; step <= APRON; step++) {
        const cx = OX + a.x + dx * step,
          cy = OY + a.y + dy * step;
        for (let o = -half; o <= half; o++) {
          const X = cx + (dy !== 0 ? o : 0),
            Y = cy + (dx !== 0 ? o : 0);
          if (X < 0 || X >= GW || Y < 0 || Y >= GH) continue;
          const i = X + Y * GW;
          if (feet[i] && !seen[i]) {
            seen[i] = 1;
            queue.push(i);
          }
        }
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % GW,
        y = (i - x) / GW;
      for (const dx of [-1, 0, 1]) {
        const X = x + dx;
        if (X < 0 || X >= GW) continue;
        for (let dy = -JUMP; dy < GH - y; dy++) {
          const Y = y + dy;
          if (Y < 0 || Y >= GH) continue;
          const j = X + Y * GW;
          if (!seen[j] && feet[j]) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
    }
    return seen;
  };

  const near = (seen: Uint8Array, x: number, y: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const X = OX + Math.floor(x) + dx,
          Y = OY + Math.floor(y) + dy;
        if (X >= 0 && Y >= 0 && X < GW && Y < GH && seen[X + Y * GW]) return true;
      }
    }
    return false;
  };

  let blocked = buildBlocked();
  let cellSeen = bfsCells(blocked);
  let feetSeen = bfsFeet(erodeFeet(blocked));
  const rebuild = (): void => {
    blocked = buildBlocked();
    cellSeen = bfsCells(blocked);
    feetSeen = bfsFeet(erodeFeet(blocked));
  };

  type O = PrefabDef['objects'][number];
  const trigEarnable = (t: O): boolean =>
    t.kind === 'plug'
      ? openDoors.has(t.id)
      : t.kind === 'relay'
        ? firedRelays.has(t.id)
        : HANDS_ON.has(t.kind)
          ? near(feetSeen, t.x, t.y - 1, 6) // the wizard must STAND here
          : near(cellSeen, t.x, t.y - 2, 5); // machine-fed (sensor/counterweight)

  let changed = true;
  while (changed) {
    changed = false;
    for (const r of relays) {
      if (firedRelays.has(r.id)) continue;
      const ins = trigLinks
        .filter((l) => l.toId === r.id)
        .map((l) => p.objects.find((o) => o.id === l.fromId))
        .filter((t): t is O => t !== undefined);
      const ok =
        ins.length > 0 &&
        (r.params.logic === 'or' ? ins.some(trigEarnable) : ins.every(trigEarnable));
      if (ok) {
        firedRelays.add(r.id);
        changed = true;
      }
    }
    for (const pl of plugs) {
      if (openDoors.has(pl.id)) continue;
      const fp = objectFootprint(pl)!;
      const faceable = near(
        feetSeen,
        (fp.x0 + fp.x1) / 2,
        (fp.y0 + fp.y1) / 2,
        Math.ceil(Math.max(fp.x1 - fp.x0, fp.y1 - fp.y0) / 2) + 6,
      );
      const detonated = trigLinks.some((l) => l.toId === pl.id && firedRelays.has(l.fromId));
      if (faceable || detonated) {
        openDoors.add(pl.id);
        rebuild();
        changed = true;
      }
    }
    for (const d of gates) {
      if (openDoors.has(d.id)) continue;
      const trigs = trigLinks
        .filter((l) => l.toId === d.id)
        .map((l) => p.objects.find((o) => o.id === l.fromId));
      if (trigs.length === 0 || trigs.some((t) => t === undefined)) continue;
      const ok =
        d.params.logic === 'or'
          ? trigs.some((t) => trigEarnable(t!))
          : trigs.every((t) => trigEarnable(t!));
      if (ok) {
        openDoors.add(d.id);
        rebuild();
        changed = true;
      }
    }
  }

  const triggersReachable = trigLinks.every((l) => {
    const t = p.objects.find((o) => o.id === l.fromId);
    return t !== undefined && trigEarnable(t);
  });
  const doorsEarned =
    gates.every((d) => openDoors.has(d.id)) && plugs.every((pl) => openDoors.has(pl.id));
  // EVERY pickup must be wizard-reachable: loot inside an authored room is
  // a promise, not buried treasure
  const pickups = p.objects.filter((o) => o.kind === 'pickup');
  const pickupReachable =
    pickups.length === 0 || pickups.every((o) => near(feetSeen, o.x, o.y - 1, 6));
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

describe('the clearance audit has teeth', () => {
  it('a 14-tall corridor (the old bug) FAILS the wizard-clearance audit', () => {
    // hand-built regression shape: anchor throat + corridor only 14 tall
    // (cell-BFS sails through; a 9x17 body cannot)
    const w = 60,
      h = 30;
    const cells = new Uint8Array(w * h).fill(Cell.Wall);
    for (let y = 10; y <= 23; y++) {
      for (let x = 0; x < w; x++) cells[x + y * w] = Cell.Empty; // 14 tall
    }
    const rleEncode = (types: Uint8Array): string => {
      const out: number[] = [];
      let run = 1;
      for (let i = 1; i <= types.length; i++) {
        if (i < types.length && types[i] === types[i - 1] && run < 0xffff) {
          run++;
          continue;
        }
        out.push(run & 0xff, (run >> 8) & 0xff, types[i - 1]);
        run = 1;
      }
      return btoa(String.fromCharCode(...out));
    };
    const tight: PrefabDef = {
      v: 1,
      kind: 'prefab',
      id: 'test-too-tight',
      name: 'too tight',
      tags: [],
      w,
      h,
      rle: rleEncode(cells),
      objects: [
        {
          id: 'gold0', kind: 'pickup', x: 50, y: 22, rotation: 0,
          locked: false, hidden: false, params: { kind: 'goldpile', amount: 10 },
        },
      ],
      links: [],
      lights: [],
      anchors: [{ id: 'aw', x: 0, y: 16, dir: 'w', kind: 'open', halfW: 10 }],
    };
    const audit = earnabilityAudit(tight);
    expect(audit.pickupReachable).toBe(false); // the wizard cannot stand in 14 rows
  });
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

  it('machine budget places a chain-reaction room with fully wired mechanisms', () => {
    const world = new World();
    world.types.fill(Cell.Wall);
    const ctx = stubCtx(world);
    const sink = makeInstantiationSink();
    const placed = placePrefabs(
      ctx,
      new Rng(hashSeed(11, 'machines')),
      stubGraph(800, 500),
      new PlacementLedger(),
      sink,
      { count: [1, 1], tags: ['powdermill'], minSpacing: 200, minSpawnDist: 150 },
      SITE,
    );
    expect(placed.length).toBe(1);
    expect(placed[0].id).toBe('machine-powder-mill');
    const one = (k: string) => sink.mechanisms.find((m) => m.kind === k)!;
    const relay = one('relay'),
      plug = one('plug'),
      cw = one('counterweight'),
      door = one('door'),
      brazier = one('brazier');
    expect(relay && plug && cw && door && brazier).toBeTruthy();
    // the chain is wired: brazier -> relay -IGNITE-> plug; counterweight -> door
    expect(brazier.targetId).toBe(relay.id);
    expect(relay.targetId).toBe(plug.id);
    expect(relay.outputAction).toBe('ignite');
    expect(cw.targetId).toBe(door.id);
    // and the hopper is real sand sitting on the stamped wooden plug
    expect(plug.material).toBe(Cell.Wood);
    expect(plug.body!.length).toBeGreaterThan(0);
    for (const [bx, by] of plug.body!) {
      expect(world.types[world.idx(bx, by)]).toBe(Cell.Wood);
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

describe('applyCampaignDressing', () => {
  it('enriches unreserved wall without touching reserved or interactive footprints', () => {
    const world = new World();
    world.types.fill(Cell.Wall);
    world.colors.fill(0x010203);
    const ctx = {
      world,
      state: { mode: 'build', currentBiome: 'crystal' },
      worldgen: { spawnHint: { x: 40, y: 40 }, paintSeed: null },
    } as unknown as Ctx;
    const ledger = new PlacementLedger();
    ledger.reserve(90, 90, 130, 130, 'reserved-test');

    const stats = applyCampaignDressing(
      ctx,
      new Rng(hashSeed(12345, 'campaign-dressing-test')),
      'crystal',
      ledger,
      {
        pickups: [{ kind: 'key', x: 180, y: 120, vx: 0, vy: 0, taken: false, data: {} }],
        mechanisms: [{ id: 1, kind: 'door', x: 240, y: 80, w: 10, h: 30, state: 0, targetId: -1 }],
        runeVaults: [{ rx: 304, ry: 130, door: [[300, 132], [301, 132]], active: true }],
        portal: { x: 350, y: 120, open: false },
        waystones: [{ x: 390, y: 120, lit: false }],
        cauldron: { x: 430, y: 120 },
      },
    );

    expect(stats.cellsChanged).toBeGreaterThan(0);
    expect(stats.veins + stats.pockets).toBeGreaterThan(0);

    const assertUntouched = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = world.idx(x, y);
          expect(world.types[i]).toBe(Cell.Wall);
          expect(world.colors[i]).toBe(0x010203);
        }
      }
    };

    assertUntouched(90, 90, 130, 130);
    assertUntouched(174, 114, 186, 126);
    assertUntouched(240, 80, 250, 110);
    assertUntouched(298, 126, 306, 136);
    assertUntouched(344, 114, 356, 126);
    assertUntouched(384, 114, 396, 126);
    assertUntouched(424, 114, 436, 126);

    let changedCells = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (world.types[world.idx(x, y)] !== Cell.Wall) changedCells++;
      }
    }
    expect(changedCells).toBe(stats.cellsChanged);
  });

  it('keeps unstable powder and liquid dressing embedded away from traversal-adjacent surfaces', () => {
    const world = new World();
    world.types.fill(Cell.Wall);
    world.colors.fill(0x010203);
    const fits = new Uint8Array(WIDTH * HEIGHT);
    for (let y = 56; y < HEIGHT - 120; y += 30) {
      for (let yy = y; yy <= y + 8; yy++) {
        for (let x = 24; x < WIDTH - 24; x++) {
          world.types[world.idx(x, yy)] = Cell.Empty;
          fits[world.idx(x, yy)] = 1;
        }
      }
    }
    const ctx = {
      world,
      state: { mode: 'build', currentBiome: 'scorched' },
      worldgen: { spawnHint: { x: 40, y: 40 }, paintSeed: null },
    } as unknown as Ctx;

    const stats = applyCampaignDressing(
      ctx,
      new Rng(hashSeed(67890, 'campaign-dressing-route-safety')),
      'scorched',
      new PlacementLedger(),
      { fits },
    );

    expect(stats.cellsChanged).toBeGreaterThan(0);
    const unstable = new Set([Cell.Coal, Cell.Ash, Cell.Gold, Cell.Lava]);
    let routeAdjacentAccents = 0;
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < WIDTH - 1; x++) {
        const i = world.idx(x, y);
        const t = world.types[i];
        if (t === Cell.Empty) continue;
        const nearRoute =
          world.types[world.idx(x, y - 1)] === Cell.Empty ||
          world.types[world.idx(x, y + 1)] === Cell.Empty ||
          world.types[world.idx(x - 1, y)] === Cell.Empty ||
          world.types[world.idx(x + 1, y)] === Cell.Empty;
        if (!nearRoute) continue;
        if (t !== Cell.Wall) routeAdjacentAccents++;
        expect(unstable.has(t)).toBe(false);
      }
    }
    expect(routeAdjacentAccents).toBeGreaterThan(0);
  });

  it('keeps gilded powder pockets embedded away from traversal-adjacent surfaces', () => {
    const world = new World();
    world.types.fill(Cell.Wall);
    world.colors.fill(0x010203);
    const fits = new Uint8Array(WIDTH * HEIGHT);
    for (let y = 56; y < HEIGHT - 120; y += 30) {
      for (let yy = y; yy <= y + 8; yy++) {
        for (let x = 24; x < WIDTH - 24; x++) {
          world.types[world.idx(x, yy)] = Cell.Empty;
          fits[world.idx(x, yy)] = 1;
        }
      }
    }
    const ctx = {
      world,
      state: { mode: 'build', currentBiome: 'gilded' },
      worldgen: { spawnHint: { x: 40, y: 40 }, paintSeed: null },
    } as unknown as Ctx;

    const stats = applyCampaignDressing(
      ctx,
      new Rng(hashSeed(24680, 'campaign-dressing-gilded-route-safety')),
      'gilded',
      new PlacementLedger(),
      { fits },
    );

    expect(stats.cellsChanged).toBeGreaterThan(0);
    const unstable = new Set([Cell.Gold, Cell.Catalyst, Cell.Acid]);
    let routeAdjacentAccents = 0;
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < WIDTH - 1; x++) {
        const i = world.idx(x, y);
        const t = world.types[i];
        if (t === Cell.Empty) continue;
        const nearRoute =
          world.types[world.idx(x, y - 1)] === Cell.Empty ||
          world.types[world.idx(x, y + 1)] === Cell.Empty ||
          world.types[world.idx(x - 1, y)] === Cell.Empty ||
          world.types[world.idx(x + 1, y)] === Cell.Empty;
        if (!nearRoute) continue;
        if (t !== Cell.Wall) routeAdjacentAccents++;
        expect(unstable.has(t)).toBe(false);
      }
    }
    expect(routeAdjacentAccents).toBeGreaterThan(0);
  });
});
