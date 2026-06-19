import { describe, expect, it } from 'vitest';

import { LEVELS, populationForLevel } from '@/config/worldgraph';
import { EventBus } from '@/core/events';
import type { Critter, Ctx, Enemy, EnemyDef } from '@/core/types';
import { Enemies, ENEMY_DEFS } from '@/entities/Enemies';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { EXTRAS } from '@/world/biomeExtras';

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

describe('weaver encounter contract', () => {
  it('adds the Weaver as a sparse fungal and timber elite', () => {
    expect(ENEMY_DEFS.weaver).toMatchObject({ hp: 260, halfW: 12, h: 18 });

    expect(populationForLevel(LEVELS.d1, EXTRAS.earthen.foes).weaver ?? 0).toBe(0);
    expect(populationForLevel(LEVELS.d2, EXTRAS.fungal.foes).weaver).toBe(1);
    expect(populationForLevel(LEVELS.d5, EXTRAS.timber.foes).weaver).toBe(1);
    expect(LEVELS['weaver-test']).toMatchObject({
      id: 'weaver-test',
      biome: 'fungal',
      depth: 0,
      nextLevelId: null,
    });
  });

  it('explains thread spit through real vine cells', () => {
    const world = new World(120, 80);
    const ctx = {
      world,
      audio: { squelch: () => undefined },
      particles: { burst: () => undefined },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const weaver = { kind: 'weaver', x: 20, y: 40, timer: 7 } as Enemy;

    (enemies as unknown as { weaveThread(e: Enemy, tx: number, ty: number): void }).weaveThread(weaver, 70, 35);

    let vines = 0;
    for (const t of world.types) if (t === Cell.Vines) vines++;
    expect(vines).toBeGreaterThan(10);
  });

  it('feeds on nearby ambient cave life when not pressuring the player', () => {
    const prey: Critter = {
      kind: 'moth',
      x: 24,
      y: 32,
      vx: 0,
      vy: 0,
      phase: 0,
      gasp: 0,
      facing: 1,
    };
    const critters = [prey];
    const ctx = {
      critters: {
        list: critters,
        remove: (critter: Critter) => {
          const index = critters.indexOf(critter);
          if (index >= 0) return critters.splice(index, 1)[0];
          return undefined;
        },
      },
      audio: { squelch: () => undefined },
      particles: { burst: () => undefined },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const weaver = {
      kind: 'weaver',
      x: 20,
      y: 40,
      hp: 200,
      maxHp: 260,
      attackCd: 0,
      weaverSupport: 1,
    } as Enemy;

    const fed = (enemies as unknown as { weaverFeed(e: Enemy): boolean }).weaverFeed(weaver);

    expect(fed).toBe(true);
    expect(critters).toHaveLength(0);
    expect(weaver.hp).toBeGreaterThan(200);
    expect(weaver.recoil).toBeGreaterThan(0);
  });

  it('wakes cranky when a nearby stomp or structure hit disturbs its sleep', () => {
    const events = new EventBus();
    const sleeper = {
      kind: 'weaver',
      x: 100,
      y: 80,
      vx: 0,
      vy: 0,
      sleeping: true,
      alerted: false,
      blink: 0,
      attackCd: 120,
    } as Enemy;
    const ctx = {
      events,
      enemies: [sleeper],
      player: { x: 30, y: 80 },
      audio: { tone: () => undefined },
      particles: { burst: () => undefined },
    } as unknown as Ctx;
    const _enemies = new Enemies(ctx);

    events.emit('structureStrike', { x: 500, y: 80, radius: 6 });
    expect(sleeper.sleeping).toBe(true);

    events.emit('structureStrike', { x: 112, y: 72, radius: 6 });
    expect(sleeper.sleeping).toBe(false);
    expect(sleeper.alerted).toBe(true);
    expect(sleeper.cranky).toBeGreaterThan(0);
    expect(sleeper.attackCd).toBeLessThan(120);

    sleeper.sleeping = true;
    sleeper.alerted = false;
    sleeper.cranky = 0;
    sleeper.attackCd = 120;
    events.emit('groundImpact', { x: 74, y: 82, radius: 28, strength: 0.8 });
    expect(sleeper.sleeping).toBe(false);
    expect(sleeper.alerted).toBe(true);
    expect(sleeper.cranky).toBeGreaterThan(0);
  });
});
