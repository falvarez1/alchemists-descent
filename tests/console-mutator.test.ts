import { describe, expect, it } from 'vitest';

import { createGameParams } from '@/config/params';
import { EventBus } from '@/core/events';
import { isRunTainted } from '@/core/runTaint';
import type { CommandResult, Ctx, RunApi } from '@/core/types';
import { MutatorDirector } from '@/game/MutatorDirector';
import { createMutatorCommands } from '@/game/console/mutators';

/**
 * The tester's `mutator` command: reading never taints; changing the set puts it in force through the
 * real director, remembers it on the run, follows the alchemist's health to the HP dial, and TAINTS the
 * run (a complication put on by hand is not the descent the player chose).
 */
function harness(opts: { tracked?: boolean; mode?: 'play' | 'build' } = {}): { ctx: Ctx; run: (line: string) => CommandResult; remembered: () => readonly string[] } {
  const events = new EventBus();
  let remembered: readonly string[] = [];
  const ctx = {
    events,
    params: createGameParams(),
    state: { mode: opts.mode ?? 'play', frameCount: 0, playtestSource: null, debugGodMode: false, debugTainted: false, difficulty: 3 },
    player: { hp: 100, maxHp: 100, dead: false },
    story: { untrack: () => undefined },
    telemetry: { count: () => undefined },
  } as unknown as Ctx;
  ctx.mutators = new MutatorDirector(ctx);
  if (opts.tracked !== false) {
    ctx.run = {
      active: true,
      debugSetMutators: (c: Ctx, ids: readonly string[]) => { remembered = ids; c.mutators?.activate(c, ids); return true; },
    } as unknown as RunApi;
  }
  const [mutator] = createMutatorCommands();
  const run = (line: string): CommandResult => mutator.run(ctx, line.split(/\s+/).slice(1)) as CommandResult;
  return { ctx, run, remembered: () => remembered };
}

describe('mutator (the console command)', () => {
  it('lists every complication and marks the ones in force, without tainting', () => {
    const h = harness();
    const res = h.run('mutator');
    expect(res.ok).toBe(true);
    expect(res.text).toContain('wet-floors');
    expect(res.text).toContain('Short Rations');
    expect(res.text).toContain('at most 3');
    expect(isRunTainted(h.ctx.state)).toBe(false);
    h.run('mutator add hush');
    expect(h.run('mutator list').text).toMatch(/\* hush/);
  });

  it('adds one and TAINTS the run, says so, and puts it in force through the run', () => {
    const h = harness();
    const res = h.run('mutator add tinderbox');
    expect(res.ok).toBe(true);
    expect(res.text).toContain('DEBUG TAINT');
    expect(isRunTainted(h.ctx.state)).toBe(true);
    expect(h.ctx.state.mutators).toEqual(['tinderbox']);
    expect(h.remembered()).toEqual(['tinderbox']);
    // a second change does not repeat the sentence
    expect(h.run('mutator add hush').text).not.toContain('DEBUG TAINT');
    expect(h.ctx.state.mutators).toEqual(['tinderbox', 'hush']);
  });

  it('removes, sets and clears', () => {
    const h = harness();
    h.run('mutator set low-gravity,wet-floors');
    expect(h.ctx.state.mutators).toEqual(['wet-floors', 'low-gravity']);
    h.run('mutator remove wet-floors');
    expect(h.ctx.state.mutators).toEqual(['low-gravity']);
    h.run('mutator clear');
    expect(h.ctx.state.mutators).toBeUndefined();
    expect(h.remembered()).toEqual([]);
  });

  it('refuses nonsense, a fourth, and a change with no run, and refusing never taints', () => {
    const h = harness();
    expect(h.run('mutator add bogus').ok).toBe(false);
    expect(h.run('mutator frobnicate').ok).toBe(false);
    expect(isRunTainted(h.ctx.state)).toBe(false);
    h.run('mutator set wet-floors,tinderbox,hush');
    const fourth = h.run('mutator add famine');
    expect(fourth.ok).toBe(false);
    expect(h.ctx.state.mutators).toHaveLength(3);
    const title = harness({ mode: 'build' });
    expect(title.run('mutator add hush').ok).toBe(false);
    expect(isRunTainted(title.ctx.state)).toBe(false);
  });

  it('follows the alchemist\'s health to the HP dial, in proportion, both ways', () => {
    const h = harness();
    h.ctx.player.hp = 60;
    h.run('mutator add glass-cannon');
    expect(h.ctx.player.maxHp).toBe(50);
    expect(h.ctx.player.hp).toBe(30);
    h.run('mutator clear');
    expect(h.ctx.player.maxHp).toBe(100);
    expect(h.ctx.player.hp).toBe(60);
  });

  it('works on a run the director does not track (a test arena): the layer is set directly', () => {
    const h = harness({ tracked: false });
    expect(h.run('mutator add dark-works').ok).toBe(true);
    expect(h.ctx.state.mutators).toEqual(['dark-works']);
  });
});
