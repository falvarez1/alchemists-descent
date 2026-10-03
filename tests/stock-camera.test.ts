import { describe, expect, it } from 'vitest';
import { StockCameraRig } from '@/render/StockCameraRig';

const fighter = (x: number, y = 610, vx = 0, vy = 0) => ({ x, y, vx, vy });
describe('stock camera composition', () => {
  it('closes in for melee and fits widely separated fighters with recovery margin', () => {
    const rig = new StockCameraRig();
    for (let i = 0; i < 240; i++) rig.step([fighter(790), fighter(815)]);
    expect(rig.zoom).toBeGreaterThan(1.5);
    for (let i = 0; i < 120; i++) rig.step([fighter(300), fighter(1300, 750)]);
    expect(rig.zoom).toBeLessThan(.6);
    expect(rig.x - 320 / rig.zoom).toBeLessThan(260);
    expect(rig.x + 320 / rig.zoom).toBeGreaterThan(1340);
    expect(rig.y + 180 / rig.zoom).toBeGreaterThan(800);
  });
  it('pulls back faster than it closes and anticipates outward launch velocity', () => {
    const rig = new StockCameraRig(); rig.reset(800, 550, 1.5);
    rig.step([fighter(550, 600, -12), fighter(1050, 600, 12)]);
    const out = 1.5 - rig.zoom;
    rig.reset(800, 550, .7); rig.step([fighter(790), fighter(810)]);
    expect(out).toBeGreaterThan(rig.zoom - .7);
  });
  it('frames vertical separation across the blast box without exposing world boundaries', () => {
    const rig = new StockCameraRig();
    for (let i = 0; i < 240; i++) rig.step([fighter(800, 185), fighter(800, 930)]);
    expect(rig.y - 180 / rig.zoom).toBeLessThan(150);
    expect(rig.y + 180 / rig.zoom).toBeGreaterThan(980);
    expect(rig.x - 320 / rig.zoom).toBeGreaterThanOrEqual(0);
    expect(rig.x + 320 / rig.zoom).toBeLessThanOrEqual(1600);
  });
  it('holds steady under tiny footwork and does not chase absent fighters', () => {
    const rig = new StockCameraRig();
    for (let i = 0; i < 240; i++) rig.step([fighter(790), fighter(810)]);
    const x = rig.x, y = rig.y;
    for (let i = 0; i < 60; i++) rig.step([fighter(790 + i % 3), fighter(810 - i % 3)]);
    expect(rig.x).toBeCloseTo(x, 4); expect(rig.y).toBeCloseTo(y, 4);
    const zoom = rig.zoom; rig.step([]);
    expect(rig.x).toBe(x); expect(rig.zoom).toBe(zoom);
  });
});
