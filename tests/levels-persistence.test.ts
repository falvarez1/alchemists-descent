import { describe, expect, it } from 'vitest';
import type { Ctx, Enemy, LevelRuntime } from '@/core/types';
import { createDefaultStatus } from '@/entities/status';
import { Levels, reviveSavedEnemy, snapshotEnemyForSave } from '@/game/Levels';
import { makeLevelRuntime } from '@/game/runtime';
import { World } from '@/sim/World';

function enemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    kind: 'bat',
    x: 120,
    y: 80,
    fx: 0,
    fy: 0,
    vx: 0,
    vy: 0,
    hp: 9,
    maxHp: 16,
    flash: 0,
    timer: 17,
    attackCd: 12,
    bobPhase: 1.5,
    grounded: false,
    stride: 0,
    splat: 0,
    prevG: false,
    blink: 0,
    jetFuel: 0,
    jetCd: 0,
    stuckT: 0,
    status: createDefaultStatus(),
    ...overrides,
  };
}

describe('level enemy persistence', () => {
  it('round-trips behavior state used by roosts, patrols, and enemy attacks', () => {
    const saved = snapshotEnemyForSave(
      enemy({
        sleeping: true,
        alerted: true,
        patrol: [
          [10, 20],
          [30, 40],
        ],
        patrolIdx: 1,
        calmT: 83,
        recoil: 6,
        fusing: 45,
        punching: 9,
        windup: 4,
        swoop: 7,
        tumble: 2,
        submerged: true,
        dmgK: 1.4,
      }),
    );

    const revived = reviveSavedEnemy(saved);

    expect(revived.sleeping).toBe(true);
    expect(revived.alerted).toBe(true);
    expect(revived.patrol).toEqual([
      [10, 20],
      [30, 40],
    ]);
    expect(revived.patrolIdx).toBe(1);
    expect(revived.calmT).toBe(83);
    expect(revived.recoil).toBe(6);
    expect(revived.fusing).toBe(45);
    expect(revived.punching).toBe(9);
    expect(revived.windup).toBe(4);
    expect(revived.swoop).toBe(7);
    expect(revived.tumble).toBe(2);
    expect(revived.submerged).toBe(true);
    expect(revived.timer).toBe(17);
    expect(revived.attackCd).toBe(12);
    expect(revived.bobPhase).toBe(1.5);
    expect(revived.dmgK).toBe(1.4);
  });

  it('deep-copies patrol paths across save and restore', () => {
    const source = enemy({ patrol: [[1, 2]], patrolIdx: 0 });
    const saved = snapshotEnemyForSave(source);
    source.patrol![0][0] = 99;

    const revived = reviveSavedEnemy(saved);
    revived.patrol![0][1] = 77;

    expect(saved.patrol).toEqual([[1, 2]]);
    expect(revived.patrol).toEqual([[1, 77]]);
  });

  it('exiting a custom playtest restores the previous expedition pointer', () => {
    const world = new World();
    const ctx = {
      world,
      enemies: [],
      projectiles: [],
      state: {
        currentBiome: 'earthen',
        debugGodMode: false,
        worldSeed: 123,
      },
      player: {
        x: 10,
        y: 20,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
      },
      playerCtl: {
        findSpawnPoint: () => ({ x: 10, y: 20 }),
      },
      camera: {
        snapTo: () => undefined,
      },
      events: {
        emit: () => undefined,
      },
    } as unknown as Ctx;
    const levels = new Levels(ctx);
    const prior = makeLevelRuntime({
      def: { id: 'd1', name: 'Depth 1', biome: 'earthen', depth: 1, nextLevelId: null },
      world,
      enemies: [],
      spawn: { x: 10, y: 20 },
      regions: null,
    });
    const internals = levels as unknown as {
      currentId: string | null;
      levels: Map<string, LevelRuntime>;
    };
    internals.levels.set('d1', prior);
    internals.currentId = 'd1';

    levels.playCurrentWorld(ctx);
    expect(levels.current?.def.id).toBe('custom');

    levels.exitCustomPlaytest(ctx);
    expect(levels.current?.def.id).toBe('d1');
  });
});
