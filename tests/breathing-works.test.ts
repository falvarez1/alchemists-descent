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
import { Mechanisms } from '@/game/Mechanisms';

function fixture(seed = 777) {
  const noop = (): void => undefined;
  const world = new World();
  const ctx = { world, state: { mode: 'play' }, player: { x: 170, y: 314, vx: 0, dead: false, hp: 70, maxHp: 110 },
    enemies: [], events: new EventBus(), audio: { tone: noop, groan: noop, zap: noop, bubble: noop, brazier: noop,
      doorGrind: noop }, particles: { spawn: noop, burst: noop } } as unknown as Ctx;
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
    // GEN_VERSION 44: cold-lock backtrack, return hatch and living habitat.
    expect((hash >>> 0).toString(16)).toBe('e3131c67');
  });

  it('makes Frost Shard a real out-and-back gate before the engine crank', () => {
    const { ctx, runtime } = fixture();
    const frost = runtime.pickups.find(p => p.kind === 'tome' && p.data.card === 'frostshard')!;
    const gate = runtime.mechanisms.filter(m => m.requiresCard === 'frostshard');
    expect(frost).toMatchObject({ x: 892, y: 735, taken: false });
    expect(gate.map(m => m.kind).sort()).toEqual(['door', 'door', 'lever']);
    expect(gate.filter(m => m.kind === 'door').every(m => m.state === 0)).toBe(true);
    const basin = runtime.mechanisms.find(m => m.sensorType === 'material' && m.materialFilter?.includes(Cell.Ice))!.zone!;
    let frozen = 0;
    for (let y = basin.y0; y <= basin.y1 && frozen < 32; y++) for (let x = basin.x0; x <= basin.x1 && frozen < 32; x++) {
      const i = runtime.world.idx(x, y);
      if (runtime.world.types[i] === Cell.Water) { runtime.world.types[i] = Cell.Ice; frozen++; }
    }
    expect(frozen).toBe(32);
    const system = new Mechanisms(ctx);
    ctx.state.paused = false;
    for (let frame = 0; frame < 80; frame++) { ctx.state.frameCount = frame; system.update(ctx); }
    expect(gate.filter(m => m.kind === 'door').every(m => m.state === 1)).toBe(true);
    expect(gate.filter(m => m.kind === 'door').every(m => !m.dissolve)).toBe(true);
    const postUnlock = wizardMask(runtime);
    expect(postUnlock[runtime.world.idx(430, 311)]).toBe(1);
    system.dispose();
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
