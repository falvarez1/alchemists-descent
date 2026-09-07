import { describe, expect, it } from 'vitest';
import type { Ctx } from '@/core/types';
import { createLivingState, pressurePhase, updateLivingExpedition } from '@/game/LivingExpedition';
import { makeLevelRuntime } from '@/game/runtime';
import { generateBreathingWorks, WORKS_ROOMS } from '@/world/breathingWorks';
import { LEVELS } from '@/config/worldgraph';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { validateFindability, wizardMask } from '@/world/validate';
import { EventBus } from '@/core/events';

function fixture(seed = 777) {
  const world = new World();
  const ctx = { world, state: { mode: 'play' }, player: { x: 170, y: 314, vx: 0, dead: false, hp: 70, maxHp: 110 },
    enemies: [], events: new EventBus(), audio: { tone: () => {} } } as unknown as Ctx;
  const generated = generateBreathingWorks(ctx, seed);
  const runtime = makeLevelRuntime({ ...generated, def: LEVELS.d1, world, regions: null, living: createLivingState() });
  ctx.levels = { current: runtime, saveExpedition: () => {} } as unknown as Ctx['levels'];
  return { ctx, runtime, generated };
}

describe('Breathing Works encounter contracts', () => {
  it('connects every room and progression landmark without a repair tunnel', () => {
    const { runtime, generated } = fixture();
    const mask = wizardMask(runtime);
    for (const room of WORKS_ROOMS) {
      const x = room.x + Math.floor(room.w / 2), y = room.floor - 20;
      expect(mask[runtime.world.idx(x, y)], room.id).toBe(1);
    }
    expect(validateFindability(runtime).filter(issue => issue.severity === 'error')).toEqual([]);
    expect(generated.prefabEnemies.map(e => e.kind)).toEqual(['rillback', 'weaver', 'weaver', 'rillback', 'rootloper', 'stonemaw']);
  });

  it('keeps route geometry deterministic while mineral colors vary by seed', () => {
    const a = fixture(41), b = fixture(41);
    expect(Buffer.from(a.runtime.world.types).equals(Buffer.from(b.runtime.world.types))).toBe(true);
    expect(Buffer.from(a.runtime.world.colors.buffer).equals(Buffer.from(b.runtime.world.colors.buffer))).toBe(true);
    // GEN_VERSION 39 reclaimed habitat and optional spell detours.
    let hash = 0x811c9dc5;
    for (const byte of a.runtime.world.types) hash = Math.imul(hash ^ byte, 0x01000193);
    // GEN_VERSION 42: domino/spring latch, guided valves and electrical gallery.
    expect((hash >>> 0).toString(16)).toBe('70af2f55');
  });

  it('warns before exhaling, consumes water and cannot vent from a frozen reservoir', () => {
    expect(pressurePhase(3599)).toBe('quiet');
    expect(pressurePhase(3600)).toBe('inhale');
    expect(pressurePhase(4080)).toBe('exhale');
    const { ctx, runtime } = fixture();
    runtime.living!.ticks = 4079;
    const count = (type: number) => runtime.world.types.reduce((n, t) => n + Number(t === type), 0);
    const water = count(Cell.Water);
    updateLivingExpedition(ctx);
    expect(count(Cell.Water)).toBeLessThan(water);
    expect(count(Cell.Steam)).toBeGreaterThan(0);
    for (let i = 0; i < ctx.world.types.length; i++) if (ctx.world.types[i] === Cell.Water) ctx.world.types[i] = Cell.Ice;
    const steam = count(Cell.Steam);
    for (let i = 0; i < 8; i++) updateLivingExpedition(ctx);
    expect(count(Cell.Steam)).toBe(steam);
  });

  it('rest needs safety and stillness and restores reusable supplies once per stay', () => {
    const { ctx, runtime } = fixture();
    Object.assign(ctx.player, { x: 857, y: 743 });
    runtime.living!.glowseeds = 0;
    for (let i = 0; i < 119; i++) updateLivingExpedition(ctx);
    expect(ctx.player.hp).toBe(70);
    updateLivingExpedition(ctx);
    expect(ctx.player.hp).toBe(110);
    expect(runtime.living!.glowseeds).toBe(3);
    runtime.living!.glowseeds = 2;
    updateLivingExpedition(ctx);
    expect(runtime.living!.glowseeds).toBe(2);
  });
});
