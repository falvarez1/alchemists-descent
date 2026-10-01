import { describe, expect, test } from 'vitest';
import { FIGHTER_DEFS, FIGHTER_ORDER } from '@/content/fighters';
import { FIGHTER_TECHNIQUES } from '@/content/fighterTechniques';
import { YARD_STATIONS } from '@/content/fighterArena';
import { DoubleTap, Edge, TECH, keyDir, techniqueFor } from '@/fighters/techniques';

/** The ten movement techniques (docs/arena/ROSTER-IDENTITY.md): the pure parts. The real thing is measured by verify-fighter-moves. */

describe('keyDir', () => {
  test('left, right, and both-or-neither as none', () => {
    expect(keyDir(true, false)).toBe(-1);
    expect(keyDir(false, true)).toBe(1);
    expect(keyDir(true, true)).toBe(0);
    expect(keyDir(false, false)).toBe(0);
  });
});

describe('Edge', () => {
  test('is true only on the tick a key goes down', () => {
    const e = new Edge();
    expect([false, true, true, false, true].map((v) => e.rise(v))).toEqual([false, true, false, false, true]);
  });
  test('reset forgets a held key', () => {
    const e = new Edge();
    e.rise(true);
    e.reset();
    expect(e.rise(true)).toBe(true);
  });
});

describe('DoubleTap', () => {
  const W = TECH.dash.window;
  test('two presses of the same direction inside the window complete a tap in that direction', () => {
    const d = new DoubleTap();
    expect(d.press(1, 100, W)).toBe(0);
    expect(d.press(1, 100 + W, W)).toBe(1);
  });
  test('too slow, or the other way, does not', () => {
    const d = new DoubleTap();
    expect(d.press(-1, 0, W)).toBe(0);
    expect(d.press(-1, W + 1, W)).toBe(0);
    expect(d.press(1, W + 3, W)).toBe(0);
    expect(d.press(-1, W + 5, W)).toBe(0);
  });
  test('a completed tap resets: a third press starts over, so one dash is not two', () => {
    const d = new DoubleTap();
    d.press(1, 0, W);
    expect(d.press(1, 5, W)).toBe(1);
    expect(d.press(1, 8, W)).toBe(0);
    expect(d.press(1, 12, W)).toBe(1);
  });
  test('no press (0) is nothing, and does not disturb a tap in progress', () => {
    const d = new DoubleTap();
    d.press(1, 0, W);
    expect(d.press(0, 3, W)).toBe(0);
    expect(d.press(1, 6, W)).toBe(1);
  });
});

describe('the roster of techniques', () => {
  test('every fighter has one, with copy, a name and a place in the Yard to try it', () => {
    expect(Object.keys(FIGHTER_TECHNIQUES).sort()).toEqual([...FIGHTER_ORDER].sort());
    for (const id of FIGHTER_ORDER) {
      const c = FIGHTER_TECHNIQUES[id];
      expect(c.name.length, id).toBeGreaterThan(3);
      expect(c.how.length, id).toBeGreaterThan(15);
      expect(c.why.length, id).toBeGreaterThan(30);
      expect(Object.keys(YARD_STATIONS), id).toContain(c.where);
    }
  });

  test('no two fighters share a technique name', () => {
    const names = FIGHTER_ORDER.map((id) => FIGHTER_TECHNIQUES[id].name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('the classic Alchemist has no technique; every fighter gets a fresh idle one that counts nothing', () => {
    expect(techniqueFor(null)).toBeNull();
    for (const id of FIGHTER_ORDER) {
      const t = techniqueFor(id);
      expect(t, id).not.toBeNull();
      expect(t?.state).toBe('idle');
      expect(t?.uses).toBe(0);
      expect(t?.usedAt).toBe(-1);
      expect(techniqueFor(id), id).not.toBe(t);
    }
  });

  test('a fighter\'s technique name is in its own design copy somewhere it can be shown (the roster knows the fighter)', () => {
    for (const id of FIGHTER_ORDER) expect(FIGHTER_DEFS[id].name.length).toBeGreaterThan(0);
  });
});

describe('the numbers', () => {
  test('are sane: the dash covers about 19 cells and costs less than a fifth of a tank, the cling budget is a second or two', () => {
    expect(TECH.dash.ticks * TECH.dash.speed).toBeGreaterThan(15);
    expect(TECH.dash.cost).toBeLessThan(25);
    expect(TECH.cling.budget).toBeGreaterThan(60);
    expect(TECH.cling.budget).toBeLessThan(150);
    expect(TECH.wallrun.speed * TECH.wallrun.budget).toBeGreaterThan(60);
    expect(TECH.hover.rise).toBeLessThan(1.5);
    expect(TECH.carry.cap).toBeGreaterThan(4);
    expect(TECH.glide.fall).toBeLessThan(0.5);
  });
});
