import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import type { EditorWorldLayer } from '@/authoring/document';
import { applyWorldLayer, captureWorldLayer, encodeColorPlane } from '@/authoring/worldLayer';
import type { BiomeId } from '@/core/types';
import { rleEncode } from '@/core/rle';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

/**
 * PAINT VERSION 1 STILL DECODES (authoring/legacyPaintV1). The fixtures are
 * layers the version-1 codec captured (6cba7e8, before the shared paint), with
 * what that codec decoded them to: an FNV hash of the whole colour plane, 64
 * sampled cells and the number of cells it flagged as scars. A version-1
 * layer's overrides were computed against the version-1 repaint, so decoding it
 * against anything else would put wrong colours on every unchanged cell.
 */

interface Fixture {
  note: string;
  target: { biome: BiomeId; seed: number };
  layer: EditorWorldLayer;
  expected: { colorsFnv: string; samples: Array<[number, number]>; scars: number };
}

function load(name: string): Fixture {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/world-layer-v1/${name}.json.gz`, import.meta.url))).toString('utf8')) as Fixture;
}

function fnv(colors: Uint32Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    h = Math.imul(h ^ (c & 0xff), 0x01000193);
    h = Math.imul(h ^ ((c >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((c >>> 16) & 0xff), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const FIXTURES = ['earthen-sparse', 'crystal-sparse', 'frozen-authored-fallback'];

describe('version-1 world layers', () => {
  for (const name of FIXTURES) {
    it(`${name}: decodes to the colours the version-1 codec gave it`, () => {
      const fx = load(name);
      expect(fx.layer.paint).toBeUndefined();
      const world = new World();
      applyWorldLayer({ world, ...fx.target }, fx.layer);
      for (const [i, c] of fx.expected.samples) expect(world.colors[i], `cell ${i}`).toBe(c);
      expect(fnv(world.colors)).toBe(fx.expected.colorsFnv);
      expect(world.colorOverrides.size).toBe(fx.expected.scars);
      expect(world.paint).toMatchObject({ v: 1 });
    });

    it(`${name}: saved again, keeps its paint and its colours`, () => {
      const fx = load(name);
      const world = new World();
      applyWorldLayer({ world, ...fx.target }, fx.layer);
      const again = captureWorldLayer({ world, ...fx.target });
      expect(again.paint).toEqual(world.paint);
      // No bigger than it came: the differences are the same cells.
      expect(JSON.stringify(again).length).toBeLessThan(JSON.stringify(fx.layer).length);
      const back = new World();
      applyWorldLayer({ world: back, ...fx.target }, JSON.parse(JSON.stringify(again)) as EditorWorldLayer);
      expect(back.colors).toEqual(world.colors);
      expect(fnv(back.colors)).toBe(fx.expected.colorsFnv);
      expect(back.colorOverrides.size).toBe(world.colorOverrides.size);
    });
  }

  it('a version-1 layer with a full colour plane decodes to exactly that plane', () => {
    const source = new World();
    for (let i = 0; i < source.types.length; i += 7) source.types[i] = Cell.Wall;
    for (let i = 0; i < source.colors.length; i++) source.colors[i] = (i * 2654435761) >>> 8;
    const layer: EditorWorldLayer = {
      rle: rleEncode(source.types),
      biome: 'fungal',
      seed: 3,
      paintSeed: 1234,
      colors: encodeColorPlane(source.colors),
    };
    const world = new World();
    applyWorldLayer({ world, biome: 'earthen', seed: 3 }, layer);
    expect(world.colors).toEqual(source.colors);
  });
});
