import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { World } from '@/sim/World';
import { blocksEntity, Cell } from '@/sim/CellType';
import { AMBIENT_FOLIAGE_LIFE, foliageBurnLife, foliageBurnState } from '@/config/foliage';
import { updateSurfaceFoliage, visibleSurfaceFoliage } from '@/game/SurfaceFoliage';
import { dressSurfaceFoliage } from '@/world/surfaceFoliage';
import { visitSurfaceFronds } from '@/world/foliageGeometry';

function garden() {
  const world = new World(700, 400), spawn = vi.fn();
  world.replaceCellAt(world.idx(126, 150), Cell.Moss, 0x447744);
  world.life[world.idx(126, 150)] = AMBIENT_FOLIAGE_LIFE;
  world.replaceCellAt(world.idx(126, 151), Cell.Stone, 0x667777);
  const ctx = { world, levels: { current: { living: {} } }, state: { frameCount: 0, mode: 'play' },
    camera: { renderX: 0, renderY: 0 }, player: { x: 500, y: 150, vx: 0, dead: false },
    enemies: [], projectiles: [], particles: { list: [], spawn } } as unknown as Ctx;
  const tick = (count: number) => { for (let i = 0; i < count; i++) { ctx.state.frameCount++; updateSurfaceFoliage(ctx); } };
  const plant = () => visibleSurfaceFoliage(ctx).find(p => p.x === 126 && p.y === 150)!;
  tick(1);
  return { ctx, world, tick, plant, spawn };
}

describe('Current-cell surface foliage', () => {
  it('parts around a passing body, retains momentum and settles after it leaves', () => {
    const { ctx, tick, plant } = garden();
    ctx.player.x = 121; ctx.player.vx = 2; tick(14);
    expect(plant().angle).toBeGreaterThan(.15);
    expect(plant().part).toBeGreaterThan(.2);
    const before = plant().angle; ctx.player.x = 131; tick(1);
    expect(Math.abs(plant().angle - before)).toBeLessThan(.15);
    ctx.player.x = 500; ctx.player.vx = 0; tick(150);
    expect(Math.abs(plant().angle)).toBeLessThan(.08);
    expect(plant().part).toBeLessThan(.04);
  });

  it('catches a fast body sweeping through a tuft without moving its root', () => {
    const { ctx, tick, plant } = garden();
    ctx.player.x = 144; ctx.player.vx = 36; tick(1);
    expect(plant().velocity).toBeGreaterThan(.02);
    expect(plant().x).toBe(126); expect(plant().y).toBe(150);
  });

  it('keeps repeated renders read-only and does not react to a distant body', () => {
    const { tick, plant, ctx } = garden(); tick(12);
    const before = { ...plant() };
    for (let i = 0; i < 20; i++) visibleSurfaceFoliage(ctx);
    expect(plant()).toEqual(before);
    expect(plant().part).toBe(0);
  });

  it('smoulders on a visible leaf touch, leaves ash and does not restore the crown', () => {
    const { world, tick, plant, ctx, spawn } = garden();
    let tip = { x: 0, y: 0 };
    visitSurfaceFronds(plant(), (_ax, _ay, bx, by) => { tip = { x: bx, y: by }; });
    world.replaceCellAt(world.idx(Math.floor(tip.x), Math.floor(tip.y)), Cell.Ember, 0);
    tick(1); expect(plant().burning).toBe(true);
    expect(foliageBurnState(world.life[world.idx(126, 150)]).fuel).toBe(5);
    world.clearCell(Math.floor(tip.x), Math.floor(tip.y));
    tick(100);
    expect(world.type(126, 150)).toBe(Cell.Ash);
    expect(visibleSurfaceFoliage(ctx)).toHaveLength(0);
    expect(spawn).toHaveBeenCalled();
  });

  it('quenches on water and keeps the charred state in the saved life plane', () => {
    const { world, tick, plant } = garden();
    world.life[world.idx(126, 150)] = foliageBurnLife(3, 30);
    tick(1); expect(plant().burning).toBe(true);
    world.replaceCellAt(world.idx(126, 149), Cell.Water, 0);
    tick(1); expect(plant().burning).toBe(false);
    expect(plant().burn).toBeGreaterThan(.3);
    expect(world.life[world.idx(126, 150)]).toBeGreaterThan(-100);
    expect(world.life[world.idx(126, 150)]).toBeLessThan(-10);
  });

  it('removes dressing when its real root is cut, including a cached chunk', () => {
    const { world, ctx, tick } = garden(); world.activity.beginStep(world);
    expect(visibleSurfaceFoliage(ctx)).toHaveLength(1);
    world.clearCell(126, 150); tick(1);
    expect(visibleSurfaceFoliage(ctx)).toHaveLength(0);
  });

  it('resumes the saved burn age and remaining transmission budget', () => {
    const { world, tick, plant } = garden();
    world.life[world.idx(126, 150)] = foliageBurnLife(2, 65);
    tick(1);
    expect(plant().burn).toBeGreaterThan(.7);
    expect(foliageBurnState(world.life[world.idx(126, 150)])).toMatchObject({ fuel: 2, age: 66 });
    tick(25); expect(world.type(126, 150)).toBe(Cell.Ash);
  });
});

describe('Additional real moss and vines', () => {
  function rocks() {
    const world = new World(400, 240);
    for (let x = 12; x < 388; x++) for (const y of [20, 150, 220]) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0);
    return world;
  }

  it('adds deterministic dormant damp roots and supported vine clusters without changing body paths', () => {
    const a = rocks(), b = rocks(), before = a.types.slice();
    dressSurfaceFoliage(a, 42, 'earthen'); dressSurfaceFoliage(b, 42, 'earthen');
    expect(a.types).toEqual(b.types); expect(a.life).toEqual(b.life);
    expect([...a.types].filter(t => t === Cell.Moss).length).toBeGreaterThan(30);
    expect([...a.types].filter(t => t === Cell.Vines).length).toBeGreaterThan(20);
    for (let i = 0; i < a.types.length; i++) {
      expect(blocksEntity(a.types[i])).toBe(blocksEntity(before[i]));
      if (a.types[i] === Cell.Moss || a.types[i] === Cell.Vines) expect(a.life[i]).toBe(AMBIENT_FOLIAGE_LIFE);
    }
  });

  it('keeps reserved puzzle and fixture footprints free of the new dressing', () => {
    const world = rocks(); dressSurfaceFoliage(world, 42, 'earthen', [{ x: 200, y: 150, radius: 28 }]);
    for (let y = 122; y <= 178; y++) for (let x = 172; x <= 228; x++) {
      expect([Cell.Moss, Cell.Vines]).not.toContain(world.type(x, y));
    }
  });
});
