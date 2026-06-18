import { describe, it, expect } from 'vitest';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import {
  GLOBAL_PARAMS,
  GLOBAL_PARAM_DEFAULTS,
  PLAYER_PARAMS,
  PLAYER_TUNING_DEFAULTS,
  MATERIAL_PARAMS,
  MATERIAL_PARAM_DEFAULTS,
  SPELL_PARAMS,
  SPELL_PARAM_DEFAULTS,
} from '@/config/params';
import { GEN_TUNE, GEN_TUNE_DEFAULTS } from '@/config/gen';
import { captureTuning, flushTuning, loadTuning } from '@/config/tuningStore';

function withLocalStorage<T>(run: (store: Map<string, string>) => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
  try {
    return run(store);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  }
}

/** Mutate the live tuning singletons, run the body, then restore them so this
 *  test can't leak state into the rest of the suite (they're shared modules). */
function withCleanSingletons(run: () => void): void {
  const g = { ...GLOBAL_PARAMS };
  const p = { ...PLAYER_PARAMS };
  const gen = { ...GEN_TUNE };
  const water = { ...MATERIAL_PARAMS[Cell.Water] };
  const bolt = { ...SPELL_PARAMS.bolt };
  try {
    run();
  } finally {
    Object.assign(GLOBAL_PARAMS, g);
    Object.assign(PLAYER_PARAMS, p);
    Object.assign(GEN_TUNE, gen);
    Object.assign(MATERIAL_PARAMS[Cell.Water], water);
    Object.assign(SPELL_PARAMS.bolt, bolt);
  }
}

const fakeCtx = (brushSize: number): Ctx => ({ state: { brushSize } } as unknown as Ctx);

describe('tuning persistence', () => {
  it('captures only changed keys (sparse diff vs shipped defaults)', () => {
    withCleanSingletons(() => {
      // Untouched -> empty snapshot.
      expect(Object.keys(captureTuning()).length).toBe(0);

      GLOBAL_PARAMS.ambient = GLOBAL_PARAM_DEFAULTS.ambient + 0.1;
      PLAYER_PARAMS.jumpCut = PLAYER_TUNING_DEFAULTS.jumpCut + 0.05;
      GEN_TUNE.caveScale = 2.0;
      GEN_TUNE.fillSurfacePits = !GEN_TUNE_DEFAULTS.fillSurfacePits;
      MATERIAL_PARAMS[Cell.Water].flowRate = 0.5;

      const snap = captureTuning();
      expect(snap.global).toEqual({ ambient: GLOBAL_PARAMS.ambient });
      expect(snap.player).toEqual({ jumpCut: PLAYER_PARAMS.jumpCut });
      expect(snap.gen).toEqual({ caveScale: 2.0, fillSurfacePits: GEN_TUNE.fillSurfacePits });
      expect(snap.materials).toEqual({ [Cell.Water]: { flowRate: 0.5 } });
      // Spells untouched -> not present at all.
      expect(snap.spells).toBeUndefined();
    });
  });

  it('round-trips through storage and ignores other materials/spells', () => {
    withLocalStorage(() => {
      withCleanSingletons(() => {
        GLOBAL_PARAMS.simSpeed = 1.7;
        GEN_TUNE.caveScale = 0.8;
        MATERIAL_PARAMS[Cell.Water].flowRate = 0.33;
        SPELL_PARAMS.bolt.manaCost = 99;
        flushTuning(fakeCtx(13));

        // Wipe the singletons back to shipped values, then rehydrate from storage.
        GLOBAL_PARAMS.simSpeed = GLOBAL_PARAM_DEFAULTS.simSpeed;
        GEN_TUNE.caveScale = GEN_TUNE_DEFAULTS.caveScale;
        MATERIAL_PARAMS[Cell.Water].flowRate = MATERIAL_PARAM_DEFAULTS[Cell.Water].flowRate!;
        SPELL_PARAMS.bolt.manaCost = SPELL_PARAM_DEFAULTS.bolt.manaCost!;

        const ctx = fakeCtx(6);
        loadTuning(ctx);

        expect(GLOBAL_PARAMS.simSpeed).toBe(1.7);
        expect(GEN_TUNE.caveScale).toBe(0.8);
        expect(MATERIAL_PARAMS[Cell.Water].flowRate).toBe(0.33);
        expect(SPELL_PARAMS.bolt.manaCost).toBe(99);
        expect(ctx.state.brushSize).toBe(13);
        // A material that was never changed keeps its shipped default after restore.
        expect(MATERIAL_PARAMS[Cell.Lava].flowRate).toBe(MATERIAL_PARAM_DEFAULTS[Cell.Lava].flowRate);
      });
    });
  });

  it('drops the stored key when nothing differs from defaults', () => {
    withLocalStorage((store) => {
      withCleanSingletons(() => {
        GLOBAL_PARAMS.simSpeed = 2.5;
        flushTuning();
        expect(store.size).toBe(1);
        // Back to default -> the next flush removes the key entirely.
        GLOBAL_PARAMS.simSpeed = GLOBAL_PARAM_DEFAULTS.simSpeed;
        flushTuning();
        expect(store.size).toBe(0);
      });
    });
  });
});
