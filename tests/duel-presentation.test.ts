import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx, PlayerState } from '@/core/types';
import type { LightField } from '@/render/pixels';
import { DuelRuntime } from '@/game/DuelRuntime';
import { World } from '@/sim/World';
import { createCellPatch } from '@/authoring/cellPatch';
import { TICK_MS } from '@/net/duel/timeline';
import type { DuelSnapshot } from '@/net/duel/snapshot';
import { snapshotFixture } from './fixtures/duelSnapshot';

beforeAll(() => vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined }));
afterAll(() => vi.unstubAllGlobals());

/** A replica runtime over the smallest context its playback touches. The guest controls slot 1. */
function replica() {
  const players = [0, 1].map(() => ({ x: 0, y: 0 }) as PlayerState);
  const sfx = vi.fn(), emit = vi.fn();
  const ctx = {
    world: new World(100, 100),
    state: { frameCount: 0 },
    duel: { slot: 1 },
    arena: { active: true, bundle: (slot: number) => ({ player: players[slot], fighters: { applyPresentation: vi.fn() } }) },
    camera: { x: 0, y: 0, tx: 0, ty: 0, zoom: 1, viewScale: 1 },
    projectiles: [],
    particles: { applyPresentation: vi.fn() },
    lightning: { arcs: [] },
    levels: { current: null },
    fx: { bloomKick: 0, screenShake: 0 },
    audio: { sfx },
    events: { emit, on: () => () => undefined },
  } as unknown as Ctx;
  const runtime = new DuelRuntime(ctx, {} as LightField, () => ({}) as HTMLCanvasElement, async () => true);
  let seq = 0;
  /** Host tick `tick`: both fighters walk two cells a tick; the camera follows. */
  const frame = (tick: number, edit?: (s: DuelSnapshot) => void): DuelSnapshot => {
    const s = snapshotFixture();
    s.seq = ++seq; s.base = seq - 1; s.baseline = seq === 1; s.tick = tick;
    s.fighters.forEach((f) => { f.player.x = 100 + tick * 2; f.player.y = 80; });
    s.camera.x = tick * 2;
    edit?.(s);
    return s;
  };
  const receive = (s: DuelSnapshot, at: number, cells = createCellPatch()) => expect(runtime.receive(s, cells, at)).toBe(true);
  return { runtime, ctx, players, frame, receive, sfx, emit };
}

describe('Duel replica playback', () => {
  it('plays evenly spaced host ticks back evenly at display rate though they arrive in bunches', () => {
    const { runtime, players, frame, receive } = replica();
    const display = 1000 / 120;
    const steps: number[] = [];
    let tick = 1, last = Number.NaN;
    for (let now = 0; now < 2000; now += display) {
      // Frames are sent every tick and arrive in pairs every other tick (a jittery link), 3 ms in transit.
      while (tick * TICK_MS + 3 + (tick % 2 === 1 ? TICK_MS : 0) <= now) { receive(frame(tick), now); tick++; }
      runtime.present(now);
      if (now > 500) steps.push(players[0].x - last);
      last = players[0].x;
    }
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    // Two cells per tick is one cell per 120 Hz frame: every frame moves, and by about the same amount.
    expect(mean).toBeCloseTo(1, 1);
    expect(Math.min(...steps)).toBeGreaterThan(0.6);
    expect(Math.max(...steps)).toBeLessThan(1.4);
  });

  it('keeps the controlled fighter nearer the newest frame than the world, which absorbs the jitter', () => {
    const { runtime, players, frame, receive } = replica();
    let tick = 1, ownLag = 0, worldLag = 0, samples = 0;
    for (let now = 0; now < 3000; now += 1000 / 120) {
      // Every tenth frame is 40 ms late, and holds up the frames behind it (an ordered stream); the rest take 3 ms.
      while (tick * TICK_MS + 3 + (tick % 10 === 0 ? 40 : 0) <= now) { receive(frame(tick), now); tick++; }
      runtime.present(now);
      if (now < 1000) continue;
      const { newest, world, own } = runtime.playback();
      ownLag += newest!.tick - own; worldLag += newest!.tick - world; samples++;
      expect(own).toBeGreaterThanOrEqual(world);
      expect(players[1].x).toBeGreaterThanOrEqual(players[0].x); // the own fighter is drawn further along the same walk
    }
    expect(ownLag / samples).toBeLessThan(2);
    expect(ownLag / samples).toBeLessThan(worldLag / samples - 0.5);
  });

  it('snaps an opponent who respawned or teleported instead of sliding it across the stage', () => {
    const { runtime, players, frame, receive } = replica();
    receive(frame(1), 0);
    receive(frame(2, (s) => { s.fighters[0].player.x = 900; }), TICK_MS);
    for (let now = 0; now <= 4 * TICK_MS; now += 4) {
      runtime.present(now);
      expect([102, 900]).toContain(players[0].x);
    }
  });

  it('applies every terrain delta in order, even when a hidden tab catches up all at once', () => {
    const { runtime, ctx, frame, receive, sfx } = replica();
    for (let tick = 1; tick <= 300; tick++) {
      const cells = createCellPatch();
      cells.idxs.push(tick); cells.types.push(3); cells.colors.push(tick); cells.life.push(0); cells.charge.push(0);
      receive(frame(tick, (s) => { s.sounds = [{ id: 'ui.click' }]; }), tick * TICK_MS, cells);
    }
    runtime.present(301 * TICK_MS);
    for (let i = 1; i <= 300; i++) expect([ctx.world.types[i], ctx.world.colors[i]]).toEqual([3, i]);
    // Hundreds of stale frames do not each play their sound: only the last few do.
    expect(sfx.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('shows the controlled slot from its own playhead and the match and the opponent from the world', () => {
    const { runtime, frame, receive } = replica();
    receive(frame(1, (s) => { s.arena.slots[1].recovering = false; s.arena.match.remainingTicks = 100; }), 0);
    for (let tick = 2; tick <= 40; tick++) receive(frame(tick, (s) => { s.arena.slots[1].recovering = true; s.arena.match.remainingTicks = 100 - tick; }), tick * TICK_MS + 3);
    runtime.present(40 * TICK_MS + 3);
    const view = runtime.presentation()!;
    expect(view.slots[1].recovering).toBe(true);
    expect(view.match.remainingTicks).toBeGreaterThan(100 - 40);
  });

  it('holds on the last frame through a pause and restarts its clock when play resumes', () => {
    const { runtime, players, frame, receive } = replica();
    for (let tick = 1; tick <= 30; tick++) receive(frame(tick), tick * TICK_MS + 3);
    for (let now = 30 * TICK_MS; now < 2000; now += 10) runtime.present(now);
    expect(players[0].x).toBe(100 + 30 * 2);
    // Ten seconds later the host resumes from tick 31.
    const resume = 12_000;
    for (let tick = 31; tick <= 60; tick++) receive(frame(tick), resume + (tick - 31) * TICK_MS);
    let previous = players[0].x;
    for (let now = resume; now < resume + 30 * TICK_MS; now += 1000 / 120) {
      runtime.present(now);
      expect(players[0].x).toBeGreaterThanOrEqual(previous);
      previous = players[0].x;
    }
    expect(players[0].x).toBeGreaterThan(100 + 50 * 2);
  });
});
