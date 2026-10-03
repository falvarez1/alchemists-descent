import { describe, expect, test } from 'vitest';
import { STOCK_STAGE } from '@/config/stockStage';
import { BasicBrain } from '@/arena/ai/brains/basic';
import { createPlayer } from '@/entities/Player';
import type { BrainSelf } from '@/arena/ai/brain';
import type { Ctx } from '@/core/types';

describe('stock CPU recovery input', () => {
  test('waits for the action lock before pressing recovery so the last stun tick cannot consume the edge', () => {
    const player = createPlayer(); Object.assign(player, { x: STOCK_STAGE.main.x1 + 53, y: STOCK_STAGE.main.y - 4, grounded: false, stunT: 1 });
    const keys = { left: false, right: false, up: false, down: false, jump: false, wallJump: false, grab: false };
    const self = { slot: 0, player, input: { keys }, hands: {} } as unknown as BrainSelf;
    let locked = true;
    const ctx = { params: { player: { groundStopDecay: .7 } }, physics: { entityFree: () => true },
      arena: { stockMatch: {}, stockLedge: () => null, canRecover: () => true, isActionLocked: () => locked },
    } as unknown as Ctx;
    const brain = new BasicBrain({ level: 3, seed: 43, slot: 0 });
    brain.think(ctx, self, 100);
    expect(keys.jump).toBe(true); expect(keys.up).toBe(false);
    locked = false; player.stunT = 0; brain.think(ctx, self, 101);
    expect(keys.jump).toBe(true); expect(keys.up).toBe(true);
    expect(player.x).toBe(STOCK_STAGE.main.x1 + 53); expect(player.y).toBe(STOCK_STAGE.main.y - 4);
  });
});
