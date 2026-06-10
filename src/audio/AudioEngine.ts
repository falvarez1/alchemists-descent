import type { AudioApi } from '@/core/types';

/** Legacy WebKit prefix fallback (original: `window.AudioContext || window.webkitAudioContext`). */
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

// ===================== Procedural Audio Engine =====================
export class AudioEngine implements AudioApi {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private soundOn = true;
  private readonly sfxThrottle: Record<string, number> = {};

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
      } catch (e) {
        this.soundOn = false;
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }

  /** Flip sound on/off; returns the new enabled state. */
  toggle(): boolean {
    this.soundOn = !this.soundOn;
    if (this.soundOn) this.ensure();
    return this.soundOn;
  }

  private throttled(key: string, ms: number): boolean {
    const now = performance.now();
    if (this.sfxThrottle[key] && now - this.sfxThrottle[key] < ms) return false;
    this.sfxThrottle[key] = now;
    return true;
  }

  tone(freq: number, endFreq: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.soundOn || !this.audioCtx) return;
    const audioCtx = this.audioCtx;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(this.masterGain!);
    o.start(); o.stop(audioCtx.currentTime + dur + 0.02);
  }

  noiseBurst(dur: number, filterFreq: number, vol: number, hp?: boolean): void {
    if (!this.soundOn || !this.audioCtx) return;
    const audioCtx = this.audioCtx;
    const len = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const f = audioCtx.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = filterFreq;
    const g = audioCtx.createGain(); g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(this.masterGain!);
    src.start();
  }

  boom(size: number): void { if (!this.throttled('boom', 60)) return; this.noiseBurst(0.35 + size * 0.012, 500, 0.6); this.tone(95, 28, 0.4 + size * 0.01, 'sine', 0.55); }

  zap(): void { if (!this.throttled('zap', 70)) return; this.tone(900, 180, 0.12, 'square', 0.16); }

  lightning(): void { this.noiseBurst(0.22, 2400, 0.35, true); this.tone(1400, 90, 0.18, 'sawtooth', 0.22); }

  coin(): void { if (!this.throttled('coin', 50)) return; this.tone(880, 880, 0.07, 'sine', 0.16); setTimeout(() => this.tone(1318, 1318, 0.10, 'sine', 0.15), 55); }

  hurt(): void { if (!this.throttled('hurt', 200)) return; this.tone(220, 70, 0.16, 'sawtooth', 0.28); }

  jump(): void { if (!this.throttled('jump', 120)) return; this.tone(290, 480, 0.07, 'sine', 0.10); }

  squelch(): void { if (!this.throttled('squelch', 90)) return; this.noiseBurst(0.18, 320, 0.4); this.tone(160, 38, 0.22, 'sine', 0.3); }

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
}
