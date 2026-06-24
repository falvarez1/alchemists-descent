import { describe, expect, it } from 'vitest';

import type { Enemy } from '@/core/types';
import { enemyLethalCell, enemyStateLabel } from '@/entities/Enemies';
import { createDefaultStatus } from '@/entities/status';
import { Cell } from '@/sim/CellType';

function enemy(over: Partial<Enemy> = {}): Enemy {
  return { kind: 'slime', status: createDefaultStatus(), ...over } as Enemy;
}

describe('enemyLethalCell (wary look-ahead = env-damage rule)', () => {
  it('fire and lava are lethal to most, but not the imp', () => {
    expect(enemyLethalCell('slime', Cell.Lava)).toBe(true);
    expect(enemyLethalCell('slime', Cell.Fire)).toBe(true);
    expect(enemyLethalCell('imp', Cell.Lava)).toBe(false);
    expect(enemyLethalCell('imp', Cell.Fire)).toBe(false);
  });

  it('acid is lethal except to the acidslime; toxic/water/stone are safe', () => {
    expect(enemyLethalCell('slime', Cell.Acid)).toBe(true);
    expect(enemyLethalCell('acidslime', Cell.Acid)).toBe(false);
    expect(enemyLethalCell('slime', Cell.Toxic)).toBe(false);
    expect(enemyLethalCell('slime', Cell.Water)).toBe(false);
    expect(enemyLethalCell('slime', Cell.Stone)).toBe(false);
  });
});

describe('enemyStateLabel', () => {
  it('reports the dominant AI state', () => {
    expect(enemyStateLabel(enemy())).toBe('idle');
    expect(enemyStateLabel(enemy({ alerted: true }))).toBe('hunting');
    expect(enemyStateLabel(enemy({ patrol: [[0, 0]] }))).toBe('patrolling');
    expect(enemyStateLabel(enemy({ wary: 10 }))).toBe('wary');
    expect(enemyStateLabel(enemy({ status: { ...createDefaultStatus(), burning: 20 } }))).toBe('panicking');
    expect(enemyStateLabel(enemy({ status: { ...createDefaultStatus(), frozen: 20 } }))).toBe('frozen');
    expect(enemyStateLabel(enemy({ status: { ...createDefaultStatus(), electrified: 20 } }))).toBe('shocked');
    expect(enemyStateLabel(enemy({ kind: 'bat', slimed: 120 }))).toBe('slimed');
    // launched (knockback) outranks the rest
    expect(enemyStateLabel(enemy({ knockT: 5, status: { ...createDefaultStatus(), frozen: 9 } }))).toBe('launched');
  });
});
