import { describe, expect, it } from 'vitest';
import { SIGHT } from '@/config/darkness';
import { PERK_DEFS, PERK_IDS, SANCTUM_PERK_DEFS, draftBoons, isPerkId } from '@/content/perks';
import { Rng } from '@/core/rng';
import { EventBus } from '@/core/events';
import type { Ctx, LightQueryApi, PerkId } from '@/core/types';
import { playerVisibility } from '@/creatures/lightResponse';
import { ChillSystem } from '@/game/Chill';
import { Cell } from '@/sim/CellType';
import { packRGB, waterColor } from '@/sim/colors';
import { World } from '@/sim/World';

const BARGAINS: readonly PerkId[] = ['stronggrip', 'rimesoles', 'longfuse', 'velvethood', 'grounded', 'warmblood'];

describe('the alchemist’s bargains are on the Sanctum’s table', () => {
  it('registers every bargain once, offered, with a name and a line to read', () => {
    expect(new Set(PERK_IDS).size).toBe(PERK_IDS.length);
    for (const id of BARGAINS) {
      expect(isPerkId(id)).toBe(true);
      const def = PERK_DEFS.find((perk) => perk.id === id);
      expect(def, id).toBeDefined();
      expect(def!.offeredInSanctum).toBe(true);
      expect(def!.sanctumName.length).toBeGreaterThan(2);
      expect(def!.desc.length).toBeGreaterThan(12);
      expect(SANCTUM_PERK_DEFS).toContain(def);
    }
  });

  it('gives a three-card draft something to choose between: a stat, a ward, a way of playing', () => {
    expect(SANCTUM_PERK_DEFS.length).toBeGreaterThanOrEqual(15);
  });
});

/* ---------------- the draft ---------------- */

describe('the Sanctum draft', () => {
  const pool = [{ id: 'vitality' }, ...SANCTUM_PERK_DEFS];
  const draw = (doors: string[], seed: number) => {
    const rng = new Rng(seed);
    return draftBoons(pool, doors, () => rng.next()).map((b) => b.id);
  };
  const SITUATIONAL = { warmblood: 'd2b', rimesoles: 'd3', grounded: 'd3' } as const;

  it('is a pure function of the seed: the same run and floor offer the same table, every time', () => {
    for (let seed = 1; seed <= 25; seed++) {
      expect(draw(['d2', 'd2b'], seed)).toEqual(draw(['d2', 'd2b'], seed));
    }
    const tables = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) tables.add(draw(['d2', 'd2b'], seed).join());
    expect(tables.size).toBeGreaterThan(10);
  });

  it('offers three different boons', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const offer = draw(['d3', 'd3b'], seed);
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
    }
  });

  it('never offers a ward for a floor that is not below (no dead cards)', () => {
    const seen = { d2: new Set<string>(), d3: new Set<string>(), d4: new Set<string>() };
    for (let seed = 1; seed <= 400; seed++) {
      for (const id of draw(['d2', 'd2b'], seed)) seen.d2.add(id);
      for (const id of draw(['d3', 'd3b'], seed)) seen.d3.add(id);
      for (const id of draw(['d4'], seed)) seen.d4.add(id);
    }
    // Before the Cold Store's door the frost ward is on the table, and the water boons are not.
    expect(seen.d2.has('warmblood')).toBe(true);
    expect(seen.d2.has('rimesoles') || seen.d2.has('grounded')).toBe(false);
    // Before the Cisterns' door it is the other way round.
    expect(seen.d3.has('rimesoles') && seen.d3.has('grounded')).toBe(true);
    expect(seen.d3.has('warmblood')).toBe(false);
    // Before the Kiln nothing situational is offered at all; the general bargains still are.
    for (const id of Object.keys(SITUATIONAL)) expect(seen.d4.has(id), id).toBe(false);
    for (const id of ['longfuse', 'velvethood', 'stronggrip', 'might']) expect(seen.d4.has(id), id).toBe(true);
  });

  it('offers everything when no doors are known (a test arena), and less than three when little is left', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) for (const id of draw([], seed)) seen.add(id);
    for (const id of Object.keys(SITUATIONAL)) expect(seen.has(id), id).toBe(true);
    const rng = new Rng(3);
    expect(draftBoons([{ id: 'only', worth: undefined }], ['d4'], () => rng.next())).toHaveLength(1);
    expect(draftBoons([], ['d4'], () => rng.next())).toHaveLength(0);
  });

  it('keys each situational boon to the floors the measurements support (docs/BOONS.md)', () => {
    for (const [id, floor] of Object.entries(SITUATIONAL)) {
      expect(PERK_DEFS.find((perk) => perk.id === id)?.worth, id).toEqual([floor]);
    }
  });
});

/* ---------------- Rime Soles and Warm Blood (game/Chill) ---------------- */

const FLOOR_Y = 30;

/** A basin: stone floor at FLOOR_Y, water filling FLOOR_Y-6..FLOOR_Y-1 across x 10..69, a stone shore either side. */
function basin(perks: Partial<Record<PerkId, true>>, feetY: number) {
  const world = new World(80, 60);
  for (let x = 0; x < 80; x++) world.replaceCellAt(world.idx(x, FLOOR_Y), Cell.Stone, packRGB(90, 90, 90));
  for (let x = 10; x < 70; x++) {
    for (let y = FLOOR_Y - 6; y < FLOOR_Y; y++) world.replaceCellAt(world.idx(x, y), Cell.Water, waterColor());
  }
  for (let y = FLOOR_Y - 6; y < FLOOR_Y; y++) {
    for (const x of [8, 9, 70, 71]) world.replaceCellAt(world.idx(x, y), Cell.Stone, packRGB(90, 90, 90));
  }
  const events = new EventBus();
  const moments: string[] = [];
  events.on('chillMoment', (m) => moments.push(m.kind));
  const player = {
    x: 40, y: feetY, vx: 0, vy: 0, dead: false, hp: 100, maxHp: 100, crawling: false, climbing: false,
    inLiquid: false, grounded: false, wallGrabT: 0, facing: 1, stridePhase: 0,
    status: { burning: 0 }, perks, chill: undefined as unknown,
  };
  const ctx = {
    world,
    events,
    state: { mode: 'play', frameCount: 1, reduceFlashes: false, reduceCameraShake: false },
    player,
    input: { keys: { left: false, right: false, jump: false, up: false, down: false } },
    levels: { current: { def: { biome: 'earthen' } } },
    particles: { spawn: () => undefined, burst: () => undefined },
    fx: { screenShake: 0, bloomKick: 0 },
    audio: { sfx: () => undefined },
  } as unknown as Ctx;
  const chill = new ChillSystem(ctx);
  const step = (n: number): void => {
    for (let k = 0; k < n; k++) { ctx.state.frameCount++; chill.update(ctx); }
  };
  const surface = (x: number): number => world.types[world.idx(x, FLOOR_Y - 6)];
  return { world, ctx, player, chill, step, surface, moments };
}

describe('Rime Soles', () => {
  it('skins the water under the boots with ice, so a pool can be stood on', () => {
    // The alchemist hangs 2 cells above the water's surface (its top row is FLOOR_Y - 6).
    const b = basin({ rimesoles: true }, FLOOR_Y - 6 - 2);
    b.step(8);
    for (let x = 36; x <= 44; x++) expect(b.surface(x), `x=${x}`).toBe(Cell.Ice);
    // Only the footprint: the far pool is untouched, and the water below the skin is still water.
    expect(b.surface(20)).toBe(Cell.Water);
    expect(b.world.types[b.world.idx(40, FLOOR_Y - 5)]).toBe(Cell.Water);
    expect(b.moments).toContain('skin');
  });

  it('follows the boots across the pool, and gives the road back to the water', () => {
    const b = basin({ rimesoles: true }, FLOOR_Y - 6 - 1);
    for (let x = 30; x <= 50; x += 2) { b.player.x = x; b.step(4); }
    expect(b.surface(30)).toBe(Cell.Ice);
    expect(b.surface(50)).toBe(Cell.Ice);
    // Standing still keeps the skin under the boots, while the far end of the walk thaws.
    b.player.x = 50;
    b.step(2600);
    expect(b.surface(50)).toBe(Cell.Ice);
    expect(b.surface(30)).toBe(Cell.Water);
  });

  it('skins water that has glow-leaf and grass floating on it, as a Cistern has (the pad lies on the ice)', () => {
    const b = basin({ rimesoles: true }, FLOOR_Y - 6 - 2);
    for (let x = 30; x <= 50; x++) b.world.replaceCellAt(b.world.idx(x, FLOOR_Y - 7), x % 2 ? Cell.Leaf : Cell.Grass, packRGB(60, 160, 70));
    b.step(8);
    for (let x = 36; x <= 44; x++) expect(b.surface(x), `x=${x}`).toBe(Cell.Ice);
    expect(b.world.types[b.world.idx(41, FLOOR_Y - 7)]).toBe(Cell.Leaf);
  });

  it('does nothing without the boon, and never freezes the waist of a body already wading', () => {
    const plain = basin({}, FLOOR_Y - 6 - 2);
    plain.step(8);
    expect(plain.surface(40)).toBe(Cell.Water);

    // Feet a cell into the water: there is nothing to stand on to skin over, and no ice forms round the legs.
    const wading = basin({ rimesoles: true }, FLOOR_Y - 5);
    wading.step(8);
    for (let x = 30; x <= 50; x++) expect(wading.surface(x), `x=${x}`).toBe(Cell.Water);
  });
});

describe('Warm Blood', () => {
  it('lets half of a frost blow in', () => {
    const plain = basin({}, FLOOR_Y - 8);
    const warm = basin({ warmblood: true }, FLOOR_Y - 8);
    plain.chill.hit(0.4);
    warm.chill.hit(0.4);
    plain.step(1);
    warm.step(1);
    const plainLevel = (plain.player.chill as { level: number }).level;
    const warmLevel = (warm.player.chill as { level: number }).level;
    expect(plainLevel).toBeGreaterThan(0.3);
    expect(warmLevel).toBeGreaterThan(0.15);
    expect(warmLevel).toBeLessThan(plainLevel * 0.65);
  });
});

/* ---------------- Velvet Hood ---------------- */

function lightCtx(dark: number, hooded: boolean, perks: Partial<Record<PerkId, true>>): Ctx {
  const q: LightQueryApi = { level: () => 0.4, wandLight: () => 0, darkness: () => dark, hooded };
  return {
    world: new World(20, 20),
    state: { frameCount: 100, mode: 'play' },
    player: { x: 10, y: 10, status: { torch: 0 }, perks },
    lightQuery: q,
  } as unknown as Ctx;
}

describe('Velvet Hood', () => {
  it('makes half-dark hide like deep dark while hooded', () => {
    const plain = playerVisibility(lightCtx(0.4, true, {}));
    const velvet = playerVisibility(lightCtx(0.4, true, { velvethood: true }));
    expect(velvet).toBeLessThan(plain * 0.5);
    expect(velvet).toBeGreaterThanOrEqual(0);
    // Deep dark is already all but invisible; the boon cannot push it below nothing.
    expect(playerVisibility(lightCtx(1, true, { velvethood: true }))).toBeCloseTo(0, 6);
  });

  it('leaves a lamp-lit room lighting the alchemist, and an open lantern a beacon', () => {
    expect(playerVisibility(lightCtx(0, true, { velvethood: true }))).toBeCloseTo(SIGHT.lantern, 6);
    const open = playerVisibility(lightCtx(0.5, false, {}));
    expect(playerVisibility(lightCtx(0.5, false, { velvethood: true }))).toBeCloseTo(open, 6);
  });
});
