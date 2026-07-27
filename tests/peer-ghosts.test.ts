import { describe, expect, it } from 'vitest';

import { PeerGhosts } from '@/entities/PeerGhosts';
import type { PeerGhostPose } from '@/core/types';

/**
 * Interpolation is the whole risk of ghost co-presence: a phantom that
 * stutters or rubber-bands makes streamed movement feel dead, which is exactly
 * the question stage 3 exists to answer. These pin the behaviour that produces
 * smooth motion, without needing a browser.
 */

const pose = (over: Partial<PeerGhostPose> = {}): PeerGhostPose => ({
  x: 0,
  y: 0,
  facing: 1,
  vx: 0,
  vy: 0,
  stride: 0,
  aim: 0,
  flags: 0,
  ...over,
});

/** Ghosts render 120ms behind the newest sample; helper keeps tests honest about that. */
const DELAY = 120;

describe('PeerGhosts', () => {
  it('tracks and forgets peers', () => {
    const ghosts = new PeerGhosts();
    expect(ghosts.count).toBe(0);
    ghosts.note('a', pose(), 1000);
    ghosts.note('b', pose(), 1000);
    expect(ghosts.count).toBe(2);
    ghosts.drop('a');
    expect(ghosts.count).toBe(1);
    ghosts.clear();
    expect(ghosts.count).toBe(0);
  });

  it('interpolates between two samples rather than snapping', () => {
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose({ x: 0 }), 1000);
    ghosts.note('a', pose({ x: 100 }), 1200);
    // Render time 1100 sits halfway between the samples.
    const out = ghosts.sample(1100 + DELAY);
    expect(out).toHaveLength(1);
    expect(out[0].pose.x).toBeCloseTo(50, 1);
  });

  it('produces monotonic motion across a run of samples', () => {
    // The real failure mode is not "wrong position" but "jerky position", so
    // assert the shape of the whole path, not one point on it.
    const ghosts = new PeerGhosts();
    for (let k = 0; k <= 5; k++) ghosts.note('a', pose({ x: k * 20 }), 1000 + k * 100);
    let previous = -Infinity;
    for (let t = 1000; t <= 1500; t += 25) {
      const out = ghosts.sample(t + DELAY);
      const x = out[0].pose.x;
      expect(x).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = x;
    }
    expect(previous).toBeCloseTo(100, 0);
  });

  it('does not blend discrete state into impossible values', () => {
    // A wizard cannot face 0.4 of the way left, and a flag cannot be half set.
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose({ facing: 1, flags: 0b001 }), 1000);
    ghosts.note('a', pose({ facing: -1, flags: 0b110 }), 1200);
    for (let t = 1000; t <= 1200; t += 20) {
      const p = ghosts.sample(t + DELAY)[0].pose;
      expect([1, -1]).toContain(p.facing);
      expect([0b001, 0b110]).toContain(p.flags);
    }
  });

  it('holds a lone sample instead of coasting off it', () => {
    // Poses publish ON CHANGE, so one sample then silence means "moved here,
    // then stopped". Extrapolating would walk the phantom away from where the
    // peer actually is, and snap it back on the next sample.
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose({ x: 10, vx: 5 }), 1000);
    expect(ghosts.sample(1000 + DELAY + 200)[0].pose.x).toBe(10);
  });

  it('coasts through jitter, but only briefly', () => {
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose({ x: 0, vx: 1 }), 1000);
    ghosts.note('a', pose({ x: 10, vx: 1 }), 1100);
    // Just past the newest sample: a late packet should not stall the phantom.
    const coasting = ghosts.sample(1100 + DELAY + 40)[0].pose.x;
    expect(coasting).toBeGreaterThan(10);
    // Far past it: capped, so a peer that stopped does not sail off-screen.
    const settled = ghosts.sample(1100 + DELAY + 900)[0].pose.x;
    expect(settled).toBeLessThan(20);
    // And it does not keep creeping once the cap is reached.
    expect(ghosts.sample(1100 + DELAY + 1100)[0].pose.x).toBeCloseTo(settled, 6);
  });

  it('snaps instead of sliding across a teleport', () => {
    // A respawn or level change must not drag the phantom through the level.
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose({ x: 10 }), 1000);
    ghosts.note('a', pose({ x: 900 }), 1100);
    const p = ghosts.sample(1050 + DELAY)[0].pose;
    expect(p.x).toBe(900);
  });

  it('keeps a motionless peer fully visible — silence is not absence', () => {
    // Poses publish ON CHANGE, so a peer who simply stands still sends nothing.
    // Expiring them quickly would blink a motionless teammate out of existence.
    // The room roster is what reports a departure; `AuthorLink` clears phantoms
    // when the peer count hits zero.
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose(), 1000);
    expect(ghosts.sample(1000)[0].alpha).toBe(1);
    for (const silence of [2_000, 5_000, 15_000]) {
      const still = ghosts.sample(1000 + silence);
      expect(still, `vanished after ${silence}ms of standing still`).toHaveLength(1);
      expect(still[0].alpha).toBe(1);
    }
  });

  it('eventually forgets a peer that vanished without the roster noticing', () => {
    // The long timeout is a safety net, not the primary mechanism — but it has
    // to actually fire, and leave nothing behind.
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose(), 1000);
    const fading = ghosts.sample(1000 + 27_000)[0];
    expect(fading.alpha).toBeGreaterThan(0);
    expect(fading.alpha).toBeLessThan(1);
    expect(ghosts.sample(1000 + 40_000)).toHaveLength(0);
    expect(ghosts.count).toBe(0);
  });

  it('takes the short way around when aim crosses the pi boundary', () => {
    // Blending 3.0 -> -3.0 the long way spins the staff a full turn.
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose({ aim: 3.0 }), 1000);
    ghosts.note('a', pose({ aim: -3.0 }), 1200);
    const p = ghosts.sample(1100 + DELAY)[0].pose;
    expect(Math.abs(p.aim)).toBeGreaterThan(3.0);
  });

  it('reuses its output array without leaking stale ghosts', () => {
    // The renderer calls this every frame; it must not allocate, and it must
    // not report a peer that has been dropped.
    const ghosts = new PeerGhosts();
    ghosts.note('a', pose(), 1000);
    ghosts.note('b', pose(), 1000);
    const first = ghosts.sample(1000);
    expect(first).toHaveLength(2);
    ghosts.drop('b');
    const second = ghosts.sample(1000);
    expect(second).toHaveLength(1);
    expect(second).toBe(first);
  });
});
