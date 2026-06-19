import { describe, expect, it } from 'vitest';

import { LEVELS, populationForLevel } from '@/config/worldgraph';
import { EventBus } from '@/core/events';
import type { Critter, Ctx, Enemy, EnemyDef } from '@/core/types';
import { ENEMY_KINDS as BUILDER_ENEMY_KINDS, PATROL_KINDS } from '@/builder/inspectorSchemas';
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
    expect(ENEMY_DEFS.weaver).toMatchObject({ hp: 260, halfW: 9, h: 18 });

    expect(populationForLevel(LEVELS.d1, EXTRAS.earthen.foes).weaver ?? 0).toBe(0);
    expect(populationForLevel(LEVELS.d2, EXTRAS.fungal.foes).weaver).toBe(1);
    expect(populationForLevel(LEVELS.d5, EXTRAS.timber.foes).weaver).toBe(1);
    // Adding the Weaver's weight shifts the ROUNDED counts of the other timber
    // foes (weightSum 12 -> 12.25): pin the full d5 roster so that rebalance stays
    // intentional and any future silent drift is caught.
    expect(populationForLevel(LEVELS.d5, EXTRAS.timber.foes)).toMatchObject({
      imp: 18,
      slime: 13,
      bomber: 13,
      bat: 9,
      weaver: 1,
    });
    expect(LEVELS['weaver-test']).toMatchObject({
      id: 'weaver-test',
      biome: 'fungal',
      depth: 0,
      nextLevelId: null,
    });
  });

  it('keeps Builder enemy authoring in sync with runtime enemy definitions', () => {
    expect([...BUILDER_ENEMY_KINDS].sort()).toEqual(Object.keys(ENEMY_DEFS).sort());
    expect(PATROL_KINDS.has('weaver')).toBe(true);
  });

  it('explains thread spit through a launched live web strand without open-air anchors', () => {
    const world = new World(120, 80);
    const webShots: Array<{ x: number; y: number; dirX: number; dirY: number; length?: number; ashOnExpire?: boolean }> = [];
    const ctx = {
      world,
      audio: { squelch: () => undefined },
      particles: { burst: () => undefined },
      vineStrands: {
        addWebShot: (
          x: number,
          y: number,
          dirX: number,
          dirY: number,
          opts?: { length?: number; ashOnExpire?: boolean },
        ) => {
          webShots.push({ x, y, dirX, dirY, length: opts?.length, ashOnExpire: opts?.ashOnExpire });
        },
      },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const weaver = { kind: 'weaver', x: 20, y: 40, timer: 7 } as Enemy;

    (enemies as unknown as { weaveThread(e: Enemy, tx: number, ty: number): void }).weaveThread(weaver, 70, 35);

    let vines = 0;
    for (const t of world.types) if (t === Cell.Vines) vines++;
    expect(webShots).toHaveLength(1);
    expect(webShots[0]).toMatchObject({ x: 20.5, y: 30.5, ashOnExpire: true });
    expect(webShots[0].dirX).toBeCloseTo(0.995, 2);
    expect(webShots[0].dirY).toBeCloseTo(0.1, 2);
    expect(webShots[0].length).toBeGreaterThan(55);
    expect(vines).toBe(0);
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
    const world = new World(200, 140);
    const calls = {
      burst: 0,
      impulse: 0,
      scatter: 0,
      squelch: 0,
      tone: 0,
      webShot: 0,
    };
    const countVines = () => {
      let vines = 0;
      for (const t of world.types) if (t === Cell.Vines) vines++;
      return vines;
    };
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
      world,
      enemies: [sleeper],
      player: { x: 30, y: 80 },
      audio: {
        squelch: () => {
          calls.squelch++;
        },
        tone: () => {
          calls.tone++;
        },
      },
      particles: {
        burst: () => {
          calls.burst++;
        },
      },
      critters: {
        scatter: () => {
          calls.scatter++;
        },
      },
      vineStrands: {
        addWebShot: () => {
          calls.webShot++;
        },
        applyRadialImpulse: () => {
          calls.impulse++;
        },
      },
      camera: { x: 0, y: 0 },
      fx: { screenShake: 0 },
    } as unknown as Ctx;
    const _enemies = new Enemies(ctx);

    events.emit('structureStrike', { x: 500, y: 80, radius: 6 });
    expect(sleeper.sleeping).toBe(true);

    events.emit('structureStrike', { x: 112, y: 72, radius: 6 });
    expect(sleeper.sleeping).toBe(false);
    expect(sleeper.alerted).toBe(true);
    expect(sleeper.cranky).toBeGreaterThan(0);
    expect(sleeper.attackCd).toBeLessThan(120);
    expect(sleeper.webPulse).toBeGreaterThan(0);
    expect(sleeper.vx).toBeGreaterThan(0);
    expect(countVines()).toBe(0);
    expect(calls.webShot).toBe(1);
    expect(calls.scatter).toBe(1);
    expect(calls.impulse).toBe(1);
    expect(calls.squelch).toBeGreaterThan(0);
    expect(calls.tone).toBeGreaterThan(0);
    expect(calls.burst).toBeGreaterThanOrEqual(2);
    expect(ctx.fx.screenShake).toBeGreaterThan(0);

    world.clear();
    calls.burst = 0;
    calls.impulse = 0;
    calls.scatter = 0;
    calls.squelch = 0;
    calls.tone = 0;
    calls.webShot = 0;
    ctx.fx.screenShake = 0;
    sleeper.sleeping = true;
    sleeper.alerted = false;
    sleeper.cranky = 0;
    sleeper.webPulse = 0;
    sleeper.attackCd = 120;
    events.emit('groundImpact', { x: 74, y: 82, radius: 28, strength: 0.8 });
    expect(sleeper.sleeping).toBe(false);
    expect(sleeper.alerted).toBe(true);
    expect(sleeper.cranky).toBeGreaterThan(0);
    expect(sleeper.webPulse).toBeGreaterThan(0);
    expect(countVines()).toBe(0);
    expect(calls.webShot).toBe(1);
    expect(calls.scatter).toBe(1);
    expect(calls.impulse).toBe(1);
    expect(calls.squelch).toBeGreaterThan(0);
    expect(calls.burst).toBeGreaterThanOrEqual(2);
    expect(ctx.fx.screenShake).toBeGreaterThan(0);
  });
});
