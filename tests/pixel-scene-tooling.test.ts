import { describe, it, expect } from 'vitest';
import { Cell } from '@/sim/CellType';
import { getDefaultPixelSceneLibrary } from '@/world/virtual/defaults';
import { serializePixelScene, parsePixelScene } from '@/world/virtual/pixelSceneJson';
import { validatePixelScene } from '@/world/virtual/pixelSceneValidate';
import { listUserScenes, saveUserScene, deleteUserScene, userSceneExists } from '@/world/virtual/pixelSceneStore';
import type { PixelSceneDef } from '@/world/virtual/types';

function syntheticScene(): PixelSceneDef {
  const w = 5;
  const h = 4;
  const n = w * h;
  const material = new Uint8Array(n);
  const mask = new Uint8Array(n);
  const colorOverrides = new Uint32Array(n);
  const life = new Int16Array(n);
  const charge = new Uint8Array(n);
  material[0] = Cell.Wall; mask[0] = 1; colorOverrides[0] = 0x123456; life[0] = -5; charge[0] = 7;
  material[6] = Cell.Water; mask[6] = 1; colorOverrides[6] = 0xabcdef; life[6] = 1234;
  return {
    v: 1, id: 't-scene', name: 'Test Scene', kind: 'shrines', tags: ['a', 'b'], w, h,
    material, mask, colorOverrides, life, charge,
    objects: [{ id: 'o', kind: 'pickup', x: 1, y: 1, params: { amount: 9 } }],
    links: [],
    lights: [{ id: 'l', x: 2, y: 2, color: '#7df9ff', intensity: 0.8, radius: 40 }],
  };
}

function withLocalStorage<T>(run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  }
}

describe('pixel scene JSON registry', () => {
  it('round-trips every plane, scalar and array (incl. negative Int16 life)', () => {
    const a = syntheticScene();
    const b = parsePixelScene(serializePixelScene(a));
    expect(b.id).toBe(a.id);
    expect(b.kind).toBe(a.kind);
    expect(b.tags).toEqual(a.tags);
    expect(Array.from(b.material)).toEqual(Array.from(a.material));
    expect(Array.from(b.mask!)).toEqual(Array.from(a.mask!));
    expect(Array.from(b.colorOverrides!)).toEqual(Array.from(a.colorOverrides!));
    expect(Array.from(b.life!)).toEqual(Array.from(a.life!)); // -5 and 1234 survive
    expect(Array.from(b.charge!)).toEqual(Array.from(a.charge!));
    expect(b.objects).toEqual(a.objects);
    expect(b.lights).toEqual(a.lights);
  });

  it('round-trips a real library scene through JSON', () => {
    const scene = getDefaultPixelSceneLibrary().find((s) => s.id === 'scene-shrine')!;
    const back = parsePixelScene(JSON.parse(JSON.stringify(serializePixelScene(scene))));
    expect(Array.from(back.material)).toEqual(Array.from(scene.material));
    if (scene.colorOverrides) expect(Array.from(back.colorOverrides!)).toEqual(Array.from(scene.colorOverrides));
  });

  it('rejects structurally broken JSON', () => {
    expect(() => parsePixelScene({ v: 1, id: 'x', name: 'x', w: 0, h: 0, material: '' } as never)).toThrow();
  });
});

describe('pixel scene validation', () => {
  const blank = (w: number, h: number): PixelSceneDef => ({
    v: 1, id: 'v', name: 'v', w, h, material: new Uint8Array(w * h), mask: new Uint8Array(w * h),
    objects: [], links: [], lights: [], kind: 'shrines', tags: ['x'],
  });

  it('flags a liquid cell with no basin, passes a framed pool', () => {
    const leaky = blank(3, 3);
    leaky.material[4] = Cell.Water; leaky.mask![4] = 1;
    expect(validatePixelScene(leaky).some((x) => x.code === 'liquid-basin')).toBe(true);
    const sealed = blank(3, 3);
    for (let i = 0; i < 9; i++) { sealed.material[i] = Cell.Wall; sealed.mask![i] = 1; }
    sealed.material[4] = Cell.Water;
    expect(validatePixelScene(sealed).some((x) => x.code === 'liquid-basin')).toBe(false);
  });

  it('errors on an out-of-bounds object and warns on a light overflow', () => {
    const s = blank(4, 4);
    s.material[0] = Cell.Wall; s.mask![0] = 1;
    s.objects = [{ id: 'o', kind: 'pickup', x: 99, y: 1, params: {} }];
    s.lights = Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, x: 1, y: 1, color: '#fff', intensity: 1, radius: 10 }));
    const codes = validatePixelScene(s).map((x) => `${x.severity}:${x.code}`);
    expect(codes).toContain('error:oob');
    expect(codes).toContain('warn:light-budget');
  });
});

describe('pixel scene user store', () => {
  it('saves, lists, and deletes user scenes through localStorage', () => {
    withLocalStorage(() => {
      const s = syntheticScene();
      s.id = 'user-mine';
      expect(userSceneExists('user-mine')).toBe(false);
      expect(saveUserScene(s)).toBe(true);
      expect(userSceneExists('user-mine')).toBe(true);
      const list = listUserScenes();
      expect(list.map((x) => x.id)).toContain('user-mine');
      expect(Array.from(list[0].material)).toEqual(Array.from(s.material));
      deleteUserScene('user-mine');
      expect(userSceneExists('user-mine')).toBe(false);
    });
  });
});
