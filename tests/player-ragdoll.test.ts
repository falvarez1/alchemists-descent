import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { createPlayer } from '@/entities/Player';
import { RigidBodies } from '@/entities/RigidBodies';
import { initRapier } from '@/entities/rapierInit';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { WIDTH, HEIGHT } from '@/config/constants';
import { ragdollPoint } from '@/render/sprites/PlayerRagdollSprite';

beforeAll(async () => { await initRapier(); });
function fixture() {
  const world = new World(WIDTH, HEIGHT), player = createPlayer();
  for (let y = 130; y < 145; y++) for (let x = 0; x < world.width; x++) world.replaceCellAt(world.idx(x, y), Cell.Metal, 0);
  player.x = 100; player.y = 85; player.vx = 2; player.vy = 2; player.dead = true;
  const ctx = { world, player, enemies: [], debug: { active: false }, input: { mouse: { x: 0, y: 0 }, siphonHeld: false },
    state: { mode: 'play', frameCount: 0 }, fx: { digBeam: null, screenShake: 0 },
    events: { on: () => () => undefined, emit: vi.fn() }, audio: { landThud: vi.fn(), noiseBurst: vi.fn(), tone: vi.fn(), bubble: vi.fn() },
    particles: { spawn: vi.fn(), burst: vi.fn() },
  } as unknown as Ctx;
  const bodies = new RigidBodies(ctx); ctx.rigidBodies = bodies;
  return { ctx, bodies };
}

describe('Articulated player death', () => {
  it('preserves impact momentum and keeps joints together through a terrain landing', () => {
    const { ctx, bodies } = fixture(), root = bodies.spawnPlayerRagdoll(ctx.player), rig = bodies.playerRagdoll!;
    expect(bodies.bodies).toHaveLength(11); expect(rig.joints).toHaveLength(9); expect(root.vy).toBeGreaterThan(0);
    let largestGap = 0, peak = '';
    for (let frame = 0; frame < 300; frame++) {
      ctx.state.frameCount++; bodies.update(ctx);
      for (const joint of rig.joints) {
        const a = ragdollPoint(rig.parts[joint.a], joint.anchorA.x, joint.anchorA.y);
        const b = ragdollPoint(rig.parts[joint.b], joint.anchorB.x, joint.anchorB.y);
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (gap > largestGap) { largestGap = gap; peak = JSON.stringify({ frame, joint: [joint.a, joint.b], a, b }); }
      }
    }
    expect(largestGap, peak).toBeLessThan(1);
    expect(root.y).toBeLessThan(132); expect(root.x).toBeGreaterThan(110);
    expect(Object.values(rig.parts).every(b => Number.isFinite(b.x + b.y + b.angle))).toBe(true);
    expect(Math.hypot(rig.parts.hat.x - rig.parts.head.x, rig.parts.hat.y - rig.parts.head.y)).toBeGreaterThan(3);
    bodies.remove(root); expect(bodies.bodies).toHaveLength(0); expect(bodies.playerRagdoll).toBeNull();
    bodies.dispose();
  });

  it('clears all corpse parts on level reset and interpolates the shortest rotation', () => {
    const { ctx, bodies } = fixture(); bodies.spawnPlayerRagdoll(ctx.player);
    const head = bodies.playerRagdoll!.parts.head;
    head.previousAngle = Math.PI - .1; head.angle = -Math.PI + .1;
    const mid = ragdollPoint(head, 0, -2, .5);
    expect(mid.y).toBeCloseTo(head.y + 2);
    bodies.clear(); expect(bodies.bodies).toHaveLength(0); expect(bodies.playerCorpse).toBeNull(); expect(bodies.playerRagdoll).toBeNull();
    bodies.dispose();
  });
});
