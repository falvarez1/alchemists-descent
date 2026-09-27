/**
 * A strict fake of the Web Audio automation timeline, for tests that must
 * prove the audio code never trips it.
 *
 * `StrictParam` enforces what Chromium enforces on an AudioParam:
 * - every event time is clamped to the LIVE clock (a time in the past starts
 *   now — this is how two curves computed from a stale clock reading end up
 *   on the same instant);
 * - a value curve may not overlap another curve, nor contain any other event
 *   strictly inside it, and no event may be scheduled inside an existing
 *   curve (NotSupportedError, "overlaps");
 * - cancelScheduledValues(t) removes every event at or after t, and a curve
 *   still in progress at t;
 * - two events of one type at one time replace each other.
 *
 * `FakeAudioContext.currentTime` is the live clock: tests move it (a clock
 * that runs while the main thread is blocked) or leave it (a suspended
 * context) independently of the JS timers.
 */

type EventType = 'set' | 'linear' | 'target' | 'curve' | 'curveEnd';
interface ParamEvent { type: EventType; time: number; duration: number; value: number }

export class NotSupportedError extends Error {
  override name = 'NotSupportedError';
}

export class FakeClock {
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
}

export class StrictParam {
  readonly events: ParamEvent[] = [];
  /** Every automation call, in order (for assertions). */
  readonly calls: Array<[string, ...number[]]> = [];
  private base: number;

  constructor(private readonly clock: FakeClock, value = 1) {
    this.base = value;
  }

  get value(): number {
    return this.valueAt(this.clock.currentTime);
  }

  set value(v: number) {
    this.base = v;
  }

  /** The automated value at time t (set/linear/curve; setTarget reads as its target). */
  valueAt(t: number): number {
    let v = this.base, vt = 0;
    for (const e of this.events) {
      if (e.type === 'curve') {
        if (t < e.time) break;
        v = e.value; vt = e.time;
        continue;
      }
      if (e.time > t) {
        if (e.type === 'linear' && e.time > vt) return v + (e.value - v) * ((t - vt) / (e.time - vt));
        break;
      }
      v = e.value; vt = e.time;
    }
    return v;
  }

  private time(t: number): number {
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`Time must be a finite non-negative number: ${t}`);
    return Math.max(t, this.clock.currentTime);
  }

  private insert(e: ParamEvent): void {
    if (!Number.isFinite(e.value)) throw new TypeError('The provided float value is non-finite.');
    for (const x of this.events) {
      if (x.type === 'curveEnd') continue;
      if (e.type === 'curve') {
        const end = e.time + e.duration;
        if (x.type === 'curve') {
          if (e.time < x.time + x.duration && x.time < end) {
            throw new NotSupportedError(`setValueCurveAtTime(..., ${e.time}, ${e.duration}) overlaps setValueCurveAtTime(..., ${x.time}, ${x.duration})`);
          }
        } else if (x.time > e.time && x.time < end) {
          throw new NotSupportedError(`setValueCurveAtTime(..., ${e.time}, ${e.duration}) overlaps an event at ${x.time}`);
        }
      } else if (x.type === 'curve' && e.type !== 'curveEnd' && e.time >= x.time && e.time < x.time + x.duration) {
        throw new NotSupportedError(`an event at ${e.time} overlaps setValueCurveAtTime(..., ${x.time}, ${x.duration})`);
      }
    }
    const same = this.events.findIndex((x) => x.time === e.time && x.type === e.type);
    if (same >= 0) { this.events[same] = e; return; }
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
  }

  setValueAtTime(value: number, t: number): this {
    this.calls.push(['setValueAtTime', value, t]);
    this.insert({ type: 'set', time: this.time(t), duration: 0, value });
    return this;
  }

  linearRampToValueAtTime(value: number, t: number): this {
    this.calls.push(['linearRampToValueAtTime', value, t]);
    this.insert({ type: 'linear', time: this.time(t), duration: 0, value });
    return this;
  }

  setTargetAtTime(value: number, t: number, timeConstant: number): this {
    this.calls.push(['setTargetAtTime', value, t, timeConstant]);
    this.insert({ type: 'target', time: this.time(t), duration: 0, value });
    return this;
  }

  setValueCurveAtTime(curve: ArrayLike<number>, t: number, duration: number): this {
    this.calls.push(['setValueCurveAtTime', t, duration]);
    if (!(duration > 0)) throw new RangeError('Duration must be positive');
    const time = this.time(t);
    this.insert({ type: 'curve', time, duration, value: curve[curve.length - 1] });
    this.insert({ type: 'curveEnd', time: time + duration, duration: 0, value: curve[curve.length - 1] });
    return this;
  }

  cancelScheduledValues(t: number): this {
    this.calls.push(['cancelScheduledValues', t]);
    const cancel = this.time(t);
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.time >= cancel || (e.type === 'curve' && e.time <= cancel && e.time + e.duration > cancel)) {
        this.events.splice(i);
        break;
      }
    }
    return this;
  }
}

class FakeNode {
  readonly outputs = new Set<unknown>();
  connect<T>(to: T): T { this.outputs.add(to); return to; }
  disconnect(): void { this.outputs.clear(); }
}

export class FakeGain extends FakeNode {
  readonly gain: StrictParam;
  constructor(clock: FakeClock) { super(); this.gain = new StrictParam(clock, 1); }
}

export class FakePanner extends FakeNode {
  readonly pan: StrictParam;
  constructor(clock: FakeClock) { super(); this.pan = new StrictParam(clock, 0); }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency: StrictParam;
  readonly Q: StrictParam;
  constructor(clock: FakeClock) { super(); this.frequency = new StrictParam(clock, 350); this.Q = new StrictParam(clock, 1); }
}

export class FakeBufferSource extends FakeNode {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  started: Array<[number, number]> = [];
  stopAt = Infinity;
  start(when = 0, offset = 0): void { this.started.push([when, offset]); }
  stop(when = 0): void { this.stopAt = when; }
}

export class FakeMediaSource extends FakeNode {}

/** Just enough AudioContext for LoopVoice and the MusicDirector. */
export class FakeAudioContext extends FakeClock {
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeBufferSource[] = [];
  createGain(): FakeGain { const g = new FakeGain(this); this.gains.push(g); return g; }
  createStereoPanner(): FakePanner { return new FakePanner(this); }
  createBiquadFilter(): FakeFilter { return new FakeFilter(this); }
  createBufferSource(): FakeBufferSource { const s = new FakeBufferSource(); this.sources.push(s); return s; }
  createMediaElementSource(): FakeMediaSource { return new FakeMediaSource(); }
  async suspend(): Promise<void> { this.state = 'suspended'; }
  async resume(): Promise<void> { this.state = 'running'; }
}
