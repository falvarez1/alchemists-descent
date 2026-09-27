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
});
