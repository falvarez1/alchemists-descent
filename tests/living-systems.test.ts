import { describe, expect, it } from 'vitest';
import { RenderPoses } from '@/render/RenderPoses';
import { bodyRouteClear, localRoute } from '@/creatures/navigation';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { DEFAULT_BINDINGS, sanitizeBindings } from '@/input/bindings';
import { restoreFauna, restoreLiving } from '@/game/persistence/ecology';
import type { Enemy, EnemyDef } from '@/core/types';

describe('presentation and habitat boundaries', () => {
  it('interpolates without modifying bodies and snaps discontinuous teleports', () => {
    const poses = new RenderPoses(), body = { x: 10, y: 20 };
    poses.capture(body); body.x = 14;
    expect(poses.offset(body, 'x', 0.5)).toBe(-2);
    expect(body).toEqual({ x: 14, y: 20 });
    body.x = 300;
    expect(poses.offset(body, 'x', 0.5)).toBe(0);
  });
  it('rejects duplicate/reserved remaps and accepts deliberate swaps', () => {
    expect(sanitizeBindings({ left: 'KeyD' })).toEqual(DEFAULT_BINDINGS);
    expect(sanitizeBindings({ jump: 'KeyM' })).toEqual(DEFAULT_BINDINGS);
    expect(sanitizeBindings({ left: 'KeyD', right: 'KeyA' })).toMatchObject({ left: 'KeyD', right: 'KeyA' });
  });
  it('keeps absent and extinguished habitats distinct and bounds corrupt residents', () => {
    expect(restoreFauna(undefined)).toBeUndefined();
    expect(restoreFauna([])).toEqual([]);
    expect(restoreFauna([{ id: 'a', kind: 'fish', x: NaN, y: 10 }])).toEqual([]);
    const fish = { id: 'a', kind: 'fish', x: 20, y: 30, vx: 1e10, vy: 0 };
    const saved = restoreFauna([fish, fish])!;
    expect(saved).toHaveLength(1); expect(saved[0].vx).toBe(8);
  });
  it('sanitizes dwell/lures without losing the persistent pressure phase', () => {
    const living = restoreLiving({ ticks: 4100, visited: ['sluice', 'sluice', 'bogus'], glowseeds: 900,
      restTicks: 119, lures: [{ x: 10, y: 20, vx: Infinity, life: 99999 }] });
    expect(living.ticks).toBe(4100); expect(living.visited).toEqual(['sluice']);
    expect(living.glowseeds).toBe(3); expect(living.restTicks).toBe(0);
    expect(living.lures[0]).toMatchObject({ life: 1800, vx: 0 });
  });
  it('finds a body-sized detour with bounded work and invalidates after excavation', () => {
    const world = new World(240, 180);
    for (let y = 45; y <= 105; y++) world.replaceCellAt(world.idx(100, y), Cell.Stone, 0);
    world.activity.beginStep(world);
    const e = { x: 80, y: 80 } as Enemy;
    const def = { halfW: 2, h: 4 } as EnemyDef;
    expect(bodyRouteClear(world, 80, 80, 130, 80, 2, 4)).toBe(false);
    const route = localRoute(world, e, def, 130, 80, 0);
    expect(route.visited).toBeLessThanOrEqual(192);
    expect(bodyRouteClear(world, e.x, e.y, route.x, route.y, 2, 4)).toBe(true);
    for (let y = 70; y <= 90; y++) world.clearCellAt(world.idx(100, y));
    const opened = localRoute(world, e, def, 130, 80, 40);
    expect(opened.x).toBe(130); expect(opened.visited).toBe(0);
  });
});
