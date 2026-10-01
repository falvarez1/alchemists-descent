import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '@/core/types';
import {
  GRIMOIRE_KEY,
  loadClues,
  loadDiscoveredRecipes,
  loadExperiments,
  loadGrimoireRecord,
  MAX_EXPERIMENTS,
  recordClue,
  recordExperiment,
  recordRecipeDiscovery,
  resetGrimoireCacheForTests,
} from '@/game/GrimoireStore';

function ctxStub(emit = vi.fn()): Ctx {
  return { events: { emit } } as unknown as Ctx;
}

/** THE EXPERIMENT: the Grimoire record's v3 (the experiment log and the margin notes). */
describe('GrimoireStore v3: the experiment log and the margin notes', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    resetGrimoireCacheForTests();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  afterEach(() => {
    resetGrimoireCacheForTests();
    vi.unstubAllGlobals();
  });

  const mix = (counts: Record<string, number>, verdict: 'inert' | 'close' | 'muddy' = 'inert', extra: Record<string, unknown> = {}) => ({
    sig: Object.keys(counts).map(Number).sort((a, b) => a - b).map((c) => `${c}:${counts[String(c)]}`).join(','),
    counts,
    verdict,
    ...extra,
  });

  it('upgrades a v2 record in place: nothing lost, an empty log and notes, written on the first change', () => {
    storage.set(GRIMOIRE_KEY, JSON.stringify({ version: 2, recipes: { life: true }, materials: { '2': true }, interactions: { 'water-quench-fire': true } }));
    expect(loadGrimoireRecord()).toEqual({
      version: 3,
      recipes: { life: true },
      materials: { '2': true },
      interactions: { 'water-quench-fire': true },
      experiments: [],
      clues: {},
    });
    // reading did not rewrite the old record...
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}').version).toBe(2);
    // ...the first experiment does, and keeps every old entry
    recordExperiment(mix({ '2': 9, '18': 4 }));
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}')).toMatchObject({
      version: 3,
      recipes: { life: true },
      materials: { '2': true },
      interactions: { 'water-quench-fire': true },
      experiments: [{ sig: '2:9,18:4', verdict: 'inert', tries: 1 }],
    });
  });

  it('keeps the same mix as one line with a count, most recent last', () => {
    expect(recordExperiment(mix({ '2': 9, '18': 4 }))).toEqual({ first: true, tries: 1 });
    expect(recordExperiment(mix({ '2': 12 }))).toEqual({ first: true, tries: 1 });
    expect(recordExperiment(mix({ '2': 9, '18': 4 }, 'close', { closeTo: 'life', feel: { '2': 'hot', '18': 'warm' } }))).toEqual({ first: false, tries: 2 });
    const log = loadExperiments();
    expect(log.map((e) => [e.sig, e.tries, e.verdict])).toEqual([['2:12', 1, 'inert'], ['2:9,18:4', 2, 'close']]);
    expect(log[1].feel).toEqual({ '2': 'hot', '18': 'warm' });
  });

  it('caps the log, shedding the oldest inert line first', () => {
    recordExperiment(mix({ '2': 9, '18': 4 }, 'close', { closeTo: 'life' }));
    for (let i = 1; i <= MAX_EXPERIMENTS; i++) recordExperiment(mix({ '2': 3, '19': i }));
    const log = loadExperiments();
    expect(log).toHaveLength(MAX_EXPERIMENTS);
    expect(log.some((e) => e.sig === '2:9,18:4')).toBe(true); // the shimmer outlived the dead mixes
    expect(log.some((e) => e.sig === '2:3,19:1')).toBe(false);
  });

  it('writes margin notes once, and persists them', () => {
    expect(recordClue('tea.1')).toBe(true);
    expect(recordClue('tea.1')).toBe(false);
    expect(loadClues()).toEqual({ 'tea.1': true });
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}').clues).toEqual({ 'tea.1': true });
  });

  it('survives a round trip through storage', () => {
    recordExperiment(mix({ '2': 9, '18': 4 }, 'muddy', { closeTo: 'life', feel: { '2': 'hot', '18': 'cold' } }));
    recordClue('life.1');
    resetGrimoireCacheForTests();
    expect(loadExperiments()).toEqual([{ sig: '2:9,18:4', counts: { '2': 9, '18': 4 }, verdict: 'muddy', closeTo: 'life', feel: { '2': 'hot', '18': 'cold' }, tries: 1 }]);
    expect(loadClues()).toEqual({ 'life.1': true });
  });

  it('drops malformed log lines instead of throwing', () => {
    storage.set(GRIMOIRE_KEY, JSON.stringify({
      version: 3,
      recipes: {},
      experiments: [
        null, 5, 'x',
        { counts: { '2': 9 }, verdict: 'inert' }, // good (its signature is recomputed)
        { counts: { '2': 9 }, verdict: 'inert' }, // a duplicate of it
        { counts: {}, verdict: 'inert' }, // nothing in it
        { counts: { '2': 9 }, verdict: 'exploded' }, // not a verdict
        { counts: { '999': 4, abc: 1, '7': -3 }, verdict: 'inert' }, // no valid cell
        { counts: { '2': 5, '19': 4 }, verdict: 'muddy', closeTo: 'life', feel: { '2': 'hot', '19': 'lukewarm', zz: 'hot' }, tries: 'many' },
      ],
      clues: { 'tea.1': true, bad: 'yes', worse: 1 },
    }));
    const log = loadExperiments();
    expect(log.map((e) => e.sig)).toEqual(['2:9', '2:5,19:4']);
    expect(log[1]).toEqual({ sig: '2:5,19:4', counts: { '2': 5, '19': 4 }, verdict: 'muddy', closeTo: 'life', feel: { '2': 'hot' }, tries: 1 });
    expect(loadClues()).toEqual({ 'tea.1': true });
  });

  it('reads a NEWER record for what it knows and never writes over it', () => {
    const newer = { version: 4, recipes: { life: true }, materials: { '2': true }, interactions: {}, experiments: [], clues: {}, somethingNew: { shiny: true } };
    storage.set(GRIMOIRE_KEY, JSON.stringify(newer));
    const emit = vi.fn();
    expect(loadDiscoveredRecipes()).toEqual({ life: true });
    // a discovery made this session lives in memory...
    expect(recordRecipeDiscovery(ctxStub(emit), 'tea', 'STRONG TEA')).toBe(true);
    expect(recordExperiment(mix({ '2': 9 }))).toEqual({ first: true, tries: 1 });
    expect(recordClue('tea.1')).toBe(true);
    expect(loadDiscoveredRecipes()).toEqual({ life: true, tea: true });
    // ...but the stored record is untouched, so the newer build that owns it loses nothing
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}')).toEqual(newer);
  });

  it('treats a corrupt record as empty and starts a fresh v3 on the first write', () => {
    storage.set(GRIMOIRE_KEY, '{"version":3,"recipes":');
    expect(loadGrimoireRecord()).toEqual({ version: 3, recipes: {}, materials: {}, interactions: {}, experiments: [], clues: {} });
    recordClue('tea.1');
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}')).toMatchObject({ version: 3, clues: { 'tea.1': true } });
  });
});
