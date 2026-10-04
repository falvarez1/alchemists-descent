import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import { DeathCinema } from '@/game/DeathCinema';

/** A dead body in play, optionally inside an active arena; records every death-cinema phase and sound. */
function scene(arenaActive: boolean) {
  const events = new EventBus();
  const phases: string[] = [], sounds: string[] = [];
  events.on('deathCinema', ({ phase }) => { phases.push(phase); });
  const ctx = {
    events,
    player: { dead: true },
    state: { mode: 'play', paused: false },
    fx: { deathTime: 0, bloomKick: 0 },
    audio: { sfx: (id: string) => { sounds.push(id); } },
    particles: { spawn: () => {} },
    arena: arenaActive ? { active: true } : undefined,
  } as unknown as Ctx;
  const cinema = new DeathCinema(ctx);
  // Six seconds of frames: past the title card's latest moment (5 s without a settled corpse).
  for (let i = 0; i < 60; i++) cinema.update(0.1);
  return { ctx, phases, sounds };
}

describe('DeathCinema in an arena', () => {
  it('directs the descent death: heartbeats, letterbox, then the title card', () => {
    const { phases, sounds } = scene(false);
    expect(phases).toEqual(['begin', 'title']);
    expect(sounds.filter(s => s === 'player.heartbeat')).toHaveLength(3);
  });

  it('never runs for an arena knockout (a Duel ring-out is not the campaign death card)', () => {
    const { ctx, phases, sounds } = scene(true);
    expect(phases).toEqual([]);
    expect(sounds).toEqual([]);
    expect(ctx.fx.deathTime ?? 0).toBe(0);
  });
});
