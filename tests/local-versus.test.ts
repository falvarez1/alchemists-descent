import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/events';
import type { Ctx, RunStartConfig } from '@/core/types';
import { LocalVersus } from '@/game/LocalVersus';
import { isExternallyDriven } from '@/input/externalControl';

vi.mock('@/world/duelStage', () => ({ resetDuelStage: vi.fn() }));
vi.mock('@/arena/ai/driver', () => ({ botDriverFor: () => ({ off: vi.fn(), install: vi.fn() }), rivalDriverFor: () => ({ off: vi.fn(), install: vi.fn() }) }));

const pad = (index: number): Gamepad => ({ index, id: `test ${index}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) } as Gamepad);
function setup(ready = async () => true, rival = async () => 1) {
  const events = new EventBus(), starts: RunStartConfig[] = [];
  const input = { keys: {}, mouse: {}, releaseHeldInput: vi.fn() };
  const bundle = { input, player: {}, fighters: { releaseInputs: vi.fn() } };
  const ctx = {
    state: { mode: 'build', paused: true }, events, input,
    levels: { startRun: (_ctx: Ctx, config: RunStartConfig) => {
      starts.push(config); ctx.state.mode = 'play'; events.emit('modeChanged', { mode: 'play' }); events.emit('levelChanged', { name: 'Duel', depth: 0 }); return { ok: true };
    } },
    fighters: { whenReady: async () => undefined },
    arena: { bundle: () => bundle, active: true, configureStocks: vi.fn(), setSpawns: vi.fn(), addRival: rival, reset: vi.fn(), removeRival: vi.fn() },
  } as unknown as Ctx;
  const session = new LocalVersus(ctx, ready); ctx.versus = session;
  return { session, ctx, starts };
}

describe('local versus lifecycle', () => {
  it('keeps independent CPU difficulty per seat, clamps values, and locks settings during play', async () => {
    const { session } = setup(); session.open();
    session.chooseDifficulty(0, -2); session.chooseDifficulty(1, 9);
    expect(session.seats.map(seat => seat.cpuLevel)).toEqual([1, 5]);
    session.ready(0); await session.start(); session.chooseDifficulty(1, 2);
    expect(session.seats[1].cpuLevel).toBe(5);
    session.open(); expect(session.seats[1].cpuLevel).toBe(5); session.dispose();
  });
  it('prefers an already-connected controller for player one and remembers a later keyboard choice', () => {
    const { session } = setup(); session.poll([pad(0)], false); session.open();
    expect(session.seats[0].device).toBe('pad:0'); expect(session.seats[1].device).toBe('cpu');
    session.chooseDevice(0, 'keyboard'); session.close(); session.open();
    expect(session.seats[0].device).toBe('keyboard'); session.dispose();
  });
  it('starts a disposable fixed-difficulty match only after readiness and preserves the existing save contract', async () => {
    const { session, starts, ctx } = setup(); session.open();
    expect(await session.start()).toBe(false); session.ready(0);
    expect(await session.start()).toBe(true); expect(session.phase).toBe('playing'); expect(ctx.state.paused).toBe(false);
    expect(starts).toEqual([{ mode: 'test', worldSource: 'campaign-level', levelId: 'fighter-duel', fighter: 'ilyra-voss', loadout: 'advanced', difficulty: 3, presentation: 'versus' }]);
    session.dispose();
  });
  it('cancels an asynchronous launch without reopening or resetting a later screen', async () => {
    let finish: (value: boolean) => void = () => undefined;
    const ready = new Promise<boolean>(resolve => { finish = resolve; });
    const { session, starts } = setup(() => ready); session.open(); session.ready(0);
    const pending = session.start(); session.close(); finish(true);
    expect(await pending).toBe(false); expect(session.phase).toBe('idle'); expect(starts).toEqual([]);
  });
  it('returns to the lobby when the rival cannot join', async () => {
    const { session } = setup(undefined, async () => -1); session.open(); session.ready(0);
    expect(await session.start()).toBe(false); expect(session.phase).toBe('lobby'); expect(session.message).not.toBe('');
  });
  it('freezes on disconnect, keeps device ownership, and waits for explicit resume', async () => {
    const { session, ctx } = setup(); const pads = [pad(0), pad(1)];
    session.poll(pads, false); session.open(); session.chooseDevice(0, 'pad:0'); session.chooseDevice(1, 'pad:1');
    session.ready(0); session.ready(1); await session.start();
    expect(isExternallyDriven(ctx.input)).toBe(true);
    session.poll([pad(0), null], false); expect(session.phase).toBe('reconnect'); expect(ctx.state.paused).toBe(true);
    session.resume(); expect(session.phase).toBe('reconnect');
    session.poll(pads, false); expect(session.phase).toBe('reconnect');
    session.resume(); expect(session.phase).toBe('playing'); expect(ctx.state.paused).toBe(false);
    session.close(); expect(isExternallyDriven(ctx.input)).toBe(false);
  });
  it('preserves an existing menu pause across a disconnect and reconnect', async () => {
    const { session, ctx } = setup(); session.poll([pad(0)], false); session.open(); session.chooseDevice(0, 'keyboard'); session.chooseDevice(1, 'pad:0'); session.ready(0); session.ready(1); await session.start();
    ctx.state.paused = true; session.poll([], true); session.poll([pad(0)], true); session.resume();
    expect(ctx.state.paused).toBe(true); expect(session.phase).toBe('playing'); session.dispose();
  });
  it('clears match input ownership when leaving the level', async () => {
    const { session, ctx } = setup(); session.open(); session.ready(0); await session.start();
    ctx.events.emit('levelChanged', { name: 'Elsewhere', depth: 1 }); expect(session.phase).toBe('idle');
    expect(ctx.arena?.removeRival).toHaveBeenCalledWith(1);
  });
});
