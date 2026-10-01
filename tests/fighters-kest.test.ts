import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W, PLAYER_STEP_UP } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit, TUNING } from '@/fighters/kits/kest-rel';
import {
  blockedAxes, climbTicksForCells, columnFrac, dashVector, foeKnockVy, foeScale, inColumn, riderLift, riderVy,
  simulateDash, simulateFoe, simulateRider, slideAlong, smokeLife, stepAcross,
} from '@/fighters/kits/kest-rel-math';
import type { DashSpec } from '@/fighters/kits/kest-rel-math';
import { blocksEntity, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

/**
 * Kest Rel's maths and rules without a browser: the climb accumulator, the dash and how it skims, the
 * column's lift for a rider, a foe and a crate, and the kit itself run through the real FighterSystem
 * against a small real World. What the real engine does with them (the climb, a foe's notice, the column
 * of cells the sim animates) is probed in scripts/verify-fighter-kest.mjs.
 */

const SPEC: DashSpec = { speed: TUNING.step.speed, ticks: TUNING.step.ticks, stepUp: PLAYER_STEP_UP };

/** A grid of walls as a free-space predicate for the dash dry run: the body is a point plus its standing room. */
function gridFree(solid: (x: number, y: number) => boolean) {
  return (x: number, y: number): boolean => {
    for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) {
      for (let dy = 0; dy < PLAYER_H; dy++) if (solid(x + dx, y - dy)) return false;
    }
    return true;
  };
}

describe('Rooftop Runner: the climb', () => {
  it('climbs 30 cells in about two thirds of the ticks at x1.5', () => {
    const classic = climbTicksForCells(30, 1);
    const kest = climbTicksForCells(30, TUNING.passive.climbScale);
    expect(classic).toBe(67); // 0.45 cells a tick
    expect(kest).toBeLessThan(classic * 0.72);
    expect(classic / kest).toBeGreaterThan(1.4);
    expect(classic / kest).toBeLessThan(1.6);
  });
});

describe('Smoke Step: the dash', () => {
  const floor = (x: number, y: number): boolean => y >= 100; // an open floor, the body stands at y 99

  it('is 36 cells along the aim, 6 ticks of 6', () => {
    const v = dashVector(0, SPEC.speed);
    expect(v.dx).toBeCloseTo(6, 6);
    expect(v.dy).toBeCloseTo(0, 6);
    const run = simulateDash(gridFree(floor), 50, 99, 0, SPEC);
    expect(run.x - 50).toBe(36);
    expect(run.y).toBe(99);
    expect(run.blocked).toBe(false);
    // a diagonal aim keeps the speed
    const diag = dashVector(-Math.PI / 4, SPEC.speed);
    expect(Math.hypot(diag.dx, diag.dy)).toBeCloseTo(6, 6);
  });

  it('stops at a wall and reports how much room there was', () => {
    const wall = (x: number, y: number): boolean => y >= 100 || x >= 70;
    const run = simulateDash(gridFree(wall), 50, 99, 0, SPEC);
    expect(run.blocked).toBe(true);
    // the body is 9 wide: it stops with its edge against the wall
    expect(run.x).toBe(70 - PLAYER_HALF_W - 1);
    expect(run.cells).toBeLessThan(36);
    const nose = simulateDash(gridFree(wall), 70 - PLAYER_HALF_W - 1, 99, 0, SPEC);
    expect(nose.cells).toBe(0);
  });

  it('skims along the floor when the aim runs into it, but not when it is straight down', () => {
    // aimed a little under horizontal, standing on the floor: the whole speed goes along the ground
    const run = simulateDash(gridFree(floor), 50, 99, Math.atan2(1, 5), SPEC);
    expect(run.x - 50).toBe(36);
    expect(run.y).toBe(99);
    // straight into the floor: nowhere to go
    expect(simulateDash(gridFree(floor), 50, 99, Math.PI / 2, SPEC).cells).toBe(0);
    // a ceiling does the same
    const ceiling = (x: number, y: number): boolean => y >= 100 || y <= 99 - PLAYER_H;
    expect(simulateDash(gridFree(ceiling), 50, 99, -Math.atan2(1, 5), SPEC).x - 50).toBe(36);
  });

  it('runs up onto a low lip and is stopped by a high one', () => {
    const lip = (h: number) => (x: number, y: number): boolean => y >= 100 || (x >= 70 && y >= 100 - h);
    expect(simulateDash(gridFree(lip(3)), 50, 99, 0, SPEC).blocked).toBe(false);
    expect(simulateDash(gridFree(lip(3)), 50, 99, 0, SPEC).y).toBe(96);
    expect(simulateDash(gridFree(lip(PLAYER_STEP_UP + 3)), 50, 99, 0, SPEC).blocked).toBe(true);
  });

  it('knows which axes are blocked and slides only when the aim has a real component along the other', () => {
    const free = gridFree((x, y) => y >= 100);
    expect(blockedAxes(free, 50, 99, 6, 1, PLAYER_STEP_UP)).toEqual({ bx: false, by: true });
    expect(stepAcross(free, 50, 99, 1, PLAYER_STEP_UP)).toBe(99);
    expect(slideAlong(6, 1, false, true, 6)).toEqual({ dx: 6, dy: 0 });
    expect(slideAlong(0.2, 6, false, true, 6)).toEqual({ dx: 0.2, dy: 6 }); // straight down stays blocked
    expect(slideAlong(1, 6, true, false, 6)).toEqual({ dx: 0, dy: 6 });
    expect(slideAlong(6, 1, true, true, 6)).toEqual({ dx: 6, dy: 1 }); // boxed in: nothing to slide to
  });

  it('draws smoke life across its band and never outside it', () => {
    expect(smokeLife(0, 40, 70)).toBe(40);
    expect(smokeLife(0.9999999, 40, 70)).toBe(70);
    for (let i = 0; i < 100; i++) {
      const l = smokeLife(i / 100, TUNING.step.puffLifeMin, TUNING.step.puffLifeMax);
      expect(l).toBeGreaterThanOrEqual(40);
      expect(l).toBeLessThanOrEqual(70);
    }
  });
});

describe('Updraft: the column', () => {
  const T = TUNING.updraft;

  it('reads where a body stands in the draft', () => {
    expect(columnFrac(200, 110, 200)).toBe(0);
    expect(columnFrac(200, 110, 110)).toBe(1);
    expect(columnFrac(200, 110, 155)).toBeCloseTo(0.5, 5);
    expect(columnFrac(200, 110, 50)).toBe(1); // above the top: clamped
    // a draft 18 wide from the floor (y 208) up to its top (y 110)
    expect(inColumn(100, 110, 208, 9, 108, 150)).toBe(true);
    expect(inColumn(100, 110, 208, 9, 111, 150)).toBe(false);
    expect(inColumn(100, 110, 208, 9, 111, 150, 4)).toBe(true); // a wide body
    expect(inColumn(100, 110, 208, 9, 100, 204)).toBe(true); // a crate resting on the floor beside the furnace is in the draft
    expect(inColumn(100, 110, 208, 9, 100, 300)).toBe(false); // below the floor
    expect(inColumn(100, 110, 208, 9, 100, 80)).toBe(false); // over the top
  });

  it('lifts a rider fast, never past the top, and hangs her near the balance point', () => {
    const ride = simulateRider(T.rider, T.height, 300);
    const tReach = ride.findIndex((y) => y >= 55);
    expect(tReach).toBeGreaterThan(0);
    expect(tReach).toBeLessThanOrEqual(30);
    expect(Math.max(...ride)).toBeLessThan(T.height);
    const settled = ride.slice(200);
    const mean = settled.reduce((a, b) => a + b, 0) / settled.length;
    expect(mean).toBeGreaterThan(T.height * (T.rider.fEq - 0.1));
    expect(mean).toBeLessThan(T.height * (T.rider.fEq + 0.05));
    expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(1.5); // no bobbing
    // never faster than the cap, and the cap sits under Player's own up-limit (-4.6)
    let vy = 0;
    for (let i = 0; i < 100; i++) { vy = riderVy(vy + T.rider.gravity, 0, 1, T.rider); expect(vy).toBeGreaterThanOrEqual(-T.rider.riseCap); }
    expect(T.rider.riseCap).toBeLessThanOrEqual(4.6);
  });

  it('beats gravity below the balance point and loses to it above', () => {
    expect(riderLift(0, 1, T.rider)).toBeGreaterThan(T.rider.gravity);
    expect(riderLift(T.rider.fEq, 1, T.rider)).toBeCloseTo(T.rider.gravity, 6);
    expect(riderLift(1, 1, T.rider)).toBeLessThan(T.rider.gravity);
  });

  it('lets a rider glide down when the flame dies instead of dropping her', () => {
    const fade = (t: number): number => Math.min(1, (T.duration - t) / T.fadeTicks);
    const ride = simulateRider(T.rider, T.height, T.duration, fade);
    const atFade = ride[T.duration - T.fadeTicks];
    expect(atFade).toBeGreaterThan(55);
    // she is still above the furnace at the end, and the speed she came down at was gentle
    let worst = 0;
    for (let t = T.duration - T.fadeTicks; t < T.duration - 1; t++) worst = Math.max(worst, ride[t] - ride[t + 1]);
    expect(worst).toBeLessThan(2.5);
    expect(ride[T.duration - 1]).toBeLessThan(atFade);
  });

  it('hoists a light foe past the top and a heavy one less far, under the wall-smash speed', () => {
    const light = simulateFoe(T.foe, 32, T.height, 80);
    const heavy = simulateFoe(T.foe, 140, T.height, 80);
    expect(light.findIndex((y) => y >= T.height)).toBeGreaterThan(0); // thrown clear of the top
    expect(Math.max(...heavy)).toBeLessThan(Math.max(...light));
    expect(foeScale(140, T.foe)).toBeLessThan(foeScale(32, T.foe));
    // the push stays under the speed at which a launched foe is smashed against a ceiling (3.5)
    expect(T.foe.riseCap).toBeLessThan(3.5);
    let kv = 0;
    for (let i = 0; i < 60; i++) { kv = foeKnockVy(kv, 0, 15, 1, T.foe); expect(kv).toBeGreaterThanOrEqual(-T.foe.riseCap); }
    // with the flame out it lifts a quarter as hard
    expect(foeKnockVy(0, 0, 32, 0, T.foe)).toBeCloseTo(foeKnockVy(0, 0, 32, 1, T.foe) * 0.25, 6);
  });
});

// ---------------------------------------------------------------------------- the kit through the real system

interface Setup {
  ctx: Ctx;
  sys: FighterSystem;
  world: World;
  enemies: Enemy[];
  player: Ctx['player'];
  step(n?: number): void;
  sfx: string[];
}

const W = 400, H = 240, FLOOR = 200; // the floor's surface row; the body stands at FLOOR - 1

function setup(opts: { ceiling?: number; wall?: number; water?: boolean; noFloor?: boolean } = {}): Setup {
  const world = new World(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const solid = (!opts.noFloor && y >= FLOOR) || (opts.ceiling !== undefined && y <= opts.ceiling) || (opts.wall !== undefined && x >= opts.wall);
    if (solid) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555555);
  }
  if (opts.water) {
    for (let y = FLOOR - 14; y < FLOOR; y++) for (let x = 0; x < W; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0x2060ff);
  }
  const events = new EventBus();
  const enemies: Enemy[] = [];
  const sfx: string[] = [];
  const player = {
    x: 100, y: FLOOR - 1, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, climbDir: 1, climbIntentY: 0, crouchT: 0, crawling: false, swinging: false,
    aimAngle: 0, lastDamageSource: null as string | null, status: { burning: 0 }, hat: { vx: 0, vy: 0 },
  };
  const state = { mode: 'play', frameCount: 1, paused: false };
  const noop = (): void => undefined;
  const physics = {
    entityFree: (cx: number, cy: number, halfW: number, h: number): boolean => {
      for (let dx = -halfW; dx <= halfW; dx++) for (let dy = 0; dy < h; dy++) {
        const x = cx + dx, y = cy - dy;
        if (!world.inBounds(x, y)) return false;
        if (blocksEntity(world.types[world.idx(x, y)])) return false;
      }
      return true;
    },
    tryMoveEntity: (e: { x: number; y: number }, dx: number, dy: number, halfW: number, h: number, stepUp: number): boolean => {
      const tryTo = (nx: number, ny: number): boolean => {
        if (!physics.entityFree(nx, ny, halfW, h)) return false;
        e.x = nx; e.y = ny;
        return true;
      };
      if (dy !== 0) return tryTo(e.x, e.y + dy);
      if (tryTo(e.x + dx, e.y)) return true;
      for (let s = 1; s <= stepUp; s++) if (tryTo(e.x + dx, e.y - s)) return true;
      return false;
    },
  };
  const ctx = {
    events, state, player, enemies, world, physics,
    fx: { screenShake: 0, bloomKick: 0 },
    enemyCtl: { defs: { slime: { hp: 40, halfW: 4, h: 8, bounty: 0 }, golem: { hp: 200, halfW: 8, h: 18, bounty: 0 }, colossus: { hp: 900, halfW: 20, h: 34, bounty: 0 } }, damage: noop },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    particles: { burst: noop, spawn: noop },
    playerCtl: { releaseVine: noop },
    input: { keys: {} },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sys.equip('kest-rel');
  return {
    ctx, sys, world, enemies, player: ctx.player, sfx,
    step: (n = 1) => { for (let i = 0; i < n; i++) { state.frameCount++; sys.update(ctx); } },
  };
}

function makeEnemy(x: number, y: number, kind = 'slime', hp = 40): Enemy {
  return { x, y, hp, maxHp: hp, kind, vx: 0, vy: 0, bobPhase: 0, knockVy: 0, knockVx: 0, knockT: 0, sleeping: true } as unknown as Enemy;
}

function census(world: World): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < world.types.length; i++) m.set(world.types[i], (m.get(world.types[i]) ?? 0) + 1);
  return m;
}

describe('Kest Rel through the fighter system', () => {
  it('holds Rooftop Runner for good: it never lapses, is cleared with a floor change, and the next tick puts it back', () => {
    const { sys, ctx, step } = setup();
    step(1);
    expect(sys.climbScale()).toBe(TUNING.passive.climbScale);
    step(5000); // far longer than any other modifier lives
    expect(sys.climbScale()).toBe(TUNING.passive.climbScale);
    ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    expect(sys.climbScale()).toBe(1); // a floor change clears every modifier
    step(1);
    expect(sys.climbScale()).toBe(TUNING.passive.climbScale);
    // and it is the only thing the passive touches
    expect(sys.moveScale()).toBe(1);
    expect(sys.concealment()).toBe(0);
    expect(sys.reduceIncoming(10, 'x')).toBe(10);
  });

  it('dashes 36 cells along the aim, puffs smoke at both ends with ragged lives, and hides her for 150 ticks', () => {
    const { sys, ctx, world, player, step } = setup();
    const before = census(world);
    step(1);
    sys.press('tactical');
    step(1);
    expect(sys.view.tactical.ready).toBe(false);
    expect(sys.ownsMovement).toBe(true);
    expect(sys.concealment()).toBeCloseTo(TUNING.step.concealment, 6);
    for (let i = 0; i < 12 && sys.ownsMovement; i++) step(1);
    expect(sys.ownsMovement).toBe(false);
    expect(player.x - 100).toBeGreaterThanOrEqual(34);
    expect(player.x - 100).toBeLessThanOrEqual(38);
    expect(player.y).toBe(FLOOR - 1);
    expect(player.vx).toBeGreaterThan(1); // she keeps her momentum
    // smoke at both ends, nowhere else, each cell with its own life in the band
    const lives: number[] = [];
    let atStart = 0, atEnd = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Smoke) continue;
      lives.push(world.life[i]);
      if (Math.abs(x - 100) <= TUNING.step.puffRadius) atStart++;
      else if (Math.abs(x - player.x) <= TUNING.step.puffRadius) atEnd++;
      else throw new Error(`smoke away from both ends at ${x},${y}`);
    }
    expect(atStart).toBeGreaterThan(40);
    expect(atEnd).toBeGreaterThan(40);
    // (the live sim has not run here: the lives are as written, 40..70, and not all the same)
    expect(Math.min(...lives)).toBeGreaterThanOrEqual(TUNING.step.puffLifeMin);
    expect(Math.max(...lives)).toBeLessThanOrEqual(TUNING.step.puffLifeMax);
    expect(new Set(lives).size).toBeGreaterThan(10);
    // it wrote nothing but smoke (it cannot seal a route)
    const after = census(world);
    for (const [t, n] of after) if (t !== Cell.Smoke && t !== Cell.Empty) expect(n).toBe(before.get(t) ?? 0);
    // the cover holds for 150 ticks from the press and then lapses
    step(120);
    expect(sys.concealment()).toBeCloseTo(TUNING.step.concealment, 6);
    step(40);
    expect(sys.concealment()).toBe(0);
    expect(sys.view.tactical.ready).toBe(false); // 8 s: still cooling
    step(TUNING.step.cooldown);
    expect(sys.view.tactical.ready).toBe(true);
    expect(ctx.state.frameCount).toBeGreaterThan(0);
  });

  it('refuses a dash with no room and does not spend the cooldown', () => {
    const { sys, world, player, step, sfx } = setup({ wall: 100 + PLAYER_HALF_W + 3 });
    step(1);
    sys.press('tactical');
    step(1);
    expect(sys.ownsMovement).toBe(false);
    expect(sys.view.tactical.ready).toBe(true);
    expect(sys.view.tactical.usedAt).toBe(-1);
    expect(sys.view.tactical.refusedAt).toBeGreaterThan(0);
    expect(player.x).toBe(100);
    expect(sfx).toContain('wand.dry');
    expect(census(world).get(Cell.Smoke) ?? 0).toBe(0);
  });

  it('turns Smoke Step the other way when she aims behind her', () => {
    const { sys, player, step } = setup();
    player.aimAngle = Math.PI;
    step(1);
    sys.press('tactical');
    step(14);
    expect(player.x).toBeLessThan(100 - 34);
    expect(player.facing).toBe(-1);
  });

  it('lights the furnace on a floor, writes only Fire, Steam and Smoke, and puts the flame out in the end', () => {
    const { sys, world, player, enemies, step } = setup();
    const before = census(world);
    sys.addCharge(1);
    step(1);
    expect(sys.view.ultimate.ready).toBe(true);
    sys.press('ultimate');
    step(1);
    expect(sys.view.ultimate.active).toBeGreaterThan(0.9);
    expect(sys.drawables.length).toBe(1); // the furnace
    expect(player.vy).toBeLessThan(-1); // a hop and then the draft takes her
    // a foe standing in the column is hoisted: knock state set, upward
    const foe = makeEnemy(103, FLOOR - 1);
    enemies.push(foe);
    step(3);
    expect(foe.knockT).toBeGreaterThanOrEqual(2);
    expect(foe.knockVy).toBeLessThan(0);
    expect(foe.sleeping).toBe(false);
    // the burner writes real cells at the mouth
    const mouthY = FLOOR - 1 - 8;
    let fire = 0;
    for (let y = mouthY - 3; y <= mouthY; y++) for (let x = 95; x <= 105; x++) if (world.types[world.idx(x, y)] === Cell.Fire) fire++;
    expect(fire).toBeGreaterThan(3);
    // run it out
    step(TUNING.updraft.duration + TUNING.updraft.coolTicks + 5);
    expect(sys.view.ultimate.active).toBe(0);
    expect(sys.drawables.length).toBe(0); // the iron has gone from view
    expect(sys.view.ultimate.charge).toBeLessThan(0.1);
    // no solid was ever written
    const after = census(world);
    for (const [t, n] of after) {
      if (t === Cell.Fire || t === Cell.Steam || t === Cell.Smoke || t === Cell.Empty) continue;
      expect(n).toBe(before.get(t) ?? 0);
    }
  });

  it('does not lift a boss, a rooted foe or a foe outside the column, and lets go of a hoisted foe after its time', () => {
    const { sys, enemies, step } = setup();
    const boss = makeEnemy(100, FLOOR - 1, 'colossus', 900);
    const far = makeEnemy(180, FLOOR - 1);
    const caught = makeEnemy(100, FLOOR - 1);
    enemies.push(boss, far, caught);
    sys.addCharge(1);
    step(1);
    sys.press('ultimate');
    step(3);
    expect(boss.knockT).toBe(0);
    expect(far.knockT).toBe(0);
    expect(caught.knockT).toBeGreaterThanOrEqual(2);
    // held in place (the test world has no knock integration): after hoistTicks it is flung sideways and let go
    step(TUNING.updraft.hoistTicks + 3);
    expect(Math.abs(caught.knockVx ?? 0)).toBeGreaterThan(1);
  });

  it('throws a foe clear of the draft when it leaves through the top, and does not catch it again at once', () => {
    const { sys, enemies, step } = setup();
    const foe = makeEnemy(100, FLOOR - 1);
    enemies.push(foe);
    sys.addCharge(1);
    step(1);
    sys.press('ultimate');
    step(2);
    expect(foe.knockT).toBeGreaterThanOrEqual(2); // caught
    // the engine would have carried it to the top by now: put it above the draft
    foe.y = FLOOR - 1 - 120;
    foe.knockVx = 0;
    foe.knockT = 0;
    step(1);
    expect(Math.abs(foe.knockVx ?? 0)).toBeGreaterThan(1); // thrown sideways
    expect(foe.knockT).toBeGreaterThan(10);
    // back in the draft a moment later it is left alone (it was just thrown out)
    foe.y = FLOOR - 1; foe.x = 100; foe.knockT = 0; foe.knockVx = 0; foe.knockVy = 0;
    step(3);
    expect(foe.knockT).toBe(0);
    step(TUNING.updraft.recatchTicks + 2);
    foe.x = 100; foe.y = FLOOR - 1; foe.knockT = 0;
    step(2);
    expect(foe.knockT).toBeGreaterThanOrEqual(2); // and may be caught again after its time
  });

  it('refuses the furnace with no floor under her, under a low ceiling, and under water, without spending the bar', () => {
    for (const [name, o] of [
      ['no floor', { noFloor: true }],
      ['low ceiling', { ceiling: FLOOR - 28 }],
      ['water', { water: true }],
    ] as const) {
      const { sys, player, step } = setup(o);
      if (name === 'no floor') { player.y = 150; player.grounded = false; }
      sys.addCharge(1);
      step(1);
      sys.press('ultimate');
      step(1);
      expect(sys.view.ultimate.active, name).toBe(0);
      expect(sys.view.ultimate.charge, name).toBe(1); // the bar is kept
      expect(sys.view.ultimate.refusedAt, name).toBeGreaterThan(0);
      expect(sys.drawables.length, name).toBe(0);
    }
  });

  it('puts the furnace on the floor below her when she is airborne', () => {
    const { sys, player, world, step } = setup();
    player.y = FLOOR - 21;
    player.grounded = false;
    sys.addCharge(1);
    step(1);
    sys.press('ultimate');
    step(1);
    expect(sys.view.ultimate.active).toBeGreaterThan(0.9);
    // the mouth is above the real floor, not above her
    const mouthY = FLOOR - 1 - 8;
    let fire = 0;
    for (let y = mouthY - 3; y <= mouthY; y++) for (let x = 95; x <= 105; x++) if (world.types[world.idx(x, y)] === Cell.Fire) fire++;
    expect(fire).toBeGreaterThan(0);
  });

  it('wipes the furnace, the draft and the cover on a floor change', () => {
    const { sys, ctx, step } = setup();
    sys.addCharge(1);
    step(1);
    sys.press('ultimate');
    step(5);
    expect(sys.drawables.length).toBe(1);
    ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    expect(sys.drawables.length).toBe(0);
    step(1);
    expect(sys.view.ultimate.active).toBe(0);
    expect(sys.climbScale()).toBe(TUNING.passive.climbScale); // the passive comes back
  });
});
