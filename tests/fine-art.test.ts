import { describe, expect, it } from 'vitest';
import type { PixelSurface } from '@/render/pixels';
import { BRASS_L, CellCapture, Pen, blitCellArt, epxQuadrant, viewIntersects, type RGB } from '@/render/sprites/FineArt';
import { interpolateBody } from '@/render/RenderPoses';

type Recorded = Map<string, RGB>;
const key = (x: number, y: number): string => `${x},${y}`;
const parse = (k: string): [number, number] => k.split(',').map(Number) as [number, number];

/** A half-cell presentation surface: setPx paints 2x2, setFinePx one pixel. */
function fineSurface(): { s: PixelSurface; fine: Recorded; adds: Array<[number, number]> } {
  const fine: Recorded = new Map(), adds: Array<[number, number]> = [];
  const s: PixelSurface = {
    pixelStep: 0.5,
    setPx(x, y, r, g, b) {
      for (const dy of [0, 0.5]) for (const dx of [0, 0.5]) fine.set(key(Math.round(x) + dx, Math.round(y) + dy), [r, g, b]);
    },
    addPx(x, y) { adds.push([x, y]); },
    setFinePx(x, y, r, g, b) { fine.set(key(Math.round(x * 2) / 2, Math.round(y * 2) / 2), [r, g, b]); },
    addFinePx(x, y) { adds.push([x, y]); },
  };
  return { s, fine, adds };
}

/** A classic cell surface without any fine writer. */
function cellSurface(): { s: PixelSurface; cells: Recorded } {
  const cells: Recorded = new Map();
  const s: PixelSurface = {
    setPx(x, y, r, g, b) { cells.set(key(Math.round(x), Math.round(y)), [r, g, b]); },
    addPx() {},
  };
  return { s, cells };
}

const WHITE: RGB = [1, 1, 1], RIM: RGB = [0, 0, 0.1];
const isRim = (c: RGB | undefined): boolean => !!c && c[0] === 0 && c[2] === 0.1;

describe('presentation-resolution sprite kit', () => {
  it('EPX carves outer corners, fills staircase diagonals and keeps one-cell lines', () => {
    const a: RGB = [1, 0, 0], b: RGB = [0, 1, 0];
    // up and left empty, down and right solid: an outer corner is carved away
    expect(epxQuadrant(a, undefined, undefined, a, a)).toBeUndefined();
    // two agreeing neighbours of another colour fill the diagonal
    expect(epxQuadrant(a, b, b, a, a)).toEqual(b);
    // the end of a one-cell line keeps its square corner (the far side is empty too)
    expect(epxQuadrant(a, undefined, undefined, a, undefined)).toEqual(a);
  });

  it('re-emits a captured block at half-cell resolution with a one-pixel rim above the feet', () => {
    const capture = new CellCapture();
    for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) capture.setPx(x, y, ...WHITE);
    const { s, fine } = fineSurface();
    capture.flush(s, { rim: RIM, feetY: 12 });
    const body = [...fine.entries()].filter(([, c]) => c[0] === 1);
    const rim = [...fine.entries()].filter(([, c]) => isRim(c));
    expect(body).toHaveLength(36 - 4); // 3x3 cells -> 6x6 presentation pixels, four corners carved
    expect(rim.length).toBeGreaterThan(0);
    for (const [k] of rim) {
      const [x, y] = parse(k);
      expect(y).toBeLessThanOrEqual(12.5); // nothing below the feet row
      const touchesBody = [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].some(([dx, dy]) => fine.get(key(x + dx, y + dy))?.[0] === 1);
      expect(touchesBody).toBe(true); // one presentation pixel thick, hugging the carved silhouette
    }
    expect(fine.get(key(10, 10))?.[0]).not.toBe(1); // the carved corner is rim or empty, never body
  });

  it('is the byte-for-byte cell drawing on a classic surface', () => {
    const capture = new CellCapture();
    for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) capture.setPx(x, y, ...WHITE);
    const { s, cells } = cellSurface();
    capture.flush(s, { rim: RIM, feetY: 12 });
    expect([...cells.values()].filter(c => c[0] === 1)).toHaveLength(9);
    // the 4-neighbour rim of a 3x3 block is 12 cells; the three below the feet are skipped
    expect([...cells.values()].filter(isRim)).toHaveLength(9);
  });

  it('shifts a layer by whole presentation pixels for sub-cell motion', () => {
    const capture = new CellCapture();
    capture.setPx(20, 20, ...WHITE);
    const { s, fine } = fineSurface();
    capture.flush(s, { subX: 0.5 });
    expect(fine.has(key(20.5, 20))).toBe(true);
    expect(fine.has(key(21, 20.5))).toBe(true);
    expect(fine.has(key(20, 20))).toBe(false);
  });

  it('blits bitmap art through the same upsample and falls back to cells', () => {
    const { s, fine } = fineSurface();
    blitCellArt(s, 2, 2, () => 0xff8000, 5, 5);
    expect(fine.size).toBe(16 - 4);
    const { s: legacy, cells } = cellSurface();
    blitCellArt(legacy, 2, 2, (px, py) => (px === 1 && py === 1 ? -1 : 0xff8000), 5, 5);
    expect(cells.size).toBe(3);
    expect(cells.get(key(5, 5))).toEqual([1, 128 / 255, 0]);
  });

  it('culls strokes and pixels outside the composed view', () => {
    const { s, fine } = fineSurface();
    const pen = new Pen(s, { x0: 0, y0: 0, x1: 100, y1: 100 });
    pen.line(200, 200, 300, 300, WHITE);
    pen.disc(400, 400, 5, WHITE);
    pen.px(150, 150, WHITE);
    expect(fine.size).toBe(0);
    pen.line(10, 10, 20, 20, WHITE);
    expect(fine.size).toBeGreaterThan(10);
  });

  it('turns a wheel\'s spokes while the lamp highlight stays put', () => {
    const draw = (angle: number): Recorded => {
      const { s, fine } = fineSurface();
      new Pen(s).wheel(50, 50, 8, angle, { spokes: 4 });
      return fine;
    };
    const still = draw(0), turned = draw(0.6);
    const differs = [...still.keys()].some(k => JSON.stringify(still.get(k)) !== JSON.stringify(turned.get(k)));
    expect(differs).toBe(true);
    const highlight = (fine: Recorded): number => [...fine.values()].filter(c => c[0] === BRASS_L[0] && c[1] === BRASS_L[1]).length;
    expect(highlight(still)).toBeGreaterThan(0);
    expect(highlight(turned)).toBe(highlight(still));
  });

  it('interpolates rigid bodies between fixed ticks and snaps teleports', () => {
    expect(interpolateBody({ x: 10, y: 4, angle: 1, previousX: 0, previousY: 0, previousAngle: 0 }, 0.5)).toEqual({ x: 5, y: 2, angle: 0.5 });
    expect(interpolateBody({ x: 500, y: 0, angle: 0, previousX: 0, previousY: 0, previousAngle: 0 }, 0.5).x).toBe(500);
    expect(interpolateBody({ x: 3, y: 3, angle: 2 }, 0.25)).toEqual({ x: 3, y: 3, angle: 2 });
  });

  it('tests landmark boxes against the view the composer draws, not the camera corner', () => {
    // The sluice handwheel's box, with the camera framing it in the right
    // quarter of the view: the old corner-distance test culled this.
    expect(viewIntersects({ renderX: 30, renderY: 170 }, 508, 343, 540, 383)).toBe(true);
    // ...and at the bottom of the view.
    expect(viewIntersects({ renderX: 280, renderY: 20 }, 508, 343, 540, 383)).toBe(true);
    expect(viewIntersects({ renderX: 30, renderY: 170 }, 700, 343, 740, 383)).toBe(false);
    expect(viewIntersects({ renderX: 30, renderY: 170 }, 508, 560, 540, 600)).toBe(false);
  });
});
