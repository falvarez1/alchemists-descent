import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import { PAD_DEADZONE, padThresholds } from '@/config/playerPrefs';
import { DEATH_RUMBLE, PadRumble, blastRumble, hurtRumble } from '@/input/padRumble';

describe('rumble strength', () => {
  it('ignores scratches and grows with the hit, never past full', () => {
    expect(hurtRumble(0)).toBeNull();
    expect(hurtRumble(0.01)).toBeNull();
    expect(hurtRumble(NaN)).toBeNull();
    const small = hurtRumble(0.05)!;
    const big = hurtRumble(0.5)!;
    const huge = hurtRumble(9)!;
    expect(small.duration).toBeLessThan(big.duration);
    expect(small.strong).toBeLessThan(big.strong);
    for (const e of [small, big, huge, DEATH_RUMBLE]) {
      expect(e.strong).toBeLessThanOrEqual(1);
      expect(e.weak).toBeLessThanOrEqual(1);
      expect(e.duration).toBeGreaterThan(0);
    }
  });

  it('buzzes for a blast (a real rise to a real level) and not for footsteps or the tail of an old shake', () => {
    expect(blastRumble(0.02, 0.02)).toBeNull(); // too quiet
    expect(blastRumble(0.06, 0.004)).toBeNull(); // not a new blast
    expect(blastRumble(0.06, 0.03)).not.toBeNull();
    expect(blastRumble(0.09, 0.05)!.strong).toBeGreaterThan(blastRumble(0.04, 0.02)!.strong);
  });
});

describe('the dead zone', () => {
  it('is the shipped stick feel at 0.2, and moves every threshold together', () => {
    expect(padThresholds(PAD_DEADZONE.fallback)).toEqual({ move: 0.2, up: 0.35, down: 0.4, aim: 0.25 });
    const loose = padThresholds(0.05), tight = padThresholds(0.45);
    expect(loose.move).toBeLessThan(tight.move);
    expect(loose.up).toBeLessThan(tight.up);
    expect(loose.down).toBeLessThan(tight.down);
    expect(loose.aim).toBeLessThan(tight.aim);
    // A stick pushed fully over still counts at the widest dead zone.
    expect(Math.max(tight.move, tight.up, tight.down, tight.aim)).toBeLessThan(0.8);
  });
});

describe('PadRumble', () => {
  let plays: Array<{ type: string; params: Record<string, number> }>;
  let ctx: Ctx;

  beforeEach(() => {
    plays = [];
    const pad = {
      connected: true,
      mapping: 'standard',
      vibrationActuator: { playEffect: (type: string, params: Record<string, number>) => { plays.push({ type, params }); return Promise.resolve('complete'); } },
    };
    vi.stubGlobal('navigator', { getGamepads: () => [null, pad] });
    vi.stubGlobal('requestAnimationFrame', () => 1); // the frame loop is driven by hand (update())
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('performance', { now: (() => { let t = 1000; return () => (t += 500); })() });
    ctx = {
      events: new EventBus(),
      state: { mode: 'play', paused: false },
      player: { hp: 110, maxHp: 110, dead: false },
      fx: { screenShake: 0 },
    } as unknown as Ctx;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does nothing while the option is off', () => {
    const rumble = new PadRumble(ctx);
    ctx.player.hp = 40;
    rumble.update();
    ctx.events.emit('playerDied', { depth: 1, level: 'x', gold: 0, cause: 'lava' });
    expect(plays).toEqual([]);
  });

  it('rumbles when health is lost, when a blast shakes the view, and when the alchemist falls', () => {
    const rumble = new PadRumble(ctx);
    rumble.setEnabled(true);
    rumble.update();
    expect(plays).toHaveLength(0);
    ctx.player.hp = 88; // a fifth of the bar
    rumble.update();
    expect(plays).toHaveLength(1);
    expect(plays[0].type).toBe('dual-rumble');
    expect(plays[0].params.strongMagnitude).toBeGreaterThan(0.3);
    ctx.fx.screenShake = 0.07; // a blast near enough to shake the view
    rumble.update();
    expect(plays).toHaveLength(2);
    // The same lingering shake next frame is the tail of that blast, not a new one.
    rumble.update();
    expect(plays).toHaveLength(2);
    ctx.events.emit('playerDied', { depth: 1, level: 'x', gold: 0, cause: 'lava' });
    expect(plays).toHaveLength(3);
    expect(plays[2].params.duration).toBe(DEATH_RUMBLE.duration);
    rumble.dispose();
  });

  it('stays quiet in menus, the Sandbox and while dead, and does not replay a stale drop afterwards', () => {
    const rumble = new PadRumble(ctx);
    rumble.setEnabled(true);
    rumble.update();
    ctx.state.paused = true;
    ctx.player.hp = 20; // e.g. the Sanctum takes health as a bargain while paused
    rumble.update();
    ctx.state.paused = false;
    rumble.update(); // the baseline was re-set while paused: the drop is not news now
    expect(plays).toHaveLength(0);
    (ctx.state as { mode: string }).mode = 'build';
    ctx.player.hp = 5;
    rumble.update();
    (ctx.state as { mode: string }).mode = 'play';
    rumble.update();
    expect(plays).toHaveLength(0);
  });

  it('survives a controller that cannot rumble, and an effect the browser refuses', () => {
    const rumble = new PadRumble(ctx);
    rumble.setEnabled(true);
    rumble.update();
    vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, mapping: 'standard' }] });
    ctx.player.hp = 50;
    expect(() => rumble.update()).not.toThrow();
    vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, mapping: 'standard', vibrationActuator: { playEffect: () => Promise.reject(new Error('busy')) } }] });
    ctx.player.hp = 10;
    expect(() => rumble.update()).not.toThrow();
    vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, mapping: 'standard', vibrationActuator: { playEffect: () => { throw new Error('nope'); } } }] });
    ctx.player.hp = 1;
    expect(() => rumble.update()).not.toThrow();
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    ctx.fx.screenShake = 0.08;
    expect(() => rumble.update()).not.toThrow();
  });
});
