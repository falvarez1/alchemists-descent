import { describe, expect, it } from 'vitest';
import { WIDTH } from '@/config/constants';
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
  magicRegion,
  PatchRecorder,
  rasterizePolygon,
  replaceMaterial,
  smoothDisc,
  stampEllipse,
  stampLine,
  stampRect,
} from '@/builder/terrain';
import { CommandStack, compositeCmd, editDocumentMoodCmd, paintTerrainCmd } from '@/builder/commands';
import { buildValidationOverlayDiagnostics, playtestBlockingIssues, validateDocument } from '@/builder/validate';
import { renderIssueRows } from '@/builder/issuePanel';
import { renderValidationPanel } from '@/builder/validationPanel';
import { toAuthoredLight } from '@/builder/compile';
import { PreviewRuntime } from '@/builder/PreviewRuntime';
import {
  hitProjectedGizmoHandle,
  lightGizmoHandles,
  lightRadiusFromDrag,
  objectGizmoHandles,
  projectGizmoHandles,
  resizeObjectPatchFromDrag,
} from '@/builder/gizmos';
import { nextSnapStep, sanitizeSnapStep, snapValue } from '@/builder/spatialGuides';
import type { Ctx } from '@/core/types';
import { PASSES, runPass } from '@/builder/procedural';
import { sanitizeBackdropSettings } from '@/config/backdrop';

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

function previewCtx(world = new World()): Ctx {
  return {
    world,
    player: { x: -999, y: -999 },
    enemies: [],
    enemyCtl: { defs: {} },
    state: { mode: 'build', frameCount: 0 },
    particles: { spawn: () => undefined, burst: () => undefined },
    events: { emit: () => undefined },
    audio: { tone: () => undefined },
  } as unknown as Ctx;
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

  it('smooth erodes lone spurs and fills lone gaps', () => {
    const w = new World();
    w.types.fill(Cell.Wall);
    carveBox(w, 100, 100, 140, 140);
    w.types[w.idx(120, 120)] = Cell.Wall; // a lone floating spur in open air
    w.types[w.idx(90, 120)] = Cell.Empty; // a lone 1-cell pit inside rock
    const rec = new PatchRecorder(w);
    smoothDisc(w, rec, 120, 120, 6);
    smoothDisc(w, rec, 90, 120, 6);
    expect(w.types[w.idx(120, 120)]).toBe(Cell.Empty); // spur eroded
    expect(w.types[w.idx(90, 120)]).toBe(Cell.Wall); // pit filled
  });

  it('rasterizes polygons with even-odd fill', () => {
    // a right triangle: (10,10) (30,10) (10,30)
    const result = rasterizePolygon([
      [10, 10],
      [30, 10],
      [10, 30],
    ]);
    expect(result).not.toBeNull();
    const { region, mask } = result!;
    const rw = region.x1 - region.x0 + 1;
    const at = (x: number, y: number) => mask[x - region.x0 + (y - region.y0) * rw];
    expect(at(12, 12)).toBe(1); // inside, near the right-angle corner
    expect(at(28, 28)).toBe(0); // outside the hypotenuse
    let cells = 0;
    for (const v of mask) cells += v;
    expect(cells).toBeGreaterThan(120); // ~half the 21x21 bbox
    expect(cells).toBeLessThan(280);
  });

  it('magic region selects exactly the connected cavern', () => {
    const w = new World();
    w.types.fill(Cell.Wall);
    carveBox(w, 100, 100, 119, 109); // a 20x10 sealed room
    carveBox(w, 300, 100, 309, 109); // an unrelated room far away
    const found = magicRegion(w, 105, 105, 100000);
    expect(found).not.toBeNull();
    expect(found!.cells).toBe(200);
    expect(found!.region).toEqual({ x0: 100, y0: 100, x1: 119, y1: 109 });
    expect(magicRegion(w, 50, 50, 100000)).toBeNull(); // clicked solid rock
  });

  it('mask-gated replace only touches cells inside the mask', () => {
    const w = new World();
    for (let x = 10; x < 40; x++) w.types[w.idx(x, 20)] = Cell.Wood;
    const region = { x0: 10, y0: 15, x1: 39, y1: 25 };
    const rw = region.x1 - region.x0 + 1;
    const mask = new Uint8Array(rw * (region.y1 - region.y0 + 1));
    // mask covers only x 10..19
    for (let y = region.y0; y <= region.y1; y++) {
      for (let x = 10; x <= 19; x++) mask[x - region.x0 + (y - region.y0) * rw] = 1;
    }
    const rec = new PatchRecorder(w);
    const n = replaceMaterial(w, rec, 12, 20, Cell.Stone, region, 99999, mask);
    expect(n).toBe(10);
    expect(w.types[w.idx(15, 20)]).toBe(Cell.Stone);
    expect(w.types[w.idx(25, 20)]).toBe(Cell.Wood); // in region, outside mask
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
  it('sanitizes legacy backdrop settings with clamped grade defaults', () => {
    const clean = sanitizeBackdropSettings({
      layers: {},
      grade: { exposure: 99, brightness: -9, contrast: 99, gamma: 0, saturation: 99 },
      levels: {
        d1: { enabled: true, layers: {}, grade: { exposure: -99, brightness: 9, contrast: 0, gamma: 99, saturation: -1 } },
      },
    });

    expect(clean.grade).toEqual({ exposure: 2, brightness: -0.5, contrast: 2.5, gamma: 0.35, saturation: 2.5 });
    expect(clean.levels.d1?.grade).toEqual({ exposure: -3, brightness: 0.5, contrast: 0.25, gamma: 3, saturation: 0 });
  });

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

  it('cycles and sanitizes Builder snap steps including the 4-cell grid', () => {
    expect(sanitizeSnapStep(4)).toBe(4);
    expect(sanitizeSnapStep(8)).toBe(8);
    expect(sanitizeSnapStep(12)).toBe(0);
    expect([nextSnapStep(0), nextSnapStep(4), nextSnapStep(8), nextSnapStep(16)]).toEqual([4, 8, 16, 0]);
    expect(snapValue(18, 4)).toBe(20);
    expect(snapValue(18, 4, true)).toBe(18);
  });

  it('builds stable gizmo handles and hit-tests them in screen space', () => {
    const door = makeObj('door', 100, 50, { w: 3, h: 13 });
    const handles = projectGizmoHandles(objectGizmoHandles(door), (x, y) => ({ x: x * 2, y: y * 2 }));
    const resize = handles.find((handle) => handle.kind === 'resize-se');
    const rotate = handles.find((handle) => handle.kind === 'rotate');

    expect(resize).toMatchObject({ ownerId: door.id, cursor: 'nwse-resize' });
    expect(rotate).toMatchObject({ ownerId: door.id, cursor: 'crosshair' });
    expect(hitProjectedGizmoHandle(handles, resize!.sx + 7, resize!.sy + 4)?.kind).toBe('resize-se');
    expect(hitProjectedGizmoHandle(handles, resize!.sx + 20, resize!.sy + 20)).toBeNull();
  });

  it('computes undoable resize patches from object gizmo drags', () => {
    const door = makeObj('door', 100, 50, { w: 3, h: 13 });
    const sensor = makeObj('sensor', 200, 120, { zoneW: 9, zoneH: 7 });
    const plate = makeObj('plate', 300, 90, { w: 5 });
    const scale = makeObj('scale', 320, 100, { w: 7 });
    const counterweight = makeObj('counterweight', 330, 110, { w: 7 });
    const buoy = makeObj('buoy', 340, 140, { w: 13, depth: 4 });
    const exitWell = makeObj('exitWell', 380, 160, { halfW: 14 });

    expect(resizeObjectPatchFromDrag(door, 'resize-se', 110, 80)).toEqual({
      params: { w: 10, h: 30 },
    });
    expect(resizeObjectPatchFromDrag(sensor, 'resize-se', 205, 113)).toEqual({
      params: { zoneW: 9, zoneH: 7 },
    });
    expect(resizeObjectPatchFromDrag(sensor, 'resize-se', 209, 104)).toEqual({
      params: { zoneW: 17, zoneH: 16 },
    });
    expect(resizeObjectPatchFromDrag(plate, 'resize-e', 303, 90)).toEqual({
      params: { w: 5 },
    });
    expect(objectGizmoHandles(scale).find((handle) => handle.kind === 'resize-e')?.worldX).toBe(324);
    expect(resizeObjectPatchFromDrag(scale, 'resize-e', 324, 100)).toEqual({
      params: { w: 7 },
    });
    expect(objectGizmoHandles(counterweight).find((handle) => handle.kind === 'resize-e')?.worldX).toBe(334);
    expect(resizeObjectPatchFromDrag(counterweight, 'resize-e', 334, 110)).toEqual({
      params: { w: 7 },
    });
    expect(resizeObjectPatchFromDrag(plate, 'resize-e', 310, 90)).toEqual({
      params: { w: 19 },
    });
    expect(resizeObjectPatchFromDrag(buoy, 'resize-se', 347, 136)).toEqual({
      params: { w: 13, depth: 4 },
    });
    expect(resizeObjectPatchFromDrag(exitWell, 'resize-e', 398, 160)).toEqual({
      params: { halfW: 14 },
    });
  });

  it('exposes light radius and falloff handles with sane radius clamps', () => {
    const light = {
      id: 'light-a',
      x: 50,
      y: 40,
      color: '#ffffff',
      intensity: 1,
      radius: 32,
      bloom: 0,
      flicker: 0,
      falloff: 'soft' as const,
      occluded: true,
      locked: false,
      hidden: false,
    };
    expect(lightGizmoHandles(light).map((handle) => handle.kind)).toEqual(['light-radius', 'light-falloff']);
    expect(lightRadiusFromDrag(light, 210, 40)).toBe(160);
    expect(lightRadiusFromDrag(light, 51, 40)).toBe(4);
  });

  it('edits document mood through undoable metadata commands', () => {
    const doc = createEmptyDocument('mood', 'earthen');
    doc.mood = { ambient: null, ambience: '' };
    const stack = new CommandStack(() => doc);

    stack.run(editDocumentMoodCmd({ ambient: 0.34 }));
    stack.run(editDocumentMoodCmd({ ambience: 'drips' }));
    expect(doc.mood).toEqual({ ambient: 0.34, ambience: 'drips' });

    expect(stack.undo()).toBe('edit document mood');
    expect(doc.mood).toEqual({ ambient: 0.34, ambience: '' });
    expect(stack.undo()).toBe('edit document mood');
    expect(doc.mood).toEqual({ ambient: null, ambience: '' });
    expect(stack.redo()).toBe('edit document mood');
    expect(doc.mood).toEqual({ ambient: 0.34, ambience: '' });
  });

  it('reports composite terrain cells through command-stack change callbacks', () => {
    const doc = createEmptyDocument('terrain-callback', 'earthen');
    const seen: number[] = [];
    const stack = new CommandStack(() => doc, (cmd) => seen.push(cmd?.cells ?? 0));
    const cmd = compositeCmd('terrain composite', [
      { label: 'terrain patch', cells: 6, do: () => undefined, undo: () => undefined },
      { label: 'metadata', do: () => undefined, undo: () => undefined },
    ]);

    stack.run(cmd);
    expect(stack.undo()).toBe('terrain composite');
    expect(stack.redo()).toBe('terrain composite');

    expect(seen).toEqual([6, 6, 6]);
  });
});

describe('builder validation', () => {
  it('escapes validation issue text before rendering the issue panel', () => {
    const html = renderIssueRows([
      { severity: 'error', what: 'duplicate id: "><img src=x onerror=alert(1)>', objId: 'bad' },
    ]);

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders validation issue codes and repair actions safely', () => {
    const html = renderValidationPanel([
      {
        severity: 'error',
        code: 'builder.spawn.missing',
        what: 'No <spawn> placed',
        actions: ['addSpawnAtCamera', 'showValidationOverlay', 'previewCarveCorridor'],
      },
    ]);

    expect(html).toContain('builder.spawn.missing');
    expect(html).toContain('data-validation-action="addSpawnAtCamera"');
    expect(html).toContain('data-validation-action="previewCarveCorridor"');
    expect(html).toContain('data-action-kind="mutate"');
    expect(html).toContain('data-mutates-document="true"');
    expect(html).toContain('data-action-kind="inspect"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('No &lt;spawn&gt; placed');
    expect(html).not.toContain('No <spawn> placed');
  });

  it('builds reachability diagnostics from the same validation masks', () => {
    const { doc } = worldDoc((w) => {
      carveBox(w, 100, 100, 150, 159);
      carveBox(w, 154, 100, 220, 159);
    });
    const spawn = makeObj('spawn', 120, 158);
    const plate = makeObj('plate', 135, 159, { w: 5 });
    const door = makeObj('door', 151, 100, { w: 3, h: 60 });
    const key = makeObj('pickup', 205, 158, { kind: 'key' });
    doc.objects.push(spawn, plate, door, key);
    doc.links.push({ id: freshId('link'), fromId: plate.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });

    const diagnostics = buildValidationOverlayDiagnostics(doc);
    const leftIdx = 120 + 158 * WIDTH;
    const rightIdx = 205 + 158 * WIDTH;
    expect(diagnostics.initialReachable?.[leftIdx]).toBe(1);
    expect(diagnostics.initialReachable?.[rightIdx]).toBe(0);
    expect(diagnostics.earnedReachable?.[rightIdx]).toBe(1);
    expect(diagnostics.clearanceReachable).toBeTruthy();
  });

  it('builds and steps PreviewRuntime without mutating the live world or document layer', () => {
    const live = new World();
    live.types[live.idx(10, 10)] = Cell.Metal;
    const ctx = previewCtx(live);
    const doc = createEmptyDocument('preview-runtime', 'earthen');
    doc.world = { rle: rleEncode(new World().types), life: [], charge: [] };
    const originalRle = doc.world?.rle;
    doc.objects.push(makeObj('spawn', 120, 158));
    doc.objects.push(makeObj('hazardEmitter', 130, 120, { cell: Cell.Water, rate: 1, burst: 2 }));
    doc.lights.push({ id: freshId('light'), x: 130, y: 110, radius: 40, intensity: 1, color: '#88ccff', flicker: 0, bloom: 0, falloff: 'soft', occluded: false, hidden: false });

    const preview = new PreviewRuntime(ctx);
    const status = preview.reset(doc);
    preview.step(0);
    preview.step(3);

    expect(status.ready).toBe(true);
    expect(status.emitters).toBe(1);
    expect(status.lights).toBe(1);
    expect(live.types[live.idx(10, 10)]).toBe(Cell.Metal);
    expect(doc.world?.rle).toBe(originalRle);
    expect(preview.world.types[preview.world.idx(130, 121)]).toBe(Cell.Water);
    expect(preview.status().changedCells).toBeGreaterThan(0);
  });

  it('previews linked mechanism state in a disposable world', () => {
    const live = new World();
    live.types[live.idx(10, 10)] = Cell.Metal;
    const source = new World();
    for (let y = 128; y <= 129; y++) {
      for (let x = 128; x <= 132; x++) source.types[source.idx(x, y)] = Cell.Stone;
    }
    const ctx = previewCtx(live);
    const doc = createEmptyDocument('preview-mechanism', 'earthen');
    doc.world = { rle: rleEncode(source.types), life: [], charge: [] };
    const originalRle = doc.world.rle;
    const plate = makeObj('plate', 130, 130, { w: 5 });
    const door = makeObj('door', 150, 110, { w: 3, h: 14 });
    doc.objects.push(makeObj('spawn', 120, 158), plate, door);
    doc.links.push({ id: freshId('link'), fromId: plate.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });

    const preview = new PreviewRuntime(ctx);
    const status = preview.reset(doc);
    const doorBottom = preview.world.idx(150, 123);

    expect(status.ready).toBe(true);
    expect(status.mechanisms).toBe(2);
    expect(preview.world.types[doorBottom]).toBe(Cell.Metal);

    preview.step(0);
    preview.step(20);

    expect(preview.world.types[doorBottom]).toBe(Cell.Empty);
    expect(live.types[live.idx(10, 10)]).toBe(Cell.Metal);
    expect(doc.world.rle).toBe(originalRle);
  });

  it('previews machine primitive triggers and relay outputs', () => {
    const stepPreview = (preview: PreviewRuntime): void => {
      for (let frame = 0; frame <= 80; frame += 10) preview.step(frame);
    };

    const counterSource = new World();
    for (let y = 124; y <= 128; y++) {
      for (let x = 197; x <= 203; x++) counterSource.types[counterSource.idx(x, y)] = Cell.Stone;
    }
    const counterDoc = createEmptyDocument('preview-counterweight', 'earthen');
    counterDoc.world = { rle: rleEncode(counterSource.types), life: [], charge: [] };
    const counter = makeObj('counterweight', 200, 130, { w: 7, threshold: 8 });
    const counterDoor = makeObj('door', 220, 110, { w: 3, h: 14 });
    counterDoc.objects.push(makeObj('spawn', 180, 158), counter, counterDoor);
    counterDoc.links.push({ id: freshId('link'), fromId: counter.id, toId: counterDoor.id, kind: 'triggerDoor', logic: 'and' });
    const counterPreview = new PreviewRuntime(previewCtx());
    counterPreview.reset(counterDoc);
    stepPreview(counterPreview);
    expect(counterPreview.world.types[counterPreview.world.idx(220, 123)]).toBe(Cell.Empty);

    const chargeSource = new World();
    const chargeIndex = chargeSource.idx(260, 126);
    const chargeDoc = createEmptyDocument('preview-charge-latch', 'earthen');
    chargeDoc.world = { rle: rleEncode(chargeSource.types), life: [], charge: [[chargeIndex, 8]] };
    const latch = makeObj('chargeLatch', 260, 130);
    const latchDoor = makeObj('door', 280, 110, { w: 3, h: 14 });
    chargeDoc.objects.push(makeObj('spawn', 240, 158), latch, latchDoor);
    chargeDoc.links.push({ id: freshId('link'), fromId: latch.id, toId: latchDoor.id, kind: 'triggerDoor', logic: 'and' });
    const chargePreview = new PreviewRuntime(previewCtx());
    chargePreview.reset(chargeDoc);
    stepPreview(chargePreview);
    expect(chargePreview.world.types[chargePreview.world.idx(280, 123)]).toBe(Cell.Empty);

    const relaySource = new World();
    for (let y = 124; y <= 126; y++) {
      for (let x = 297; x <= 303; x++) relaySource.types[relaySource.idx(x, y)] = Cell.Stone;
    }
    const relayDoc = createEmptyDocument('preview-relay', 'earthen');
    relayDoc.world = { rle: rleEncode(relaySource.types), life: [], charge: [] };
    const sensor = makeObj('sensor', 300, 130, { type: 'weight', threshold: 3, zoneW: 7, zoneH: 6, latch: 'momentary' });
    const relay = makeObj('relay', 315, 130, { delay: 0 });
    const relayDoor = makeObj('door', 330, 110, { w: 3, h: 14 });
    relayDoc.objects.push(makeObj('spawn', 290, 158), sensor, relay, relayDoor);
    relayDoc.links.push(
      { id: freshId('link'), fromId: sensor.id, toId: relay.id, kind: 'triggerDoor', logic: 'and' },
      { id: freshId('link'), fromId: relay.id, toId: relayDoor.id, kind: 'triggerDoor', logic: 'and' },
    );
    const relayPreview = new PreviewRuntime(previewCtx());
    relayPreview.reset(relayDoc);
    stepPreview(relayPreview);
    expect(relayPreview.world.types[relayPreview.world.idx(330, 123)]).toBe(Cell.Empty);

    const plugSource = new World();
    for (let y = 124; y <= 126; y++) {
      for (let x = 377; x <= 383; x++) plugSource.types[plugSource.idx(x, y)] = Cell.Stone;
    }
    const plugDoc = createEmptyDocument('preview-relay-break', 'earthen');
    plugDoc.world = { rle: rleEncode(plugSource.types), life: [], charge: [] };
    const plugSensor = makeObj('sensor', 380, 130, { type: 'weight', threshold: 3, zoneW: 7, zoneH: 6, latch: 'momentary' });
    const breaker = makeObj('relay', 395, 130, { action: 'break' });
    const plug = makeObj('plug', 410, 120, { w: 3, h: 3, material: 'wood' });
    plugDoc.objects.push(makeObj('spawn', 370, 158), plugSensor, breaker, plug);
    plugDoc.links.push(
      { id: freshId('link'), fromId: plugSensor.id, toId: breaker.id, kind: 'triggerDoor', logic: 'and' },
      { id: freshId('link'), fromId: breaker.id, toId: plug.id, kind: 'triggerDoor', logic: 'and' },
    );
    const plugPreview = new PreviewRuntime(previewCtx());
    plugPreview.reset(plugDoc);
    expect(plugPreview.world.types[plugPreview.world.idx(410, 120)]).not.toBe(Cell.Empty);
    stepPreview(plugPreview);
    expect(plugPreview.world.types[plugPreview.world.idx(410, 120)]).toBe(Cell.Empty);

    const strikeSource = new World();
    for (let y = 124; y <= 126; y++) {
      for (let x = 457; x <= 463; x++) strikeSource.types[strikeSource.idx(x, y)] = Cell.Stone;
    }
    const strikeDoc = createEmptyDocument('preview-relay-strike', 'earthen');
    strikeDoc.world = { rle: rleEncode(strikeSource.types), life: [], charge: [] };
    const strikeSensor = makeObj('sensor', 460, 130, { type: 'weight', threshold: 3, zoneW: 7, zoneH: 6, latch: 'momentary' });
    const striker = makeObj('relay', 475, 130, { action: 'strike' });
    const struckDoor = makeObj('door', 500, 110, { w: 3, h: 14 });
    const struckLever = makeObj('lever', 503, 117);
    const leverDoor = makeObj('door', 520, 110, { w: 3, h: 14 });
    strikeDoc.objects.push(makeObj('spawn', 450, 158), strikeSensor, striker, struckDoor, struckLever, leverDoor);
    strikeDoc.links.push(
      { id: freshId('link'), fromId: strikeSensor.id, toId: striker.id, kind: 'triggerDoor', logic: 'and' },
      { id: freshId('link'), fromId: striker.id, toId: struckDoor.id, kind: 'triggerDoor', logic: 'and' },
      { id: freshId('link'), fromId: struckLever.id, toId: leverDoor.id, kind: 'triggerDoor', logic: 'and' },
    );
    const strikePreview = new PreviewRuntime(previewCtx());
    strikePreview.reset(strikeDoc);
    stepPreview(strikePreview);
    expect(strikePreview.world.types[strikePreview.world.idx(520, 123)]).toBe(Cell.Empty);
  });

  it('caps excessive PreviewRuntime rune vault links', () => {
    const doc = createEmptyDocument('preview-rune-cap', 'earthen');
    doc.world = { rle: rleEncode(new World().types), life: [], charge: [] };
    const glyph = makeObj('runeGlyph', 120, 130);
    const slab = makeObj('runeDoor', 150, 110, { w: 2, h: 11 });
    doc.objects.push(makeObj('spawn', 100, 158), glyph, slab);
    for (let n = 0; n < 140; n++) {
      doc.links.push({ id: freshId('link'), fromId: glyph.id, toId: slab.id, kind: 'runeDoor', logic: 'and' });
    }

    const preview = new PreviewRuntime(previewCtx());
    const status = preview.reset(doc);
    preview.step(80);

    expect(status.ready).toBe(false);
    expect(status.capped).toBe(true);
    expect(status.runeVaults).toBe(128);
  });

  it('keeps validation row indices stable across severity groups', () => {
    const html = renderValidationPanel([
      { severity: 'error', code: 'builder.spawn.missing', what: 'No player spawn placed' },
      {
        severity: 'warning',
        code: 'builder.link.hiddenEndpoint',
        what: 'link touches a hidden object',
        objIds: ['plate_1', 'door_1'],
        actions: ['selectIssueTarget'],
      },
    ]);

    expect(html).toContain('data-validation-filter="warning"');
    expect(html).toContain('data-n="1"');
    expect(html).toContain('data-issue-objs="plate_1,door_1"');
  });

  it('flags missing spawn, missing terrain, and missing exit', () => {
    const doc = createEmptyDocument('v', 'earthen');
    const issues = validateDocument(doc);
    const spawnIssue = issues.find((i) => i.severity === 'error' && i.code === 'builder.spawn.missing');
    expect(spawnIssue).toBeTruthy();
    expect(spawnIssue?.actions).toContain('addSpawnAtCamera');
    expect(issues.some((i) => i.severity === 'warning' && i.what.includes('terrain'))).toBe(true);
    expect(issues.some((i) => i.severity === 'info' && i.what.includes('win exit'))).toBe(true);
  });

  it('does not treat hidden spawns as compile-visible spawns', () => {
    const doc = createEmptyDocument('hidden-spawn', 'earthen');
    const spawn = makeObj('spawn', 120, 158);
    spawn.hidden = true;
    doc.objects.push(spawn);
    const issues = validateDocument(doc);
    expect(issues.find((issue) => issue.code === 'builder.spawn.missing')).toBeTruthy();
    expect(playtestBlockingIssues(issues, 'authored-spawn').map((issue) => issue.code)).toContain(
      'builder.spawn.missing',
    );
  });

  it('keeps playtest blockers narrower than validation errors', () => {
    const doc = createEmptyDocument('playtest-blockers', 'earthen');
    const issues = validateDocument(doc);
    expect(playtestBlockingIssues(issues, 'authored-spawn').map((issue) => issue.code)).toContain(
      'builder.spawn.missing',
    );
    expect(playtestBlockingIssues(issues, 'cursor-spawn')).toEqual([]);

    const { doc: sealedKeyDoc } = worldDoc((w) => carveBox(w, 100, 100, 200, 159));
    sealedKeyDoc.objects.push(makeObj('spawn', 120, 158));
    sealedKeyDoc.objects.push(makeObj('pickup', 600, 600, { kind: 'key' }));
    const keyIssues = validateDocument(sealedKeyDoc);
    expect(keyIssues.some((issue) => issue.code === 'builder.key.unreachable')).toBe(true);
    expect(playtestBlockingIssues(keyIssues, 'authored-spawn')).toEqual([]);
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

  it('refuses latching triggers in sequence chains, allows resettable ones', () => {
    const build = (kinds: Array<'plate' | 'brazier'>) => {
      const { doc } = worldDoc((w) => carveBox(w, 100, 100, 300, 159));
      doc.objects.push(makeObj('spawn', 110, 158));
      const door = makeObj('door', 260, 100, { w: 3, h: 60, logic: 'sequence' });
      doc.objects.push(door);
      kinds.forEach((kind, n) => {
        const t = makeObj(kind, 130 + n * 40, kind === 'brazier' ? 158 : 159, kind === 'plate' ? { w: 5 } : {});
        doc.objects.push(t);
        doc.links.push({ id: freshId('link'), fromId: t.id, toId: door.id, kind: 'triggerDoor', logic: 'and' });
      });
      return validateDocument(doc);
    };
    expect(
      build(['plate', 'brazier']).some(
        (i) => i.severity === 'error' && i.what.includes('never un-fire'),
      ),
    ).toBe(true);
    expect(errors(build(['plate', 'plate']))).toEqual([]);
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

describe('prefab cell transforms (exact values)', () => {
  it('rotates 90cw and mirrors correctly', async () => {
    const { capturePrefab, decodePrefabCells, mirrorPrefab, rotatePrefab } = await import(
      '@/builder/prefablib'
    );
    const w = new World();
    // a 3x2 block: rows [1,2,3] / [4,5,6] at (10,10)
    const vals = [1, 2, 3, 4, 5, 6];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) w.types[w.idx(10 + x, 10 + y)] = vals[x + y * 3];
    const doc = createEmptyDocument('t', 'earthen');
    const p = capturePrefab(w, { x0: 10, y0: 10, x1: 12, y1: 11 }, doc, 't')!.prefab;
    expect(Array.from(decodePrefabCells(p))).toEqual(vals);
    const r = rotatePrefab(p); // 90cw: columns become rows bottom-up
    expect(r.w).toBe(2);
    expect(r.h).toBe(3);
    expect(Array.from(decodePrefabCells(r))).toEqual([4, 1, 5, 2, 6, 3]);
    const m = mirrorPrefab(p);
    expect(Array.from(decodePrefabCells(m))).toEqual([3, 2, 1, 6, 5, 4]);
    // four rotations come home
    const r4 = rotatePrefab(rotatePrefab(rotatePrefab(rotatePrefab(p))));
    expect(Array.from(decodePrefabCells(r4))).toEqual(vals);
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
