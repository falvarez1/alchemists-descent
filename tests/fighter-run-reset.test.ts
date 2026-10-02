import { describe, expect, it } from 'vitest';
import { FIGHTER_ORDER } from '@/content/fighters';
import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import { createPlayer } from '@/entities/Player';
import { FighterSystem } from '@/fighters/FighterSystem';
import { Levels } from '@/game/Levels';

describe('fighter run reset', () => {
  it.each(FIGHTER_ORDER)('restores Alchemist defaults and reapplies %s scaling only once', (id) => {
    const ctx = {
      player: createPlayer(), events: new EventBus(), state: { frameCount: 0 }, enemies: [],
      input: { keys: {} }, critters: { clear: () => undefined },
      flask: { clearSlots: () => undefined }, waves: {}, wands: { resetLoadout: () => undefined },
    } as unknown as Ctx;
    const fighters = new FighterSystem(ctx, () => undefined);
    ctx.fighters = fighters;
    const levels = new Levels(ctx);
    const defaults = createPlayer();
    try {
      fighters.equip(id);
      const first = { hp: ctx.player.maxHp, fuel: ctx.player.maxLevit };
      for (let repeat = 0; repeat < 2; repeat++) {
        (levels as unknown as { resetRunState(c: Ctx, options: { clearSave: boolean }): void }).resetRunState(ctx, { clearSave: false });
        expect(fighters.id).toBeNull();
        expect(ctx.player.hp).toBe(defaults.hp);
        expect(ctx.player.maxHp).toBe(defaults.maxHp);
        expect(ctx.player.maxLevit).toBe(defaults.maxLevit);
        fighters.equip(id);
        expect(ctx.player.maxHp).toBe(first.hp);
        expect(ctx.player.maxLevit).toBeCloseTo(first.fuel);
      }
    } finally {
      fighters.dispose();
      levels.dispose();
    }
  });
});
