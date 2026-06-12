import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx, RuntimeDecor, RuntimeSprite } from '@/core/types';
import {
  decodeFramePx,
  decodeRuntimeSprite,
  durationToTicks,
  encodeFramePx,
  parseAsepriteJson,
  resolveLoopTag,
  sanitizeSpriteAsset,
  sliceSheet,
  sliceUniformGrid,
  spriteContentSig,
  spritePhase,
  spriteToSheet,
} from '@/builder/assets/sprites';
import type { SpriteAsset, SpriteTag } from '@/builder/assets/sprites';
import {
  collectReferencedSprites,
  embedSprites,
  getStoredSprite,
  loadSprites,
  mergeEmbeddedSprites,
  saveSprite,
} from '@/builder/assets/spritelib';
import { decorFrame, decorLoopTicks, decorSteps, stepFrame } from '@/render/sprites/DecorSprites';
import { createEmptyDocument, sanitizeImportedDoc } from '@/builder/document';
import type { EditorDocument, EditorObject, EditorObjectKind } from '@/builder/document';
import { instantiateObjects, makeInstantiationSink } from '@/game/instantiate';

/**
 * Animated sprite pipeline (Phase 6): Aseprite JSON parsing in both
 * layouts, trimmed-frame compositing against a synthetic sheet, the
 * uniform-grid fallback, asset sanitization caps, document embedding,
 * library merge semantics, visual-only instantiation, and the stateless
 * frame-timing math the renderer runs every frame.
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

/* ---------------- fixtures ---------------- */

/** Solid-color frame bytes. */
function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

function makeAsset(
  name: string,
  w: number,
  h: number,
  frameColors: Array<[number, number, number]>,
  tags: SpriteTag[] = [],
  durationMs = 100,
): SpriteAsset {
  return {
    v: 1,
    kind: 'sprite',
    id: 'sprite-' + name,
    name,
    w,
    h,
    frames: frameColors.map(([r, g, b]) => ({
      durationMs,
      px: encodeFramePx(solid(w, h, r, g, b)),
    })),
    tags,
    emissive: false,
  };
}

function makeObj(
  kind: EditorObjectKind,
  id: string,
  x: number,
  y: number,
  params: Record<string, unknown> = {},
): EditorObject {
  return { id, kind, x, y, rotation: 0, locked: false, hidden: false, params };
}

/** A 16x8 sheet: left 8x8 red, right 8x8 blue. */
function redBlueSheet(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(16 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const o = (y * 16 + x) * 4;
      rgba[o] = x < 8 ? 255 : 0;
      rgba[o + 2] = x < 8 ? 0 : 255;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

const HASH_JSON = `{
  "frames": {
    "torch 0.aseprite": {
      "frame": { "x": 0, "y": 0, "w": 8, "h": 8 },
      "rotated": false, "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 8, "h": 8 },
      "sourceSize": { "w": 8, "h": 8 }, "duration": 100
    },
    "torch 1.aseprite": {
      "frame": { "x": 8, "y": 0, "w": 8, "h": 8 },
      "rotated": false, "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 8, "h": 8 },
      "sourceSize": { "w": 8, "h": 8 }, "duration": 50
    }
  },
  "meta": {
    "app": "https://www.aseprite.org/",
    "image": "torch.png",
    "frameTags": [
      { "name": "burn", "from": 0, "to": 1, "direction": "pingpong" },
      { "name": "idle", "from": 1, "to": 1, "direction": "reverse" }
    ]
  }
}`;

const ARRAY_TRIMMED_JSON = `{
  "frames": [
    {
      "filename": "glow 0.aseprite",
      "frame": { "x": 0, "y": 0, "w": 8, "h": 8 },
      "rotated": false, "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 8, "h": 8 },
      "sourceSize": { "w": 8, "h": 8 }, "duration": 80
    },
    {
      "filename": "glow 1.aseprite",
      "frame": { "x": 8, "y": 0, "w": 4, "h": 4 },
      "rotated": false, "trimmed": true,
      "spriteSourceSize": { "x": 2, "y": 3, "w": 4, "h": 4 },
      "sourceSize": { "w": 8, "h": 8 }, "duration": 120
    }
  ],
  "meta": { "frameTags": [] }
}`;

/* ---------------- duration -> ticks ---------------- */

describe('durationToTicks', () => {
  it('rounds 100ms to 6 ticks and clamps at a 1-tick minimum', () => {
    expect(durationToTicks(100)).toBe(6);
    expect(durationToTicks(1000 / 60)).toBe(1);
    expect(durationToTicks(1)).toBe(1);
    expect(durationToTicks(0)).toBe(1);
    expect(durationToTicks(50)).toBe(3);
  });
});

/* ---------------- Aseprite JSON parsing ---------------- */

describe('parseAsepriteJson', () => {
  it('reads the hash layout: frame order, durations, tags', () => {
    const parsed = parseAsepriteJson(JSON.parse(HASH_JSON));
    expect(parsed.w).toBe(8);
    expect(parsed.h).toBe(8);
    expect(parsed.frames.length).toBe(2);
    expect(parsed.frames[0].durationMs).toBe(100);
    expect(parsed.frames[1].durationMs).toBe(50);
    expect(parsed.frames[1].rect).toEqual({ x: 8, y: 0, w: 8, h: 8 });
    expect(parsed.tags).toEqual([
      { name: 'burn', from: 0, to: 1, dir: 'pingpong' },
      { name: 'idle', from: 1, to: 1, dir: 'reverse' },
    ]);
  });

  it('reads the array layout including trimmed-frame geometry', () => {
    const parsed = parseAsepriteJson(JSON.parse(ARRAY_TRIMMED_JSON));
    expect(parsed.frames.length).toBe(2);
    expect(parsed.frames[1].offX).toBe(2);
    expect(parsed.frames[1].offY).toBe(3);
    expect(parsed.frames[1].rect).toEqual({ x: 8, y: 0, w: 4, h: 4 });
  });

  it('rejects rotated frames with a clear error', () => {
    const bad = JSON.parse(HASH_JSON) as { frames: Record<string, { rotated: boolean }> };
    bad.frames['torch 1.aseprite'].rotated = true;
    expect(() => parseAsepriteJson(bad)).toThrow(/rotated/i);
  });

  it('rejects mixed sourceSize', () => {
    const bad = JSON.parse(HASH_JSON) as {
      frames: Record<string, { sourceSize: { w: number; h: number } }>;
    };
    bad.frames['torch 1.aseprite'].sourceSize = { w: 16, h: 16 };
    expect(() => parseAsepriteJson(bad)).toThrow(/mixed sourceSize/i);
  });

  it('rejects garbage and zero frames', () => {
    expect(() => parseAsepriteJson(null)).toThrow();
    expect(() => parseAsepriteJson({})).toThrow();
    expect(() => parseAsepriteJson({ frames: [] })).toThrow(/zero frames/i);
  });
});

describe('sliceSheet', () => {
  it('cuts plain frames from a synthetic sheet', () => {
    const asset = sliceSheet(redBlueSheet(), 16, 8, parseAsepriteJson(JSON.parse(HASH_JSON)), 'torch');
    expect(asset.frames.length).toBe(2);
    const f0 = decodeFramePx(asset.frames[0].px, 8, 8);
    const f1 = decodeFramePx(asset.frames[1].px, 8, 8);
    expect([f0[0], f0[1], f0[2], f0[3]]).toEqual([255, 0, 0, 255]);
    expect([f1[0], f1[1], f1[2], f1[3]]).toEqual([0, 0, 255, 255]);
    expect(asset.tags[0]).toEqual({ name: 'burn', from: 0, to: 1, dir: 'pingpong' });
  });

  it('composites trimmed frames into the sourceSize box at their offset', () => {
    // synthetic 16x8 sheet: full red frame 0; a green 4x4 trimmed block at (8,0)
    const rgba = new Uint8ClampedArray(16 * 8 * 4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const o = (y * 16 + x) * 4;
        rgba[o] = 255;
        rgba[o + 3] = 255;
      }
    }
    for (let y = 0; y < 4; y++) {
      for (let x = 8; x < 12; x++) {
        const o = (y * 16 + x) * 4;
        rgba[o + 1] = 255;
        rgba[o + 3] = 255;
      }
    }
    const asset = sliceSheet(rgba, 16, 8, parseAsepriteJson(JSON.parse(ARRAY_TRIMMED_JSON)), 'glow');
    const f1 = decodeFramePx(asset.frames[1].px, 8, 8);
    const at = (x: number, y: number): number[] => {
      const o = (y * 8 + x) * 4;
      return [f1[o], f1[o + 1], f1[o + 2], f1[o + 3]];
    };
    expect(at(0, 0)).toEqual([0, 0, 0, 0]); // outside the trimmed block: transparent
    expect(at(2, 3)).toEqual([0, 255, 0, 255]); // block lands at spriteSourceSize offset
    expect(at(5, 6)).toEqual([0, 255, 0, 255]); // ...and spans its 4x4
    expect(at(6, 7)).toEqual([0, 0, 0, 0]);
  });

  it('rejects rects that fall off the sheet (JSON/PNG pair mismatch)', () => {
    expect(() =>
      sliceSheet(redBlueSheet(), 12, 8, parseAsepriteJson(JSON.parse(HASH_JSON)), 'torch'),
    ).toThrow(/outside the sheet/i);
  });
});

describe('sliceUniformGrid', () => {
  it('cuts a 2-frame sheet row-major at the asked fps', () => {
    const asset = sliceUniformGrid(redBlueSheet(), 16, 8, 8, 8, 10, 'pair');
    expect(asset.frames.length).toBe(2);
    expect(asset.frames[0].durationMs).toBe(100);
    const f0 = decodeFramePx(asset.frames[0].px, 8, 8);
    const f1 = decodeFramePx(asset.frames[1].px, 8, 8);
    expect(f0[0]).toBe(255); // red
    expect(f1[2]).toBe(255); // blue
    expect(asset.tags).toEqual([]);
  });

  it('refuses absurd grids', () => {
    expect(() => sliceUniformGrid(redBlueSheet(), 16, 8, 1, 1, 8, 'x')).toThrow(/frames/i);
    expect(() => sliceUniformGrid(redBlueSheet(), 16, 8, 999, 999, 8, 'x')).toThrow();
  });
});

/* ---------------- codec + sanitize ---------------- */

describe('frame px codec + sanitize caps', () => {
  it('round-trips raw RGBA bytes through base64 exactly', () => {
    const bytes = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
    expect([...decodeFramePx(encodeFramePx(bytes), 8, 8)]).toEqual([...bytes]);
  });

  it('accepts a clean asset through a JSON round-trip', () => {
    const a = makeAsset('ok', 8, 8, [[255, 0, 0], [0, 0, 255]], [
      { name: 'loop', from: 0, to: 1, dir: 'forward' },
    ]);
    const got = sanitizeSpriteAsset(JSON.parse(JSON.stringify(a)));
    expect(got).not.toBeNull();
    expect(got!.frames.length).toBe(2);
    expect(got!.tags).toEqual(a.tags);
  });

  it('rejects wrong version/kind, oversized frames, and bad px payloads', () => {
    const a = makeAsset('bad', 8, 8, [[1, 2, 3]]);
    expect(sanitizeSpriteAsset({ ...a, v: 2 })).toBeNull();
    expect(sanitizeSpriteAsset({ ...a, kind: 'prefab' })).toBeNull();
    expect(sanitizeSpriteAsset({ ...a, w: 200 })).toBeNull(); // > 128 cap
    expect(sanitizeSpriteAsset({ ...a, frames: [] })).toBeNull();
    expect(
      sanitizeSpriteAsset({ ...a, frames: [{ durationMs: 100, px: 'short' }] }),
    ).toBeNull(); // px length mismatch
    expect(
      sanitizeSpriteAsset({
        ...a,
        frames: new Array(65).fill(a.frames[0]),
      }),
    ).toBeNull(); // > 64 frame cap
    expect(sanitizeSpriteAsset(null)).toBeNull();
  });

  it('clamps tag ranges into the strip and defaults junk directions', () => {
    const a = makeAsset('t', 4, 4, [[1, 1, 1], [2, 2, 2]]);
    a.tags = [{ name: 'x', from: -3, to: 99, dir: 'spin' as never }];
    const got = sanitizeSpriteAsset(JSON.parse(JSON.stringify(a)))!;
    expect(got.tags).toEqual([{ name: 'x', from: 0, to: 1, dir: 'forward' }]);
  });
});

/* ---------------- export round-trip ---------------- */

describe('export round-trip (our importer reads our own export)', () => {
  it('spriteToSheet -> parseAsepriteJson -> sliceSheet reproduces the asset', () => {
    const a = makeAsset(
      'torch',
      8,
      8,
      [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
      [{ name: 'burn', from: 0, to: 2, dir: 'pingpong' }],
      50,
    );
    const sheet = spriteToSheet(a);
    expect(sheet.w).toBe(24); // single-row packing
    expect(sheet.h).toBe(8);
    const back = sliceSheet(sheet.rgba, sheet.w, sheet.h, parseAsepriteJson(sheet.json), a.name);
    expect(back.frames.map((f) => f.px)).toEqual(a.frames.map((f) => f.px));
    expect(back.frames.map((f) => f.durationMs)).toEqual(a.frames.map((f) => f.durationMs));
    expect(back.tags).toEqual(a.tags);
  });
});

/* ---------------- library + document embedding ---------------- */

describe('sprite library + embedding', () => {
  beforeEach(() => {
    (globalThis.localStorage as unknown as StorageStub).clear();
  });

  it('saves, reloads, and deletes per-sprite keys', () => {
    const a = makeAsset('kept', 8, 8, [[9, 9, 9]]);
    expect(saveSprite(a)).toBe(true);
    const back = loadSprites();
    expect(back.length).toBe(1);
    expect(back[0].id).toBe(a.id);
    expect(getStoredSprite(a.id)?.name).toBe('kept');
  });

  it('collectReferencedSprites gathers exactly the referenced assets, once', () => {
    const a = makeAsset('torch', 8, 8, [[255, 0, 0]]);
    const doc = createEmptyDocument('d', 'earthen');
    doc.objects.push(
      makeObj('decor', 'd1', 10, 10, { spriteId: a.id }),
      makeObj('decor', 'd2', 20, 10, { spriteId: a.id }), // duplicate ref
      makeObj('decor', 'd3', 30, 10, { text: 'legacy note' }),
      makeObj('decor', 'd4', 40, 10, { spriteId: 'sprite-missing' }), // dangling
    );
    const got = collectReferencedSprites(doc, [a]);
    expect(got.map((s) => s.id)).toEqual([a.id]);
  });

  it('embeds referenced sprites and survives sanitizeImportedDoc', () => {
    const a = makeAsset('torch', 8, 8, [[255, 0, 0]]);
    const doc = createEmptyDocument('d', 'earthen');
    doc.objects.push(makeObj('decor', 'd1', 10, 10, { spriteId: a.id }));
    expect(embedSprites(doc, [a])).toBe(1);
    expect(doc.assets?.sprites.length).toBe(1);

    const back = sanitizeImportedDoc(JSON.parse(JSON.stringify(doc)) as EditorDocument);
    expect(back).not.toBeNull();
    expect(back!.assets?.sprites[0].id).toBe(a.id);
    expect(back!.assets?.sprites[0].frames[0].px).toBe(a.frames[0].px);

    // garbage embedded entries drop out individually; an empty block drops the field
    const dirty = JSON.parse(JSON.stringify(doc)) as EditorDocument;
    (dirty.assets!.sprites as unknown[]).push({ v: 9, junk: true });
    expect(sanitizeImportedDoc(dirty)!.assets?.sprites.length).toBe(1);
    const none = JSON.parse(JSON.stringify(doc)) as EditorDocument;
    none.assets = { sprites: [{ v: 9 } as never] };
    expect(sanitizeImportedDoc(none)!.assets).toBeUndefined();
  });

  it('a document with no sprite decor embeds nothing', () => {
    const a = makeAsset('torch', 8, 8, [[255, 0, 0]]);
    const doc = createEmptyDocument('d', 'earthen');
    doc.objects.push(makeObj('decor', 'd1', 10, 10, { text: 'note' }));
    doc.assets = { sprites: [a] }; // stale block from an earlier save
    expect(embedSprites(doc, [a])).toBe(0);
    expect(doc.assets).toBeUndefined();
  });

  it('embed round-trips through the share-code path', async () => {
    if (typeof CompressionStream === 'undefined') return; // older node: browser-only
    const { docToShareCode, shareCodeToDoc } = await import('@/builder/document');
    const a = makeAsset('torch', 8, 8, [[255, 0, 0], [0, 0, 255]]);
    const doc = createEmptyDocument('share', 'earthen');
    doc.objects.push(makeObj('decor', 'd1', 10, 10, { spriteId: a.id, loopTag: '', fps: 0 }));
    embedSprites(doc, [a]);
    const back = await shareCodeToDoc(await docToShareCode(doc));
    expect(back).not.toBeNull();
    expect(back!.assets?.sprites.length).toBe(1);
    expect(back!.assets?.sprites[0].frames.map((f) => f.px)).toEqual(a.frames.map((f) => f.px));
  });

  it('merge keeps same-content ids and re-ids on content mismatch (refs remapped)', () => {
    const local = makeAsset('torch', 8, 8, [[255, 0, 0]]);
    saveSprite(local);

    // same id, same content: nothing to do
    const docSame = createEmptyDocument('s', 'earthen');
    docSame.objects.push(makeObj('decor', 'd1', 1, 1, { spriteId: local.id }));
    docSame.assets = { sprites: [JSON.parse(JSON.stringify(local)) as SpriteAsset] };
    expect(mergeEmbeddedSprites(docSame)).toEqual({ added: 0, reIded: 0 });

    // same id, DIFFERENT content: incoming re-ids, document references follow
    const incoming = makeAsset('torch', 8, 8, [[0, 255, 0]]);
    incoming.id = local.id;
    expect(spriteContentSig(incoming)).not.toBe(spriteContentSig(local));
    const doc = createEmptyDocument('m', 'earthen');
    doc.objects.push(makeObj('decor', 'd1', 1, 1, { spriteId: local.id }));
    doc.assets = { sprites: [incoming] };
    const got = mergeEmbeddedSprites(doc);
    expect(got).toEqual({ added: 1, reIded: 1 });
    const newId = doc.assets!.sprites[0].id;
    expect(newId).not.toBe(local.id);
    expect(doc.objects[0].params.spriteId).toBe(newId);
    expect(getStoredSprite(local.id)?.frames[0].px).toBe(local.frames[0].px); // local untouched
    expect(getStoredSprite(newId)).not.toBeNull();
  });
});

/* ---------------- instantiation (visual-only) ---------------- */

describe('decor instantiation', () => {
  beforeEach(() => {
    (globalThis.localStorage as unknown as StorageStub).clear();
  });

  const noCtx = {} as unknown as Ctx;
  const noSet = (): void => {};

  it('resolves sprite decor into shared RuntimeSprites; notes and danglers no-op', () => {
    const a = makeAsset('torch', 8, 8, [[255, 0, 0], [0, 0, 255]], [
      { name: 'burn', from: 0, to: 1, dir: 'pingpong' },
    ]);
    const objects = [
      makeObj('decor', 'idA', 100, 50, { spriteId: a.id, loopTag: 'burn', fps: 0, flipX: true }),
      makeObj('decor', 'idB', 140, 50, { spriteId: a.id }),
      makeObj('decor', 'idC', 10, 10, { text: 'legacy note' }),
      makeObj('decor', 'idD', 20, 20, { spriteId: 'sprite-missing' }),
    ];
    const sink = makeInstantiationSink();
    instantiateObjects(noCtx, sink, objects, [], [], 7, 9, noSet, { docSprites: [a] });

    // note + unresolvable spriteId both compile to NOTHING (fail-open visuals)
    expect(sink.decors.length).toBe(2);
    // two instances share ONE decoded RuntimeSprite (decode once per compile)
    expect(sink.decors[0].sprite).toBe(sink.decors[1].sprite);
    expect(sink.decors[0].sprite.frames.length).toBe(2);
    expect(sink.decors[0].sprite.frames[0].ticks).toBe(6); // 100ms

    // origin applied, params honored
    expect([sink.decors[0].x, sink.decors[0].y]).toEqual([107, 59]);
    expect(sink.decors[0].flipX).toBe(true);
    expect(sink.decors[1].flipX).toBe(false);
    expect([sink.decors[0].from, sink.decors[0].to, sink.decors[0].dir]).toEqual([0, 1, 'pingpong']);
    expect(sink.decors[1].dir).toBe('forward'); // no loopTag -> whole strip

    // phase comes from the object id hash — stable and per-object
    expect(sink.decors[0].phase).toBe(spritePhase('idA'));
    expect(sink.decors[1].phase).toBe(spritePhase('idB'));

    // fps override scales ticks; 0 keeps authored durations
    expect(sink.decors[0].tickScale).toBe(0);
    const sink2 = makeInstantiationSink();
    instantiateObjects(
      noCtx,
      sink2,
      [makeObj('decor', 'idE', 0, 0, { spriteId: a.id, fps: 30 })],
      [],
      [],
      0,
      0,
      noSet,
      { docSprites: [a] },
    );
    expect(sink2.decors[0].tickScale).toBe(0.5);
  });

  it('resolves from the localStorage library when the document embeds nothing', () => {
    const a = makeAsset('stored', 8, 8, [[1, 2, 3]]);
    saveSprite(a);
    const sink = makeInstantiationSink();
    instantiateObjects(
      noCtx,
      sink,
      [makeObj('decor', 'idF', 5, 5, { spriteId: a.id })],
      [],
      [],
      0,
      0,
      noSet,
    );
    expect(sink.decors.length).toBe(1);
  });
});

/* ---------------- stateless frame timing ---------------- */

describe('decor frame timing', () => {
  function rt(ticks: number[]): RuntimeSprite {
    const starts: number[] = [];
    let total = 0;
    const frames = ticks.map((t) => {
      starts.push(total);
      total += t;
      return { ticks: t, data: new Uint8ClampedArray(4) };
    });
    return { w: 1, h: 1, frames, starts, totalTicks: total, emissive: false };
  }
  function dec(sprite: RuntimeSprite, over: Partial<RuntimeDecor> = {}): RuntimeDecor {
    return {
      x: 0,
      y: 0,
      sprite,
      from: 0,
      to: sprite.frames.length - 1,
      dir: 'forward',
      flipX: false,
      phase: 0,
      tickScale: 0,
      ...over,
    };
  }

  it('decodeRuntimeSprite computes starts and totals', () => {
    const a = makeAsset('t', 2, 2, [[1, 1, 1], [2, 2, 2]], [], 50); // 3 ticks each
    const s = decodeRuntimeSprite(a);
    expect(s.starts).toEqual([0, 3]);
    expect(s.totalTicks).toBe(6);
  });

  it('pingpong folds the sequence without repeating endpoints', () => {
    const d = dec(rt([1, 1, 1]), { dir: 'pingpong' });
    expect(decorSteps(d)).toBe(4);
    expect([0, 1, 2, 3].map((k) => stepFrame(d, k))).toEqual([0, 1, 2, 1]);
    expect([0, 1, 2, 3, 4, 5].map((fc) => decorFrame(d, fc))).toEqual([0, 1, 2, 1, 0, 1]);
  });

  it('walks authored durations at native speed', () => {
    const d = dec(rt([6, 3])); // forward, loop = 9 ticks
    expect(decorLoopTicks(d)).toBe(9);
    expect(decorFrame(d, 0)).toBe(0);
    expect(decorFrame(d, 5)).toBe(0);
    expect(decorFrame(d, 6)).toBe(1);
    expect(decorFrame(d, 8)).toBe(1);
    expect(decorFrame(d, 9)).toBe(0); // wrapped
  });

  it('phase offsets the loop so identical decors desync', () => {
    const a = dec(rt([1, 1]));
    const b = dec(rt([1, 1]), { phase: 1 });
    expect(decorFrame(a, 0)).toBe(0);
    expect(decorFrame(b, 0)).toBe(1);
    expect(decorFrame(b, 1)).toBe(0);
  });

  it('tickScale (fps override) steps uniformly, ignoring authored durations', () => {
    const d = dec(rt([6, 3]), { tickScale: 0.5 }); // fps 30
    expect([0, 1, 2, 3, 4].map((fc) => decorFrame(d, fc))).toEqual([0, 0, 1, 1, 0]);
  });

  it('reverse plays the strip backwards', () => {
    const d = dec(rt([1, 1, 1]), { dir: 'reverse' });
    expect([0, 1, 2].map((fc) => decorFrame(d, fc))).toEqual([2, 1, 0]);
  });

  it('single-frame loops are static', () => {
    const d = dec(rt([4]), { dir: 'pingpong' });
    expect(decorFrame(d, 0)).toBe(0);
    expect(decorFrame(d, 99)).toBe(0);
  });

  it('resolveLoopTag falls back to the whole strip, forward', () => {
    const a = makeAsset('t', 2, 2, [[1, 1, 1], [2, 2, 2], [3, 3, 3]], [
      { name: 'mid', from: 1, to: 2, dir: 'reverse' },
    ]);
    expect(resolveLoopTag(a, 'mid')).toEqual({ from: 1, to: 2, dir: 'reverse' });
    expect(resolveLoopTag(a, 'nope')).toEqual({ from: 0, to: 2, dir: 'forward' });
    expect(resolveLoopTag(a, '')).toEqual({ from: 0, to: 2, dir: 'forward' });
  });
});
