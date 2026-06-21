import { describe, expect, it } from 'vitest';
import type { Ctx, Enemy, WeaverLegState } from '@/core/types';
import { ENEMY_DEFS } from '@/entities/Enemies';
import { drawEnemySprite } from '@/render/sprites/EnemySprites';
import type { LightField, PixelSurface } from '@/render/pixels';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

function makeWeaverLeg(x: number, y: number): WeaverLegState {
  return {
    x,
    y,
    tx: x,
    ty: y,
    lift: 0,
    planted: true,
    strain: 0,
    surface: 'floor',
    failT: 0,
    plantAge: 60,
    smoothTx: x,
    smoothTy: y,
    stepCooldown: 0,
  };
}

describe('Weaver sprite IK', () => {
  it('does not draw screen-length legs from stale far-away foot state', () => {
    const world = new World(320, 220);
    for (let x = 40; x <= 220; x++) {
      for (let y = 124; y <= 128; y++) {
        world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x777777);
      }
    }

    const writes: Array<[number, number]> = [];
    const surface: PixelSurface = {
      setPx: (x, y) => writes.push([x, y]),
      addPx: (x, y) => writes.push([x, y]),
    };
    const light = {
      sample: () => ({ r: 1, g: 1, b: 1 }),
    } as unknown as LightField;
    const ctx = {
      state: { frameCount: 120 },
      params: { global: { maxBrightness: 1 } },
      enemyCtl: { defs: ENEMY_DEFS },
      player: { x: 130, y: 70, dead: false },
      world,
    } as unknown as Ctx;
    const enemy = {
      kind: 'weaver',
      x: 120,
      y: 120,
      fx: 0,
      fy: 0,
      vx: 0,
      vy: 0,
      hp: 260,
      maxHp: 260,
      flash: 0,
      timer: 20,
      attackCd: 0,
      bobPhase: 0,
      grounded: true,
      stride: 0,
      splat: 0,
      prevG: true,
      blink: 0,
      jetFuel: 0,
      jetCd: 0,
      stuckT: 0,
      status: { burning: 0, wet: 0, poisoned: 0, frozen: 0, electrified: 0 },
      alerted: true,
      weaverSupport: 1,
      weaverPhysicalSupport: 1,
      weaverAnchorCount: 8,
      weaverLegs: Array.from({ length: 8 }, () => makeWeaverLeg(295, 26)),
    } as Enemy;

    drawEnemySprite(surface, light, ctx, enemy);

    const maxPixelDistance = writes.reduce((max, [x, y]) => Math.max(max, Math.hypot(x - enemy.x, y - enemy.y)), 0);
    const maxStateDistance = (enemy.weaverLegs ?? []).reduce(
      (max, leg) => Math.max(max, Math.hypot(leg.x - enemy.x, leg.y - enemy.y)),
      0,
    );
    expect(maxPixelDistance).toBeLessThan(125);
    expect(maxStateDistance).toBeLessThan(105);
  });
});
