import { describe, expect, it } from 'vitest';
import type { PixelSurface } from '@/render/pixels';
import { INK, Pen, type RGB } from '@/render/sprites/FineArt';

/** A fine surface that keeps the last colour written to each half-cell pixel (setFinePx semantics). */
function surface(): { out: PixelSurface; pixels: Map<string, string> } {
  const pixels = new Map<string, string>();
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    pixels.set(`${Math.round(x * 2)},${Math.round(y * 2)}`, `${r.toFixed(6)},${g.toFixed(6)},${b.toFixed(6)}`);
  };
  const out = { pixelStep: 0.5, setPx: put, setFinePx: put, addPx: () => {}, addFinePx: () => {} } as unknown as PixelSurface;
  return { out, pixels };
}

/** rod() as it shipped: three full passes. */
function shippedRod(p: Pen, ax: number, ay: number, bx: number, by: number, c: RGB, width: number): void {
  const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
  p.line(ax, ay, bx, by, INK, width + p.step * 2);
  p.line(ax, ay, bx, by, c, width);
  const lift = -Math.max(0, (width - p.step) / 2) + p.step * 0.5;
  const side = nx - ny < 0 ? 1 : -1;
  p.line(ax + nx * lift * side, ay + ny * lift * side, bx + nx * lift * side, by + ny * lift * side, c, 0, 1.35);
}

describe('Pen.rod (fix4b: the ink outline skips what the core repaints)', () => {
  it('draws exactly the pixels the three full passes drew', () => {
    const colour: RGB = [0.4, 0.35, 0.3];
    const cases: Array<[number, number, number, number, number]> = [
      [10, 42, 10, 256, 1], [13.5, 40, 13.5, 90, 1], [5, 20, 60, 20, 0.75], [0, 0, 37, 21, 1], [3.25, 7.5, -20, 44, 1.5],
      [0, 0, 30, 30, 1.2], [2, 2, 40, 9, 0.6], [1, 1, 1, 30, 0.5], [0, 0, 25, -12, 2],
    ];
    for (const [ax, ay, bx, by, width] of cases) {
      const a = surface(), b = surface();
      new Pen(a.out, { x0: -100, y0: -100, x1: 400, y1: 400 }, [0.9, 0.8, 0.7]).rod(ax, ay, bx, by, colour, width);
      shippedRod(new Pen(b.out, { x0: -100, y0: -100, x1: 400, y1: 400 }, [0.9, 0.8, 0.7]), ax, ay, bx, by, colour, width);
      expect(a.pixels.size).toBe(b.pixels.size);
      for (const [k, v] of b.pixels) expect(a.pixels.get(k)).toBe(v);
    }
  });
});
