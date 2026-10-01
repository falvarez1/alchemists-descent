import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { createLivingState, livingObjective, pressurePhase, updateLivingExpedition } from '@/game/LivingExpedition';
import { makeLevelRuntime } from '@/game/runtime';
import { generateBreathingWorks, WORKS_BARRICADE, WORKS_GATE, WORKS_ROOMS, worksGateOpen, worksPlaceName } from '@/world/breathingWorks';
import { TEA, TEA_COMPLETE_STAGE, TEA_STAGE } from '@/world/teaMachine';
import { LEVELS } from '@/config/worldgraph';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { routeSealedInput, validateFindability, wizardMask } from '@/world/validate';
import { EventBus } from '@/core/events';
import { Mechanisms } from '@/game/Mechanisms';

function fixture(seed = 777) {
  const noop = (): void => undefined;
  const world = new World();
  const ctx = { world, state: { mode: 'play', frameCount: 0 }, player: { x: 170, y: 314, vx: 0, dead: false, hp: 70, maxHp: 110, grounded: true },
    enemies: [], events: new EventBus(), fx: { screenShake: 0 }, audio: { sfx: () => undefined, creature: () => undefined, tone: noop, groan: noop, zap: noop, bubble: noop, brazier: noop,
      doorGrind: noop, gong: noop, keyJingle: noop, noiseBurst: noop, at: (_x: number, _y: number, fn: () => void) => fn() },
    particles: { spawn: noop, burst: noop } } as unknown as Ctx;
  const generated = generateBreathingWorks(ctx, seed);
  const runtime = makeLevelRuntime({ ...generated, def: LEVELS.d1, world, regions: null, living: createLivingState() });
  ctx.levels = { current: runtime, saveExpedition: () => {} } as unknown as Ctx['levels'];
  return { ctx, runtime, generated };
}

describe('Breathing Works encounter contracts', () => {
  it('connects every room and progression landmark without a repair tunnel', () => {
    const { runtime, generated } = fixture();
    // The barricade is a route seal: the audit walks through the timber the
    // starting kit always burns or digs, and through nothing else.
    const mask = wizardMask(routeSealedInput(runtime));
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
    let hash = 0x811c9dc5;
    for (const byte of a.runtime.world.types) hash = Math.imul(hash ^ byte, 0x01000193);
    // GEN_VERSION 64: the Refuge Kettle (a basin, an ember-banked furnace, a cistern under a grate and a tea shrub on the
    // Warm Refuge plinth), over
    // GEN_VERSION 62: the timber catwalks lose their diagonal braces and gain a flush joist (worksHabitat), over
    // GEN_VERSION 55: the story's Guild locker nook off the return shaft (the resonant valve), over GEN 53's
    // Undertow cache, hand-planted stands and Seed Cellar and GEN 48's barricade, shaft hatch and floor gate.
    expect((hash >>> 0).toString(16)).toBe('5c264b8');
  });

  it('hangs the timber catwalks bare: no diagonal sticks under a deck, and the joist stays inside it', () => {
    // The five catwalks once grew two solid one-cell diagonal "braces" each. They ended in open
    // air, held nothing up, and caught jumps made beside the deck (the owner's screenshot, 2026-09-30).
    const { runtime } = fixture(1337);
    const world = runtime.world;
    const wood = (x: number, y: number): boolean => world.type(x, y) === Cell.Wood;
    for (const [x, y, width] of [[570, 341, 63], [677, 325, 66], [789, 349, 48], [1015, 390, 195], [1230, 390, 167]] as const) {
      let first = -1, last = -1;
      for (let xx = x - 4; xx < x + width + 4; xx++) if (wood(xx, y + 6)) { if (first < 0) first = xx; last = xx; }
      expect(first, `deck at ${x},${y} exists`).toBeGreaterThanOrEqual(0);
      // Nothing of timber hangs more than the joist's two rows below the deck, anywhere along it.
      for (let yy = y + 9; yy <= y + 32; yy++) {
        for (let xx = x - 4; xx < x + width + 4; xx++) expect(wood(xx, yy), `no stick at ${xx},${yy}`).toBe(false);
      }
      // The joist is flush under the planks, inset from both real ends, never wider than the deck.
      for (const row of [y + 7, y + 8]) {
        for (let xx = x - 12; xx < x + width + 12; xx++) {
          if (!wood(xx, row)) continue;
          expect(xx >= first + 9 && xx <= last - 9, `joist cell ${xx},${row} inside deck ${first}..${last}`).toBe(true);
        }
      }
    }
  });

  it('puts an oil-soaked barricade on the forced route to the crank, and nothing card-locked', () => {
    const { runtime } = fixture();
    expect(runtime.mechanisms.filter(m => m.requiresCard)).toEqual([]);
    const barricade = runtime.mechanisms.find(m => m.id === WORKS_BARRICADE.id)!;
    expect(barricade).toMatchObject({ kind: 'plug', routeSeal: true, material: Cell.Wood, state: 0 });
    expect(barricade.body!.every(([x, y]) => runtime.world.type(x, y) === Cell.Wood)).toBe(true);
    // Oil-soaked, but safely: its oil sits in sealed pockets deeper than a
    // Spark Bolt's blast reaches from the face (a burst store throws burning
    // oil back at the shooter), and its seams are caulked with moss tinder.
    let oil = 0, moss = 0;
    for (let y = WORKS_BARRICADE.y0 - 2; y <= WORKS_BARRICADE.y1 + 2; y++) for (let x = WORKS_BARRICADE.x0 - 6; x <= WORKS_BARRICADE.x1 + 6; x++) {
      const t = runtime.world.type(x, y);
      if (t === Cell.Oil) { oil++; expect(x - WORKS_BARRICADE.x0, `oil at ${x},${y}`).toBeGreaterThanOrEqual(7); }
      if (t === Cell.Moss && x >= WORKS_BARRICADE.x0 && x <= WORKS_BARRICADE.x1) moss++;
    }
    expect(oil).toBeGreaterThan(5);
    expect(moss).toBeGreaterThan(40);
    // Honestly blocking: without the route-seal allowance the crank is out of reach...
    const raw = wizardMask(runtime), opened = wizardMask(routeSealedInput(runtime));
    const crankStand = runtime.world.idx(TEA.lever.x - 4, 311);
    expect(raw[crankStand]).toBe(0);
    expect(opened[crankStand]).toBe(1);
    // ...and the walk to it has no pitfall: the old shaft hatch is sealed metal.
    for (let x = 330; x < WORKS_BARRICADE.x0 - 4; x++) expect(runtime.world.type(x, 316), `bridge at ${x}`).toBe(Cell.Metal);
    // Frost Shard stays in the refuge as an optional reward.
    expect(runtime.pickups.find(p => p.kind === 'tome' && p.data.card === 'frostshard')).toMatchObject({ x: 892, y: 735, taken: false });
  });

  it('the barricade collapses once it has mostly burned, and the objective moves on to the crank', () => {
    const { ctx, runtime } = fixture();
    Object.assign(ctx.player, { x: 380, y: 314 });
    updateLivingExpedition(ctx);
    expect(livingObjective(ctx)).toBe('Burn through the barricade.');
    const barricade = runtime.mechanisms.find(m => m.id === WORKS_BARRICADE.id)!;
    barricade.body!.slice(0, Math.ceil(barricade.body!.length * .6)).forEach(([x, y]) => ctx.world.clearCellAt(ctx.world.idx(x, y)));
    const system = new Mechanisms(ctx);
    ctx.state.paused = false;
    for (let frame = 0; frame < 16; frame++) { ctx.state.frameCount = frame; system.update(ctx); }
    expect(barricade.state).toBe(1);
    expect(barricade.body!.some(([x, y]) => ctx.world.type(x, y) === Cell.Wood)).toBe(false);
    expect(livingObjective(ctx)).toBe('Pull the engine crank.');
    system.dispose();
  });

  it('names one short step at a time from crank to lower gate', () => {
    const { ctx, runtime } = fixture();
    Object.assign(ctx.player, { x: 424, y: 311 });
    runtime.mechanisms.find(m => m.id === WORKS_BARRICADE.id)!.state = 1;
    expect(livingObjective(ctx)).toBe('Pull the engine crank.');
    runtime.living!.tea = { stage: TEA_STAGE.FUSE, ticks: 10, stageTicks: 10, completed: false, stalled: false, bodies: [] };
    expect(livingObjective(ctx)).toBe('Follow the engine along the catwalk.');
    // The three stations built to stop: each names its verb as an order.
    runtime.living!.tea.stage = TEA_STAGE.SPARK;
    expect(livingObjective(ctx)).toBe('Shoot the priming pan.');
    runtime.living!.tea.stage = TEA_STAGE.KICK;
    expect(livingObjective(ctx)).toBe('Kick the Persuader.');
    runtime.living!.tea.stage = TEA_STAGE.POUR;
    expect(livingObjective(ctx)).toBe('Pour water into the duck’s bath.');
    runtime.living!.tea.stage = TEA_STAGE.MARBLE;
    expect(livingObjective(ctx)).toBe('Follow the engine along the catwalk.');
    runtime.living!.tea = { stage: TEA_COMPLETE_STAGE, ticks: 900, stageTicks: 1, completed: true, stalled: false, bodies: [] };
    expect(livingObjective(ctx)).toBe('Collect the brass bell.');
    runtime.keyTaken = true;
    expect(livingObjective(ctx)).toBe('Carry the bell to the lower gate.');
    runtime.living!.tea = { stage: 3, ticks: 900, stageTicks: 1, completed: false, stalled: true, bodies: [] };
    expect(livingObjective(ctx)).toBe('Recharge the engine at its crank.');
  });

  it('opens the Lower Bell floor grate only for the bell, sliding its real leaves into their slots', () => {
    const { ctx, runtime } = fixture();
    const metal = () => { let n = 0; for (let y = WORKS_GATE.leaves.y0; y <= WORKS_GATE.leaves.y1; y++) for (let x = WORKS_GATE.pit.x0 - WORKS_GATE.slot; x <= WORKS_GATE.pit.x1 + WORKS_GATE.slot; x++) if (ctx.world.type(x, y) === Cell.Metal) n++; return n; };
    const leaves = metal();
    Object.assign(ctx.player, { x: WORKS_GATE.x, y: WORKS_GATE.floor });
    for (let i = 0; i < 90; i++) updateLivingExpedition(ctx);
    expect(worksGateOpen(ctx.world)).toBe(false); // no bell, no gate
    runtime.living!.tea = { stage: TEA_COMPLETE_STAGE, ticks: 900, stageTicks: 1, completed: true, stalled: false, bodies: [] };
    runtime.keyTaken = true;
    const toast = vi.fn(); ctx.events.on('toast', toast);
    let opened = -1;
    for (let i = 0; i < 120 && opened < 0; i++) { updateLivingExpedition(ctx); if (worksGateOpen(ctx.world)) opened = i; }
    expect(opened).toBeGreaterThan(20); // it slides, it does not vanish
    expect(runtime.portal!.open).toBe(true);
    expect(toast).toHaveBeenCalledWith({ text: 'The bell rings in the lock. The lower gate opens.' });
    expect(metal()).toBe(leaves); // every bar went into a slot; none were deleted
    for (let y = WORKS_GATE.floor; y <= WORKS_GATE.pit.y1; y++) expect(ctx.world.type(WORKS_GATE.x, y)).toBe(Cell.Empty);
  });

  it('announces a room only after a grounded arrival, never while falling through it', () => {
    const { ctx, runtime } = fixture();
    const toast = vi.fn(); ctx.events.on('toast', toast);
    Object.assign(ctx.player, { x: 700, y: 400, grounded: false });
    for (let i = 0; i < 60; i++) updateLivingExpedition(ctx);
    expect(toast).not.toHaveBeenCalledWith({ text: 'Rillback Sluice' });
    Object.assign(ctx.player, { x: 700, y: 311, grounded: true }); // the engine catwalk over the sluice
    for (let i = 0; i < 60; i++) updateLivingExpedition(ctx);
    expect(toast).not.toHaveBeenCalledWith({ text: 'Rillback Sluice' });
    expect(worksPlaceName(700, 311)).toBe('The Bell & Tea Engine');
    Object.assign(ctx.player, { x: 700, y: 440, grounded: true });
    for (let i = 0; i < 30; i++) updateLivingExpedition(ctx);
    expect(toast).toHaveBeenCalledWith({ text: 'Rillback Sluice' });
    expect(runtime.living!.visited).toContain('sluice');
  });

  it('does not echo the room he arrives in: the place label and the floor title already name The Intake', () => {
    const { ctx, runtime } = fixture();
    const toast = vi.fn(); ctx.events.on('toast', toast);
    Object.assign(ctx.player, { x: 200, y: 314, grounded: true });
    for (let i = 0; i < 60; i++) updateLivingExpedition(ctx);
    expect(runtime.living!.visited).toEqual(['intake']); // arrived, noted, and not announced
    expect(toast).not.toHaveBeenCalledWith({ text: 'The Intake' });
    // The next room still gets its title.
    Object.assign(ctx.player, { x: 700, y: 440, grounded: true });
    for (let i = 0; i < 60; i++) updateLivingExpedition(ctx);
    expect(toast).toHaveBeenCalledWith({ text: 'Rillback Sluice' });
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
