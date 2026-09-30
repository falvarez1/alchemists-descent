import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXTRAS, HUD_OPACITY, HUD_SCALE, PAD_DEADZONE, PRESENTATION, SHAKE_SCALE, padThresholds, sanitizeBand, sanitizeChoice,
  sanitizeExtras, sanitizeOptionalBand, sanitizeShake, snapToBand, stepsFromDefault,
} from '@/config/playerPrefs';
import { createDefaultPostFxSettings } from '@/config/params';
import { readPlayerPreferences, sanitizePreferences } from '@/ui/PlayerSettings';
import { FocusPause, shouldPauseOnFocusLoss, type FocusFacts } from '@/input/focusPause';

const storageOf = (value: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => value });

describe('presentation bands', () => {
  it('centre on the shipped post-processing values, so untouched means unchanged', () => {
    const post = createDefaultPostFxSettings();
    expect(PRESENTATION.exposure.fallback).toBe(post.exposure);
    expect(PRESENTATION.vignette.fallback).toBe(post.vignette);
    expect(PRESENTATION.bloom.fallback).toBe(post.bloomStrength);
    expect(PRESENTATION.grain.fallback).toBe(post.grain);
  });

  it('keep every slider narrow and the shipped value on its grid', () => {
    for (const band of Object.values(PRESENTATION)) {
      expect(snapToBand(band.fallback, band)).toBeCloseTo(band.fallback, 6);
      expect(band.min).toBeLessThan(band.fallback);
      expect(band.max).toBeGreaterThan(band.fallback);
    }
    // The designed darkness survives: at most ~a quarter brighter / a fifth dimmer.
    expect(PRESENTATION.exposure.max / PRESENTATION.exposure.fallback).toBeLessThan(1.3);
    expect(PRESENTATION.exposure.min / PRESENTATION.exposure.fallback).toBeGreaterThan(0.8);
  });

  it('clamp out-of-band values to the nearest edge and snap to the grid', () => {
    expect(snapToBand(99, PRESENTATION.exposure)).toBe(1.35);
    expect(snapToBand(-3, PRESENTATION.exposure)).toBe(0.9);
    expect(snapToBand(1.0700001, PRESENTATION.exposure)).toBe(1.05);
    expect(snapToBand(1.08, PRESENTATION.exposure)).toBe(1.1);
    expect(snapToBand(0.007, PRESENTATION.grain)).toBe(0.006);
  });

  it('read an absent or garbage value as "never touched" (null) for the optional sliders', () => {
    for (const bad of [undefined, null, 'loud', NaN, Infinity, {}, [], true]) expect(sanitizeOptionalBand(bad, PRESENTATION.bloom)).toBeNull();
    expect(sanitizeOptionalBand(0.21, PRESENTATION.bloom)).toBe(0.21);
    expect(sanitizeOptionalBand(5, PRESENTATION.bloom)).toBe(0.36);
  });

  it('count steps from the shipped value for the slider readout', () => {
    expect(stepsFromDefault(1.05, PRESENTATION.exposure)).toBe(0);
    expect(stepsFromDefault(1.15, PRESENTATION.exposure)).toBe(2);
    expect(stepsFromDefault(0.9, PRESENTATION.exposure)).toBe(-3);
  });
});

describe('required sliders', () => {
  it('fall back to the shipped value on garbage and clamp into the band', () => {
    expect(sanitizeBand('x', HUD_SCALE)).toBe(1);
    expect(sanitizeBand(NaN, HUD_OPACITY)).toBe(1);
    expect(sanitizeBand(1e9, HUD_SCALE)).toBe(1.3);
    expect(sanitizeBand(-1, HUD_SCALE)).toBe(0.8);
    expect(sanitizeBand(0.1, HUD_OPACITY)).toBe(0.5);
    expect(sanitizeBand(1.15, HUD_SCALE)).toBe(1.15);
  });
});

describe('camera shake', () => {
  it('maps Off / Half / Full to 0 / 0.5 / 1', () => {
    expect(SHAKE_SCALE).toEqual({ off: 0, half: 0.5, full: 1 });
  });

  it('migrates the old boolean checkbox and defaults to the shipped Full', () => {
    expect(sanitizeShake(false)).toBe('off');
    expect(sanitizeShake(true)).toBe('full');
    expect(sanitizeShake(undefined)).toBe('full');
    expect(sanitizeShake('half')).toBe('half');
    expect(sanitizeShake('HALF')).toBe('full');
    expect(sanitizeShake({ x: 1 })).toBe('full');
  });
});

describe('enum choices', () => {
  it('accept only the listed values', () => {
    expect(sanitizeChoice('low', ['standard', 'low'] as const, 'standard')).toBe('low');
    expect(sanitizeChoice('ultra', ['standard', 'low'] as const, 'standard')).toBe('standard');
    expect(sanitizeChoice(3, ['standard', 'low'] as const, 'standard')).toBe('standard');
  });
});

describe('gamepad thresholds', () => {
  it('are the original hard-coded numbers at the shipped dead zone', () => {
    expect(padThresholds(PAD_DEADZONE.fallback)).toEqual({ move: 0.2, up: 0.35, down: 0.4, aim: 0.25 });
  });

  it('grow with the dead zone and stay below a full stick throw', () => {
    const wide = padThresholds(PAD_DEADZONE.max);
    expect(wide.move).toBe(0.45);
    expect(wide.down).toBeLessThan(0.8);
    expect(padThresholds(0.05).aim).toBeCloseTo(0.1, 6);
    expect(padThresholds(NaN)).toEqual(padThresholds(0.2));
    expect(padThresholds(9).move).toBe(0.45);
  });
});

describe('extra preferences', () => {
  it('default to the shipped game, bar pause-on-blur', () => {
    const d = sanitizeExtras(undefined);
    expect(d).toEqual(DEFAULT_EXTRAS);
    expect(d.pauseOnBlur).toBe(true);
    expect(d.captionBacking).toBe(false);
    expect(d.numericVitals).toBe(false);
    expect(d.colorAssist).toBe('off');
    expect(d.hintMode).toBe('first');
    expect([d.exposure, d.vignette, d.bloom, d.grain]).toEqual([null, null, null, null]);
    expect(d.hudScale).toBe(1);
    expect(d.hudOpacity).toBe(1);
    expect(d.showEnemyHp).toBe(false);
    expect(d.aimAssist).toBe('off');
    expect(d.padDeadzone).toBe(0.2);
    expect(d.padRumble).toBe(false);
    expect(d.quality).toBe('standard');
  });

  it('survive non-object saves and hostile field values', () => {
    for (const raw of [null, 'x', 7, [], [1, 2], true]) expect(sanitizeExtras(raw)).toEqual(DEFAULT_EXTRAS);
    const hostile = sanitizeExtras({ pauseOnBlur: 'no', captionBacking: 1, numericVitals: 'true', colorAssist: 'rainbow', hintMode: 9, exposure: 'bright', hudScale: 'big', padDeadzone: {}, quality: null, aimAssist: 'cheat' });
    expect(hostile).toEqual(DEFAULT_EXTRAS);
  });

  it('keep valid values, and only an explicit false turns pause-on-blur off', () => {
    const p = sanitizeExtras({ pauseOnBlur: false, captionBacking: true, numericVitals: true, colorAssist: 'blue-yellow', hintMode: 'off', exposure: 1.2, hudScale: 1.3, hudOpacity: 0.7, showEnemyHp: true, aimAssist: 'strong', padDeadzone: 0.3, padRumble: true, quality: 'low' });
    expect(p).toMatchObject({ pauseOnBlur: false, captionBacking: true, numericVitals: true, colorAssist: 'blue-yellow', hintMode: 'off', exposure: 1.2, hudScale: 1.3, hudOpacity: 0.7, showEnemyHp: true, aimAssist: 'strong', padDeadzone: 0.3, padRumble: true, quality: 'low' });
  });
});

describe('the whole preference set', () => {
  it('loads from nothing, corrupt JSON and non-objects with the shipped defaults', () => {
    for (const stored of [null, '', '{"textScale": 1.3, ', 'null', '[1,2,3]', '"a string"', '42']) {
      const p = readPlayerPreferences(storageOf(stored));
      expect(p.textScale).toBe(1);
      expect(p.cameraShake).toBe('full');
      expect(p.pauseOnBlur).toBe(true);
      expect(p.narration).toBe(true);
      expect(p.muted).toBe(false);
      expect(p.hintMode).toBe('first');
    }
  });

  it('loads an old save (boolean shake, no newer fields) without losing what it had', () => {
    const old = JSON.stringify({ textScale: 1.15, reducedFlashes: true, cameraShake: false, highReadability: true, creatureCaptions: true, narration: false, muted: true, trickshot: { enabled: true, finisher: false } });
    const p = readPlayerPreferences(storageOf(old));
    expect(p).toMatchObject({ textScale: 1.15, reducedFlashes: true, cameraShake: 'off', highReadability: true, creatureCaptions: true, narration: false, muted: true });
    expect(p.trickshot.enabled).toBe(true);
    expect(p.pauseOnBlur).toBe(true);
    // A `true` checkbox from an old save is Full.
    expect(readPlayerPreferences(storageOf(JSON.stringify({ cameraShake: true }))).cameraShake).toBe('full');
  });

  it('round-trips through JSON (what apply() persists is what the reader understands)', () => {
    const a = sanitizePreferences({ cameraShake: 'half', pauseOnBlur: false, exposure: 1.25, bloom: 0.12, hudScale: 0.9, hintMode: 'always' }, false);
    const b = readPlayerPreferences(storageOf(JSON.stringify(a)));
    expect(b).toEqual(a);
    expect(b.cameraShake).toBe('half');
    expect(b.exposure).toBe(1.25);
  });

  it('takes reduce-flashes from the OS reduced-motion setting only when nothing was saved', () => {
    expect(sanitizePreferences({}, true).reducedFlashes).toBe(true);
    expect(sanitizePreferences({}, false).reducedFlashes).toBe(false);
    expect(sanitizePreferences({ reducedFlashes: false }, true).reducedFlashes).toBe(false);
  });

  it('ignores unknown fields and rejects a text size that is not one of the three', () => {
    const p = sanitizePreferences({ textScale: 1.22, somethingNew: 'x' }, false);
    expect(p.textScale).toBe(1);
    expect('somethingNew' in p).toBe(false);
  });
});

describe('pause when the window loses focus', () => {
  const playing: FocusFacts = { enabled: true, mode: 'play', paused: false, dead: false, builderOpen: false, uiOwnerActive: false, dialogueOpen: false, linkedPeers: false };

  it('pauses a descent that is being played', () => {
    expect(shouldPauseOnFocusLoss(playing)).toBe(true);
  });

  it.each([
    ['the option is off', { enabled: false }],
    ['in the Sandbox', { mode: 'build' as const }],
    ['already paused (the request is a toggle: it would resume)', { paused: true }],
    ['dead', { dead: true }],
    ['the Builder is open', { builderOpen: true }],
    ['a menu, the title or a cinematic owns the screen', { uiOwnerActive: true }],
    ['mid-conversation', { dialogueOpen: true }],
    ['a linked editor window is open', { linkedPeers: true }],
  ])('does nothing when %s', (_name, override) => {
    expect(shouldPauseOnFocusLoss({ ...playing, ...override })).toBe(false);
  });
});

describe('FocusPause listener', () => {
  let win: EventTarget;
  let doc: EventTarget & { hidden: boolean; body: { classList: { contains: () => boolean } } };
  beforeEach(() => {
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { hidden: false, body: { classList: { contains: () => false } } });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function fakeCtx(overrides: { mode?: 'play' | 'build'; paused?: boolean; pauseOnBlur?: boolean | undefined } = {}): never {
    return {
      state: { mode: overrides.mode ?? 'play', paused: overrides.paused ?? false, pauseOnBlur: overrides.pauseOnBlur },
      player: { dead: false },
      peers: { count: 0 },
      events: { on: () => () => undefined },
    } as never;
  }

  function requests(): { count: () => number; stop: () => void } {
    let n = 0;
    const listener = (): void => { n++; };
    win.addEventListener('game-pause-request', listener);
    return { count: () => n, stop: () => win.removeEventListener('game-pause-request', listener) };
  }

  it('asks the pause menu for a pause once per focus loss, and never in the wrong state', () => {
    const seen = requests();
    const ctx = fakeCtx();
    const focus = new FocusPause(ctx, () => false);
    expect(focus.focusLost()).toBe(true);
    expect(seen.count()).toBe(1);
    // The menu takes the pause claim synchronously; a second event (blur, then visibilitychange) is a no-op.
    (ctx as unknown as { state: { paused: boolean } }).state.paused = true;
    expect(focus.focusLost()).toBe(false);
    expect(seen.count()).toBe(1);
    focus.dispose();

    const off = new FocusPause(fakeCtx({ pauseOnBlur: false }), () => false);
    expect(off.focusLost()).toBe(false);
    off.dispose();
    const unset = new FocusPause(fakeCtx({ pauseOnBlur: undefined }), () => false);
    expect(unset.focusLost()).toBe(true);
    unset.dispose();
    const sandbox = new FocusPause(fakeCtx({ mode: 'build' }), () => false);
    expect(sandbox.focusLost()).toBe(false);
    sandbox.dispose();
    const menu = new FocusPause(fakeCtx(), () => true);
    expect(menu.focusLost()).toBe(false);
    menu.dispose();
    expect(seen.count()).toBe(2);
    seen.stop();
  });

  it('reacts to the window blur event and to the tab going hidden, and stops after dispose', () => {
    const seen = requests();
    const focus = new FocusPause(fakeCtx(), () => false);
    win.dispatchEvent(new Event('blur'));
    expect(seen.count()).toBe(1);
    // A tab that becomes visible again is not a focus loss.
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen.count()).toBe(1);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen.count()).toBe(2);
    focus.dispose();
    win.dispatchEvent(new Event('blur'));
    expect(seen.count()).toBe(2);
    seen.stop();
  });
});

describe('numeric vitals', () => {
  it('formats whole numbers inside 0..max', async () => {
    const { formatVital } = await import('@/ui/VitalNumbers');
    expect(formatVital(110, 110)).toBe('110/110');
    expect(formatVital(37.4, 110, Math.ceil)).toBe('38/110');
    expect(formatVital(37.9, 110)).toBe('37/110');
    expect(formatVital(-4, 90)).toBe('0/90');
    expect(formatVital(500, 90)).toBe('90/90');
    expect(formatVital(10, 0)).toBe('0/0');
  });
});
