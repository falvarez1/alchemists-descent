import type { AudioApi, AudioStinger, AudioStingerOptions, VolumeChannel } from '@/core/types';
import {
  AUDIO_BUSES,
  BUS_CHANNEL,
  DEFAULT_VOLUMES,
  MIX_TRIM,
  busGain,
  chainPitch,
  placeSound,
  volumeToGain,
  type AudioBus,
  type VolumeSettings,
} from '@/audio/mix';

/** Legacy WebKit prefix fallback (original: `window.AudioContext || window.webkitAudioContext`). */
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** The mix graph built once per AudioContext. */
interface MixGraph {
  buses: Record<AudioBus, GainNode>;
  /** World buses (fx/voices/ambience) pass through here; UI stingers do not, so a duck never swallows its own cue. */
  duck: GainNode;
  trim: GainNode;
  glue: DynamicsCompressorNode;
  makeup: GainNode;
  limiter: DynamicsCompressorNode;
  clipper: WaveShaperNode;
  master: GainNode;
}

/** One recorded voice, for the in-page probe (`window.__game.ctx.audio.debugSnapshot()`). */
interface VoiceTrace { bus: AudioBus; pan: number; gain: number; muffleHz: number; vol: number }

/** Normal voices stop here; loud cues (vol ≥ PRIORITY_VOL) may use the reserve above it. */
const VOICE_CAP = 32;
const VOICE_RESERVE = 10;
const PRIORITY_VOL = 0.2;

/**
 * Soft-knee safety clipper: linear to 0.8, then a tanh shoulder that never
 * reaches 1.0. The limiter ahead of it catches almost everything; this only
 * rounds the sub-millisecond overs a compressor's attack lets through, so
 * a wall of simultaneous blasts saturates warmly instead of cracking.
 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2048, curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  return curve;
}

// ===================== Procedural Audio Engine =====================
// The sampled layer (audio/SfxEngine.ts) completes the API with `sfx` and `creature`.
export class AudioEngine implements Omit<AudioApi, 'sfx' | 'creature'> {
  /** The context voices are built on: the live one, or an offline one during `debugRenderOffline`. */
  private audioCtx: BaseAudioContext | null = null;
  /** The real output context (suspend/resume/close live here). */
  private liveCtx: AudioContext | null = null;
  private graph: MixGraph | null = null;
  private soundOn = true;
  private readonly sfxThrottle: Record<string, number> = {};
  private voices = 0;
  private noiseBuffer: AudioBuffer | null = null;
  private brownBuffer: AudioBuffer | null = null;
  private volumes: VolumeSettings = { ...DEFAULT_VOLUMES };
  // ---- the current placement: every voice created is shaped by these ----
  private pan = 0;
  /** Distance attenuation applied inside `at()`; 1 everywhere else. */
  private gainScale = 1;
  /** Distance air-absorption lowpass for the current placement (0 = none). */
  private muffleHz = 0;
  private route: AudioBus = 'fx';
  private listenerX = 0;
  private listenerY = 0;
  // ---- probe surface ----
  private readonly trace: VoiceTrace[] = [];
  /** Voices ever sent to a bus (probe: did that call actually play?). */
  private sunk = 0;
  private readonly stingerLog: string[] = [];

  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  /**
   * Position a sound. Everything `fn` plays is panned by its bearing on the
   * screen, attenuated to silence at `range`, and loses its top end with
   * distance (audio/mix.ts `placeSound`). Restores the previous placement
   * afterwards, so nested and scheduled cues stay independent.
   */
  at(x: number, y: number, fn: () => void, range = 380): void {
    const place = placeSound(x - this.listenerX, y - this.listenerY, range);
    if (!place) return;
    const pan = this.pan, gain = this.gainScale, muffle = this.muffleHz;
    this.pan = place.pan;
    this.gainScale = gain * place.gain;
    this.muffleHz = muffle > 0 && place.muffleHz > 0 ? Math.min(muffle, place.muffleHz) : muffle || place.muffleHz;
    try { fn(); } finally { this.pan = pan; this.gainScale = gain; this.muffleHz = muffle; }
  }

  /** Route everything `fn` plays to `bus`. */
  private on(bus: AudioBus, fn: () => void): void {
    const previous = this.route;
    this.route = bus;
    try { fn(); } finally { this.route = previous; }
  }

  /** Optional world position + bus in one step: the common preset shape. */
  private spot(x: number | undefined, y: number | undefined, range: number, bus: AudioBus, fn: () => void): void {
    if (x === undefined || y === undefined) this.on(bus, fn);
    else this.at(x, y, () => this.on(bus, fn), range);
  }

  duck(level: number, ms: number): void {
    if (!this.soundOn || !this.audioCtx || !this.graph) return;
    const gain = this.graph.duck.gain, t = this.now();
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(gain.value, t);
    gain.linearRampToValueAtTime(Math.max(0.05, Math.min(1, level)), t + 0.05);
    gain.linearRampToValueAtTime(1, t + Math.max(0.1, ms / 1000));
  }

  /** Schedule `fn` keeping the placement and bus it was scheduled under, not whatever is current when it fires. */
  private later(delayMs: number, fn: () => void): void {
    const pan = this.pan, gain = this.gainScale, muffle = this.muffleHz, route = this.route;
    setTimeout(() => {
      const p = this.pan, g = this.gainScale, m = this.muffleHz, r = this.route;
      this.pan = pan; this.gainScale = gain; this.muffleHz = muffle; this.route = route;
      try { fn(); } finally { this.pan = p; this.gainScale = g; this.muffleHz = m; this.route = r; }
    }, delayMs);
  }

  // ---------------------------------------------------------------- graph

  private buildGraph(ac: BaseAudioContext): MixGraph {
    const gain = (value: number): GainNode => { const g = ac.createGain(); g.gain.value = value; return g; };
    const buses = {} as Record<AudioBus, GainNode>;
    for (const bus of AUDIO_BUSES) buses[bus] = gain(busGain(bus, this.volumes));
    const duck = gain(1), trim = gain(MIX_TRIM), makeup = gain(1.2);
    // Glue: a gentle bus compressor so a blast leans on the room around it
    // (the cave "breathes in" under an explosion) instead of simply summing.
    const glue = ac.createDynamicsCompressor();
    glue.threshold.value = -12; glue.knee.value = 10; glue.ratio.value = 2; glue.attack.value = 0.012; glue.release.value = 0.25;
    // Limiter: fast, hard, just under full scale.
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
    const clipper = ac.createWaveShaper(); clipper.curve = softClipCurve(); clipper.oversample = 'none';
    const master = gain(volumeToGain(this.volumes.master));
    buses.fx.connect(duck); buses.voices.connect(duck); buses.ambience.connect(duck);
    duck.connect(trim); buses.ui.connect(trim);
    trim.connect(glue); glue.connect(makeup); makeup.connect(limiter); limiter.connect(clipper); clipper.connect(master);
    master.connect(ac.destination);
    return { buses, duck, trim, glue, makeup, limiter, clipper, master };
  }

  /**
   * Terminate a voice chain: add the distance lowpass and the stereo panner
   * only when the placement needs them, then feed the current bus. Every
   * node created is pushed to `nodes` so the voice can disconnect it all.
   */
  private sink(head: AudioNode, nodes: AudioNode[], vol: number): void {
    const ac = this.audioCtx!, graph = this.graph!;
    let node = head;
    if (this.muffleHz > 0) {
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = this.muffleHz; lp.Q.value = 0.5;
      node.connect(lp); node = lp; nodes.push(lp);
    }
    if (Math.abs(this.pan) > 0.01) {
      const panner = ac.createStereoPanner(); panner.pan.value = this.pan;
      node.connect(panner); node = panner; nodes.push(panner);
    }
    node.connect(graph.buses[this.route]);
    this.sunk++;
    if (this.trace.length >= 24) this.trace.shift();
    this.trace.push({ bus: this.route, pan: this.pan, gain: this.gainScale, muffleHz: this.muffleHz, vol });
  }

  /**
   * Schedule time for a voice starting "now". `lead` is 0 live; an offline
   * probe render shifts everything a little later so the compressors are
   * measured warmed up (a DynamicsCompressor squashes whatever arrives in its
   * first few milliseconds of existence, which live play never hears).
   */
  private lead = 0;
  private now(): number { return this.audioCtx!.currentTime + this.lead; }

  /** Voice admission: quiet texture yields to loud cues once the pool is busy. */
  private admit(vol: number): boolean {
    if (!this.soundOn || !this.audioCtx || !this.graph) return false;
    return this.voices < (vol >= PRIORITY_VOL ? VOICE_CAP + VOICE_RESERVE : VOICE_CAP);
  }

  private track(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    this.voices++;
    src.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      for (const node of nodes) node.disconnect();
    };
  }

  /** Two seconds of white noise, generated once per context and shared by every burst. */
  private noiseSource(ac: BaseAudioContext, brown = false): AudioBufferSourceNode {
    let buffer = brown ? this.brownBuffer : this.noiseBuffer;
    if (!buffer) {
      buffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        // Brown noise: integrated white, leaky so it cannot wander off; ×3.5 restores level.
        if (brown) { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5; } else data[i] = white;
      }
      if (brown) this.brownBuffer = buffer; else this.noiseBuffer = buffer;
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  /**
   * A random start offset into the shared buffer. Starting every burst at
   * the same offset (or at currentTime) made two blasts in one frame play
   * the SAME noise — correlated, so they summed +6 dB with a comb-filter
   * hollowness instead of the +3 dB wash two real bangs make.
   */
  private noiseOffset(): number { return Math.random() * 1.9; }

  // ------------------------------------------------------------- lifecycle

  get enabled(): boolean {
    return this.soundOn;
  }

  ensure(): void {
    if (!this.audioCtx) {
      try {
        const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
        const ac = new Ctor!();
        this.audioCtx = ac;
        this.liveCtx = ac;
        this.graph = this.buildGraph(ac);
      } catch {
        this.soundOn = false;
      }
    }
    if (this.liveCtx && this.liveCtx.state === 'suspended') void this.liveCtx.resume();
  }

  /** Flip sound on/off; returns the new enabled state. Off suspends the
   *  AudioContext (releases the audio thread); on resumes/creates it. */
  toggle(): boolean {
    this.soundOn = !this.soundOn;
    if (this.soundOn) this.ensure();
    else if (this.liveCtx && this.liveCtx.state === 'running') void this.liveCtx.suspend();
    return this.soundOn;
  }

  /** Tear down: stop scheduling, suspend, and close the AudioContext so the
   *  underlying audio resources are released (e.g. on full game shutdown). */
  dispose(): void {
    this.soundOn = false;
    const ac = this.liveCtx;
    this.audioCtx = null;
    this.liveCtx = null;
    this.graph = null;
    if (ac && ac.state !== 'closed') void ac.close();
  }

  // --------------------------------------------------------------- volume

  /** Set a player volume slider (0..1). Applied with a short glide so dragging never zippers. */
  setVolume(channel: VolumeChannel, value: number): void {
    const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUMES[channel];
    this.volumes = { ...this.volumes, [channel]: v };
    const ac = this.audioCtx, graph = this.graph;
    if (!ac || !graph) return; // applied when the graph is built
    if (channel === 'master') this.glide(ac, graph.master.gain, volumeToGain(v));
    else for (const bus of AUDIO_BUSES) if (BUS_CHANNEL[bus] === channel) this.glide(ac, graph.buses[bus].gain, busGain(bus, this.volumes));
  }

  /**
   * Move a gain to `value` over ~0.1 s. Pins the current value first:
   * stacking setTargetAtTime events at one instant (three sliders applied
   * in one task) leaves Chromium holding an intermediate value.
   */
  private glide(ac: BaseAudioContext, param: AudioParam, value: number): void {
    const t = ac.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.setTargetAtTime(value, t, 0.03);
  }

  volume(channel: VolumeChannel): number {
    return this.volumes[channel];
  }

  private throttled(key: string, ms: number): boolean {
    const now = performance.now();
    if (this.sfxThrottle[key] && now - this.sfxThrottle[key] < ms) return false;
    this.sfxThrottle[key] = now;
    return true;
  }

  // ------------------------------------------------------------ primitives

  /** Raw one-shot oscillator sweep. An (x, y) places it in the world (450-cell range). */
  tone(freq: number, endFreq: number, dur: number, type: OscillatorType, vol: number, x?: number, y?: number): void {
    if (x !== undefined && y !== undefined) { this.at(x, y, () => this.tone(freq, endFreq, dur, type, vol), 450); return; }
    vol *= this.gainScale;
    if (vol < 0.0015 || !this.admit(vol)) return;
    dur = Math.max(0.005, Math.min(4, dur));
    const ac = this.audioCtx!, t = this.now();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nodes: AudioNode[] = [o, g];
    o.connect(g); this.sink(g, nodes, vol);
    this.track(o, nodes);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Raw filtered noise hit. An (x, y) places it in the world (450-cell range). */
  noiseBurst(dur: number, filterFreq: number, vol: number, hp?: boolean, x?: number, y?: number): void {
    if (x !== undefined && y !== undefined) { this.at(x, y, () => this.noiseBurst(dur, filterFreq, vol, hp), 450); return; }
    vol *= this.gainScale;
    if (vol < 0.0015 || !this.admit(vol)) return;
    dur = Math.max(0.005, Math.min(4, dur));
    const ac = this.audioCtx!, t = this.now();
    const src = this.noiseSource(ac);
    const f = ac.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = filterFreq;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nodes: AudioNode[] = [src, f, g];
    src.connect(f); f.connect(g); this.sink(g, nodes, vol);
    this.track(src, nodes);
    src.start(t, this.noiseOffset()); src.stop(t + dur + 0.02);
  }

  /** Filtered noise whose cutoff glides from `fromHz` to `toHz` (then back for a slide). */
  private sweepNoise(dur: number, fromHz: number, toHz: number, vol: number, hp = false, q = 1, back = false): void {
    vol *= this.gainScale;
    if (vol < 0.0015 || !this.admit(vol)) return;
    const ac = this.audioCtx!, t = this.now();
    const src = this.noiseSource(ac);
    const f = ac.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(fromHz, t);
    if (back) {
      f.frequency.exponentialRampToValueAtTime(toHz, t + dur * 0.45);
      f.frequency.exponentialRampToValueAtTime(fromHz, t + dur);
    } else f.frequency.exponentialRampToValueAtTime(toHz, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nodes: AudioNode[] = [src, f, g];
    src.connect(f); f.connect(g); this.sink(g, nodes, vol);
    this.track(src, nodes);
    src.start(t, this.noiseOffset()); src.stop(t + dur + 0.02);
  }

  /** Low brown-noise rumble with a slow tail: the room still shaking after a big blast. */
  private rumble(dur: number, vol: number): void {
    vol *= this.gainScale;
    if (vol < 0.0015 || !this.admit(vol)) return;
    const ac = this.audioCtx!, t = this.now();
    const src = this.noiseSource(ac, true);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nodes: AudioNode[] = [src, f, g];
    src.connect(f); f.connect(g); this.sink(g, nodes, vol);
    this.track(src, nodes);
    src.start(t, this.noiseOffset()); src.stop(t + dur + 0.02);
  }

  /**
   * A scheduled, enveloped note for musical stingers: sample-accurate
   * `delay` (setTimeout would smear a motif by a frame or two), a real
   * attack so brass can swell, optional detuned double and a lowpass that
   * can open over the note.
   */
  private note(o: {
    freq: number; dur: number; vol: number; delay?: number; type?: OscillatorType; attack?: number;
    endFreq?: number; detune?: number; lowpass?: number; lowpassEnd?: number;
  }): void {
    const oscs = o.detune ? [-o.detune, o.detune] : [0];
    // A detuned pair sums hotter than one oscillator; trim it back to the asked level.
    const vol = o.vol * this.gainScale * (oscs.length > 1 ? 0.7 : 1);
    if (vol < 0.0015 || !this.admit(vol)) return;
    const ac = this.audioCtx!, t = this.now() + (o.delay ?? 0), dur = Math.max(0.02, Math.min(4, o.dur));
    const attack = Math.min(dur * 0.5, o.attack ?? 0.004);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nodes: AudioNode[] = [g];
    let head: AudioNode = g;
    if (o.lowpass) {
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.9;
      f.frequency.setValueAtTime(o.lowpass, t);
      if (o.lowpassEnd) f.frequency.exponentialRampToValueAtTime(o.lowpassEnd, t + dur);
      g.connect(f); head = f; nodes.push(f);
    }
    let first: OscillatorNode | null = null;
    for (const cents of oscs) {
      const osc = ac.createOscillator(); osc.type = o.type ?? 'sine'; osc.detune.value = cents;
      osc.frequency.setValueAtTime(o.freq, t);
      if (o.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.endFreq), t + dur);
      osc.connect(g); nodes.push(osc);
      osc.start(t); osc.stop(t + dur + 0.02);
      first ??= osc;
    }
    this.sink(head, nodes, vol);
    this.track(first!, nodes);
  }

  /** Scheduled noise hit (stinger cracks, clicks). */
  private hit(delay: number, dur: number, hz: number, vol: number, hp = true, q = 0.8): void {
    vol *= this.gainScale;
    if (vol < 0.0015 || !this.admit(vol)) return;
    const ac = this.audioCtx!, t = this.now() + delay;
    const src = this.noiseSource(ac);
    const f = ac.createBiquadFilter(); f.type = hp ? 'highpass' : 'bandpass'; f.frequency.value = hz; f.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nodes: AudioNode[] = [src, f, g];
    src.connect(f); f.connect(g); this.sink(g, nodes, vol);
    this.track(src, nodes);
    src.start(t, this.noiseOffset()); src.stop(t + dur + 0.02);
  }

  /** Struck glass/brass: inharmonic bell partials (1 : 2.76 : 5.4) with shortening decays. */
  private bell(freq: number, delay: number, vol: number, dur = 1.1): void {
    this.note({ freq, dur, vol, delay, attack: 0.002 });
    this.note({ freq: freq * 2.76, dur: dur * 0.55, vol: vol * 0.42, delay, attack: 0.002 });
    this.note({ freq: freq * 5.4, dur: dur * 0.28, vol: vol * 0.2, delay, attack: 0.001 });
  }

  // ---------------------------------------------------------------- world

  /** Local, bounded cues. Distance shapes volume and stereo position together. */
  worldSound(kind: 'stone' | 'metal' | 'water' | 'weaver' | 'rillback' | 'pressure', x: number, y: number): void {
    const bus: AudioBus = kind === 'weaver' || kind === 'rillback' ? 'voices' : kind === 'pressure' ? 'ambience' : 'fx';
    // Resolve placement before the throttle so a far, silent cue cannot steal a near one's slot.
    this.at(x, y, () => this.on(bus, () => {
      if (!this.throttled(`world-${kind}`, kind === 'pressure' ? 800 : 105)) return;
      if (kind === 'stone') { this.noiseBurst(0.035, 780, 0.06); this.tone(100, 52, 0.045, 'triangle', 0.028); }
      else if (kind === 'metal') { this.tone(370, 240, 0.09, 'sine', 0.045); this.noiseBurst(0.025, 1600, 0.03); }
      else if (kind === 'water') { this.noiseBurst(0.13, 850, 0.045); this.tone(320, 120, 0.08, 'sine', 0.018); }
      // Weaver legs are dry chitin on stone: two quick taps, no body tone.
      else if (kind === 'weaver') { this.noiseBurst(0.012, 3600, 0.05, true); this.later(46, () => this.noiseBurst(0.012, 4300, 0.04, true)); }
      // A Rillback moves as a wet slide, not a drum: the filter opens and closes over the body.
      else if (kind === 'rillback') { this.sweepNoise(0.24, 220, 1000, 0.045, false, 2, true); this.tone(96, 66, 0.2, 'sine', 0.022); }
      else { this.noiseBurst(0.7, 400, 0.055); this.tone(60, 82, 1.2, 'sine', 0.045); }
    }), 330);
  }

  /**
   * An explosion. Size shapes length and the rumble tail; position pans it
   * and lets distance strip the crack so a far blast arrives as a thud.
   */
  boom(size: number, x?: number, y?: number): void {
    this.spot(x, y, 900, 'fx', () => {
      if (!this.throttled('boom', 60)) return;
      const s = Math.max(0, Math.min(1, size / 30));
      this.noiseBurst(0.35 + size * 0.012, 500, 0.6);
      this.tone(95, 28, 0.4 + size * 0.01, 'sine', 0.55);
      this.noiseBurst(0.04, 2400, 0.1 + 0.1 * s, true); // the crack of the front
      if (size >= 6) this.rumble(0.7 + 1.3 * s, 0.14 + 0.22 * s);
    });
  }

  zap(x?: number, y?: number): void { this.spot(x, y, 450, 'fx', () => { if (!this.throttled('zap', 70)) return; this.tone(900, 180, 0.12, 'square', 0.16); }); }

  lightning(x?: number, y?: number): void { this.spot(x, y, 800, 'fx', () => { this.noiseBurst(0.22, 2400, 0.35, true); this.tone(1400, 90, 0.18, 'sawtooth', 0.22); }); }

  coin(streak = 0): void {
    if (!this.throttled('coin', 45)) return;
    // A two-note ching that climbs the scale as a bounty shower cascades in —
    // one semitone per coin in the streak, capped at an octave.
    const mul = Math.pow(2, Math.min(Math.max(0, streak - 1), 12) / 12);
    this.on('ui', () => {
      this.tone(880 * mul, 880 * mul, 0.07, 'sine', 0.16);
      this.later(55, () => this.tone(1318 * mul, 1318 * mul, 0.10, 'sine', 0.15));
    });
  }

  hurt(): void { if (!this.throttled('hurt', 200)) return; this.tone(220, 70, 0.16, 'sawtooth', 0.28); }

  jump(): void { if (!this.throttled('jump', 120)) return; this.tone(290, 480, 0.07, 'sine', 0.10); }

  squelch(x?: number, y?: number): void { this.spot(x, y, 380, 'fx', () => { if (!this.throttled('squelch', 90)) return; this.noiseBurst(0.18, 320, 0.4); this.tone(160, 38, 0.22, 'sine', 0.3); }); }

  hollowKnock(x?: number, y?: number): void { this.spot(x, y, 420, 'fx', () => { if (!this.throttled('hollow', 160)) return; this.tone(140, 60, 0.22, 'sine', 0.22); this.tone(95, 70, 0.3, 'triangle', 0.12); }); }

  bubble(x?: number, y?: number): void { this.spot(x, y, 260, 'ambience', () => { if (!this.throttled('bubble', 90)) return; this.tone(220 + Math.random() * 120, 160, 0.09, 'sine', 0.07); this.noiseBurst(0.05, 500, 0.04); }); }

  shatter(x?: number, y?: number): void { this.spot(x, y, 500, 'fx', () => { if (!this.throttled('shatter', 100)) return; this.noiseBurst(0.12, 3200, 0.14, true); this.tone(1900 + Math.random() * 600, 400, 0.12, 'square', 0.07); }); }

  // ---- Descent pickup/landmark presets (noita-alchemists-descent.html) ----

  pickup(): void { if (!this.throttled('pickup', 80)) return; this.on('ui', () => { this.tone(660, 880, 0.08, 'sine', 0.14); this.later(70, () => this.tone(990, 1320, 0.09, 'sine', 0.12)); }); }

  chest(): void { this.on('ui', () => { this.tone(392, 392, 0.12, 'triangle', 0.2); this.later(110, () => this.tone(523, 523, 0.12, 'triangle', 0.2)); this.later(230, () => this.tone(784, 784, 0.16, 'triangle', 0.22)); }); }

  keyJingle(): void { this.on('ui', () => { this.tone(1568, 1568, 0.09, 'sine', 0.16); this.later(70, () => this.tone(2093, 2093, 0.09, 'sine', 0.15)); this.later(150, () => this.tone(1760, 1760, 0.12, 'sine', 0.14)); }); }

  portalWhoosh(): void { this.tone(110, 440, 0.8, 'sine', 0.22); this.tone(165, 660, 0.8, 'sine', 0.16); this.noiseBurst(0.5, 900, 0.1); }

  learn(): void { this.on('ui', () => { this.tone(523, 523, 0.11, 'triangle', 0.2); this.later(140, () => this.tone(659, 659, 0.11, 'triangle', 0.2)); this.later(280, () => this.tone(784, 784, 0.11, 'triangle', 0.2)); this.later(420, () => this.tone(1046, 1046, 0.18, 'triangle', 0.22)); }); }

  drinkPotion(): void { this.tone(420, 280, 0.1, 'sine', 0.14); this.later(90, () => this.tone(520, 340, 0.1, 'sine', 0.13)); this.later(180, () => this.tone(640, 400, 0.12, 'sine', 0.12)); }

  lever(): void { if (!this.throttled('lever', 150)) return; this.tone(360, 360, 0.04, 'square', 0.12); this.later(60, () => this.tone(220, 220, 0.05, 'square', 0.1)); }

  doorGrind(x?: number, y?: number): void { this.spot(x, y, 520, 'fx', () => { if (!this.throttled('door', 200)) return; this.noiseBurst(0.35, 240, 0.22); this.tone(60, 45, 0.35, 'sawtooth', 0.12); }); }

  brazier(x?: number, y?: number): void { this.spot(x, y, 450, 'fx', () => { this.noiseBurst(0.3, 700, 0.18); this.tone(220, 480, 0.3, 'triangle', 0.14); }); }

  /** A soft, throttled fire crackle for a body that is alight (status.burning). */
  sizzle(x?: number, y?: number): void { this.spot(x, y, 300, 'fx', () => { if (!this.throttled('sizzle', 240)) return; this.noiseBurst(0.09, 1700, 0.05, true); this.tone(300, 170, 0.07, 'sawtooth', 0.045); }); }

  /** The airy hiss of water flashing to steam on lava (throttled — a wide front sustains it). */
  steam(x?: number, y?: number): void { this.spot(x, y, 360, 'fx', () => { if (!this.throttled('steam', 150)) return; this.noiseBurst(0.16, 2200, 0.06, true); this.tone(520, 240, 0.1, 'sine', 0.02); }); }

  groan(x?: number, y?: number): void { this.spot(x, y, 620, 'fx', () => { if (!this.throttled('groan', 400)) return; this.tone(72, 38, 0.7, 'sawtooth', 0.16); this.noiseBurst(0.45, 160, 0.12); }); }

  // ---- Wave F: the quiet sounds of cave life ----

  chirp(x?: number, y?: number): void { this.spot(x, y, 240, 'ambience', () => { if (!this.throttled('chirp', 700)) return; const f = 2600 + Math.random() * 900; this.tone(f, f * 1.06, 0.05, 'sine', 0.045); this.later(90, () => this.tone(f * 0.96, f, 0.04, 'sine', 0.035)); }); }

  skitter(x?: number, y?: number): void { this.spot(x, y, 240, 'ambience', () => { if (!this.throttled('skitter', 600)) return; this.noiseBurst(0.025, 4200, 0.04, true); this.later(70, () => this.noiseBurst(0.02, 4600, 0.03, true)); this.later(130, () => this.noiseBurst(0.02, 3900, 0.03, true)); }); }

  drip(x?: number, y?: number): void { this.spot(x, y, 260, 'ambience', () => { if (!this.throttled('drip', 500)) return; this.tone(900 + Math.random() * 300, 420, 0.07, 'sine', 0.06); }); }

  // ---- Micro-interaction feedback ----

  dryFire(): void { if (!this.throttled('dry', 220)) return; this.tone(140, 90, 0.05, 'square', 0.1); this.noiseBurst(0.03, 1200, 0.05, true); }

  wandSwap(): void { if (!this.throttled('swap', 120)) return; this.noiseBurst(0.05, 2600, 0.07, true); this.tone(520, 760, 0.06, 'triangle', 0.08); }

  sputter(): void { if (!this.throttled('sputter', 260)) return; this.noiseBurst(0.04, 480, 0.09); this.later(80, () => this.noiseBurst(0.03, 380, 0.07)); }

  heartbeat(): void { if (!this.throttled('heart', 400)) return; this.tone(58, 42, 0.11, 'sine', 0.22); this.later(150, () => this.tone(52, 38, 0.09, 'sine', 0.16)); }

  cardPick(): void { if (!this.throttled('cardp', 80)) return; this.on('ui', () => this.noiseBurst(0.025, 3400, 0.05, true)); }

  cardSlot(): void { if (!this.throttled('cards', 80)) return; this.on('ui', () => { this.tone(240, 180, 0.05, 'square', 0.12); this.noiseBurst(0.02, 2000, 0.04, true); }); }

  footstep(surface: 'stone' | 'soft' | 'wet' | 'wood'): void {
    if (!this.throttled('step', 90)) return;
    if (surface === 'stone') { this.noiseBurst(0.016, 1100 + Math.random() * 300, 0.045, true); this.tone(160 + Math.random() * 30, 120, 0.03, 'square', 0.025); }
    else if (surface === 'soft') this.noiseBurst(0.03, 420 + Math.random() * 120, 0.05);
    else if (surface === 'wet') { this.tone(300 + Math.random() * 80, 170, 0.04, 'sine', 0.05); this.noiseBurst(0.025, 600, 0.035); }
    else { this.tone(220 + Math.random() * 40, 150, 0.035, 'square', 0.055); }
  }

  crawlShuffle(): void { if (!this.throttled('crawl', 130)) return; this.noiseBurst(0.05, 300 + Math.random() * 120, 0.035); }

  crampedBump(): void { if (!this.throttled('cramped', 300)) return; this.tone(120, 70, 0.06, 'sine', 0.1); this.noiseBurst(0.04, 500, 0.05); }

  landThud(intensity: number): void { if (!this.throttled('land', 150)) return; const k = Math.max(0.15, Math.min(1, intensity)); this.tone(95 - 35 * k, 45, 0.09 + 0.07 * k, 'sine', 0.07 + 0.13 * k); this.noiseBurst(0.04 + 0.05 * k, 320, 0.04 + 0.09 * k); }

  splash(intensity: number, x?: number, y?: number): void { this.spot(x, y, 380, 'fx', () => { if (!this.throttled('splash', 200)) return; const k = Math.max(0.2, Math.min(1, intensity)); this.noiseBurst(0.09 + 0.1 * k, 750, 0.09 + 0.1 * k); this.tone(440, 170, 0.12, 'sine', 0.04 + 0.06 * k); }); }

  alert(): void { if (!this.throttled('alert', 320)) return; this.on('voices', () => this.tone(620, 930, 0.06, 'square', 0.045)); }

  gong(): void { this.tone(196, 193, 1.5, 'sine', 0.22); this.tone(392, 388, 1.0, 'sine', 0.09); this.tone(98, 97, 1.8, 'sine', 0.12); this.noiseBurst(0.06, 2400, 0.05, true); }

  flame(x?: number, y?: number): void {
    this.spot(x, y, 420, 'fx', () => {
      if (!this.throttled('flame', 70)) return;
      this.noiseBurst(0.22, 550 + Math.random() * 300, 0.18);          // body of the roar
      this.noiseBurst(0.10, 2000, 0.05, true);                          // crackling top end
      this.tone(52 + Math.random() * 18, 38, 0.2, 'triangle', 0.06);    // low rumble
    });
  }

  dig(x?: number, y?: number): void {
    this.spot(x, y, 380, 'fx', () => {
      if (!this.throttled('dig', 85)) return;
      this.noiseBurst(0.09, 2800, 0.13, true);                          // grinding hiss
      this.tone(78 + Math.random() * 36, 50, 0.09, 'sawtooth', 0.11);   // motor growl
      if (Math.random() < 0.3) this.tone(900 + Math.random() * 700, 600, 0.04, 'square', 0.05); // rock ping
    });
  }

  levitate(): void { if (!this.throttled('lev', 160)) return; this.noiseBurst(0.12, 1400, 0.05, true); }

  implode(x?: number, y?: number): void {
    this.spot(x, y, 700, 'fx', () => {
      this.tone(70, 950, 0.5, 'sine', 0.4);          // rising suction
      this.noiseBurst(0.45, 260, 0.42);               // deep rush
      this.later(380, () => this.tone(1200, 180, 0.22, 'sawtooth', 0.18)); // snap shut
    });
  }

  // ---- Creature voices ----
  //
  // Each kind gets a sound built from what its body is made of, and every
  // caller places it with `at()` so distance and bearing are part of the
  // voice. The generic "squelch for everything" made a stone creature and a
  // spider sound like the same wet bag; worse, it played at full volume from
  // anywhere in the level.

  chitin(intensity = 1): void {
    if (!this.throttled('chitin', 110)) return;
    const clicks = 2 + (Math.random() < 0.5 ? 1 : 0);
    this.on('voices', () => {
      for (let i = 0; i < clicks; i++) {
        this.later(i * (36 + Math.random() * 34), () => {
          this.noiseBurst(0.012, 3400 + Math.random() * 1400, 0.05 * intensity, true);
          this.tone(2100 + Math.random() * 900, 1400, 0.018, 'square', 0.011 * intensity);
        });
      }
    });
  }

  chirr(dur = 0.28, pitch = 1, vol = 0.07): void {
    const gain = vol * this.gainScale;
    if (gain < 0.0015 || !this.throttled('chirr', 140) || !this.admit(gain)) return;
    // A buzzing carrier chopped by a fast square LFO: a stridulation, not a note.
    const ac = this.audioCtx!, t = this.now();
    const carrier = ac.createOscillator(); carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(420 * pitch, t);
    carrier.frequency.exponentialRampToValueAtTime(290 * pitch, t + dur);
    const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 26 + Math.random() * 14;
    const depth = ac.createGain(); depth.gain.value = 0.5;
    const chop = ac.createGain(); chop.gain.value = 0.5;
    lfo.connect(depth); depth.connect(chop.gain);
    const filter = ac.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1300 * pitch; filter.Q.value = 1.1;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nodes: AudioNode[] = [carrier, lfo, depth, chop, filter, env];
    carrier.connect(chop); chop.connect(filter); filter.connect(env);
    this.on('voices', () => this.sink(env, nodes, gain));
    this.track(carrier, nodes);
    carrier.start(t); lfo.start(t); carrier.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  }

  slither(intensity = 1): void {
    if (!this.throttled('slither', 160)) return;
    this.on('voices', () => {
      this.sweepNoise(0.28, 220, 1100, 0.06 * intensity, false, 2, true);
      this.tone(96, 64, 0.22, 'sine', 0.028 * intensity);
    });
  }

  creak(intensity = 1): void {
    if (!this.throttled('creak', 180)) return;
    this.on('voices', () => {
      this.tone(62, 98, 0.34, 'sawtooth', 0.05 * intensity);
      this.noiseBurst(0.14, 900, 0.028 * intensity, true);
      this.later(110, () => this.tone(150, 84, 0.22, 'triangle', 0.032 * intensity));
    });
  }

  grind(intensity = 1): void {
    if (!this.throttled('grind', 170)) return;
    this.on('voices', () => {
      this.noiseBurst(0.3, 340, 0.1 * intensity);
      this.tone(44, 36, 0.36, 'sine', 0.1 * intensity);
      this.later(120, () => this.noiseBurst(0.06, 1900, 0.04 * intensity, true));
    });
  }

  squeak(): void {
    if (!this.throttled('squeak', 120)) return;
    this.on('voices', () => this.tone(3300 + Math.random() * 500, 2200, 0.05, 'sine', 0.055));
  }

  hop(size = 1): void {
    if (!this.throttled('hop', 120)) return;
    this.on('voices', () => {
      this.noiseBurst(0.05, 280, 0.05 * size);
      this.tone(150, 70, 0.07, 'sine', 0.04 * size);
    });
  }

  deathCry(kind: string): void {
    this.on('voices', () => {
      switch (kind) {
        case 'weaver':
          this.chitin(1.4); this.noiseBurst(0.09, 2200, 0.09, true);
          this.later(60, () => this.chirr(0.4, 0.7, 0.07));
          break;
        case 'rillback':
          this.slither(1.6); this.noiseBurst(0.22, 600, 0.12); this.tone(120, 40, 0.3, 'sine', 0.09);
          break;
        case 'rootloper':
          this.creak(1.5); this.noiseBurst(0.08, 1200, 0.12, true); this.tone(90, 40, 0.25, 'square', 0.06);
          break;
        case 'stonemaw':
          this.grind(1.4); this.noiseBurst(0.12, 2600, 0.1, true);
          break;
        case 'bat':
          this.squeak(); this.noiseBurst(0.05, 1800, 0.05, true);
          break;
        default:
          this.squelch();
      }
    });
  }

  finisherWhip(): void {
    this.sweepNoise(0.55, 300, 2800, 0.09, true, 0.7);
    this.tone(170, 540, 0.5, 'sine', 0.045);
  }

  shellCrack(): void {
    this.noiseBurst(0.05, 3200, 0.22, true);
    this.tone(760, 140, 0.09, 'square', 0.12);
    this.tone(120, 48, 0.2, 'sine', 0.16);
    // ...and, a beat later, the small embarrassed chirr of a creature that recognizes its own leg.
    this.later(230, () => this.chirr(0.32, 1.7, 0.05));
  }

  // ------------------------------------------------------------- stingers
  //
  // Event stingers (audio/Stingers.ts subscribes them to the run events).
  // All on the UI bus: they are rewards and verdicts, so the world duck
  // under a run verdict never swallows them.

  private lastAlchemyAt = -1e9;

  stinger(kind: AudioStinger, opts: AudioStingerOptions = {}): void {
    if (!this.soundOn || !this.audioCtx || !this.graph) return;
    if (this.stingerLog.length >= 16) this.stingerLog.shift();
    this.stingerLog.push(kind);
    // Stingers pan with the event (half-strength: a reward should still feel
    // central) but never attenuate — a kill you caused off-screen still pays.
    const pan = opts.x !== undefined ? (placeSound(opts.x - this.listenerX, 0, Infinity)?.pan ?? 0) * 0.5 : 0;
    const previousPan = this.pan, previousGain = this.gainScale, previousMuffle = this.muffleHz;
    this.pan = pan; this.gainScale = 1; this.muffleHz = 0;
    try {
      this.on('ui', () => {
        if (kind === 'alchemy') this.alchemyChime(opts.chain ?? 1, opts.cause);
        else if (kind === 'phialCrack') this.phialCrack();
        else if (kind === 'phialFill') this.phialFill();
        else if (kind === 'victory') this.victoryMotif();
        else if (kind === 'fallen') this.fallenMotif();
        else if (kind === 'shutter') this.shutterClick();
      });
    } finally { this.pan = previousPan; this.gainScale = previousGain; this.muffleHz = previousMuffle; }
  }

  /**
   * Alchemical kill: a glass bell over a short brass swell, climbing a
   * pentatonic ladder with the chain. Two kills in one blast arpeggiate
   * (the second waits ~70 ms) instead of smearing into one chord.
   */
  private alchemyChime(chain: number, cause?: string): void {
    const now = performance.now();
    const delay = now - this.lastAlchemyAt < 90 ? 0.07 : 0;
    this.lastAlchemyAt = now + delay * 1000;
    const f = 784 * chainPitch(chain); // G5 up the ladder
    const lift = Math.min(1, (chain - 1) / 6);
    this.bell(f, delay, 0.16 + 0.04 * lift, 0.9 + 0.3 * lift);
    // Brass: detuned saws, a fifth below, lowpass opening as the chain grows.
    this.note({ freq: f / 1.5, dur: 0.34 + 0.1 * lift, vol: 0.06 + 0.03 * lift, delay, type: 'sawtooth', attack: 0.03, detune: 7,
      lowpass: 900 + 1500 * lift, lowpassEnd: 500 });
    // Chains of three or more get an octave sparkle.
    if (chain >= 3) this.bell(f * 2, delay + 0.06, 0.05, 0.5);
    // A tiny accent of the material that did it.
    if (cause === 'burned' || cause === 'rendered') this.hit(delay, 0.12, 1800, 0.035);
    else if (cause === 'shorted') this.note({ freq: 2400, endFreq: 900, dur: 0.06, vol: 0.03, delay, type: 'square' });
    else if (cause === 'drowned' || cause === 'steeped') this.note({ freq: 380, endFreq: 620, dur: 0.08, vol: 0.04, delay });
    else if (cause === 'shattered') this.hit(delay, 0.05, 5200, 0.04);
  }

  /** A return phial spent: a sharp glass crack, a falling ring, and a few tinkling shards. */
  private phialCrack(): void {
    this.hit(0, 0.05, 3800, 0.2);
    this.note({ freq: 2350, endFreq: 1500, dur: 0.5, vol: 0.07, attack: 0.001 });
    this.note({ freq: 3710, endFreq: 2600, dur: 0.3, vol: 0.035, attack: 0.001 });
    for (let i = 0; i < 4; i++) this.note({ freq: 2800 + Math.random() * 2400, dur: 0.07, vol: 0.025, delay: 0.09 + i * (0.05 + Math.random() * 0.05), attack: 0.001 });
    this.note({ freq: 180, endFreq: 90, dur: 0.25, vol: 0.06 }); // the hand that held it
  }

  /** A phial restored: liquid pouring upward into glass, settling on a warm major third. */
  private phialFill(): void {
    this.note({ freq: 320, endFreq: 760, dur: 0.55, vol: 0.07, attack: 0.08, type: 'triangle', lowpass: 1400 });
    for (let i = 0; i < 5; i++) this.note({ freq: 520 + i * 90 + Math.random() * 40, endFreq: 700 + i * 110, dur: 0.06, vol: 0.022, delay: 0.05 + i * 0.07 });
    this.bell(523.25, 0.42, 0.11, 1.2); // C5
    this.bell(659.25, 0.5, 0.085, 1.1); // E5
    this.note({ freq: 261.63, dur: 1.2, vol: 0.05, delay: 0.4, attack: 0.12, type: 'triangle' });
  }

  /** Victory: a rising brass fanfare arpeggio into a held open chord with bells. */
  private victoryMotif(): void {
    this.duck(0.35, 2600);
    const steps = [392, 523.25, 659.25, 783.99]; // G4 C5 E5 G5
    steps.forEach((f, i) => {
      this.note({ freq: f, dur: 0.3, vol: 0.07, delay: i * 0.13, type: 'sawtooth', attack: 0.015, detune: 6, lowpass: 2600, lowpassEnd: 1200 });
      this.bell(f * 2, i * 0.13, 0.04, 0.6);
    });
    for (const f of [261.63, 392, 659.25, 1046.5]) {
      this.note({ freq: f, dur: 1.9, vol: 0.055, delay: 0.55, type: 'sawtooth', attack: 0.12, detune: 8, lowpass: 900, lowpassEnd: 2400 });
    }
    this.bell(1046.5, 0.55, 0.1, 1.8);
    this.note({ freq: 65.4, dur: 2.2, vol: 0.12, delay: 0.55, attack: 0.02 }); // C2 floor
  }

  /** Fallen: a slow descending minor line on a tired brass bed, ending on a cold glass bell. */
  private fallenMotif(): void {
    this.duck(0.4, 2800);
    const line = [440, 349.23, 293.66]; // A4 F4 D4
    line.forEach((f, i) => this.bell(f, 0.45 + i * 0.36, 0.09, 1.3));
    this.note({ freq: 146.83, dur: 2.4, vol: 0.06, delay: 0.4, type: 'sawtooth', attack: 0.3, detune: 9, lowpass: 700, lowpassEnd: 260 });
    this.note({ freq: 73.42, dur: 2.6, vol: 0.09, delay: 0.4, attack: 0.2 });
    this.bell(1174.66, 1.6, 0.04, 1.6); // D6, far away
  }

  /** Clip saved: a camera shutter — curtain click, spring, second click. */
  private shutterClick(): void {
    if (!this.throttled('shutter', 250)) return;
    this.hit(0, 0.012, 3000, 0.16);
    this.note({ freq: 1900, endFreq: 1200, dur: 0.03, vol: 0.03, type: 'square' });
    this.hit(0.012, 0.05, 1400, 0.035, false, 1.6); // spring whirr
    this.hit(0.075, 0.016, 2200, 0.12);
    this.note({ freq: 140, endFreq: 90, dur: 0.05, vol: 0.05, delay: 0.075 });
  }

  // ---------------------------------------------------- extension surface
  //
  // The sampled layer (audio/SfxEngine.ts) plays through this same graph,
  // placement and probe trace. Additive and read-mostly on purpose: the
  // procedural voices above stay the fail-open fallback.

  /** The context voices are built on right now (live, or offline during a probe render). */
  protected get voiceContext(): BaseAudioContext | null { return this.soundOn ? this.audioCtx : null; }
  /** The live output context (null before the first gesture or after dispose). */
  protected get outputContext(): AudioContext | null { return this.liveCtx; }
  /** A bus input node of the current graph. */
  protected busNode(bus: AudioBus): GainNode | null { return this.graph?.buses[bus] ?? null; }
  /** The placement a voice created now would get (inside `at()`, the source's; else centred). */
  protected currentPlacement(): { pan: number; gain: number; muffleHz: number } {
    return { pan: this.pan, gain: this.gainScale, muffleHz: this.muffleHz };
  }
  /** Where a source at (x, y) sits for the current listener, or null beyond `range`. */
  protected placementAt(x: number, y: number, range: number): ReturnType<typeof placeSound> {
    return placeSound(x - this.listenerX, y - this.listenerY, range);
  }
  /** Run `fn` routed to `bus` (every voice it sinks lands there). */
  protected routeTo(bus: AudioBus, fn: () => void): void { this.on(bus, fn); }
  /** Terminate a voice chain on the current bus with the current placement (and trace it). */
  protected sinkVoice(head: AudioNode, nodes: AudioNode[], vol: number): void { this.sink(head, nodes, vol); }
  /** Schedule time for a voice starting now (offline probe renders add their lead). */
  protected startTime(): number { return this.now(); }
  /** Run `fn` with an explicit placement (a stinger pans with its event but is never attenuated). */
  protected placed(pan: number, gain: number, muffleHz: number, fn: () => void): void {
    const p = this.pan, g = this.gainScale, m = this.muffleHz;
    this.pan = pan; this.gainScale = gain; this.muffleHz = muffleHz;
    try { fn(); } finally { this.pan = p; this.gainScale = g; this.muffleHz = m; }
  }
  /** Where the ears are (the camera centre). */
  protected listenerPos(): { x: number; y: number } { return { x: this.listenerX, y: this.listenerY }; }
  /** `setTimeout` that keeps the placement and bus `fn` was scheduled under. */
  protected schedule(delayMs: number, fn: () => void): void { this.later(delayMs, fn); }
  /** Record a stinger in the probe log (the sampled stinger path bypasses the procedural one). */
  protected noteStinger(kind: AudioStinger): void {
    if (this.stingerLog.length >= 16) this.stingerLog.shift();
    this.stingerLog.push(kind);
  }

  // ------------------------------------------------------------- probing

  /**
   * Read-only view of the live mix for in-page probes (`window.__game.ctx.audio`).
   * Not a gameplay API.
   */
  debugSnapshot(): {
    running: boolean; volumes: VolumeSettings; buses: Record<AudioBus, number> | null; master: number | null;
    nodeGains: Record<AudioBus | 'master', number> | null;
    duck: number | null; limiter: { threshold: number; ratio: number; reduction: number } | null;
    chain: string[]; voices: number; sunk: number; trace: VoiceTrace[]; stingers: string[]; listener: { x: number; y: number };
  } {
    const g = this.graph;
    // Report the gains the sliders scheduled, not AudioParam.value: Chromium stops
    // refreshing .value on an idle node, so a silent bus reads a stale mid-glide number.
    const buses = g ? (Object.fromEntries(AUDIO_BUSES.map(b => [b, busGain(b, this.volumes)])) as Record<AudioBus, number>) : null;
    return {
      running: this.liveCtx?.state === 'running',
      volumes: { ...this.volumes }, buses, master: g ? volumeToGain(this.volumes.master) : null, duck: g ? g.duck.gain.value : null,
      nodeGains: g ? { ...(Object.fromEntries(AUDIO_BUSES.map(b => [b, g.buses[b].gain.value])) as Record<AudioBus, number>), master: g.master.gain.value } : null,
      limiter: g ? { threshold: g.limiter.threshold.value, ratio: g.limiter.ratio.value, reduction: g.limiter.reduction } : null,
      chain: g ? ['buses', 'duck', 'trim', 'glue', 'makeup', 'limiter', 'clipper', 'master', 'destination'] : [],
      voices: this.voices, sunk: this.sunk, trace: this.trace.map(t => ({ ...t })), stingers: [...this.stingerLog],
      listener: { x: this.listenerX, y: this.listenerY },
    };
  }

  /**
   * Render `fn` through a fresh copy of the mix graph on an OfflineAudioContext
   * and report the output peak/RMS — the probe's way to prove a wall of
   * explosions does not clip. Only sample-scheduled sounds are captured
   * (setTimeout tails fire on the live context afterwards, harmlessly).
   */
  async debugRenderOffline(seconds: number, fn: () => void): Promise<{ peak: number; rms: number }> {
    const live = { ctx: this.audioCtx, graph: this.graph, noise: this.noiseBuffer, brown: this.brownBuffer, voices: this.voices, on: this.soundOn };
    const lead = 0.3;
    const offline = new OfflineAudioContext(2, Math.ceil(44100 * (seconds + lead)), 44100);
    this.audioCtx = offline; this.graph = this.buildGraph(offline); this.noiseBuffer = null; this.brownBuffer = null;
    this.voices = 0; this.soundOn = true; this.lead = lead;
    for (const key of Object.keys(this.sfxThrottle)) delete this.sfxThrottle[key];
    try { fn(); } finally {
      this.audioCtx = live.ctx; this.graph = live.graph; this.noiseBuffer = live.noise; this.brownBuffer = live.brown;
      this.voices = live.voices; this.soundOn = live.on; this.lead = 0;
    }
    const buffer = await offline.startRendering();
    let peak = 0, sum = 0, n = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; sum += a * a; n++; }
    }
    return { peak, rms: Math.sqrt(sum / Math.max(1, n)) };
  }
}
