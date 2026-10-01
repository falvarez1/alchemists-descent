import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit } from '@/fighters/kits/sable-fen';
import {
  KNOCK_DRAG, KNOCK_GRAV, TUNING, beatAt, blockedAxes, exitVelocity, firstBodyAlong, haulVector, isWounded, lineBlocked,
  moteFade, newTrail, pushSpoor, revealStrength, ringAlpha, ringPassed, ringRadius, sampleDue, slideHaul, spoorIndex,
  stepAcross, tetherReach, tetherTension, tooHeavy, trailSpent, yankVelocity,
} from '@/fighters/kits/sable-fen-logic';
import { Cell } from '@/sim/CellType';

/**
 * Sable Fen's kit, without a browser: the maths of her passive (the spoor), her tether (the cast, the haul, the
 * yank) and her ultimate (the heartbeat), then the kit itself against a fake world through the real
 * FighterSystem (a refusal costs nothing, the cooldown runs, wounded foes are revealed and healthy ones are not).
 * What the abilities look like in the real engine is scripts/verify-fighter-sable.mjs.
 */

describe('Wounded Spoor: the trail', () => {
  it('holds the newest `depth` samples and drops the oldest', () => {
    const tr = newTrail(14);
    for (let i = 0; i < 20; i++) pushSpoor(tr, i * 10, 0, i * 4);
    expect(tr.n).toBe(14);
    // newest first
    expect(tr.xs[spoorIndex(tr, 0)]).toBe(190);
    expect(tr.xs[spoorIndex(tr, 1)]).toBe(180);
    // the oldest still held is sample 6 (of 0..19)
    expect(tr.xs[spoorIndex(tr, 13)]).toBe(60);
  });

  it('refreshes the newest mote when the foe stood still, instead of stacking a clump', () => {
    const tr = newTrail(14);
    expect(pushSpoor(tr, 50, 20, 0)).toBe(true);
    expect(pushSpoor(tr, 50.4, 20.3, 4)).toBe(false);
    expect(pushSpoor(tr, 50, 20, 8)).toBe(false);
    expect(tr.n).toBe(1);
    expect(tr.ts[tr.head]).toBe(8);
    expect(pushSpoor(tr, 53, 20, 12)).toBe(true);
    expect(tr.n).toBe(2);
  });

  it('a mote fades from full to nothing over its life, and a spent trail can be dropped', () => {
    expect(moteFade(0)).toBe(1);
    const mid = moteFade(TUNING.spoor.life / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(moteFade(10)).toBeGreaterThan(moteFade(30));
    expect(moteFade(TUNING.spoor.life)).toBe(0);
    expect(moteFade(TUNING.spoor.life + 50)).toBe(0);
    const tr = newTrail();
    expect(trailSpent(tr, 0)).toBe(true); // empty
    pushSpoor(tr, 1, 1, 100);
    expect(trailSpent(tr, 100 + TUNING.spoor.life - 1)).toBe(false);
    expect(trailSpent(tr, 100 + TUNING.spoor.life)).toBe(true);
  });

  it('samples every 4 ticks', () => {
    let n = 0;
    for (let t = 0; t < 40; t++) if (sampleDue(t, 0)) n++;
    expect(n).toBe(10);
    expect(TUNING.spoor.sampleEvery).toBe(4);
    expect(TUNING.spoor.depth).toBe(14);
  });

  it('a line is blocked by rock between its ends, not by its own end points', () => {
    const solid = (x: number, y: number): boolean => x === 50 && y >= 0 && y <= 100;
    expect(lineBlocked(solid, 10, 10, 90, 10)).toBe(true);
    expect(lineBlocked(solid, 10, 10, 40, 10)).toBe(false);
    expect(lineBlocked(solid, 10, 10, 50, 10)).toBe(false); // the end point itself is not "between"
    expect(lineBlocked(() => false, 0, 0, 200, 90)).toBe(false);
  });

  it('knows a wounded foe from a healthy one and a dead one', () => {
    expect(isWounded(10, 40)).toBe(true);
    expect(isWounded(40, 40)).toBe(false);
    expect(isWounded(0, 40)).toBe(false);
  });
});

describe('Bogline: the cast', () => {
  it('finds the first body along the line, stepping one cell at a time so a thin foe is not skipped', () => {
    const bodies = [{ x: 60, y: 0, hw: 0.4 }, { x: 90, y: 0, hw: 5 }];
    const bodyAt = (x: number, y: number): number => bodies.findIndex((b) => Math.abs(x - b.x) <= b.hw && Math.abs(y - b.y) <= 3);
    const hit = firstBodyAlong(0, 0, 1, 0, 150, bodyAt);
    expect(hit?.index).toBe(0);
    expect(hit?.d).toBe(60);
    // The second body only if the first is out of the way.
    expect(firstBodyAlong(70, 0, 1, 0, 150, bodyAt)?.index).toBe(1);
    // Nothing within a short range.
    expect(firstBodyAlong(0, 0, 1, 0, 40, bodyAt)).toBeNull();
    // A diagonal line finds a body on it.
    expect(firstBodyAlong(0, 0, Math.SQRT1_2, Math.SQRT1_2, 100, (x, y) => (Math.abs(x - 40) < 1.2 && Math.abs(y - 40) < 1.2 ? 7 : -1))?.index).toBe(7);
  });

  it('a body she is already touching is hit at once', () => {
    expect(firstBodyAlong(0, 0, 1, 0, 150, () => 3)?.d).toBe(1);
  });

  it('heavy foes are those with a big footprint or a boss', () => {
    expect(tooHeavy(5, 8, false)).toBe(false); // slime
    expect(tooHeavy(5, 12, false)).toBe(false); // imp
    expect(tooHeavy(7, 20, false)).toBe(true); // golem
    expect(tooHeavy(9, 18, false)).toBe(true); // weaver
    expect(tooHeavy(3, 5, true)).toBe(true); // any boss
  });
});

describe('Bogline: the haul', () => {
  it('pulls at the haul speed and stops exactly `stopShort` cells from the hook', () => {
    const T = TUNING.bogline;
    let x = 0;
    let ticks = 0;
    for (; ticks < 100; ticks++) {
      const v = haulVector(x, 0, 100, 0, T.haulSpeed, T.stopShort);
      if (!v) break;
      expect(v.dx).toBeLessThanOrEqual(T.haulSpeed + 1e-9);
      x += v.dx;
    }
    expect(x).toBeCloseTo(100 - T.stopShort, 6);
    expect(ticks).toBeLessThanOrEqual(T.haulTicks);
    expect(haulVector(95, 0, 100, 0, T.haulSpeed, T.stopShort)).toBeNull();
  });

  it('the longest throw is hauled home within the tick budget', () => {
    const T = TUNING.bogline;
    // Range 150, ending 8 short: 142 cells at 6 per tick is 24 ticks, inside the 28-tick limit.
    expect(Math.ceil((T.range - T.stopShort) / T.haulSpeed)).toBeLessThanOrEqual(T.haulTicks);
  });

  it('slides up a wall face when the line runs into it, instead of pinning her to the foot', () => {
    // A wall at x >= 20, open above and left of it. A pull up and to the right is blocked sideways only.
    const free = (x: number, y: number): boolean => x < 20 && y > -200;
    const v = { dx: 3, dy: -3 };
    // standing at x = 19, the next cell right (20) is rock: blocked on x, free on y
    expect(blockedAxes(free, 19, 0, v.dx, v.dy, 3)).toEqual({ bx: true, by: false });
    const s = slideHaul(free, 19, 0, v, 3);
    expect(s?.dx).toBe(0);
    expect(s?.dy).toBeLessThan(0);
    expect(Math.hypot(s?.dx ?? 0, s?.dy ?? 0)).toBeCloseTo(Math.hypot(v.dx, v.dy), 6);
  });

  it('slides along a floor when the line aims into it, and ends when boxed in', () => {
    const floor = (x: number, y: number): boolean => y <= 0; // rock from y = 1 down
    const along = slideHaul(floor, 0, 0, { dx: 5, dy: 2 }, 3);
    expect(along?.dy).toBe(0);
    expect(along?.dx).toBeGreaterThan(0);
    // Straight into the floor with no sideways component: nowhere to go.
    expect(slideHaul(floor, 0, 0, { dx: 0, dy: 4 }, 3)).toBeNull();
    // A corner: blocked both ways.
    expect(slideHaul(() => false, 0, 0, { dx: 3, dy: 3 }, 3)).toBeNull();
  });

  it('steps over a floor lip of up to `stepUp` cells and is blocked by a taller one', () => {
    const lip = (h: number) => (x: number, y: number): boolean => !(x >= 5 && y > -h);
    expect(stepAcross(lip(2), 4, 0, 1, 3)).toBe(-2);
    expect(stepAcross(lip(6), 4, 0, 1, 3)).toBeNull();
  });

  it('keeps her momentum in the direction of the pull, with the rise capped', () => {
    const v = exitVelocity(6, 0, 3, 2.4);
    expect(v.vx).toBeCloseTo(3, 6);
    expect(v.vy).toBeCloseTo(0, 6);
    const up = exitVelocity(0, -6, 3, 2.4);
    expect(up.vy).toBeCloseTo(-2.4, 6);
    expect(exitVelocity(0, 0, 3, 2.4)).toEqual({ vx: 0, vy: 0 });
  });
});

describe('Bogline: the yank', () => {
  /** The engine's launch step (Enemies.tickKnock), applied to the velocity the kit wrote. */
  function launch(fx: number, fy: number, hx: number, hy: number): { ticks: number; x: number; y: number; first: number } {
    const T = TUNING.bogline;
    let x = fx, y = fy, ticks = 0, first = 0;
    for (; ticks < T.yankTicks; ticks++) {
      const v = yankVelocity(x, y, hx, hy, T.yankSpeed, T.yankStop);
      if (!v) break;
      const kvx = v.vx, kvy = v.vy;
      const vx = kvx * KNOCK_DRAG, vy = (kvy + KNOCK_GRAV) * KNOCK_DRAG;
      if (ticks === 0) first = Math.hypot(vx, vy);
      x += vx;
      y += vy;
    }
    return { ticks, x, y, first };
  }

  it('writes a knock velocity that, after the engine\'s drag and gravity, is the yank speed straight at her', () => {
    const r = launch(100, 0, 0, 0);
    expect(r.first).toBeCloseTo(TUNING.bogline.yankSpeed, 5);
    expect(r.ticks).toBe(TUNING.bogline.yankTicks);
    expect(r.x).toBeCloseTo(100 - TUNING.bogline.yankSpeed * TUNING.bogline.yankTicks, 4);
    expect(Math.abs(r.y)).toBeLessThan(1e-6); // gravity is cancelled: a level pull stays level
  });

  it('pulls a diagonal foe along the straight line to her', () => {
    const r = launch(60, 60, 0, 0);
    expect(Math.abs(r.x - r.y)).toBeLessThan(1e-6);
    expect(r.x).toBeLessThan(60);
  });

  it('brings a near foe in and stops it `yankStop` cells from her chest, never into her', () => {
    const T = TUNING.bogline;
    const r = launch(30, 0, 0, 0);
    expect(Math.hypot(r.x, r.y)).toBeGreaterThanOrEqual(T.yankStop - 1e-6);
    expect(yankVelocity(T.yankStop, 0, 0, 0, T.yankSpeed, T.yankStop)).toBeNull();
    // Just outside the stop, it is slowed so that it lands on it and does not overshoot.
    const v = yankVelocity(T.yankStop + 1, 0, 0, 0, T.yankSpeed, T.yankStop);
    expect(v?.speed).toBeCloseTo(1, 6);
  });
});

describe('the tether, drawn', () => {
  it('flies out over its flight time, holds, then coils back and disappears', () => {
    const T = TUNING.bogline;
    expect(tetherReach(0, T.flightTicks, null, T.retractTicks)).toBe(0);
    expect(tetherReach(T.flightTicks, T.flightTicks, null, T.retractTicks)).toBe(1);
    expect(tetherReach(40, T.flightTicks, null, T.retractTicks)).toBe(1);
    // ended at age 10: coils back over the retract time
    expect(tetherReach(10, T.flightTicks, 10, T.retractTicks)).toBe(1);
    expect(tetherReach(10 + T.retractTicks / 2, T.flightTicks, 10, T.retractTicks)).toBeCloseTo(0.5, 1);
    expect(tetherReach(10 + T.retractTicks, T.flightTicks, 10, T.retractTicks)).toBe(0);
  });

  it('is slack while it flies, taut once out, and slack again as it coils', () => {
    const T = TUNING.bogline;
    expect(tetherTension(0, T.flightTicks, null, T.retractTicks)).toBe(0);
    expect(tetherTension(T.flightTicks * 3, T.flightTicks, null, T.retractTicks)).toBe(1);
    expect(tetherTension(20 + T.retractTicks, T.flightTicks, 20, T.retractTicks)).toBe(0);
  });
});

describe('Bloodsense: the heartbeat', () => {
  it('a ring grows from its start to its end radius and fades', () => {
    expect(ringRadius(0, 50, 6, 170)).toBe(6);
    expect(ringRadius(50, 50, 6, 170)).toBe(170);
    expect(ringRadius(25, 50, 6, 170)).toBeGreaterThan(88); // ease-out: past halfway at half time
    expect(ringAlpha(0, 50)).toBe(1);
    expect(ringAlpha(50, 50)).toBe(0);
    let last = Infinity;
    for (let a = 0; a <= 50; a += 5) { const v = ringAlpha(a, 50); expect(v).toBeLessThanOrEqual(last); last = v; }
  });

  it('a ring passes each foe once on its way out', () => {
    const B = TUNING.bloodsense;
    for (const d of [20, 55, 90, 140, 165]) {
      let passes = 0;
      for (let age = 1; age <= B.ringTicks; age++) {
        const r = ringRadius(age, B.ringTicks, 6, B.ringRadius);
        const grew = r - ringRadius(age - 1, B.ringTicks, 6, B.ringRadius);
        if (ringPassed(d, r, grew)) passes++;
      }
      // Fast at first, slow at the end: the band is at least a cell wide, so a slow ring may pass a foe a few ticks running; never none.
      expect(passes).toBeGreaterThanOrEqual(1);
      expect(passes).toBeLessThanOrEqual(8);
    }
  });

  it('the first sweep reaches the whole range; the slow beat is a lub and a dub', () => {
    const B = TUNING.bloodsense;
    expect(B.range).toBe(320);
    expect(B.duration).toBe(600);
    const seq: string[] = [];
    for (let t = 0; t < B.duration; t++) { const b = beatAt(t, B.beatEvery, B.dubGap); if (b) seq.push(b); }
    expect(seq[0]).toBe('sweep');
    expect(seq.slice(1, 5)).toEqual(['dub', 'lub', 'dub', 'lub']);
    expect(seq.filter((s) => s === 'lub').length).toBe(Math.floor((B.duration - 1) / B.beatEvery));
  });

  it('the reveal is full until the last `fadeTicks`, then dims to nothing', () => {
    const B = TUNING.bloodsense;
    expect(revealStrength(B.duration)).toBe(1);
    expect(revealStrength(B.fadeTicks)).toBe(1);
    expect(revealStrength(B.fadeTicks / 2)).toBeCloseTo(0.5, 6);
    expect(revealStrength(0)).toBe(0);
  });
});

// ======================================================================== the kit, through the real system

const W = 400;
const H = 220;
const FLOOR = 150;

interface Rig {
  sys: FighterSystem;
  ctx: Ctx;
  enemies: Enemy[];
  types: Uint8Array;
  step(n?: number): void;
  wall(x0: number, y0: number, x1: number, y1: number): void;
  foe(kind: string, x: number, hp?: number, maxHp?: number): Enemy;
  sfx: string[];
  gust: Array<{ e: Enemy; strength: number }>;
}

function rig(): Rig {
  const events = new EventBus();
  const types = new Uint8Array(W * H);
  for (let y = FLOOR; y < H; y++) for (let x = 0; x < W; x++) types[x + y * W] = Cell.Stone;
  const world = {
    types,
    inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H,
    idx: (x: number, y: number) => x + y * W,
  };
  const solid = (x: number, y: number): boolean => !world.inBounds(x, y) || types[x + y * W] === Cell.Stone;
  const entityFree = (x: number, y: number, hw: number, h: number): boolean => {
    for (let yy = y - h + 1; yy <= y; yy++) for (let xx = x - hw; xx <= x + hw; xx++) if (solid(xx, yy)) return false;
    return true;
  };
  const enemies: Enemy[] = [];
  const sfx: string[] = [];
  const gust: Array<{ e: Enemy; strength: number }> = [];
  const player = {
    x: 100, y: FLOOR - 1, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, swinging: false, aimAngle: 0, lastDamageSource: null as string | null,
  };
  const state = { mode: 'play', frameCount: 1000, paused: false, reduceFlashes: false };
  const ctx = {
    events,
    state,
    world,
    player,
    enemies,
    camera: { x: 0, y: 0 },
    fx: { screenShake: 0, bloomKick: 0, hitstop: 0 },
    playerCtl: { releaseVine: () => undefined },
    enemyCtl: {
      defs: {
        slime: { hp: 48, halfW: 5, h: 8, bounty: 10 },
        golem: { hp: 170, halfW: 7, h: 20, bounty: 45 },
        bat: { hp: 16, halfW: 3, h: 5, bounty: 5 },
      },
      damage: () => undefined,
      gustShove: (e: Enemy, _dx: number, _dy: number, strength: number) => { gust.push({ e, strength }); },
    },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    particles: { burst: () => undefined, spawn: () => undefined },
    physics: {
      entityFree,
      // One cell at a time; rock blocks (and does not move) the body; a lip up to `stepUp` is climbed.
      tryMoveEntity: (e: { x: number; y: number }, dx: number, dy: number, hw: number, h: number, stepUp: number): boolean => {
        if (entityFree(e.x + dx, e.y + dy, hw, h)) { e.x += dx; e.y += dy; return true; }
        for (let s = 1; s <= stepUp && dx !== 0; s++) {
          if (entityFree(e.x + dx, e.y - s, hw, h)) { e.x += dx; e.y -= s; return true; }
        }
        return false;
      },
    },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sys.equip('sable-fen');
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { state.frameCount++; sys.update(ctx); } };
  return {
    sys, ctx, enemies, types, step, sfx, gust,
    wall: (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) types[x + y * W] = Cell.Stone; },
    foe: (kind, x, hp = 30, maxHp = 30) => {
      const e = { x, y: FLOOR - 1, hp, maxHp, kind, vx: 0, vy: 0, fx: 0, fy: 0, bobPhase: 0, status: {} } as unknown as Enemy;
      enemies.push(e);
      return e;
    },
  };
}

describe('Sable Fen through the system: Wounded Spoor', () => {
  it('marks a foe the fighter hurts, leaves it a trail, and does not mark one that died', () => {
    const r = rig();
    const e = r.foe('slime', 160);
    const dead = r.foe('slime', 200, 0);
    r.step(2);
    r.sys.noteEnemyHurt(e, 5, 'direct', false);
    r.sys.noteEnemyHurt(dead, 40, 'direct', true);
    expect(r.sys.isMarked(e)).toBe(true);
    expect(r.sys.isMarked(dead)).toBe(false);
    // 6 seconds: still marked at 359 ticks, off the scent at 361.
    r.step(358);
    expect(r.sys.isMarked(e)).toBe(true);
    r.step(4);
    expect(r.sys.isMarked(e)).toBe(false);
  });

  it('shows a HUD readout of how many foes are marked, and none when there are none', () => {
    const r = rig();
    const a = r.foe('slime', 160), b = r.foe('slime', 220);
    r.step(2);
    expect(r.sys.view.meter).toBeNull();
    r.sys.noteEnemyHurt(a, 5, 'direct', false);
    r.sys.noteEnemyHurt(b, 5, 'direct', false);
    r.step(2);
    expect(r.sys.view.meter?.value).toBe(2);
    expect(r.sys.view.meter?.max).toBe(TUNING.spoor.meterMax);
  });

  it('mounts the spoor drawable on the under layer, and puts it back after a floor change clears it', () => {
    const r = rig();
    r.step(2);
    const under = r.sys.drawables.filter((d) => d.layer === 'under');
    expect(under.length).toBe(1);
    r.ctx.events.emit('levelChanged', { id: 'x' } as never);
    expect(r.sys.drawables.length).toBe(0);
    r.step(1);
    expect(r.sys.drawables.filter((d) => d.layer === 'under').length).toBe(1);
  });

  it('pulses a marked foe that is behind rock through the reveal, and not one in plain sight', () => {
    const r = rig();
    const seen = r.foe('slime', 160);
    const hidden = r.foe('slime', 300);
    r.wall(250, 100, 262, FLOOR - 1);
    r.step(2);
    r.sys.noteEnemyHurt(seen, 5, 'direct', false);
    r.sys.noteEnemyHurt(hidden, 5, 'direct', false);
    r.step(8);
    expect(r.sys.isRevealed(hidden)).toBe(true);
    expect(r.sys.isRevealed(seen)).toBe(false);
  });
});

describe('Sable Fen through the system: Bogline', () => {
  it('refuses with nothing to hook and costs nothing', () => {
    const r = rig();
    r.ctx.player.aimAngle = 0; // along open ground with nothing within 150 cells
    r.step(2);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.ready).toBe(true);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(0);
    expect(r.sys.ownsMovement).toBe(false);
    expect(r.sfx).toContain('wand.dry');
  });

  it('refuses a hook closer than the minimum', () => {
    const r = rig();
    r.wall(106, 100, 120, FLOOR - 1);
    r.step(2);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.ready).toBe(true);
    expect(r.sys.ownsMovement).toBe(false);
  });

  it('on rock: spends the cooldown, hauls her to 8 cells short of the hook and keeps her momentum', () => {
    const r = rig();
    r.wall(180, 100, 190, FLOOR - 1);
    r.step(2);
    const p = r.ctx.player;
    const x0 = p.x;
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.ownsMovement).toBe(true);
    expect(r.sfx).toContain('trick.whip');
    let ticks = 1;
    while (r.sys.ownsMovement && ticks < 60) { r.step(1); ticks++; }
    expect(ticks).toBeLessThanOrEqual(TUNING.bogline.haulTicks + 2);
    // The hook is the first rock cell at x = 180 along the shoulder line; she stops 8 short of it (shoulder to hook).
    expect(p.x).toBeGreaterThan(x0 + 60);
    expect(180 - p.x).toBeGreaterThanOrEqual(TUNING.bogline.stopShort - 1);
    expect(180 - p.x).toBeLessThanOrEqual(TUNING.bogline.stopShort + TUNING.bogline.haulSpeed);
    expect(p.vx).toBeGreaterThan(1); // she leaves it still moving
    expect(r.sfx.some((s) => s.startsWith('player.land'))).toBe(true);
  });

  it('on a light foe: yanks it toward her through the knock state, then stuns it, and does not move her', () => {
    const r = rig();
    const e = r.foe('slime', 190);
    r.step(2);
    const p = r.ctx.player;
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.ownsMovement).toBe(false); // she stays put
    expect(r.sys.isMarked(e)).toBe(true);
    expect(e.knockVx).toBeLessThan(0); // toward her (she is at x 100, the foe at 190)
    expect(e.knockT).toBeGreaterThanOrEqual(2);
    expect(r.gust.length).toBe(1);
    expect(r.gust[0].e).toBe(e);
    // run the yank out: the foe keeps being driven toward her for yankTicks, and the stun then holds it
    for (let i = 0; i < TUNING.bogline.yankTicks; i++) r.step(1);
    r.step(2);
    expect(e.knockVx).toBe(0); // stunned: held at no velocity
    expect(p.x).toBe(100);
  });

  it('on a heavy foe: she is hauled to it instead, and it is stunned on her arrival', () => {
    const r = rig();
    const e = r.foe('golem', 220, 170, 170);
    r.step(2);
    const p = r.ctx.player;
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.ownsMovement).toBe(true);
    expect(e.knockVx ?? 0).toBe(0); // the golem was not yanked
    let ticks = 1;
    while (r.sys.ownsMovement && ticks < 60) { r.step(1); ticks++; }
    expect(p.x).toBeGreaterThan(150);
    expect(220 - p.x).toBeGreaterThanOrEqual(TUNING.bogline.stopShort);
    r.step(2);
    expect(e.knockT).toBeGreaterThanOrEqual(2); // held in the stun
  });

  it('hooks the foe in front of the wall, not the wall', () => {
    const r = rig();
    r.wall(250, 100, 262, FLOOR - 1);
    const e = r.foe('slime', 160);
    r.step(2);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.ownsMovement).toBe(false);
    expect(r.sys.isMarked(e)).toBe(true);
  });

  it('a foe behind a wall is not hooked: the line stops at the rock', () => {
    const r = rig();
    r.wall(160, 100, 170, FLOOR - 1);
    const e = r.foe('slime', 220);
    r.step(2);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.ownsMovement).toBe(true); // it hauled her to the wall
    expect(r.sys.isMarked(e)).toBe(false);
  });

  it('cools down for 8 seconds, then can be fired again', () => {
    const r = rig();
    r.wall(180, 100, 190, FLOOR - 1);
    r.step(2);
    r.sys.press('tactical');
    r.step(40);
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.view.tactical.cooldownSeconds).toBeGreaterThanOrEqual(7);
    r.step(TUNING.bogline.cooldown);
    expect(r.sys.view.tactical.ready).toBe(true);
  });
});

describe('Sable Fen through the system: Bloodsense', () => {
  function begin(r: Rig): void {
    r.step(2);
    r.sys.refill();
    r.sys.press('ultimate');
    r.step(1);
  }

  it('is refused until the bar is full, and spends it whole', () => {
    const r = rig();
    r.step(2);
    r.sys.press('ultimate');
    r.step(1);
    expect(r.sys.view.ultimate.active).toBe(0);
    expect(r.sys.view.ultimate.refusedAt).toBeGreaterThan(0);
    r.sys.refill();
    r.sys.press('ultimate');
    r.step(1);
    expect(r.sys.view.ultimate.active).toBeGreaterThan(0.9);
    expect(r.sys.view.ultimate.charge).toBe(0);
  });

  it('reveals wounded foes in range, through rock, and leaves healthy and far ones alone', () => {
    const r = rig();
    const wounded = r.foe('slime', 180, 10, 30);
    const behindWall = r.foe('slime', 330, 10, 30);
    const healthy = r.foe('slime', 150, 30, 30);
    const far = r.foe('bat', 99 + 330, 3, 16);
    far.y = FLOOR - 20;
    r.wall(250, 60, 270, FLOOR - 1);
    begin(r);
    r.step(2);
    expect(r.sys.isRevealed(wounded)).toBe(true);
    expect(r.sys.isRevealed(behindWall)).toBe(true);
    expect(r.sys.isRevealed(healthy)).toBe(false);
    expect(r.sys.isRevealed(far)).toBe(false);
    expect(r.sys.revealOf(wounded)?.[1]).toBeGreaterThan(r.sys.revealOf(wounded)?.[0] ?? 1); // green
  });

  it('re-evaluates each tick: a foe wounded mid-ultimate joins in, one that dies drops out', () => {
    const r = rig();
    const e = r.foe('slime', 200, 30, 30);
    begin(r);
    r.step(3);
    expect(r.sys.isRevealed(e)).toBe(false);
    e.hp = 12;
    r.step(2);
    expect(r.sys.isRevealed(e)).toBe(true);
    e.hp = 0;
    r.step(TUNING.bloodsense.revealTicks + 2);
    expect(r.sys.isRevealed(e)).toBe(false);
  });

  it('makes her 10% faster while it lasts and not after', () => {
    const r = rig();
    begin(r);
    expect(r.sys.moveScale()).toBeCloseTo(1.1, 6);
    r.step(TUNING.bloodsense.duration + 3);
    expect(r.sys.moveScale()).toBe(1);
    expect(r.sys.view.ultimate.active).toBe(0);
  });

  it('the reveal outlasts nothing: it lapses within a few ticks of the end', () => {
    const r = rig();
    const e = r.foe('slime', 200, 10, 30);
    begin(r);
    r.step(5);
    expect(r.sys.isRevealed(e)).toBe(true);
    r.step(TUNING.bloodsense.duration + TUNING.bloodsense.revealTicks + 3);
    expect(r.sys.isRevealed(e)).toBe(false);
  });

  it('puts the heartbeat drawable on the over layer while it runs and takes it off once the rings have faded', () => {
    const r = rig();
    begin(r);
    r.step(2);
    expect(r.sys.drawables.some((d) => d.layer === 'over')).toBe(true);
    r.step(TUNING.bloodsense.duration + TUNING.bloodsense.ringTicks + 5);
    // (the reveal drawable is also 'over' and lapses on its own sweep; the heartbeat is gone when only that remains or nothing)
    expect(r.sys.drawables.filter((d) => d.layer === 'over').length).toBeLessThanOrEqual(1);
  });
});
