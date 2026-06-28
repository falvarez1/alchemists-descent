import { describe, expect, it } from 'vitest';

import { MINIMAP_H, MINIMAP_W } from '@/config/constants';
import type { Ctx, LevelRuntime, Mechanism } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { collectMinimapPois, findMinimapMaterialPoi, hitTestMinimapPoi } from '@/ui/Minimap';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { World } from '@/sim/World';

function runtime(overrides: Partial<LevelRuntime> = {}): LevelRuntime {
  return {
    def: { id: 'test', name: 'Test Depth', biome: 'earthen', depth: 1, nextLevelId: null },
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

function markExplored(level: LevelRuntime, x: number, y: number): void {
  level.explored[(x >> 3) + (y >> 3) * MINIMAP_W] = 1;
}

function setSampleCell(level: LevelRuntime, mapX: number, mapY: number, cell: Cell, color = packRGB(240, 210, 70)): void {
  const x = mapX * 8 + 4;
  const y = mapY * 8 + 4;
  const idx = x + y * level.world.width;
  level.world.types[idx] = cell;
  level.world.colors[idx] = color;
}

describe('minimap POI markers', () => {
  it('uses discovered marker rules for refuge, lab, and vault arch popovers', () => {
    const level = runtime({
      refuge: { x: 120, y: 160 },
      spellLab: { x: 200, y: 180, rewardX: 204, rewardY: 172 },
      vaultArch: { x: 300, y: 220, backX: 340, backY: 224, discoverX: 280, discoverY: 220 },
    });

    expect(collectMinimapPois(ctx(level), level).map((poi) => poi.id)).not.toEqual(
      expect.arrayContaining(['refuge', 'spell-lab', 'vault-arch']),
    );

    markExplored(level, 120, 160);
    markExplored(level, 200, 180);
    markExplored(level, 280, 220);

    expect(collectMinimapPois(ctx(level), level).map((poi) => poi.id)).toEqual(
      expect.arrayContaining(['refuge', 'spell-lab', 'vault-arch']),
    );
  });

  it('keeps drawn pickup and mechanism markers available to hit testing', () => {
    const door: Mechanism = {
      id: 7,
      kind: 'door',
      x: 240,
      y: 120,
      w: 4,
      h: 10,
      state: 0,
      targetId: -1,
    };
    const level = runtime({
      portal: { x: 80, y: 80, open: false },
      keyTaken: false,
      pickups: [makePickup('key', 160, 120), makePickup('chest', 170, 120)],
      mechanisms: [door],
      runeVaults: [{ rx: 320, ry: 160, door: [[322, 160]], active: false }],
    });
    const pois = collectMinimapPois(ctx(level), level);

    expect(pois.map((poi) => poi.id)).toEqual(expect.arrayContaining(['portal', 'pickup:0:key', 'mechanism:7', 'rune-vault:0']));
    expect(pois.map((poi) => poi.id)).not.toContain('pickup:1:chest');

    const key = pois.find((poi) => poi.id === 'pickup:0:key')!;
    const hit = hitTestMinimapPoi(pois, key.mapX, key.mapY);

    expect(hit?.id).toBe('pickup:0:key');
    expect(hit?.title).toBe('Golden Key');
    expect(hit?.fields.some((field) => field.label === 'position')).toBe(true);
  });

  it('reveals optional pickup POIs only after their map cell is discovered', () => {
    const level = runtime({
      pickups: [
        makePickup('chest', 176, 128, { amount: 75 }),
        makePickup('potion', 200, 128, { potion: 'swift' }),
        makePickup('goldpile', 224, 128, { amount: 20 }),
      ],
    });

    expect(collectMinimapPois(ctx(level), level).map((poi) => poi.id)).not.toEqual(
      expect.arrayContaining(['pickup:0:chest', 'pickup:1:potion', 'pickup:2:goldpile']),
    );

    markExplored(level, 176, 128);
    markExplored(level, 200, 128);
    markExplored(level, 224, 128);

    const pois = collectMinimapPois(ctx(level), level);
    expect(pois.map((poi) => poi.id)).toEqual(
      expect.arrayContaining(['pickup:0:chest', 'pickup:1:potion', 'pickup:2:goldpile']),
    );

    const potion = pois.find((poi) => poi.id === 'pickup:1:potion')!;
    expect(potion.title).toBe('Potion');
    expect(potion.fields).toEqual(expect.arrayContaining([{ label: 'potion', value: 'POTION OF SWIFTNESS' }]));
  });

  it('reveals generated encounter lair POIs after discovery', () => {
    const level = runtime({
      placedPrefabs: [
        { id: 'encounter-lair-rootloper-grove', x0: 300, y0: 200, x1: 377, y1: 247 },
        { id: 'machine-powdermill', x0: 500, y0: 200, x1: 560, y1: 250 },
      ],
    });

    expect(collectMinimapPois(ctx(level), level).map((poi) => poi.id)).not.toEqual(
      expect.arrayContaining(['encounter:0:encounter-lair-rootloper-grove']),
    );

    markExplored(level, 338, 223);
    const pois = collectMinimapPois(ctx(level), level);
    const encounter = pois.find((poi) => poi.id === 'encounter:0:encounter-lair-rootloper-grove');

    expect(encounter?.kind).toBe('encounter');
    expect(encounter?.title).toBe('Root Loper Grove');
    expect(encounter?.tags).toEqual(expect.arrayContaining(['encounter', 'rootloper']));
    expect(encounter?.fields).toEqual(expect.arrayContaining([{ label: 'footprint', value: '78 x 48' }]));
    expect(pois.map((poi) => poi.id)).not.toEqual(expect.arrayContaining(['encounter:1:machine-powdermill']));
  });

  it('adds popovers for discovered small mechanism markers beyond doors', () => {
    const door: Mechanism = {
      id: 2,
      kind: 'door',
      x: 240,
      y: 160,
      w: 4,
      h: 12,
      state: 0,
      targetId: -1,
    };
    const lever: Mechanism = {
      id: 3,
      kind: 'lever',
      x: 288,
      y: 160,
      w: 1,
      h: 1,
      state: 0,
      targetId: door.id,
    };
    const sensor: Mechanism = {
      id: 4,
      kind: 'sensor',
      x: 320,
      y: 160,
      w: 1,
      h: 1,
      state: 1,
      targetId: door.id,
      threshold: 12,
      reading: 14,
      sensorType: 'liquid',
      zone: { x0: 316, y0: 152, x1: 324, y1: 159 },
    };
    const level = runtime({ mechanisms: [door, lever, sensor] });

    expect(collectMinimapPois(ctx(level), level).map((poi) => poi.id)).toEqual(expect.arrayContaining(['mechanism:2']));
    expect(collectMinimapPois(ctx(level), level).map((poi) => poi.id)).not.toEqual(
      expect.arrayContaining(['mechanism:3', 'mechanism:4']),
    );

    markExplored(level, lever.x, lever.y);
    markExplored(level, sensor.x, sensor.y);

    const pois = collectMinimapPois(ctx(level), level);
    expect(pois.map((poi) => poi.id)).toEqual(expect.arrayContaining(['mechanism:3', 'mechanism:4']));

    const leverPoi = pois.find((poi) => poi.id === 'mechanism:3')!;
    expect(leverPoi.title).toBe('Lever #3');
    expect(leverPoi.fields).toEqual(expect.arrayContaining([{ label: 'target', value: '2' }]));

    const sensorPoi = pois.find((poi) => poi.id === 'mechanism:4')!;
    expect(sensorPoi.fields).toEqual(
      expect.arrayContaining([
        { label: 'sensor', value: 'liquid' },
        { label: 'reading', value: '14' },
      ]),
    );
    expect(hitTestMinimapPoi(pois, sensorPoi.mapX, sensorPoi.mapY)?.id).toBe('mechanism:4');
  });

  it('falls back to material popovers for tiny explored terrain marker pixels', () => {
    const level = runtime();
    setSampleCell(level, 40, 30, Cell.Gold);

    expect(findMinimapMaterialPoi(level, 40.5, 30.5)).toBeNull();

    level.explored[40 + 30 * MINIMAP_W] = 1;
    const hit = findMinimapMaterialPoi(level, 42, 30.5);

    expect(hit?.name).toBe('Gold Powder');
    expect(hit?.worldX).toBe(324);
    expect(hit?.worldY).toBe(244);

    setSampleCell(level, 44, 30, Cell.Wall);
    level.explored[44 + 30 * MINIMAP_W] = 1;

    expect(findMinimapMaterialPoi(level, 44.5, 30.5, 0.75)).toBeNull();
  });
});
