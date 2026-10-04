import { describe, expect, it } from 'vitest';
import { animationFrame, advanceAnimation, type DuelAnimation } from '@/render/duel/animation';

const clip: DuelAnimation = {
  loop: false,
  frames: [
    { name: 'wind0', ticks: 2, phase: 'startup' },
    { name: 'wind1', ticks: 2, phase: 'startup' },
    { name: 'hit', ticks: 2, phase: 'active' },
    { name: 'back0', ticks: 3, phase: 'recovery' },
    { name: 'back1', ticks: 3, phase: 'recovery' },
  ],
};

describe('Duel animation playback', () => {
  it('holds the final one-shot pose and loops only looping clips', () => {
    expect(animationFrame(clip, 100)).toBe('back1');
    expect(animationFrame({ ...clip, loop: true }, 12)).toBe('wind0');
    expect(animationFrame(clip, 2)).toBe('wind1');
  });
  it('retimes contact and recovery to authoritative attack phases', () => {
    const spec = { startup: 8, active: 5, recovery: 20 };
    expect(animationFrame(clip, 0, { age: 7, phase: 'startup', spec })).toBe('wind1');
    expect(animationFrame(clip, 0, { age: 8, phase: 'active', spec })).toBe('hit');
    expect(animationFrame(clip, 0, { age: 13, phase: 'recovery', spec })).toBe('back0');
    expect(animationFrame(clip, 0, { age: 32, phase: 'recovery', spec })).toBe('back1');
  });
  it('restarts state changes, never advances twice for two render passes, and holds hitstop', () => {
    let state = advanceAnimation(undefined, 'dodge', 100, false);
    state = advanceAnimation(state, 'dodge', 103, false);
    expect(state.age).toBe(3);
    expect(advanceAnimation(state, 'dodge', 103, false).age).toBe(3);
    state = advanceAnimation(state, 'dodge', 105, true);
    expect(state.age).toBe(3);
    expect(advanceAnimation(state, 'dodge', 106, false).age).toBe(4);
    expect(advanceAnimation(state, 'land', 106, false).age).toBe(0);
    expect(advanceAnimation(state, 'dodge', 1, false).age).toBe(0);
  });
});
