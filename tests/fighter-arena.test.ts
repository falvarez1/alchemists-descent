import { describe, expect, test } from 'vitest';
import { ENEMY_KINDS } from '@/core/types';
import { FIGHTER_ORDER } from '@/content/fighters';
import { ARENA_TIPS, FOE_PRESETS, YARD_STATIONS, type YardStation } from '@/content/fighterArena';
import { YARD, YARD_SPOTS } from '@/world/fighterArena';
import { LEVELS } from '@/config/worldgraph';

/** The Proving Yard (docs/FIGHTERS.md): the copy, the foe presets and the hall's coordinates agree with each other. */
const STATIONS = Object.keys(YARD_STATIONS) as YardStation[];

describe('the Proving Yard is a level', () => {
  test('it is registered as a depth-0 test arena', () => {
    expect(LEVELS['fighter-test']).toMatchObject({ id: 'fighter-test', name: 'THE PROVING YARD', depth: 0, nextLevelId: null });
  });
});

describe('the tips', () => {
  test('every fighter has a tip for the passive, the tactical and the ultimate, each pointing at a real station', () => {
    expect(Object.keys(ARENA_TIPS).sort()).toEqual([...FIGHTER_ORDER].sort());
    for (const id of FIGHTER_ORDER) {
      for (const slot of ['passive', 'tactical', 'ultimate'] as const) {
        const tip = ARENA_TIPS[id][slot];
        expect(STATIONS, `${id} ${slot}`).toContain(tip.where);
        expect(tip.try.length, `${id} ${slot}`).toBeGreaterThan(40);
        expect(tip.try.length, `${id} ${slot} stays a sentence or two`).toBeLessThan(260);
      }
    }
  });

});

describe('the foe presets', () => {
  test('are real enemy kinds, placed where the hall has room for them', () => {
    const kinds = new Set<string>(ENEMY_KINDS);
    for (const preset of FOE_PRESETS) {
      expect(kinds.has(preset.kind), preset.id).toBe(true);
      expect(['ring', 'gallery', 'cell']).toContain(preset.at);
      expect(preset.count).toBeGreaterThan(0);
    }
    expect(new Set(FOE_PRESETS.map((p) => p.id)).size).toBe(FOE_PRESETS.length);
  });

  test('the shooters stand on the gallery and the cell holds foes (the reveal moves need both)', () => {
    expect(FOE_PRESETS.some((p) => p.at === 'gallery')).toBe(true);
    expect(FOE_PRESETS.some((p) => p.at === 'cell')).toBe(true);
  });
});

describe('the hall', () => {
  test('the stations run left to right in the order the copy lists them, inside the walls', () => {
    const order = STATIONS.map((id) => YARD_SPOTS[id].x);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const x of order) {
      expect(x).toBeGreaterThan(YARD.x0);
      expect(x).toBeLessThan(YARD.x1);
    }
  });

  test('every spot stands above the floor, below the roof, and is where the station says', () => {
    for (const id of STATIONS) {
      const spot = YARD_SPOTS[id];
      expect(spot.y, id).toBeLessThan(YARD.bot);
      expect(spot.y, id).toBeGreaterThan(YARD.ceil + 20);
    }
    expect(YARD_SPOTS.muster).toEqual(YARD.spawn);
    expect(YARD_SPOTS.ring.x).toBe(YARD.ring.cx);
    expect(YARD_SPOTS.gallery.y).toBe(YARD.gallery.y - 1);
    expect(YARD_SPOTS.kiln.y).toBe(YARD.kiln.slabTop - 2);
    expect(YARD_SPOTS.cell.y).toBe(YARD.cell.slabTop - 2);
  });

  test('the slabs leave a corridor a body can walk under (17 tall, with room to spare)', () => {
    expect(YARD.floor - YARD.bluff.tunnelTop).toBeGreaterThanOrEqual(24);
    expect(YARD.floor - YARD.kiln.slabTop).toBeGreaterThanOrEqual(24);
    expect(YARD.floor - YARD.cell.slabTop).toBeGreaterThanOrEqual(24);
  });

  test('the barricade sits on the bay and the keg behind it, the cell door in the cell wall, the pool between its banks', () => {
    expect(YARD.kiln.barricadeX0).toBeGreaterThan(YARD.kiln.slabX0);
    expect(YARD.kiln.keg.x).toBeGreaterThan(YARD.kiln.barricadeX1);
    expect(YARD.kiln.keg.x).toBeLessThan(YARD.kiln.slabX1);
    expect(YARD.cell.ix0).toBeGreaterThan(YARD.cell.x0);
    expect(YARD.cell.ix1).toBeLessThan(YARD.cell.x1);
    expect(YARD.cell.cx).toBeGreaterThan(YARD.cell.ix0);
    expect(YARD.cell.cx).toBeLessThan(YARD.cell.ix1);
    expect(YARD.cistern.x1).toBeGreaterThan(YARD.cistern.x0);
  });

  test('the oil lane is clear of the torch and the torch of the lane (a baffle between them)', () => {
    expect(YARD.kiln.torchX - YARD.kiln.oil.x1).toBeGreaterThanOrEqual(20);
  });
});
