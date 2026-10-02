import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit } from '@/fighters/kits/rusk-emberjaw';
import {
  armorStruck, boxesOverlap, burstReady, countIn, emberSpots, foeBox, FUEL, isFoeBlow, isMeleeElimination, ramColumns, recoverArmor, shoulderBox, TINDER, TUNING,
} from '@/fighters/kits/rusk-emberjaw-logic';
import { Cell, blocksEntity } from '@/sim/CellType';

/**
 * Rusk Emberjaw: the maths of her passive and her ultimate's armor window, and her kit run against the
 * real FighterSystem over a fake world (a flat grid, a one-cell-at-a-time body mover). What each ability
 * does in the real engine (cells, foes, the screen) is probed in scripts/verify-fighter-rusk.mjs.
 */

// ------------------------------------------------------------------------------------------ pure maths

describe('Rusk: the maths', () => {
  it('Scrap Recovery restores 14 and clamps at the ceiling', () => {
    expect(recoverArmor(10, 40, TUNING.scrapRestore)).toEqual({ armor: 24, gained: 14 });
    expect(recoverArmor(35, 40, 14)).toEqual({ armor: 40, gained: 5 });
    expect(recoverArmor(40, 40, 14)).toEqual({ armor: 40, gained: 0 });
    // Under Kiln Heart the ceiling is 80, so the same kill buys the full 14.
    expect(recoverArmor(70, 80, 14)).toEqual({ armor: 80, gained: 10 });
    expect(recoverArmor(20, 0, 14).gained).toBe(0); // no pool, nothing to restore
    expect(recoverArmor(20, 40, -3).gained).toBe(0);
  });

  it('the furnace answers a foe, not the world', () => {
    expect(isFoeBlow('slime-bite')).toBe(true);
    expect(isFoeBlow('golem-slam')).toBe(true);
    expect(isFoeBlow('colossus-stomp')).toBe(true);
    for (const hazard of ['fire', 'lava', 'acid', 'toxic', 'burning', 'oiled-fire', 'frostbite', 'electrocution', 'status', 'unknown']) {
      expect(isFoeBlow(hazard)).toBe(false);
    }
    expect(isFoeBlow(undefined)).toBe(false);
    expect(isFoeBlow('')).toBe(false);
  });

  it('a foe slammed dead by a wall after the ram flung it is her kill; a spell or a fire finishing it is not', () => {
    const w = TUNING.ram.slamWindow;
    expect(isMeleeElimination(true, 'direct', undefined, w)).toBe(true); // a kick, this tick
    expect(isMeleeElimination(false, 'direct', undefined, w)).toBe(false); // a spell
    expect(isMeleeElimination(false, 'impaled', 20, w)).toBe(true); // the wall the ram flung it into
    expect(isMeleeElimination(false, 'impaled', w + 1, w)).toBe(false); // long after
    expect(isMeleeElimination(false, 'impaled', undefined, w)).toBe(false); // a wall slam she did not cause
    expect(isMeleeElimination(false, 'burned', 10, w)).toBe(false); // fire finishing it
    expect(isMeleeElimination(false, 'direct', 10, w)).toBe(false); // a spell finishing it
  });

  it('notices a blow the armor swallowed, but not rounding or a refill', () => {
    expect(armorStruck(40, 30)).toBe(true);
    expect(armorStruck(40, 39.99)).toBe(false);
    expect(armorStruck(30, 40)).toBe(false);
  });

  it('vents at most once per guard window', () => {
    expect(burstReady(100, -999, TUNING.kiln.burstGuard)).toBe(true);
    expect(burstReady(110, 100, TUNING.kiln.burstGuard)).toBe(false);
    expect(burstReady(120, 100, TUNING.kiln.burstGuard)).toBe(true);
  });

  it('picks distinct open spots inside the radius, and gives up on a crowded room', () => {
    let s = 1;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const spots = emberSpots(100, 100, 11, 6, rand, () => true);
    expect(spots).toHaveLength(6);
    expect(new Set(spots.map(([x, y]) => `${x},${y}`)).size).toBe(6);
    for (const [x, y] of spots) expect(Math.hypot(x - 100, (y - 100) / 0.8)).toBeLessThanOrEqual(11.6);
    // Nowhere to put them: it returns what it found rather than looping.
    expect(emberSpots(100, 100, 11, 6, rand, () => false)).toEqual([]);
    // Only one open cell: one ember at most.
    expect(emberSpots(100, 100, 11, 6, rand, (x, y) => x === 100 && y === 100).length).toBeLessThanOrEqual(1);
  });

  it('the shoulder reaches ahead of the body in the direction of travel', () => {
    const right = shoulderBox(100, 50, 1, 4, 17, 4);
    expect(right).toEqual({ x0: 96, x1: 108, y0: 34, y1: 50 });
    const left = shoulderBox(100, 50, -1, 4, 17, 4);
    expect(left).toEqual({ x0: 92, x1: 104, y0: 34, y1: 50 });
    // A foe 6 cells ahead is in reach; one behind her, or 20 ahead, is not.
    expect(boxesOverlap(right, foeBox(106, 50, 4, 8))).toBe(true);
    expect(boxesOverlap(right, foeBox(85, 50, 4, 8))).toBe(false);
    expect(boxesOverlap(right, foeBox(125, 50, 4, 8))).toBe(false);
    // ...and one above her head is not.
    expect(boxesOverlap(right, foeBox(106, 20, 4, 8))).toBe(false);
  });

  it('breaks the columns the next step will occupy, nearest first', () => {
    expect(ramColumns(100, 1, 4, 5.5)).toEqual([105, 106, 107, 108, 109, 110, 111]);
    expect(ramColumns(100, -1, 4, 5.5)).toEqual([95, 94, 93, 92, 91, 90, 89]);
    // A step of 5.5 can carry the body 6 cells: the columns reach it (and one beyond).
    expect(ramColumns(100, 1, 4, 5.5).length).toBeGreaterThanOrEqual(Math.ceil(5.5) + 1);
  });

  it('knows tinder from plain wood, and fuel from tinder', () => {
    for (const t of [Cell.Oil, Cell.Gunpowder, Cell.MarshGas, Cell.Moss, Cell.Grass, Cell.Leaf, Cell.Vines, Cell.Fire]) expect(TINDER.has(t)).toBe(true);
    for (const t of [Cell.Wood, Cell.Stone, Cell.Metal, Cell.Empty, Cell.Water]) expect(TINDER.has(t)).toBe(false);
    for (const t of [Cell.Oil, Cell.Gunpowder, Cell.MarshGas]) expect(FUEL.has(t)).toBe(true);
    expect(FUEL.has(Cell.Moss)).toBe(false);
    const grid = (x: number, y: number) => (x === 5 && y === 5 ? Cell.Oil : x === 6 && y === 5 ? Cell.Moss : 0);
    expect(countIn(TINDER, grid, 0, 0, 10, 10)).toBe(2);
    expect(countIn(FUEL, grid, 0, 0, 10, 10)).toBe(1);
    expect(countIn(TINDER, grid, 7, 0, 10, 10)).toBe(0);
  });

  it('the ram is a nine-second charge of 44 cells with i-frames, and the spec numbers hold', () => {
    expect(TUNING.ram.cooldown).toBe(9 * 60);
    expect(TUNING.ram.ticks * TUNING.ram.speed).toBe(44);
    expect(TUNING.ram.damage).toBe(16);
    expect(TUNING.ram.stunTicks).toBe(20);
    expect(TUNING.armorMax).toBe(40);
    expect(TUNING.scrapRestore).toBe(14);
    expect(TUNING.kiln.duration).toBe(600);
    expect(TUNING.kiln.armorMax).toBe(80);
    expect(TUNING.kiln.damageTaken).toBe(0.8);
    expect(TUNING.kiln.burstDamage).toBe(6);
    expect(TUNING.kiln.burstEmbers).toBe(6);
    expect(TUNING.kiln.burstRange).toBe(20);
    expect(TUNING.kiln.burstRadius).toBe(16);
    expect(kit.tacticalCooldown).toBe(TUNING.ram.cooldown);
    expect(kit.ultimateDuration).toBe(TUNING.kiln.duration);
  });
});

// ---------------------------------------------------------------------------------- the kit, fake world

class FakeWorld {
  readonly width = 400;
  readonly height = 200;
  readonly types = new Uint8Array(400 * 200);
  readonly colors = new Uint32Array(400 * 200);
  idx(x: number, y: number): number { return x + y * this.width; }
  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  replaceCellAt(i: number, t: number, color: number): void { this.types[i] = t; this.colors[i] = color; }
  clearCellAt(i: number): void { this.types[i] = 0; this.colors[i] = 0; }
  count(t: number, x0 = 0, y0 = 0, x1 = 399, y1 = 199): number {
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.types[this.idx(x, y)] === t) n++;
    return n;
  }
  fill(x0: number, y0: number, x1: number, y1: number, t: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.replaceCellAt(this.idx(x, y), t, 0x808080);
  }
}

const FLOOR = 100; // stone from this row down; feet stand on FLOOR - 1

interface Rig {
  ctx: Ctx;
  sys: FighterSystem;
  world: FakeWorld;
  enemies: Enemy[];
  player: Ctx['player'];
  step(n?: number): void;
  strikes: Array<[number, number, number]>;
  sfx: string[];
  hits: Array<{ amount: number; kx: number; source: string }>;
}

function makeEnemy(x: number, hp = 40, kind = 'slime'): Enemy {
  return { x, y: FLOOR - 1, hp, maxHp: hp, kind, vx: 0, vy: 0, bobPhase: 0, status: { burning: 0, oiled: 0 }, knockT: 0, knockVx: 0, knockVy: 0 } as unknown as Enemy;
}

function makeRig(): Rig {
  const events = new EventBus();
  const world = new FakeWorld();
  world.fill(0, FLOOR, 399, 199, Cell.Stone);
  const enemies: Enemy[] = [];
  const strikes: Array<[number, number, number]> = [];
  const sfx: string[] = [];
  const hits: Rig['hits'] = [];
  const player = {
    x: 100, y: FLOOR - 1, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, swinging: false, lastDamageSource: null as string | null, aimAngle: 0,
    status: { burning: 0 },
  };
  const state = { mode: 'play', frameCount: 1, paused: false, reduceFlashes: false };
  const entityFree = (cx: number, cy: number, halfW: number, h: number): boolean => {
    for (let dx = -halfW; dx <= halfW; dx++) for (let dy = 0; dy < h; dy++) {
      const X = cx + dx, Y = cy - dy;
      if (!world.inBounds(X, Y)) return false;
      if (blocksEntity(world.types[world.idx(X, Y)])) return false;
    }
    return true;
  };
  // eslint-disable-next-line prefer-const
  let sysRef: FighterSystem;
  const ctx = {
    events,
    state,
    player,
    enemies,
    world,
    fx: { screenShake: 0, bloomKick: 0, hitstop: 0 },
    enemyCtl: {
      defs: { slime: { hp: 40, halfW: 4, h: 8, bounty: 0 }, imp: { hp: 30, halfW: 4, h: 10, bounty: 0 } },
      // Like the real controller: hp moves, the fighter hears of it, a dead foe leaves the list.
      damage: (e: Enemy, amount: number, kx: number, _ky: number, source = 'direct') => {
        e.hp -= amount;
        hits.push({ amount, kx, source });
        sysRef.noteEnemyHurt(e, amount, source as never, e.hp <= 0);
        if (e.hp <= 0) { const at = enemies.indexOf(e); if (at >= 0) enemies.splice(at, 1); }
      },
      gustShove: (e: Enemy, dirX: number, _dirY: number, strength: number) => { e.knockVx = dirX * strength; e.knockT = 6; },
    },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    particles: { burst: () => undefined, spawn: () => undefined },
    physics: {
      entityFree,
      cellBlocks: (x: number, y: number) => blocksEntity(world.types[world.idx(x, y)]),
      tryMoveEntity: (e: { x: number; y: number }, dx: number, dy: number, halfW: number, h: number, stepUp: number): boolean => {
        if (entityFree(e.x + dx, e.y + dy, halfW, h)) { e.x += dx; e.y += dy; return true; }
        if (dy === 0) for (let s = 1; s <= stepUp; s++) if (entityFree(e.x + dx, e.y - s, halfW, h)) { e.x += dx; e.y -= s; return true; }
        return false;
      },
    },
    mechanisms: { strike: (_c: Ctx, x: number, y: number, r: number) => { strikes.push([x, y, r]); } },
    levels: { current: { authoredLights: [] as unknown[] } },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sysRef = sys;
  (ctx as unknown as { fighters: FighterSystem }).fighters = sys;
  sys.equip('rusk-emberjaw');
  return {
    ctx, sys, world, enemies, player, strikes, sfx, hits,
    step: (n = 1) => { for (let i = 0; i < n; i++) { state.frameCount++; sys.update(ctx); } },
  };
}

describe('Rusk: Scrap Recovery', () => {
  it('starts with a full 40-point pool, set up on her first tick (the system zeroes it on equip)', () => {
    const { sys, step } = makeRig();
    expect(sys.armorMax).toBe(0); // equip zeroed it after the kit was adopted
    step(1);
    expect(sys.armorMax).toBe(40);
    expect(sys.armor).toBe(40);
    expect(sys.view.armor).toBe(40);
  });

  it('a melee elimination restores 14; a kill that is not melee restores nothing', () => {
    const { sys, enemies, ctx, step } = makeRig();
    step(1);
    sys.armor = 10;
    const a = makeEnemy(110, 5);
    enemies.push(a);
    sys.noteMelee(); // a kick lands this tick...
    ctx.enemyCtl.damage(a, 20, 1, 0); // ...and kills
    expect(sys.armor).toBe(24);
    // A spell kill: no melee note.
    const b = makeEnemy(120, 5);
    enemies.push(b);
    step(5);
    ctx.enemyCtl.damage(b, 20, 1, 0);
    expect(sys.armor).toBe(24);
    // The blow was melee but the kill landed three ticks later: not a melee elimination.
    const c = makeEnemy(130, 60);
    enemies.push(c);
    sys.noteMelee();
    ctx.enemyCtl.damage(c, 10, 1, 0);
    step(3);
    ctx.enemyCtl.damage(c, 100, 1, 0);
    expect(sys.armor).toBe(24);
  });

  it('a foe the ram flung and a wall then killed restores armor; the same foe killed by a spell does not', () => {
    const { sys, enemies, ctx, step } = makeRig();
    step(1);
    const slammed = makeEnemy(130, 40);
    const shot = makeEnemy(140, 40);
    enemies.push(slammed, shot);
    sys.press('tactical');
    step(3); // the ram lands its blow on each (16 of 40)
    sys.armor = 10;
    step(10);
    ctx.enemyCtl.damage(slammed, 99, 0, 0, 'impaled'); // the wall
    expect(sys.armor).toBe(24);
    ctx.enemyCtl.damage(shot, 99, 0, 0, 'direct'); // a spell
    expect(sys.armor).toBe(24);
  });

  it('is clamped at the ceiling, and a foe pays out once', () => {
    const { sys, enemies, ctx, step } = makeRig();
    step(1);
    sys.armor = 35;
    const a = makeEnemy(110, 5);
    enemies.push(a);
    sys.noteMelee();
    ctx.enemyCtl.damage(a, 20, 1, 0);
    expect(sys.armor).toBe(40);
    sys.armor = 10;
    sys.noteMelee();
    ctx.enemyCtl.damage(a, 20, 1, 0); // the same corpse struck again within the window
    expect(sys.armor).toBe(10);
  });

  it('armor absorbs a blow before health', () => {
    const { sys, step } = makeRig();
    step(1);
    expect(sys.reduceIncoming(10, 'slime-bite')).toBe(0);
    expect(sys.armor).toBe(30);
    expect(sys.reduceIncoming(45, 'slime-bite')).toBe(15);
    expect(sys.armor).toBe(0);
  });

  it('a respawn is a fresh start: the pool is full again', () => {
    const { sys, ctx, step } = makeRig();
    step(1);
    sys.armor = 3;
    ctx.events.emit('playerRespawned');
    expect(sys.armor).toBe(0); // the system's reset
    step(1);
    expect(sys.armor).toBe(40);
  });

  it('a saved run restores the pool it saved; it is not refilled', () => {
    const a = makeRig();
    a.step(1);
    a.sys.armor = 17;
    const snap = a.sys.snapshot();
    expect(snap?.armor).toBe(17);
    const b = makeRig();
    b.sys.restore(snap);
    b.step(2);
    expect(b.sys.armor).toBe(17);
    expect(b.sys.armorMax).toBe(40);
  });
});

describe('Rusk: Kiln Heart', () => {
  function lit(rig: Rig): void {
    rig.step(1);
    rig.sys.addCharge(1);
    rig.sys.press('ultimate');
    rig.step(1);
  }

  it('raises the ceiling to 80 and fills it, takes x0.8, and gives it all back when it ends', () => {
    const rig = makeRig();
    const { sys, step } = rig;
    step(1);
    sys.armor = 12;
    lit(rig);
    expect(sys.view.ultimate.active).toBeGreaterThan(0.9);
    expect(sys.armorMax).toBe(80);
    expect(sys.armor).toBe(80);
    sys.armor = 0;
    expect(sys.reduceIncoming(10, 'slime-bite')).toBeCloseTo(8, 5); // x0.8
    sys.addArmor(63 - sys.armor);
    expect(sys.armor).toBe(63);
    step(TUNING.kiln.duration);
    expect(sys.view.ultimate.active).toBe(0);
    expect(sys.armorMax).toBe(40);
    expect(sys.armor).toBe(40); // clamped: what she carried above the ceiling is spent
    expect(sys.reduceIncoming(10, 'slime-bite')).toBe(0); // back to the pool (full), no x0.8
    sys.armor = 0;
    expect(sys.reduceIncoming(10, 'slime-bite')).toBe(10);
  });

  it('adds a furnace light to the level and takes it away again', () => {
    const rig = makeRig();
    lit(rig);
    const lights = (rig.ctx.levels.current as unknown as { authoredLights: unknown[] }).authoredLights;
    expect(lights.length).toBeGreaterThanOrEqual(1);
    rig.step(TUNING.kiln.duration + 20);
    expect(lights.length).toBe(0);
  });

  it('banks its embers (but still scorches the foe) when she is soaked in oil, or oil is near her', () => {
    for (const how of ['oiled', 'oil near']) {
      const rig = makeRig();
      const { sys, enemies, world, player, step } = rig;
      lit(rig);
      if (how === 'oiled') (player.status as unknown as { oiled: number }).oiled = 300;
      else world.fill(106, FLOOR - 2, 107, FLOOR - 1, Cell.Oil);
      const foe = makeEnemy(112, 60);
      enemies.push(foe);
      player.lastDamageSource = 'slime-bite';
      sys.reduceIncoming(5, 'slime-bite');
      step(1);
      expect(world.count(Cell.Ember)).toBe(0);
      expect(foe.hp).toBe(54);
    }
  });

  it('a close blow vents real Ember cells and scorches the foes within reach (even when the armor swallows it)', () => {
    const rig = makeRig();
    const { sys, enemies, world, player, ctx, step } = rig;
    lit(rig);
    const near = makeEnemy(112, 60);
    const far = makeEnemy(128, 60); // within 20 of her, outside 16 of her chest
    enemies.push(near, far);
    const embers = world.count(Cell.Ember);
    player.lastDamageSource = 'slime-bite';
    expect(sys.reduceIncoming(5, 'slime-bite')).toBe(0); // armor eats it: no health lost
    step(1);
    expect(world.count(Cell.Ember) - embers).toBeGreaterThanOrEqual(3);
    expect(world.count(Cell.Ember) - embers).toBeLessThanOrEqual(TUNING.kiln.burstEmbers);
    expect(near.hp).toBe(54); // 6
    expect(near.status.burning).toBeGreaterThanOrEqual(TUNING.kiln.burnTicks);
    expect(far.hp).toBe(60);
    expect(far.status.burning).toBe(0);
    // The guard: a second blow inside the window does not vent again.
    const before = near.hp;
    player.lastDamageSource = 'slime-bite';
    sys.reduceIncoming(5, 'slime-bite');
    step(1);
    expect(near.hp).toBe(before);
    // After the guard it may.
    step(TUNING.kiln.burstGuard);
    sys.reduceIncoming(5, 'slime-bite');
    step(1);
    expect(near.hp).toBeLessThan(before);
    expect(ctx.fx.screenShake).toBeGreaterThan(0);
  });

  it('is not provoked by a hazard, by a foe too far away, or when she is not burning', () => {
    const rig = makeRig();
    const { sys, enemies, world, player, step } = rig;
    // Not lit: a close foe, a blow: nothing.
    step(1);
    const e = makeEnemy(112, 60);
    enemies.push(e);
    player.lastDamageSource = 'slime-bite';
    sys.reduceIncoming(5, 'slime-bite');
    step(1);
    expect(e.hp).toBe(60);
    expect(world.count(Cell.Ember)).toBe(0);
    lit(rig);
    // A hazard (fire) beside a foe.
    player.lastDamageSource = 'fire';
    sys.reduceIncoming(5, 'fire');
    step(1);
    expect(e.hp).toBe(60);
    // A foe too far to have bitten her.
    enemies.length = 0;
    const far = makeEnemy(160, 60);
    enemies.push(far);
    step(30);
    player.lastDamageSource = 'slime-bite';
    sys.reduceIncoming(5, 'slime-bite');
    step(1);
    expect(far.hp).toBe(60);
    expect(world.count(Cell.Ember)).toBe(0);
  });

  it('a fireproof foe takes the blow and does not catch fire', () => {
    const rig = makeRig();
    const { sys, enemies, player, step } = rig;
    lit(rig);
    const imp = makeEnemy(112, 60, 'imp');
    enemies.push(imp);
    player.lastDamageSource = 'imp-bolt';
    sys.reduceIncoming(5, 'imp-bolt');
    step(1);
    expect(imp.hp).toBe(54);
    expect(imp.status.burning).toBe(0);
  });

  it('the ceiling change is not mistaken for a blow when it ends', () => {
    const rig = makeRig();
    const { sys, enemies, world, step } = rig;
    lit(rig);
    enemies.push(makeEnemy(112, 60));
    sys.armor = 80;
    step(TUNING.kiln.duration + 5); // the pool falls 80 -> 40 as the heart cools: not a hit
    expect(world.count(Cell.Ember)).toBe(0);
    expect(enemies[0].hp).toBe(60);
  });
});

describe('Rusk: Shoulder Ram', () => {
  function charge(rig: Rig): void {
    rig.step(1);
    rig.sys.press('tactical');
    rig.step(1);
  }

  it('charges 44 cells in 8 ticks with i-frames, then runs a nine-second cooldown', () => {
    const rig = makeRig();
    const { sys, player, step } = rig;
    charge(rig);
    expect(sys.ownsMovement).toBe(true);
    expect(player.invuln).toBeGreaterThan(0);
    step(8);
    expect(sys.ownsMovement).toBe(false);
    expect(player.x - 100).toBeGreaterThanOrEqual(42);
    expect(player.x - 100).toBeLessThanOrEqual(46);
    expect(sys.view.tactical.ready).toBe(false);
    expect(sys.view.tactical.cooldownSeconds).toBe(9);
    // Pressed while cooling: refused, no second charge.
    sys.press('tactical');
    step(1);
    expect(sys.ownsMovement).toBe(false);
    step(540);
    expect(sys.view.tactical.ready).toBe(true);
  });

  it('breaks the Wood in her path (Ember and cleared), strikes once, and leaves the rows well above her head', () => {
    const rig = makeRig();
    const { world, strikes, step } = rig;
    world.fill(120, FLOOR - 30, 129, FLOOR - 1, Cell.Wood);
    charge(rig);
    step(9);
    expect(world.count(Cell.Wood, 120, FLOOR - 23, 129, FLOOR - 1)).toBe(0); // her height + 6
    expect(world.count(Cell.Ember, 112, FLOOR - 30, 140, FLOOR)).toBeGreaterThan(10);
    expect(world.count(Cell.Wood, 120, FLOOR - 30, 129, FLOOR - 24)).toBeGreaterThan(0);
    expect(strikes.length).toBe(1);
    expect(rig.player.x).toBeGreaterThan(130);
  });

  it('writes no Ember into a wall that has tinder in it (the Intake barricade is caulked with moss)', () => {
    const rig = makeRig();
    const { world, step } = rig;
    world.fill(120, FLOOR - 30, 129, FLOOR - 1, Cell.Wood);
    world.fill(120, FLOOR - 10, 129, FLOOR - 10, Cell.Moss); // a caulked seam
    world.fill(124, FLOOR - 15, 124, FLOOR - 14, Cell.Oil); // a pocket of oil in the core
    charge(rig);
    step(9);
    expect(world.count(Cell.Wood, 120, FLOOR - 23, 129, FLOOR - 1)).toBe(0); // the timber still goes
    expect(world.count(Cell.Ember)).toBe(0); // ...without a spark to light the rest
    expect(rig.player.x).toBeGreaterThan(130);
  });

  it('steps up a sill in the middle of a charge and is not stopped by a plank in the headroom it gains', () => {
    const rig = makeRig();
    const { world, player, step } = rig;
    world.fill(112, FLOOR - 2, 113, FLOOR - 1, Cell.Metal); // a 2-cell sill
    world.fill(120, FLOOR - 40, 129, FLOOR - 1, Cell.Wood);
    charge(rig);
    step(9);
    expect(player.x).toBeGreaterThan(130);
    expect(world.count(Cell.Wood, 120, FLOOR - 23, 129, FLOOR - 3)).toBe(0);
  });

  it('runs over a gap at her own height: it is a charge, not a fall, and it still runs its eight ticks', () => {
    const rig = makeRig();
    const { world, player, sys, step } = rig;
    for (let y = FLOOR; y < FLOOR + 12; y++) for (let x = 106; x < 126; x++) world.clearCellAt(world.idx(x, y));
    charge(rig);
    let ticks = 0;
    while (sys.ownsMovement && ticks < 20) { step(1); ticks++; }
    expect(ticks).toBeGreaterThanOrEqual(7);
    expect(ticks).toBeLessThanOrEqual(9);
    expect(player.x - 100).toBeGreaterThanOrEqual(42);
    expect(player.y).toBe(FLOOR - 1);
  });

  it('a Metal wall stops her: no hole, a thump, a strike, a rebound', () => {
    const rig = makeRig();
    const { world, player, sfx, strikes, step, ctx } = rig;
    world.fill(120, FLOOR - 30, 125, FLOOR - 1, Cell.Metal);
    charge(rig);
    step(9);
    expect(world.count(Cell.Metal, 120, FLOOR - 30, 125, FLOOR - 1)).toBe(6 * 30);
    expect(player.x).toBeLessThanOrEqual(115);
    expect(rig.sys.ownsMovement).toBe(false);
    expect(sfx).toContain('body.impact.metal');
    expect(ctx.fx.screenShake).toBeGreaterThan(0);
    expect(strikes.length).toBe(1);
    expect(player.vx).toBeLessThanOrEqual(0.01);
  });

  it('is refused flush against stone (no cooldown spent) but allowed flush against wood', () => {
    const stone = makeRig();
    stone.world.fill(105, FLOOR - 30, 112, FLOOR - 1, Cell.Stone);
    stone.step(1);
    stone.sys.press('tactical');
    stone.step(1);
    expect(stone.sys.ownsMovement).toBe(false);
    expect(stone.sys.view.tactical.ready).toBe(true);
    expect(stone.sys.view.tactical.usedAt).toBe(-1);
    const wood = makeRig();
    wood.world.fill(105, FLOOR - 30, 112, FLOOR - 1, Cell.Wood);
    wood.step(1);
    wood.sys.press('tactical');
    wood.step(1);
    expect(wood.sys.ownsMovement).toBe(true);
  });

  it('hurts a foe for 16 once, flings it, then stuns it; a kill is a melee kill and restores armor', () => {
    const rig = makeRig();
    const { sys, enemies, hits, step } = rig;
    step(1);
    sys.armor = 10;
    const foe = makeEnemy(120, 100);
    const weak = makeEnemy(130, 10);
    enemies.push(foe, weak);
    sys.press('tactical');
    step(1);
    step(3);
    expect(hits.filter((h) => h.amount === 16).length).toBe(2); // one blow each, never twice
    expect(foe.hp).toBe(84);
    expect(enemies.includes(weak)).toBe(false);
    expect(sys.armor).toBe(24); // the kill: +14
    expect(foe.knockVx).toBeGreaterThan(0); // flung along her way
    // The stun waits for the shove, then holds it (for 20 ticks).
    foe.knockT = 0;
    step(10);
    foe.knockT = 0;
    step(1);
    expect(sys.isRevealed(foe)).toBe(false);
    step(1);
    expect(foe.knockT).toBeGreaterThanOrEqual(1);
    expect(foe.knockVx).toBe(0);
  });

  it('the shoulder does not reach through rock: a foe on the far side of a wall is spared', () => {
    const behind = makeRig();
    behind.world.fill(106, FLOOR - 30, 108, FLOOR - 1, Cell.Stone);
    const sheltered = makeEnemy(111, 100);
    behind.enemies.push(sheltered);
    behind.step(1);
    behind.sys.press('tactical');
    behind.step(10);
    expect(sheltered.hp).toBe(100);
    const open = makeRig();
    const exposed = makeEnemy(111, 100);
    open.enemies.push(exposed);
    open.step(1);
    open.sys.press('tactical');
    open.step(4);
    expect(exposed.hp).toBe(84);
  });

  it('does not stun a warded boss', () => {
    const rig = makeRig();
    const { sys, enemies, step } = rig;
    step(1);
    (rig.ctx.enemyCtl.defs as Record<string, unknown>).colossus = { hp: 500, halfW: 8, h: 30, bounty: 0 };
    const boss = makeEnemy(118, 500, 'colossus');
    enemies.push(boss);
    sys.press('tactical');
    step(14);
    expect(boss.hp).toBe(484);
    boss.knockT = 0;
    step(30);
    expect(boss.knockT).toBe(0); // never pinned
  });

  it('charges the ultimate from the blow (16 damage x the charge rate)', () => {
    const rig = makeRig();
    const { sys, enemies, step } = rig;
    step(1);
    const before = sys.view.ultimate.charge;
    enemies.push(makeEnemy(120, 100));
    sys.press('tactical');
    step(4);
    expect(sys.view.ultimate.charge).toBeGreaterThan(before + 16 * 0.0015 - 0.001);
  });

  it('a cooldown does not stop Kiln Heart, and Kiln Heart does not reset the cooldown', () => {
    const rig = makeRig();
    const { sys, step } = rig;
    charge(rig);
    step(8);
    expect(sys.view.tactical.ready).toBe(false);
    sys.addCharge(1);
    sys.press('ultimate');
    step(1);
    expect(sys.view.ultimate.active).toBeGreaterThan(0.9);
    expect(sys.view.tactical.ready).toBe(false);
    expect(sys.view.tactical.cooldownSeconds).toBeGreaterThanOrEqual(8);
  });

  it('cancelled by a floor change: the charge ends, the armor stays', () => {
    const rig = makeRig();
    const { sys, ctx, step } = rig;
    charge(rig);
    expect(sys.ownsMovement).toBe(true);
    sys.armor = 22;
    ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    expect(sys.ownsMovement).toBe(false);
    step(2);
    expect(sys.armor).toBe(22);
  });
});
