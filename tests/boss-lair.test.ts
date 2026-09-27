import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, EnemyDef } from '@/core/types';
import { ensureCreatureMind } from '@/creatures/perception';
import type { CreatureMind } from '@/creatures/types';
import { BOSS_LAIRS, type BossLair, Enemies, ENEMY_DEFS } from '@/entities/Enemies';
import { createDefaultStatus } from '@/entities/status';
import { World } from '@/sim/World';

interface LairHarness {
  ctx: Ctx;
  enemies: Enemies;
  callouts: string[];
  watch(e: Enemy): void;
  tick(): void;
}

function harness(opts: { reduceCameraShake?: boolean } = {}): LairHarness {
  const events = new EventBus();
  const callouts: string[] = [];
  events.on('combatCallout', ({ text }) => callouts.push(text));
  const ctx = {
    events,
    world: new World(400, 200),
    state: { mode: 'play', frameCount: 1000, worldSeed: 3, reduceFlashes: false, reduceCameraShake: opts.reduceCameraShake === true },
    player: { x: 0, y: 150, vx: 0, dead: false },
    enemies: [] as Enemy[],
    camera: { x: 0, y: 0, cineDx: 0, cineDy: 0, cineZoom: 1 },
    fx: { bloomKick: 0, screenShake: 0, hitstop: 0 },
    particles: { spawn: () => undefined, burst: () => undefined },
    audio: new Proxy({}, { get: (_t, key) => (key === 'at' ? (_x: number, _y: number, fn: () => void) => fn() : () => undefined) }),
  } as unknown as Ctx;
  const enemies = new Enemies(ctx);
  const priv = enemies as unknown as {
    watchLair(e: Enemy, def: EnemyDef, lair: BossLair, mind: CreatureMind): void;
    tickEntrance(): void;
  };
  return {
    ctx,
    enemies,
    callouts,
    watch(e: Enemy) {
      const lair = BOSS_LAIRS[e.kind];
      if (!lair) throw new Error('not a boss');
      priv.watchLair(e, ENEMY_DEFS[e.kind], lair, ensureCreatureMind(e, 3));
    },
    tick() {
      ctx.state.frameCount++;
      priv.tickEntrance();
    },
  };
}

function boss(kind: 'colossus' | 'leviathan', x: number, y: number): Enemy {
  const def = ENEMY_DEFS[kind];
  return {
    kind, x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0, timer: 0, attackCd: 0,
    bobPhase: 0.3, grounded: true, stride: 0, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: createDefaultStatus(),
  };
}

describe('boss lairs', () => {
  it('an idle alchemist anywhere in the Kiln wakes the Colossus, facing or not', () => {
    const h = harness();
    const c = boss('colossus', 200, 150);
    h.ctx.enemies.push(c);
    const mind = ensureCreatureMind(c, 3);
    mind.facing = 1; // looking the other way
    h.ctx.player.x = 200 - 48; // 48 cells behind it, standing still, open air between
    h.ctx.player.y = 150;
    h.watch(c);
    expect(c.alerted).toBe(true);
    expect(mind.confidence).toBe(1);
    expect(mind.targetX).toBe(152);
    // it holds its fire through its entrance
    expect(c.attackCd).toBeGreaterThan(60);
  });

  it('does not wake for an alchemist outside the lair (a parallel cave, far away)', () => {
    const h = harness();
    const c = boss('colossus', 200, 150);
    h.ctx.enemies.push(c);
    h.ctx.player.x = 200 + 90;
    h.watch(c);
    h.ctx.player.x = 200;
    h.ctx.player.y = 150 - 80; // a cave above the kiln's roof
    h.watch(c);
    expect(c.alerted ?? false).toBe(false);
    expect(h.callouts).toHaveLength(0);
  });

  it('the Kiln entrance: its name card, a lean toward it, then the camera handed back', () => {
    const h = harness();
    const c = boss('colossus', 200, 150);
    h.ctx.enemies.push(c);
    h.ctx.player.x = 150;
    h.watch(c);
    let leaned = 0;
    for (let t = 0; t < 200; t++) {
      h.tick();
      leaned = Math.max(leaned, h.ctx.camera.cineDx ?? 0);
    }
    expect(h.callouts).toEqual(['THE KILN COLOSSUS']);
    expect(leaned).toBeGreaterThan(10); // toward the colossus (it is to the right)
    expect(h.ctx.camera.cineDx).toBe(0);
    expect(h.ctx.camera.cineDy).toBe(0);
    expect(h.ctx.camera.cineZoom).toBe(1);
    // once per creature: a second visit to the lair is not a second entrance
    h.watch(c);
    for (let t = 0; t < 30; t++) h.tick();
    expect(h.callouts).toHaveLength(1);
  });

  it('honours the camera-shake setting: no lean, but the name card still rises', () => {
    const h = harness({ reduceCameraShake: true });
    const c = boss('colossus', 200, 150);
    h.ctx.enemies.push(c);
    h.ctx.player.x = 150;
    h.watch(c);
    for (let t = 0; t < 200; t++) {
      h.tick();
      expect(h.ctx.camera.cineDx).toBe(0);
      expect(h.ctx.camera.cineZoom).toBe(1);
    }
    expect(h.callouts).toEqual(['THE KILN COLOSSUS']);
  });

  it('the Sunken Leviathan wakes in its Sump and names itself', () => {
    const h = harness();
    const l = boss('leviathan', 200, 150);
    h.ctx.enemies.push(l);
    h.ctx.player.x = 240;
    h.ctx.player.y = 140; // on the shore above the basin
    h.watch(l);
    expect(l.alerted).toBe(true);
    expect(h.callouts).toEqual(['THE SUNKEN LEVIATHAN']);
  });
});
