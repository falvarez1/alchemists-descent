import { describe, expect, it } from 'vitest';

import type { Ctx, Enemy, EnemyDef } from '@/core/types';
import { Enemies, ENEMY_DEFS } from '@/entities/Enemies';

describe('enemy bounty economy', () => {
  it('splits non-multiple bounties into exact-value homing coins', () => {
    const values: number[] = [];
    const ctx = {
      state: { mode: 'play', score: 0 },
      particles: {
        spawn: (
          _x: number,
          _y: number,
          _vx: number,
          _vy: number,
          _type: number | null,
          _color: number,
          _life: number,
          opts?: { value?: number },
        ) => {
          values.push(opts?.value ?? 10);
        },
      },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    (enemies as unknown as { dropBounty(e: Enemy, def: EnemyDef): void }).dropBounty(
      { x: 10, y: 20 } as Enemy,
      ENEMY_DEFS.bat,
    );

    expect(values.reduce((sum, value) => sum + value, 0)).toBe(ENEMY_DEFS.bat.bounty);
    expect(values).toHaveLength(2);
  });
});
