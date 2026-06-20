import { beforeEach, describe, expect, it } from 'vitest';
import { rleEncode } from '@/core/rle';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { PatchRecorder } from '@/builder/terrain';
import type { Region } from '@/builder/terrain';
import { paintTerrainCmd } from '@/builder/commands';
import {
  AUTHORED_LIGHT_BLOOM_MAX,
  AUTHORED_LIGHT_FLICKER_MAX,
  AUTHORED_LIGHT_INTENSITY_MAX,
  AUTHORED_LIGHT_RADIUS_MAX,
  AUTHORED_LIGHT_RADIUS_MIN,
  createEmptyDocument,
  freshId,
} from '@/builder/document';
import type { EditorDocument, EditorObject, EditorObjectKind } from '@/builder/document';
import {
  capturePrefab,
  decodePrefabCells,
  deletePrefab,
  loadPrefabs,
  mirrorPrefab,
  prefabAnchorsCompatible,
  prefabAnchorWorldPoint,
  prefabVariant,
  PREFAB_CELL_CAP,
  pastePrefab,
  rotatePrefab,
  sanitizePrefab,
  savePrefab,
  alignPrefabAnchorToWorldPoint,
} from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';

/**
 * PrefabDef v1 regression suite — the shared contract for the Builder
 * library, the PNG/JSON exporter, and worldgen placement. Transform identity
 * (rotate x4, mirror x2) and lossless paste/undo are the load-bearing
 * guarantees here.
 */

/* node has no localStorage; the library functions get a Map-backed stub */
class StorageStub {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(n: number): string | null {
    return [...this.m.keys()][n] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}
(globalThis as Record<string, unknown>).localStorage = new StorageStub();

function makeObj(
  kind: EditorObjectKind,
  x: number,
  y: number,
  params: Record<string, unknown> = {},
): EditorObject {
  return { id: freshId(kind), kind, x, y, rotation: 0, locked: false, hidden: false, params };
}

/** A small wired room: lever -> door, an enemy with a patrol, one light. */
function wiredRoom(): { world: World; doc: EditorDocument; region: Region } {
  const world = new World();
  world.types.fill(Cell.Wall);
  const region: Region = { x0: 100, y0: 100, x1: 179, y1: 159 }; // 80x60
  for (let y = 105; y <= 150; y++) {
    for (let x = 105; x <= 170; x++) world.types[world.idx(x, y)] = Cell.Empty;
  }
  // a metal block + authored life + charge inside the region
  world.types[world.idx(110, 140)] = Cell.Metal;
  world.life[world.idx(112, 140)] = 90;
  world.types[world.idx(112, 140)] = Cell.Wood;
  world.charge[world.idx(114, 140)] = 7;
  world.types[world.idx(114, 140)] = Cell.Metal;

  const doc = createEmptyDocument('prefab-test', 'earthen');
  const lever = makeObj('lever', 120, 148);
  const door = makeObj('door', 150, 130, { w: 3, h: 13 });
  const enemy = makeObj('enemy', 130, 148, {
    kind: 'slime',
    patrol: [
      [125, 148],
      [140, 148],
    ],
  });
  const spawn = makeObj('spawn', 108, 148);
  const outside = makeObj('plate', 50, 50, { w: 5 });
  doc.objects.push(lever, door, enemy, spawn, outside);
  doc.links.push(
    { id: freshId('link'), fromId: lever.id, toId: door.id, kind: 'triggerDoor' },
    { id: freshId('link'), fromId: outside.id, toId: door.id, kind: 'triggerDoor' },
  );
  doc.lights.push({
    id: freshId('light'),
    x: 135,
    y: 120,
    color: '#ffb060',
    intensity: 1.2,
    radius: 60,
    bloom: 0.4,
    flicker: 0.2,
    falloff: 'soft',
    occluded: true,
    locked: false,
    hidden: false,
  });
  return { world, doc, region };
}

function firstDiff(a: Uint8Array | Int16Array, b: Uint8Array | Int16Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

describe('prefab capture', () => {
  it('captures cells, local objects, internal links, and lights', () => {
    const { world, doc, region } = wiredRoom();
    const got = capturePrefab(world, region, doc, 'room', ['arena']);
    expect(got).not.toBeNull();
    const p = got!.prefab;
    expect(p.w).toBe(80);
    expect(p.h).toBe(60);
    const cells = decodePrefabCells(p);
    expect(cells[10 + 40 * 80]).toBe(Cell.Metal); // world (110,140) -> local (10,40)
    expect(cells[20 + 10 * 80]).toBe(Cell.Empty);

    // spawn excluded, outside plate excluded -> lever, door, enemy
    expect(p.objects.map((o) => o.kind).sort()).toEqual(['door', 'enemy', 'lever']);
    const lever = p.objects.find((o) => o.kind === 'lever')!;
    expect([lever.x, lever.y]).toEqual([20, 48]);

    // internal lever->door link kept with local ids; outside link dropped
    expect(p.links.length).toBe(1);
    expect(got!.droppedLinks).toBe(1);
    expect(p.objects.some((o) => o.id === p.links[0].fromId)).toBe(true);
    expect(p.objects.some((o) => o.id === p.links[0].toId)).toBe(true);

    expect(p.lights.length).toBe(1);
    expect([p.lights[0].x, p.lights[0].y]).toEqual([35, 20]);

    // patrol localized
    const enemy = p.objects.find((o) => o.kind === 'enemy')!;
    expect(enemy.params.patrol).toEqual([
      [25, 48],
      [40, 48],
    ]);

    // authored life/charge captured as local sparse pairs
    expect(p.life).toContainEqual([12 + 40 * 80, 90]);
    expect(p.charge).toContainEqual([14 + 40 * 80, 7]);
  });

  it('refuses over-cap regions', () => {
    const { world, doc } = wiredRoom();
    const side = Math.ceil(Math.sqrt(PREFAB_CELL_CAP)) + 2;
    const region: Region = { x0: 0, y0: 0, x1: side - 1, y1: side - 1 };
    expect(capturePrefab(world, region, doc, 'too big')).toBeNull();
  });
});

describe('prefab transforms', () => {
  it('rotate x4 is identity for every plane and record', () => {
    const { world, doc, region } = wiredRoom();
    const p = capturePrefab(world, region, doc, 'room')!.prefab;
    p.anchors = [{ id: 'a0', x: 0, y: 30, dir: 'w', kind: 'open', halfW: 4 }];
    let r = p;
    for (let n = 0; n < 4; n++) r = rotatePrefab(r);
    expect(r.w).toBe(p.w);
    expect(r.h).toBe(p.h);
    expect(firstDiff(decodePrefabCells(r), decodePrefabCells(p))).toBe(-1);
    expect(r.life).toEqual(p.life);
    expect(r.charge).toEqual(p.charge);
    expect(r.objects.map((o) => [o.x, o.y, o.rotation, o.params.w, o.params.h])).toEqual(
      p.objects.map((o) => [o.x, o.y, o.rotation, o.params.w, o.params.h]),
    );
    expect(r.lights.map((l) => [l.x, l.y])).toEqual(p.lights.map((l) => [l.x, l.y]));
    expect(r.anchors).toEqual(p.anchors);
  });

  it('mirror x2 is identity', () => {
    const { world, doc, region } = wiredRoom();
    const p = capturePrefab(world, region, doc, 'room')!.prefab;
    p.anchors = [{ id: 'a0', x: 79, y: 30, dir: 'e', kind: 'sealed' }];
    const m = mirrorPrefab(mirrorPrefab(p));
    expect(firstDiff(decodePrefabCells(m), decodePrefabCells(p))).toBe(-1);
    expect(m.objects.map((o) => [o.x, o.y])).toEqual(p.objects.map((o) => [o.x, o.y]));
    expect(m.anchors).toEqual(p.anchors);
    expect(m.life).toEqual(p.life);
  });

  it('mirrors directional object rotations', () => {
    const { world, doc, region } = wiredRoom();
    doc.objects.push(makeObj('hazardEmitter', 145, 148, { material: Cell.Water }));
    doc.objects[doc.objects.length - 1].rotation = 90;
    const p = capturePrefab(world, region, doc, 'room')!.prefab;
    const emitter = mirrorPrefab(p).objects.find((o) => o.kind === 'hazardEmitter');

    expect(emitter?.rotation).toBe(270);
  });

  it('keeps a door slab covering the same cells through a rotation', () => {
    // a 6x10 prefab: door slab (w2 h4) at local (1,2); Metal marks its cells
    const cells = new Uint8Array(6 * 10);
    for (let y = 2; y < 6; y++) for (let x = 1; x < 3; x++) cells[x + y * 6] = Cell.Metal;
    const world = new World();
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 6; x++) world.types[world.idx(x, y)] = cells[x + y * 6];
    }
    const doc = createEmptyDocument('slab', 'earthen');
    doc.objects.push(makeObj('door', 1, 2, { w: 2, h: 4 }));
    const p = capturePrefab(world, { x0: 0, y0: 0, x1: 5, y1: 9 }, doc, 'slab')!.prefab;

    const r = rotatePrefab(p);
    const rc = decodePrefabCells(r);
    const door = r.objects[0];
    const dw = door.params.w as number;
    const dh = door.params.h as number;
    expect([dw, dh]).toEqual([4, 2]); // dims swapped
    // every cell under the rotated footprint is the Metal that travelled with it
    for (let y = door.y; y < door.y + dh; y++) {
      for (let x = door.x; x < door.x + dw; x++) {
        expect(rc[x + y * r.w]).toBe(Cell.Metal);
      }
    }
  });

  it('named prefab variants transform dimensions and anchors consistently', () => {
    const { world, doc, region } = wiredRoom();
    const p = capturePrefab(world, region, doc, 'room')!.prefab;
    p.anchors = [{ id: 'west', x: 0, y: 30, dir: 'w', kind: 'open', halfW: 4 }];

    const rot = prefabVariant(p, 'rot90');
    const mirror = prefabVariant(p, 'mirror');
    const mirroredRot = prefabVariant(p, 'mirrorRot180');

    expect([rot.w, rot.h]).toEqual([p.h, p.w]);
    expect(rot.anchors).toEqual([{ id: 'west', x: p.h - 1 - 30, y: 0, dir: 'n', kind: 'open', halfW: 4 }]);
    expect([mirror.w, mirror.h]).toEqual([p.w, p.h]);
    expect(mirror.anchors).toEqual([{ id: 'west', x: p.w - 1, y: 30, dir: 'e', kind: 'open', halfW: 4 }]);
    expect([mirroredRot.w, mirroredRot.h]).toEqual([p.w, p.h]);
  });

  it('aligns compatible prefab anchors without changing the source record', () => {
    const source = { id: 's', x: 0, y: 10, dir: 'w', kind: 'open' } as const;
    const target = { id: 't', x: 31, y: 10, dir: 'e', kind: 'open' } as const;
    const blocked = { id: 'b', x: 31, y: 10, dir: 'e', kind: 'sealed' } as const;
    const prefab = { w: 32, h: 20 };

    expect(prefabAnchorsCompatible(source, target)).toBe(true);
    expect(prefabAnchorsCompatible(source, blocked)).toBe(false);
    const center = alignPrefabAnchorToWorldPoint(prefab, source, { x: 400, y: 300 });

    expect(prefabAnchorWorldPoint(prefab, center.x, center.y, source)).toEqual({ x: 400, y: 300 });
  });
});

describe('prefab paste', () => {
  it('writes the full block, overlays life/charge, and undoes losslessly', () => {
    const { world, doc, region } = wiredRoom();
    const p = capturePrefab(world, region, doc, 'room')!.prefab;

    const target = new World();
    target.types.fill(Cell.Stone);
    const beforeTypes = target.types.slice();
    const beforeLife = target.life.slice();

    const rec = new PatchRecorder(target);
    const out = pastePrefab(target, rec, p, 400, 300);
    const patch = rec.finish();
    expect(patch).not.toBeNull();

    // authored emptiness pasted as Empty; metal travelled; life/charge overlaid
    const x0 = 400 - Math.floor(p.w / 2),
      y0 = 300 - Math.floor(p.h / 2);
    expect(target.types[target.idx(x0 + 20, y0 + 10)]).toBe(Cell.Empty);
    expect(target.types[target.idx(x0 + 10, y0 + 40)]).toBe(Cell.Metal);
    expect(target.life[target.idx(x0 + 12, y0 + 40)]).toBe(90);
    expect(target.charge[target.idx(x0 + 14, y0 + 40)]).toBe(7);

    // records at world coords with fresh ids and remapped links
    expect(out.objects.length).toBe(3);
    const lever = out.objects.find((o) => o.kind === 'lever')!;
    expect([lever.x, lever.y]).toEqual([x0 + 20, y0 + 48]);
    expect(out.links.length).toBe(1);
    expect(out.objects.some((o) => o.id === out.links[0].fromId)).toBe(true);
    expect(out.objects.some((o) => o.id === out.links[0].toId)).toBe(true);
    const enemy = out.objects.find((o) => o.kind === 'enemy')!;
    expect(enemy.params.patrol).toEqual([
      [x0 + 25, y0 + 48],
      [x0 + 40, y0 + 48],
    ]);

    // one paint command undoes the whole terrain block byte-identically
    const cmd = paintTerrainCmd(target, patch!.before, patch!.after);
    cmd.undo({} as never);
    expect(firstDiff(target.types, beforeTypes)).toBe(-1);
    expect(firstDiff(target.life, beforeLife)).toBe(-1);
  });
});

describe('prefab library + migration', () => {
  beforeEach(() => {
    (globalThis.localStorage as unknown as StorageStub).clear();
  });

  it('migrates legacy stamps to terrain-only prefabs and removes the old key', () => {
    const cells = new Uint8Array(8 * 4).fill(Cell.Stone);
    const rle = (() => {
      // tiny RLE by hand via prefab encode path: capture from a world
      const w = new World();
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) w.types[w.idx(x, y)] = cells[x + y * 8];
      }
      const doc = createEmptyDocument('m', 'earthen');
      return capturePrefab(w, { x0: 0, y0: 0, x1: 7, y1: 3 }, doc, 'm')!.prefab.rle;
    })();
    localStorage.setItem(
      'noita-builder-stamps',
      JSON.stringify([{ id: 'stamp-legacy-1', name: 'old stamp', w: 8, h: 4, rle }]),
    );
    const list = loadPrefabs();
    expect(localStorage.getItem('noita-builder-stamps')).toBeNull();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('old stamp');
    expect(list[0].tags).toEqual(['terrain']);
    expect(decodePrefabCells(list[0])[0]).toBe(Cell.Stone);
  });

  it('rejects prefab terrain RLE that decodes to unknown cell ids', () => {
    const cells = new Uint8Array([255]);

    expect(
      sanitizePrefab({
        v: 1,
        kind: 'prefab',
        id: 'bad-cell',
        name: 'bad cell',
        tags: [],
        w: 1,
        h: 1,
        rle: rleEncode(cells),
        objects: [],
        links: [],
        lights: [],
      }),
    ).toBeNull();
  });

  it('saves, reloads, and deletes per-prefab keys', () => {
    const { world, doc, region } = wiredRoom();
    const p = capturePrefab(world, region, doc, 'kept', ['vault'])!.prefab;
    expect(savePrefab(p)).toBe(true);
    const back = loadPrefabs();
    expect(back.length).toBe(1);
    expect(back[0].objects.length).toBe(3);
    expect(back[0].tags).toEqual(['vault']);
    deletePrefab(p.id);
    expect(loadPrefabs().length).toBe(0);
  });
});

describe('prefab import sanitization', () => {
  function valid(): PrefabDef {
    const { world, doc, region } = wiredRoom();
    return capturePrefab(world, region, doc, 'ok')!.prefab;
  }

  it('accepts a clean prefab through a JSON round-trip', () => {
    const got = sanitizePrefab(JSON.parse(JSON.stringify(valid())));
    expect(got).not.toBeNull();
    expect(got!.warnings).toEqual([]);
    expect(got!.prefab.objects.length).toBe(3);
    expect(got!.prefab.links.length).toBe(1);
  });

  it('rejects wrong version, missing discriminator, and bad rle length', () => {
    const p = valid();
    expect(sanitizePrefab({ ...p, v: 2 })).toBeNull();
    expect(sanitizePrefab({ ...p, kind: undefined })).toBeNull();
    expect(sanitizePrefab({ ...p, w: p.w + 1 })).toBeNull(); // rle no longer matches w*h
    expect(sanitizePrefab({ ...p, rle: 'not base64 at all !!!' })).toBeNull();
    expect(sanitizePrefab(null)).toBeNull();
    expect(sanitizePrefab({ v: 1 })).toBeNull(); // Sandbox-save shape, no discriminator
  });

  it('drops spawn objects, unknown kinds, and dangling links with warnings', () => {
    const p = JSON.parse(JSON.stringify(valid())) as {
      objects: Array<Record<string, unknown>>;
      links: Array<Record<string, unknown>>;
    };
    p.objects.push({ ...p.objects[0], id: 'sp', kind: 'spawn' });
    p.objects.push({ ...p.objects[0], id: 'zz', kind: 'futureKind' });
    p.links.push({ id: 'kx', fromId: 'ghost', toId: p.links[0].toId, kind: 'triggerDoor' });
    const got = sanitizePrefab(p);
    expect(got).not.toBeNull();
    expect(got!.prefab.objects.length).toBe(3);
    expect(got!.prefab.links.length).toBe(1);
    expect(got!.warnings.length).toBe(3);
  });

  it('clamps imported prefab light values to the runtime budget', () => {
    const p = valid();
    p.lights = [
      {
        id: 'huge',
        x: 10,
        y: 10,
        color: '#ffffff',
        intensity: 999,
        radius: 999,
        bloom: 999,
        flicker: 999,
        falloff: 'soft',
        occluded: true,
        locked: false,
        hidden: false,
      },
      {
        id: 'tiny',
        x: 11,
        y: 11,
        color: '#ffffff',
        intensity: -5,
        radius: 1,
        bloom: -2,
        flicker: -3,
        falloff: 'soft',
        occluded: true,
        locked: false,
        hidden: false,
      },
    ];
    const got = sanitizePrefab(JSON.parse(JSON.stringify(p)))!;
    expect(got.prefab.lights[0]).toMatchObject({
      intensity: AUTHORED_LIGHT_INTENSITY_MAX,
      radius: AUTHORED_LIGHT_RADIUS_MAX,
      bloom: AUTHORED_LIGHT_BLOOM_MAX,
      flicker: AUTHORED_LIGHT_FLICKER_MAX,
    });
    expect(got.prefab.lights[1]).toMatchObject({
      intensity: 0,
      radius: AUTHORED_LIGHT_RADIUS_MIN,
      bloom: 0,
      flicker: 0,
    });
  });

  it('clamps anchors and sparse pairs into bounds', () => {
    const p = valid();
    p.anchors = [{ id: 'a', x: -5, y: 999, dir: 'q' as never, kind: 'x' as never, halfW: 99 }];
    p.life = [[-1, 5], [1e9, 5], [3, 70]];
    const got = sanitizePrefab(JSON.parse(JSON.stringify(p)))!;
    expect(got.prefab.anchors).toEqual([
      { id: 'a', x: 0, y: p.h - 1, dir: 'w', kind: 'open', halfW: 12 },
    ]);
    expect(got.prefab.life).toContainEqual([3, 70]);
    expect(got.prefab.life!.every(([i]) => i >= 0 && i < p.w * p.h)).toBe(true);
  });
});
