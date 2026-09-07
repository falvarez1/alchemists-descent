import type { AudioApi } from '@/core/types';

/** Legacy WebKit prefix fallback (original: `window.AudioContext || window.webkitAudioContext`). */
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

// ===================== Procedural Audio Engine =====================
export class AudioEngine implements AudioApi {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private soundOn = true;
  private readonly sfxThrottle: Record<string, number> = {};
  private voices = 0;
  private noiseBuffer: AudioBuffer | null = null;
  private pan = 0;
  private listenerX = 0;
  private listenerY = 0;
  /** Distance attenuation applied inside `at()`; 1 everywhere else. */
  private gainScale = 1;

  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  /**
   * Position a sound. Everything `fn` plays is panned by bearing and scaled
   * by a squared-ish falloff to silence at `range`. Restores the previous
   * placement afterwards, so nested and scheduled cues stay independent.
   */
  at(x: number, y: number, fn: () => void, range = 380): void {
    const distance = Math.hypot(x - this.listenerX, y - this.listenerY);
    if (distance >= range) return;
    const previousPan = this.pan, previousGain = this.gainScale;
    this.pan = Math.max(-0.9, Math.min(0.9, (x - this.listenerX) / 230));
    this.gainScale = previousGain * (1 - distance / range) ** 1.6;
    try { fn(); } finally { this.pan = previousPan; this.gainScale = previousGain; }
  }

  duck(level: number, ms: number): void {
    if (!this.soundOn || !this.audioCtx || !this.masterGain) return;
    const gain = this.masterGain.gain, t = this.audioCtx.currentTime;
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(gain.value, t);
    gain.linearRampToValueAtTime(0.4 * Math.max(0.05, Math.min(1, level)), t + 0.05);
    gain.linearRampToValueAtTime(0.4, t + Math.max(0.1, ms / 1000));
  }

  /** Schedule `fn` keeping the placement it was scheduled under, not whatever is current when it fires. */
  private later(delayMs: number, fn: () => void): void {
    const pan = this.pan, gain = this.gainScale;
    setTimeout(() => {
      const p = this.pan, g = this.gainScale;
      this.pan = pan; this.gainScale = gain;
      try { fn(); } finally { this.pan = p; this.gainScale = g; }
    }, delayMs);
  }

  private noiseSource(audioCtx: AudioContext): AudioBufferSourceNode {
    if (!this.noiseBuffer) {
      this.noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
      const noise = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  /** Filtered noise whose cutoff glides from `fromHz` to `toHz` (then back for a slide). */
  private sweepNoise(dur: number, fromHz: number, toHz: number, vol: number, hp = false, q = 1, back = false): void {
    if (!this.soundOn || !this.audioCtx || !this.masterGain || this.voices >= 32) return;
    vol *= this.gainScale;
    if (vol < 0.0015) return;
    const audioCtx = this.audioCtx, master = this.masterGain, t = audioCtx.currentTime;
    const src = this.noiseSource(audioCtx);
    const f = audioCtx.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(fromHz, t);
    if (back) {
      f.frequency.exponentialRampToValueAtTime(toHz, t + dur * 0.45);
      f.frequency.exponentialRampToValueAtTime(fromHz, t + dur);
    } else f.frequency.exponentialRampToValueAtTime(toHz, t + dur);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const panner = audioCtx.createStereoPanner(); panner.pan.value = this.pan;
    src.connect(f); f.connect(g); g.connect(panner); panner.connect(master);
    this.voices++;
    src.onended = () => { this.voices = Math.max(0, this.voices - 1); src.disconnect(); f.disconnect(); g.disconnect(); panner.disconnect(); };
    src.start(0, t % 1); src.stop(t + dur + 0.02);
  }

  get enabled(): boolean {
    return this.soundOn;
  }

  ensure(): void {
    if (!this.audioCtx) {
      try {
        const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
        this.audioCtx = new Ctor!();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = 0.4;
        this.masterGain.connect(this.audioCtx.destination);
      } catch {
        this.soundOn = false;
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }

  /** Flip sound on/off; returns the new enabled state. Off suspends the
   *  AudioContext (releases the audio thread); on resumes/creates it. */
  toggle(): boolean {
    this.soundOn = !this.soundOn;
    if (this.soundOn) this.ensure();
    else if (this.audioCtx && this.audioCtx.state === 'running') void this.audioCtx.suspend();
    return this.soundOn;
  }

  /** Tear down: stop scheduling, suspend, and close the AudioContext so the
   *  underlying audio resources are released (e.g. on full game shutdown). */
  dispose(): void {
    this.soundOn = false;
    const ctx = this.audioCtx;
    this.audioCtx = null;
    this.masterGain = null;
    if (ctx && ctx.state !== 'closed') void ctx.close();
  }

  private throttled(key: string, ms: number): boolean {
    const now = performance.now();
    if (this.sfxThrottle[key] && now - this.sfxThrottle[key] < ms) return false;
    this.sfxThrottle[key] = now;
    return true;
  }

  tone(freq: number, endFreq: number, dur: number, type: OscillatorType, vol: number): void {
    // Guard masterGain explicitly (set together with audioCtx in ensure()) so the
    // sink is a real local, not a non-null assertion riding on that coupling.
    if (!this.soundOn || !this.audioCtx || !this.masterGain || this.voices >= 32) return;
    vol *= this.gainScale;
    if (vol < 0.0015) return;
    dur = Math.max(0.005, Math.min(4, dur));
    const audioCtx = this.audioCtx, master = this.masterGain;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    const panner = audioCtx.createStereoPanner(); panner.pan.value = this.pan;
    o.connect(g); g.connect(panner); panner.connect(master);
    this.voices++;
    o.onended = () => { this.voices = Math.max(0, this.voices - 1); o.disconnect(); g.disconnect(); panner.disconnect(); };
    o.start(); o.stop(audioCtx.currentTime + dur + 0.02);
  }

  noiseBurst(dur: number, filterFreq: number, vol: number, hp?: boolean): void {
    if (!this.soundOn || !this.audioCtx || !this.masterGain || this.voices >= 32) return;
    vol *= this.gainScale;
    if (vol < 0.0015) return;
    dur = Math.max(0.005, Math.min(4, dur));
    const audioCtx = this.audioCtx, master = this.masterGain;
    const src = this.noiseSource(audioCtx);
    const f = audioCtx.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = filterFreq;
    const g = audioCtx.createGain(); g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    const panner = audioCtx.createStereoPanner(); panner.pan.value = this.pan;
    src.connect(f); f.connect(g); g.connect(panner); panner.connect(master);
    this.voices++;
    src.onended = () => { this.voices = Math.max(0, this.voices - 1); src.disconnect(); f.disconnect(); g.disconnect(); panner.disconnect(); };
    src.start(0, audioCtx.currentTime % 1); src.stop(audioCtx.currentTime + dur + 0.02);
  }

  /** Local, bounded cues. Distance shapes volume and stereo position together. */
  worldSound(kind: 'stone' | 'metal' | 'water' | 'weaver' | 'rillback' | 'pressure', x: number, y: number, listenerX: number, listenerY: number): void {
    const distance = Math.hypot(x - listenerX, y - listenerY);
    if (distance > 330 || !this.throttled(`world-${kind}`, kind === 'pressure' ? 800 : 105)) return;
    const gain = (1 - distance / 330) ** 2;
    const previousPan = this.pan;
    this.pan = Math.max(-0.9, Math.min(0.9, (x - listenerX) / 230));
    try {
      if (kind === 'stone') { this.noiseBurst(0.035, 780, 0.06 * gain); this.tone(100, 52, 0.045, 'triangle', 0.028 * gain); }
      else if (kind === 'metal') { this.tone(370, 240, 0.09, 'sine', 0.045 * gain); this.noiseBurst(0.025, 1600, 0.03 * gain); }
      else if (kind === 'water') { this.noiseBurst(0.13, 850, 0.045 * gain); this.tone(320, 120, 0.08, 'sine', 0.018 * gain); }
      // Weaver legs are dry chitin on stone: two quick taps, no body tone.
      else if (kind === 'weaver') { this.noiseBurst(0.012, 3600, 0.05 * gain, true); this.later(46, () => this.noiseBurst(0.012, 4300, 0.04 * gain, true)); }
      // A Rillback moves as a wet slide, not a drum: the filter opens and closes over the body.
      else if (kind === 'rillback') { this.sweepNoise(0.24, 220, 1000, 0.045 * gain, false, 2, true); this.tone(96, 66, 0.2, 'sine', 0.022 * gain); }
      else { this.noiseBurst(0.7, 400, 0.055 * gain); this.tone(60, 82, 1.2, 'sine', 0.045 * gain); }
    } finally { this.pan = previousPan; }
  }

  boom(size: number): void { if (!this.throttled('boom', 60)) return; this.noiseBurst(0.35 + size * 0.012, 500, 0.6); this.tone(95, 28, 0.4 + size * 0.01, 'sine', 0.55); }

  zap(): void { if (!this.throttled('zap', 70)) return; this.tone(900, 180, 0.12, 'square', 0.16); }

  lightning(): void { this.noiseBurst(0.22, 2400, 0.35, true); this.tone(1400, 90, 0.18, 'sawtooth', 0.22); }

  coin(streak = 0): void {
    if (!this.throttled('coin', 45)) return;
    // A two-note ching that climbs the scale as a bounty shower cascades in —
    // one semitone per coin in the streak, capped at an octave.
    const mul = Math.pow(2, Math.min(Math.max(0, streak - 1), 12) / 12);
    this.tone(880 * mul, 880 * mul, 0.07, 'sine', 0.16);
    setTimeout(() => this.tone(1318 * mul, 1318 * mul, 0.10, 'sine', 0.15), 55);
  }

  hurt(): void { if (!this.throttled('hurt', 200)) return; this.tone(220, 70, 0.16, 'sawtooth', 0.28); }

  jump(): void { if (!this.throttled('jump', 120)) return; this.tone(290, 480, 0.07, 'sine', 0.10); }

  squelch(): void { if (!this.throttled('squelch', 90)) return; this.noiseBurst(0.18, 320, 0.4); this.tone(160, 38, 0.22, 'sine', 0.3); }

  hollowKnock(): void { if (!this.throttled('hollow', 160)) return; this.tone(140, 60, 0.22, 'sine', 0.22); this.tone(95, 70, 0.3, 'triangle', 0.12); }

  bubble(): void { if (!this.throttled('bubble', 90)) return; this.tone(220 + Math.random() * 120, 160, 0.09, 'sine', 0.07); this.noiseBurst(0.05, 500, 0.04); }

  shatter(): void { if (!this.throttled('shatter', 100)) return; this.noiseBurst(0.12, 3200, 0.14, true); this.tone(1900 + Math.random() * 600, 400, 0.12, 'square', 0.07); }

  // ---- Descent pickup/landmark presets (noita-alchemists-descent.html) ----

  pickup(): void { if (!this.throttled('pickup', 80)) return; this.tone(660, 880, 0.08, 'sine', 0.14); setTimeout(() => this.tone(990, 1320, 0.09, 'sine', 0.12), 70); }

  chest(): void { this.tone(392, 392, 0.12, 'triangle', 0.2); setTimeout(() => this.tone(523, 523, 0.12, 'triangle', 0.2), 110); setTimeout(() => this.tone(784, 784, 0.16, 'triangle', 0.22), 230); }

  keyJingle(): void { this.tone(1568, 1568, 0.09, 'sine', 0.16); setTimeout(() => this.tone(2093, 2093, 0.09, 'sine', 0.15), 70); setTimeout(() => this.tone(1760, 1760, 0.12, 'sine', 0.14), 150); }

  portalWhoosh(): void { this.tone(110, 440, 0.8, 'sine', 0.22); this.tone(165, 660, 0.8, 'sine', 0.16); this.noiseBurst(0.5, 900, 0.1); }

  learn(): void { this.tone(523, 523, 0.11, 'triangle', 0.2); setTimeout(() => this.tone(659, 659, 0.11, 'triangle', 0.2), 140); setTimeout(() => this.tone(784, 784, 0.11, 'triangle', 0.2), 280); setTimeout(() => this.tone(1046, 1046, 0.18, 'triangle', 0.22), 420); }

  drinkPotion(): void { this.tone(420, 280, 0.1, 'sine', 0.14); setTimeout(() => this.tone(520, 340, 0.1, 'sine', 0.13), 90); setTimeout(() => this.tone(640, 400, 0.12, 'sine', 0.12), 180); }

  lever(): void { if (!this.throttled('lever', 150)) return; this.tone(360, 360, 0.04, 'square', 0.12); setTimeout(() => this.tone(220, 220, 0.05, 'square', 0.1), 60); }

  doorGrind(): void { if (!this.throttled('door', 200)) return; this.noiseBurst(0.35, 240, 0.22); this.tone(60, 45, 0.35, 'sawtooth', 0.12); }

  brazier(): void { this.noiseBurst(0.3, 700, 0.18); this.tone(220, 480, 0.3, 'triangle', 0.14); }

  /** A soft, throttled fire crackle for a body that is alight (status.burning). */
  sizzle(): void { if (!this.throttled('sizzle', 240)) return; this.noiseBurst(0.09, 1700, 0.05, true); this.tone(300, 170, 0.07, 'sawtooth', 0.045); }

  /** The airy hiss of water flashing to steam on lava (throttled — a wide front sustains it). */
  steam(): void { if (!this.throttled('steam', 150)) return; this.noiseBurst(0.16, 2200, 0.06, true); this.tone(520, 240, 0.1, 'sine', 0.02); }

  groan(): void { if (!this.throttled('groan', 400)) return; this.tone(72, 38, 0.7, 'sawtooth', 0.16); this.noiseBurst(0.45, 160, 0.12); }

  // ---- Wave F: the quiet sounds of cave life ----

  chirp(): void { if (!this.throttled('chirp', 700)) return; const f = 2600 + Math.random() * 900; this.tone(f, f * 1.06, 0.05, 'sine', 0.045); setTimeout(() => this.tone(f * 0.96, f, 0.04, 'sine', 0.035), 90); }

  skitter(): void { if (!this.throttled('skitter', 600)) return; this.noiseBurst(0.025, 4200, 0.04, true); setTimeout(() => this.noiseBurst(0.02, 4600, 0.03, true), 70); setTimeout(() => this.noiseBurst(0.02, 3900, 0.03, true), 130); }

  drip(): void { if (!this.throttled('drip', 500)) return; this.tone(900 + Math.random() * 300, 420, 0.07, 'sine', 0.06); }

  // ---- Micro-interaction feedback ----

  dryFire(): void { if (!this.throttled('dry', 220)) return; this.tone(140, 90, 0.05, 'square', 0.1); this.noiseBurst(0.03, 1200, 0.05, true); }

  wandSwap(): void { if (!this.throttled('swap', 120)) return; this.noiseBurst(0.05, 2600, 0.07, true); this.tone(520, 760, 0.06, 'triangle', 0.08); }

  sputter(): void { if (!this.throttled('sputter', 260)) return; this.noiseBurst(0.04, 480, 0.09); setTimeout(() => this.noiseBurst(0.03, 380, 0.07), 80); }

  heartbeat(): void { if (!this.throttled('heart', 400)) return; this.tone(58, 42, 0.11, 'sine', 0.22); setTimeout(() => this.tone(52, 38, 0.09, 'sine', 0.16), 150); }

  cardPick(): void { if (!this.throttled('cardp', 80)) return; this.noiseBurst(0.025, 3400, 0.05, true); }

  cardSlot(): void { if (!this.throttled('cards', 80)) return; this.tone(240, 180, 0.05, 'square', 0.12); this.noiseBurst(0.02, 2000, 0.04, true); }

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

  splash(intensity: number): void { if (!this.throttled('splash', 200)) return; const k = Math.max(0.2, Math.min(1, intensity)); this.noiseBurst(0.09 + 0.1 * k, 750, 0.09 + 0.1 * k); this.tone(440, 170, 0.12, 'sine', 0.04 + 0.06 * k); }

  alert(): void { if (!this.throttled('alert', 320)) return; this.tone(620, 930, 0.06, 'square', 0.045); }

  gong(): void { this.tone(196, 193, 1.5, 'sine', 0.22); this.tone(392, 388, 1.0, 'sine', 0.09); this.tone(98, 97, 1.8, 'sine', 0.12); this.noiseBurst(0.06, 2400, 0.05, true); }

  flame(): void {
    if (!this.throttled('flame', 70)) return;
    this.noiseBurst(0.22, 550 + Math.random() * 300, 0.18);          // body of the roar
    this.noiseBurst(0.10, 2000, 0.05, true);                          // crackling top end
    this.tone(52 + Math.random() * 18, 38, 0.2, 'triangle', 0.06);    // low rumble
  }

  dig(): void {
    if (!this.throttled('dig', 85)) return;
    this.noiseBurst(0.09, 2800, 0.13, true);                          // grinding hiss
    this.tone(78 + Math.random() * 36, 50, 0.09, 'sawtooth', 0.11);   // motor growl
    if (Math.random() < 0.3) this.tone(900 + Math.random() * 700, 600, 0.04, 'square', 0.05); // rock ping
  }

  waveHorn(): void { this.tone(196, 196, 0.5, 'triangle', 0.22); setTimeout(() => this.tone(294, 294, 0.6, 'triangle', 0.22), 240); }

  levitate(): void { if (!this.throttled('lev', 160)) return; this.noiseBurst(0.12, 1400, 0.05, true); }

  implode(): void {
    this.tone(70, 950, 0.5, 'sine', 0.4);          // rising suction
    this.noiseBurst(0.45, 260, 0.42);               // deep rush
    setTimeout(() => this.tone(1200, 180, 0.22, 'sawtooth', 0.18), 380); // snap shut
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
    for (let i = 0; i < clicks; i++) {
      this.later(i * (36 + Math.random() * 34), () => {
        this.noiseBurst(0.012, 3400 + Math.random() * 1400, 0.05 * intensity, true);
        this.tone(2100 + Math.random() * 900, 1400, 0.018, 'square', 0.011 * intensity);
      });
    }
  }

  chirr(dur = 0.28, pitch = 1, vol = 0.07): void {
    if (!this.throttled('chirr', 140) || !this.soundOn || !this.audioCtx || !this.masterGain || this.voices >= 32) return;
    const gain = vol * this.gainScale;
    if (gain < 0.0015) return;
    // A buzzing carrier chopped by a fast square LFO: a stridulation, not a note.
    const ac = this.audioCtx, t = ac.currentTime;
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
    const panner = ac.createStereoPanner(); panner.pan.value = this.pan;
    carrier.connect(chop); chop.connect(filter); filter.connect(env); env.connect(panner); panner.connect(this.masterGain);
    this.voices++;
    carrier.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      for (const node of [carrier, lfo, depth, chop, filter, env, panner]) node.disconnect();
    };
    carrier.start(t); lfo.start(t); carrier.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  }

  slither(intensity = 1): void {
    if (!this.throttled('slither', 160)) return;
    this.sweepNoise(0.28, 220, 1100, 0.06 * intensity, false, 2, true);
    this.tone(96, 64, 0.22, 'sine', 0.028 * intensity);
  }

  creak(intensity = 1): void {
    if (!this.throttled('creak', 180)) return;
    this.tone(62, 98, 0.34, 'sawtooth', 0.05 * intensity);
    this.noiseBurst(0.14, 900, 0.028 * intensity, true);
    this.later(110, () => this.tone(150, 84, 0.22, 'triangle', 0.032 * intensity));
  }

  grind(intensity = 1): void {
    if (!this.throttled('grind', 170)) return;
    this.noiseBurst(0.3, 340, 0.1 * intensity);
    this.tone(44, 36, 0.36, 'sine', 0.1 * intensity);
    this.later(120, () => this.noiseBurst(0.06, 1900, 0.04 * intensity, true));
  }

  squeak(): void {
    if (!this.throttled('squeak', 120)) return;
    this.tone(3300 + Math.random() * 500, 2200, 0.05, 'sine', 0.055);
  }

  hop(size = 1): void {
    if (!this.throttled('hop', 120)) return;
    this.noiseBurst(0.05, 280, 0.05 * size);
    this.tone(150, 70, 0.07, 'sine', 0.04 * size);
  }

  deathCry(kind: string): void {
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
}
