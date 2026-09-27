import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ctx, Enemy, EnemyDamageSource, EnemyKind } from '@/core/types';
import { EventBus } from '@/core/events';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { createDefaultStatus } from '@/entities/status';
import { tickCreaturePose } from '@/creatures/pose';
import {
  addCorpse, BOWL_CREDIT_TICKS, clearCorpses, corpses, corpseWeightOn, kickCorpses, launchCorpse, SPARE_MAX, touchCorpse, updateCorpses,
} from '@/creatures/corpses';
import { corpseMass, emptySample, gripPoint, sampleBody } from '@/creatures/corpseBody';
import { bowlDamage, BOWL_MIN_SPEED, FROZEN_TICKS, HEAD_DMG_MAX } from '@/creatures/corpseWorld';
import {
  clearTelekinesis, grabCost, heldCorpse, holdDrain, hurlCost, hurlPower, hurlSpeed, leashTarget, springAccel, telekinesisHurl,
  telekinesisLift, telekinesisSetDown, throwDirection, TK, updateTelekinesis,
} from '@/combat/Telekinesis';
import { killingCause } from '@/combat/AlchemyKills';
import type { HitMemory } from '@/combat/AlchemyKills';
import { BossWard, playerBlow } from '@/core/bossWard';
import { CALLOUT_WORDS } from '@/ui/Callouts';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';

/**
 * TELEKINESIS + physical corpses: the wand's grip (leash, spring, mana, hurl),
 * the remains as projectiles (BOWLED, and the boss ward's acceptance), frost
 * and its shatter, plates, fire, splash, and the rot rules for handled bodies.
 */

function creature(kind: EnemyKind, x: number, y: number): Enemy {
  const def = ENEMY_DEFS[kind];
  return { kind, x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0, timer: 0, attackCd: 60,
    bobPhase: 0.4, grounded: true, stride: 0, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: createDefaultStatus() } as Enemy;
}

interface Stage {
  world: World;
  ctx: Ctx;
  damage: ReturnType<typeof vi.fn>;
  wand: { mana: number; frame: { manaMax: number; manaRegen: number } };
}

/** A stone floor at y=150 (open above), a minimal Ctx with an event bus, a wand and a cursor. */
function stage(w = 320, h = 200): Stage {
  const world = new World(w, h);
  for (let x = 0; x < w; x++) for (let y = 150; y < h; y++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555555);
  const damage = vi.fn((e: Enemy, amount: number) => { e.hp -= amount; });
  const wand = { mana: 90, frame: { manaMax: 90, manaRegen: 0.5 } };
  const ctx = {
    world, events: new EventBus(), state: { frameCount: 0, mode: 'play', reduceFlashes: false },
    enemyCtl: { defs: ENEMY_DEFS, damage }, enemies: [] as Enemy[],
    player: { x: 60, y: 149, vx: 0, vy: 0, dead: false, climbing: false, aimAngle: 0, perks: {} },
    input: { mouse: { x: 0, y: 0 } },
    spells: { wandTip: () => ({ x: 66, y: 139 }) },
    wands: { wands: [wand, wand], active: 0 },
    fx: { hitstop: 0, bloomKick: 0 },
  } as unknown as Ctx;
  return { world, ctx, damage, wand };
}

/** A creature posed a few ticks, killed into a corpse, and let settle. */
function corpseOf(s: Stage, kind: EnemyKind, x: number, settle = 90): Enemy {
  const e = creature(kind, x, 149);
  for (let t = 1; t <= 10; t++) { s.ctx.state.frameCount++; try { tickCreaturePose(s.ctx, e); } catch { /* minimal ctx */ } }
  expect(addCorpse(s.ctx, e, 0, 0)).toBe(true);
  step(s, settle);
  return e;
}

function step(s: Stage, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    s.ctx.state.frameCount++;
    updateTelekinesis(s.ctx);
    updateCorpses(s.ctx);
  }
}

afterEach(() => { clearTelekinesis(); clearCorpses(); });

function heldIndex(): number {
  return heldCorpse()?.grip?.index ?? -1;
}

describe('the grip (pure math)', () => {
  it('the pull follows the cursor within the leash and stops at it', () => {
    expect(leashTarget(0, 0, 30, 40, 64)).toEqual({ x: 30, y: 40 });
    const t = leashTarget(0, 0, 300, 400, 64);
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(64, 5);
    expect(t.x / t.y).toBeCloseTo(0.75, 5);
  });

  it('a heavy body is pulled more gently than a light one, the pull is capped, and it damps its own swing', () => {
    const light = springAccel(0, 0, 0, 0, 10, 0, 0.4), heavy = springAccel(0, 0, 0, 0, 10, 0, 4.5);
    expect(light.ax).toBeGreaterThan(heavy.ax);
    const far = springAccel(0, 0, 0, 0, 1000, 0, 1);
    expect(Math.hypot(far.ax, far.ay)).toBeLessThanOrEqual(TK.ACCEL_MAX + 1e-9);
    const moving = springAccel(0, 0, 2, 0, 0, 0, 1);
    expect(moving.ax).toBeLessThan(0);
  });

  it('holding costs the wand its regeneration and more for heavier bodies; the hurl too', () => {
    expect(holdDrain(1, 0.5)).toBeGreaterThan(0.5);
    expect(holdDrain(4.5, 0.5)).toBeGreaterThan(holdDrain(1, 0.5));
    expect(grabCost(2.6)).toBeGreaterThan(grabCost(1));
    expect(hurlCost(4.5)).toBeGreaterThan(hurlCost(0.4));
    expect(hurlPower(50, 10)).toBe(1);
    expect(hurlPower(5, 10)).toBeCloseTo(0.5, 6);
  });

  it('a bat flies, a golem is shoved; a short tank throws weaker', () => {
    expect(hurlSpeed(0.4, 1)).toBeGreaterThan(hurlSpeed(4.5, 1));
    expect(hurlSpeed(0.4, 1)).toBeLessThanOrEqual(TK.HURL_SPEED_MAX);
    expect(hurlSpeed(30, 1)).toBeGreaterThanOrEqual(TK.HURL_SPEED_MIN);
    expect(hurlSpeed(1, 0.5)).toBeCloseTo(hurlSpeed(1, 1) * 0.5, 6);
  });

  it("the throw is lobbed so the body's own flight lands on the cursor", () => {
    const [tx, ty, v, g, keep] = [90, 10, 6, 0.22, 0.985];
    const dir = throwDirection(tx, ty, v, g, keep);
    expect(dir.y).toBeLessThan(Math.sin(Math.atan2(ty, tx))); // aimed above the straight line
    let x = 0, y = 0, vx = dir.x * v, vy = dir.y * v, miss = Infinity;
    for (let t = 0; t < 160; t++) { vx *= keep; vy = vy * keep + g; x += vx; y += vy; miss = Math.min(miss, Math.hypot(x - tx, y - ty)); }
    expect(miss).toBeLessThan(3);
  });
});

describe('the verb, end to end', () => {
  it('E on a body under the cursor lifts it toward the cursor, draining mana; E again sets it down', () => {
    const s = stage();
    const e = corpseOf(s, 'spitter', 100);
    const rest = sampleBody(e, emptySample());
    s.ctx.input.mouse.x = rest.x; s.ctx.input.mouse.y = rest.y;
    expect(telekinesisLift(s.ctx)).toBe(true);
    expect(heldCorpse()?.e).toBe(e);
    s.ctx.input.mouse.x = 90; s.ctx.input.mouse.y = 110;
    const mana0 = s.wand.mana;
    step(s, 90);
    const up = sampleBody(e, emptySample());
    // The grip hangs at the cursor (sagging by the body's weight); the rest of it dangles below.
    const g = gripPoint(e, heldIndex(), { x: 0, y: 0, vx: 0, vy: 0 });
    expect(Math.hypot(g.x - 90, g.y - (110 + TK.SAG * corpseMass('spitter')))).toBeLessThan(10);
    expect(up.y).toBeLessThan(rest.y - 12);
    expect(s.wand.mana).toBeLessThan(mana0 - 90 * 0.5);
    expect(telekinesisSetDown(s.ctx)).toBe(true);
    expect(heldCorpse()).toBeNull();
    step(s, 120);
    expect(sampleBody(e, emptySample()).y).toBeGreaterThan(up.y + 15);
  });

  it('with the tank dry the grip fails: the body drops and the wand fizzles', () => {
    const s = stage();
    const e = corpseOf(s, 'slime', 100);
    const rest = sampleBody(e, emptySample());
    s.ctx.input.mouse.x = rest.x; s.ctx.input.mouse.y = rest.y;
    const phases: string[] = [];
    s.ctx.events.on('telekinesis', ({ phase }) => { if (phase !== 'hold') phases.push(phase); });
    expect(telekinesisLift(s.ctx)).toBe(true);
    s.wand.mana = 0.3;
    step(s, 3);
    expect(heldCorpse()).toBeNull();
    expect(phases).toContain('fizzle');
  });

  it("F hurls it at the cursor; what it strikes in the next seconds is the alchemist's (BOWLED)", () => {
    const s = stage();
    const e = corpseOf(s, 'weaver', 100);
    const victim = creature('slime', 200, 149);
    s.ctx.enemies.push(victim);
    const loco = e.weaverLoco!;
    s.ctx.input.mouse.x = loco.px; s.ctx.input.mouse.y = loco.py;
    expect(telekinesisLift(s.ctx)).toBe(true);
    s.ctx.input.mouse.x = 110; s.ctx.input.mouse.y = 100;
    step(s, 40);
    s.ctx.input.mouse.x = victim.x; s.ctx.input.mouse.y = victim.y - 4;
    expect(telekinesisHurl(s.ctx)).toBe(true);
    const c = corpses()[0];
    expect(c.bowlUntil).toBeGreaterThan(s.ctx.state.frameCount + BOWL_CREDIT_TICKS - 5);
    step(s, 80);
    const blows = s.damage.mock.calls.filter(call => call[0] === victim);
    expect(blows.length).toBe(1);
    expect(blows[0][4] as EnemyDamageSource).toBe('bowled');
    expect(blows[0][1] as number).toBeGreaterThan(20);
  });

  it('the dead Leviathan is too heavy to lift: E only nudges it (and says so)', () => {
    const s = stage(420, 200);
    const e = corpseOf(s, 'leviathan', 120, 60);
    const at = sampleBody(e, emptySample());
    s.ctx.input.mouse.x = at.x; s.ctx.input.mouse.y = at.y;
    const phases: string[] = [];
    s.ctx.events.on('telekinesis', ({ phase }) => phases.push(phase));
    expect(corpseMass('leviathan')).toBeGreaterThan(TK.REACH / 90 * 6);
    expect(telekinesisLift(s.ctx)).toBe(true);
    expect(heldCorpse()).toBeNull();
    expect(phases).toEqual(['strain']);
  });
});

describe('remains as projectiles', () => {
  it('blow damage grows with mass and speed, is capped, and a nudge is no blow', () => {
    expect(bowlDamage(1, BOWL_MIN_SPEED - 0.1)).toBe(0);
    expect(bowlDamage(2.6, 5)).toBeGreaterThan(bowlDamage(1, 5));
    expect(bowlDamage(1, 7)).toBeGreaterThan(bowlDamage(1, 4));
    expect(bowlDamage(30, 8)).toBeLessThanOrEqual(90);
  });

  it('a body falling on its own strikes as debris (FLATTENED); set moving by the alchemist, BOWLED', () => {
    for (const handled of [false, true]) {
      const s = stage();
      const e = corpseOf(s, 'spitter', 100, 60);
      const victim = creature('slime', 100, 149);
      s.ctx.enemies.push(victim);
      const c = corpses()[0];
      if (handled) touchCorpse(c, s.ctx.state.frameCount);
      // Lift it above the victim and let it drop fast.
      launchCorpse(c, 0, 0, s.ctx.state.frameCount);
      if (!handled) { c.bowlUntil = -1e9; c.touchT = -1e9; }
      for (const p of e.rig!.pts) { p.y -= 40; p.py = p.y - 4; }
      for (const ch of e.rig!.chains) for (const p of ch.pts) { p.y -= 40; p.py = p.y - 4; }
      step(s, 30);
      const blow = s.damage.mock.calls.find(call => call[0] === victim);
      expect(blow, `handled=${handled}`).toBeTruthy();
      expect(blow![4]).toBe(handled ? 'bowled' : 'flattened');
      clearCorpses();
    }
  });

  it("BOWLED is its own callout, a frozen victim bowled over SHATTERS, and the boss ward takes a bowl as the player's blow", () => {
    expect(CALLOUT_WORDS.bowled).toBe('BOWLED');
    const mem = (source: EnemyDamageSource): HitMemory => ({ source, frame: 50, touchFrame: 50, kickFrame: 50 });
    expect(killingCause(mem('bowled'), false, 50)).toBe('bowled');
    expect(killingCause(mem('bowled'), true, 50)).toBe('shattered');
    expect(playerBlow('bowled')).toBe(true);
    expect(playerBlow('flattened')).toBe(false);
    const ward = new BossWard();
    const boss = creature('colossus', 300, 150);
    expect(ward.allows(boss, 'bowled', 1000)).toBe(true);
    expect(ward.allows(boss, 'flattened', 1000)).toBe(false);
  });

  it('only a genuinely heavy body dropped on his head hurts the alchemist, and only a little', () => {
    const s = stage();
    const hurt = vi.fn();
    (s.ctx as unknown as { playerCtl: unknown }).playerCtl = { damage: hurt };
    const golem = corpseOf(s, 'golem', 60, 60);
    for (const p of golem.rig!.pts) { p.x += 0; p.y -= 45; p.py = p.y - 3; }
    step(s, 40);
    expect(hurt).toHaveBeenCalled();
    expect(hurt.mock.calls[0][0]).toBeLessThanOrEqual(HEAD_DMG_MAX);
    clearCorpses();
    hurt.mockClear();
    const slime = corpseOf(s, 'slime', 60, 60);
    for (const p of slime.rig!.soft!.pts) { p.y -= 45; p.py = p.y - 3; }
    step(s, 40);
    expect(hurt).not.toHaveBeenCalled();
  });
});

describe('the elements', () => {
  it('frost freezes the body stiff; a hard impact frozen shatters it into real ice', () => {
    const s = stage();
    const e = corpseOf(s, 'spitter', 100, 60);
    const c = corpses()[0];
    const at = sampleBody(e, emptySample());
    for (let dx = -8; dx <= 8; dx++) for (let dy = -6; dy <= -3; dy++) {
      const i = s.world.idx(Math.floor(at.x) + dx, Math.floor(at.y) + dy);
      if (s.world.types[i] === Cell.Empty) s.world.replaceCellAt(i, Cell.Nitrogen, 0xe0f8ff);
    }
    step(s, 6);
    expect(c.frozen).toBeGreaterThan(FROZEN_TICKS - 20);
    // Clear the cold away and slam it into a wall.
    for (let i = 0; i < s.world.types.length; i++) if (s.world.types[i] === Cell.Nitrogen) s.world.clearCellAt(i);
    for (let x = 180; x < 190; x++) for (let y = 60; y < 150; y++) s.world.replaceCellAt(s.world.idx(x, y), Cell.Stone, 0x555555);
    launchCorpse(c, 7, -1.5, s.ctx.state.frameCount);
    let ice0 = 0;
    for (let i = 0; i < s.world.types.length; i++) if (s.world.types[i] === Cell.Ice) ice0++;
    step(s, 40);
    expect(corpses()).toHaveLength(0);
    let ice = 0;
    for (let i = 0; i < s.world.types.length; i++) if (s.world.types[i] === Cell.Ice) ice++;
    expect(ice).toBeGreaterThan(ice0);
  });

  it('fire catches the body and it writes real flame; lying in water it goes out', () => {
    const s = stage();
    const e = corpseOf(s, 'spitter', 100, 60);
    const c = corpses()[0];
    const at = sampleBody(e, emptySample());
    for (let dx = -6; dx <= 6; dx++) for (let dy = -4; dy <= 0; dy++) {
      const i = s.world.idx(Math.floor(at.x) + dx, Math.floor(at.y) + dy);
      if (s.world.types[i] === Cell.Empty) { s.world.replaceCellAt(i, Cell.Fire, 0xff6010); s.world.life[i] = 40; }
    }
    step(s, 4);
    expect(c.burn).toBeGreaterThan(0);
    for (let i = 0; i < s.world.types.length; i++) if (s.world.types[i] === Cell.Fire) s.world.clearCellAt(i);
    step(s, 30);
    let fire = 0;
    for (let i = 0; i < s.world.types.length; i++) if (s.world.types[i] === Cell.Fire) fire++;
    expect(fire).toBeGreaterThan(0);
    expect(c.char).toBeGreaterThan(0);
    // Now drown it.
    for (let x = Math.floor(at.x) - 14; x <= Math.floor(at.x) + 14; x++) for (let y = 138; y < 150; y++) {
      const i = s.world.idx(x, y);
      if (s.world.types[i] !== Cell.Stone) s.world.replaceCellAt(i, Cell.Water, 0x2a5f8a);
    }
    step(s, 12);
    expect(c.burn).toBe(0);
  });

  it('a body belly-flopping into a pool throws real water up (and none is created)', () => {
    const s = stage();
    for (let x = 120; x < 200; x++) for (let y = 135; y < 150; y++) s.world.replaceCellAt(s.world.idx(x, y), Cell.Water, 0x2a5f8a);
    const count = (): { total: number; above: number } => {
      let total = 0, above = 0;
      for (let i = 0; i < s.world.types.length; i++) if (s.world.types[i] === Cell.Water) { total++; if (Math.floor(i / s.world.width) < 135) above++; }
      return { total, above };
    };
    const before = count();
    const moments: string[] = [];
    s.ctx.events.on('corpseMoment', ({ kind }) => moments.push(kind));
    const e = creature('golem', 160, 90);
    for (let t = 1; t <= 5; t++) { s.ctx.state.frameCount++; try { tickCreaturePose(s.ctx, e); } catch { /* */ } }
    addCorpse(s.ctx, e, 0, 0);
    const c = corpses()[0];
    launchCorpse(c, 0, 4, s.ctx.state.frameCount);
    step(s, 14);
    const after = count();
    expect(moments).toContain('splash');
    expect(after.total).toBe(before.total);
    expect(after.above).toBeGreaterThan(0);
  });
});

describe('weight, the boot, and rot', () => {
  it('a slime weighs on a plate like a creature standing on it; a bat is too light; a held body weighs nothing', () => {
    const s = stage();
    corpseOf(s, 'slime', 100, 80);
    corpseOf(s, 'bat', 200, 80);
    expect(corpseWeightOn(s.world, 90, 140, 110, 151)).toBe(4);
    expect(corpseWeightOn(s.world, 190, 140, 210, 151)).toBe(2);
    corpses()[0].grip = { index: -1, ax: 0, ay: 0, tick: 0 };
    expect(corpseWeightOn(s.world, 90, 140, 110, 151)).toBe(0);
  });

  it('the boot punts a body lying at the feet up and along the kick', () => {
    const s = stage();
    const e = corpseOf(s, 'spitter', 100, 60);
    const at = sampleBody(e, emptySample());
    const reaction = kickCorpses(s.ctx, at.x - 10, at.y - 6, 0.85, -0.53, 22, Math.cos(0.9), () => 0);
    expect(reaction).toBeGreaterThan(0);
    step(s, 12);
    const now = sampleBody(e, emptySample());
    expect(now.x).toBeGreaterThan(at.x + 30);
    expect(now.y).toBeLessThan(at.y - 15);
  });

  it('handled remains keep (bounded); the oldest untouched body melts first when there are too many', () => {
    const s = stage(600, 200);
    corpseOf(s, 'slime', 50, 5);
    const held = corpses()[0];
    held.grip = { index: -1, ax: 0, ay: 0, tick: 0 };
    const age0 = held.age;
    step(s, 200);
    expect(held.age).toBe(age0);
    held.spared = SPARE_MAX;
    step(s, 10);
    expect(held.age).toBeGreaterThan(age0);
    // Fill the list: the held one survives, the oldest untouched goes.
    held.spared = 0;
    const kinds: EnemyKind[] = ['spitter', 'spitter', 'mage', 'mage', 'rootloper', 'spitter', 'mage', 'spitter', 'mage'];
    kinds.forEach((k, i) => corpseOf(s, k, 90 + i * 50, 1));
    const firstUntouched = corpses()[1];
    corpseOf(s, 'spitter', 580, 1);
    expect(corpses()).toContain(held);
    expect(corpses()).not.toContain(firstUntouched);
    expect(corpses().length).toBe(10);
  });
});
