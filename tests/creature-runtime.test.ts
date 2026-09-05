import { describe, expect, it } from 'vitest';
import type { Ctx, Enemy } from '@/core/types';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { createDefaultStatus } from '@/entities/status';
import { ensureCreatureMind, tickCreatureMind } from '@/creatures/perception';
import { createChain, pointHitsCreature, tickChain } from '@/creatures/body';
import { tickCreaturePose } from '@/creatures/pose';
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
