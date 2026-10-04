import { describe, expect, test } from 'vitest';
import { stockNav } from '@/arena/ai/nav';
import { STOCK_STAGE } from '@/config/stockStage';
import { PLAYER_HALF_W } from '@/core/types';
import { BasicBrain } from '@/arena/ai/brains/basic';

describe('stock platform navigation', () => {
  test('recognizes fighters supported by either edge of every platform', () => {
    const nav = stockNav();
    for (const [index, platform] of [STOCK_STAGE.main, ...STOCK_STAGE.platforms].entries()) {
      const id = index === 0 ? 'floor' : `side${index - 1}`;
      for (const x of [platform.x0 - PLAYER_HALF_W + 1, platform.x0, platform.x1 - 1, platform.x1 + PLAYER_HALF_W - 1]) {
        expect(nav.nodeAt(x, platform.y - 1)?.id, `supported feet at ${x}`).toBe(id);
      }
    }
  });

  test('routes from either upper lip to an opponent on the opposite lip', () => {
    const nav = stockNav(), [left, right] = STOCK_STAGE.platforms, top = left.y - 1;
    // The inner lips of the two raised platforms, both ways (derived from the stage, not its old coordinates).
    for (const [fromX, toX] of [[left.x1 - 1, right.x0], [right.x1 - 1, left.x0]]) {
      const from = nav.nodeAt(fromX, top), to = nav.nodeAt(toX, top);
      expect(from).not.toBeNull(); expect(to).not.toBeNull();
      expect(nav.route(from!.id, to!.id)?.map(edge => edge.to)).toEqual(['floor', to!.id]);
    }
    // Open air between the raised platforms and beyond their outer lips is no surface.
    expect(nav.nodeAt(STOCK_STAGE.center.x, top)).toBeNull();
    expect(nav.nodeAt(left.x0 - 30, top)).toBeNull();
  });

  test('lingering world damage does not abandon a crossing on every damage tick', () => {
    const brain = new BasicBrain({ level: 5, seed: 43, slot: 1 });
    const crossing = { action: 'lip', context: '0:side1>side0:13', started: 100 };
    brain.status.navigation = crossing;
    for (let tick = 100; tick < 160; tick += 2) {
      brain.observeHit({ by: 1, victim: 1, damage: .0042, attack: 'world', tick });
      expect(brain.status.navigation).toBe(crossing);
    }
    brain.observeHit({ by: 0, victim: 1, damage: 12, attack: 'melee.opener', tick: 160 });
    expect(brain.status.navigation).toBeNull();
  });
});
