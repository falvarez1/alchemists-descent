import { describe, expect, it } from 'vitest';

import { HOLD_ACTIONS, ToggleLatches, holdActionFor, sanitizeToggleModes, type ToggleModes } from '@/input/toggleLatches';

describe('which keys are which action', () => {
  it('maps crouch, levitate, pour and siphon, and nothing else', () => {
    expect(holdActionFor('KeyS')).toBe('down');
    expect(holdActionFor('ArrowDown')).toBe('down');
    expect(holdActionFor('Space')).toBe('jump');
    expect(holdActionFor('KeyQ')).toBe('pour');
    expect(holdActionFor('KeyE')).toBe('interact');
    for (const other of ['KeyA', 'KeyD', 'KeyW', 'ArrowUp', 'ShiftLeft', 'KeyX', 'KeyF', 'KeyG', 'Digit1', 'KeyV', 'Tab', '']) expect(holdActionFor(other)).toBeNull();
    expect(HOLD_ACTIONS).toHaveLength(4);
  });
});

describe('the saved toggle map', () => {
  it('is Hold for everything unless a real true says otherwise', () => {
    expect(sanitizeToggleModes(undefined)).toEqual({ down: false, jump: false, pour: false, interact: false });
    for (const junk of [null, 7, 'x', [], [true], { down: 'true', jump: 1, pour: {}, interact: null }, { extra: true }]) {
      expect(sanitizeToggleModes(junk)).toEqual({ down: false, jump: false, pour: false, interact: false });
    }
    expect(sanitizeToggleModes({ down: true, pour: true, nonsense: true })).toEqual({ down: true, jump: false, pour: true, interact: false });
  });
});

describe('ToggleLatches', () => {
  const make = (modes: ToggleModes) => { const box = { modes }; return { latches: new ToggleLatches(() => box.modes), box }; };

  it('does nothing for an action that is held as ever', () => {
    const { latches } = make({});
    expect(latches.press('KeyS')).toBeNull();
    expect(latches.swallowsRelease('KeyS')).toBe(false);
    expect(latches.size).toBe(0);
    const undef = new ToggleLatches(() => undefined);
    expect(undef.press('Space')).toBeNull();
  });

  it('latches on the first press and lets go on the second', () => {
    const { latches } = make({ down: true });
    expect(latches.press('KeyS')).toEqual({ action: 'down', edge: 'on', code: 'KeyS' });
    expect(latches.isOn('down')).toBe(true);
    expect(latches.active()).toEqual(['down']);
    // The other crouch key turns the same latch off, and reports the key that latched it.
    expect(latches.press('ArrowDown')).toEqual({ action: 'down', edge: 'off', code: 'KeyS' });
    expect(latches.isOn('down')).toBe(false);
    expect(latches.press('KeyS')?.edge).toBe('on');
  });

  it('swallows the release of a toggle key so the latch survives the key coming up', () => {
    const { latches } = make({ jump: true, pour: true });
    latches.press('Space');
    expect(latches.swallowsRelease('Space')).toBe(true);
    expect(latches.swallowsRelease('KeyQ')).toBe(true);
    // A key in Hold mode is released as ever.
    expect(latches.swallowsRelease('KeyS')).toBe(false);
    expect(latches.swallowsRelease('KeyA')).toBe(false);
  });

  it('keeps the four actions independent', () => {
    const { latches } = make({ down: true, jump: true, pour: true, interact: true });
    for (const code of ['KeyS', 'Space', 'KeyQ', 'KeyE']) latches.press(code);
    expect(latches.active()).toEqual(['down', 'jump', 'pour', 'interact']);
    latches.press('KeyQ');
    expect(latches.active()).toEqual(['down', 'jump', 'interact']);
  });

  it('clears everything at once, reporting what each held', () => {
    const { latches } = make({ down: true, jump: true });
    latches.press('KeyS');
    latches.press('Space');
    const dropped = latches.clear();
    expect(dropped).toEqual([{ action: 'down', code: 'KeyS' }, { action: 'jump', code: 'Space' }]);
    expect(latches.size).toBe(0);
    expect(latches.clear()).toEqual([]);
    // After a clear the next press latches fresh, not "off".
    expect(latches.press('KeyS')?.edge).toBe('on');
  });

  it('forgets a latch the game itself let go of', () => {
    const { latches } = make({ pour: true });
    latches.press('KeyQ');
    expect(latches.drop('pour')).toBe(true);
    expect(latches.drop('pour')).toBe(false);
    expect(latches.press('KeyQ')?.edge).toBe('on');
  });

  it('switching the option back to Hold does not strand a release', () => {
    const { latches, box } = make({ down: true });
    latches.press('KeyS');
    box.modes = {};
    // the key is now Hold: its release is no longer swallowed, and the stale latch can be cleared
    expect(latches.swallowsRelease('KeyS')).toBe(false);
    expect(latches.press('KeyS')).toBeNull();
    expect(latches.clear()).toEqual([{ action: 'down', code: 'KeyS' }]);
  });
});
