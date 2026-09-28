import { describe, expect, it } from 'vitest';
import { createGameParams } from '@/config/params';
import { DARKNESS, FLOOR_DARKNESS } from '@/config/darkness';
import {
  DARK_CELL,
  DARK_W,
  bakeDarkMap,
  darkMapFor,
  fillOpenField,
  openAtCell,
  renderDarkness,
  renderOpenLut,
  sampleDarkMap,
  zoneInside,
} from '@/core/darkness';
import type { Ctx, DarkZone, LevelRuntime } from '@/core/types';
import { LightQuery, type QueryableLightField } from '@/render/LightQuery';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

function field(originX = 100, originY = 200, LW = 40, LH = 30): QueryableLightField & {
  lightR: Float32Array; lightG: Float32Array; lightB: Float32Array; wandField: Float32Array; lightOpen: Float32Array;
} {
  const n = LW * LH;
  return {
    LW, LH, originX, originY, built: true,
    lightR: new Float32Array(n), lightG: new Float32Array(n), lightB: new Float32Array(n),
    wandField: new Float32Array(n), lightOpen: new Float32Array(n).fill(1),
  };
}

function ctxWith(runtime: Partial<LevelRuntime> | null, state: Record<string, unknown> = {}): Ctx {
  return {
    state: { mode: 'play', ...state },
    params: createGameParams(),
    levels: { current: runtime },
  } as unknown as Ctx;
}

const UNDERTOW: DarkZone = { x: 400, y: 300, rx: 120, ry: 60, shape: 'rect' };

describe('designed darkness map', () => {
  it('reads the floor base everywhere and a zone core at its full strength', () => {
    const map = bakeDarkMap([UNDERTOW], { base: 0.3, deep: 1 });
    expect(sampleDarkMap(map, 20, 20)).toBeCloseTo(0.3, 2);
    expect(sampleDarkMap(map, 400, 300)).toBeCloseTo(1, 2);
  });

  it('feathers a zone rim instead of cutting a hard edge', () => {
    const map = bakeDarkMap([UNDERTOW], { base: 0, deep: 1 });
    const rim = sampleDarkMap(map, 400 - 120 + 14, 300);
    const inside = sampleDarkMap(map, 400 - 120 + DARKNESS.feather + DARKNESS.rimNoise + 4, 300);
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(0.8);
    expect(inside).toBeCloseTo(1, 2);
    expect(sampleDarkMap(map, 400 - 120 - DARKNESS.rimNoise - 2, 300)).toBe(0);
  });

  it('combines overlapping zones by max, never by sum', () => {
    const a: DarkZone = { x: 300, y: 300, rx: 80, ry: 80, strength: 0.6 };
    const b: DarkZone = { x: 320, y: 300, rx: 80, ry: 80, strength: 0.6 };
    const map = bakeDarkMap([a, b], { base: 0, deep: 1 });
    expect(sampleDarkMap(map, 310, 300)).toBeCloseTo(0.6, 1);
  });

  it('ellipse zones fall off radially, with a wandering rim', () => {
    const z: DarkZone = { x: 500, y: 500, rx: 100, ry: 50 };
    expect(zoneInside(z, 500, 500)).toBe(1);
    expect(zoneInside(z, 500, 500 + 50 + DARKNESS.rimNoise + 1)).toBe(0);
    expect(zoneInside(z, 588, 500)).toBeGreaterThan(0);
    expect(zoneInside(z, 588, 500)).toBeLessThan(1);
    // The rim is not a perfect curve: equal-radius points differ.
    const around = [0, 1, 2, 3, 4, 5].map((k) => zoneInside(z, 500 + Math.cos(k) * 90, 500 + Math.sin(k) * 45));
    expect(Math.max(...around) - Math.min(...around)).toBeGreaterThan(0.05);
  });

  it('keeps high-readability lighting meaningful: half the render darkness', () => {
    expect(renderDarkness(1, false)).toBeCloseTo(DARKNESS.renderStrength, 3);
    expect(renderDarkness(1, true)).toBeCloseTo(DARKNESS.renderStrength * DARKNESS.readabilityScale, 3);
    // An ordinary cave (0.3) barely dims; the render curve is gamma'd.
    expect(renderDarkness(0.3, false)).toBeLessThan(0.1);
    expect(renderOpenLut(false)[0]).toBe(1);
  });

  it('bakes nothing for a fully readable level and caches per runtime', () => {
    expect(darkMapFor({ def: { id: 'physics-test' } })).toBeNull();
    const rt = { def: { id: 'd1' }, darkZones: [UNDERTOW] };
    const a = darkMapFor(rt);
    expect(a).not.toBeNull();
    expect(darkMapFor(rt)).toBe(a);
    // The Bellows has no base darkness: the lamp-lit Works stay readable.
    expect(FLOOR_DARKNESS.d1.base).toBe(0);
    expect(a![Math.floor(300 / DARK_CELL) * DARK_W + Math.floor(400 / DARK_CELL)]).toBe(255);
  });
});

/**
 * DARKNESS FOLLOWS THE ROCK (fix3): the dark zones read as rectangles — a light
 * puzzle room's zone box (the room plus a 20-cell margin, feathered 30) was
 * drawn over whatever lay under it, so its straight edges ran through lit
 * caves and across solid rock. Given the level's grid, a zone's dark now
 * travels only through what connects to its own air.
 */
describe('designed darkness follows the rock', () => {
  const ROOM = { x0: 300, y0: 260, x1: 500, y1: 340 };
  const ZONE: DarkZone = { x: 400, y: 300, rx: 120, ry: 90, shape: 'rect' };
  function grid(): World {
    const w = new World();
    w.types.fill(Cell.Stone);
    const open = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.types[w.idx(x, y)] = Cell.Empty;
    };
    open(ROOM.x0, ROOM.y0, ROOM.x1, ROOM.y1);
    open(501, 296, 700, 312); // a corridor out of the room's east side, through the zone's edge
    open(290, 212, 480, 224); // a separate cave inside the zone's box (in its feathered rim), 35 cells of rock above the room
    return w;
  }

  it('keeps a separate cave inside the zone box lit', () => {
    const map = bakeDarkMap([ZONE], { base: 0, deep: 1 }, undefined, grid());
    expect(sampleDarkMap(map, 400, 300)).toBeCloseTo(1, 2); // the room is black
    // The geometric shape shades that cave (it lies inside the box's rim)…
    let geometric = 0, followed = 0;
    const box = bakeDarkMap([ZONE], { base: 0, deep: 1 });
    for (let x = 300; x <= 470; x += 2) { geometric += sampleDarkMap(box, x, 222); followed += sampleDarkMap(map, x, 222); }
    expect(geometric).toBeGreaterThan(1);
    // …the rock-following dark does not reach it at all.
    expect(followed).toBe(0);
  });

  it('fades along a corridor out of the zone instead of stopping at a drawn edge', () => {
    const map = bakeDarkMap([ZONE], { base: 0, deep: 1 }, undefined, grid());
    const along: number[] = [];
    for (let x = 500; x <= 640; x += 2) along.push(sampleDarkMap(map, x, 304));
    expect(along[0]).toBeGreaterThan(0.9);
    expect(along[along.length - 1]).toBeLessThan(0.02);
    // No cliff: the largest texel-to-texel drop is a small fraction of the fall.
    let steepest = 0;
    for (let i = 1; i < along.length; i++) steepest = Math.max(steepest, along[i - 1] - along[i]);
    expect(steepest).toBeLessThan(0.15);
    // ...and it is not a straight line across the corridor: the fade wanders
    // with height as well as distance (compare the corridor's top and bottom rows).
    let skew = 0;
    for (let x = 500; x <= 560; x += 2) skew = Math.max(skew, Math.abs(sampleDarkMap(map, x, 297) - sampleDarkMap(map, x, 311)));
    expect(skew).toBeGreaterThan(0.01);
  });

  it('soaks only a few cells into solid rock, so the zone box never shows in it', () => {
    const map = bakeDarkMap([ZONE], { base: 0, deep: 1 }, undefined, grid());
    // Rock just past the room's floor darkens; rock 18 cells in (still inside
    // the zone box) keeps its light.
    expect(sampleDarkMap(map, 360, 344)).toBeGreaterThan(0.5);
    expect(sampleDarkMap(map, 360, 358)).toBeLessThan(0.15);
  });

  it('gameplay reads the same map the renderer draws', () => {
    const rt = { def: { id: 'd2' }, darkZones: [ZONE], world: grid() };
    const q = new LightQuery(ctxWith(rt as unknown as LevelRuntime), field());
    expect(q.darkness(400, 300)).toBeCloseTo(1, 2);
    expect(q.darkness(400, 222)).toBeCloseTo(FLOOR_DARKNESS.d2.base, 2);
    expect(q.darkness(400, 222)).toBe(sampleDarkMap(darkMapFor(rt), 400, 222));
  });
});

/**
 * SMOOTH DARKNESS (fix4b): the map is one texel per two cells, and sampling it
 * nearest drew every dark edge as a staircase of 2-cell (5-8 px) steps. The
 * map is now read bilinearly between texel centres by gameplay AND by every
 * compose path (openAtCell over fillOpenField), so the two stay the same.
 */
describe('designed darkness reads smooth', () => {
  const ROOM = { x0: 300, y0: 260, x1: 500, y1: 340 };
  const ZONE: DarkZone = { x: 400, y: 300, rx: 120, ry: 90, shape: 'rect' };
  function grid(): World {
    const w = new World();
    w.types.fill(Cell.Stone);
    for (let y = ROOM.y0; y <= ROOM.y1; y++) for (let x = ROOM.x0; x <= ROOM.x1; x++) w.types[w.idx(x, y)] = Cell.Empty;
    for (let y = 296; y <= 312; y++) for (let x = 501; x <= 700; x++) w.types[w.idx(x, y)] = Cell.Empty;
    return w;
  }

  it('has no texel steps: neighbouring cells never jump', () => {
    const map = bakeDarkMap([ZONE], { base: 0, deep: 1 }, undefined, grid());
    const nearest = (x: number, y: number): number => map[Math.floor(y / DARK_CELL) * DARK_W + Math.floor(x / DARK_CELL)] / 255;
    let steepestX = 0, steepestY = 0, stepX = 0, stepY = 0;
    // Across the corridor fade (air) and down through the room's floor (rock soak).
    for (let x = 480; x < 640; x++) {
      steepestX = Math.max(steepestX, Math.abs(sampleDarkMap(map, x + 1, 304) - sampleDarkMap(map, x, 304)));
      stepX = Math.max(stepX, Math.abs(nearest(x + 1, 304) - nearest(x, 304)));
    }
    for (let y = 330; y < 370; y++) {
      steepestY = Math.max(steepestY, Math.abs(sampleDarkMap(map, 360, y + 1) - sampleDarkMap(map, 360, y)));
      stepY = Math.max(stepY, Math.abs(nearest(360, y + 1) - nearest(360, y)));
    }
    // The texel read stepped the whole texel-to-texel change at once; the
    // smooth read spreads it over the two cells (about half per cell).
    expect(steepestX).toBeLessThan(0.07);
    expect(steepestY).toBeLessThan(0.15);
    expect(steepestX).toBeLessThan(stepX * 0.6);
    expect(steepestY).toBeLessThan(stepY * 0.6);
    // A cell-by-cell walk is continuous: the two cells of one texel differ.
    expect(sampleDarkMap(map, 360.5, 350)).not.toBe(sampleDarkMap(map, 361.5, 350));
  });

  it('draws what gameplay reads: the compose open factor matches the dark map at every cell', () => {
    const map = bakeDarkMap([ZONE], { base: 0.3, deep: 1 }, undefined, grid());
    const lut = renderOpenLut(false);
    for (const [ox, oy] of [[380, 180], [381, 181], [440, 250]]) {
      const LW = 161, LH = 91;
      const open = new Float32Array(LW * LH);
      fillOpenField(map, lut, ox, oy, LW, LH, open);
      let worst = 0;
      for (let vy = 1; vy < (LH - 1) * 2; vy++) {
        for (let vx = 1; vx < (LW - 1) * 2; vx++) {
          const drawn = openAtCell(open, LW, LH, vx, vy);
          const read = lut[Math.round(sampleDarkMap(map, ox + vx + 0.5, oy + vy + 0.5) * 255)];
          worst = Math.max(worst, Math.abs(drawn - read));
        }
      }
      expect(worst).toBeLessThan(0.06);
    }
  });

  it('fills the light field exactly as the gameplay read samples it, at any origin', () => {
    const map = bakeDarkMap([ZONE], { base: 0.3, deep: 1 }, undefined, grid());
    const lut = renderOpenLut(true), LW = 40, LH = 30, out = new Float32Array(LW * LH);
    for (const [ox, oy] of [[380, 180], [381, 181], [-7, -5], [1590, 1050], [441, 262]]) {
      fillOpenField(map, lut, ox, oy, LW, LH, out);
      for (let ly = 0; ly < LH; ly++) for (let lx = 0; lx < LW; lx++) {
        const d = sampleDarkMap(map, ox + lx * 2 + 1, oy + ly * 2 + 1);
        expect(out[ly * LW + lx]).toBe(lut[Math.round(d * 255)]);
      }
    }
  });

  it('a loose heap in a dark room goes dark with the room (only structure soaks slowly)', () => {
    const w = grid();
    // A sand dune on the room floor, 14 cells tall and 60 wide.
    for (let y = 326; y <= 340; y++) for (let x = 330; x <= 390; x++) w.types[w.idx(x, y)] = Cell.Sand;
    const map = bakeDarkMap([ZONE], { base: 0, deep: 1 }, undefined, w);
    expect(sampleDarkMap(map, 360, 336)).toBeGreaterThan(0.95);
    // The same heap in stone keeps its light (the rock-soak rule is unchanged).
    for (let y = 326; y <= 340; y++) for (let x = 330; x <= 390; x++) w.types[w.idx(x, y)] = Cell.Stone;
    const rock = bakeDarkMap([ZONE], { base: 0, deep: 1 }, undefined, w);
    expect(sampleDarkMap(rock, 360, 336)).toBeLessThan(sampleDarkMap(map, 360, 336));
  });
});

describe('LightQuery (the LightQueryApi contract)', () => {
  it('level: ambient + the built field, clamped to 2', () => {
    const f = field();
    const i = ((210 - 200) >> 1) * f.LW + ((120 - 100) >> 1);
    f.lightR[i] = 0.5; f.lightG[i] = 0.9; f.lightB[i] = 0.2;
    const q = new LightQuery(ctxWith(null), f);
    const amb = createGameParams().global.ambient;
    expect(q.level(120, 210)).toBeCloseTo(amb + 0.9, 5);
    f.lightG[i] = 5;
    expect(q.level(120, 210)).toBe(2);
  });

  it('level: an off-view point reads as unlit (ambient only)', () => {
    const q = new LightQuery(ctxWith(null), field());
    expect(q.level(5000, 5000)).toBeCloseTo(createGameParams().global.ambient, 5);
  });

  it('level: designed darkness removes the ambient in the dark', () => {
    const f = field();
    f.lightOpen.fill(0.035);
    const q = new LightQuery(ctxWith(null), f);
    expect(q.level(110, 210)).toBeLessThan(0.02);
  });

  it('wandLight reads the wand field and is 0 while hooded', () => {
    const f = field();
    const i = ((220 - 200) >> 1) * f.LW + ((130 - 100) >> 1);
    f.wandField[i] = 0.64;
    const ctx = ctxWith(null);
    const q = new LightQuery(ctx, f);
    expect(q.wandLight(130, 220)).toBeCloseTo(0.64, 5);
    expect(q.wandLight(131, 221)).toBeCloseTo(0.64, 5); // same half-res texel
    expect(q.hooded).toBe(false);
    ctx.state.lanternHooded = true;
    expect(q.hooded).toBe(true);
    expect(q.wandLight(130, 220)).toBe(0);
  });

  it('reads nothing before the first light build', () => {
    const f = { ...field(), built: false };
    const q = new LightQuery(ctxWith(null), f);
    expect(q.wandLight(110, 210)).toBe(0);
  });

  it('darkness is by design, everywhere on the level (not only in view)', () => {
    const rt = { def: { id: 'd2' }, darkZones: [UNDERTOW] } as unknown as LevelRuntime;
    const q = new LightQuery(ctxWith(rt), field());
    expect(q.darkness(400, 300)).toBeCloseTo(1, 2);
    expect(q.darkness(1200, 900)).toBeCloseTo(FLOOR_DARKNESS.d2.base, 2);
    expect(new LightQuery(ctxWith(null), field()).darkness(400, 300)).toBe(0);
  });
});
