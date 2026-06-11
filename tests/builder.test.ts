import { describe, expect, it } from 'vitest';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { rleEncode } from '@/core/rle';
import {
  createEmptyDocument,
  freshId,
  objectFootprint,
  sanitizeImportedDoc,
} from '@/builder/document';
import type { EditorDocument, EditorObject, EditorObjectKind } from '@/builder/document';
import {
  floodFill,
  PatchRecorder,
  replaceMaterial,
  stampEllipse,
  stampLine,
  stampRect,
} from '@/builder/terrain';
import { paintTerrainCmd } from '@/builder/commands';
import { validateDocument } from '@/builder/validate';
import { toAuthoredLight } from '@/builder/compile';
import { PASSES, runPass } from '@/builder/procedural';

/**
 * Builder regression suite (docs/BUILDER.md Phase 10): terrain tools produce
 * exact, undoable patches; documents round-trip; the validation service
 * enforces wiring and findability; procedural passes are seed-deterministic.
 */

function makeObj(
  kind: EditorObjectKind,
  x: number,
  y: number,
  params: Record<string, unknown> = {},
): EditorObject {
  return { id: freshId(kind), kind, x, y, rotation: 0, locked: false, hidden: false, params };
}

/** An all-rock world with a carve callback, captured into a fresh document. */
function worldDoc(carve: (w: World) => void): { doc: EditorDocument; w: World } {
  const w = new World();
  w.types.fill(Cell.Wall);
  carve(w);
  const doc = createEmptyDocument('test', 'earthen');
  doc.world = { rle: rleEncode(w.types), life: [], charge: [] };
  return { doc, w };
}

function carveBox(w: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) w.types[w.idx(x, y)] = Cell.Empty;
  }
}

const errors = (issues: ReturnType<typeof validateDocument>) =>
  issues.filter((i) => i.severity === 'error');

describe('builder terrain tools', () => {
  it('filled rect stamps exactly its area and undoes losslessly', () => {
    const w = new World();
    const rec = new PatchRecorder(w);
    stampRect(w, rec, 100, 100, 109, 109, Cell.Stone, true);
    const patch = rec.finish();
    expect(patch).not.toBeNull();
    expect(patch!.before.idxs.length).toBe(100);
    expect(w.types[w.idx(105, 105)]).toBe(Cell.Stone);

    const cmd = paintTerrainCmd(w, patch!.before, patch!.after);
    cmd.undo({} as never);
    expect(w.types[w.idx(105, 105)]).toBe(Cell.Empty);
    cmd.do({} as never);
    expect(w.types[w.idx(105, 105)]).toBe(Cell.Stone);
  });

  it('outline rect stamps only the rim', () => {
    const w = new World();
    const rec = new PatchRecorder(w);
    stampRect(w, rec, 50, 50, 59, 59, Cell.Stone, false);
    expect(rec.finish()!.before.idxs.length).toBe(36);
    expect(w.types[w.idx(55, 55)]).toBe(Cell.Empty);
    expect(w.types[w.idx(50, 55)]).toBe(Cell.Stone);
  });

  it('line with radius 0 is a thin bresenham stroke', () => {
    const w = new World();
    const rec = new PatchRecorder(w);
    stampLine(w, rec, 10, 10, 20, 10, 0, Cell.Wood);
    expect(rec.finish()!.before.idxs.length).toBe(11);
  });

  it('filled ellipse fills the inscribed disc, not the corners', () => {
    const w = new World();
    const rec = new PatchRecorder(w);
    stampEllipse(w, rec, 200, 200, 210, 210, Cell.Sand, true);
    const n = rec.finish()!.before.idxs.length;
    expect(n).toBeGreaterThan(60);
    expect(n).toBeLessThan(121);
    expect(w.types[w.idx(205, 205)]).toBe(Cell.Sand);
    expect(w.types[w.idx(200, 200)]).toBe(Cell.Empty); // corner stays out
  });

  it('flood fill fills enclosed areas and refuses over-cap areas atomically', () => {
    const w = new World();
    w.types.fill(Cell.Wall);
    carveBox(w, 100, 100, 107, 107); // 8x8 = 64 empty cells
    const rec = new PatchRecorder(w);
    expect(floodFill(w, rec, 103, 103, Cell.Water, 1000)).toBe(64);
    expect(w.types[w.idx(100, 100)]).toBe(Cell.Water);

    const w2 = new World();
    w2.types.fill(Cell.Wall);
    carveBox(w2, 100, 100, 107, 107);
    const rec2 = new PatchRecorder(w2);
    expect(floodFill(w2, rec2, 103, 103, Cell.Water, 10)).toBe(-1);
    expect(w2.types[w2.idx(103, 103)]).toBe(Cell.Empty); // nothing written
  });

  it('replace material honors the region bounds', () => {
    const w = new World();
    for (let x = 0; x < 50; x++) w.types[w.idx(x, 10)] = Cell.Wood;
    const rec = new PatchRecorder(w);
    const n = replaceMaterial(w, rec, 5, 10, Cell.Stone, { x0: 0, y0: 0, x1: 19, y1: 20 }, 99999);
    expect(n).toBe(20);
    expect(w.types[w.idx(5, 10)]).toBe(Cell.Stone);
    expect(w.types[w.idx(30, 10)]).toBe(Cell.Wood); // outside region untouched
  });
});

describe('builder document', () => {
  it('round-trips through JSON with objects, links, and lights intact', () => {
    const doc = createEmptyDocument('rt', 'earthen');
    const plate = makeObj('plate', 100, 100, { w: 5 });
    const door = makeObj('door', 140, 90, { w: 3, h: 13 });
    doc.objects.push(plate, door);
    doc.links.push({ id: freshId('link'), fromId: plate.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });
    doc.lights.push({
      id: freshId('light'), x: 50, y: 50, color: '#ffb45a', intensity: 1.2, radius: 48,
      bloom: 0.4, flicker: 0.35, falloff: 'soft', occluded: true, locked: false, hidden: false,
    });
    const back = JSON.parse(JSON.stringify(doc)) as EditorDocument;
    expect(back).toEqual(doc);
  });

  it('door footprint covers its full slab', () => {
    const door = makeObj('door', 100, 50, { w: 3, h: 20 });
    expect(objectFootprint(door)).toEqual({ x0: 100, y0: 50, x1: 102, y1: 69 });
  });
});

describe('builder validation', () => {
  it('flags missing spawn, missing terrain, and missing exit', () => {
    const doc = createEmptyDocument('v', 'earthen');
    const issues = validateDocument(doc);
    expect(issues.some((i) => i.severity === 'error' && i.what.includes('spawn'))).toBe(true);
    expect(issues.some((i) => i.severity === 'warning' && i.what.includes('terrain'))).toBe(true);
    expect(issues.some((i) => i.severity === 'info' && i.what.includes('win exit'))).toBe(true);
  });

  it('accepts a complete wired level: spawn, plate->door, key behind the door', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    const spawn = makeObj('spawn', 120, 158);
    const plate = makeObj('plate', 140, 159, { w: 5 });
    const door = makeObj('door', 180, 100, { w: 3, h: 60 }); // floor-to-ceiling
    const key = makeObj('pickup', 190, 158, { kind: 'key' });
    doc.objects.push(spawn, plate, door, key);
    doc.links.push({ id: freshId('link'), fromId: plate.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });
    expect(errors(validateDocument(doc))).toEqual([]);
  });

  it('errors on an unlinked trigger and warns on a triggerless door', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    doc.objects.push(makeObj('spawn', 120, 158));
    doc.objects.push(makeObj('plate', 140, 159, { w: 5 }));
    doc.objects.push(makeObj('door', 180, 100, { w: 3, h: 60 }));
    const issues = validateDocument(doc);
    expect(issues.some((i) => i.severity === 'error' && i.what.includes('not linked'))).toBe(true);
    expect(issues.some((i) => i.severity === 'warning' && i.what.includes('no trigger'))).toBe(true);
  });

  it('errors when the key is sealed away even with doors open', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    doc.objects.push(makeObj('spawn', 120, 158));
    // key buried in solid rock far from the chamber
    doc.objects.push(makeObj('pickup', 600, 600, { kind: 'key' }));
    const issues = validateDocument(doc);
    expect(
      issues.some((i) => i.severity === 'error' && i.what.includes('key unreachable')),
    ).toBe(true);
  });

  it('errors on unlinked rune pairs', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    doc.objects.push(makeObj('spawn', 120, 158));
    doc.objects.push(makeObj('runeGlyph', 140, 158));
    doc.objects.push(makeObj('runeDoor', 180, 110, { w: 2, h: 11 }));
    const issues = validateDocument(doc);
    expect(issues.some((i) => i.severity === 'error' && i.what.includes('glyph opens nothing'))).toBe(true);
    expect(issues.some((i) => i.severity === 'error' && i.what.includes('no glyph'))).toBe(true);
  });

  it('errors on duplicate ids', () => {
    const doc = createEmptyDocument('dup', 'earthen');
    const a = makeObj('waystone', 100, 100);
    const b = makeObj('waystone', 200, 100);
    b.id = a.id;
    doc.objects.push(a, b);
    expect(
      validateDocument(doc).some((i) => i.severity === 'error' && i.what.includes('duplicate id')),
    ).toBe(true);
  });

  it('reaches the exit well mouth through its stamped approach pocket', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    doc.objects.push(makeObj('spawn', 120, 158));
    doc.objects.push(makeObj('exitWell', 150, 170, { halfW: 14 }));
    const issues = validateDocument(doc);
    expect(issues.some((i) => i.what.includes('well mouth unreachable'))).toBe(false);
  });

  it('accepts a SEQUENCED puzzle: lever behind door A opens door B (fixpoint)', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 300, 159));
    const spawn = makeObj('spawn', 110, 158);
    const plateA = makeObj('plate', 130, 159, { w: 5 });
    const doorA = makeObj('door', 180, 100, { w: 3, h: 60 });
    const leverB = makeObj('lever', 220, 159);
    const doorB = makeObj('door', 260, 100, { w: 3, h: 60 });
    const key = makeObj('pickup', 285, 158, { kind: 'key' });
    doc.objects.push(spawn, plateA, doorA, leverB, doorB, key);
    doc.links.push(
      { id: freshId('link'), fromId: plateA.id, toId: doorA.id, kind: 'triggerDoor', logic: 'and' },
      { id: freshId('link'), fromId: leverB.id, toId: doorB.id, kind: 'triggerDoor', logic: 'and' },
    );
    expect(errors(validateDocument(doc))).toEqual([]);
  });

  it('catches the hidden-trigger trap: door can never open, key flagged sealed', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    const spawn = makeObj('spawn', 120, 158);
    const plate = makeObj('plate', 140, 159, { w: 5 });
    plate.hidden = true; // "decluttering" the canvas — the compiler drops it
    const door = makeObj('door', 180, 100, { w: 3, h: 60 });
    const key = makeObj('pickup', 190, 158, { kind: 'key' });
    doc.objects.push(spawn, plate, door, key);
    doc.links.push({ id: freshId('link'), fromId: plate.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });
    const issues = validateDocument(doc);
    expect(issues.some((i) => i.severity === 'error' && i.what.includes('key unreachable'))).toBe(true);
    expect(issues.some((i) => i.severity === 'warning' && i.what.includes('hidden object'))).toBe(true);
  });

  it('a triggerless closed door genuinely seals its key (no phantom open pass)', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    doc.objects.push(makeObj('spawn', 120, 158));
    doc.objects.push(makeObj('door', 180, 100, { w: 3, h: 60 }));
    doc.objects.push(makeObj('pickup', 190, 158, { kind: 'key' }));
    const issues = validateDocument(doc);
    expect(issues.some((i) => i.severity === 'error' && i.what.includes('key unreachable'))).toBe(true);
  });

  it('an initially-open door does not seal anything', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    doc.objects.push(makeObj('spawn', 120, 158));
    doc.objects.push(makeObj('door', 180, 100, { w: 3, h: 60, initialOpen: true }));
    doc.objects.push(makeObj('pickup', 190, 158, { kind: 'key' }));
    expect(errors(validateDocument(doc))).toEqual([]);
  });

  it('warns that triggers override initialOpen and seeds the fixpoint shut', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    const spawn = makeObj('spawn', 120, 158);
    // plate is INSIDE the door's chamber — the portcullis trap-room pattern:
    // runtime slams the door shut at t=0, so this must not validate clean
    const plate = makeObj('plate', 190, 159, { w: 5 });
    const door = makeObj('door', 180, 100, { w: 3, h: 60, initialOpen: true });
    const key = makeObj('pickup', 195, 158, { kind: 'key' });
    doc.objects.push(spawn, plate, door, key);
    doc.links.push({ id: freshId('link'), fromId: plate.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });
    const issues = validateDocument(doc);
    expect(issues.some((i) => i.severity === 'warning' && i.what.includes('initialOpen is overridden'))).toBe(true);
    expect(issues.some((i) => i.severity === 'error' && i.what.includes('unreachable'))).toBe(true);
  });

  it('warns when a sensor threshold exceeds its physical capacity', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    const spawn = makeObj('spawn', 120, 158);
    const scale = makeObj('scale', 140, 159, { w: 7, threshold: 200 });
    const door = makeObj('door', 180, 100, { w: 3, h: 60 });
    doc.objects.push(spawn, scale, door);
    doc.links.push({ id: freshId('link'), fromId: scale.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });
    expect(
      validateDocument(doc).some((i) => i.severity === 'warning' && i.what.includes('pan capacity')),
    ).toBe(true);
  });

  it('notes that link-level logic is ignored (the door owns logic now)', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    const spawn = makeObj('spawn', 120, 158);
    const plate = makeObj('plate', 140, 159, { w: 5 });
    const door = makeObj('door', 180, 100, { w: 3, h: 60 });
    doc.objects.push(spawn, plate, door);
    doc.links.push({ id: freshId('link'), fromId: plate.id, toId: door.id, kind: 'triggerDoor', logic: 'or' });
    expect(
      validateDocument(doc).some((i) => i.severity === 'info' && i.what.includes('link-level logic')),
    ).toBe(true);
  });

  it('OR doors open from any reachable trigger; AND doors need them all', () => {
    // plate A before the door, plate B sealed BEHIND it: with OR the door is
    // earnable from A alone; with AND the fixpoint never opens it.
    const build = (logic: 'and' | 'or') => {
      const { doc } = worldDoc((w) => carveBox(w, 100, 100, 300, 159));
      const spawn = makeObj('spawn', 110, 158);
      const plateA = makeObj('plate', 130, 159, { w: 5 });
      const door = makeObj('door', 180, 100, { w: 3, h: 60, logic });
      const plateB = makeObj('plate', 220, 159, { w: 5 });
      const key = makeObj('pickup', 280, 158, { kind: 'key' });
      doc.objects.push(spawn, plateA, door, plateB, key);
      doc.links.push(
        { id: freshId('link'), fromId: plateA.id, toId: door.id, kind: 'triggerDoor', logic: 'and' },
        { id: freshId('link'), fromId: plateB.id, toId: door.id, kind: 'triggerDoor', logic: 'and' },
      );
      return validateDocument(doc);
    };
    expect(errors(build('or'))).toEqual([]);
    const andIssues = build('and');
    expect(andIssues.some((i) => i.severity === 'error' && i.what.includes('key unreachable'))).toBe(true);
    expect(andIssues.some((i) => i.severity === 'error' && i.what.includes('plate unreachable'))).toBe(true);
  });

  it('warns when an earnable target sits behind a too-tight crawlway', () => {
    const { doc } = worldDoc((w) => {
      carveBox(w, 100, 100, 200, 159);
      carveBox(w, 201, 156, 260, 158); // a 3-tall crawl tunnel off the chamber
    });
    doc.objects.push(makeObj('spawn', 120, 158));
    doc.objects.push(makeObj('waystone', 255, 158));
    const issues = validateDocument(doc);
    expect(issues.some((i) => i.what.includes('waystone unreachable'))).toBe(false); // cells reach it
    expect(
      issues.some((i) => i.severity === 'warning' && i.what.includes('too tight')),
    ).toBe(true);
  });

  it('warns about a floating lever (it would break and fail open by itself)', () => {
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    const spawn = makeObj('spawn', 120, 158);
    const lever = makeObj('lever', 140, 130); // mid-air
    const door = makeObj('door', 180, 100, { w: 3, h: 60 });
    doc.objects.push(spawn, lever, door);
    doc.links.push({ id: freshId('link'), fromId: lever.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });
    expect(
      validateDocument(doc).some((i) => i.severity === 'warning' && i.what.includes('footing')),
    ).toBe(true);
  });
});

describe('stamp library', () => {
  it('rotates 90cw and mirrors correctly', async () => {
    const { captureStamp, decodeStamp, mirrorStamp, rotateStamp } = await import('@/builder/stamplib');
    const w = new World();
    // a 3x2 block: rows [1,2,3] / [4,5,6] at (10,10)
    const vals = [1, 2, 3, 4, 5, 6];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) w.types[w.idx(10 + x, 10 + y)] = vals[x + y * 3];
    const s = captureStamp(w, { x0: 10, y0: 10, x1: 12, y1: 11 }, 't')!;
    expect(Array.from(decodeStamp(s))).toEqual(vals);
    const r = rotateStamp(s); // 90cw: columns become rows bottom-up
    expect(r.w).toBe(2);
    expect(r.h).toBe(3);
    expect(Array.from(decodeStamp(r))).toEqual([4, 1, 5, 2, 6, 3]);
    const m = mirrorStamp(s);
    expect(Array.from(decodeStamp(m))).toEqual([3, 2, 1, 6, 5, 4]);
    // four rotations come home
    const r4 = rotateStamp(rotateStamp(rotateStamp(rotateStamp(s))));
    expect(Array.from(decodeStamp(r4))).toEqual(vals);
  });
});

describe('share codes', () => {
  it('round-trips a document through the compressed code', async () => {
    if (typeof CompressionStream === 'undefined') return; // older node: browser-only feature
    const { docToShareCode, shareCodeToDoc } = await import('@/builder/document');
    const { doc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    doc.objects.push(makeObj('spawn', 120, 158));
    doc.objects.push(makeObj('waystone', 150, 158));
    const code = await docToShareCode(doc);
    expect(code.startsWith('PLLD1.')).toBe(true);
    const back = await shareCodeToDoc(code);
    expect(back).not.toBeNull();
    expect(back!.objects.length).toBe(2);
    expect(back!.world?.rle).toBe(doc.world!.rle);
    expect(await shareCodeToDoc('PLLD1.not-actually-base64!!')).toBeNull();
    expect(await shareCodeToDoc('garbage')).toBeNull();
  });
});

describe('import sanitizer', () => {
  it('rejects garbage and bad terrain, accepts minimal documents with defaults', () => {
    expect(sanitizeImportedDoc(42)).toBeNull();
    expect(sanitizeImportedDoc({ v: 1, objects: [] })).toBeNull();
    expect(sanitizeImportedDoc({ v: 2 })).toBeNull();
    expect(
      sanitizeImportedDoc({ v: 2, objects: [], world: { rle: '!!not-base64!!' } }),
    ).toBeNull();

    const minimal = sanitizeImportedDoc({ v: 2, objects: [] });
    expect(minimal).not.toBeNull();
    expect(minimal!.links).toEqual([]);
    expect(minimal!.lights).toEqual([]);
    expect(minimal!.proceduralHistory).toEqual([]);
    expect(minimal!.name).toBe('imported');

    const w = new World();
    const full = sanitizeImportedDoc({
      v: 2,
      objects: [],
      world: { rle: rleEncode(w.types), life: [], charge: [] },
      size: { w: w.width, h: w.height },
    });
    expect(full).not.toBeNull();
    expect(full!.world).not.toBeNull();
  });
});

describe('procedural passes', () => {
  it('is deterministic for the same seed', () => {
    const region = { x0: 100, y0: 100, x1: 220, y1: 180 };
    const run = (): number[] => {
      const w = new World();
      w.types.fill(Cell.Wall);
      const rec = new PatchRecorder(w);
      const def = PASSES.find((p) => p.id === 'veins')!;
      runPass(def, w, rec, 4242, region, 0.6, Cell.Gold);
      return rec.finish()?.after.idxs ?? [];
    };
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('enemy population picks standable floor spots', () => {
    const w = new World();
    w.types.fill(Cell.Wall);
    carveBox(w, 100, 100, 400, 200); // open hall with a floor at y=201
    const rec = new PatchRecorder(w);
    const def = PASSES.find((p) => p.id === 'enemies')!;
    const result = runPass(def, w, rec, 7, { x0: 100, y0: 100, x1: 400, y1: 200 }, 0.8, 0);
    expect(result.objects!.length).toBeGreaterThan(0);
    for (const o of result.objects!) {
      expect(w.types[w.idx(Math.round(o.x), Math.round(o.y))]).toBe(Cell.Empty);
    }
  });
});

describe('compile helpers', () => {
  it('parses authored light colors into channel weights', () => {
    const al = toAuthoredLight(
      {
        id: 'l', x: 10, y: 20, color: '#ff8000', intensity: 1.5, radius: 40,
        bloom: 0.3, flicker: 0.2, falloff: 'soft', occluded: true, locked: false, hidden: false,
      },
      0,
    );
    expect(al.r).toBeCloseTo(1, 2);
    expect(al.g).toBeCloseTo(0.5, 1);
    expect(al.b).toBe(0);
    expect(al.intensity).toBe(1.5);
  });
});
