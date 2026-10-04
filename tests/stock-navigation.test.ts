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
    const nav = stockNav();
    for (const [fromX, toX] of [[699, 900], [1059, 540]]) {
      const from = nav.nodeAt(fromX, 559), to = nav.nodeAt(toX, 559);
      expect(from).not.toBeNull(); expect(to).not.toBeNull();
      expect(nav.route(from!.id, to!.id)?.map(edge => edge.to)).toEqual(['floor', to!.id]);
    }
    expect(nav.nodeAt(800, 559)).toBeNull();
    expect(nav.nodeAt(530, 559)).toBeNull();
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
