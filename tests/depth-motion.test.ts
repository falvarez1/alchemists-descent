import { describe, expect, it } from 'vitest';
import { MaskPlane } from '@/render/depth/raster';
import { chain, gear } from '@/render/depth/motifs';
import { depthKitFor } from '@/config/depthKits';
import { bakePlane, bakeForeground } from '@/render/depth/bake';
import { planeMotionCount, updatePlaneMotion } from '@/render/depth/MachineryMotion';
import { lanternFlicker } from '@/config/ambientMotion';
import { DataTexture, Object3D, ShaderMaterial } from 'three';
import type { Ctx } from '@/core/types';
import { ForegroundState } from '@/render/depth/DepthScene';
import { ForegroundLayerGL } from '@/render/depth/ForegroundGL';

describe('Ambient mechanical motion', () => {
  it('turns the actual gear teeth and spokes while keeping its axle fixed', () => {
    const a = new MaskPlane(150, 150, false), b = new MaskPlane(150, 150, false);
    gear(a, 75, 75, 45, 18, 6, 1, 0);
    gear(b, 75, 75, 45, 18, 6, 1, .14);
    expect(a.mat).not.toEqual(b.mat);
    expect(a.get(75, 75)).toBe(1); expect(b.get(75, 75)).toBe(1);
  });

  it('sways chain links between their sockets without moving either attachment', () => {
    const a = new MaskPlane(100, 120, false), b = new MaskPlane(100, 120, false);
    chain(a, 50, 20, 60, 1, 2, 0);
    chain(b, 50, 20, 60, 1, 2, 4);
    expect(a.mat).not.toEqual(b.mat);
    for (let x = 44; x < 57; x++) expect(a.get(x, 20)).toBe(b.get(x, 20));
  });

  it('moves pieces inside a real depth plane, caches a tick and returns exactly to a previous pose', () => {
    const kit = depthKitFor('earthen');
    const slot = kit.planes.findIndex(p => p.source.kind === 'art' && p.source.art === 'bellows-near');
    const plane = bakePlane(kit, slot, null)!;
    expect(planeMotionCount(plane)).toBeGreaterThan(3);
    updatePlaneMotion(plane, 60); const first = plane.pixels.slice();
    expect(updatePlaneMotion(plane, 61)).toBe(false);
    updatePlaneMotion(plane, 360); expect(plane.pixels).not.toEqual(first);
    updatePlaneMotion(plane, 60); expect(plane.pixels).toEqual(first);
  });

  it('animates the existing foreground machinery too', () => {
    const plane = bakeForeground(depthKitFor('earthen'), 'd1', 2080, 1600)!;
    expect(planeMotionCount(plane)).toBeGreaterThan(3);
    const before = plane.pixels.slice(); updatePlaneMotion(plane, 180);
    expect(plane.pixels).not.toEqual(before);
  });

  it('gives the visible lamp glow and flame bounded irregular flicker', () => {
    const values = Array.from({ length: 360 }, (_, tick) => lanternFlicker(tick, 2.3, .2));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(.2);
    expect(Math.min(...values)).toBeGreaterThan(.7);
    expect(Math.max(...values)).toBeLessThan(1.2);
    expect(lanternFlicker(60, 2.3, .2)).toBe(values[60]);
  });

  it('updates moving foreground pixels without recreating the GPU texture', () => {
    const source = new ForegroundState();
    source.enabled = true; source.opacity = .5;
    source.bitmap = { width: 20, height: 20, pixels: new Uint8ClampedArray(1600) };
    const layer = new ForegroundLayerGL(source), quad = new Object3D();
    const ctx = { camera: { renderX: 0, renderY: 0, x: 0, y: 0 }, state: { mode: 'play' } } as unknown as Ctx;
    try {
      layer.update(ctx, quad, false);
      const material = layer.mesh.material as ShaderMaterial;
      const first = material.uniforms.uFg.value as DataTexture;
      source.bitmap.pixels[0] = 127; source.version++;
      layer.update(ctx, quad, false);
      expect(material.uniforms.uFg.value).toBe(first);
      expect(first.image.data[0]).toBe(127);
      source.bitmap = { width: 10, height: 10, pixels: new Uint8ClampedArray(400) }; source.version++;
      layer.update(ctx, quad, false);
      expect(material.uniforms.uFg.value).not.toBe(first);
    } finally { layer.dispose(); }
  });
});
