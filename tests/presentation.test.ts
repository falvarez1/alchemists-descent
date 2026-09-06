import { describe, expect, it } from 'vitest';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { FrameComposer } from '@/render/FrameComposer';
import { cameraPresentationOffset } from '@/render/presentation';
import type { LightField, OverlaySurface, ParallaxLayers, RenderTarget } from '@/render/pixels';

describe('sub-cell presentation surface', () => {
  it('uses the composed camera snapshot when interpolation crosses a cell boundary', () => {
    expect(cameraPresentationOffset({ x: 20.03, y: 30.12, renderX: 19, renderY: 29, presentationX: 19.95, presentationY: 29.98 }))
      .toEqual({ x: 19.95 - 19, y: 29.98 - 29 });
  });
  it('preserves cell-sized effects while allowing distinct half-cell art pixels', () => {
    const target = { pixelData: new Float32Array(VIEW_W * VIEW_H * 4) } as unknown as RenderTarget;
    const composer = new FrameComposer(target, {} as LightField, {} as ParallaxLayers, () => {}, () => {}, () => {}, () => {});
    const touched = new Set<number>();
    const overlay: OverlaySurface = { scale: 2, data: new Float32Array(VIEW_W * VIEW_H * 16), mark: i => { touched.add(i); } };
    (composer as unknown as { overlay: OverlaySurface }).overlay = overlay;
    const at = (x: number, y: number) => ((VIEW_H * 2 - 1 - y * 2) * VIEW_W * 2 + x * 2) * 4;
    composer.setPx(10, 10, 1, 0, 0);
    expect(touched.size).toBe(4);
    expect(composer.pixelStep).toBe(.5);
    composer.setFinePx(10.5, 10, 0, 1, 0);
    expect(Array.from(overlay.data.slice(at(10.5, 10), at(10.5, 10) + 4))).toEqual([0, 1, 0, 1]);
    expect(overlay.data[at(10, 10)]).toBe(1);
    composer.addPx(10, 10, 0, 0, .5);
    expect(overlay.data[at(10.5, 10) + 2]).toBe(.5);
    expect(overlay.data[at(10, 10.5) + 2]).toBe(.5);
    composer.setFinePx(-1, 10, 1, 1, 1);
    composer.setFinePx(VIEW_W, 10, 1, 1, 1);
    expect(touched.size).toBe(4);
  });
});
