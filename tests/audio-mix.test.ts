import { describe, expect, it } from 'vitest';
import {
  BUS_BASE,
  DEFAULT_VOLUMES,
  MAX_PAN,
  PAN_SPAN,
  busGain,
  chainPitch,
  placeSound,
  sanitizeVolumes,
  volumeToGain,
} from '@/audio/mix';
import { installAudioStingers } from '@/audio/Stingers';
import { EventBus } from '@/core/events';
import type { AudioStinger, AudioStingerOptions } from '@/core/types';
import { readPlayerPreferences } from '@/ui/PlayerSettings';
import { TRICKSHOT_DEFAULTS } from '@/config/trickshot';

describe('placeSound: pan and attenuation follow the source', () => {
  it('centres a sound on the listener at full gain with no muffle', () => {
    expect(placeSound(0, 0)).toEqual({ pan: 0, gain: 1, muffleHz: 0 });
  });

  it('pans by bearing and reaches MAX_PAN at the view edge, never hard', () => {
    const right = placeSound(PAN_SPAN / 2, 0)!;
    const left = placeSound(-PAN_SPAN / 2, 0)!;
    expect(right.pan).toBeCloseTo(MAX_PAN / 2, 5);
    expect(left.pan).toBeCloseTo(-MAX_PAN / 2, 5);
    expect(placeSound(PAN_SPAN, 0, 2000)!.pan).toBeCloseTo(MAX_PAN, 5);
    expect(placeSound(PAN_SPAN * 3, 0, 2000)!.pan).toBe(MAX_PAN);
  });

  it('holds full gain inside the near plateau, then falls monotonically to silence at range', () => {
    expect(placeSound(40, 0)!.gain).toBe(1);
    let last = 1;
    for (let d = 80; d < 380; d += 20) {
      const g = placeSound(d, 0)!.gain;
      expect(g).toBeLessThan(last);
      last = g;
    }
    expect(placeSound(379, 0)!.gain).toBeLessThan(0.001);
    expect(placeSound(380, 0)).toBeNull();
    expect(placeSound(Number.NaN, 0)).toBeNull();
  });

  it('counts vertical distance heavier than horizontal (16:9 view)', () => {
    expect(placeSound(0, 150)!.gain).toBeLessThan(placeSound(150, 0)!.gain);
  });

  it('muffles only distant sounds, more the further they are', () => {
    expect(placeSound(90, 0)!.muffleHz).toBe(0);
    const mid = placeSound(220, 0)!.muffleHz, far = placeSound(340, 0)!.muffleHz;
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(650);
  });

  it('respects a caller range (bosses carry further)', () => {
    expect(placeSound(500, 0)).toBeNull();
    expect(placeSound(500, 0, 700)!.gain).toBeGreaterThan(0);
  });
});

describe('volumes', () => {
  it('uses a squared taper: half-way is -12 dB, ends are exact', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(20 * Math.log10(volumeToGain(0.5))).toBeCloseTo(-12.04, 1);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
  });

  it('routes buses to their slider: effects drives fx/voices/ui, ambience only the bed', () => {
    const v = { master: 1, effects: 0.5, ambience: 0 };
    expect(busGain('fx', v)).toBeCloseTo(BUS_BASE.fx * 0.25);
    expect(busGain('voices', v)).toBeCloseTo(BUS_BASE.voices * 0.25);
    expect(busGain('ui', v)).toBeCloseTo(BUS_BASE.ui * 0.25);
    expect(busGain('ambience', v)).toBe(0);
  });

  it('sanitizes persisted volumes per channel', () => {
    expect(sanitizeVolumes(undefined)).toEqual(DEFAULT_VOLUMES);
    expect(sanitizeVolumes('loud')).toEqual(DEFAULT_VOLUMES);
    expect(sanitizeVolumes({ master: 0.3, effects: 7, ambience: Number.NaN })).toEqual({ master: 0.3, effects: 1, ambience: DEFAULT_VOLUMES.ambience });
    expect(sanitizeVolumes({ master: -2 }).master).toBe(0);
  });

  it('persists through the player preferences and survives a reload', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    expect(readPlayerPreferences(storage).volume).toEqual(DEFAULT_VOLUMES);
    store.set('ad-player-preferences-v1', JSON.stringify({ volume: { master: 0.42, effects: 0.1, ambience: 0 } }));
    expect(readPlayerPreferences(storage).volume).toEqual({ master: 0.42, effects: 0.1, ambience: 0 });
    store.set('ad-player-preferences-v1', '{not json');
    expect(readPlayerPreferences(storage).volume).toEqual(DEFAULT_VOLUMES);
  });

  it('keeps the Trickshot switches but always takes its timing numbers from the tuned defaults', () => {
    const store = new Map<string, string>([['ad-player-preferences-v1', JSON.stringify({
      trickshot: { enabled: true, finisher: false, cameraMotion: false, timeScale: 0.8, durationMs: 1200, chainWindowMs: 1200, assistDegrees: 0, impactPauseMs: 0 },
    })]]);
    const t = readPlayerPreferences({ getItem: (k: string) => store.get(k) ?? null }).trickshot;
    expect(t).toEqual({ ...TRICKSHOT_DEFAULTS, enabled: true, finisher: false, cameraMotion: false });
  });
});

describe('alchemy chime pitch', () => {
  it('climbs a pentatonic ladder with the chain and tops out two octaves up', () => {
    expect(chainPitch(1)).toBe(1);
    let last = 1;
    for (let c = 2; c <= 11; c++) { expect(chainPitch(c)).toBeGreaterThan(last); last = chainPitch(c); }
    expect(chainPitch(11)).toBeCloseTo(4, 5);
    expect(chainPitch(40)).toBeCloseTo(4, 5);
    expect(chainPitch(0)).toBe(1);
  });
});

describe('stingers react to run events', () => {
  const setup = () => {
    const events = new EventBus();
    const played: Array<[AudioStinger, AudioStingerOptions | undefined]> = [];
    const dispose = installAudioStingers(events, { stinger: (kind, opts) => { played.push([kind, opts]); } });
    return { events, played, dispose };
  };

  it('chimes an alchemical kill with its chain, cause and position', () => {
    const { events, played } = setup();
    events.emit('alchemyKill', { kind: 'weaver', cause: 'shorted', x: 10, y: 20, chain: 3, bonusGold: 5 });
    expect(played).toEqual([['alchemy', { chain: 3, cause: 'shorted', x: 10, y: 20 }]]);
  });

  it('cracks a phial on death, fills on restore, and stays silent when nothing was filled', () => {
    const { events, played } = setup();
    events.emit('phialsChanged', { phials: 3, max: 3, reason: 'start' });
    events.emit('phialsChanged', { phials: 3, max: 3, reason: 'refuge' });
    events.emit('phialsChanged', { phials: 2, max: 3, reason: 'death' });
    events.emit('phialsChanged', { phials: 3, max: 3, reason: 'sanctum' });
    expect(played.map(([k]) => k)).toEqual(['phialCrack', 'phialFill']);
  });

  it('plays the run verdict (not for an abandoned run) and the clip shutter', () => {
    const { events, played, dispose } = setup();
    const summary = { seed: 1, daily: null, kit: 'spark' as const, floor: 4, floorName: 'THE KILN HEART', floorsTotal: 4, timeMs: 1, kills: 0,
      alchemicalKills: 0, bestChain: 0, deaths: 0, gold: 0, cardsFound: 0, epitaph: '' };
    events.emit('runEnded', { ...summary, outcome: 'victory' });
    events.emit('runEnded', { ...summary, outcome: 'fallen' });
    events.emit('runEnded', { ...summary, outcome: 'abandoned' });
    events.emit('clipSaved', { url: 'blob:x', filename: 'x.gif', bytes: 1, frames: 1, durationMs: 1 });
    expect(played.map(([k]) => k)).toEqual(['victory', 'fallen', 'shutter']);
    dispose();
    events.emit('clipSaved', { url: 'blob:x', filename: 'x.gif', bytes: 1, frames: 1, durationMs: 1 });
    expect(played).toHaveLength(3);
  });
});
