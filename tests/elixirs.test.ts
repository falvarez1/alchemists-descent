import { describe, expect, it } from 'vitest';

import { MATERIAL_PARAMS } from '@/config/params';
import {
  activePotions,
  addEffectFrames,
  addStatusFrames,
  effectFrames,
  elixirDef,
  ELIXIRS,
  isElixirCell,
  POTION_CAP_FRAMES,
} from '@/content/elixirs';
import { isPerkId } from '@/content/perks';
import { MATERIAL_SWATCHES } from '@/content/materialPalette';
import { boonFrames, hasBoon, tickBoons } from '@/core/boons';
import { CELL_NAME } from '@/sim/cellPalette';
import { Cell, ELIXIR_CELL_IDS, isElixir, isLiquid } from '@/sim/CellType';
import { COLOR_FN } from '@/sim/colors';
import { createDefaultStatus } from '@/entities/status';
import { drinkFlask } from '@/game/potions';
import { MATERIAL_INFO } from '@/ui/materialInfo';
import type { Ctx, EntityStatus } from '@/core/types';

/** A brimming bowl: the bowl holds about this many cells of product. */
const FULL_BOWL = 13;

describe('the elixir table', () => {
  it('is the sim\'s list of potion cells, one row per cell', () => {
    expect(new Set(ELIXIRS.map((e) => e.cell)).size).toBe(ELIXIRS.length);
    expect([...ELIXIRS.map((e) => e.cell)].sort((a, b) => a - b)).toEqual([...ELIXIR_CELL_IDS].sort((a, b) => a - b));
    for (const e of ELIXIRS) {
      expect(isElixir(e.cell)).toBe(true);
      expect(isElixirCell(e.cell)).toBe(true);
      expect(isLiquid(e.cell), 'a potion is a liquid to the sim').toBe(true);
      expect(elixirDef(e.cell)).toBe(e);
    }
    expect(isElixirCell(Cell.Water)).toBe(false);
  });

  it('gives every potion cell its colour, name, swatch, marker name and popover copy (the new-cell checklist)', () => {
    for (const e of ELIXIRS) {
      expect(COLOR_FN[e.cell], `colour ${e.cell}`).toBeTypeOf('function');
      expect(MATERIAL_PARAMS[e.cell]?.name, `params ${e.cell}`).toBeTruthy();
      expect(CELL_NAME[e.cell], `marker name ${e.cell}`).toBe(MATERIAL_PARAMS[e.cell]?.name);
      expect(MATERIAL_SWATCHES.some((s) => s.id === e.cell), `palette ${e.cell}`).toBe(true);
      expect(MATERIAL_INFO[e.cell].length, `copy ${e.cell}`).toBeGreaterThan(20);
      expect(MATERIAL_PARAMS[e.cell]?.flowRate, `flow ${e.cell}`).toBeGreaterThan(0);
    }
  });

  it('names a real effect: a status timer, or a Sanctum boon some hook reads', () => {
    const timers = ['regen', 'levity', 'stoneskin', 'swift', 'torch'];
    for (const e of ELIXIRS) {
      if (e.effect.kind === 'status') expect(timers).toContain(e.effect.key);
      else expect(isPerkId(e.effect.key), e.effect.key).toBe(true);
    }
    expect(new Set(ELIXIRS.map((e) => e.effect.key)).size).toBe(ELIXIRS.length); // no two potions are the same potion
  });

  it('makes a brimming bowl worth drinking: 20 to 60 seconds, and never past the cup', () => {
    for (const e of ELIXIRS) {
      const seconds = (FULL_BOWL * e.framesPerCell) / 60;
      expect(seconds, e.chip.label).toBeGreaterThanOrEqual(20);
      expect(seconds, e.chip.label).toBeLessThanOrEqual(60);
      expect(FULL_BOWL * e.framesPerCell).toBeLessThanOrEqual(POTION_CAP_FRAMES);
      expect(e.chip.label.length).toBeLessThanOrEqual(10);
      expect(e.chip.tint).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('timed boons', () => {
  it('reads like a Sanctum boon while the potion lasts, and no longer', () => {
    const player = { perks: {}, status: createDefaultStatus() } as { perks: Record<string, true>; status: EntityStatus };
    expect(hasBoon(player, 'flameward')).toBe(false);
    addEffectFrames(player.status, { kind: 'boon', key: 'flameward' }, 120);
    expect(hasBoon(player, 'flameward')).toBe(true);
    expect(boonFrames(player.status, 'flameward')).toBe(120);
    tickBoons(player.status, 50);
    expect(boonFrames(player.status, 'flameward')).toBe(70);
    tickBoons(player.status, 70);
    expect(hasBoon(player, 'flameward')).toBe(false);
    expect(player.status.boons).toEqual({});
    player.perks.flameward = true; // the run's own
    expect(hasBoon(player, 'flameward')).toBe(true);
    expect(hasBoon(player, 'toxinward')).toBe(false);
  });

  it('stacks under one shared cap and refuses to add past it', () => {
    const st = createDefaultStatus();
    const effect = { kind: 'status', key: 'swift' } as const;
    expect(addEffectFrames(st, effect, 3000)).toBe(3000);
    expect(addEffectFrames(st, effect, 3000)).toBe(POTION_CAP_FRAMES - 3000);
    expect(st.swift).toBe(POTION_CAP_FRAMES);
    expect(addEffectFrames(st, effect, 200)).toBe(0);
    addStatusFrames(st, 'torch', 9999);
    expect(st.torch).toBe(POTION_CAP_FRAMES);
    expect(effectFrames(st, { kind: 'boon', key: 'might' })).toBe(0);
  });

  it('lists the working potions in the table\'s order, status timers and boons alike', () => {
    const st = createDefaultStatus();
    st.swift = 600;
    st.regen = 90;
    addEffectFrames(st, { kind: 'boon', key: 'toxinward' }, 300);
    expect(activePotions(st).map((p) => [p.def.chip.label, p.frames])).toEqual([['MENDING', 90], ['SWIFT', 600], ['ANTIDOTE', 300]]);
    expect(activePotions(createDefaultStatus())).toEqual([]);
  });
});

function drinkCtx(material: number | null, count: number, frame = 0): { ctx: Ctx; toasts: string[] } {
  const toasts: string[] = [];
  const ctx = {
    flask: { state: { material, count, capacity: 600 } },
    player: { x: 10, y: 10, status: createDefaultStatus() },
    state: { frameCount: frame, debugGodMode: false },
    particles: { spawn: () => undefined },
    audio: { sfx: () => undefined },
    telemetry: { count: () => undefined },
    events: { emit: (event: string, payload: { text?: string }) => { if (event === 'toast' && payload.text) toasts.push(payload.text); } },
  } as unknown as Ctx;
  return { ctx, toasts };
}

describe('drinking from the flask', () => {
  it('swallows a potion a cell every other frame and loads its effect', () => {
    const { ctx } = drinkCtx(Cell.ElixirSwift, 13);
    for (let f = 0; f < 4; f++) {
      ctx.state.frameCount = f;
      drinkFlask(ctx);
    }
    expect(ctx.flask.state.count).toBe(11); // frames 0 and 2
    expect(ctx.player.status.swift).toBe(2 * 200);
  });

  it('a full bowl is the dose it was brewed to be: 13 cells of tea is over forty seconds', () => {
    const { ctx } = drinkCtx(Cell.ElixirSwift, 13);
    for (let f = 0; f < 40; f++) {
      ctx.state.frameCount = f;
      drinkFlask(ctx);
    }
    expect(ctx.flask.state.count).toBe(0);
    expect(ctx.flask.state.material).toBeNull();
    expect(ctx.player.status.swift / 60).toBeGreaterThan(40);
  });

  it('puts a boon potion into the boon map, not a timer', () => {
    const { ctx } = drinkCtx(Cell.ElixirFire, 5);
    drinkFlask(ctx);
    expect(ctx.player.status.boons).toEqual({ flameward: 180 });
    expect(hasBoon({ perks: {}, status: ctx.player.status }, 'flameward')).toBe(true);
  });

  it('refuses a cell once the cup is full, and keeps it in the flask', () => {
    const { ctx, toasts } = drinkCtx(Cell.ElixirLife, 20);
    ctx.player.status.regen = POTION_CAP_FRAMES - 50;
    ctx.state.frameCount = 0;
    drinkFlask(ctx); // 50 short of full: takes the cell (100 frames, capped)
    expect(ctx.player.status.regen).toBe(POTION_CAP_FRAMES);
    expect(ctx.flask.state.count).toBe(19);
    ctx.state.frameCount = 2;
    drinkFlask(ctx);
    expect(ctx.flask.state.count).toBe(19);
    expect(toasts).toEqual(['MENDING: AS STRONG AS IT GETS']);
  });

  it('keeps water as it was: two cells a frame, wet and no longer burning', () => {
    const { ctx } = drinkCtx(Cell.Water, 10);
    ctx.player.status.burning = 100;
    drinkFlask(ctx);
    expect(ctx.flask.state.count).toBe(8);
    expect(ctx.player.status.wet).toBe(120);
    expect(ctx.player.status.burning).toBe(0);
  });

  it('will not swallow anything else, and an empty flask does nothing', () => {
    for (const m of [Cell.Lava, Cell.Oil, Cell.Acid, Cell.Gunpowder]) {
      const { ctx } = drinkCtx(m, 10);
      drinkFlask(ctx);
      expect(ctx.flask.state.count, String(m)).toBe(10);
    }
    const { ctx } = drinkCtx(null, 0);
    expect(() => drinkFlask(ctx)).not.toThrow();
  });

  it('spends nothing in god mode', () => {
    const { ctx } = drinkCtx(Cell.ElixirTorch, 3);
    ctx.state.debugGodMode = true;
    drinkFlask(ctx);
    expect(ctx.flask.state.count).toBe(3);
    expect(ctx.player.status.torch).toBe(250);
  });
});
