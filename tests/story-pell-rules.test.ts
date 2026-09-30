import { describe, expect, it } from 'vitest';

import { PELL, PELL_BARKS, PELL_NOTICES, PELL_SECOND_TALK, storyVoiceLines } from '@/content/story';
import type { PellFacts } from '@/game/story/host';
import { IDLE_ACTS, pickIdle, seededRandom } from '@/game/story/pellIdle';
import { campDress, mouthOpen, noticeHeardId, noticeKey, pickDifferent, pickNotice, pinPostscript, teaUnneeded, withTold } from '@/game/story/pellRules';
import { freshStoryRun, sanitizeStoryRun } from '@/game/story/storyRun';

const calm: PellFacts = { floor: 2, kit: 'spark', phials: 3, deaths: 0, hpFrac: 0.7, gold: 0, boons: [], difficulty: 2, daily: false };
const run = (over: Partial<ReturnType<typeof freshStoryRun>> = {}) => ({ ...freshStoryRun(1), ...over });

describe('Pell’s notices', () => {
  it('every notice has a unique id, words, and a condition to fire on', () => {
    const ids = PELL_NOTICES.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PELL_NOTICES.length).toBeGreaterThanOrEqual(10);
    expect(PELL_NOTICES.length).toBeLessThanOrEqual(16);
    for (const n of PELL_NOTICES) {
      expect(n.text.length, n.id).toBeGreaterThan(20);
      // One short line: it is said after a greeting.
      expect(n.text.length, n.id).toBeLessThan(200);
      const conditions = [n.kit, n.biomes, n.phials, n.minDeaths, n.hp, n.minGold, n.boon, n.tier, n.daily, n.pinPaid];
      expect(conditions.some(c => c !== undefined), n.id).toBe(true);
    }
  });

  it('picks the kit joke where the kit meets the floor', () => {
    expect(pickNotice({ ...calm, kit: 'ember' }, 'fungal', run(), [])?.id).toBe('ember.fungal');
    expect(pickNotice({ ...calm, kit: 'storm', floor: 3 }, 'flooded', run(), [])?.id).toBe('storm.flooded');
    expect(pickNotice({ ...calm, kit: 'frost' }, 'frozen', run(), [])?.id).toBe('frost.frozen');
    expect(pickNotice({ ...calm, kit: 'ember' }, 'frozen', run(), [])?.id).toBe('ember.frozen');
    // The Sparkwright's case has its own line anywhere.
    expect(pickNotice(calm, 'fungal', run(), [])?.id).toBe('spark');
    // Kit and floor do not match: the plain case's line, or none for the others.
    expect(pickNotice({ ...calm, kit: 'frost' }, 'fungal', run(), [])).toBeNull();
  });

  it('reads the situation: wounds, the last phial, deaths, gold, the terms, the bargains, the mark', () => {
    const id = (f: Partial<PellFacts>, r = run(), biome: 'fungal' | 'flooded' = 'fungal', heard: string[] = []) => pickNotice({ ...calm, kit: 'frost', ...f }, biome, r, heard)?.id;
    expect(id({ hpFrac: 0.2 })).toBe('hurt');
    expect(id({ phials: 1 })).toBe('lastphial');
    expect(id({ deaths: 3 })).toBe('deaths3');
    expect(id({ deaths: 2 })).toBeUndefined();
    expect(id({ gold: 400 })).toBe('gold');
    expect(id({ gold: 100 })).toBeUndefined();
    expect(id({ hpFrac: 1 })).toBe('well');
    expect(id({ difficulty: 4 })).toBe('tier.hard');
    expect(id({ daily: true })).toBe('daily');
    expect(id({ boons: ['warmblood'] })).toBe('boon.warmblood');
    expect(id({ boons: ['vampirism', 'warmblood'] })).toBe('boon.vampirism');
    expect(id({}, run({ pinsPaid: ['d2'] }), 'flooded')).toBe('pinpaid');
    // The most pressing wins: a wound before a mark before a phial before a joke.
    expect(id({ hpFrac: 0.1, phials: 1, deaths: 4, gold: 900 }, run({ pinsPaid: ['d2'] }))).toBe('hurt');
    expect(id({ phials: 1, deaths: 4, gold: 900 }, run({ pinsPaid: ['d2'] }))).toBe('pinpaid');
    expect(id({ phials: 1, deaths: 4, gold: 900 })).toBe('lastphial');
  });

  it('keeps the introduction clean: no floor-1 situation notices before the second floor', () => {
    expect(pickNotice({ ...calm, kit: 'frost', floor: 1, phials: 1, gold: 900, hpFrac: 1 }, 'earthen', run(), [])?.id).toBeUndefined();
  });

  it('never says a notice twice in a run, nor an ever-joke on another run', () => {
    const f = { ...calm, kit: 'ember' as const };
    let r = run();
    const first = pickNotice(f, 'fungal', r, [])!;
    expect(first.id).toBe('ember.fungal');
    r = withTold(r, noticeKey(first.id));
    expect(pickNotice(f, 'fungal', r, [])?.id).not.toBe('ember.fungal');
    // On another run, that joke has been told once ever.
    expect(pickNotice(f, 'fungal', run(), [noticeHeardId('ember.fungal')])?.id).not.toBe('ember.fungal');
    // A reaction to a situation may come round again on another run.
    expect(pickNotice({ ...calm, hpFrac: 0.2 }, 'fungal', run(), [noticeHeardId('hurt')])?.id).toBe('hurt');
    expect(withTold(r, noticeKey(first.id))).toBe(r);
  });

  it('every notice can be reached by some set of facts', () => {
    const reachable = new Set<string>();
    const kits = ['spark', 'frost', 'ember', 'storm'] as const;
    const biomes = ['earthen', 'fungal', 'frozen', 'flooded', 'crystal'] as const;
    for (const kit of kits) for (const biome of biomes) for (const hpFrac of [0.1, 0.7, 1]) for (const phials of [1, 3]) for (const deaths of [0, 4]) {
      for (const extra of [{}, { gold: 900 }, { difficulty: 4 }, { daily: true }, { boons: ['vampirism'] }, { boons: ['warmblood'] }, { boons: ['rimesoles'] }]) {
        for (const pinsPaid of [[], ['d2']]) {
          // Take the notices one by one, as a run would, so the ones a higher priority hides still show.
          let r = run({ pinsPaid });
          for (let i = 0; i < PELL_NOTICES.length; i++) {
            const n = pickNotice({ ...calm, floor: biome === 'earthen' ? 1 : 2, kit, hpFrac, phials, deaths, ...extra }, biome, r, []);
            if (!n) break;
            reachable.add(n.id);
            r = withTold(r, noticeKey(n.id));
          }
        }
      }
    }
    expect([...PELL_NOTICES.map(n => n.id)].filter(id => !reachable.has(id))).toEqual([]);
  });
});

describe('Pell’s second talk and tea', () => {
  it('rotates: never the same as the last, and only ever from its pool', () => {
    const rand = seededRandom(3);
    let last: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const line = pickDifferent(PELL_SECOND_TALK.bye, last, rand);
      expect(line).not.toBe(last);
      expect(PELL_SECOND_TALK.bye).toContain(line);
      seen.add(line);
      last = line;
    }
    expect(seen.size).toBe(PELL_SECOND_TALK.bye.length);
    expect(PELL_SECOND_TALK.bye.length).toBeGreaterThanOrEqual(3);
    expect(pickDifferent(['only'], 'only', rand)).toBe('only');
  });

  it('the tea is not needed from nine tenths of health up', () => {
    expect(teaUnneeded(0.89)).toBe(false);
    expect(teaUnneeded(0.9)).toBe(true);
    expect(teaUnneeded(1)).toBe(true);
  });

  it('the tea buttons carry a refusal, and only the tea', () => {
    for (const floor of Object.values(PELL)) for (const visit of [floor!.first, floor!.again, floor!.veteran]) {
      for (const c of visit?.choices ?? []) expect(c.refuse !== undefined, `${visit!.id}: ${c.label}`).toBe(c.gift === 'tea');
    }
  });
});

describe('Pell’s camp and his last page', () => {
  it('pins a page for each floor he was met on before this one, from floor 2', () => {
    const met = { d1: { met: true, gift: 'seeds' }, d2: { met: true, gift: 'pin' } };
    expect(campDress({ pell: {} }, 1, 'earthen')).toMatchObject({ pages: 0, cup: false, frost: false, tin: 'none' });
    expect(campDress({ pell: { d1: met.d1 } }, 2, 'fungal').pages).toBe(1);
    expect(campDress({ pell: met }, 3, 'flooded').pages).toBe(2);
    expect(campDress({ pell: { ...met, d3: { met: true, gift: 'page' } } }, 4, 'volcanic').pages).toBe(3);
    // Met on the other door: still one page for the floor.
    expect(campDress({ pell: { d2b: { met: true, gift: null } } }, 3, 'crystal').pages).toBe(1);
  });

  it('leaves a cup once the tea is taken, frost on the cold floor, and a tin on the cold camp', () => {
    const tea = { pell: { d3: { met: true, gift: 'tea' } } };
    expect(campDress(tea, 3, 'flooded').cup).toBe(true);
    expect(campDress({ pell: { d3: { met: true, gift: 'pin' } } }, 3, 'flooded').cup).toBe(false);
    expect(campDress(tea, 4, 'volcanic')).toMatchObject({ cup: false, tin: 'empty' });
    expect(campDress({ pell: {} }, 4, 'volcanic').tin).toBe('full');
    expect(campDress({ pell: {} }, 2, 'frozen').frost).toBe(true);
    expect(campDress({ pell: {} }, 2, 'fungal').frost).toBe(false);
  });

  it('adds his P.S. only when the mark has paid', () => {
    expect(pinPostscript({ pinsPaid: [] }, false)).toBeNull();
    expect(pinPostscript({ pinsPaid: ['d3'] }, false)).toMatch(/^P\.S\./);
    expect(pinPostscript({ pinsPaid: ['d3'] }, true)).toMatch(/^P\.P\.S\./);
  });
});

describe('Pell’s mouth and his idle life', () => {
  it('opens on vowels, closes on lips and pauses, and is shut outside the line', () => {
    expect(mouthOpen('Oh!', 0)).toBe(0);
    expect(mouthOpen('Oh!', 0.1)).toBeGreaterThan(0.5);
    expect(mouthOpen('Oh!', 0.9)).toBe(0);
    expect(mouthOpen('a b', 0.5)).toBe(0);
    expect(mouthOpen('mm', 0.5)).toBe(0);
    expect(mouthOpen('st', 0.2)).toBeGreaterThan(0);
    expect(mouthOpen('', 0.5)).toBe(0);
    expect(mouthOpen('Hello', 1)).toBe(0);
  });

  it('a seeded weighted pick: never the same act twice running, the same for the same seed, and everything turns up', () => {
    const run1 = (seed: number): string[] => {
      const rand = seededRandom(seed);
      const out: string[] = [];
      let prev = 'sketch';
      for (let i = 0; i < 400; i++) { const n = pickIdle(prev, 'fungal', rand); out.push(n.act); prev = n.act; }
      return out;
    };
    const a = run1(11);
    expect(run1(11)).toEqual(a);
    expect(run1(12)).not.toEqual(a);
    for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]);
    expect(new Set(a)).toEqual(new Set(IDLE_ACTS.map(x => x.act)));
  });

  it('rubs his hands more on the cold floors', () => {
    const count = (biome: string): number => {
      const rand = seededRandom(5);
      let n = 0;
      let prev = 'sketch';
      for (let i = 0; i < 2000; i++) { const p = pickIdle(prev, biome, rand); if (p.act === 'rub') n++; prev = p.act; }
      return n;
    };
    expect(count('frozen')).toBeGreaterThan(count('fungal') * 1.8);
  });

  it('each act lasts within its own span', () => {
    const rand = seededRandom(9);
    for (let i = 0; i < 200; i++) {
      const p = pickIdle('warm', 'flooded', rand);
      const def = IDLE_ACTS.find(a => a.act === p.act)!;
      expect(p.seconds).toBeGreaterThanOrEqual(def.secs[0]);
      expect(p.seconds).toBeLessThanOrEqual(def.secs[1]);
    }
  });
});

describe('the run record', () => {
  it('an older save without the new fields still loads, with empty defaults', () => {
    const old = { v: 1, runIndex: 2, pipes: ['d1:refuge'], spoken: ['a'], pell: { d1: { met: true, gift: 'seeds' } }, echoes: ['echo.rot'], prologues: [], escape: 'none' };
    expect(sanitizeStoryRun(old)).toEqual({ ...old, told: [], pin: null, pinsPaid: [] });
  });

  it('keeps what he has told and his mark, and sanitizes the rest', () => {
    const s = sanitizeStoryRun({ v: 1, told: ['notice.hurt', 4, 'bark.fire', 'bark.fire'], pin: { level: 'd2', x: 10.6, y: 20, taken: 2.9 }, pinsPaid: ['d2', 7] });
    expect(s.told).toEqual(['notice.hurt', 'bark.fire']);
    expect(s.pin).toEqual({ level: 'd2', x: 11, y: 20, taken: 2 });
    expect(s.pinsPaid).toEqual(['d2']);
    expect(sanitizeStoryRun({ v: 1, pin: { level: 5, x: 1, y: 1 } }).pin).toBeNull();
    expect(sanitizeStoryRun({ v: 1, pin: 'nope', told: 'nope', pinsPaid: {} })).toMatchObject({ pin: null, told: [], pinsPaid: [] });
    expect(freshStoryRun(3)).toMatchObject({ told: [], pin: null, pinsPaid: [] });
  });
});

describe('what Pell says is registered, so it is recorded', () => {
  // Built text-first on 2026-09-30 (kept out of the registry to stay under the old 14,000-character voice
  // budget); the owner then authorised recording everything, so every line Pell can say is registered.
  it('his notices, barks and second-talk lines are all in the catalogue', () => {
    const registered = new Set(storyVoiceLines().filter(l => l.speaker === 'pell').map(l => l.text));
    for (const n of PELL_NOTICES) expect(registered.has(n.text), n.id).toBe(true);
    for (const b of [PELL_BARKS.fire, PELL_BARKS.corpse, PELL_BARKS.linger, PELL_BARKS.hurt, ...Object.values(PELL_BARKS.hostile)]) expect(registered.has(b.text), b.id).toBe(true);
    for (const line of [...PELL_SECOND_TALK.bye, ...PELL_SECOND_TALK.menu, ...Object.values(PELL_SECOND_TALK.floor).flat()]) expect(registered.has(line), line).toBe(true);
    expect(registered.has(PELL.earthen!.first.greet[0]!)).toBe(true);
  });
});
