import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, LevelRuntime } from '@/core/types';
import { PlayerControl, createPlayer } from '@/entities/Player';
import { World } from '@/sim/World';

describe('player death economy', () => {
  it('spills 15 percent of carried gold as recoverable pickups', () => {
    const player = createPlayer();
    player.x = 100;
    player.y = 120;
    player.hp = 1;
    const runtime = { pickups: [] } as unknown as LevelRuntime;
    const events = new EventBus();
    const scores: number[] = [];
    events.on('scoreChanged', ({ score }) => scores.push(score));
    const ctx = {
      player,
      world: new World(),
      state: { score: 200, mode: 'play' },
      levels: { current: runtime },
      events,
      waves: { num: 1 },
      particles: { burst: () => undefined },
      audio: { squelch: () => undefined, boom: () => undefined },
      fx: { screenShake: 0 },
    } as unknown as Ctx;

    new PlayerControl(ctx).kill();

    expect(ctx.state.score).toBe(170);
    expect(scores).toEqual([170]);
    expect(runtime.pickups.reduce((sum, p) => sum + (p.data.amount ?? 0), 0)).toBe(30);
    expect(runtime.pickups.every((p) => p.kind === 'goldpile')).toBe(true);
  });

  it('does not create zero-value gold pickups on low-gold deaths', () => {
    const player = createPlayer();
    player.x = 100;
    player.y = 120;
    player.hp = 1;
    const runtime = { pickups: [] } as unknown as LevelRuntime;
    const ctx = {
      player,
      world: new World(),
      state: { score: 13, mode: 'play' },
      levels: { current: runtime },
      events: new EventBus(),
      waves: { num: 1 },
      particles: { burst: () => undefined },
      audio: { squelch: () => undefined, boom: () => undefined },
      fx: { screenShake: 0 },
    } as unknown as Ctx;

    new PlayerControl(ctx).kill();

    expect(ctx.state.score).toBe(12);
    expect(runtime.pickups).toHaveLength(1);
    expect(runtime.pickups[0].data.amount).toBe(1);
  });
});
