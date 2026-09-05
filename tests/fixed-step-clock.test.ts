import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '@/game/FixedStepClock';

describe('fixed simulation clock', () => {
  it.each([30, 60, 120, 144, 240])('advances 600 ticks in ten seconds at %i Hz', (hz) => {
    const clock = new FixedStepClock();
    clock.advance(0);
    let ticks = 0;
    let dropped = 0;
    for (let i = 1; i <= hz * 10; i++) {
      const frame = clock.advance(i * 1000 / hz);
      ticks += frame.ticks;
      dropped += frame.dropped;
    }
    expect(ticks).toBe(600);
    expect(dropped).toBe(0);
  });

  it('repays a short hitch across frames instead of silently slowing the game', () => {
    const clock = new FixedStepClock();
    clock.advance(0);
    const hitch = clock.advance(150);
    expect(hitch.ticks).toBe(4);
    expect(hitch.debt).toBeGreaterThan(80);
    let ticks = hitch.ticks;
    for (let i = 1; i <= 6; i++) ticks += clock.advance(150 + i * 1000 / 60).ticks;
    expect(ticks).toBe(15);
    expect(hitch.dropped).toBe(0);
  });

  it('retains a burst of short stalls and fully repays it at normal cadence', () => {
    const clock = new FixedStepClock();
    clock.advance(0);
    let ticks = 0, dropped = 0;
    for (let frame = 1; frame <= 4; frame++) {
      const sample = clock.advance(frame * 150); ticks += sample.ticks; dropped += sample.dropped;
    }
    for (let frame = 1; frame <= 12; frame++) {
      const sample = clock.advance(600 + frame * 1000 / 60); ticks += sample.ticks; dropped += sample.dropped;
    }
    expect(ticks).toBe(48);
    expect(dropped).toBe(0);
    expect(clock.advance(800).debt).toBeLessThan(.001);
  });

  it('bounds sustained overload and reports the lost time', () => {
    const clock = new FixedStepClock();
    clock.advance(0);
    let dropped = 0;
    for (let frame = 1; frame <= 60; frame++) {
      const sample = clock.advance(frame * 200);
      expect(sample.ticks).toBeLessThanOrEqual(4);
      expect(sample.debt).toBeLessThanOrEqual(1000);
      dropped += sample.dropped;
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it('reports suspension loss and clears debt for manual stepping', () => {
    const clock = new FixedStepClock();
    clock.advance(0);
    expect(clock.advance(1000).dropped).toBe(750);
    expect(clock.advance(1010, 1000 / 60, true).debt).toBe(0);
    clock.reset();
    expect(clock.advance(2000).ticks).toBe(0);
  });
});
