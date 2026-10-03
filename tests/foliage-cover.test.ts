import { describe, expect, it, vi } from 'vitest';
import type { Ctx, Enemy } from '@/core/types';
import { EventBus } from '@/core/events';
import { FOLIAGE_COVER, foliageBurnLife } from '@/config/foliage';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { createPlayer } from '@/entities/Player';
import { FoliageCover, foliageCoverage } from '@/game/FoliageCover';
import { visibleSurfaceFoliage } from '@/game/SurfaceFoliage';
import { drawForegroundFoliage, drawSceneFidelity, VISUAL_FIDELITY } from '@/render/SceneFidelity';
import type { LightField, PixelSurface } from '@/render/pixels';

function thicket() {
  const world = new World(500, 300), events = new EventBus();
  for (let x = 40; x < 440; x++) world.replaceCellAt(world.idx(x, 151), Cell.Stone, 0x444444);
  for (let x = 42; x < 438; x += 6) {
    world.replaceCellAt(world.idx(x, 150), Cell.Moss, 0x447744); world.life[world.idx(x, 150)] = -2;
  }
  world.activity.beginStep(world);
  const ctx = { world, events, player: createPlayer(), state: { mode: 'play', frameCount: 0 },
    levels: { current: { pickups: [], mechanisms: [] } }, camera: { renderX: 0, renderY: 0 }, enemies: [],
    particles: { list: [], spawn: vi.fn() }, projectiles: [] } as unknown as Ctx;
  const roots = [...visibleSurfaceFoliage(ctx)];
  const root = roots.find(p => p.foreground && foliageCoverage(world, p.x, 150) >= .8)!;
  expect(root).toBeDefined();
  Object.assign(ctx.player, { x: root.x, y: 150, vx: 0, vy: 0, grounded: true });
  const cover = new FoliageCover(ctx); ctx.foliageCover = cover;
  const tick = (count = 1) => { for (let n = 0; n < count; n++) { ctx.state.frameCount++; cover.update(ctx); } };
  return { ctx, world, cover, root, roots, tick };
}

describe('Living foreground cover', () => {
  it('settles on solid ground despite the body integrator accumulating gravity between collision steps', () => {
    const { ctx, cover, tick } = thicket();
    for (let i = 0; i < 35; i++) { ctx.player.vy = (i % 3) * .28; tick(); }
    expect(cover.hidden).toBe(true);
    ctx.player.grounded = false; ctx.player.vy = 0; tick(); expect(cover.hidden).toBe(false);
    cover.dispose();
  });

  it('requires half a second settled in a real crown and ignores camera position', () => {
    const { ctx, cover, tick } = thicket();
    Object.assign(ctx.camera, { renderX: 9000, renderY: 9000 });
    tick(FOLIAGE_COVER.settleTicks - 1); expect(cover.hidden).toBe(false);
    tick(); expect(cover.hidden).toBe(true);
    expect(cover.coverage).toBeGreaterThanOrEqual(.8);
    ctx.player.vx = 2; tick(); expect(cover.hidden).toBe(false);
    ctx.player.vx = 0; tick(FOLIAGE_COVER.settleTicks); expect(cover.hidden).toBe(true);
    ctx.player.y -= 45; tick(); expect(cover.coverage).toBe(0); expect(cover.hidden).toBe(false);
    cover.dispose();
  });

  it('casting reveals immediately and delays hiding again, including trigger casts', () => {
    const { ctx, cover, tick } = thicket(); tick(35); expect(cover.hidden).toBe(true);
    ctx.events.emit('cardCast', { id: 'spark', origin: 'trigger', x: ctx.player.x, y: ctx.player.y });
    expect(cover.hidden).toBe(false);
    tick(FOLIAGE_COVER.revealTicks - 1); expect(cover.progress).toBe(0);
    tick(FOLIAGE_COVER.settleTicks); expect(cover.hidden).toBe(true);
    ctx.player.kickT = 8; tick(); expect(cover.hidden).toBe(false);
    cover.dispose(); expect(ctx.events.listenerCount('cardCast')).toBe(0);
  });

  it('close living creatures reveal the player while creatures behind terrain do not', () => {
    const { ctx, world, cover, tick } = thicket(); tick(35);
    const enemy = { x: ctx.player.x + 18, y: 150, hp: 50 } as Enemy;
    ctx.enemies.push(enemy);
    for (let y = 120; y < 151; y++) world.replaceCellAt(world.idx(ctx.player.x + 12, y), Cell.Stone, 0);
    tick(); expect(cover.hidden).toBe(true);
    for (let y = 120; y < 151; y++) world.clearCell(ctx.player.x + 12, y);
    tick(); expect(cover.hidden).toBe(false);
    cover.dispose();
  });

  it.each(['removed', 'burning', 'charred', 'unsupported'] as const)('loses cover immediately when its roots are %s', state => {
    const { ctx, world, roots, cover, tick } = thicket(); tick(35);
    expect(cover.hidden).toBe(true);
    for (const p of roots) {
      const i = world.idx(p.x, p.y);
      if (state === 'removed') world.clearCellAt(i);
      if (state === 'burning') world.life[i] = foliageBurnLife(2, 1);
      if (state === 'charred') world.life[i] = -10 - 60;
      if (state === 'unsupported') world.clearCell(p.x, p.y + 1);
    }
    tick(); expect(cover.hidden).toBe(false);
    expect(foliageCoverage(world, ctx.player.x, ctx.player.y)).toBe(0);
    cover.dispose();
  });

  it('does not carry concealment to another world, death or an arena', () => {
    const { ctx, cover, tick } = thicket(); tick(35);
    const original = ctx.world;
    ctx.world = new World(500, 300); tick(); expect(cover.hidden).toBe(false);
    ctx.world = original; tick(35); expect(cover.hidden).toBe(true);
    ctx.player.dead = true; tick(); expect(cover.progress).toBe(0);
    ctx.player.dead = false; tick(35); expect(cover.hidden).toBe(true);
    ctx.arena = { active: true } as Ctx['arena']; tick(); expect(cover.hidden).toBe(false);
    cover.dispose();
  });

  it('renders dark foreground fronds over a body even when cosmetic detail is disabled', () => {
    const { ctx, root, cover } = thicket();
    const pixels = new Map<string, number[]>();
    const out: PixelSurface = { setPx: (x, y, r, g, b) => { pixels.set(`${Math.round(x)},${Math.round(y)}`, [r, g, b]); }, addPx: () => {} };
    const light = { sample: () => ({ r: 1, g: 1, b: 1, open: 1 }) } as unknown as LightField;
    const enabled = VISUAL_FIDELITY.enabled;
    try {
      VISUAL_FIDELITY.enabled = false;
      drawSceneFidelity(out, light, ctx); expect(pixels.size).toBe(0);
      for (let y = 134; y < 150; y++) for (let x = root.x - 4; x <= root.x + 4; x++) out.setPx(x, y, 1, 1, 1);
      drawForegroundFoliage(out, light, ctx);
      let occluded = 0;
      for (let y = 134; y < 150; y++) for (let x = root.x - 4; x <= root.x + 4; x++) {
        const c = pixels.get(`${x},${y}`)!;
        if (c[0] < .5 && c[1] < .55 && c[2] > c[0]) occluded++;
      }
      expect(occluded).toBeGreaterThan(35);
      expect(pixels.has(`${root.x},151`)).toBe(false);
    } finally { VISUAL_FIDELITY.enabled = enabled; cover.dispose(); }
  });
});
