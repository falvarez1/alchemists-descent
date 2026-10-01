import { describe, expect, it } from 'vitest';

import { LEVELS } from '@/config/worldgraph';
import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import { HintSystem } from '@/game/Hints';
import { makeLevelRuntime } from '@/game/runtime';
import { World } from '@/sim/World';

/**
 * The player's "Teaching cards" option (ui/PlayerSettings -> state.hintMode):
 *  first  - each lesson once, ever (the shipped behaviour)
 *  always - each lesson once per FLOOR
 *  off    - none, and nothing is spent, so switching back still teaches
 */
function harness(hintMode?: 'first' | 'always' | 'off'): { ctx: Ctx; hints: HintSystem; taught: string[]; tick(n: number): void; bench(): void } {
  const world = new World(400, 300);
  const events = new EventBus();
  const taught: string[] = [];
  events.on('hintTeach', ({ key }) => taught.push(key));
  const runtime = makeLevelRuntime({ world, def: LEVELS.d2, spawn: { x: 200, y: 150 } });
  const ctx = {
    world,
    events,
    state: { mode: 'play', paused: false, frameCount: 1000, hintMode },
    player: { x: 200, y: 150, dead: false },
    enemies: [],
    levels: { current: runtime },
    wands: { collection: [], wands: [] },
    flask: { state: null },
  } as unknown as Ctx;
  const hints = new HintSystem(ctx);
  return {
    ctx, hints, taught,
    tick(n: number) { for (let i = 0; i < n; i++) { ctx.state.frameCount++; hints.update(ctx); } },
    bench() { events.emit('benchOpened'); },
  };
}

describe('Teaching cards: first time only (the default)', () => {
  it('teaches a lesson once and never again, floors notwithstanding', () => {
    for (const mode of [undefined, 'first'] as const) {
      const h = harness(mode);
      h.tick(200);
      h.bench(); h.tick(100);
      expect(h.taught).toEqual(['wand-sentence']);
      h.tick(800); h.bench(); h.tick(100);
      h.ctx.events.emit('levelChanged', { depth: 3, name: 'Deeper' });
      h.tick(800); h.bench(); h.tick(100);
      // (a new floor also teaches its own first lesson, the map; the wand lesson is not repeated)
      expect(h.taught.filter((key) => key === 'wand-sentence')).toHaveLength(1);
    }
  });
});

describe('Teaching cards: every floor', () => {
  it('re-teaches once per floor, not once per visit to the object', () => {
    const h = harness('always');
    h.tick(200);
    h.bench(); h.tick(100);
    expect(h.taught).toEqual(['wand-sentence']);
    h.tick(800); h.bench(); h.tick(100); // same floor: already shown on it
    expect(h.taught).toEqual(['wand-sentence']);
    h.ctx.events.emit('levelChanged', { depth: 3, name: 'Deeper' });
    h.tick(800); h.bench(); h.tick(100); // a new floor: the lesson comes round again
    expect(h.taught.filter((key) => key === 'wand-sentence')).toHaveLength(2);
    expect(h.taught).not.toContain('flask-siphoned');
  });
});

describe('Teaching cards: off', () => {
  it('shows nothing, spends nothing, and drops anything queued', () => {
    const h = harness('off');
    h.tick(200);
    h.ctx.events.emit('worldInteractionObserved', { id: 'x', title: 'X', x: 0, y: 0 });
    h.bench(); h.tick(1500);
    expect(h.taught).toEqual([]);
    // Turned back on, the same lessons are still unspent.
    h.ctx.state.hintMode = 'first';
    h.bench(); h.tick(100);
    expect(h.taught).toEqual(['wand-sentence']);
  });
});

describe('Reset tutorials', () => {
  it('makes every lesson teach again in the same session', () => {
    const h = harness('first');
    h.tick(200);
    h.bench(); h.tick(100);
    h.tick(800); h.bench(); h.tick(100);
    expect(h.taught).toEqual(['wand-sentence']);
    h.hints.resetTaught();
    h.tick(800); h.bench(); h.tick(100);
    expect(h.taught).toEqual(['wand-sentence', 'wand-sentence']);
  });
});
