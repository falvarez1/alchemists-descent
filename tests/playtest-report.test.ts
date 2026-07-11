import { describe, expect, it } from 'vitest';

import type { Ctx } from '@/core/types';
import { BUILD_STAMP, buildPlaytestReport } from '@/ui/playtestReport';

describe('playtest report', () => {
  it('serializes build stamp, seeds, run state, and counters as parseable JSON', () => {
    const ctx = {
      state: { score: 123, difficulty: 3 },
      telemetry: { all: () => ({ death: 2, 'death.cause.lava': 1, 'play.minutes': 14 }) },
      levels: {
        runStatus: () => ({
          mode: 'play',
          playtestSource: null,
          savedExpedition: false,
          autosaveEnabled: true,
          autosaveBlockReason: null,
          debugGodMode: false,
          debugActive: false,
          debugTainted: false,
          expeditionSeed: 42,
          worldSeed: 1337,
          level: { id: 'd1', name: 'Verdant Hollow', depth: 1 },
          player: { x: 1, y: 2, hp: 90, maxHp: 100, dead: false },
        }),
      },
    } as unknown as Ctx;

    const report: unknown = JSON.parse(buildPlaytestReport(ctx));
    const r = report as Record<string, unknown>;
    expect(r.build).toBe(BUILD_STAMP);
    expect(BUILD_STAMP).toMatch(/^\S+ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);
    expect(r.worldSeed).toBe(1337);
    expect(r.expeditionSeed).toBe(42);
    expect((r.level as Record<string, unknown>).id).toBe('d1');
    expect(r.difficulty).toBe('Conjurer');
    expect(r.gold).toBe(123);
    expect((r.counters as Record<string, number>)['death.cause.lava']).toBe(1);
    expect(r.debugTainted).toBe(false);
  });
});
