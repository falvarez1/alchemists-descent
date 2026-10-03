import { beforeEach, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { drawPlayerSprite } from '@/render/sprites/PlayerSprite';
import { drawFighter } from '@/render/player/FighterArt';

vi.mock('@/render/player/FighterArt', () => ({ drawFighter: vi.fn(() => true) }));
beforeEach(() => vi.clearAllMocks());
it('keeps stock fighters visible on every hurt/protection frame while retaining campaign flashing', () => {
  const ctx = { player: { dead: false, invuln: 15 }, state: { mode: 'play', frameCount: 0 }, fighters: { id: 'ilyra-voss' }, arena: { stockMatch: {} } } as unknown as Ctx;
  for (let i = 0; i < 6; i++) { ctx.state.frameCount = i; drawPlayerSprite({} as PixelSurface, {} as LightField, ctx); }
  expect(drawFighter).toHaveBeenCalledTimes(6);
  vi.clearAllMocks(); ctx.arena = undefined;
  for (let i = 0; i < 6; i++) { ctx.state.frameCount = i; drawPlayerSprite({} as PixelSurface, {} as LightField, ctx); }
  expect(drawFighter).toHaveBeenCalledTimes(3);
});
