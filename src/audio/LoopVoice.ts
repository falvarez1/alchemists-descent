import { audioFault } from '@/audio/failSafe';
import { passEnvelope } from '@/audio/paramRamps';

/**
 * A seamless loop built from overlapping one-shot sources with equal-power
 * crossfades. MP3 is not gapless (encoder delay and padding put a few ms of
 * silence at each end), so `AudioBufferSourceNode.loop` would tick at every
 * seam; instead each pass starts a little before the previous one ends and
 * the two are faded across each other. Used for ambience beds (long
 * crossfades) and for sustained sounds — a flame stream, a steam jet, a lava
 * pool — that live only while something keeps them alive.
 *
 * The passes are scheduled ahead on the audio clock by a 200 ms timer. When
 * that timer could not run for a while (the main thread blocked — a probe
 * stepping hundreds of ticks in one task — or a throttled hidden tab) the
 * next pass would start in the past; the schedule instead resyncs to "now"
 * and the loop fades back in. Pass envelopes are linear segments
 * (audio/paramRamps.ts), never value curves, so a late pass can never
 * "overlap" another automation event and throw.
 */
/** A pass due earlier than this (s) is late: resync instead of scheduling in the past. */
const LATE = 0.005;
/** How far ahead of the clock a (re)started pass is placed (s). */
const LEAD = 0.02;
/** Keep this much audio (s) scheduled ahead of the clock. */
const AHEAD = 1.2;

export interface LoopVoiceOptions {
  /** Crossfade between passes, seconds. */
  crossfade: number;
  /** Fade-in of the very first pass, seconds. */
  fadeIn: number;
  /** Start somewhere random inside the buffer, so two loops of one file never phase. */
  randomStart?: boolean;
}

export class LoopVoice {
  private readonly level: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly passes: Array<{ src: AudioBufferSourceNode; env: GainNode; end: number }> = [];
  private nextStart: number;
  private nextOffset: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Times the schedule found itself behind the clock and resynced (probes read it). */
  resyncs = 0;
  /** performance.now() of the last keep-alive; 0 = held until stop(). */
  lastRefresh = 0;
  keepAliveMs = 0;
  onStopped: (() => void) | null = null;

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly buffer: AudioBuffer,
    destination: AudioNode,
    private readonly opts: LoopVoiceOptions,
  ) {
    this.level = ac.createGain();
    this.level.gain.value = 0;
    this.panner = ac.createStereoPanner();
    this.lowpass = ac.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    this.lowpass.Q.value = 0.5;
    this.level.connect(this.lowpass);
    this.lowpass.connect(this.panner);
    this.panner.connect(destination);
    const xf = this.crossfade();
    this.nextStart = ac.currentTime + LEAD;
    this.nextOffset = opts.randomStart ? Math.random() * Math.max(0, buffer.duration - xf * 2) : 0;
    this.schedule(true);
    this.timer = setInterval(() => this.tick(), 200);
  }

  private crossfade(): number {
    return Math.min(this.opts.crossfade, this.buffer.duration * 0.3);
  }

  get running(): boolean {
    return !this.stopped;
  }

  /** Set the loop's level, pan and distance muffle (smoothly), and keep it alive. */
  refresh(gain: number, pan = 0, muffleHz = 0, smooth = 0.08): void {
    if (this.stopped) return;
    const t = this.ac.currentTime;
    this.level.gain.setTargetAtTime(Math.max(0, gain), t, smooth);
    this.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, smooth);
    this.lowpass.frequency.setTargetAtTime(muffleHz > 0 ? muffleHz : 20000, t, smooth);
    this.lastRefresh = performance.now();
  }

  /** Fade out over `fade` seconds, then release every node. */
  stop(fade = 0.2): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      const t = this.ac.currentTime;
      const g = this.level.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + Math.max(0.02, fade));
      for (const pass of this.passes) {
        try { pass.src.stop(t + fade + 0.05); } catch { /* already stopped */ }
      }
    } catch (error) {
      audioFault('LoopVoice.stop', error);
    }
    setTimeout(() => {
      this.level.disconnect(); this.lowpass.disconnect(); this.panner.disconnect();
    }, (fade + 0.2) * 1000);
    this.onStopped?.();
  }

  private tick(): void {
    if (this.stopped) return;
    if (this.keepAliveMs > 0 && performance.now() - this.lastRefresh > this.keepAliveMs) { this.stop(0.18); return; }
    this.schedule(false);
  }

  /** Keep about a second of passes scheduled ahead. A voice that cannot schedule fades out rather than throwing every tick. */
  private schedule(first: boolean): void {
    try {
      this.scheduleAhead(first);
    } catch (error) {
      audioFault('LoopVoice.schedule', error);
      this.stop(0.05);
    }
  }

  private scheduleAhead(first: boolean): void {
    const ac = this.ac, xf = this.crossfade(), now = ac.currentTime;
    while (this.passes.length && this.passes[0].end < now - 0.1) this.passes.shift();
    let fresh = first && this.passes.length === 0;
    if (this.nextStart < now + LATE) {
      // The timer fell behind the audio clock: whatever was scheduled has run
      // out. Pick the loop up where it would be now, and fade it back in.
      const lag = now + LEAD - this.nextStart;
      const span = Math.max(xf, this.buffer.duration - xf * 2);
      this.nextOffset = (this.nextOffset + lag) % span;
      this.nextStart = now + LEAD;
      this.resyncs++;
      fresh = true;
    }
    while (this.nextStart < now + AHEAD) {
      const offset = this.nextOffset;
      const length = this.buffer.duration - offset;
      if (length <= xf * 2) { this.nextOffset = 0; continue; }
      const start = this.nextStart;
      const src = ac.createBufferSource();
      src.buffer = this.buffer;
      const env = ac.createGain();
      env.gain.value = 0;
      const fadeIn = fresh ? Math.max(xf, this.opts.fadeIn) : xf;
      passEnvelope(env.gain, start, Math.min(fadeIn, length * 0.5), start + length, xf);
      src.connect(env);
      env.connect(this.level);
      src.start(start, offset);
      src.stop(start + length + 0.02);
      src.onended = () => { src.disconnect(); env.disconnect(); };
      this.passes.push({ src, env, end: start + length });
      this.nextStart = start + length - xf;
      this.nextOffset = 0;
      fresh = false;
    }
  }
}
