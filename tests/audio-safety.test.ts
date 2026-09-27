import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import { LoopVoice } from '@/audio/LoopVoice';
import { MusicDirector } from '@/audio/MusicDirector';
import { Narrator } from '@/audio/Narrator';
import { installAudioStingers } from '@/audio/Stingers';
import { installEventCues } from '@/audio/EventCues';
import { audioFaultCount, failSafe, listen } from '@/audio/failSafe';
import { equalPowerAt, equalPowerRamp, passEnvelope } from '@/audio/paramRamps';
import type { StreamHost } from '@/audio/streamHost';
import { FakeAudioContext, FakeClock, NotSupportedError, StrictParam } from './helpers/fakeWebAudio';

/*
 * The P1: with the audio clock out of step with the main thread (a suspended
 * context, a blocked main thread — a probe stepping hundreds of ticks in one
 * task — or a throttled hidden tab), value-curve automation threw
 * "setValueCurveAtTime(...) overlaps setValueCurveAtTime(...)" and the throw
 * unwound whatever called it: a playerDied listener aborted the rest of that
 * tick. These tests drive the real audio classes against a fake that enforces
 * Chromium's automation rules (tests/helpers/fakeWebAudio.ts).
 */

const asAudioContext = (ac: FakeAudioContext): AudioContext => ac as unknown as AudioContext;
const asNode = (n: unknown): AudioNode => n as AudioNode;
const buffer = (duration: number): AudioBuffer => ({ duration }) as unknown as AudioBuffer;

describe('the strict fake reproduces the Web Audio overlap rule', () => {
  it('throws for two curves computed from a stale clock (the old loop-pass envelope)', () => {
    const clock = new FakeClock();
    clock.currentTime = 20;
    const p = new StrictParam(clock, 0);
    // The old LoopVoice pass: fade-in curve at `start`, fade-out curve at start + length - xf.
    // With `start` computed before a 5 s stall, both are in the past: clamped to now, they collide.
    const start = 14, length = 3, xf = 0.35;
    p.setValueCurveAtTime(new Float32Array([0, 1]), start, xf);
    expect(() => p.setValueCurveAtTime(new Float32Array([1, 0]), start + length - xf, xf)).toThrow(NotSupportedError);
  });

  it('refuses an event inside a curve, and cancelScheduledValues cuts a curve in progress', () => {
    const clock = new FakeClock();
    const p = new StrictParam(clock, 0);
    p.setValueCurveAtTime(new Float32Array([0, 1]), 1, 2);
    expect(() => p.setValueAtTime(0.5, 2)).toThrow(NotSupportedError);
    clock.currentTime = 1.5;
    p.cancelScheduledValues(1.5);
    expect(() => p.setValueAtTime(0.5, 1.5)).not.toThrow();
  });
});

describe('overlap-proof ramps (audio/paramRamps)', () => {
  it('follows the equal-power law closely', () => {
    const clock = new FakeClock();
    const p = new StrictParam(clock, 0);
    equalPowerRamp(p, 0, 1, 0, 2);
    for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(p.valueAt(2 * u)).toBeCloseTo(equalPowerAt(0, 1, u), 2);
    expect(p.valueAt(2)).toBeCloseTo(1, 6);
    expect(p.calls.some(([m]) => m === 'setValueCurveAtTime')).toBe(false);
  });

  it('never throws with a frozen clock, a stale clock, or when re-targeted mid-ramp', () => {
    const clock = new FakeClock();
    clock.currentTime = 4.5;
    clock.state = 'suspended';
    const p = new StrictParam(clock, 1);
    for (let i = 0; i < 20; i++) expect(() => equalPowerRamp(p, p.value, i % 2 ? 0.3 : 1, clock.currentTime, 1.2)).not.toThrow();
    // A time computed before a stall (now in the past), and one mid-ramp.
    expect(() => equalPowerRamp(p, 1, 0, 1, 1.2)).not.toThrow();
    clock.currentTime = 5;
    expect(() => equalPowerRamp(p, p.value, 0.2, 5, 1.2)).not.toThrow();
    expect(() => equalPowerRamp(p, 0.2, 0.9, 5.3, 0.001)).not.toThrow();
    // Garbage in is ignored, not thrown.
    expect(() => equalPowerRamp(p, Number.NaN, 1, 5, 1)).not.toThrow();
  });

  it('shapes a loop pass: in, hold, out — even when every time is already past', () => {
    const clock = new FakeClock();
    const p = new StrictParam(clock, 0);
    passEnvelope(p, 1, 0.35, 4, 0.35);
    expect(p.valueAt(1)).toBeCloseTo(0, 6);
    expect(p.valueAt(2.5)).toBeCloseTo(1, 6);
    expect(p.valueAt(4)).toBeCloseTo(0, 6);
    const late = new StrictParam(clock, 0);
    clock.currentTime = 30;
    expect(() => passEnvelope(late, 1, 0.35, 4, 0.35)).not.toThrow();
  });
});

describe('LoopVoice on an unsteady clock', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const make = (ac: FakeAudioContext, duration = 3, crossfade = 0.35): LoopVoice =>
    new LoopVoice(asAudioContext(ac), buffer(duration), asNode(ac.destination), { crossfade, fadeIn: 0.06, randomStart: true });

  it('keeps ticking over a frozen (suspended) clock without scheduling anything new', () => {
    const ac = new FakeAudioContext();
    ac.currentTime = 7;
    const loop = make(ac);
    const passes = ac.sources.length;
    void ac.suspend();
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(ac.sources.length).toBe(passes);
    expect(loop.running).toBe(true);
    loop.stop(0.1);
  });

  it('resyncs after the main thread was blocked while the audio clock ran on (the flora probes\' error)', () => {
    const ac = new FakeAudioContext();
    ac.currentTime = 5;
    const loop = make(ac);
    loop.refresh(0.5);
    // Six seconds of audio pass with no timer tick (a probe stepping 900 ticks in one task).
    ac.currentTime = 11.5;
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(loop.running).toBe(true);
    expect(loop.resyncs).toBe(1);
    // Every pass scheduled after the stall starts now or later (none in the past), and one covers now.
    const after = ac.sources.filter((s) => s.started[0][0] >= 11.5);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].started[0][0]).toBeCloseTo(11.52, 6);
    // And it goes on normally afterwards.
    for (let t = 11.7; t < 20; t += 0.2) { ac.currentTime = t; vi.advanceTimersByTime(200); }
    expect(loop.resyncs).toBe(1);
    expect(loop.running).toBe(true);
    loop.stop(0.1);
  });

  it('a bed with long crossfades survives a stall too', () => {
    const ac = new FakeAudioContext();
    ac.currentTime = 1;
    const bed = new LoopVoice(asAudioContext(ac), buffer(28), asNode(ac.destination), { crossfade: 2.5, fadeIn: 3, randomStart: true });
    ac.currentTime = 90;
    expect(() => vi.advanceTimersByTime(400)).not.toThrow();
    expect(bed.running).toBe(true);
    bed.stop(0.1);
  });
});

/* ------------------------------------------------------------------ the tick */

class FakeAudioElement {
  preload = '';
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  addEventListener(): void { /* no media events in a test */ }
  play(): Promise<void> { this.paused = false; return Promise.resolve(); }
  pause(): void { this.paused = true; }
  load(): void { /* nothing to load */ }
  removeAttribute(): void { /* nothing to remove */ }
}

function stubDom(): void {
  const noop = (): void => undefined;
  vi.stubGlobal('window', {
    addEventListener: noop, removeEventListener: noop,
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms), clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
  vi.stubGlobal('document', { hidden: false, body: { classList: { contains: () => false } }, addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal('Audio', FakeAudioElement);
}

function fakeCtx(events: EventBus): Ctx {
  return {
    events,
    state: { mode: 'play', paused: false, frameCount: 7, score: 0 },
    player: { x: 100, y: 100, dead: false },
    enemies: [],
    levels: { current: { def: { id: 'd1', name: 'THE BELLOWS', biome: 'earthen', depth: 1, nextLevelId: 'd2' } } },
    sanctum: { isOpen: false },
    run: { over: false },
  } as unknown as Ctx;
}

function host(ac: FakeAudioContext | null, bus: unknown = ac?.destination): StreamHost {
  return {
    enabled: true,
    streamContext: () => (ac ? asAudioContext(ac) : null),
    streamBus: () => (ac ? asNode(bus) : null),
    talkDuck: () => undefined,
    ensure: () => undefined,
  };
}

describe('a death with a frozen audio clock never aborts the tick', () => {
  beforeEach(() => { vi.useFakeTimers(); stubDom(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('the score, the narrator, the stingers and the event cues all hear playerDied; the rest of the tick still runs', async () => {
    const events = new EventBus();
    const ctx = fakeCtx(events);
    const ac = new FakeAudioContext();
    ac.currentTime = 3;
    const music = new MusicDirector(ctx, host(ac));
    const narrator = new Narrator(ctx, host(ac), {});
    const played: string[] = [];
    const offStingers = installAudioStingers(events, { stinger: (k) => { played.push(k); } });
    const offCues = installEventCues(events, { sfx: (id) => { played.push(id); } });
    // The first gesture: the floor's cue starts and fades in.
    (music as unknown as { onGesture(): void }).onGesture();
    await vi.advanceTimersByTimeAsync(300);
    expect(music.cue).toBe('bellows');
    // Freeze the clock (a suspended context), then die — twice over, and again after a respawn.
    await ac.suspend();
    const faults = audioFaultCount();
    const restOfTick: string[] = [];
    events.on('playerDied', () => restOfTick.push('hud'));
    for (let i = 0; i < 3; i++) {
      (ctx.player as { dead: boolean }).dead = true;
      expect(() => events.emit('playerDied', { depth: 1, level: 'THE BELLOWS', gold: 0, cause: 'falling-tree' })).not.toThrow();
      await vi.advanceTimersByTimeAsync(260);
      (ctx.player as { dead: boolean }).dead = false;
      events.emit('playerRespawned');
      await vi.advanceTimersByTimeAsync(260);
    }
    expect(restOfTick).toEqual(['hud', 'hud', 'hud']);
    expect(audioFaultCount()).toBe(faults); // nothing threw — not even caught
    const snap = music.debugSnapshot();
    expect(snap.masterTarget).toBe(1);
    // No automation in the director's graph is a value curve any more.
    for (const g of ac.gains) expect(g.gain.calls.some(([m]) => m === 'setValueCurveAtTime')).toBe(false);
    offStingers(); offCues(); music.dispose(); narrator.dispose();
  });

  it('a broken audio graph is reported, not thrown: the emit and every later listener carry on', async () => {
    const events = new EventBus();
    const ctx = fakeCtx(events);
    const ac = new FakeAudioContext();
    ac.currentTime = 2;
    // A context whose every gain throws on automation (a closed or wedged graph).
    const broken = Object.assign(Object.create(FakeAudioContext.prototype) as FakeAudioContext, ac, {
      createGain: () => { throw new NotSupportedError('the graph is gone'); },
    });
    const music = new MusicDirector(ctx, host(broken, ac.destination));
    (music as unknown as { onGesture(): void }).onGesture();
    const faults = audioFaultCount();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after: string[] = [];
    events.on('playerDied', () => after.push('ran'));
    expect(() => events.emit('playerDied', { depth: 1, level: 'THE BELLOWS', gold: 0, cause: 'fire' })).not.toThrow();
    await vi.advanceTimersByTimeAsync(600);
    expect(after).toEqual(['ran']);
    expect(audioFaultCount()).toBeGreaterThan(faults);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    music.dispose();
  });
});

describe('failSafe', () => {
  it('reports and swallows; a listener subscribed through listen() cannot break an emit', () => {
    const events = new EventBus();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = audioFaultCount();
    const seen: number[] = [];
    listen(events, 'scoreChanged', () => { throw new Error('boom'); });
    events.on('scoreChanged', ({ score }) => seen.push(score));
    expect(() => events.emit('scoreChanged', { score: 3 })).not.toThrow();
    expect(seen).toEqual([3]);
    expect(audioFaultCount()).toBe(before + 1);
    const f = failSafe('test', (n: number) => { if (n > 1) throw new Error('too big'); });
    expect(() => f(2)).not.toThrow();
    expect(audioFaultCount()).toBe(before + 2);
    errors.mockRestore();
  });
});
