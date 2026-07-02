import { describe, expect, it } from 'vitest';
import type { Ctx, Enemy, WeaverIntent } from '@/core/types';
import { ENEMY_DEFS } from '@/entities/Enemies';
import { tickWeaverLocomotion, WEAVER_LEG_REACH_LOCO } from '@/entities/weaverLocomotion';
import { drawEnemySprite } from '@/render/sprites/EnemySprites';
import type { LightField, PixelSurface } from '@/render/pixels';
import { blocksEntity, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

// The Weaver is a SURFACE CRAWLER: one tick-rate model owns body, orientation
// and load-bearing feet (entities/weaverLocomotion). These tests drive the real
// locomotion against real World cells — floors, ceilings, walls, chimneys —
// and lock in the movement contract the renderer merely draws.

function fill(world: World, x0: number, x1: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x777777);
    }
  }
}

function makePhysics(world: World): {
  cellBlocks: (x: number, y: number) => boolean;
  entityFree: (cx: number, cy: number, halfW: number, h: number) => boolean;
  tryMoveEntity: (
    ent: { x: number; y: number },
    dx: number,
    dy: number,
    halfW: number,
    h: number,
    stepUp: number,
    slip?: number,
  ) => boolean;
  crushLooseDebris: () => void;
} {
  const blocks = (x: number, y: number): boolean => {
    if (x < 0 || x >= world.width || y >= world.height) return true;
    if (y < 0) return false;
    return blocksEntity(world.types[world.idx(x, y)]);
  };
  const free = (cx: number, cy: number, halfW: number, h: number): boolean => {
    for (let dx = -halfW; dx <= halfW; dx++) {
      for (let dy = 0; dy < h; dy++) {
        if (blocks(cx + dx, cy - dy)) return false;
      }
    }
    return true;
  };
  return {
    cellBlocks: blocks,
    entityFree: free,
    tryMoveEntity: (ent, dx, dy, halfW, h, stepUp, slip = 0) => {
      if (dy !== 0) {
        if (free(ent.x, ent.y + dy, halfW, h)) {
          ent.y += dy;
          return true;
        }
        for (let s = 1; s <= slip; s++) {
          if (free(ent.x + s, ent.y + dy, halfW, h)) {
            ent.x += s;
            ent.y += dy;
            return true;
          }
          if (free(ent.x - s, ent.y + dy, halfW, h)) {
            ent.x -= s;
            ent.y += dy;
            return true;
          }
        }
        return false;
      }
      if (free(ent.x + dx, ent.y, halfW, h)) {
        ent.x += dx;
        return true;
      }
      for (let s = 1; s <= stepUp; s++) {
        if (free(ent.x + dx, ent.y - s, halfW, h)) {
          ent.x += dx;
          ent.y -= s;
          return true;
        }
      }
      return false;
    },
    crushLooseDebris: () => {},
  };
}

function makeCtx(world: World): Ctx {
  return {
    world,
    physics: makePhysics(world),
    debug: { dragRef: null },
  } as unknown as Ctx;
}

function baseWeaver(x: number, y: number): Enemy {
  return {
    kind: 'weaver', x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: 260, maxHp: 260, flash: 0,
    timer: 20, attackCd: 0, bobPhase: 0, grounded: true, stride: 0, splat: 0, prevG: true,
    blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: { burning: 0, wet: 0, oiled: 0, frozen: 0, electrified: 0, toxic: 0 },
    alerted: false, sleeping: false,
  } as unknown as Enemy;
}

const HOLD: WeaverIntent = { move: 'hold', tx: 0, ty: 0, urgency: 0, stance: 'normal' };

function settle(ctx: Ctx, e: Enemy, ticks: number, intent: WeaverIntent = HOLD): void {
  const def = ENEMY_DEFS.weaver;
  for (let t = 0; t < ticks; t++) tickWeaverLocomotion(ctx, e, def, intent);
}

describe('Weaver locomotion: attachment + orientation', () => {
  it('settles onto a floor: attached, orient ~0, most legs planted', () => {
    const world = new World(320, 220);
    fill(world, 20, 300, 130, 140);
    const ctx = makeCtx(world);
    const e = baseWeaver(160, 126);
    settle(ctx, e, 120);
    expect(e.weaverLoco?.mode).toBe('attached');
    expect(Math.abs(e.weaverOrient ?? 9)).toBeLessThan(0.4);
    const planted = e.weaverLoco?.legs.filter((l) => l.planted).length ?? 0;
    expect(planted).toBeGreaterThanOrEqual(5);
    // the body rides above the surface, not inside it
    expect(e.y).toBeLessThanOrEqual(131);
  });

  it('hangs under a ceiling: attached, orient ~±π', () => {
    const world = new World(320, 220);
    fill(world, 20, 300, 96, 106);
    const ctx = makeCtx(world);
    const e = baseWeaver(160, 122);
    e.weaverLoco = undefined;
    // drop it just below the slab — the airborne catch must grab the underside
    settle(ctx, e, 140);
    expect(e.weaverLoco?.mode).toBe('attached');
    expect(Math.abs(Math.abs(e.weaverOrient ?? 0) - Math.PI)).toBeLessThan(0.7);
  });

  it('grips a sheer wall: attached, orient ~±π/2', () => {
    const world = new World(320, 220);
    fill(world, 172, 300, 20, 200);
    const ctx = makeCtx(world);
    const e = baseWeaver(163, 110);
    settle(ctx, e, 140);
    expect(e.weaverLoco?.mode).toBe('attached');
    expect(Math.abs(Math.abs(e.weaverOrient ?? 0) - Math.PI / 2)).toBeLessThan(0.7);
  });

  it('pins upright in a chimney (feet straddle both walls) and holds still', () => {
    const world = new World(320, 220);
    fill(world, 130, 145, 20, 200); // left wall
    fill(world, 175, 190, 20, 200); // right wall
    const ctx = makeCtx(world);
    const e = baseWeaver(160, 110);
    settle(ctx, e, 140);
    expect(e.weaverLoco?.mode).toBe('attached');
    // no-spasm contract: holding still must not oscillate the body
    let maxDelta = 0;
    let prev = e.weaverOrient ?? 0;
    for (let t = 0; t < 40; t++) {
      settle(ctx, e, 1);
      const cur = e.weaverOrient ?? 0;
      maxDelta = Math.max(maxDelta, Math.abs(cur - prev));
      prev = cur;
    }
    expect(maxDelta).toBeLessThan(0.05);
  });
});

describe('Weaver locomotion: crawling', () => {
  it('crawls a floor toward a target', () => {
    const world = new World(420, 220);
    fill(world, 10, 410, 130, 140);
    const ctx = makeCtx(world);
    const e = baseWeaver(80, 126);
    settle(ctx, e, 60);
    const startX = e.x;
    settle(ctx, e, 240, { move: 'toward', tx: 360, ty: 120, urgency: 0.8, stance: 'normal' });
    expect(e.x - startX).toBeGreaterThan(90);
    // legs stay within their real reach of the body the whole way
    const maxLeg = (e.weaverLoco?.legs ?? []).reduce(
      (m, l) => Math.max(m, Math.hypot(l.x - e.x, l.y - (e.y - 9))),
      0,
    );
    expect(maxLeg).toBeLessThan(Math.max(...WEAVER_LEG_REACH_LOCO) * 1.6);
  });

  it('climbs a wall to a quarry overhead — the same crawl, no special case', () => {
    const world = new World(320, 260);
    fill(world, 10, 310, 200, 210); // floor
    fill(world, 190, 310, 60, 210); // massive step: wall face at x=190, top at y=60
    const ctx = makeCtx(world);
    const e = baseWeaver(120, 196);
    settle(ctx, e, 60);
    // quarry sits on top of the step, past the lip
    settle(ctx, e, 900, { move: 'toward', tx: 240, ty: 50, urgency: 0.9, stance: 'normal' });
    expect(e.weaverLoco?.mode).toBe('attached');
    // it must have gone UP the face — well above the floor line
    expect(e.y).toBeLessThan(160);
  });

  it('walks around the lip of a platform onto its underside (contour wrap)', () => {
    const world = new World(320, 220);
    fill(world, 40, 200, 100, 112); // a thick platform with open air all around
    const ctx = makeCtx(world);
    const e = baseWeaver(120, 96); // standing on top
    settle(ctx, e, 80);
    expect(e.weaverLoco?.mode).toBe('attached');
    // target hangs BELOW the platform near its far end: the only route is around the lip
    settle(ctx, e, 900, { move: 'toward', tx: 120, ty: 150, urgency: 0.9, stance: 'normal' });
    // ends up under the slab (below its underside), still attached
    expect(e.weaverLoco?.mode).toBe('attached');
    expect(e.y).toBeGreaterThan(112);
  });

  it('detaches and falls when the surface under it is destroyed, then re-attaches below', () => {
    const world = new World(320, 220);
    fill(world, 20, 300, 100, 104); // upper platform
    fill(world, 20, 300, 190, 200); // ground far below
    const ctx = makeCtx(world);
    const e = baseWeaver(160, 96);
    settle(ctx, e, 80);
    expect(e.weaverLoco?.mode).toBe('attached');
    // cut the platform out from under it
    for (let y = 100; y <= 104; y++) {
      for (let x = 20; x <= 300; x++) world.clearCellAt(world.idx(x, y));
    }
    settle(ctx, e, 200);
    expect(e.weaverLoco?.mode).toBe('attached');
    expect(e.y).toBeGreaterThan(170); // it really fell to the ground
  });
});

describe('Weaver render: draws the tick-owned rig sanely', () => {
  it('never draws screen-length legs (all pixels near the body)', () => {
    const world = new World(320, 220);
    fill(world, 40, 220, 124, 134);
    const ctx = makeCtx(world);
    const e = baseWeaver(120, 120);
    settle(ctx, e, 100);

    const writes: Array<[number, number]> = [];
    const surface: PixelSurface = {
      setPx: (x, y) => writes.push([x, y]),
      addPx: (x, y) => writes.push([x, y]),
    };
    const light = { sample: () => ({ r: 1, g: 1, b: 1 }) } as unknown as LightField;
    const drawCtx = {
      state: { frameCount: 120 },
      params: { global: { maxBrightness: 1 } },
      enemyCtl: { defs: ENEMY_DEFS },
      player: { x: 130, y: 70, dead: false },
      world,
    } as unknown as Ctx;
    drawEnemySprite(surface, light, drawCtx, e);
    const maxPixelDistance = writes.reduce(
      (max, [x, y]) => Math.max(max, Math.hypot(x - e.x, y - e.y)),
      0,
    );
    expect(writes.length).toBeGreaterThan(30);
    expect(maxPixelDistance).toBeLessThan(125);
  });
});
