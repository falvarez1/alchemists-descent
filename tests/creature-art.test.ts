import { describe, expect, it } from 'vitest';
import type { Ctx, Enemy, EnemyKind } from '@/core/types';
import { ENEMY_KINDS } from '@/core/types';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { createDefaultStatus } from '@/entities/status';
import { ensureCreatureMind } from '@/creatures/perception';
import { tickCreaturePose } from '@/creatures/pose';
import { addCorpse, clearCorpses, corpses, updateCorpses } from '@/creatures/corpses';
import { drawEnemySprite } from '@/render/sprites/EnemySprites';
import { hasSpeciesArt } from '@/render/creatures';
import type { LightField, PixelSurface } from '@/render/pixels';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';

function creature(kind: EnemyKind, x = 80, y = 70): Enemy {
  const def = ENEMY_DEFS[kind];
  return { kind, x, y, fx: 0, fy: 0, vx: 0.3, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0, timer: 0, attackCd: 60,
    bobPhase: 0.4, grounded: true, stride: 0, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: createDefaultStatus() };
}

function stage(): { world: World; ctx: Ctx } {
  const world = new World(220, 120);
  for (let x = 0; x < world.width; x++) for (let y = 71; y < 120; y++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555555);
  const ctx = { world, state: { frameCount: 0, mode: 'build', reduceFlashes: false }, enemyCtl: { defs: ENEMY_DEFS },
    player: { x: 160, y: 70 }, params: { global: {} } } as unknown as Ctx;
  return { world, ctx };
}

const LIGHT = { sample: () => ({ r: 1, g: 1, b: 1 }) } as unknown as LightField;

function surfaces(): { legacy: PixelSurface & { n: number; bad: number }; fine: PixelSurface & { n: number; bad: number } } {
  const check = (s: { n: number; bad: number }, r: number, g: number, b: number): void => {
    s.n++;
    if (![r, g, b].every(v => Number.isFinite(v) && v >= 0 && v < 3)) s.bad++;
  };
  const legacy = { n: 0, bad: 0, setPx(_x: number, _y: number, r: number, g: number, b: number) { check(legacy, r, g, b); }, addPx() {} };
  const fine = { n: 0, bad: 0, pixelStep: 0.5,
    setFinePx(_x: number, _y: number, r: number, g: number, b: number) { check(fine, r, g, b); },
    blendFinePx(_x: number, _y: number, r: number, g: number, b: number) { check(fine, r, g, b); },
    addFinePx() {}, setPx() {}, addPx() {} };
  return { legacy, fine };
}

describe('creature art pipeline', () => {
  it('every enemy kind is drawn by the rig rasterizer', () => {
    for (const kind of ENEMY_KINDS) expect(hasSpeciesArt(kind), kind).toBe(true);
  });

  it('draws a never-ticked fake (Builder gallery) and a living creature on legacy and fine surfaces', () => {
    for (const kind of ENEMY_KINDS) {
      const { ctx } = stage();
      const e = creature(kind);
      const fresh = surfaces();
      drawEnemySprite(fresh.legacy, LIGHT, ctx, e);
      drawEnemySprite(fresh.fine, LIGHT, ctx, e);
      expect(fresh.legacy.n, `${kind} legacy pixels`).toBeGreaterThan(20);
      expect(fresh.fine.n, `${kind} fine pixels`).toBeGreaterThan(80);
      ensureCreatureMind(e, 7);
      for (let t = 1; t <= 90; t++) { ctx.state.frameCount = t; e.timer = t; tickCreaturePose(ctx, e); }
      const lived = surfaces();
      drawEnemySprite(lived.fine, LIGHT, ctx, e);
      expect(lived.fine.n, `${kind} after ticks`).toBeGreaterThan(80);
      expect(fresh.legacy.bad + fresh.fine.bad + lived.fine.bad, `${kind} colour range`).toBe(0);
    }
  });

  it('the rig stays attached to its body through a teleport', () => {
    const { ctx } = stage();
    const e = creature('spitter');
    for (let t = 1; t <= 30; t++) { ctx.state.frameCount = t; tickCreaturePose(ctx, e); }
    e.x += 100;
    for (let t = 31; t <= 40; t++) { ctx.state.frameCount = t; tickCreaturePose(ctx, e); }
    for (const p of e.rig!.pts) expect(Math.abs(p.x - e.x)).toBeLessThan(25);
    for (const p of e.rig!.chains[0].pts) expect(Math.abs(p.x - e.x)).toBeLessThan(40);
  });

  it('a corpse keeps the body, falls, and melts back into grid cells', () => {
    const { world, ctx } = stage();
    (ctx.state as { mode: string }).mode = 'play';
    const e = creature('spitter', 80, 40);
    for (let t = 1; t <= 10; t++) { ctx.state.frameCount = t; tickCreaturePose(ctx, e); }
    clearCorpses();
    expect(addCorpse(ctx, e, 1, -1)).toBe(true);
    const y0 = e.rig!.pts[1].y;
    for (let t = 11; t <= 120; t++) { ctx.state.frameCount = t; updateCorpses(ctx); }
    expect(e.rig!.pts[1].y).toBeGreaterThan(y0 + 5);
    expect(e.rig!.pts[1].y).toBeLessThan(71);
    let blood = 0;
    for (let t = 121; t <= 1400 && corpses().length; t++) { ctx.state.frameCount = t; updateCorpses(ctx); }
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === Cell.Toxic) blood++;
    expect(corpses().length).toBe(0);
    expect(blood).toBeGreaterThan(0);
  });
});
