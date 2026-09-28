import { describe, expect, it } from 'vitest';
import { CHILL_PARAM_DEFAULTS, type ChillTuning } from '@/config/params';
import {
  chillJumpK, chillMoveK, chillMusicCutoff, chillMusicRate, chillScreenTarget, createPlayerChill, stepChill,
  type ChillInputs, type ChillMoment,
} from '@/entities/chill';

const T: ChillTuning = { ...CHILL_PARAM_DEFAULTS };

function inputs(over: Partial<ChillInputs> = {}): ChillInputs {
  return { cold: 0, touching: false, warmth: 0, burning: false, ambientFloor: 0, impulse: 0, press: false, blow: false, ...over };
}

/** Step `n` ticks with the same inputs; returns every moment. */
function run(c: ReturnType<typeof createPlayerChill>, n: number, inp: ChillInputs, frame0 = 0): ChillMoment[] {
  const all: ChillMoment[] = [];
  for (let k = 0; k < n; k++) stepChill(c, inp, T, frame0 + k, all);
  return all;
}

describe('the chill curves', () => {
  it('costs nothing warm and the tuned minimum at full chill', () => {
    expect(chillMoveK(0, T)).toBe(1);
    expect(chillMoveK(0.08, T)).toBe(1); // the ambient cold never slows
    expect(chillMoveK(1, T)).toBeCloseTo(T.moveMin, 6);
    expect(chillJumpK(1, T)).toBeCloseTo(T.jumpMin, 6);
    expect(chillMusicRate(0.15, T)).toBe(1);
    expect(chillMusicRate(1, T)).toBeCloseTo(T.musicRateMin, 6);
    expect(chillMusicCutoff(0, T)).toBeCloseTo(20000, 3);
    expect(chillMusicCutoff(1, T)).toBeCloseTo(T.musicCutoffMin, 3);
    expect(chillScreenTarget(0.14)).toBe(0);
    expect(chillScreenTarget(1)).toBe(1);
  });

  it('falls monotonically, the jump far more gently than the run', () => {
    let prev = 2;
    for (let l = 0; l <= 1.0001; l += 0.05) {
      const m = chillMoveK(l, T);
      expect(m).toBeLessThanOrEqual(prev);
      prev = m;
      expect(chillJumpK(l, T)).toBeGreaterThanOrEqual(m - 1e-9);
      expect(chillMusicRate(l, T)).toBeGreaterThanOrEqual(T.musicRateMin - 1e-9);
    }
  });
});

describe('the chill model', () => {
  it('a brine soak builds the cold, and the rime accretes behind it with crackles', () => {
    const c = createPlayerChill();
    const moments = run(c, 120, inputs({ cold: T.brineBase + T.brineSubmerged * 0.3, touching: true }));
    expect(c.level).toBeGreaterThan(0.3);
    expect(c.rime).toBeGreaterThan(0.25);
    expect(c.rime).toBeLessThanOrEqual(c.level + 1e-9);
    expect(moments.filter((m) => m.kind === 'crackle').length).toBeGreaterThan(3);
    expect(c.moveK).toBeLessThan(1);
  });

  it('warms back out of the cold, and a frozen place holds it at its floor', () => {
    const c = createPlayerChill();
    c.level = 0.6; c.rime = 0.6;
    run(c, 2000, inputs());
    expect(c.level).toBe(0);
    const d = createPlayerChill();
    run(d, 600, inputs({ ambientFloor: T.ambientFloor }));
    expect(d.level).toBeCloseTo(T.ambientFloor, 6);
    run(d, 200, inputs({ ambientFloor: T.ambientFloor, warmth: 1 }));
    expect(d.level).toBeLessThan(T.ambientFloor);
  });

  it('cracks the rime off as a thaw beat when heat drops the cold well under it', () => {
    const c = createPlayerChill();
    c.level = 0.9; c.rime = 0.9;
    const out: ChillMoment[] = [];
    let tick = 0;
    while (!out.some((m) => m.kind === 'thaw') && tick < 400) stepChill(c, inputs({ warmth: 1 }), T, 500 + tick++, out);
    const thaw = out.find((m) => m.kind === 'thaw');
    expect(thaw).toBeDefined();
    expect(thaw!.warm).toBe(true);
    // By a fire the beat comes within a second, with most of the rime still on to shed.
    expect(tick).toBeLessThan(60);
    expect(thaw!.strength).toBeGreaterThan(0.5);
    expect(c.thawAt).toBe(500 + tick - 1);
    expect(c.rime).toBe(c.level);
  });

  it('freezes solid at full chill — briefly, and a press cracks it sooner, a blow bursts it', () => {
    const c = createPlayerChill();
    c.level = 0.99; c.rime = 0.99;
    const m1 = run(c, 1, inputs({ impulse: 0.2 }));
    expect(m1.some((m) => m.kind === 'shell')).toBe(true);
    expect(c.shell).toBe(T.shellTicks);
    // No presses: the lock runs its course, then bursts to shellAfter with a cooldown.
    const held = createPlayerChill();
    held.level = 1; held.shell = T.shellTicks;
    let ticks = 0;
    const out: ChillMoment[] = [];
    while (held.shell > 0 && ticks < 500) { stepChill(held, inputs(), T, ticks, out); ticks++; }
    expect(ticks).toBe(T.shellTicks);
    expect(out.some((m) => m.kind === 'shatter')).toBe(true);
    expect(held.level).toBeCloseTo(T.shellAfter, 6);
    expect(held.cooldown).toBe(T.shellCooldown);
    // Mashing: every other tick a fresh press.
    const mashed = createPlayerChill();
    mashed.level = 1; mashed.shell = T.shellTicks;
    let t2 = 0;
    const out2: ChillMoment[] = [];
    while (mashed.shell > 0 && t2 < 500) { stepChill(mashed, inputs({ press: t2 % 2 === 0 }), T, t2, out2); t2++; }
    expect(t2).toBeLessThan(T.shellTicks / 3);
    expect(out2.filter((m) => m.kind === 'crack').length).toBeGreaterThan(1);
    // A real blow bursts it at once.
    const hit = createPlayerChill();
    hit.level = 1; hit.shell = T.shellTicks;
    const out3: ChillMoment[] = [];
    stepChill(hit, inputs({ blow: true }), T, 0, out3);
    expect(hit.shell).toBe(0);
    expect(out3.some((m) => m.kind === 'shatter')).toBe(true);
  });

  it('fail-open: the worst cold there is never locks the body for long', () => {
    // Liquid nitrogen at its cap, brine to the neck, frost bolts landing every second.
    const c = createPlayerChill();
    const worst = inputs({ cold: T.nitrogenCap + T.brineBase + T.brineSubmerged, touching: true });
    let locked = 0, run1 = 0, longest = 0;
    const out: ChillMoment[] = [];
    for (let k = 0; k < 60 * 60; k++) {
      worst.impulse = k % 60 === 0 ? T.frostbolt : 0;
      stepChill(c, worst, T, k, out);
      if (c.shell > 0) { locked++; run1++; longest = Math.max(longest, run1); } else run1 = 0;
    }
    expect(longest).toBeLessThanOrEqual(T.shellTicks);
    // Locked at most shellTicks of every shellTicks + shellCooldown.
    expect(locked / 3600).toBeLessThanOrEqual(T.shellTicks / (T.shellTicks + T.shellCooldown) + 0.02);
    // Between locks the chill is held under the lock, so the body can move (slowly) and get out.
    expect(c.moveK).toBeGreaterThanOrEqual(T.moveMin - 1e-9);
  });
});
