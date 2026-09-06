import { describe, expect, it } from 'vitest';
import type { Ctx, Enemy } from '@/core/types';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { createDefaultStatus } from '@/entities/status';
import { ensureCreatureMind, tickCreatureMind } from '@/creatures/perception';
import { createChain, pointHitsCreature, tickChain } from '@/creatures/body';
import { tickCreaturePose } from '@/creatures/pose';
import { tickCreatureExpression } from '@/creatures/expression';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { drawEnemySprite } from '@/render/sprites/EnemySprites';
import type { LightField, PixelSurface } from '@/render/pixels';
import { reviveSavedEnemy, snapshotEnemyForSave } from '@/game/Levels';

function creature(kind: Enemy['kind'] = 'weaver'): Enemy {
  return { kind, x: 40, y: 64, fx: 0, fy: 0, vx: 0, vy: 0, hp: 58, maxHp: 58,
    flash: 0, timer: 0, attackCd: 0, bobPhase: 0, grounded: true, stride: 0, splat: 0,
    prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0, status: createDefaultStatus() };
}

describe('living creature perception', () => {
  it('loses sight behind a wall and investigates the observed position', () => {
    const world = new World(240, 120);
    const enemy = creature('golem');
    ensureCreatureMind(enemy, 7).facing = 1;
    const player = { x: 100, y: 64, vx: 1, dead: false, crouching: false, light: 1 };
    for (let tick = 0; tick <= 40; tick++) tickCreatureMind(world, enemy, player, [], tick, 7);
    expect(enemy.mind?.visible).toBe(true);
    for (let y = 0; y < world.height; y++) world.replaceCellAt(world.idx(75, y), Cell.Stone, 0);
    player.x = 180;
    for (let tick = 41; tick <= 65; tick++) tickCreatureMind(world, enemy, player, [], tick, 7);
    expect(enemy.mind?.visible).toBe(false);
    expect(enemy.mind?.targetX).toBe(100);
    expect(enemy.mind?.intent).toBe('investigate');
    for (let tick = 66; tick <= 520; tick++) tickCreatureMind(world, enemy, player, [], tick, 7);
    expect(enemy.mind?.confidence).toBe(0);
    expect(enemy.mind?.intent).toBe('forage');
  });

  it('a Stone Maw follows a vibration source, not a hidden player', () => {
    const world = new World(240, 120);
    const enemy = creature('stonemaw');
    for (let y = 0; y < world.height; y++) world.replaceCellAt(world.idx(60, y), Cell.Stone, 0);
    const mind = tickCreatureMind(world, enemy, { x: 210, y: 40, vx: 0, dead: false, crouching: true, light: 0 },
      [{ x: 130, y: 80, radius: 160, strength: 1, tick: 1, kind: 'vibration' }], 1, 7);
    expect(mind.visible).toBe(false);
    expect(mind.targetX).toBe(130);
    expect(mind.targetY).toBe(80);
    expect(mind.intent).toBe('investigate');
  });

  it('retains individual identity and satiation through a save without stale clock deadlines', () => {
    const enemy = creature();
    const mind = ensureCreatureMind(enemy, 123);
    mind.hunger = 0.12;
    mind.homeX = 85;
    mind.nextSense = 50000;
    const restored = reviveSavedEnemy(snapshotEnemyForSave(enemy));
    expect(restored.mind?.id).toBe(mind.id);
    expect(restored.mind?.hunger).toBe(0.12);
    expect(restored.mind?.homeX).toBe(85);
    expect(restored.mind?.nextSense).toBe(0);
  });
});

describe('articulated body and render ownership', () => {
  it('transmits a frozen tail contact back to the swimmer without stretching, then swims free after thawing', () => {
    const world = new World(240, 240), enemy = creature('rillback');
    enemy.x = 100; enemy.y = 84; enemy.body = createChain(100, 80); enemy.rillWet = 1;
    for (let y = 1; y < 239; y++) for (let x = 1; x < 239; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0);
    const tail = enemy.body.nodes.at(-1)!, tailX = tail.x, tailY = tail.y;
    for (let y = 77; y <= 83; y++) for (let x = 65; x <= 70; x++) world.replaceCellAt(world.idx(x, y), Cell.Ice, 0);
    const ctx = { world, state: { frameCount: 0 } } as unknown as Ctx;
    let maxLink = 0;
    const swim = (count: number) => {
      for (let tick = 0; tick < count; tick++) {
        enemy.vx = .65; enemy.vy = 1.3; enemy.fx += enemy.vx; enemy.fy += enemy.vy;
        ctx.state.frameCount++; tickCreaturePose(ctx, enemy);
        const nodes = enemy.body!.nodes;
        for (let i = 1; i < nodes.length; i++) maxLink = Math.max(maxLink, Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y));
        expect(enemy.x + enemy.fx).toBeCloseTo(nodes[0].x, 5);
        expect(enemy.y + enemy.fy - 4).toBeCloseTo(nodes[0].y, 5);
      }
    };
    swim(180);
    expect(maxLink).toBeLessThanOrEqual(4.24);
    expect(Math.hypot(tail.x - tailX, tail.y - tailY)).toBeLessThan(.1);
    expect(Math.hypot(enemy.body.nodes[0].x - tailX, enemy.body.nodes[0].y - tailY)).toBeLessThan(34);
    expect(Math.hypot(enemy.vx, enemy.vy)).toBeLessThan(.7);
    const trappedY = enemy.y + enemy.fy;
    for (let y = 77; y <= 83; y++) for (let x = 65; x <= 70; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0);
    swim(60);
    expect(enemy.y + enemy.fy).toBeGreaterThan(trappedY + 20);
    expect(maxLink).toBeLessThanOrEqual(4.24);
  });

  it('expresses remembered attention, feeding and injury without an omniscient target', () => {
    const enemy = creature('rillback'), mind = ensureCreatureMind(enemy, 7);
    mind.confidence = .8; mind.intent = 'investigate'; mind.targetX = -30; mind.targetY = 20;
    for (let tick = 0; tick < 40; tick++) tickCreatureExpression(enemy, tick);
    expect(enemy.expression!.gazeX).toBeLessThan(-.9);
    expect(enemy.expression!.gazeY).toBeLessThan(-.5);
    expect(enemy.expression!.alert).toBeGreaterThan(.5);
    enemy.rillFeedT = 60; mind.intent = 'rest'; enemy.hp = 20;
    for (let tick = 40; tick < 65; tick++) tickCreatureExpression(enemy, tick);
    expect(enemy.expression!.jaw).toBeGreaterThan(.1);
    expect(enemy.expression!.hurt).toBeGreaterThan(.5);
    mind.intent = 'retreat';
    for (let tick = 65; tick < 90; tick++) tickCreatureExpression(enemy, tick);
    expect(enemy.expression!.fear).toBeGreaterThan(.85);
  });

  it('keeps cosmetic blinking independent of the attack telegraph', () => {
    const a = creature('weaver'), b = creature('weaver');
    ensureCreatureMind(a, 7); ensureCreatureMind(b, 7); b.blink = 30;
    for (let tick = 0; tick < 240; tick++) {
      tickCreatureExpression(a, tick); tickCreatureExpression(b, tick);
      expect(b.expression).toEqual(a.expression);
    }
  });

  it('preserves anatomical shading during a Weaver hit flash', () => {
    const enemy = creature(); enemy.flash = 5;
    const ctx = { state: { frameCount: 42 }, world: new World(200, 120),
      enemyCtl: { defs: ENEMY_DEFS }, player: { x: 90, y: 60 },
      params: { global: { maxBrightness: 2 } } } as unknown as Ctx;
    ensureCreatureMind(enemy, 7); tickCreaturePose(ctx, enemy);
    const colors: number[] = [];
    const shades = new Set<string>();
    const surface = { setPx(_x: number, _y: number, r: number, g: number, b: number) {
      colors.push(r, g, b); shades.add(`${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)}`);
    }, addPx() {} } as unknown as PixelSurface;
    drawEnemySprite(surface, { sample: () => ({ r: 1, g: 1, b: 1 }) } as unknown as LightField, ctx, enemy);
    expect(Math.max(...colors)).toBeLessThan(1.2);
    expect(shades.size).toBeGreaterThan(8);
  });

  it('tail contact collides with terrain and participates in hit detection', () => {
    const world = new World(200, 120);
    for (let x = 0; x < world.width; x++) world.replaceCellAt(world.idx(x, 78), Cell.Stone, 0);
    const enemy = creature('rillback');
    enemy.x = 90;
    enemy.body = createChain(enemy.x, 62);
    for (let tick = 0; tick < 120; tick++) tickChain(world, enemy.body, 90, 64, false, tick);
    expect(enemy.body.nodes.slice(1).every((node) => node.y + node.radius < 79)).toBe(true);
    const tail = enemy.body.nodes.at(-1)!;
    expect(Math.abs(tail.x - enemy.x)).toBeGreaterThan(ENEMY_DEFS.rillback.halfW + tail.radius + 4);
    expect(pointHitsCreature(enemy, ENEMY_DEFS.rillback, tail.x, tail.y)).toBe(true);
    expect(pointHitsCreature(enemy, ENEMY_DEFS.rillback, 160, 40)).toBe(false);
  });

  it.each(['slime', 'bomber', 'golem', 'colossus', 'leviathan', 'rillback', 'rootloper', 'weaver'] as const)('repeated %s renders leave the complete pose unchanged', (kind) => {
    const enemy = creature(kind);
    const ctx = { state: { frameCount: 42 }, world: new World(200, 120),
      enemyCtl: { defs: ENEMY_DEFS }, player: { x: 90, y: 60 },
      params: { global: { maxBrightness: 2 } } } as unknown as Ctx;
    ensureCreatureMind(enemy, 7);
    tickCreaturePose(ctx, enemy);
    const before = JSON.stringify(enemy);
    const surface = { setPx() {}, addPx() {} } as unknown as PixelSurface;
    const light = { sample: () => ({ r: 1, g: 1, b: 1 }) } as unknown as LightField;
    for (let i = 0; i < 8; i++) drawEnemySprite(surface, light, ctx, enemy);
    expect(JSON.stringify(enemy)).toBe(before);
  });
});
