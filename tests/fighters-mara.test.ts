import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, EnemyKind, Projectile } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit } from '@/fighters/kits/mara-quell';
import {
  ARM_LEN, BellBook, POST_H, RippleBook, TUNING, aimDistance, bellVisibility, chimeEffectFor, findBellSpot, hangSpot,
  lineOpen, makesFootfalls, newFootTrack, postSpot, ripplePower, rippleShape, stepFoot, waveRadius, within,
} from '@/fighters/kits/mara-quell-logic';
import type { Bell, BellSpot, SpotProbe } from '@/fighters/kits/mara-quell-logic';
import { Cell } from '@/sim/CellType';

/**
 * Mara Quell's rules, node-only: how a foe's feet are told apart (walking, climbing, landing, standing), the
 * ripple's brightness and shape, where a bell may hang (a post on the floor, a chain from the ceiling, nowhere
 * in a crawl pocket), the pair of bells and their clocks, the wave's radius and who it touches, and the kit
 * wired to the real FighterSystem over a fake world. What it does to the real engine is probed in
 * scripts/verify-fighter-mara.mjs.
 */

const R = TUNING.resonance;
const B = TUNING.bell;
const C = TUNING.chime;

describe('the numbers the spec names', () => {
  it('are the spec\'s', () => {
    expect(R.range).toBe(200);
    expect(R.every).toBe(14);
    expect(B.cooldown).toBe(14 * 60);
    expect(B.max).toBe(2);
    expect(B.lifetime).toBe(30 * 60);
    expect(B.reach).toBe(70);
    expect(B.triggerRadius).toBe(70);
    expect(B.revealRadius).toBe(100);
    expect(B.revealTicks).toBe(4 * 60);
    expect(B.rearm).toBe(6 * 60);
    expect(C.radius).toBe(150);
    expect(C.expandTicks).toBe(20);
    expect(C.slowFactor).toBe(0.45);
    expect(C.slowTicks).toBe(6 * 60);
    expect(C.stunTicks).toBe(3 * 60);
    expect(C.duration).toBe(6 * 60);
    expect(kit.tacticalCooldown).toBe(14 * 60);
    expect(kit.ultimateDuration).toBe(6 * 60);
  });
});

// -------------------------------------------------------------------------------------- Keen Resonance

describe('Keen Resonance: a foe\'s feet', () => {
  /** Walk a foe `speed` cells a tick for `n` ticks, returning the ticks (1-based) a ripple was made on. */
  const walk = (speed: number, n: number): number[] => {
    const t = newFootTrack(0, 0, true);
    const at: number[] = [];
    for (let i = 1; i <= n; i++) if (stepFoot(t, Math.round(i * speed * 100) / 100, 0, true) === 'step') at.push(i);
    return at;
  };

  it('a foe that walks leaves a ripple every 14 ticks, from the moment it starts', () => {
    const at = walk(0.5, 100);
    expect(at.length).toBeGreaterThanOrEqual(7);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBe(R.every);
    expect(at[0]).toBeLessThanOrEqual(2);
  });

  it('a slow plod made of whole-cell steps (a golem at 0.25 cells a tick) still counts', () => {
    // Positions move in whole cells, so a 0.25 plod is one step every 4 ticks.
    const t = newFootTrack(0, 0, true);
    let x = 0, n = 0;
    for (let i = 1; i <= 120; i++) {
      if (i % 4 === 0) x++;
      if (stepFoot(t, x, 0, true) === 'step') n++;
    }
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it('a foe that stands still makes nothing, and neither does one hanging in the air', () => {
    const t = newFootTrack(10, 10, true);
    let n = 0;
    for (let i = 0; i < 200; i++) if (stepFoot(t, 10, 10, true) !== null) n++;
    expect(n).toBe(0);
    const f = newFootTrack(10, 10, false);
    for (let i = 0; i < 200; i++) if (stepFoot(f, 10 + i * 0.5, 10, false) !== null) n++;
    expect(n).toBe(0);
  });

  it('a touchdown after a real fall is a landing, once; a stair-step is not', () => {
    const t = newFootTrack(0, 0, true);
    for (let i = 0; i < 3; i++) stepFoot(t, 0, 0, true);
    // two ticks off the ground and back: a step down, a footfall at most, not a landing
    stepFoot(t, 0, 1, false);
    stepFoot(t, 0, 2, false);
    expect(stepFoot(t, 0, 3, true)).not.toBe('land');
    // a fall of many ticks
    for (let i = 0; i < 9; i++) stepFoot(t, 0, 3 + i * 2, false);
    expect(stepFoot(t, 0, 21, true)).toBe('land');
    expect(stepFoot(t, 0, 21, true)).toBeNull();
  });

  it('a hopping foe is felt where it comes down', () => {
    const t = newFootTrack(0, 0, true);
    const events: string[] = [];
    // hop: 12 ticks in the air, then 20 on the ground, three times
    let x = 0;
    for (let hop = 0; hop < 3; hop++) {
      for (let i = 0; i < 12; i++) { x += 2; const e = stepFoot(t, x, -3, false); if (e) events.push(e); }
      for (let i = 0; i < 20; i++) { const e = stepFoot(t, x, 0, true); if (e) events.push(e); }
    }
    expect(events.filter((e) => e === 'land')).toHaveLength(3);
  });

  it('a crawler on a wall (on a surface, moving up) is climbing: it makes steps', () => {
    const t = newFootTrack(0, 100, true);
    let n = 0;
    for (let i = 1; i <= 60; i++) if (stepFoot(t, 0, 100 - i * 0.4, true) === 'step') n++;
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('a foe that just came into range, or was thrown across the room, did not walk that far', () => {
    const t = newFootTrack(0, 0, true);
    for (let i = 0; i < 5; i++) stepFoot(t, 0, 0, true);
    expect(stepFoot(t, 90, 0, true)).toBeNull();
    for (let i = 0; i < 30; i++) expect(stepFoot(t, 90, 0, true)).toBeNull();
  });

  it('fliers, hoverers and the egg clutch make no footfalls; walkers and bosses do', () => {
    for (const k of ['bat', 'imp', 'wisp', 'eggs', 'lenswright'] as EnemyKind[]) expect(makesFootfalls(k)).toBe(false);
    for (const k of ['slime', 'golem', 'mage', 'spitter', 'bomber', 'weaver', 'colossus', 'rillback'] as EnemyKind[]) expect(makesFootfalls(k)).toBe(true);
  });
});

describe('Keen Resonance: the ripple', () => {
  it('nearer is brighter: power falls from 1 at point blank to the faint floor at the edge of her range', () => {
    expect(ripplePower(0)).toBeCloseTo(1, 6);
    expect(ripplePower(R.range)).toBeCloseTo(R.faint, 6);
    let last = 2;
    for (let d = 0; d <= R.range; d += 10) {
      const p = ripplePower(d);
      expect(p).toBeLessThan(last);
      last = p;
    }
    expect(ripplePower(-5)).toBeCloseTo(1, 6);
    expect(ripplePower(999)).toBeCloseTo(R.faint, 6);
    expect(ripplePower(50)).toBeGreaterThan(ripplePower(150));
  });

  it('opens out and fades over its life, then is gone; a landing is wider and brighter', () => {
    const step = { x: 0, y: 0, born: 100, power: 0.8, big: false };
    const land = { ...step, big: true };
    let lastRx = 0, lastA = 2;
    for (let age = 0; age < R.life; age++) {
      const s = rippleShape(step, 100 + age);
      expect(s).not.toBeNull();
      expect(s!.rx).toBeGreaterThan(lastRx - 1e-9);
      expect(s!.a).toBeLessThan(lastA);
      expect(s!.ry).toBeLessThan(s!.rx); // a ripple lying on the ground is an ellipse
      lastRx = s!.rx;
      lastA = s!.a;
    }
    expect(rippleShape(step, 100 + R.life)).toBeNull();
    expect(rippleShape(step, 99)).toBeNull();
    const a = rippleShape(step, 120)!, b = rippleShape(land, 120)!;
    expect(b.rx).toBeGreaterThan(a.rx);
    expect(b.a).toBeGreaterThan(a.a);
  });

  it('the book keeps them in order, prunes the faded and caps the count', () => {
    const book = new RippleBook();
    for (let i = 0; i < R.maxRipples + 10; i++) book.add(i, 0, i, 0.5, false);
    expect(book.list).toHaveLength(R.maxRipples);
    expect(book.births).toBe(R.maxRipples + 10);
    expect(book.list[0].born).toBe(10);
    book.prune(10 + R.life + 5);
    expect(book.list.every((r) => 10 + R.life + 5 - r.born < R.life)).toBe(true);
    book.prune(10_000);
    expect(book.list).toHaveLength(0);
    expect(book.births).toBe(R.maxRipples + 10);
  });
});

// ------------------------------------------------------------------------------------ the bell's spot

/** A grid from rows of text: '#' solid, '.' open, '~' liquid. Row 0 is y = 0; out of bounds is solid. */
function grid(rows: string[]): SpotProbe & { w: number; h: number } {
  const h = rows.length, w = rows[0].length;
  const at = (x: number, y: number): string => (x < 0 || y < 0 || x >= w || y >= h ? '#' : rows[y][x]);
  return { w, h, solid: (x, y) => at(x, y) === '#', open: (x, y) => at(x, y) === '.' };
}

/** A hall: open air over a solid floor from row `floor` down, `w` wide. */
function hall(w: number, h: number, floor: number): string[] {
  return Array.from({ length: h }, (_, y) => (y >= floor ? '#'.repeat(w) : '.'.repeat(w)));
}

describe('the bell\'s spot', () => {
  it('on a flat floor a post stands under the aim, its arm reaching the way she faces', () => {
    const g = grid(hall(80, 60, 50));
    const right = findBellSpot(g, 40, 44, { search: B.search, prefSide: 1 })!;
    expect(right.mode).toBe('post');
    expect(right.y).toBe(49); // the cell above the floor
    expect(right.side).toBe(1);
    expect(Math.hypot(right.cx - 40, right.cy - 44)).toBeLessThanOrEqual(B.search);
    const left = findBellSpot(g, 40, 44, { search: B.search, prefSide: -1 })!;
    expect(left.side).toBe(-1);
    expect(left.cx).toBeLessThan(left.x);
    // the bell's own middle is as close to the aim as the geometry lets it be
    expect(Math.abs(right.cx - 40)).toBeLessThanOrEqual(1);
  });

  it('every cell of the post, the arm, the chain and the bell is open, and the foot is on solid ground', () => {
    const g = grid(hall(80, 60, 50));
    const s = findBellSpot(g, 40, 44, { search: B.search, prefSide: 1 })!;
    expect(g.solid(s.x, s.y + 1)).toBe(true);
    for (let y = s.y - POST_H; y <= s.y; y++) expect(g.open(s.x, y)).toBe(true);
    for (let k = 0; k <= ARM_LEN; k++) expect(g.open(s.x + s.side * k, s.y - POST_H)).toBe(true);
    for (let dy = 0; dy < 9; dy++) for (let dx = -3; dx <= 3; dx++) expect(g.open(s.cx + dx, s.top + dy)).toBe(true);
  });

  it('aimed into a ceiling it hangs from the ceiling on a chain', () => {
    const rows = hall(80, 70, 66);
    // a slab of rock over the aim: rows 20..24
    for (let y = 20; y <= 24; y++) rows[y] = '#'.repeat(80);
    const g = grid(rows);
    const s = findBellSpot(g, 40, 29, { search: B.search, prefSide: 1 })!;
    expect(s.mode).toBe('hang');
    expect(s.y).toBe(25); // the first open row under the slab
    expect(g.solid(s.x, s.y - 1)).toBe(true);
    expect(Math.abs(s.cx - 40)).toBeLessThanOrEqual(1);
    expect(hangSpot(g, 40, 25)).not.toBeNull();
    expect(hangSpot(g, 40, 30)).toBeNull(); // no rock directly above
  });

  it('a post needs the floor under its foot and room above it; a hang needs rock over its anchor', () => {
    const g = grid(hall(80, 60, 50));
    expect(postSpot(g, 40, 49, 1)).not.toBeNull();
    expect(postSpot(g, 40, 40, 1)).toBeNull(); // mid-air
    expect(postSpot(g, 40, 50, 1)).toBeNull(); // inside the floor
    const low = grid(hall(80, 60, 50).map((row, y) => (y === 40 ? '#'.repeat(80) : row))); // a ceiling 9 above the floor
    expect(postSpot(low, 40, 49, 1)).toBeNull();
  });

  it('no room: a crawl pocket 9 high (and any space too cramped for a post or a chain) has no spot at all', () => {
    const rows = Array.from({ length: 60 }, (_, y) => (y >= 41 && y <= 49 ? '.'.repeat(60) : '#'.repeat(60)));
    const g = grid(rows);
    expect(findBellSpot(g, 30, 45, { search: B.search, prefSide: 1 })).toBeNull();
    // 12 high is still not enough for a post (it wants 14 rows)
    const rows12 = Array.from({ length: 60 }, (_, y) => (y >= 38 && y <= 49 ? '.'.repeat(60) : '#'.repeat(60)));
    expect(postSpot(grid(rows12), 30, 49, 1)).toBeNull();
  });

  it('never through rock: a spot on the far side of a wall is refused (the line from the aim must be open)', () => {
    const rows = hall(80, 60, 50).map((row) => row.slice(0, 41) + '#' + row.slice(42));
    const g = grid(rows);
    const accept = (s: BellSpot): boolean => lineOpen(g, 30, 44, s.cx, s.cy);
    const s = findBellSpot(g, 30, 44, { search: B.search, prefSide: 1, accept })!;
    expect(s).not.toBeNull();
    expect(s.cx).toBeLessThan(41);
    expect(lineOpen(g, 30, 44, 50, 44)).toBe(false);
    expect(lineOpen(g, 30, 44, 38, 44)).toBe(true);
  });

  it('honours the reach she is given (the accept hook) and is deterministic', () => {
    const g = grid(hall(120, 60, 50));
    const player = { x: 10, y: 49 };
    const accept = (s: BellSpot): boolean => Math.hypot(s.cx - player.x, s.cy - (player.y - 9)) <= B.reach;
    const a = findBellSpot(g, 100, 44, { search: B.search, prefSide: 1, accept });
    const b = findBellSpot(g, 100, 44, { search: B.search, prefSide: 1, accept });
    expect(a).toEqual(b);
    expect(a).toBeNull(); // 90 cells away: nothing within 70 of her
    const near = findBellSpot(g, 70, 44, { search: B.search, prefSide: 1, accept })!;
    expect(Math.hypot(near.cx - player.x, near.cy - (player.y - 9))).toBeLessThanOrEqual(B.reach);
  });

  it('the cursor\'s distance is held to her reach', () => {
    expect(aimDistance(20)).toBe(20);
    expect(aimDistance(500)).toBe(B.reach);
    expect(aimDistance(-3)).toBe(0);
    expect(aimDistance(Number.NaN)).toBe(B.reach);
  });
});

// ----------------------------------------------------------------------------------------- the bells

const SPOT: BellSpot = { mode: 'post', x: 10, y: 10, side: 1, cx: 15, cy: 3, top: 1 };

describe('the pair of bells', () => {
  it('hangs two; the third retires the oldest and keeps the newest two', () => {
    const book = new BellBook();
    const a = book.place(SPOT, 100).bell;
    const b = book.place({ ...SPOT, x: 30 }, 120).bell;
    expect(book.count()).toBe(2);
    const third = book.place({ ...SPOT, x: 50 }, 140);
    expect(third.retired?.id).toBe(a.id);
    expect(book.count()).toBe(2);
    expect(book.live().map((x) => x.id)).toEqual([b.id, third.bell.id]);
    expect(a.retiredAt).toBe(140);
    // the retired one stays a few ticks (its fade) and is then dropped
    expect(book.bells).toHaveLength(3);
    book.tick(140 + B.retireTicks - 1);
    expect(book.bells).toHaveLength(3);
    book.tick(140 + B.retireTicks);
    expect(book.bells).toHaveLength(2);
  });

  it('lasts 30 s: retired on the tick its time is up, reported once, gone after its fade', () => {
    const book = new BellBook();
    const a = book.place(SPOT, 0).bell;
    expect(book.tick(B.lifetime - 1)).toHaveLength(0);
    expect(book.tick(B.lifetime)).toEqual([a]);
    expect(book.tick(B.lifetime + 1)).toHaveLength(0);
    expect(book.count()).toBe(0);
    book.tick(B.lifetime + B.retireTicks);
    expect(book.bells).toHaveLength(0);
  });

  it('a new bell swings still for a moment, rings, and is deaf for 6 s', () => {
    const book = new BellBook();
    const a = book.place(SPOT, 0).bell;
    expect(book.listening(a, B.settle - 1)).toBe(false);
    expect(book.listening(a, B.settle)).toBe(true);
    book.ring(a, 100);
    expect(book.listening(a, 101)).toBe(false);
    expect(book.listening(a, 100 + B.rearm - 1)).toBe(false);
    expect(book.listening(a, 100 + B.rearm)).toBe(true);
    book.retire(a, 700);
    expect(book.listening(a, 800)).toBe(false);
  });

  it('a bell is never in the run: clearing empties the book', () => {
    const book = new BellBook();
    book.place(SPOT, 0);
    book.place(SPOT, 1);
    book.clear();
    expect(book.bells).toHaveLength(0);
    expect(book.count()).toBe(0);
  });

  it('visible: full while it stands, fading over its last second and over a retirement', () => {
    const book = new BellBook();
    const a = book.place(SPOT, 0).bell;
    expect(bellVisibility(a, 10)).toBe(1);
    expect(bellVisibility(a, B.lifetime - 45)).toBeCloseTo(0.5, 6);
    expect(bellVisibility(a, B.lifetime)).toBe(0);
    const b = book.place(SPOT, 5).bell;
    book.retire(b, 50);
    expect(bellVisibility(b, 50)).toBe(1);
    expect(bellVisibility(b, 50 + B.retireTicks / 2)).toBeCloseTo(0.5, 6);
    expect(bellVisibility(b, 50 + B.retireTicks)).toBe(0);
  });

  it('rings for a foe within 70 cells of its middle and reveals those within 100', () => {
    const bell = { cx: 100, cy: 80 };
    expect(within(bell, 100 + 70, 80, B.triggerRadius)).toBe(true);
    expect(within(bell, 100 + 71, 80, B.triggerRadius)).toBe(false);
    expect(within(bell, 100, 80 - 99.9, B.revealRadius)).toBe(true);
    expect(within(bell, 100 + 75, 80 + 75, B.revealRadius)).toBe(false);
    expect(within(bell, 100 + 70, 80 + 70, B.revealRadius)).toBe(true); // 99 cells on the diagonal
  });
});

// ------------------------------------------------------------------------------------------ the chime

describe('the Dead Chime: the wave', () => {
  it('grows from nothing to 150 cells in 20 ticks, fast at first and monotonic', () => {
    expect(waveRadius(0)).toBe(0);
    expect(waveRadius(C.expandTicks)).toBeCloseTo(150, 6);
    expect(waveRadius(C.expandTicks + 50)).toBeCloseTo(150, 6);
    let last = -1;
    for (let t = 0; t <= C.expandTicks; t++) {
      const r = waveRadius(t);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    expect(waveRadius(1)).toBeGreaterThan(waveRadius(20) - waveRadius(19)); // it begins faster than it ends
  });

  it('reaches a foe at 100 cells well inside its 20 ticks, and never one at 200', () => {
    const reach = (d: number): number => { for (let t = 1; t <= C.expandTicks; t++) if (waveRadius(t) >= d) return t; return -1; };
    expect(reach(100)).toBeGreaterThan(5);
    expect(reach(100)).toBeLessThan(15);
    expect(reach(150)).toBe(C.expandTicks);
    expect(reach(150.5)).toBe(-1);
    expect(reach(200)).toBe(-1);
  });

  it('slows what it reaches, stuns casters and machines, and leaves bosses and eggs alone', () => {
    const slowOnly = ['slime', 'golem', 'imp', 'bat', 'weaver', 'acidslime'] as EnemyKind[];
    for (const k of slowOnly) expect(chimeEffectFor(k)).toEqual({ slow: true, stun: false });
    for (const k of ['mage', 'spitter', 'wisp', 'bomber'] as EnemyKind[]) expect(chimeEffectFor(k)).toEqual({ slow: true, stun: true });
    for (const k of ['colossus', 'leviathan', 'rimewarden', 'lenswright', 'eggs'] as EnemyKind[]) expect(chimeEffectFor(k)).toEqual({ slow: false, stun: false });
  });
});

// ------------------------------------------------------------------- the kit on the real FighterSystem

const DEFS: Record<string, { hp: number; halfW: number; h: number; bounty: number }> = {
  golem: { hp: 60, halfW: 6, h: 20, bounty: 0 },
  mage: { hp: 40, halfW: 4, h: 18, bounty: 0 },
  wisp: { hp: 20, halfW: 4, h: 10, bounty: 0 },
  colossus: { hp: 600, halfW: 18, h: 34, bounty: 0 },
  slime: { hp: 40, halfW: 4, h: 8, bounty: 0 },
  eggs: { hp: 12, halfW: 5, h: 8, bounty: 0 },
};

function foe(kind: EnemyKind, x: number, y: number, extra: Partial<Enemy> = {}): Enemy {
  return { kind, x, y, hp: 50, maxHp: 50, vx: 0, vy: 0, fx: 0, fy: 0, bobPhase: 0, grounded: true, sleeping: false, status: {}, knockT: 0, knockVx: 0, knockVy: 0, ...extra } as unknown as Enemy;
}

interface Rig {
  ctx: Ctx;
  sys: FighterSystem;
  step(n?: number): void;
  enemies: Enemy[];
  projectiles: Projectile[];
  sfx: Array<{ id: string; x?: number; y?: number; gain?: number }>;
  lights: unknown[];
  world: { types: Uint8Array; w: number; h: number };
  aim(x: number, y: number): void;
  press(slot: 'tactical' | 'ultimate'): void;
}

/** A 260 x 140 world with a stone floor from row 100 down, a player standing on it at (100, 99), her kit on the real system. */
function rig(): Rig {
  const W = 260, H = 140;
  const types = new Uint8Array(W * H);
  for (let y = 100; y < H; y++) types.fill(Cell.Stone, y * W, (y + 1) * W);
  const world = {
    width: W, height: H, types,
    inBounds: (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H,
    idx: (x: number, y: number): number => x + y * W,
    type: (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? Cell.Stone : types[x + y * W]),
    replaceCellAt: (i: number, c: number): void => { types[i] = c; },
  };
  const enemies: Enemy[] = [];
  const projectiles: Projectile[] = [];
  const lights: unknown[] = [];
  const sfx: Rig['sfx'] = [];
  const player = {
    x: 100, y: 99, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, aimAngle: 0, lastDamageSource: null as string | null,
  };
  const state = { mode: 'play', frameCount: 1, paused: false, reduceFlashes: false };
  const ctx = {
    events: new EventBus(),
    state, player, enemies, projectiles, world,
    input: { mouse: { x: 100, y: 99 } },
    fx: { hitstop: 0, screenShake: 0, bloomKick: 0 },
    levels: { current: { authoredLights: lights } },
    enemyCtl: { defs: DEFS, damage: () => undefined },
    audio: { sfx: (id: string, x?: number, y?: number, o?: { gain?: number }) => { sfx.push({ id, x, y, gain: o?.gain }); } },
    particles: { burst: () => undefined },
    physics: { tryMoveEntity: () => true, entityFree: () => true },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sys.equip('mara-quell');
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      state.frameCount++;
      sys.update(ctx);
      // (the enemy loop's own tickKnock: a held foe's knock state runs down by one a tick)
      for (const e of enemies) if ((e.knockT ?? 0) > 0) e.knockT = (e.knockT ?? 0) - 1;
    }
  };
  step(1);
  return {
    ctx, sys, step, enemies, projectiles, sfx, lights, world: { types, w: W, h: H },
    aim: (x, y) => { ctx.input.mouse.x = x; ctx.input.mouse.y = y; player.aimAngle = Math.atan2(y - (player.y - 9), x - player.x); },
    press: (slot) => { sys.press(slot); },
  };
}

interface BellView { bells: Bell[]; count(): number }
const bellsOf = (r: Rig): BellView | null => ((r.sys.drawables.find((d) => (d as { tag?: string }).tag === 'mara.bells') as unknown as { state: BellView } | undefined)?.state ?? null);

describe('Mara\'s kit on the fighter system', () => {
  it('Z hangs a bell on the floor under the aim, spends the 14 s cooldown, and shows a bell on the meter', () => {
    const r = rig();
    expect(r.sys.view.meter).toEqual({ label: 'Bells', value: 0, max: 2 });
    r.aim(140, 99);
    r.press('tactical');
    r.step(1);
    const book = bellsOf(r)!;
    expect(book.count()).toBe(1);
    const bell = book.bells[0];
    expect(bell.mode).toBe('post');
    expect(bell.y).toBe(99);
    expect(Math.abs(bell.cx - 140)).toBeLessThanOrEqual(3);
    expect(r.world.types[bell.x + (bell.y + 1) * r.world.w]).toBe(Cell.Stone);
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.view.tactical.cooldownSeconds).toBe(14);
    expect(r.sys.view.meter?.value).toBe(1);
    expect(r.sfx.some((s) => s.id === 'mech.latch')).toBe(true);
    expect(r.sfx.some((s) => s.id === 'pickup.bell')).toBe(true);
  });

  it('refuses with no room (a sealed pocket 9 high) and spends nothing', () => {
    const r = rig();
    // seal a pocket around her: rock from row 80 to 90, open 91..99 (9 rows), walls either side
    for (let y = 80; y <= 90; y++) r.world.types.fill(Cell.Stone, y * r.world.w, (y + 1) * r.world.w);
    for (let y = 91; y <= 99; y++) { r.world.types[60 + y * r.world.w] = Cell.Stone; r.world.types[140 + y * r.world.w] = Cell.Stone; }
    (r.ctx.player as { crawling: boolean }).crawling = true;
    r.aim(120, 96);
    const before = r.sys.view.tactical.refusedAt;
    r.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(before);
    expect(r.sys.view.tactical.ready).toBe(true);
    expect(r.sys.view.meter?.value).toBe(0);
    expect(r.sfx.some((s) => s.id === 'tk.fizzle')).toBe(true);
  });

  it('the third bell retires the oldest, the meter stays at two', () => {
    const r = rig();
    for (const x of [130, 150, 120]) {
      r.sys.refill();
      r.aim(x, 99);
      r.press('tactical');
      r.step(1);
    }
    const book = bellsOf(r)!;
    expect(book.count()).toBe(2);
    expect(book.bells.filter((b) => b.retiredAt >= 0)).toHaveLength(1);
    expect(book.bells.find((b) => b.id === 1)?.retiredAt).toBeGreaterThan(0);
    expect(r.sys.view.meter?.value).toBe(2);
  });

  it('a bell rings for a waking foe within 70 cells: foes within 100 are revealed for 4 s (a sleeper too), a ring of light is set and then removed', () => {
    const r = rig();
    r.aim(120, 99);
    r.press('tactical');
    r.step(1);
    const bell = bellsOf(r)!.bells[0];
    r.step(TUNING.bell.settle + 2);
    const near = foe('golem', Math.round(bell.cx + 60), 99);
    const mid = foe('golem', Math.round(bell.cx + 90), 99);
    const sleeper = foe('mage', Math.round(bell.cx - 80), 99, { sleeping: true });
    const far = foe('golem', Math.round(bell.cx + 120), 99);
    r.enemies.push(mid, sleeper, far);
    r.step(5);
    expect(bell.rungAt).toBe(-1000); // nobody within 70: silent
    r.enemies.push(near);
    r.sfx.length = 0;
    const lightsBefore = r.lights.length;
    r.step(1);
    expect(bell.rungAt).toBeGreaterThan(0);
    expect(r.sys.isRevealed(near) && r.sys.isRevealed(mid) && r.sys.isRevealed(sleeper)).toBe(true);
    expect(r.sys.isRevealed(far)).toBe(false);
    expect(r.sfx.some((s) => s.id === 'pickup.bell' && Math.abs((s.x ?? 0) - bell.cx) < 1 && (s.gain ?? 0) >= 0.9)).toBe(true);
    expect(r.sfx.some((s) => s.id === 'world.gong')).toBe(true);
    expect(r.lights.length).toBe(lightsBefore + 1);
    r.step(B.lightTicks + 2);
    expect(r.lights.length).toBe(lightsBefore);
    r.step(B.revealTicks);
    expect(r.sys.isRevealed(near)).toBe(false);
    // deaf for 6 s, then rings again
    const rang = bell.rungAt;
    r.step(60);
    expect(bell.rungAt).toBe(rang);
    r.step(B.rearm);
    expect(bell.rungAt).toBeGreaterThan(rang);
  });

  it('a sleeping foe near the bell does not ring it, and an egg clutch does not either', () => {
    const r = rig();
    r.aim(140, 99);
    r.press('tactical');
    r.step(1);
    const bell = bellsOf(r)!.bells[0];
    r.enemies.push(foe('mage', Math.round(bell.cx + 30), 99, { sleeping: true }), foe('eggs', Math.round(bell.cx + 20), 99));
    r.step(40);
    expect(bell.rungAt).toBe(-1000);
  });

  it('a bell comes down when the floor under its post is dug away', () => {
    const r = rig();
    r.aim(140, 99);
    r.press('tactical');
    r.step(1);
    const bell = bellsOf(r)!.bells[0];
    r.world.types[bell.x + (bell.y + 1) * r.world.w] = 0;
    r.step(B.supportEvery + 1);
    expect(bell.retiredAt).toBeGreaterThan(0);
    expect(r.sfx.some((s) => s.id === 'body.impact.metal')).toBe(true);
  });

  it('bells are not in the run save, and a reset (a floor change, a respawn) takes them and their drawables', () => {
    const r = rig();
    r.aim(140, 99);
    r.press('tactical');
    r.step(1);
    expect(JSON.stringify(r.sys.snapshot())).not.toMatch(/bell/i);
    expect(r.sys.snapshot()?.kit).toEqual({});
    r.ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    expect(bellsOf(r)).toBeNull();
    r.step(1);
    expect(r.sys.view.meter?.value).toBe(0);
    // the passive listens on: its drawable is back after the tick
    expect(r.sys.drawables.some((d) => (d as { tag?: string }).tag === 'mara.ripples')).toBe(true);
  });

  it('Keen Resonance: a walking foe behind rock within 200 cells leaves ripples; one in sight, or beyond 200, does not', () => {
    const r = rig();
    // a wall between her (x 100) and the foes at x 160
    for (let y = 60; y < 100; y++) r.world.types[130 + y * r.world.w] = Cell.Stone;
    const seen = foe('golem', 60, 99); // to her left, in plain sight
    const hidden = foe('golem', 160, 99);
    r.enemies.push(seen, hidden);
    r.step(2);
    for (let i = 0; i < 60; i++) {
      seen.x += i % 2 ? 0 : -1; hidden.x += i % 2 ? 0 : 1; // walking
      r.step(1);
    }
    const ripples = (r.sys.drawables.find((d) => (d as { tag?: string }).tag === 'mara.ripples') as unknown as { state: RippleBook }).state;
    expect(ripples.births).toBeGreaterThanOrEqual(3);
    expect(ripples.list.every((p) => p.x >= 130)).toBe(true); // all from the foe behind the wall
    // range: she steps back to x 20; a foe at 190 (170 cells) is felt, one at 240 (220 cells) is not
    r.enemies.length = 0;
    ripples.clear();
    (r.ctx.player as { x: number }).x = 20;
    const inRange = foe('golem', 190, 99), outRange = foe('golem', 240, 99);
    r.enemies.push(inRange, outRange);
    r.step(2);
    for (let i = 0; i < 60; i++) { if (i % 2 === 0) { inRange.x += 1; outRange.x += 1; } r.step(1); }
    expect(ripples.list.length).toBeGreaterThan(0);
    expect(ripples.list.every((p) => p.x >= 185 && p.x <= 255 && Math.abs(p.x - inRange.x) < 40)).toBe(true);
    expect(ripples.list.some((p) => Math.abs(p.x - outRange.x) < 3)).toBe(false);
  });

  it('Dead Chime: foes within the wave are slowed x0.45 (a foe at 100, not one at 200), casters stunned, a boss and an egg clutch left, hostile shots in the ring removed in place', () => {
    const r = rig();
    const f100 = foe('golem', 200, 99), f155 = foe('golem', 255, 99), mage = foe('mage', 160, 99), wisp = foe('wisp', 170, 60);
    const boss = foe('colossus', 150, 99), eggs = foe('eggs', 140, 99);
    // (the world is 260 wide, so the foe the wave must NOT reach is at 155 cells; the live probe puts one at 200)
    r.enemies.push(f100, f155, mage, wisp, boss, eggs);
    const arr = r.projectiles;
    const shot = (dx: number, hostile: boolean): Projectile => ({ x: 100 + dx, y: 80, vx: 0, vy: 0, type: hostile ? 'fireball' : 'bomb', life: 999, age: 0, charging: false, hostile });
    arr.push(shot(30, true), shot(80, true), shot(140, true), shot(170, true), shot(40, false));
    r.sys.addCharge(1);
    r.step(1);
    r.press('ultimate');
    r.step(1);
    expect(r.sys.view.ultimate.charge).toBe(0);
    expect(r.sys.view.ultimate.active).toBeGreaterThan(0.95);
    r.step(24);
    expect(r.sys.enemySlow(f100)).toBe(0.45); // 100 cells: reached
    expect(r.sys.enemySlow(mage)).toBe(0.45);
    expect(r.sys.enemySlow(f155)).toBe(1); // 155 cells: past the wave
    expect(r.sys.enemySlow(boss)).toBe(1);
    expect(r.sys.enemySlow(eggs)).toBe(1);
    r.step(1);
    expect(mage.knockT).toBeGreaterThan(0);
    expect(wisp.knockT).toBeGreaterThan(0);
    expect(f100.knockT).toBe(0);
    expect(boss.knockT).toBe(0);
    expect(r.projectiles).toBe(arr); // mutated in place, never reassigned
    expect(arr.filter((p) => p.hostile).map((p) => p.x - 100)).toEqual([170]);
    expect(arr.filter((p) => !p.hostile)).toHaveLength(1);
    // the stun is 3 s, the slow 6 s
    r.step(C.stunTicks);
    expect(mage.knockT).toBe(0);
    expect(r.sys.enemySlow(f100)).toBe(0.45);
    r.step(C.slowTicks - C.stunTicks + 5);
    expect(r.sys.enemySlow(f100)).toBe(1);
    expect(r.sys.view.ultimate.active).toBe(0);
  });

  it('Dead Chime: the wave reaches a foe only when it gets there (a foe at 100 is not slowed on the first tick)', () => {
    const r = rig();
    const f = foe('golem', 200, 99);
    r.enemies.push(f);
    r.sys.addCharge(1);
    r.step(1);
    r.press('ultimate');
    r.step(1);
    expect(r.sys.enemySlow(f)).toBe(1);
    r.step(5);
    expect(r.sys.enemySlow(f)).toBe(1);
    r.step(8);
    expect(r.sys.enemySlow(f)).toBe(0.45);
  });
});
