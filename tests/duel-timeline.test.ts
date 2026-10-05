import { describe, expect, it } from 'vitest';
import { HostClock, PlaybackCursor, TICK_MS } from '@/net/duel/timeline';

describe('host clock', () => {
  it('takes the best transit as the offset and measures lateness beyond it', () => {
    const clock = new HostClock();
    // Tick t is sent at t * TICK_MS; transits of 5 ms, plus 0..10 ms of jitter on every fourth frame.
    for (let t = 1; t <= 100; t++) clock.observe(t, t * TICK_MS + 5 + (t % 4 === 0 ? 10 : 0));
    expect(clock.hostTick(100 * TICK_MS + 5)).toBeCloseTo(100, 6);
    expect(clock.lateness(0.5)).toBe(0);
    expect(clock.lateness(0.98)).toBeCloseTo(10 / TICK_MS, 6);
  });
  it('follows a host that falls behind real time and restarts after the stream stops', () => {
    const clock = new HostClock(30);
    for (let t = 1; t <= 60; t++) clock.observe(t, t * TICK_MS + t * 0.5); // the host loses half a millisecond a tick
    expect(clock.hostTick(60 * TICK_MS + 30)).toBeGreaterThan(59.5);
    clock.observe(61, 61 * TICK_MS + 30 + 5000); // a five-second pause
    expect(clock.lateness(0.98)).toBe(0);
    expect(clock.hostTick(61 * TICK_MS + 30 + 5000)).toBeCloseTo(61, 6);
  });
});

describe('playback cursor', () => {
  it('never runs backward or past the newest frame, and steers within a fifth of real time', () => {
    const head = new PlaybackCursor();
    expect(head.advance(0, 10, 12)).toBe(10);
    expect(head.advance(TICK_MS, 4, 12)).toBeCloseTo(10.8, 6); // target behind: slows to 80%, still forward
    expect(head.advance(2 * TICK_MS, 13, 12)).toBe(12); // capped at the newest frame received
    expect(head.advance(3 * TICK_MS, 13, 14)).toBeCloseTo(13.1, 6); // one tick behind its target: 10% faster
  });
  it('jumps forward when far behind its target', () => {
    const head = new PlaybackCursor();
    head.advance(0, 10, 100);
    expect(head.advance(TICK_MS, 40, 100)).toBe(40);
  });
});
