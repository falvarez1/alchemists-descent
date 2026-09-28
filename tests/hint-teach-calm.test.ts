import { describe, expect, it } from 'vitest';

import { LEVELS } from '@/config/worldgraph';
import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import { HintSystem } from '@/game/Hints';
import { makeLevelRuntime } from '@/game/runtime';
import { World } from '@/sim/World';

/**
 * QA (P1): teach popovers talked over centre beats — "The Flask" on the Tea
 * Engine's caption card, "The Map" 0.4 s into the floor-2 title card. The
 * overlay (ui/HintTeachOverlay) holds the HintSystem while a beat is on screen;
 * a held lesson waits UNSPENT and fires at the next calm moment.
 */
function harness(): { ctx: Ctx; hints: HintSystem; taught: string[]; tick(n: number): void } {
  const world = new World(400, 300);
  const events = new EventBus();
  const taught: string[] = [];
  events.on('hintTeach', ({ key }) => taught.push(key));
  const runtime = makeLevelRuntime({ world, def: LEVELS.d2, spawn: { x: 200, y: 150 } });
  const ctx = {
    world,
    events,
    state: { mode: 'play', paused: false, frameCount: 1000 },
    player: { x: 200, y: 150, dead: false },
    enemies: [],
    levels: { current: runtime },
    wands: { collection: [], wands: [] },
    flask: { state: null },
  } as unknown as Ctx;
  const hints = new HintSystem(ctx);
  return {
    ctx,
    hints,
    taught,
    tick(n: number) {
      for (let i = 0; i < n; i++) {
        ctx.state.frameCount++;
        hints.update(ctx);
      }
    },
  };
}

describe('teach popovers yield to centre beats', () => {
  it('a lesson that arrives during a beat waits for the calm, then fires once', () => {
    const h = harness();
    h.hints.setTeachHeld(true); // e.g. the engine caption card is up
    h.ctx.events.emit('worldInteractionObserved', { id: 'x', title: 'X', x: 0, y: 0 });
    h.tick(600);
    expect(h.taught).toEqual([]); // held, not spent
    h.hints.setTeachHeld(false);
    h.tick(20);
    expect(h.taught).toEqual([]); // the screen settles first
    h.tick(60);
    expect(h.taught).toEqual(['grimoire-observed']);
    h.tick(600);
    expect(h.taught).toEqual(['grimoire-observed']);
  });

  it('arriving on a floor holds lessons past the title card’s rise', () => {
    const h = harness();
    h.ctx.events.emit('levelChanged', { depth: 2, name: 'The Rot Gardens' });
    h.tick(60); // ~1 s in: the title card is about to rise
    expect(h.taught).not.toContain('map-open');
    h.hints.setTeachHeld(true); // the title card is up (3.6 s)
    h.tick(216);
    h.hints.setTeachHeld(false);
    h.tick(100);
    expect(h.taught).toContain('map-open');
  });

  it('a living warded boss nearby holds lessons until it falls', () => {
    const h = harness();
    const boss = { kind: 'colossus', hp: 500, x: 320, y: 150 };
    (h.ctx.enemies as unknown as Array<typeof boss>).push(boss);
    h.ctx.events.emit('worldInteractionObserved', { id: 'x', title: 'X', x: 0, y: 0 });
    h.tick(900);
    expect(h.taught).toEqual([]); // "The Grimoire Watches" never rises over the fight
    boss.hp = 0;
    h.tick(20);
    expect(h.taught).toEqual(['grimoire-observed']);
  });
});

describe('hint lines', () => {
  it('a new floor clears the line the floor behind left up', () => {
    const h = harness();
    const runtime = h.ctx.levels.current!;
    runtime.portal = { x: 204, y: 150, open: true } as typeof runtime.portal;
    h.tick(4);
    expect(h.hints.current?.key).toBe('portal');
    h.ctx.state.paused = true; // the Sanctum: no update runs, nothing recomputes
    h.ctx.events.emit('levelChanged', { depth: 3, name: 'The Drowned Cisterns' });
    expect(h.hints.current).toBeNull();
  });

  it('the flask line retires once the player has siphoned for real', () => {
    const h = harness();
    h.ctx.world.types[h.ctx.world.idx(203, 151)] = 2; // Water, within reach
    h.tick(4);
    expect(h.hints.current?.key).toBe('flask');
    h.ctx.events.emit('flaskUsed', { verb: 'siphon', material: 2, amount: 0 });
    h.tick(4);
    expect(h.hints.current?.key).toBe('flask'); // a dry siphon teaches nothing
    h.ctx.events.emit('flaskUsed', { verb: 'siphon', material: 2, amount: 6 });
    h.tick(4);
    expect(h.hints.current).toBeNull();
  });
});
