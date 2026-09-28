import { describe, expect, it } from 'vitest';
import { HEIGHT, WIDTH } from '@/config/constants';
import { Rng } from '@/core/rng';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { type CarveAvoid, PlacementLedger, sealedFootprints, tunnelTo } from '@/world/connect';

/**
 * Late tunnels walk AROUND sealed features (GEN 55). The connector walk is a
 * jittered straight line that cuts everything but Metal; a flora connector on
 * d3 seed 3 took the whole Rillback pool that way. These pin the contract:
 * avoidance only ever changes a walk that would have bitten a sealed footprint,
 * spends the same rng either way, and stays fail-open.
 */

function solidWorld(): World {
  const world = new World();
  world.types.fill(Cell.Wall);
  return world;
}

function carvedIn(world: World, r: CarveAvoid): number {
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (world.types[x + y * WIDTH] === Cell.Empty) n++;
  return n;
}

const FROM = { x: 200, y: 500 };
const TO = { x: 640, y: 500 };
const LAIR: CarveAvoid = { x0: 360, y0: 450, x1: 460, y1: 550 };

describe('tunnelTo around sealed footprints', () => {
  it('cuts straight through a feature when told nothing (the old walk)', () => {
    const world = solidWorld();
    tunnelTo(world, new Rng(7), FROM.x, FROM.y, TO.x, TO.y, 12);
    expect(carvedIn(world, LAIR)).toBeGreaterThan(1000);
  });

  it('routes around a sealed footprint and still reaches its target', () => {
    const world = solidWorld();
    const steps = tunnelTo(world, new Rng(7), FROM.x, FROM.y, TO.x, TO.y, 12, undefined, 26, [LAIR]);
    expect(carvedIn(world, LAIR)).toBe(0);
    expect(world.types[TO.x + TO.y * WIDTH]).toBe(Cell.Empty);
    const [lx, ly] = steps[steps.length - 1];
    expect(Math.abs(lx - TO.x) <= 3 && Math.abs(ly - TO.y) <= 3).toBe(true);
  });

  it('is byte-identical to the old walk when the line misses every footprint', () => {
    const far: CarveAvoid = { x0: 1200, y0: 100, x1: 1300, y1: 200 };
    const a = solidWorld(), b = solidWorld();
    tunnelTo(a, new Rng(11), FROM.x, FROM.y, TO.x, TO.y, 12, { halfW: 7, up: 21, down: 9 });
    tunnelTo(b, new Rng(11), FROM.x, FROM.y, TO.x, TO.y, 12, { halfW: 7, up: 21, down: 9 }, 26, [far]);
    expect(Buffer.from(b.types).equals(Buffer.from(a.types))).toBe(true);
  });

  it('spends the same rng draws whether or not it detours', () => {
    const plain = new Rng(3), avoiding = new Rng(3);
    tunnelTo(solidWorld(), plain, FROM.x, FROM.y, TO.x, TO.y, 12);
    tunnelTo(solidWorld(), avoiding, FROM.x, FROM.y, TO.x, TO.y, 12, undefined, 26, [LAIR]);
    expect(avoiding.next()).toBe(plain.next());
  });

  it('is fail-open: a footprint that walls off the target is cut, never a dead end', () => {
    const wall: CarveAvoid = { x0: 400, y0: 0, x1: 440, y1: HEIGHT - 1 };
    const world = solidWorld();
    tunnelTo(world, new Rng(5), FROM.x, FROM.y, TO.x, TO.y, 12, undefined, 26, [wall]);
    expect(world.types[TO.x + TO.y * WIDTH]).toBe(Cell.Empty);
    // One clean crossing of the wall, not a bore along it.
    const cut = carvedIn(world, wall);
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(41 * 40);
  });

  it('never avoids the feature its own tunnel starts or ends in', () => {
    const world = solidWorld();
    const home: CarveAvoid = { x0: 150, y0: 450, x1: 250, y1: 550 };
    tunnelTo(world, new Rng(9), FROM.x, FROM.y, TO.x, TO.y, 12, undefined, 26, [home]);
    expect(carvedIn(world, home)).toBeGreaterThan(0);
  });
});

describe('sealedFootprints', () => {
  it('lists the lairs, the sump and the light rooms, and nothing else', () => {
    const ledger = new PlacementLedger();
    ledger.reserve(0, 0, 10, 10, 'spawn');
    ledger.reserve(20, 20, 30, 30, 'encounter-lair-rillback-pool');
    ledger.reserve(40, 40, 50, 50, 'sump-arena');
    ledger.reserve(60, 60, 70, 70, 'light-bloom-crossing');
    ledger.reserve(80, 80, 90, 90, 'flora-thicket');
    expect(sealedFootprints(ledger)).toEqual([
      { x0: 20, y0: 20, x1: 30, y1: 30 },
      { x0: 40, y0: 40, x1: 50, y1: 50 },
      { x0: 60, y0: 60, x1: 70, y1: 70 },
    ]);
  });
});
