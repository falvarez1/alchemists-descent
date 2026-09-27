import { afterEach, describe, expect, it } from 'vitest';
import type { Ctx, Enemy, EnemyKind } from '@/core/types';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { createDefaultStatus } from '@/entities/status';
import { makeWeaverLoco, WEAVER_LEG_REACH_LOCO, weaverHipWorld } from '@/entities/weaverLocomotion';
import { addCorpse, capBonds, clearCorpses, updateCorpses } from '@/creatures/corpses';
import { circleFree, createChain, createChainIn, tickChain } from '@/creatures/body';
import { weaverSilhouetteOverlap } from '@/creatures/weaverAnatomy';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';

function creature(kind: EnemyKind, x: number, y: number): Enemy {
  const def = ENEMY_DEFS[kind];
  return { kind, x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0, timer: 0, attackCd: 60,
    bobPhase: 0.4, grounded: true, stride: 0, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: createDefaultStatus() };
}

function fill(world: World, x0: number, y0: number, x1: number, y1: number, type: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.replaceCellAt(world.idx(x, y), type, 0x555555);
}

function killAndSettle(world: World, e: Enemy, ticks = 300): void {
  const ctx = { world, state: { frameCount: 0, mode: 'play' }, enemyCtl: { defs: ENEMY_DEFS },
    player: { x: -999, y: -999 } } as unknown as Ctx;
  expect(addCorpse(ctx, e, 0, 0)).toBe(true);
  for (let t = 1; t <= ticks; t++) { ctx.state.frameCount = t; updateCorpses(ctx); }
}

afterEach(() => clearCorpses());

describe('creature remains rest on the grid', () => {
  it('a dead Weaver lands on a one-cell plank as its whole body, not down the crack beneath its centre', () => {
    const world = new World(220, 160);
    fill(world, 0, 100, 219, 100, Cell.Metal);
    fill(world, 108, 100, 110, 100, Cell.Empty); // a crack far narrower than the body
    fill(world, 0, 150, 219, 159, Cell.Stone);
    const e = creature('weaver', 110, 60); e.weaverLoco = makeWeaverLoco(110, 60);
    killAndSettle(world, e);
    const loco = e.weaverLoco;
    expect(weaverSilhouetteOverlap(world, loco.px, loco.py, loco.nx, loco.ny, loco.face)).toBe(0);
    expect(loco.py).toBeLessThan(100);
    // Its anchor sits on the plank's surface, and it has kicked over onto its back.
    expect(e.y).toBeGreaterThanOrEqual(98); expect(e.y).toBeLessThanOrEqual(100);
    expect(loco.ny).toBeGreaterThan(0.9);
  });

  it('remains killed half inside a wall work their way out and down to the floor, never deeper', () => {
    const world = new World(220, 160);
    fill(world, 0, 120, 219, 159, Cell.Stone);
    fill(world, 118, 0, 219, 119, Cell.Stone); // wall the body was pressed into
    const e = creature('weaver', 112, 80); e.weaverLoco = makeWeaverLoco(112, 80);
    const loco = e.weaverLoco;
    expect(weaverSilhouetteOverlap(world, loco.px, loco.py, loco.nx, loco.ny, loco.face)).toBeGreaterThan(0);
    killAndSettle(world, e);
    expect(weaverSilhouetteOverlap(world, loco.px, loco.py, loco.nx, loco.ny, loco.face)).toBe(0);
    expect(e.y).toBeGreaterThanOrEqual(118); expect(e.y).toBeLessThanOrEqual(120);
  });

  it('a spine buried in sand is dragged out by its head; no link ever exceeds its give', () => {
    // The reported bug: a Stone Maw's own chew spoil settled on its body,
    // every node was welded in place, and the head walked on — one link
    // drawn as a 40-cell glowing bar.
    const world = new World(240, 120);
    fill(world, 0, 81, 239, 119, Cell.Stone);
    const body = createChain(100, 77, 1, 7);
    for (let t = 0; t < 30; t++) tickChain(world, body, 100, 77, false, t);
    fill(world, 60, 66, 92, 80, Cell.Sand); // bury everything behind the head
    let worst = 0;
    for (let t = 0; t < 60; t++) {
      tickChain(world, body, 100 + t, 77, false, 30 + t);
      for (let i = 1; i < body.nodes.length; i++) {
        worst = Math.max(worst, Math.hypot(body.nodes[i].x - body.nodes[i - 1].x, body.nodes[i].y - body.nodes[i - 1].y));
      }
    }
    expect(worst).toBeLessThanOrEqual(body.spacing * 1.5 + 1e-9);
    expect(Math.hypot(body.nodes[6].x - body.nodes[0].x, body.nodes[6].y - body.nodes[0].y)).toBeLessThan(6 * body.spacing * 1.25);
  });

  it('an embedded node is never pushed deeper or sinks while its link is slack', () => {
    const world = new World(200, 120);
    fill(world, 0, 81, 199, 119, Cell.Stone);
    const body = createChain(100, 77, 1, 5);
    for (let t = 0; t < 30; t++) tickChain(world, body, 100, 77, false, t);
    const tail = body.nodes[4], y0 = tail.y;
    fill(world, Math.floor(tail.x) - 1, Math.floor(tail.y) - 1, Math.floor(tail.x) + 1, Math.floor(tail.y) + 1, Cell.Sand);
    for (let t = 30; t < 120; t++) tickChain(world, body, 100, 77, false, t);
    expect(tail.y).toBeLessThanOrEqual(y0 + 1e-9);
  });

  it('a creature spawned facing out of a wall lays its spine along open ground instead', () => {
    const world = new World(200, 120);
    fill(world, 0, 81, 199, 119, Cell.Stone);
    fill(world, 0, 0, 94, 80, Cell.Stone); // rock right behind a creature facing +x
    const body = createChainIn(world, 100, 76, 1, 7);
    expect(body.nodes.every(node => circleFree(world, node.x, node.y, node.radius))).toBe(true);
    expect(body.nodes[6].x).toBeGreaterThan(100);
  });
});

describe('dead limbs keep their length', () => {
  it('a Weaver falling dead down a shaft narrower than its legs never stretches them up the walls', () => {
    // The reported bug: feet buried in the shaft walls were pushed straight
    // UP out of the rock every tick while the body fell, so each foot climbed
    // the wall and two legs ended up drawn from the floor to the ceiling.
    for (const width of [34, 40, 50]) { // the body fits; the legs (reach 38-57) do not
      clearCorpses();
      const world = new World(220, 320);
      fill(world, 0, 0, 219, 319, Cell.Stone);
      const x0 = 110 - (width >> 1), x1 = x0 + width - 1;
      fill(world, x0, 4, x1, 299, Cell.Empty); // the shaft
      const e = creature('weaver', 110, 24); e.weaverLoco = makeWeaverLoco(110, 24);
      const ctx = { world, state: { frameCount: 0, mode: 'play' }, enemyCtl: { defs: ENEMY_DEFS },
        player: { x: -999, y: -999 } } as unknown as Ctx;
      expect(addCorpse(ctx, e, 0, 0)).toBe(true);
      const loco = e.weaverLoco;
      let worst = 0;
      for (let t = 1; t <= 400; t++) {
        ctx.state.frameCount = t; updateCorpses(ctx);
        loco.legs.forEach((leg, i) => {
          if (leg.missing) return;
          const hip = weaverHipWorld(loco, i);
          worst = Math.max(worst, Math.hypot(leg.x - hip.x, leg.y - hip.y) / WEAVER_LEG_REACH_LOCO[i]);
        });
      }
      expect(loco.py).toBeGreaterThan(200); // it really fell the shaft
      expect(worst).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('a limp bond snagged on terrain is capped at 1.5x its rest length and loses its velocity', () => {
    const a = { x: 0, y: 0, px: 0, py: 0, r: 0.4, hit: 0, wet: 0 };
    const b = { x: 0, y: 40, px: 0, py: 38, r: 0.4, hit: 0, wet: 0 };
    capBonds([[a, b, 4]]);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(6, 9);
    expect(b.px).toBe(b.x); expect(b.py).toBe(b.y);
  });
});
