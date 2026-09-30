import { describe, expect, it } from 'vitest';

import { WAYPOINT_CLEAR, WAYPOINT_EDGE, rimPoint, rimPointAvoiding, type PctRect } from '@/ui/waypointRim';

const hudTopLeft: PctRect = { x0: 0, y0: 0, x1: 30, y1: 46 };

describe('waypoint rim', () => {
  it('reproduces the old clamp: the ray from the centre meets a rim 8% in', () => {
    expect(rimPoint(-100, 0)).toEqual({ x: WAYPOINT_EDGE, y: 50 });
    expect(rimPoint(0, 300)).toEqual({ x: 50, y: 100 - WAYPOINT_EDGE });
    const corner = rimPoint(-200, -200);
    expect(corner.x).toBeCloseTo(WAYPOINT_EDGE, 6);
    expect(corner.y).toBeCloseTo(WAYPOINT_EDGE, 6);
    // A target already inside the rim is not pushed out.
    expect(rimPoint(10, 10)).toEqual({ x: 60, y: 60 });
  });

  it('is the plain clamp with no HUD in the way', () => {
    expect(rimPointAvoiding(-100, -100, [])).toEqual(rimPoint(-100, -100));
  });

  it('slides the arrow off the top-left HUD along the rim to the nearer free side', () => {
    // Up and to the left: the plain clamp is the corner, under the hotbar.
    const p = rimPointAvoiding(-100, -100, [hudTopLeft]);
    // Nearest free spot round the corner: along the top rim past the block (26%) or down the left (42%).
    expect(p.y).toBeCloseTo(WAYPOINT_EDGE, 6); // stays on the top rim…
    expect(p.x).toBeGreaterThanOrEqual(hudTopLeft.x1 + WAYPOINT_CLEAR); // …just past the block
    expect(p.x).toBeLessThan(hudTopLeft.x1 + WAYPOINT_CLEAR + 0.6);
  });

  it('slides down the left rim for a target left of the HUD block', () => {
    // Left and a little up: the clamp lands on the left rim inside the block's rows.
    const p = rimPointAvoiding(-100, -20, [hudTopLeft]);
    expect(p.x).toBeCloseTo(WAYPOINT_EDGE, 6);
    // Just below the block, to the half-percent the scan walks in.
    expect(p.y).toBeGreaterThanOrEqual(hudTopLeft.y1 + WAYPOINT_CLEAR);
    expect(p.y).toBeLessThan(hudTopLeft.y1 + WAYPOINT_CLEAR + 0.6);
  });

  it('leaves a clear spot alone', () => {
    expect(rimPointAvoiding(100, 100, [hudTopLeft])).toEqual(rimPoint(100, 100));
    // On the top rim but to the right of the block.
    const p = rimPointAvoiding(60, -100, [hudTopLeft]);
    expect(p).toEqual(rimPoint(60, -100));
  });

  it('steps past two blocks in a row, whichever way round is shorter', () => {
    const second: PctRect = { x0: 34, y0: 0, x1: 50, y1: 20 };
    const p = rimPointAvoiding(-100, -100, [hudTopLeft, second]);
    for (const block of [hudTopLeft, second]) {
      const hit = p.x > block.x0 - WAYPOINT_CLEAR && p.x < block.x1 + WAYPOINT_CLEAR && p.y > block.y0 - WAYPOINT_CLEAR && p.y < block.y1 + WAYPOINT_CLEAR;
      expect(hit).toBe(false);
    }
    // Still on the rim.
    const onRim = [p.x, p.y].some((v) => Math.abs(v - WAYPOINT_EDGE) < 1e-6 || Math.abs(v - (100 - WAYPOINT_EDGE)) < 1e-6);
    expect(onRim).toBe(true);
  });

  it('never loses the arrow: a rim covered end to end gives the plain clamp back', () => {
    const everything: PctRect = { x0: -10, y0: -10, x1: 110, y1: 110 };
    expect(rimPointAvoiding(-100, -100, [everything])).toEqual(rimPoint(-100, -100));
  });
});
