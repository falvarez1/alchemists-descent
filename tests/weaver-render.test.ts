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

describe('Weaver body orientation', () => {
  // The body rotates so its legs point at whatever surface they grip: ~0 on a floor,
  // ~±π/2 on a wall, ~±π under a ceiling. The angle is derived from the planted feet
  // (a PCA line-fit of the foot cloud), so it works for any surface — and even when
  // the AI isn't running (Debug Freeze + Drag). These lock that mapping in CI.
  function makeCtx(world: World, enemy: Enemy): Ctx {
    const surface: PixelSurface = { setPx: () => {}, addPx: () => {} };
    const light = { sample: () => ({ r: 1, g: 1, b: 1 }) } as unknown as LightField;
    const ctx = {
      state: { frameCount: 120, mode: 'play' },
      params: { global: { maxBrightness: 1 } },
      enemyCtl: { defs: ENEMY_DEFS },
      player: { x: enemy.x, y: enemy.y, dead: false },
      world,
    } as unknown as Ctx;
    // settle: let the legs find footholds and the orientation spring converge
    for (let f = 0; f < 80; f++) drawEnemySprite(surface, light, ctx, enemy);
    return ctx;
  }
  function baseWeaver(x: number, y: number): Enemy {
    return {
      kind: 'weaver', x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: 260, maxHp: 260, flash: 0,
      timer: 20, attackCd: 0, bobPhase: 0, grounded: true, stride: 0, splat: 0, prevG: true,
      blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
      status: { burning: 0, wet: 0, poisoned: 0, frozen: 0, electrified: 0 },
      alerted: false, sleeping: false,
      weaverSupport: 1, weaverPhysicalSupport: 1, weaverAnchorCount: 8,
    } as Enemy;
  }

  it('stays upright on a floor (orient ~0)', () => {
    const world = new World(320, 220);
    for (let x = 20; x < 300; x++) for (let y = 130; y <= 140; y++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x777777);
    const e = baseWeaver(160, 129);
    makeCtx(world, e);
    expect(Math.abs(e.weaverOrient ?? 0)).toBeLessThan(0.4);
  });

  it('flips upside-down under a ceiling (orient ~±π)', () => {
    const world = new World(320, 220);
    // a ceiling slab with open air below; the body hangs clear beneath it (its drawn
    // height is ~17, so the anchor sits well below the slab) and the legs sweep UP to
    // grip the underside via the ring-search foothold fallback.
    for (let x = 20; x < 300; x++) for (let y = 96; y <= 106; y++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x777777);
    const e = baseWeaver(160, 132);
    makeCtx(world, e);
    expect(Math.abs(Math.abs(e.weaverOrient ?? 0) - Math.PI)).toBeLessThan(0.7);
  });

  it('rotates onto a wall it grips with no AI climb state (orient ~±π/2)', () => {
    const world = new World(320, 220);
    // a sheer wall on the body's right, no floor in reach: the only purchase is the
    // wall, so the legs grip it and the body squares onto it — the Debug-drag case.
    for (let x = 172; x < 300; x++) for (let y = 20; y < 200; y++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x777777);
    const e = baseWeaver(162, 110);
    e.grounded = false;
    makeCtx(world, e);
    expect(Math.abs(Math.abs(e.weaverOrient ?? 0) - Math.PI / 2)).toBeLessThan(0.7);
  });
});
