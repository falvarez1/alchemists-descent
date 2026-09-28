import { describe, expect, it, vi } from 'vitest';
import type { Critter, Ctx, Enemy } from '@/core/types';
import { advanceRootLash, feedRillback, rillbackPrey } from '@/creatures/ecology';
import { ensureCreatureMind } from '@/creatures/perception';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

function habitat() {
  const world = new World(200, 120);
  const enemy = { kind: 'rillback', x: 50, y: 70, vx: 1, vy: .2, hp: 50, maxHp: 50, attackCd: 0, rillWet: 1 } as Enemy;
  const mind = ensureCreatureMind(enemy, 777); mind.intent = 'forage'; mind.hunger = .8;
  const prey = { id: 12, kind: 'fish', x: 60, y: 66 } as Critter;
  const list = [prey];
  for (let y = 40; y < 95; y++) for (let x = 20; x < 160; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0);
  const ctx = { world, state: { frameCount: 90 }, critters: { list, remove: (p: Critter) => list.splice(list.indexOf(p), 1) },
    player: { x: 90, y: 70, dead: false }, playerCtl: { damage: vi.fn() } } as unknown as Ctx;
  return { ctx, enemy, prey, list };
}

describe('resident predation', () => {
  it('pursues only reachable fish in actual water and leaves them alive until contact', () => {
    const { ctx, enemy, prey, list } = habitat();
    expect(rillbackPrey(ctx, enemy)).toBe(prey);
    expect(feedRillback(ctx, enemy, prey)).toBe(false);
    expect(list).toEqual([prey]);
    for (let y = 0; y < ctx.world.height; y++) ctx.world.replaceCellAt(ctx.world.idx(55, y), Cell.Stone, 0);
    expect(rillbackPrey(ctx, enemy)).toBeNull();
    ctx.world.clearCell(55, 66); ctx.world.clearCell(Math.round(prey.x), Math.round(prey.y));
    expect(rillbackPrey(ctx, enemy)).toBeNull();
  });

  it('consumes an existing resident once and commits to a digestion rest', () => {
    const { ctx, enemy, prey, list } = habitat();
    prey.x = 54;
    expect(feedRillback(ctx, enemy, prey)).toBe(true);
    expect(list).toHaveLength(0);
    expect(enemy.mind?.intent).toBe('rest');
    expect(enemy.mind?.hunger).toBeLessThan(.1);
    expect(enemy.mind?.commitUntil).toBeGreaterThan(ctx.state.frameCount);
    expect(enemy.rillFeedT).toBeGreaterThan(0);
    expect(feedRillback(ctx, enemy, prey)).toBe(false);
  });
});

describe('committed tendril attack', () => {
  it('hits only at full extension and pushes the player away', () => {
    const { ctx, enemy } = habitat();
    Object.assign(enemy, { kind: 'rootloper', rootLashT: 10, rootLashX: 90, rootLashY: 61 });
    for (let tick = 0; tick < 4; tick++) advanceRootLash(ctx, enemy);
    expect(ctx.playerCtl.damage).not.toHaveBeenCalled();
    advanceRootLash(ctx, enemy);
    expect(ctx.playerCtl.damage).toHaveBeenCalledWith(13, 3.2, -1.8, 'rootloper-lash');
    for (let tick = 0; tick < 5; tick++) advanceRootLash(ctx, enemy);
    expect(ctx.playerCtl.damage).toHaveBeenCalledTimes(1);
    expect(enemy.rootLashX).toBeUndefined();
  });

  it('can be dodged after commitment and cannot strike through a new wall', () => {
    const { ctx, enemy } = habitat();
    Object.assign(enemy, { rootLashT: 6, rootLashX: 90, rootLashY: 61 });
    ctx.player.x = 105;
    advanceRootLash(ctx, enemy);
    expect(ctx.playerCtl.damage).not.toHaveBeenCalled();
    enemy.rootLashT = 6; ctx.player.x = 90;
    for (let y = 0; y < ctx.world.height; y++) ctx.world.replaceCellAt(ctx.world.idx(75, y), Cell.Stone, 0);
    advanceRootLash(ctx, enemy);
    expect(ctx.playerCtl.damage).not.toHaveBeenCalled();
  });
});
