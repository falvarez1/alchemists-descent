import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, Projectile } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit } from '@/fighters/kits/brann-rook';
import {
  PressureVessel, TUNING, blowFromFront, blowOrigin, plateDir, segmentSectorEntry,
} from '@/fighters/kits/brann-rook-logic';
import type { Dir } from '@/fighters/kits/brann-rook-logic';
import { Cell } from '@/sim/CellType';

/**
 * Brann Rook's rules, node-only: the Pressure vessel's state machine, the plate's geometry (including a
 * brute-force check of the segment-versus-sector test), which side a blow came from, and the kit wired
 * to the real FighterSystem over a fake world (the Z-again toggle that keeps the cooldown, the frontal
 * reduction through the new reduceIncoming seam, the Pressure fed by health actually lost).
 * What it does to the real engine is probed in scripts/verify-fighter-brann.mjs.
 */

const P = TUNING.pressure;
const G = TUNING.guard;
const RIGHT: Dir = { x: 1, y: 0 };

describe('Pressure Vessel', () => {
  it('ignores a blow under the threshold and fills 2.5 per point over it, capped at 40 a blow', () => {
    const v = new PressureVessel();
    expect(v.add(5.9)).toBe(false);
    expect(v.value).toBe(0);
    expect(v.add(6)).toBe(false);
    expect(v.value).toBeCloseTo(15, 6);
    v.reset();
    v.add(12);
    expect(v.value).toBeCloseTo(30, 6);
    v.reset();
    v.add(25); // 62.5 -> capped at 40
    expect(v.value).toBe(40);
    v.reset();
    v.add(Number.NaN);
    expect(v.value).toBe(0);
  });

  it('bleeds 2 a second', () => {
    const v = new PressureVessel();
    v.add(16); // 40
    for (let i = 0; i < 60; i++) v.tick();
    expect(v.value).toBeCloseTo(38, 6);
    for (let i = 0; i < 60 * 30; i++) v.tick();
    expect(v.value).toBe(0);
  });

  it('vents at 100: resets to empty and holds 4 s of footing in which it does not fill', () => {
    const v = new PressureVessel();
    expect(v.add(16)).toBe(false); // 40
    expect(v.add(16)).toBe(false); // 80
    expect(v.add(16)).toBe(true); // 120 -> vent
    expect(v.value).toBe(0);
    expect(v.resist).toBe(P.resistTicks);
    // Struck again inside the window: nothing fills, nothing re-vents.
    expect(v.add(40)).toBe(false);
    expect(v.value).toBe(0);
    for (let i = 0; i < P.resistTicks; i++) v.tick();
    expect(v.resist).toBe(0);
    v.add(16);
    expect(v.value).toBeCloseTo(40, 6);
  });

  it('saves and loads flat finite numbers and clamps the rest', () => {
    const v = new PressureVessel();
    v.add(16);
    const bag = v.save();
    const w = new PressureVessel();
    w.load(bag);
    expect(w.value).toBeCloseTo(40, 6);
    w.load({ pressure: 9999, resist: -5 });
    expect(w.value).toBeLessThan(P.max);
    expect(w.resist).toBe(0);
    w.load({ pressure: Number.NaN, resist: 1e9 });
    expect(w.value).toBe(0);
    expect(w.resist).toBe(P.resistTicks);
  });
});

describe('the plate: where it faces', () => {
  it('faces the aim side, level for a level aim, and leans with the aim by at most 30 degrees', () => {
    expect(plateDir(0)).toEqual({ x: 1, y: 0 });
    const left = plateDir(Math.PI);
    expect(left.x).toBeCloseTo(-1, 9);
    expect(left.y).toBeCloseTo(0, 9);
    const steep = plateDir((80 * Math.PI) / 180); // up-and-right is -y in the y-down frame; +80deg is DOWN-right
    expect(Math.atan2(steep.y, steep.x)).toBeCloseTo(G.tilt, 9);
    const up = plateDir((-80 * Math.PI) / 180);
    expect(Math.atan2(up.y, up.x)).toBeCloseTo(-G.tilt, 9);
    const upLeft = plateDir((-100 * Math.PI) / 180);
    expect(upLeft.x).toBeLessThan(0);
    expect(upLeft.y).toBeCloseTo(-Math.sin(G.tilt), 9);
    // Straight up: the right side, tilted the full way.
    const straight = plateDir(-Math.PI / 2);
    expect(straight.x).toBeGreaterThan(0);
    expect(Math.hypot(straight.x, straight.y)).toBeCloseTo(1, 9);
  });
});

describe('the plate: a shot\'s path against the front arc', () => {
  const sector = (ax: number, ay: number, bx: number, by: number, dir: Dir = RIGHT) =>
    segmentSectorEntry(ax, ay, bx, by, 0, 0, dir, G.reach, G.halfArc);

  it('takes a shot that ends inside the arc, one that starts inside, and one that crosses it', () => {
    expect(sector(30, 0, 10, 0)).not.toBeNull(); // ends inside
    expect(sector(8, 0, 40, 0)).toBe(0); // already inside at the start
    expect(sector(30, 0, -30, 0)).toBeCloseTo((30 - 14) / 60, 9); // crosses: enters at the outer face
  });

  it('cannot be tunnelled by a fast shot: a 200-cell stride across the plate is still caught', () => {
    const t = sector(100, 3, -100, 3);
    expect(t).not.toBeNull();
    expect(t as number).toBeGreaterThan(0.4);
    expect(t as number).toBeLessThan(0.5);
  });

  it('lets through what passes outside the reach, outside the arc, or behind', () => {
    expect(sector(30, 0, 20, 0)).toBeNull(); // stops short of the plate
    expect(sector(30, 20, -30, 20)).toBeNull(); // passes above the reach
  });

  it('is a wedge: a shot dropping onto her from straight above, or coming from behind, is not caught', () => {
    // Straight down the x = 0 line passes the apex (the body) and sits 90 degrees off the front.
    expect(sector(0, -40, 0, -10)).toBeNull(); // above, not yet at the body
    expect(sector(-30, 0, -10, 0)).toBeNull(); // from behind
    expect(sector(-30, 0, -2, 0)).toBeNull();
    // Just inside the +65 degree edge versus just outside it, at 10 cells out.
    const inside = (64 * Math.PI) / 180, outside = (66 * Math.PI) / 180;
    expect(sector(10 * Math.cos(inside), 10 * Math.sin(inside), 11 * Math.cos(inside), 11 * Math.sin(inside))).not.toBeNull();
    expect(sector(10 * Math.cos(outside), 10 * Math.sin(outside), 11 * Math.cos(outside), 11 * Math.sin(outside))).toBeNull();
  });

  it('follows the plate\'s direction (a left-facing or tilted plate)', () => {
    const left = plateDir(Math.PI);
    expect(sector(30, 0, 10, 0, left)).toBeNull();
    expect(sector(-30, 0, -10, 0, left)).not.toBeNull();
    const tilted = plateDir((-80 * Math.PI) / 180); // leaning up 30 degrees
    // A shot from low and level reaches the +65-side edge of a plate leaning up 30: still within 65 of the axis (35 away).
    expect(sector(30, 0, 10, 0, tilted)).not.toBeNull();
    // A shot from steeply below (80 degrees down) is 110 off the axis: not caught.
    const down = (80 * Math.PI) / 180;
    expect(sector(30 * Math.cos(down), 30 * Math.sin(down), 10 * Math.cos(down), 10 * Math.sin(down), tilted)).toBeNull();
  });

  it('agrees with a brute-force walk of the segment on thousands of random paths', () => {
    // A seeded stream (no Math.random): an LCG, so the test is the same every run.
    let seed = 20260930;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const inSector = (x: number, y: number, dir: Dir): boolean => {
      const d = Math.hypot(x, y);
      if (d > G.reach) return false;
      if (d < 1e-9) return true;
      return (x * dir.x + y * dir.y) / d >= Math.cos(G.halfArc);
    };
    let caught = 0, missed = 0, disagreements = 0;
    for (let n = 0; n < 4000; n++) {
      const dir = plateDir((rnd() * 2 - 1) * Math.PI);
      const ax = (rnd() * 2 - 1) * 60, ay = (rnd() * 2 - 1) * 60;
      const reach = rnd() < 0.5 ? 6 : 80;
      const ang = rnd() * Math.PI * 2;
      const bx = ax + Math.cos(ang) * reach, by = ay + Math.sin(ang) * reach;
      const t = segmentSectorEntry(ax, ay, bx, by, 0, 0, dir, G.reach, G.halfArc);
      let brute = false;
      const steps = Math.ceil(reach / 0.02);
      for (let s = 0; s <= steps && !brute; s++) brute = inSector(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, dir);
      if (brute) caught++; else missed++;
      // A grazing path can be missed by the sampling (never the reverse): count only the real disagreements.
      if ((t !== null) !== brute) {
        if (t !== null && !brute) {
          const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
          // Entry point must sit on the sector (within a hair).
          const d = Math.hypot(px, py);
          const cosA = d < 1e-9 ? 1 : (px * dir.x + py * dir.y) / d;
          if (d <= G.reach + 0.05 && cosA >= Math.cos(G.halfArc) - 1e-3) continue;
        }
        disagreements++;
      }
    }
    expect(caught).toBeGreaterThan(200);
    expect(missed).toBeGreaterThan(200);
    expect(disagreements).toBe(0);
  });
});

describe('the plate: which side a blow came from', () => {
  it('trusts a foe in melee reach over the knock (a slime bite pushes the player toward the slime)', () => {
    // The slime stands to the right; its knock (-3.6) would read as "from the left" if believed.
    expect(blowFromFront(RIGHT, G.halfArc, { dx: 9, dy: -2 }, 3.6, -2.8)).toBe(true);
    // The rillback's knock points away from it; the foe is behind.
    expect(blowFromFront(RIGHT, G.halfArc, { dx: -9, dy: 0 }, 3.1, -1.9)).toBe(false);
    // A foe above her, out of the arc: not frontal.
    expect(blowFromFront(RIGHT, G.halfArc, { dx: 2, dy: -20 }, 1, -1)).toBe(false);
  });

  it('with no foe near, reads the knock: pushed left means struck from the right', () => {
    expect(blowFromFront(RIGHT, G.halfArc, null, -2.4, -1.8)).toBe(true);
    expect(blowFromFront(RIGHT, G.halfArc, null, 2.4, -1.8)).toBe(false);
    expect(blowFromFront({ x: -1, y: 0 }, G.halfArc, null, 2.4, -1.8)).toBe(true);
    expect(blowOrigin(null, -2, 0)).toEqual({ x: 1, y: 0 });
  });

  it('a blow with no knock (a hazard tick) or no readable direction has no front', () => {
    expect(blowFromFront(RIGHT, G.halfArc, { dx: 5, dy: 0 }, 0, 0)).toBe(false);
    expect(blowFromFront(RIGHT, G.halfArc, null, 0.01, -2)).toBe(false);
    expect(blowOrigin(null, 0, 0)).toBeNull();
    // A foe overlapping the body centre says nothing; the knock decides.
    expect(blowFromFront(RIGHT, G.halfArc, { dx: 0.2, dy: 0 }, -3, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------- the kit over the real system

interface Rig {
  ctx: Ctx;
  sys: FighterSystem;
  step(n?: number): void;
  hurt(amount: number): void;
  enemies: Enemy[];
  steamCells(): number;
  lights: unknown[];
  sfx: string[];
}

function rig(): Rig {
  const W = 200, H = 120;
  const types = new Uint8Array(W * H);
  const life = new Uint8Array(W * H);
  const world = {
    width: W, height: H, types, life,
    inBounds: (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H,
    idx: (x: number, y: number): number => x + y * W,
    replaceCellAt: (i: number, cell: number): void => { types[i] = cell; life[i] = 0; },
  };
  const enemies: Enemy[] = [];
  const lights: unknown[] = [];
  const sfx: string[] = [];
  const player = {
    x: 100, y: 100, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, aimAngle: 0, lastDamageSource: null as string | null,
  };
  const state = { mode: 'play', frameCount: 1, paused: false };
  const ctx = {
    events: new EventBus(),
    state,
    player,
    enemies,
    world,
    fx: { hitstop: 0, screenShake: 0, bloomKick: 0 },
    levels: { current: { authoredLights: lights } },
    enemyCtl: { defs: { slime: { hp: 40, halfW: 4, h: 8, bounty: 0 } }, damage: () => undefined },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    particles: { burst: () => undefined },
    physics: { tryMoveEntity: () => true, entityFree: () => true },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sys.equip('brann-rook');
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { state.frameCount++; sys.update(ctx); } };
  step(1);
  return {
    ctx, sys, step, enemies, lights, sfx,
    hurt: (amount: number) => { player.hp -= amount; },
    steamCells: () => { let n = 0; for (let i = 0; i < types.length; i++) if (types[i] === Cell.Steam) n++; return n; },
  };
}

describe('Brann\'s kit on the fighter system', () => {
  it('feeds Pressure and ultimate charge from Stock damage without losing health or counting it twice', () => {
    const r = rig();
    const charge = r.sys.view.ultimate.charge;
    r.sys.noteStockHurt(12);
    expect(r.ctx.player.hp).toBe(100);
    expect(r.sys.snapshot()?.kit.pressure).toBe(30);
    r.step();
    expect(r.sys.view.ultimate.charge).toBeGreaterThan(charge);
    expect(r.sys.view.meter?.value).toBeGreaterThan(29.5);
    expect(r.sys.view.meter?.value).toBeLessThanOrEqual(30);
  });
  it('feeds Pressure from health actually lost, and shows it through meter()', () => {
    const r = rig();
    expect(r.sys.view.meter).toEqual({ label: 'Pressure', value: 0, max: 100 });
    r.hurt(12);
    r.step(1);
    expect(r.sys.view.meter?.value).toBeGreaterThan(29.5);
    expect(r.sys.view.meter?.value).toBeLessThanOrEqual(30);
    const before = r.sys.view.meter?.value ?? 0;
    r.hurt(4); // under the threshold: no fill
    r.step(1);
    expect(r.sys.view.meter?.value).toBeLessThan(before);
    // It is saved with the run.
    expect(r.sys.snapshot()?.kit.pressure).toBeGreaterThan(25);
  });

  it('at full pressure writes a real puff of Steam cells with a life, and holds her footing 4 s', () => {
    const r = rig();
    expect(r.steamCells()).toBe(0);
    for (let i = 0; i < 3; i++) { r.hurt(16); r.step(1); }
    expect(r.steamCells()).toBeGreaterThan(40);
    expect(r.sys.staggerResist).toBe(true);
    expect(r.sys.view.meter?.value).toBe(0);
    // The cells carry a life (without one they vanish at once).
    const life = (r.ctx.world as unknown as { life: Uint8Array }).life;
    expect(life.some((n) => n > 0)).toBe(true);
    r.step(TUNING.pressure.resistTicks + 2);
    expect(r.sys.staggerResist).toBe(false);
  });

  it('Boiler Guard: raises on Z, walks at x0.75, shows as active, and Z again lowers it without refunding the cooldown', () => {
    const r = rig();
    expect(r.sys.view.tactical.ready).toBe(true);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.drawables).toHaveLength(1);
    expect(r.sys.moveScale()).toBe(0.75);
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.view.tactical.active).toBeGreaterThan(0.9);
    r.step(30);
    const cd = r.sys.view.tactical.cooldown;
    const refusedBefore = r.sys.view.tactical.refusedAt;
    expect(cd).toBeGreaterThan(0.9);
    r.sys.press('tactical'); // Z again
    r.step(1);
    expect(r.sys.drawables).toHaveLength(0);
    expect(r.sys.moveScale()).toBe(1);
    expect(r.sys.view.tactical.active).toBe(0);
    expect(r.sys.view.tactical.refusedAt).toBe(refusedBefore); // consumed, not refused
    // The cooldown kept running (not refunded, not restarted).
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.view.tactical.cooldown).toBeLessThanOrEqual(cd);
    // With the plate down and the ability cooling, another Z is an ordinary refusal.
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(refusedBefore);
    expect(r.sys.drawables).toHaveLength(0);
  });

  it('the plate drops by itself after 210 ticks and the cooldown (10 s) outlasts it', () => {
    const r = rig();
    r.sys.press('tactical');
    r.step(1);
    r.step(TUNING.guard.duration - 2);
    expect(r.sys.moveScale()).toBe(0.75);
    r.step(3);
    expect(r.sys.moveScale()).toBe(1);
    expect(r.sys.drawables).toHaveLength(0);
    expect(r.sys.view.tactical.ready).toBe(false);
    r.step(TUNING.guard.cooldown);
    expect(r.sys.view.tactical.ready).toBe(true);
  });

  it('halves melee and blasts from the front only while the plate is up (the new knock-vector seam)', () => {
    const r = rig();
    // Down: a blast from the right is taken whole.
    expect(r.sys.reduceIncoming(20, 'explosion', -2.4, -1.8)).toBe(20);
    r.sys.press('tactical');
    r.step(1);
    // Up and facing right (aim 0): from the right is halved, from the left is not, a hazard tick is not.
    expect(r.sys.reduceIncoming(20, 'explosion', -2.4, -1.8)).toBe(10);
    expect(r.sys.reduceIncoming(20, 'explosion', 2.4, -1.8)).toBe(20);
    expect(r.sys.reduceIncoming(20, 'burning')).toBe(20);
    // A slime on the right bites with the engine's inverted knock: still frontal.
    r.enemies.push({ x: 109, y: 100, hp: 40, maxHp: 40, kind: 'slime', vx: 0, vy: 0, bobPhase: 0 } as unknown as Enemy);
    expect(r.sys.reduceIncoming(12, 'slime-bite', 3.6, -2.8)).toBe(6);
    // The same slime behind her (aim left, the plate on the other side) is not.
    r.ctx.player.aimAngle = Math.PI;
    r.step(1);
    expect(r.sys.reduceIncoming(12, 'slime-bite', 3.6, -2.8)).toBe(12);
  });

  it('stacks with Redline: x0.5 from the modifier and x0.5 from the plate', () => {
    const r = rig();
    r.sys.press('tactical');
    r.step(1);
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(1);
    expect(r.sys.view.ultimate.active).toBeGreaterThan(0.9);
    expect(r.sys.reduceIncoming(20, 'explosion', -2.4, -1.8)).toBe(5);
    expect(r.sys.staggerResist).toBe(true);
  });

  it('Redline: steam puffs every 6 ticks, ends on its own, and clears its modifier and light', () => {
    const r = rig();
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(1);
    expect(r.steamCells()).toBeGreaterThan(40);
    expect(r.lights.length).toBe(1);
    expect(r.sys.reduceIncoming(20, 'x')).toBe(10);
    r.step(TUNING.redline.duration + 1);
    expect(r.sys.view.ultimate.active).toBe(0);
    expect(r.sys.reduceIncoming(20, 'x')).toBe(20);
    expect(r.sys.staggerResist).toBe(false);
    r.step(8);
    expect(r.lights.length).toBe(0);
  });

  it('a reset (a new floor) drops the plate and every effect but keeps the vessel', () => {
    const r = rig();
    r.hurt(12);
    r.step(1);
    r.sys.press('tactical');
    r.step(1);
    r.ctx.events.emit('levelChanged', undefined as never);
    expect(r.sys.drawables).toHaveLength(0);
    expect(r.sys.moveScale()).toBe(1);
    expect(r.sys.view.meter?.value).toBeGreaterThan(25);
    r.ctx.events.emit('playerRespawned', undefined as never);
    r.step(1);
    expect(r.sys.view.meter?.value).toBe(0);
  });

  it('eats nothing with the plate down and a shot that crosses the arc with it up', () => {
    const r = rig();
    const shot = (x: number, vx: number): Projectile => ({ x, y: 91, vx, vy: 0, type: 'fireball', life: 100, age: 5, charging: false, hostile: true });
    expect(r.sys.interceptProjectile(shot(120, -3))).toBe(false);
    r.sys.press('tactical');
    r.step(1);
    // The chest is at y = 91 (feet 100 - 9). A shot that moved 60 cells this tick and is now 30 past her has crossed the plate: caught.
    expect(r.sys.interceptProjectile(shot(70, -60))).toBe(true);
    expect(r.sys.interceptProjectile(shot(104, -3))).toBe(true);
    // From behind, or from far above, not.
    expect(r.sys.interceptProjectile(shot(95, 3))).toBe(false);
    expect(r.sys.interceptProjectile({ ...shot(101, 0), y: 80, vy: 4 })).toBe(false);
    // A clang is heard.
    expect(r.sfx).toContain('body.impact.metal');
  });
});
