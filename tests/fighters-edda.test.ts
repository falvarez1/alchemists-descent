import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Projectile } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit } from '@/fighters/kits/edda-morrow';
import {
  StoredLight, TUNING, allyTargets, chooseAlly, fragmentOffset, healed, newShardPose, overshieldGain, refract, shardPose,
  windowLook, within,
} from '@/fighters/kits/edda-morrow-logic';
import type { AllyBody, Refraction, ShardPose } from '@/fighters/kits/edda-morrow-logic';

/**
 * Edda Morrow's rules, node-only: what counts as a use of a consumable, who the shard can go to and where it
 * is on its flight and in its orbit, how the window looks as it ages, and the refraction (a property run over
 * thousands of shots: speed kept, never heading inward, turned exactly once), then the kit on the real
 * FighterSystem over a fake world. What it does to the real engine (a real drink, a real hit, a real fast
 * shot) is probed in scripts/verify-fighter-edda.mjs.
 */

const S = TUNING.stored;
const M = TUNING.shard;
const W = TUNING.window;

describe('Stored Light: what counts as a use', () => {
  it('a drink is a session of sips (one use), however long X is held', () => {
    const s = new StoredLight();
    expect(s.sip(100)).toBe(true); // the first sip opens the drink
    s.spent(100);
    for (let t = 101; t < 400; t++) expect(s.sip(t)).toBe(false); // the same drink, still being swallowed
  });

  it('a second drink inside the glass\'s rest earns nothing, one after it does', () => {
    const s = new StoredLight();
    expect(s.sip(100)).toBe(true);
    s.spent(100);
    // A new drink (a gap in the sips longer than the session) but too soon after the grant.
    expect(s.sip(100 + S.sessionGap + 5)).toBe(false);
    expect(s.sip(100 + S.flaskCooldown + S.sessionGap + 10)).toBe(true);
  });

  it('a drink that was not granted (the pool was full) does not spend the glass', () => {
    const s = new StoredLight();
    expect(s.sip(10)).toBe(true);
    // (no spent(): the kit found no room) a drink well after may still grant
    expect(s.sip(10 + S.sessionGap + 2)).toBe(true);
  });

  it('is clean after a reset', () => {
    const s = new StoredLight();
    s.sip(5); s.spent(5);
    s.reset();
    expect(s.sip(6)).toBe(true);
  });

  it('overshieldGain never exceeds the room, and a bad number is no room', () => {
    expect(overshieldGain(0, 30, 12)).toBe(12);
    expect(overshieldGain(24, 30, 12)).toBe(6);
    expect(overshieldGain(30, 30, 12)).toBe(0);
    expect(overshieldGain(45, 30, 12)).toBe(0);
    expect(overshieldGain(Number.NaN, 30, 12)).toBe(12);
  });
});

describe('Mercy Shard: who it goes to', () => {
  const me: AllyBody = { id: 'self', self: true, x: 100, y: 100 };
  const peer = (id: string, x: number, y: number): AllyBody => ({ id, self: false, x, y });

  it('solo, the only ally is herself', () => {
    const ctx = { player: { x: 50, y: 80, crawling: false } } as unknown as Ctx;
    const list = allyTargets(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].self).toBe(true);
    expect(list[0].y).toBe(71); // the chest
    expect(chooseAlly(list, 50, 71, 0)).toBe(list[0]);
    expect(chooseAlly([], 0, 0, 0)).toBeNull();
  });

  it('with peers: the one nearest the aim line within range and cone, else herself', () => {
    const a = peer('a', 180, 100), b = peer('b', 160, 60), c = peer('c', 400, 100), d = peer('d', 20, 100);
    expect(chooseAlly([me, a, b], 100, 100, 0)?.id).toBe('a'); // aiming right: a is dead on
    expect(chooseAlly([me, a, b], 100, 100, -Math.atan2(40, 60))?.id).toBe('b'); // aiming up-right: b is on the line
    expect(chooseAlly([me, c], 100, 100, 0)?.id).toBe('self'); // out of range
    expect(chooseAlly([me, d], 100, 100, 0)?.id).toBe('self'); // behind her, outside the cone
    expect(chooseAlly([me, d], 100, 100, Math.PI)?.id).toBe('d'); // aiming left at it
  });
});

describe('Mercy Shard: its flight and its orbit', () => {
  const chestX = 200, chestY = 90;
  const pose = (age: number, aim = 0, out: ShardPose = newShardPose()): ShardPose => shardPose(age, chestX, chestY, chestX, chestY, true, aim, out);
  const dist = (p: ShardPose): number => Math.hypot(p.x - chestX, p.y - chestY);

  it('is sent out along the aim, well past the orbit, and comes back', () => {
    let far = 0, farAt = 0;
    for (let a = 0; a <= M.flightTicks; a++) {
      const d = dist(pose(a));
      if (d > far) { far = d; farAt = a; }
    }
    expect(far).toBeGreaterThan(M.excursion * 0.8);
    expect(farAt).toBeGreaterThan(5);
    expect(farAt).toBeLessThan(M.flightTicks - 5);
    // The out-leg heads along the aim (aim right: x grows first).
    expect(pose(Math.round(farAt)).x).toBeGreaterThan(chestX + 10);
    // And goes up when aimed up.
    expect(pose(farAt, -Math.PI / 2).y).toBeLessThan(chestY - 10);
  });

  it('settles into an ellipse about her chest and stays on it', () => {
    for (let a = M.flightTicks; a < M.duration; a += 3) {
      const p = pose(a);
      const dx = (p.x - chestX) / M.orbitRx, dy = (p.y - chestY) / M.orbitRy;
      const r = Math.hypot(dx, dy);
      expect(r).toBeGreaterThan(0.7);
      expect(r).toBeLessThan(1.4);
      expect(p.settle).toBe(1);
    }
  });

  it('turns steadily round the orbit (a full circuit in about 84 ticks)', () => {
    const a0 = Math.atan2(pose(M.flightTicks).y - chestY, pose(M.flightTicks).x - chestX);
    const a1 = Math.atan2(pose(M.flightTicks + 20).y - chestY, pose(M.flightTicks + 20).x - chestX);
    expect(Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)))).toBeGreaterThan(0.8);
  });

  it('is continuous: it never jumps more than a few cells in a tick', () => {
    let prev = pose(0);
    for (let a = 1; a <= M.duration; a++) {
      const p = pose(a);
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(4.2);
      prev = { ...p };
    }
  });

  it('spins down as it settles (the tumble stops)', () => {
    expect(Math.abs(pose(0).rot)).toBeGreaterThan(8);
    expect(Math.abs(pose(M.flightTicks).rot)).toBeLessThan(0.6);
  });

  it('carried to a peer it lands on them and orbits THEM', () => {
    const tx = 320, ty = 60;
    const p0 = shardPose(0, chestX, chestY, tx, ty, false, 0);
    expect(Math.hypot(p0.x - chestX, p0.y - chestY)).toBeLessThan(M.orbitRx + 1);
    const p = shardPose(M.flightTicks + 30, chestX, chestY, tx, ty, false, 0);
    expect(Math.hypot((p.x - tx) / M.orbitRx, (p.y - ty) / M.orbitRy)).toBeGreaterThan(0.7);
    expect(Math.hypot((p.x - tx) / M.orbitRx, (p.y - ty) / M.orbitRy)).toBeLessThan(1.4);
  });
});

describe('Rose Window: how it looks as it ages', () => {
  it('unfolds over its first ticks, holds, dims, cracks, in that order', () => {
    const look = windowLook(0, W.duration, 0, true);
    expect(look.scale).toBe(0);
    expect(windowLook(W.riseTicks + 5, W.duration, 0, true).scale).toBe(1);
    expect(windowLook(300, W.duration, 0, true).glow).toBe(1);
    expect(windowLook(300, W.duration, 0, true).crack).toBe(0);
    const dim = windowLook(W.duration - 40, W.duration, 0, true);
    expect(dim.glow).toBeLessThan(0.8);
    expect(dim.glow).toBeGreaterThan(0.3);
    const end = windowLook(W.duration - 1, W.duration, 0, true);
    expect(end.glow).toBeLessThan(0.35);
    expect(end.crack).toBeGreaterThan(0.9);
    expect(windowLook(W.duration - W.crackTicks - 2, W.duration, 0, true).crack).toBe(0);
  });

  it('flickers while it dims unless flashes are reduced', () => {
    const a = windowLook(W.duration - 30, W.duration, 1, false).glow;
    const b = windowLook(W.duration - 30, W.duration, 7, false).glow;
    expect(a).not.toBeCloseTo(b, 3);
    expect(windowLook(W.duration - 30, W.duration, 1, true).glow).toBe(windowLook(W.duration - 30, W.duration, 7, true).glow);
  });

  it('its pieces fly out and fall', () => {
    const o = { x: 0, y: 0 };
    fragmentOffset(2, 0, o);
    expect(o.x).toBe(0); expect(o.y).toBe(0);
    fragmentOffset(2, W.breakTicks, o);
    const ox = o.x, upperY = o.y;
    fragmentOffset(2, W.breakTicks - 8, o);
    expect(upperY).toBeGreaterThan(o.y); // an upper pane thrown up is coming back down by the end
    fragmentOffset(6, W.breakTicks, o);
    expect(o.y).toBeGreaterThan(20); // a lower pane has fallen
    expect(Math.sign(o.x)).not.toBe(Math.sign(ox)); // the far side flies the other way
  });
});

describe('Rose Window: healing', () => {
  it('heals 4 hp a second and never past the ceiling', () => {
    let hp = 50;
    for (let i = 0; i < 60; i++) hp = healed(hp, 100, W.healPerSecond);
    expect(hp).toBeCloseTo(54, 6);
    expect(healed(99.99, 100, 4)).toBe(100);
    expect(healed(100, 100, 4)).toBe(100);
    expect(healed(120, 100, 4)).toBe(120); // never lowers
    expect(healed(Number.NaN, 100, 4)).toBeNaN(); // a bad number is left as it was
    expect(healed(50, 100, 0)).toBe(50);
  });

  it('within 60 cells', () => {
    expect(within(59.9, 0, 0, 0, W.radius)).toBe(true);
    expect(within(60, 0, 0, 0, W.radius)).toBe(true);
    expect(within(60.1, 0, 0, 0, W.radius)).toBe(false);
    expect(within(40, 45, 0, 0, W.radius)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------- the refraction

describe('Rose Window: refraction', () => {
  const out: Refraction = { vx: 0, vy: 0, turned: 0 };
  const COS_MAX = Math.cos(W.maxTurn);

  it('turns a shot flying into the prism away from it and keeps its speed', () => {
    // Shot to the right of the prism flying left (dead on): scattered, outward, same speed.
    expect(refract(-3, 0, 1, 0, 1, out)).toBe(true);
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(3, 9);
    expect(out.vx).toBeGreaterThan(0); // away from the prism (which is to the left)
    expect(Math.abs(Math.atan2(out.vy, out.vx))).toBeGreaterThanOrEqual(W.minScatter - 1e-9);
    expect(Math.abs(Math.atan2(out.vy, out.vx))).toBeLessThanOrEqual(W.maxTurn + 1e-9);
  });

  it('leans the side it was already leaning to', () => {
    // A shot to the right of the prism, flying left and a little down (+y): it leaves heading down-right.
    expect(refract(-3, 0.6, 1, 0, 1, out)).toBe(true);
    expect(out.vy).toBeGreaterThan(0);
    expect(refract(-3, -0.6, 1, 0, 1, out)).toBe(true);
    expect(out.vy).toBeLessThan(0);
  });

  it('a dead-on shot takes the side it is given', () => {
    refract(-3, 0, 1, 0, 1, out);
    const up = out.vy;
    refract(-3, 0, 1, 0, -1, out);
    expect(Math.sign(out.vy)).toBe(-Math.sign(up));
  });

  it('bends a grazing shot out rather than letting it skim the glass', () => {
    // At the top of the prism (outward = up, -y) flying sideways across it: it is bent up by maxTurn off the normal at most
    expect(refract(-3, 0, 0, -1, 1, out)).toBe(true);
    const along = (out.vx * 0 + out.vy * -1) / 3;
    expect(along).toBeGreaterThan(0.4);
    expect(along).toBeCloseTo(COS_MAX, 6);
  });

  it('leaves a shot that is already leaving alone', () => {
    expect(refract(3, 0, 1, 0, 1, out)).toBe(false);
    expect(refract(1, 0.5, 1, 0, 1, out)).toBe(false);
    expect(refract(0, 0, 1, 0, 1, out)).toBe(false);
    expect(refract(Number.NaN, 1, 1, 0, 1, out)).toBe(false);
  });

  it('property: any shot, any approach: speed kept, ends leaving, and turning twice does nothing', () => {
    let seed = 12345;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let turned = 0;
    for (let i = 0; i < 6000; i++) {
      const ang = rnd() * Math.PI * 2;
      const rx = Math.cos(ang), ry = Math.sin(ang);
      const speed = 0.05 + rnd() * 60;
      const h = rnd() * Math.PI * 2;
      const vx = Math.cos(h) * speed, vy = Math.sin(h) * speed;
      const tie = rnd() < 0.5 ? 1 : -1;
      if (!refract(vx, vy, rx, ry, tie, out)) {
        // not turned: it must already have been leaving
        expect((vx * rx + vy * ry) / speed).toBeGreaterThanOrEqual(W.leaving - 1e-9);
        continue;
      }
      turned++;
      expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(speed, 6);
      const along = (out.vx * rx + out.vy * ry) / speed;
      expect(along).toBeGreaterThanOrEqual(COS_MAX - 1e-9); // leaving, within maxTurn of straight out
      expect(along).toBeLessThanOrEqual(Math.cos(W.minScatter) + 1e-9); // and never straight back along the line it came
      expect(out.turned).toBeGreaterThan(0);
      const nvx = out.vx, nvy = out.vy;
      expect(refract(nvx, nvy, rx, ry, tie, out)).toBe(false); // once
    }
    expect(turned).toBeGreaterThan(2000);
  });

  it('a shot striding 45 cells a tick, sub-stepped at <= 1 cell as the engine does, is turned at the radius and never gets in', () => {
    const R = W.radius;
    for (const startY of [0, 20, -35, 55]) {
      let x = 260, y = startY, vx = -45, vy = 0;
      let minD = Infinity;
      let turns = 0;
      for (let tick = 0; tick < 12; tick++) {
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy))));
        for (let s = 0; s < steps; s++) {
          x += vx / steps; y += vy / steps;
          const d = Math.hypot(x, y);
          minD = Math.min(minD, d);
          if (d <= R && refract(vx, vy, x / d, y / d, 1, out)) { vx = out.vx; vy = out.vy; turns++; }
        }
      }
      expect(turns).toBe(1);
      expect(minD).toBeGreaterThan(R - 1.01);
    }
  });
});

// ---------------------------------------------------------------------------------------- the kit over the real system

interface Rig {
  ctx: Ctx;
  sys: FighterSystem;
  step(n?: number): void;
  hurt(amount: number): void;
  sfx: string[];
  lights: unknown[];
  player: { x: number; y: number; hp: number; maxHp: number; aimAngle: number };
  shot(x: number, y: number, vx: number, vy: number): Projectile;
}

function rig(): Rig {
  const sfx: string[] = [];
  const lights: unknown[] = [];
  const world = { width: 400, height: 200 };
  const player = {
    x: 100, y: 100, fx: 0, fy: 0, vx: 0, vy: 0, hp: 60, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, aimAngle: 0, lastDamageSource: null as string | null,
  };
  const state = { mode: 'play', frameCount: 1000, paused: false, reduceFlashes: false };
  const ctx = {
    events: new EventBus(),
    state,
    player,
    enemies: [],
    world,
    fx: { hitstop: 0, screenShake: 0, bloomKick: 0 },
    levels: { current: { authoredLights: lights } },
    enemyCtl: { defs: {}, damage: () => undefined },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    particles: { burst: () => undefined, spawn: () => undefined },
    sparks: { burst: () => undefined },
    // the floor is the row under y 100
    physics: { tryMoveEntity: () => true, entityFree: (_x: number, y: number) => y < 101 },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sys.equip('edda-morrow');
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { state.frameCount++; sys.update(ctx); } };
  step(2);
  return {
    ctx, sys, step, sfx, lights, player,
    hurt: (amount: number) => { player.hp -= amount; },
    shot: (x, y, vx, vy) => ({ x, y, vx, vy, type: 'fireball', life: 300, age: 5, charging: false, hostile: true }),
  };
}

const drink = (r: Rig, material: number | null = 2, amount = 2): void => { r.ctx.events.emit('flaskUsed', { verb: 'drink', material, amount }); };

describe('Stored Light on the fighter system', () => {
  it('carries a pool of 30 that starts empty', () => {
    const r = rig();
    expect(r.sys.view.armorMax).toBe(30);
    expect(r.sys.view.armor).toBe(0);
  });

  it('a held drink is ONE use: +12, once, with a gold glint and a callout', () => {
    const r = rig();
    const said: string[] = [];
    r.ctx.events.on('combatCallout', (c) => said.push(c.text));
    let flashed = 0;
    for (let t = 0; t < 40; t++) { drink(r); r.step(1); flashed = Math.max(flashed, r.lights.length); }
    expect(r.sys.view.armor).toBe(12);
    expect(said.filter((s) => s.includes('+12'))).toHaveLength(1);
    expect(r.sfx).toContain('pickup.bell');
    expect(flashed).toBeGreaterThan(0); // the flash of gold light
  });

  it('another drink after a rest grants another 12, capped at the pool (12, 24, 30, then nothing)', () => {
    const r = rig();
    const run = (): void => {
      for (let t = 0; t < 4; t++) { drink(r); r.step(1); }
      r.step(S.flaskCooldown + S.sessionGap + 5);
    };
    run(); expect(r.sys.view.armor).toBe(12);
    run(); expect(r.sys.view.armor).toBe(24);
    run(); expect(r.sys.view.armor).toBe(30);
    run(); expect(r.sys.view.armor).toBe(30);
  });

  it('a second drink straight after the first earns nothing', () => {
    const r = rig();
    for (let t = 0; t < 4; t++) { drink(r); r.step(1); }
    r.step(S.sessionGap + 4);
    for (let t = 0; t < 4; t++) { drink(r); r.step(1); }
    expect(r.sys.view.armor).toBe(12);
  });

  it('a potion off the floor (no material) is a use every time', () => {
    const r = rig();
    drink(r, null, 1); r.step(1);
    drink(r, null, 1); r.step(1);
    expect(r.sys.view.armor).toBe(24);
  });

  it('siphoning, pouring and throwing are not uses', () => {
    const r = rig();
    for (const verb of ['siphon', 'pour', 'throw'] as const) r.ctx.events.emit('flaskUsed', { verb, material: 2, amount: 30 });
    r.step(2);
    expect(r.sys.view.armor).toBe(0);
  });

  it('absorbs damage before health, and does not come back by itself', () => {
    const r = rig();
    for (let t = 0; t < 3; t++) { drink(r); r.step(1); }
    expect(r.sys.reduceIncoming(7, 'probe')).toBe(0);
    expect(r.sys.armor).toBe(5);
    expect(r.sys.reduceIncoming(20, 'probe')).toBe(15);
    expect(r.sys.armor).toBe(0);
    r.step(600);
    expect(r.sys.armor).toBe(0);
  });

  it('stops listening when she is put down, and listens once when re-equipped (no doubled grants)', () => {
    const r = rig();
    r.sys.equip(null);
    drink(r); r.step(2);
    expect(r.sys.view.armor).toBe(0);
    r.sys.equip('edda-morrow'); r.step(2);
    r.sys.equip('edda-morrow'); r.step(2);
    for (let t = 0; t < 3; t++) { drink(r); r.step(1); }
    expect(r.sys.view.armor).toBe(12);
  });

  it('a respawn empties the pool without ringing like a blow', () => {
    const r = rig();
    for (let t = 0; t < 3; t++) { drink(r); r.step(1); }
    r.sfx.length = 0;
    r.ctx.events.emit('playerRespawned');
    r.step(3);
    expect(r.sys.view.armor).toBe(0);
    expect(r.sfx).not.toContain('mat.shatter');
    expect(r.sfx).not.toContain('pickup.bell');
  });

  it('is restored from a run save, and a save from some other ceiling cannot overfill her', () => {
    const r = rig();
    const save = (armor: number) => ({ v: 1 as const, id: 'edda-morrow' as const, tacticalCooldown: 0, ultimateCooldown: 0, charge: 0, armor, kit: {} });
    r.sys.restore(save(20));
    r.step(1);
    expect(r.sys.view.armor).toBe(20);
    r.sys.restore(save(999));
    r.step(1);
    expect(r.sys.view.armor).toBe(30);
    r.sys.restore(save(Number.NaN));
    r.step(1);
    expect(r.sys.view.armor).toBe(0);
  });

  it('a pool carried over a floor change stays (it is saved with the run)', () => {
    const r = rig();
    for (let t = 0; t < 3; t++) { drink(r); r.step(1); }
    r.ctx.events.emit('levelChanged', undefined as never);
    r.step(2);
    expect(r.sys.view.armor).toBe(12);
    const snap = r.sys.snapshot();
    expect(snap?.armor).toBe(12);
  });
});

describe('Mercy Shard on the fighter system', () => {
  it('Z sends it: x0.6 incoming for 6 s, the chip is active, the shard is drawn', () => {
    const r = rig();
    expect(r.sys.reduceIncoming(20, 'probe')).toBe(20);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.active).toBeGreaterThan(0.95);
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.reduceIncoming(20, 'probe')).toBeCloseTo(12, 9);
    expect(r.sys.drawables).toHaveLength(2);
    r.step(M.duration - 20);
    expect(r.sys.reduceIncoming(20, 'probe')).toBeCloseTo(12, 9);
    r.step(25);
    expect(r.sys.reduceIncoming(20, 'probe')).toBe(20);
    expect(r.sys.view.tactical.active).toBe(0);
    expect(r.sys.drawables).toHaveLength(0);
  });

  it('cooldown 12 s: refused while it cools, ready after', () => {
    const r = rig();
    r.sys.press('tactical'); r.step(1);
    const refused = r.sys.view.tactical.refusedAt;
    r.step(M.duration + 10);
    r.sys.press('tactical'); r.step(1);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(refused);
    expect(r.sys.drawables).toHaveLength(0);
    r.step(M.cooldown);
    expect(r.sys.view.tactical.ready).toBe(true);
  });

  it('stacks with the pool: the shard first (x0.6), then the armor', () => {
    const r = rig();
    for (let t = 0; t < 3; t++) { drink(r); r.step(1); }
    r.sys.press('tactical'); r.step(1);
    expect(r.sys.reduceIncoming(20, 'probe')).toBe(0); // 12 under the shard, 12 of armor
    expect(r.sys.armor).toBe(0);
  });

  it('a reset (a death, a new floor) takes the shard and its protection away at once', () => {
    const r = rig();
    r.sys.press('tactical'); r.step(3);
    r.sys.reset();
    expect(r.sys.reduceIncoming(20, 'probe')).toBe(20);
    expect(r.sys.drawables).toHaveLength(0);
  });
});

describe('Rose Window on the fighter system', () => {
  const T = (r: Rig): void => { r.sys.refill(); r.sys.press('ultimate'); r.step(1); };

  it('refused with the bar empty; with it full it stands: drawable, light, bar spent', () => {
    const r = rig();
    r.sys.press('ultimate'); r.step(1);
    expect(r.sys.view.ultimate.active).toBe(0);
    T(r);
    expect(r.sys.view.ultimate.active).toBeGreaterThan(0.95);
    expect(r.sys.drawables).toHaveLength(1);
    expect(r.lights.length).toBeGreaterThanOrEqual(1);
  });

  it('heals 4 hp a second within 60 cells, none beyond, never past max', () => {
    const r = rig();
    T(r);
    const hp0 = r.player.hp;
    r.step(60);
    expect(r.player.hp - hp0).toBeCloseTo(4, 1);
    r.player.x += 70; r.player.hp = 50;
    r.step(60);
    expect(r.player.hp).toBe(50);
    r.player.x -= 70; r.player.hp = 99.99;
    r.step(5);
    expect(r.player.hp).toBe(100);
  });

  it('turns a hostile shot inside its radius (not consumed), leaves one outside, and is idempotent', () => {
    const r = rig();
    T(r);
    const near = r.shot(100 + 50, 90, -3, 0);
    const speed = Math.hypot(near.vx, near.vy);
    expect(r.sys.interceptProjectile(near)).toBe(false);
    expect(near.vx).toBeGreaterThan(0);
    expect(Math.hypot(near.vx, near.vy)).toBeCloseTo(speed, 9);
    const { vx, vy } = near;
    expect(r.sys.interceptProjectile(near)).toBe(false);
    expect(near.vx).toBe(vx); expect(near.vy).toBe(vy);
    const far = r.shot(100 + 80, 90, -3, 0);
    r.sys.interceptProjectile(far);
    expect(far.vx).toBe(-3);
  });

  it('runs its 600 ticks, shatters (a glass cue, pieces fall for 48 ticks), then is gone with its light', () => {
    const r = rig();
    T(r);
    expect(r.sys.drawables).toHaveLength(1);
    r.step(W.duration - 3);
    expect(r.sys.view.ultimate.active).toBeGreaterThan(0);
    r.step(6);
    expect(r.sys.view.ultimate.active).toBe(0);
    expect(r.sfx).toContain('flask.shatter');
    expect(r.sys.drawables).toHaveLength(1); // the pieces are still falling
    // no longer heals or turns
    r.player.hp = 50;
    r.step(4);
    expect(r.player.hp).toBe(50);
    const late = r.shot(110, 90, -3, 0);
    r.sys.interceptProjectile(late);
    expect(late.vx).toBe(-3);
    r.step(W.breakTicks + 4);
    expect(r.sys.drawables).toHaveLength(0);
  });

  it('a reset in the middle (death, new floor) removes the window and its refraction at once', () => {
    const r = rig();
    T(r);
    r.step(30);
    r.sys.reset();
    expect(r.sys.drawables).toHaveLength(0);
    const s = r.shot(110, 90, -3, 0);
    r.sys.interceptProjectile(s);
    expect(s.vx).toBe(-3);
    // and no glass cue for a window that was taken away rather than broken
    expect(r.sfx).not.toContain('flask.shatter');
  });
});
