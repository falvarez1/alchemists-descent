import { describe, expect, it } from 'vitest';

import {
  LEG_IK_FLAG_ANGULAR_LIMITED,
  LEG_IK_FLAG_ENVELOPE_CLAMPED,
  LEG_IK_FLAG_EXTENSION_CLAMPED,
  solveConstrainedLegIk,
} from '@/render/animation/ConstrainedLegIk';

describe('constrained procedural leg IK', () => {
  it('clamps overextended targets before the chain can lock straight', () => {
    const solved = solveConstrainedLegIk({
      hip: { x: 0, y: 0 },
      target: { x: 200, y: 0 },
      lengths: [30, 25, 25],
      pole: { x: 0, y: -1 },
      limits: { maxExtension: 0.9, minFlex: 0.32, maxFlex: 2.5 },
    });

    expect(solved.state.flags & LEG_IK_FLAG_EXTENSION_CLAMPED).not.toBe(0);
    expect(solved.state.extension).toBeLessThanOrEqual(0.91);
    expect(solved.state.upperFlex).toBeGreaterThan(0.25);
    expect(solved.state.lowerFlex).toBeGreaterThan(0.25);
    expect(solved.state.upperFlex).toBeLessThan(2.6);
    expect(solved.state.lowerFlex).toBeLessThan(2.6);
    expect(solved.state.poleSide).toBeGreaterThan(0);
  });

  it('keeps a foot target inside a body-local side envelope', () => {
    const solved = solveConstrainedLegIk({
      hip: { x: 100, y: 100 },
      target: { x: 155, y: 80 },
      lengths: [24, 22, 20],
      pole: { x: -0.4, y: -1 },
      envelope: {
        basisX: { x: 1, y: 0 },
        basisY: { x: 0, y: -1 },
        minX: -70,
        maxX: -8,
        minY: -38,
        maxY: 32,
      },
      limits: { maxExtension: 0.9, minFlex: 0.3, maxFlex: 2.45 },
    });

    expect(solved.state.flags & LEG_IK_FLAG_ENVELOPE_CLAMPED).not.toBe(0);
    expect(solved.foot.x).toBeLessThan(100);
    expect(solved.state.upperFlex).toBeGreaterThan(0.22);
    expect(solved.state.poleSide).toBeGreaterThan(0);
  });

  it('limits segment angular velocity between frames', () => {
    const first = solveConstrainedLegIk({
      hip: { x: 0, y: 0 },
      target: { x: 55, y: 8 },
      lengths: [24, 20, 18],
      pole: { x: 0, y: -1 },
      limits: { maxExtension: 0.88, minFlex: 0.3, maxFlex: 2.4, maxAngularStep: 0.2 },
    });
    const second = solveConstrainedLegIk({
      hip: { x: 0, y: 0 },
      target: { x: -50, y: -24 },
      lengths: [24, 20, 18],
      pole: { x: 0, y: -1 },
      limits: { maxExtension: 0.88, minFlex: 0.3, maxFlex: 2.4, maxAngularStep: 0.2 },
      previous: first.state,
    });

    expect(second.state.flags & LEG_IK_FLAG_ANGULAR_LIMITED).not.toBe(0);
    expect(Math.abs(angleDelta(first.state.upperAngle, second.state.upperAngle))).toBeLessThanOrEqual(0.201);
    expect(Math.abs(angleDelta(first.state.lowerAngle, second.state.lowerAngle))).toBeLessThanOrEqual(0.201);
    expect(Math.abs(angleDelta(first.state.footAngle, second.state.footAngle))).toBeLessThanOrEqual(0.201);
  });
});

function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
