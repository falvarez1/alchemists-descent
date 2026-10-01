import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit } from '@/fighters/kits/selene-wraith';
import {
  SlideModel, TUNING, approach, blinkDistances, chooseBlink, echoFade, echoSlot, groundDrop, lureChoice, nearestSpot,
  recallCooldown, slideSpeedAt, slideStartSpeed, slideTotals,
} from '@/fighters/kits/selene-wraith-math';
import type { SlideEnv } from '@/fighters/kits/selene-wraith-math';
import { Cell, blocksEntity } from '@/sim/CellType';

/**
 * Selene Wraith's rules, node-only: the slide's maths (speed, the floor it follows, why it ends), where a blink
 * may land and what a recall leaves of the cooldown, where the echoes ride and which of the real body and the
 * echoes a foe believes in; then the kit on the real FighterSystem over a fake world (the Z-again recall, the
 * decoys a foe is asked about, a real slide stepped by the system). What it does to the real engine is
 * probed in scripts/verify-fighter-selene.mjs.
 */

const S = TUNING.slide, E = TUNING.echo, M = TUNING.mirror;

// ---------------------------------------------------------------------------------------- Liquid Momentum

describe('Liquid Momentum: the slide\'s numbers', () => {
  it('keeps 97% of its speed a tick and runs 45 ticks from a full sprint', () => {
    expect(slideSpeedAt(2.85, 0)).toBe(2.85);
    expect(slideSpeedAt(2.85, 1)).toBeCloseTo(2.85 * 0.97, 9);
    const t = slideTotals(2.85);
    expect(t.ticks).toBe(45);
    // 2.85 * (1 - 0.97^45) / 0.03: about 71 cells
    expect(t.distance).toBeGreaterThan(70);
    expect(t.distance).toBeLessThan(72);
    expect(t.exitSpeed).toBeCloseTo(2.85 * 0.97 ** 45 * 0.8, 6);
  });

  it('covers well over the classic crouch\'s crawl (0.91 a tick) in the same time', () => {
    expect(slideTotals(2.85).distance / (0.91 * 45)).toBeGreaterThan(1.6);
  });

  it('is the same slide in either direction', () => {
    expect(slideTotals(-2.85).distance).toBeCloseTo(slideTotals(2.85).distance, 9);
  });

  it('starts only at a real sprint, and counts the speed from before the crouch clamped it', () => {
    expect(slideStartSpeed(2.85, 0.91)).toBe(2.85); // the key edge tick: the stance has already clamped this tick's speed
    expect(slideStartSpeed(-2.5, -0.9)).toBe(-2.5);
    expect(slideStartSpeed(2.1, 0.9)).toBe(0); // under 2.2
    expect(slideStartSpeed(2.2, 2.2)).toBe(2.2);
    expect(slideStartSpeed(0, 0)).toBe(0);
    expect(slideStartSpeed(2.85, -1.5)).toBe(0); // a body that is being thrown back is not sliding forward
  });
});

describe('Liquid Momentum: the floor under a slide', () => {
  it('finds how far down the floor is, within the snap, or reports a ledge', () => {
    const floorAt = (fy: number) => (_x: number, y: number): boolean => y >= fy; // a floor whose top row is fy+1
    expect(groundDrop(floorAt(100), 5, 100, 5)).toBe(0);
    expect(groundDrop(floorAt(103), 5, 100, 5)).toBe(3);
    expect(groundDrop(floorAt(105), 5, 100, 5)).toBe(5);
    expect(groundDrop(floorAt(106), 5, 100, 5)).toBeNull();
  });
});

/** A slide over a floor: `floorY(x)` is the row her feet stand on at column x (a big number = no floor). */
function run(floorY: (x: number) => number, opts: { v0?: number; keys?: (age: number) => { jump: boolean; down: boolean; hurt: boolean }; x?: number; y?: number } = {}) {
  const model = new SlideModel(opts.v0 ?? 2.85);
  let x = opts.x ?? 0, y = opts.y ?? 100;
  let acc = 0;
  const trace: Array<{ x: number; y: number; vx: number }> = [];
  const env: SlideEnv = { x, y, jump: false, down: true, hurt: false, floored: (cx, cy) => cy >= floorY(cx) };
  for (let t = 0; t < 200; t++) {
    env.x = x; env.y = y;
    const k = opts.keys?.(model.age) ?? { jump: false, down: true, hurt: false };
    env.jump = k.jump; env.down = k.down; env.hurt = k.hurt;
    const step = model.step(env);
    if (!step) break;
    // the system's whole-cell mover: sideways a cell at a time, then down
    acc += step.dx;
    while (Math.abs(acc) >= 1) { const sx = acc > 0 ? 1 : -1; x += sx; acc -= sx; }
    y += step.dy;
    trace.push({ x, y, vx: step.dx });
    if (t >= S.maxTicks - 1) break; // the system stops a plan at its ticks
  }
  return { model, x, y, trace };
}

describe('Liquid Momentum: the slide model', () => {
  it('on a flat floor runs its 45 ticks and lets go with 80% of its speed', () => {
    const r = run(() => 100);
    expect(r.trace).toHaveLength(45);
    expect(r.x).toBeGreaterThan(69);
    expect(r.x).toBeLessThan(72);
    expect(r.y).toBe(100);
    expect(r.model.exitVx).toBeCloseTo(2.85 * 0.97 ** 45 * 0.8, 6);
    expect(r.trace[10].vx / r.trace[9].vx).toBeCloseTo(0.97, 9);
  });

  it('follows a floor that falls away, a cell for a cell, without leaving it', () => {
    const r = run((x) => 100 + Math.max(0, Math.min(8, x - 10))); // flat to x 10, then a 45-degree drop of 8
    expect(r.y).toBe(108);
    expect(r.model.end).not.toBe('ledge');
  });

  it('ends at a ledge: the floor drops away by more than it can follow', () => {
    const r = run((x) => (x < 30 ? 100 : 140));
    expect(r.model.end).toBe('ledge');
    expect(r.x).toBeGreaterThan(24);
    expect(r.x).toBeLessThanOrEqual(30);
    expect(r.y).toBe(100);
  });

  it('ends on a jump at once, and on a blow', () => {
    const jump = run(() => 100, { keys: (age) => ({ jump: age >= 5, down: true, hurt: false }) });
    expect(jump.model.end).toBe('jump');
    expect(jump.model.age).toBe(5);
    const hurt = run(() => 100, { keys: (age) => ({ jump: false, down: true, hurt: age >= 7 }) });
    expect(hurt.model.end).toBe('hurt');
    expect(hurt.model.age).toBe(7);
  });

  it('lets go of the crouch: a tap holds for the minimum, then the key decides', () => {
    const tap = run(() => 100, { keys: () => ({ jump: false, down: false, hurt: false }) });
    expect(tap.model.end).toBe('released');
    expect(tap.model.age).toBe(S.minHold);
    const held = run(() => 100, { keys: (age) => ({ jump: false, down: age < 25, hurt: false }) });
    expect(held.model.end).toBe('released');
    expect(held.model.age).toBe(25);
  });

  it('stops when it has run out of speed', () => {
    const r = run(() => 100, { v0: 0.5 });
    expect(r.model.end).toBe('stopped');
  });
});

// ---------------------------------------------------------------------------------------- Quicksilver Echo

describe('Quicksilver Echo: where a blink lands', () => {
  it('tries the farthest point first and backs off in steps while at least the minimum', () => {
    expect(blinkDistances(100, 40, 8, 4)).toEqual([40, 36, 32, 28, 24, 20, 16, 12, 8]);
    expect(blinkDistances(21.7, 40, 8, 4)).toEqual([21, 17, 13, 9]);
    expect(blinkDistances(7.9, 40, 8, 4)).toEqual([]); // a wall at her nose
  });

  it('finds the nearest spot by true distance inside a ring', () => {
    const ok = (x: number, y: number): boolean => (x === 12 && y === 20) || (x === 10 && y === 14);
    // (10, 14) is 6 away straight up; (12, 20) is 2 right and 0 down of the centre (10, 20): nearer
    expect(nearestSpot(ok, 10, 20, 10)).toEqual({ x: 12, y: 20 });
    expect(nearestSpot(ok, 10, 20, 1)).toBeNull();
    expect(nearestSpot(() => true, 3.4, 5.6, 4)).toEqual({ x: 3, y: 6 });
  });

  const spec = (ok: (x: number, y: number) => boolean, clear = 60) => ({ x: 100, y: 100, ax: 1, ay: 0, clear, ok });

  it('blinks the full 40 cells to a floor', () => {
    const to = chooseBlink(spec((x, y) => y === 100 && x > 90));
    expect(to).toEqual({ x: 140, y: 100, dist: 40 });
  });

  it('never goes past the first solid: the distance is capped by the clear run', () => {
    const to = chooseBlink(spec((x, y) => y === 100, 25));
    expect(to?.dist).toBe(25);
  });

  it('backs off along the aim when the far end has nowhere to stand', () => {
    // standing room only within 102..110: the point 14 cells short of the far end's reach is the first that finds it
    const to = chooseBlink(spec((x, y) => y === 100 && x >= 102 && x <= 110));
    expect(to?.x).toBe(110);
    expect(to?.dist).toBe(24);
  });

  it('refuses when there is nowhere at least 8 cells away to stand, or no clear run at all', () => {
    expect(chooseBlink(spec((x, y) => y === 100 && x >= 100 && x <= 105))).toBeNull(); // only her own platform
    expect(chooseBlink(spec(() => true, 6))).toBeNull();
    expect(chooseBlink(spec(() => false))).toBeNull();
  });
});

describe('Quicksilver Echo: the recall', () => {
  it('keeps 40% of what is left of the cooldown', () => {
    expect(E.recallKeep).toBe(0.4);
    expect(recallCooldown(420)).toBe(168);
    expect(recallCooldown(1)).toBe(1);
    expect(recallCooldown(0)).toBe(0);
    expect(recallCooldown(300, 2)).toBe(300); // never lengthens
  });

  it('thins over the last 40 ticks of the 180 and is gone at 180', () => {
    expect(echoFade(0)).toBe(1);
    expect(echoFade(140)).toBe(1);
    expect(echoFade(160)).toBeCloseTo(0.5, 9);
    expect(echoFade(179)).toBeCloseTo(1 / 40, 9);
    expect(echoFade(180)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------- Mirror Hunt

describe('Mirror Hunt: where the echoes ride', () => {
  const flat = (_x: number): number | null => 100;

  it('stands 28 cells either side of her, on the ground', () => {
    expect(echoSlot(200, 1, flat)).toEqual({ x: 228, y: 100 });
    expect(echoSlot(200, -1, flat)).toEqual({ x: 172, y: 100 });
  });

  it('comes in toward her while there is no ground out at 28, down to 8, then is not out', () => {
    const groundTo = (limit: number) => (x: number): number | null => (x <= limit ? 100 : null);
    expect(echoSlot(200, 1, groundTo(215))?.x).toBe(212); // 28, 24, 20, 16 are over the pit; 12 is not
    expect(echoSlot(200, 1, groundTo(208))?.x).toBe(208);
    expect(echoSlot(200, 1, groundTo(207))).toBeNull();
  });

  it('glides toward its slot and lands on it', () => {
    expect(approach(0, 10, 2.6)).toBeCloseTo(2.6, 9);
    expect(approach(9, 10, 2.6)).toBe(10);
    expect(approach(10, 0, 3)).toBe(7);
  });
});

describe('Mirror Hunt: what a foe believes', () => {
  it('a foe much nearer an echo than her hunts the echo, whatever the rolls', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) for (const q of [0, 0.5, 1]) {
      expect(lureChoice(40, [12, 60], [r, q, 0.5])).toBe(0);
      expect(lureChoice(40, [60, 12], [r, 0.5, q])).toBe(1);
    }
  });

  it('a foe nearer her than either echo hunts her, whatever the rolls', () => {
    for (const r of [0, 0.5, 1]) for (const q of [0, 0.5, 1]) expect(lureChoice(10, [22, 22], [r, q, q])).toBe(-1);
  });

  it('a foe that cannot tell (about equally far) is settled by the rolls, both ways', () => {
    const pick = (rReal: number, rEcho: number): number => lureChoice(20, [20, 60], [rReal, rEcho, 0.5]);
    expect(pick(0.0, 1.0)).toBe(-1); // it guessed her near and the echo far
    expect(pick(1.0, 0.0)).toBe(0); // the other way round
  });

  it('does not see an echo beyond its range, or one that is not out', () => {
    expect(lureChoice(300, [M.lureRange + 1, -1], [0.5, 0.5, 0.5])).toBe(-1);
    expect(lureChoice(300, [M.lureRange - 1, -1], [0.5, 0.5, 0.5])).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------- the kit over the real system

const W = 320, H = 160, FLOOR = 100; // the floor's top row is FLOOR + 1; the body stands at y = FLOOR

interface Rig {
  ctx: Ctx;
  sys: FighterSystem;
  step(n?: number): void;
  wall(x0: number, y0: number, x1: number, y1: number): void;
  carve(x0: number, y0: number, x1: number, y1: number): void;
  foe(x: number, extra?: Partial<Enemy>): Enemy;
  player: Ctx['player'];
  keys: { down: boolean; jump: boolean };
  sfx: string[];
  drawn(): number;
}

function rig(): Rig {
  const types = new Uint8Array(W * H);
  const life = new Uint8Array(W * H);
  const idx = (x: number, y: number): number => x + y * W;
  for (let y = FLOOR + 1; y < H; y++) for (let x = 0; x < W; x++) types[idx(x, y)] = Cell.Stone;
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const solid = (x: number, y: number): boolean => !inBounds(x, y) || blocksEntity(types[idx(x, y)]);
  const free = (cx: number, cy: number, hw: number, h: number): boolean => {
    for (let dx = -hw; dx <= hw; dx++) for (let dy = 0; dy < h; dy++) if (solid(cx + dx, cy - dy)) return false;
    return true;
  };
  const world = { width: W, height: H, types, life, inBounds, idx, replaceCellAt: (i: number, c: number): void => { types[i] = c; }, clearCellAt: (i: number): void => { types[i] = 0; } };
  const enemies: Enemy[] = [];
  const sfx: string[] = [];
  const keys = { down: false, jump: false, left: false, right: false };
  const player = {
    x: 100, y: FLOOR, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, aimAngle: 0, lastDamageSource: null as string | null,
    swinging: false, inLiquid: false, staggerT: 0, fallPeak: 0, _px: 100, _py: FLOOR, _svx: 0, status: {}, stridePhase: 0, firing: false,
  };
  const state = { mode: 'play', frameCount: 1, paused: false, reduceFlashes: false };
  const lights: unknown[] = [];
  const ctx = {
    events: new EventBus(),
    state,
    player,
    enemies,
    world,
    input: { keys, mouse: { x: 0, y: 0 } },
    fx: { hitstop: 0, screenShake: 0, bloomKick: 0 },
    levels: { current: { authoredLights: lights } },
    enemyCtl: { defs: { slime: { hp: 40, halfW: 5, h: 8, bounty: 0 } }, damage: () => undefined },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    particles: { burst: () => undefined, spawn: () => undefined },
    physics: {
      entityFree: free,
      cellBlocks: solid,
      // the engine's own mover: a cell sideways, else up a lip of at most stepUp; vertical moves are whole cells
      tryMoveEntity: (ent: { x: number; y: number }, dx: number, dy: number, hw: number, h: number, stepUp: number): boolean => {
        if (dy !== 0) { if (free(ent.x, ent.y + dy, hw, h)) { ent.y += dy; return true; } return false; }
        if (free(ent.x + dx, ent.y, hw, h)) { ent.x += dx; return true; }
        for (let s = 1; s <= stepUp; s++) if (free(ent.x + dx, ent.y - s, hw, h)) { ent.x += dx; ent.y -= s; return true; }
        return false;
      },
    },
    playerCtl: { releaseVine: () => undefined },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sys.equip('selene-wraith');
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { state.frameCount++; sys.update(ctx); } };
  step(1);
  const fill = (cell: number) => (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inBounds(x, y)) types[idx(x, y)] = cell;
  };
  return {
    ctx, sys, step, player, keys, sfx,
    wall: fill(Cell.Stone), carve: fill(0),
    foe: (x, extra = {}) => {
      const e = { x, y: FLOOR, hp: 40, maxHp: 40, kind: 'slime', vx: 0, vy: 0, bobPhase: 0, sleeping: false, ...extra } as unknown as Enemy;
      enemies.push(e);
      return e;
    },
    drawn: () => sys.drawables.length,
  };
}

describe('Quicksilver Echo on the fighter system', () => {
  it('blinks 40 cells along the aim, leaves an echo, gives 8 i-frames and runs a cooldown', () => {
    const r = rig();
    expect(r.sys.view.tactical.name).toBe('Quicksilver Echo');
    r.sys.press('tactical');
    r.step(1);
    expect(r.player.x).toBe(140);
    expect(r.player.y).toBe(FLOOR);
    expect(r.player.invuln).toBe(8);
    expect(r.drawn()).toBe(1);
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.view.tactical.active).toBeGreaterThan(0.95);
    expect(r.sfx).toContain('player.teleport');
  });

  it('Z again inside 180 ticks returns her to the echo and keeps 40% of the cooldown that remained', () => {
    const r = rig();
    r.sys.press('tactical');
    r.step(1);
    r.step(59);
    const refused = r.sys.view.tactical.refusedAt;
    const left = Math.round(r.sys.view.tactical.cooldown * E.cooldown);
    expect(left).toBe(E.cooldown - 59); // (the cast tick itself does not count)
    r.sys.press('tactical');
    r.step(1);
    expect(r.player.x).toBe(100);
    expect(r.sys.view.tactical.refusedAt).toBe(refused); // consumed, not refused
    expect(r.sys.view.tactical.active).toBe(0);
    const after = Math.round(r.sys.view.tactical.cooldown * E.cooldown);
    expect(after).toBeLessThanOrEqual(Math.ceil((left - 1) * 0.4) + 1);
    expect(after).toBeGreaterThan(Math.floor((left - 2) * 0.4) - 1);
    // and the folding rings leave, then the drawable
    r.step(30);
    expect(r.drawn()).toBe(0);
    // a further Z is the ordinary refusal
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(refused);
    expect(r.player.x).toBe(100);
  });

  it('after the 180-tick window the echo has come apart and Z is only a refusal', () => {
    const r = rig();
    r.sys.press('tactical');
    r.step(1);
    r.step(181);
    expect(r.drawn()).toBe(0);
    expect(r.sys.view.tactical.active).toBe(0);
    const refused = r.sys.view.tactical.refusedAt;
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(refused);
    expect(r.player.x).toBe(140);
  });

  it('refuses, free, with a wall at her nose or nothing to stand on', () => {
    const r = rig();
    r.wall(106, 60, 120, FLOOR);
    r.sys.press('tactical');
    r.step(1);
    expect(r.player.x).toBe(100);
    expect(r.sys.view.tactical.ready).toBe(true);
    expect(r.sys.view.tactical.usedAt).toBe(-1);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(0);
    expect(r.drawn()).toBe(0);
    const p = rig();
    p.carve(103, FLOOR + 1, 250, FLOOR + 50); // a pit beside the few cells she stands on
    p.sys.press('tactical');
    p.step(1);
    expect(p.player.x).toBe(100);
    expect(p.sys.view.tactical.ready).toBe(true);
  });

  it('stops short of a wall rather than going into it, and never lands in fire', () => {
    const r = rig();
    r.wall(125, 60, 140, FLOOR);
    r.sys.press('tactical');
    r.step(1);
    expect(r.player.x).toBeGreaterThan(108);
    expect(r.player.x + 4).toBeLessThan(125);
    const f = rig();
    for (let y = FLOOR - 20; y <= FLOOR; y++) for (let x = 130; x <= 150; x++) f.ctx.world.types[x + y * W] = Cell.Lava;
    f.sys.press('tactical');
    f.step(1);
    expect(f.player.x).toBeGreaterThan(108);
    expect(f.player.x + 4).toBeLessThan(130);
  });

  it('the echo\'s place filled with rock: the return is refused and the echo runs its time', () => {
    const r = rig();
    r.sys.press('tactical');
    r.step(1);
    r.wall(80, 60, 120, FLOOR);
    const refused = r.sys.view.tactical.refusedAt;
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(refused);
    expect(r.player.x).toBe(140);
  });

  it('a new floor wipes the echo', () => {
    const r = rig();
    r.sys.press('tactical');
    r.step(1);
    r.ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    r.step(2);
    expect(r.drawn()).toBe(0);
    expect(r.sys.view.tactical.active).toBe(0);
  });
});

describe('Mirror Hunt on the fighter system', () => {
  const start = (r: Rig): void => {
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(1);
    r.step(20);
  };
  const ask = (r: Rig, dx: number, extra: Partial<Enemy> = {}): { x: number; y: number; vx: number } | null => {
    const e = { x: r.player.x + dx, y: FLOOR, hp: 40, maxHp: 40, kind: 'slime', sleeping: false, bobPhase: 0, ...extra } as unknown as Enemy;
    const d = r.sys.decoyFor(e);
    return d ? { ...d } : null;
  };

  it('puts two echoes on the ground 28 cells either side of her', () => {
    const r = rig();
    start(r);
    expect(r.sys.view.ultimate.active).toBeGreaterThan(0.9);
    expect(r.drawn()).toBe(1);
    expect(ask(r, 28)).toEqual({ x: 128, y: FLOOR, vx: 0 });
    expect(ask(r, -28)).toEqual({ x: 72, y: FLOOR, vx: 0 });
  });

  it('a foe beside her is told about her, one beside an echo about the echo; sleepers, bosses and egg clutches about nothing', () => {
    const r = rig();
    start(r);
    expect(ask(r, 4)).toBeNull();
    expect(ask(r, 26)?.x).toBe(128);
    expect(ask(r, 26, { sleeping: true })).toBeNull();
    expect(ask(r, 26, { boss: {} as never })).toBeNull();
    expect(ask(r, 26, { kind: 'eggs' as never })).toBeNull();
  });

  it('a foe decides every 20 ticks and keeps its mind between', () => {
    const r = rig();
    start(r);
    const e = r.foe(126);
    expect(r.sys.decoyFor(e)).not.toBeNull();
    // she steps away from the echo's side: the foe does not change its mind until its 20 ticks are up...
    const first = r.sys.decoyFor(e);
    r.player.x = 190; // a cheat: the foe is now far from her, still on the echo it chose
    expect(r.sys.decoyFor(e)).toBe(first);
  });

  it('a foe that reaches an echo pops it and is held still (stunned) for 30 ticks', () => {
    const r = rig();
    start(r);
    const e = r.foe(126);
    expect(ask(r, 28)).not.toBeNull();
    r.step(2);
    expect(ask(r, 28)).toBeNull(); // popped
    expect(ask(r, -28)).not.toBeNull(); // the other stands
    expect(r.sfx).toContain('flask.shatter');
    expect((e.knockT ?? 0)).toBeGreaterThan(0);
    // 30 ticks later the stun is not renewed
    r.step(31);
    e.knockT = 0;
    r.step(2);
    expect(e.knockT ?? 0).toBe(0);
  });

  it('is over after 540 ticks: nothing is lured and the echoes leave the world', () => {
    const r = rig();
    start(r);
    r.step(M.duration);
    expect(r.sys.view.ultimate.active).toBe(0);
    expect(ask(r, 28)).toBeNull();
    r.step(M.fade + 2);
    expect(r.drawn()).toBe(0);
  });

  it('refuses with the bar short, and a new floor wipes the echoes', () => {
    const r = rig();
    r.sys.press('ultimate');
    r.step(1);
    expect(r.sys.view.ultimate.active).toBe(0);
    expect(r.drawn()).toBe(0);
    start(r);
    r.ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    r.step(2);
    expect(ask(r, 28)).toBeNull();
    expect(r.drawn()).toBe(0);
  });

  it('the echoes keep their distance as she moves, and shorten at a pit', () => {
    const r = rig();
    start(r);
    r.player.x = 140;
    r.step(30);
    expect(ask(r, 28)?.x).toBe(168);
    r.carve(176, FLOOR + 1, 260, H - 1);
    // the floor ends at 175; at 160 the echo's slot 188 is over the pit, and so are 184, 180 and 176: it stands at 172, on firm ground
    r.player.x = 160;
    r.step(30);
    expect(ask(r, 12)?.x).toBe(172);
  });
});

describe('Liquid Momentum on the fighter system', () => {
  /** Run: a tick at a sprint, then the crouch edge with the speed the player\'s own stance would have clamped it to. */
  const crouchAtSprint = (r: Rig, vx = 2.85): void => {
    r.player.vx = vx;
    r.step(1);
    r.keys.down = true;
    r.player.vx = 0.9;
    r.player.crawling = true; // the player's own stance machine has gone prone on the key edge
    r.step(1);
  };

  it('a crouch at a sprint takes the body: 45 ticks, about 71 cells, at crawl gauge, and hands it back', () => {
    const r = rig();
    crouchAtSprint(r);
    expect(r.sys.ownsMovement).toBe(true);
    const x0 = r.player.x;
    let ticks = 0;
    while (r.sys.ownsMovement && ticks < 100) { r.step(1); ticks++; }
    expect(ticks).toBeGreaterThanOrEqual(44);
    expect(ticks).toBeLessThanOrEqual(46);
    expect(r.player.x - x0).toBeGreaterThan(68);
    expect(r.player.x - x0).toBeLessThan(73);
    expect(r.player.crawling).toBe(true);
    expect(r.player.y).toBe(FLOOR);
    expect(r.player.vx).toBeGreaterThan(0.5);
  });

  it('does not start when she is only walking, or with no crouch edge', () => {
    const r = rig();
    crouchAtSprint(r, 1.5);
    expect(r.sys.ownsMovement).toBe(false);
    const q = rig();
    q.player.vx = 2.85;
    q.step(3);
    expect(q.sys.ownsMovement).toBe(false);
    const a = rig();
    a.player.grounded = false;
    crouchAtSprint(a);
    expect(a.sys.ownsMovement).toBe(false);
  });

  it('goes where a crawl goes: into a 9-cell gap', () => {
    const r = rig();
    r.wall(120, 60, 220, FLOOR - 9); // a roof leaving rows FLOOR-8 .. FLOOR: nine free
    crouchAtSprint(r);
    let ticks = 0;
    while (r.sys.ownsMovement && ticks < 100) { r.step(1); ticks++; }
    expect(r.player.x).toBeGreaterThan(150);
    expect(r.player.y).toBe(FLOOR);
    const low = rig();
    low.wall(120, 60, 220, FLOOR - 8); // eight free: too low
    crouchAtSprint(low);
    ticks = 0;
    while (low.sys.ownsMovement && ticks < 100) { low.step(1); ticks++; }
    expect(low.player.x).toBeLessThan(120);
  });

  it('stops at a wall without going into it, and at a ledge without leaving the floor', () => {
    const r = rig();
    r.wall(150, 60, 170, FLOOR);
    crouchAtSprint(r);
    let ticks = 0;
    while (r.sys.ownsMovement && ticks < 100) { r.step(1); ticks++; }
    expect(r.player.x).toBe(145);
    expect(r.player.vx).toBe(0);
    const l = rig();
    l.carve(150, FLOOR + 1, 300, H - 1);
    crouchAtSprint(l);
    ticks = 0;
    while (l.sys.ownsMovement && ticks < 100) { l.step(1); ticks++; }
    expect(l.player.x).toBeLessThanOrEqual(154);
    expect(l.player.y).toBe(FLOOR);
  });

  it('a blink in the middle of a slide takes her out of it', () => {
    const r = rig();
    crouchAtSprint(r);
    r.step(5);
    expect(r.sys.ownsMovement).toBe(true);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.ownsMovement).toBe(false);
    expect(r.drawn()).toBe(1);
  });
});
