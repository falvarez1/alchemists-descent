import { describe, expect, it } from 'vitest';

import { LAUNCH_LINES, launchLine } from '@/content/launchLines';
import { EventBus } from '@/core/events';
import type { Ctx } from '@/core/types';
import { MECHANISM_HINTS } from '@/game/Hints';
import { MATERIAL_LORE } from '@/game/lore';
import { Pickups } from '@/game/Pickups';
import { chainLine } from '@/ui/Callouts';
import { ledgerNote } from '@/ui/ledgerNotes';

/**
 * The game's small jokes live on surfaces that are told once (a rare chain, a first big pile, a strange ledger)
 * or that rotate (the launch line). These tests hold the rules that keep them from becoming lectures.
 */

describe('the chain ladder', () => {
  it('says nothing for a lone kill and something new for every link to ten', () => {
    expect(chainLine(0)).toBe('');
    expect(chainLine(1)).toBe('');
    const lines = Array.from({ length: 9 }, (_, i) => chainLine(i + 2));
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) expect(line.length).toBeGreaterThan(0);
  });

  it('keeps the duck at six and carries on past it', () => {
    expect(chainLine(6)).toBe('please mind the duck');
    expect(chainLine(7)).toBe('the duck has been informed');
    expect(chainLine(8)).toBe('the Guild requests that you stop');
    expect(chainLine(10)).toContain('hobby');
  });

  it('ends on one last line rather than repeating the one before it forever', () => {
    expect(chainLine(11)).not.toBe(chainLine(10));
    expect(chainLine(11)).toBe(chainLine(40));
  });
});

describe('the launch line', () => {
  it('opens plainly: the first descent ever is not joked at', () => {
    expect(launchLine(0)).toBe('Opening the intake…');
  });

  it('never repeats a line back to back and walks the whole rotation', () => {
    const seen = new Set<string>();
    let previous = '';
    for (let n = 0; n < LAUNCH_LINES.length * 3; n++) {
      const line = launchLine(n);
      expect(line).not.toBe(previous);
      seen.add(line);
      previous = line;
    }
    expect(seen.size).toBe(LAUNCH_LINES.length);
  });

  it('is safe on a missing or odd count', () => {
    expect(launchLine(Number.NaN)).toBe(LAUNCH_LINES[0]);
    expect(launchLine(-3)).toBe(LAUNCH_LINES[0]);
    expect(launchLine(2.9)).toBe(LAUNCH_LINES[2]);
  });
});

describe('the ledger remark', () => {
  const routineFall = { outcome: 'fallen' as const, kills: 31, timeMs: 14 * 60_000, deaths: 4 };
  const routineWin = { outcome: 'victory' as const, kills: 48, timeMs: 41 * 60_000, deaths: 2 };

  it('stays quiet on a routine fall, a routine win and an abandoned run of any length', () => {
    expect(ledgerNote(routineFall)).toBeNull();
    expect(ledgerNote(routineWin)).toBeNull();
    expect(ledgerNote({ outcome: 'abandoned', kills: 3, timeMs: 5 * 60_000, deaths: 0 })).toBeNull();
  });

  it('remarks on a win with nothing killed but the Kiln, a run under half a minute, and a run of six deaths', () => {
    expect(ledgerNote({ ...routineWin, kills: 1 })).toContain('the Kiln');
    expect(ledgerNote({ outcome: 'abandoned', kills: 0, timeMs: 12_000, deaths: 0 })).toContain('half a minute');
    expect(ledgerNote({ ...routineFall, deaths: 6 })).toContain('flowers');
  });

  it('says at most one thing, the strangest first', () => {
    expect(ledgerNote({ outcome: 'victory', kills: 1, timeMs: 20_000, deaths: 9 })).toContain('the Kiln');
    expect(ledgerNote({ outcome: 'fallen', kills: 0, timeMs: 20_000, deaths: 9 })).toContain('half a minute');
  });
});

describe('the big gold line', () => {
  function pickups(): { said: (ctx: Ctx, amount: number) => boolean; ctx: Ctx; events: EventBus } {
    const events = new EventBus();
    const ctx = { events } as unknown as Ctx;
    const instance = new Pickups() as unknown as { bigGoldFirst(ctx: Ctx, amount: number): boolean };
    return { said: (c, amount) => instance.bigGoldFirst(c, amount), ctx, events };
  }

  it('waits for a pile worth remarking on, says it once, and lets the next run say it again', () => {
    const { said, ctx, events } = pickups();
    expect(said(ctx, 149)).toBe(false);
    expect(said(ctx, 150)).toBe(true);
    expect(said(ctx, 400)).toBe(false);
    // A refuge refill or a restore is the same run.
    events.emit('phialsChanged', { phials: 3, max: 3, reason: 'refuge' });
    expect(said(ctx, 400)).toBe(false);
    events.emit('phialsChanged', { phials: 3, max: 3, reason: 'start' });
    expect(said(ctx, 200)).toBe(true);
    expect(said(ctx, 200)).toBe(false);
  });
});

describe('Grimoire marginalia', () => {
  const margins = Object.values(MATERIAL_LORE).filter((entry) => entry?.margin).map((entry) => ({ title: entry!.title, margin: entry!.margin! }));

  it('annotates a handful of materials, not every one', () => {
    expect(margins.length).toBeGreaterThanOrEqual(5);
    expect(margins.length).toBeLessThan(Object.keys(MATERIAL_LORE).length);
  });

  it('is short, in the house typography, and does not restate the lore', () => {
    for (const { title, margin } of margins) {
      expect(margin.length, title).toBeLessThanOrEqual(90);
      expect(margin, `${title}: straight quotes`).not.toMatch(/["']/);
      expect(margin.trim(), title).toBe(margin);
    }
  });
});

describe('the mechanism teach cards', () => {
  it('give the instruction first and the joke after it, and the joke is true of the plate', () => {
    const lever = MECHANISM_HINTS.lever!.teach.body;
    expect(lever.startsWith('Pull a lever with E.')).toBe(true);
    expect(lever).toContain('busy decade');
    const plate = MECHANISM_HINTS.plate!.teach.body;
    expect(plate.startsWith('Step on a plate')).toBe(true);
    // Mechanisms.sensePlate weighs cells (poured sand), bodies and corpses, not crates.
    expect(plate).toContain('Poured sand');
    expect(plate).toContain('corpse');
    expect(plate).not.toContain('crate');
  });
});
