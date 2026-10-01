import { describe, expect, it } from 'vitest';

import { MINIMAP_H, MINIMAP_W } from '@/config/constants';
import type { Ctx, LevelRuntime, PlacedPrefab } from '@/core/types';
import { portalWakeAge, PORTAL_WAKE_TICKS } from '@/render/farTells';
import { setPieceTellLights, tellSpecFor } from '@/render/setPieceTells';
import { collectMinimapPois } from '@/ui/Minimap';
import { World } from '@/sim/World';

function runtime(overrides: Partial<LevelRuntime> = {}): LevelRuntime {
  return {
    def: { id: 'd4', name: 'THE KILN HEART', biome: 'volcanic', depth: 4, nextLevelId: null },
    world: new World(1600, 1064),
    enemies: [],
    waystones: [],
    exit: null,
    explored: new Uint8Array(MINIMAP_W * MINIMAP_H),
    spawn: { x: 100, y: 100 },
    regions: null,
    cauldron: null,
    pickups: [],
    portal: null,
    keyTaken: false,
    mechanisms: [],
    runeVaults: [],
    ...overrides,
  } as LevelRuntime;
}

function ctx(level: LevelRuntime): Ctx {
  return {
    state: { mode: 'play' },
    player: { x: 400, y: 320, dead: false, hp: 80, maxHp: 100 },
    levels: { current: level },
  } as unknown as Ctx;
}

describe('the guardian on the map', () => {
  const boss = { x: 800, y: 960, kind: 'colossus' as const };

  it('is not marked before the floor has a reason to know it', () => {
    const level = runtime({ boss });
    expect(collectMinimapPois(ctx(level), level).some((p) => p.kind === 'boss')).toBe(false);
  });

  it('is marked faintly once it has been heard, and more faintly still than a seen arena', () => {
    const level = runtime({ boss, bossHeard: true });
    const poi = collectMinimapPois(ctx(level), level).find((p) => p.kind === 'boss');
    expect(poi?.id).toBe('boss-arena-unseen');
    expect(poi?.title).toBe('Unseen Guardian');
    expect(poi?.glyph).toBe('?');
    expect(poi?.width).toBeLessThan(4); // the seen arena's "!" is 4 wide
    expect(poi?.color).not.toBe('#ef4444');
  });

  it('is marked once the key is taken', () => {
    const level = runtime({ boss, keyTaken: true });
    expect(collectMinimapPois(ctx(level), level).find((p) => p.kind === 'boss')?.id).toBe('boss-arena-unseen');
  });

  it('gives way to the plain arena marker once the ground is charted', () => {
    const level = runtime({ boss, bossHeard: true });
    level.explored[(boss.x >> 3) + (boss.y >> 3) * MINIMAP_W] = 1;
    const ids = collectMinimapPois(ctx(level), level).filter((p) => p.kind === 'boss').map((p) => p.id);
    expect(ids).toEqual(['boss-arena']);
  });
});

describe('set-piece far tells', () => {
  const piece = (id: string, x0 = 100, y0 = 100, x1 = 180, y1 = 160): PlacedPrefab => ({ id, x0, y0, x1, y1 });

  it('lights the pieces that carry a fixture, in the colour of the fixture', () => {
    const lights = setPieceTellLights([piece('builtin-brazier-shrine'), piece('machine-alchemy-clock'), piece('flora-thicket'), piece('builtin-ruin-gallery')]);
    expect(lights).toHaveLength(4);
    const [coals, pilot] = lights;
    expect(coals.r).toBeGreaterThan(coals.b); // warm
    expect(pilot.r).toBeGreaterThan(pilot.b);
    expect(lights[2].g).toBeGreaterThan(lights[2].r); // glow-moss
    expect(lights[3].b).toBeGreaterThan(lights[3].r); // cold
  });

  it('leaves the light puzzles, the glass galleries and the lairs alone', () => {
    for (const id of ['light-bloom-crossing', 'light-lamplighters-lock', 'glass-periscope', 'glass-prism-gate', 'encounter-lair-stonemaw-seam', 'builtin-mystery']) {
      expect(tellSpecFor(id)).toBeNull();
    }
    expect(setPieceTellLights([piece('light-bloom-crossing'), piece('encounter-lair-rillback-pool')])).toEqual([]);
    expect(setPieceTellLights(undefined)).toEqual([]);
  });

  it('places the lamp at the focus when a piece has one, else a little above its middle; all occluded and modest', () => {
    const [a] = setPieceTellLights([{ ...piece('flora-thicket'), focus: { x: 150, y: 140 } }]);
    expect(a).toMatchObject({ x: 150, y: 134, occluded: true });
    const [b] = setPieceTellLights([piece('machine-kiln-elevator', 100, 100, 180, 200)]);
    expect(b.x).toBe(140);
    expect(b.y).toBeGreaterThan(100);
    expect(b.y).toBeLessThan(150);
    for (const l of [a, b]) {
      expect(l.intensity).toBeLessThanOrEqual(1.2); // a lamp, not a beacon: designed darkness stays
      expect(l.radius).toBeLessThanOrEqual(50);
    }
  });

  it('gives neighbouring lamps different flicker phases', () => {
    const lights = setPieceTellLights([piece('builtin-brazier-shrine'), piece('builtin-brazier-shrine', 300), piece('builtin-brazier-shrine', 500)]);
    expect(new Set(lights.map((l) => l.flickerPhase)).size).toBe(3);
  });
});

describe('portal wake-up age', () => {
  it('is unbounded while the gate is sealed or the moment was not recorded', () => {
    expect(portalWakeAge(false, 100, 500)).toBe(Number.POSITIVE_INFINITY);
    expect(portalWakeAge(true, undefined, 500)).toBe(Number.POSITIVE_INFINITY);
  });

  it('counts ticks from the key, never negative, so the flourish plays once', () => {
    expect(portalWakeAge(true, 500, 500)).toBe(0);
    expect(portalWakeAge(true, 500, 530)).toBe(30);
    expect(portalWakeAge(true, 500, 400)).toBe(0);
    expect(portalWakeAge(true, 500, 500 + PORTAL_WAKE_TICKS + 1)).toBeGreaterThan(PORTAL_WAKE_TICKS);
  });
});
